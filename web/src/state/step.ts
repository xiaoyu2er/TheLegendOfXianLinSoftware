import type { SceneScript } from '../data/types'
import {
  createRole,
  fireIfDue,
  fromDraft,
  pressDirection,
  tickRun,
  tickWalk,
  toDraft,
} from './role'
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
 * 场景里 NPC 的初始格子坐标。`npcList` 每条的前三个字段是
 * `状态码 x y`（见 `tools.Reader`），这里只要 x/y——NPC 自己怎么动是
 * xl-9bd.9，在那之前它们就是几块不会动的挡路石。
 */
export function npcTilesOf(scene: SceneScript): TilePos[] {
  return (scene.npcList ?? []).map((npc) => ({ x: Number(npc[1]), y: Number(npc[2]) }))
}

/** 一个场景的初始世界。 */
export function createWorld(scene: SceneScript): World {
  return {
    timeMs: 0,
    collision: collisionOf(scene),
    npcs: npcTilesOf(scene),
    role: createRole(scene.roleX, scene.roleY),
  }
}

/**
 * 世界推进一个 tick。**纯函数**：不读时钟、不碰 DOM、不画一个像素。
 *
 * 一个 tick 里的顺序固定为 **输入 → 定时器**，与 trace 导出器的
 * `输入 → 定时器 → step() → paint()` 对齐（后两步在这一票的范围里没有状态
 * 副作用：旁白/对话/出口/NPC 分别是 xl-9bd.11 / .9 / 后续票）。
 *
 * 定时器先跑 `run` 再跑 `walk`——导出器按字段名排序安装定时器，`Role` 的两个
 * 字段就是这个次序。实际上两个永远不会同时在跑（`setEvent` 起跑步之前先
 * `walk.stop()`），所以这条只是把"万一"也钉死。
 *
 * `input` 是本 tick 收到的输入事件，按到达顺序；方向键之外的键在这里被显式
 * 忽略（trace 里就混着 `space`）。对话/旁白期间要不要屏蔽方向键则是调用方的事
 * （原版 `ScenePanel.keyPressed` 的那几层 `if`），状态层不替它做判断。
 */
export function step(world: World, input: readonly InputEvent[], dtMs: number): World {
  const now = world.timeMs
  const d = toDraft(world.role)

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

  let guard = 0
  while (fireIfDue(d.run, now, () => tickRun(d, world.collision, world.npcs))) {
    if (++guard > 64) throw new Error('跑步定时器在一个 tick 内触发超过 64 次')
  }
  guard = 0
  while (fireIfDue(d.walk, now, () => tickWalk(d, world.collision, world.npcs))) {
    if (++guard > 64) throw new Error('走路定时器在一个 tick 内触发超过 64 次')
  }

  return { ...world, timeMs: now + dtMs, role: fromDraft(d) }
}
