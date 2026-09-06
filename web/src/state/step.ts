import type { SceneScript } from '../data/types'
import { checkNpcStop, createNpcs, fromNpcDraft, tickNpcTimers, toNpcDraft } from './npc'
import {
  ROLE_TIMER_MS,
  createRole,
  fromDraft,
  pressDirection,
  roleTileX,
  roleTileY,
  tickRun,
  tickWalk,
  toDraft,
} from './role'
import { fireDue } from './timer'
import { isArrowKey } from './types'
import type { CollisionMap, InputEvent, TilePos, World } from './types'

/**
 * 一个 tick 的虚拟毫秒。原版主循环是 `while(true){ step(); Clock.sleep(10); }`，
 * trace 的 `tickMs` 也是 10。**必须整除 80**（走/跑定时器的间隔），否则触发
 * 时刻会被舍入，主角走的距离就跟真值对不上。
 */
export const TICK_MS = 10

/** 从一份烘焙好的场景脚本取出碰撞层。 */
export function collisionOf(scene: SceneScript): CollisionMap {
  return { col: scene.col, row: scene.row, mapSet: scene.mapSet }
}

/**
 * 场景里 NPC 的初始格子坐标。
 *
 * `createNpcs` 会跳过原版建不出来的条目（状态码不是 0/1/2 的那些，见
 * `state/npc.ts`），所以这里**从建好的 NPC 上取**，不再自己去数
 * `npcList` 的前三个字段——两处各读一遍同一份数据，迟早分家。
 */
export function npcTilesOf(scene: SceneScript): TilePos[] {
  return createNpcs(scene).map((npc) => ({ x: npc.x, y: npc.y }))
}

/** 一个场景的初始世界。 */
export function createWorld(scene: SceneScript): World {
  return {
    timeMs: 0,
    collision: collisionOf(scene),
    npcs: createNpcs(scene),
    role: createRole(scene.roleX, scene.roleY),
  }
}

/**
 * `ScenePanel.step()` 里那几道 `if` 的门。
 *
 * 第 3 步（检查 NPC）写着 `if (!dialogueEvent.isSpeaking && !narratage.isNarratage)`
 * ——主线对话或旁白进行中时**不**替 NPC 决定停走。对话与旁白是 xl-9bd.10 / .11，
 * 状态层今天还不知道它们，所以由调用方喂：回放真值时从 trace 的
 * `dialogue` / `narratage` 两个字段读，跑起来时两个都是 false。
 *
 * 做成入参而不是"先不管"，是因为不管的后果只在一种情形下看得见：一个 NPC 在
 * 对话开始前恰好被停住，对话期间原版不会去重启它，而漏了这道门的实现会重启。
 * 那是一帧的差别，肉眼看不出来。
 *
 * **今天的三份真值分辨不出这道门**（实测：整个拿掉，逐 tick 比对照样全绿）——
 * 三份剧本里主角贴身的那几段都不在对话或旁白期间。所以它是照着
 * `ScenePanel.step()` 抄的，不是测出来的；见 `traceReplay.test.ts` 的
 * `gatesBefore`。
 */
export interface SceneGates {
  /** `dialogueEvent.isSpeaking`：主线对话进行中。 */
  readonly speaking: boolean
  /** `narratage.isNarratage`：旁白进行中。 */
  readonly narratage: boolean
}

const NO_GATES: SceneGates = { speaking: false, narratage: false }

/**
 * 世界推进一个 tick。**纯函数**：不读时钟、不碰 DOM、不画一个像素。
 *
 * 一个 tick 里的顺序固定为 **输入 → 定时器 → `ScenePanel.step()`**，与 trace
 * 导出器的 `输入 → 定时器 → step() → paint()` 对齐（`paint()` 的状态副作用
 * 在对话层，xl-9bd.10 / .11）。
 *
 * 定时器的次序**要紧**，照抄导出器 `installTimers` 的装表顺序：
 * 先 `sp.role`（字段名排序 → `run`、`walk`），再 `sp.npcs` 里的每个 NPC
 * （`action`、`walk`）。所以主角在第 t 个 tick 判碰撞时看到的是 NPC 在第
 * t-1 个 tick 末的位置 —— 这一格的时差在真值里看得见，把 NPC 提前推进就对不上。
 *
 * 主角自己的两个定时器实际上永远不会同时在跑（`setEvent` 起跑步之前先
 * `walk.stop()`），钉死次序只是不留"万一"。
 *
 * `input` 是本 tick 收到的输入事件，按到达顺序；方向键之外的键在这里被显式
 * 忽略（trace 里就混着 `space`）。对话/旁白期间要不要屏蔽方向键则是调用方的事
 * （原版 `ScenePanel.keyPressed` 的那几层 `if`），状态层不替它做判断。
 */
export function step(
  world: World,
  input: readonly InputEvent[],
  dtMs: number,
  gates: SceneGates = NO_GATES,
): World {
  const now = world.timeMs
  const d = toDraft(world.role)
  // NPC 的格子坐标在主角的定时器跑完之前是冻住的：它们这一 tick 还没动。
  const tiles: readonly TilePos[] = world.npcs
  const npcs = world.npcs.map(toNpcDraft)

  for (const event of input) {
    // 方向键之外一概不认。原版 `ScenePanel.keyPressed` 里空格走的是搭话/
    // 推进对话那几条分支（xl-9bd.9 / .11），跟主角的移动没有关系。
    if (!isArrowKey(event.k)) continue
    if (event.e === 'press') {
      // 原版 `ScenePanel.keyPressed`：先 `checkRun()`（只做 setRun(true)），
      // 再 `switchWalk()`。按住控制键**只在按下方向键的那一刻**置位跑步，
      // 松开控制键什么也不做——跑步是在跑步定时器停下时自己清掉的。
      if (event.ctrl) d.running = true
      pressDirection(d, event.k, now)
    } else {
      // `ScenePanel.keyReleased` -> `Role.setEvent(true)`：只置 canStop，
      // 真正停下要等走到下一个可停点。
      d.canStop = true
    }
  }

  fireDue(d.run, now, ROLE_TIMER_MS, () => tickRun(d, world.collision, tiles), '跑步定时器')
  fireDue(d.walk, now, ROLE_TIMER_MS, () => tickWalk(d, world.collision, tiles), '走路定时器')
  for (const npc of npcs) tickNpcTimers(npc, now)

  // `ScenePanel.step()` 的第 3 步。主角的位置取**定时器跑完之后**的——原版
  // 就是这个次序，checkNPCStop 读的是 role 当前的格子。
  const role = fromDraft(d)
  if (!gates.speaking && !gates.narratage) {
    checkNpcStop(npcs, roleTileX(role), roleTileY(role), now)
  }

  return { ...world, timeMs: now + dtMs, role, npcs: npcs.map(fromNpcDraft) }
}
