import type { SceneScript } from '../data/types'
import {
  checkAutoDialogue,
  checkDialogue,
  checkLocationDialogue,
  checkNpcOral,
  createDialogue,
  dialogueScriptOf,
  fromDialogueDraft,
  pressSpace,
  skipPrinting,
  tickDialogueTimers,
  toDialogueDraft,
} from './dialogue'
import { checkNpcStop, createNpcs, fromNpcDraft, tickNpcTimers, toNpcDraft } from './npc'
import {
  ROLE_TIMER_MS,
  TILE,
  createRole,
  fromDraft,
  pressDirection,
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

/**
 * 一个场景的初始世界。
 *
 * `isScript` 就是 `ScenePanel.isScript`：这个场景是当成"剧情脚本"进的
 * （放旁白、放自动对话、按空格能触发主线对话），还是当成普通场景进的。
 * 它**不在脚本数据里**——原版是 `ScenePanel` 的字段，默认 `true`，从大地图
 * 走进宿舍那种切场景会把它置 `false`（出口事件，另一张票）。这里同样默认
 * `true`，回放真值时由剧本头的 `isScript` 决定。
 */
export function createWorld(scene: SceneScript, isScript = true): World {
  const script = dialogueScriptOf(scene, isScript)
  return {
    timeMs: 0,
    collision: collisionOf(scene),
    npcs: createNpcs(scene),
    role: createRole(scene.roleX, scene.roleY),
    script,
    dialogue: createDialogue(script),
  }
}

/**
 * `ScenePanel.step()` 里那几道 `if` 的门中，**状态层今天还答不上来的那个**。
 *
 * 第 1/2/3/5 步的条件是 `!dialogueEvent.isSpeaking && !narratage.isNarratage`。
 * 左边那个自 xl-9bd.10 起由这一层自己算（`world.dialogue.speaking`）——
 * 对话就在这里，再从外面喂等于让真值给自己打分。右边那个是旁白（xl-9bd.11），
 * 还没实现，所以仍然由调用方喂：回放真值时从 trace 的 `narratage.active` 读，
 * 跑起来时恒为 false。
 *
 * **喂的是当前这一 tick 的快照，不是上一 tick 的。** 这一条要紧，而且是能
 * 论证的：`isNarratage` 只被两处改写——旁白自己的定时器（在 `step()` 之前
 * 触发）和 `ScenePanel.step()` 的第 1 步 `checkNarratage()`；`paint()` 里的
 * `drawNarratage` 一个字段都不改（`scene/Narratage.java`）。所以 trace 第 t
 * 行那个写在 `paint()` 之后的快照，正是第 2/3/5 步当时看到的值。
 *
 * 取上一 tick 就会差一拍，而这一拍是看得见的：dorm-intro 的旁白在 t=810 这一
 * tick 里结束，同一 tick 的第 2 步就把主线对话开了口（真值的 t=810 那行
 * `narratage.active=false` 且 `dialogue.active=true`）。喂 t=809 的快照，
 * 整段 23 句对话会整体晚一个 tick，逐字游标从头错到尾。
 */
export interface SceneGates {
  /** `narratage.isNarratage`：旁白进行中。 */
  readonly narratage: boolean
}

const NO_GATES: SceneGates = { narratage: false }

/**
 * 世界推进一个 tick。**纯函数**：不读时钟、不碰 DOM、不画一个像素。
 *
 * 一个 tick 里的顺序固定为 **输入 → 定时器 → `ScenePanel.step()`**，与 trace
 * 导出器的 `输入 → 定时器 → step() → paint()` 对齐。`paint()` 唯一的状态副作用
 * 是对话正文里的 `@` / `$`，那两个标志改在写进字符缓冲的那一刻
 * （见 `dialogue.ts` 的 `writeChar`）。
 *
 * 定时器的次序**要紧**，照抄导出器 `installTimers` 的装表顺序：
 * `sp.role`（字段名排序 → `run`、`walk`）→ `sp.dialogue`（六个，字段名排序）
 * → `sp.npcs` 里的每个 NPC（`action`、`walk`）。所以主角在第 t 个 tick 判碰撞
 * 时看到的是 NPC 在第 t-1 个 tick 末的位置 —— 这一格的时差在真值里看得见，
 * 把 NPC 提前推进就对不上。
 *
 * 主角自己的两个定时器实际上永远不会同时在跑（`setEvent` 起跑步之前先
 * `walk.stop()`），钉死次序只是不留"万一"。
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
  const dlg = toDialogueDraft(world.dialogue)
  const script = world.script

  for (const event of input) applyInput(world, d, dlg, event, gates, now)

  fireDue(d.run, now, ROLE_TIMER_MS, () => tickRun(d, world.collision, tiles), '跑步定时器')
  fireDue(d.walk, now, ROLE_TIMER_MS, () => tickWalk(d, world.collision, tiles), '走路定时器')
  tickDialogueTimers(dlg, now)
  for (const npc of npcs) tickNpcTimers(npc, now)

  // ——— `ScenePanel.step()` ———
  // 主角的位置取**定时器跑完之后**的：原版就是这个次序。
  // 第 1 步（检查旁白）是 xl-9bd.11；第 4 步（出口）、第 6 步（宝箱）、
  // 第 7 步（计步战斗）各是别的票。
  const rx = roleTile(d.px)
  const ry = roleTile(d.py)
  // 2. 检查自动的对话（进场就播的那一段，触发码写着 -1）
  if (storyGateOpen(script, dlg, gates) && checkAutoDialogue(dlg, script, now)) {
    // `startSpeak` 里那句 `scene.role.setEvent(true)`：开口就松手。
    d.canStop = true
  }
  // 3. 检查 NPC
  if (!dlg.speaking && !gates.narratage) checkNpcStop(npcs, rx, ry, now)
  // 5. 检查位置对话
  if (storyGateOpen(script, dlg, gates) && checkLocationDialogue(dlg, script, rx, ry, now)) {
    d.canStop = true
  }

  return {
    ...world,
    timeMs: now + dtMs,
    role: fromDraft(d),
    npcs: npcs.map(fromNpcDraft),
    dialogue: fromDialogueDraft(dlg),
  }
}

/** `ScenePanel.step()` 第 2 / 5 步共用的那道门。 */
function storyGateOpen(
  script: World['script'],
  dlg: ReturnType<typeof toDialogueDraft>,
  gates: SceneGates,
): boolean {
  return script.isScript && !dlg.speaking && !dlg.eventOver && !gates.narratage
}

/** `Role.getX()` / `getY()`：像素的整数除法。草稿上直接算，不必先冻。 */
function roleTile(px: number): number {
  return Math.trunc(px / TILE)
}

/**
 * 一个按键事件（`ScenePanel.keyPressed` / `keyReleased`）。
 *
 * 那几层 `if` 是有后果的，逐层照抄：
 *
 * - 整个 `keyPressed` 包在 `if (!narratage.isNarratage)` 里 —— **旁白期间一个
 *   键都不认**；
 * - 主线对话进行中只走 `dialogueEvent.keyPressed`（空格），方向键失效；
 * - 口头语进行中只走 `npcEvent.keyPress`（空格），方向键同样失效；
 * - 空格先试主线对话（`checkDialogue`），搭上了就**不再**试口头语 ——
 *   原版那个 `b` 就是干这个的。
 *
 * `keyReleased` 不在这几层 `if` 里面：它是另一个方法，任何时候松开方向键都会
 * 置 `canStop`。
 *
 * 选择框（`selectEvent.isSelect`）、宝箱、ESC 进菜单各是别的票，那几行在原版
 * 里与这里的分支并列，不影响这几条的先后。
 */
function applyInput(
  world: World,
  d: ReturnType<typeof toDraft>,
  dlg: ReturnType<typeof toDialogueDraft>,
  event: InputEvent,
  gates: SceneGates,
  now: number,
): void {
  if (event.e === 'release') {
    // `ScenePanel.keyReleased` 的 switch 只有四个方向键的分支。
    if (isArrowKey(event.k)) d.canStop = true
    return
  }
  if (gates.narratage) return

  // 跳过逐字打印。**原版没有这个键**，见 `dialogue.ts` 的 `skipPrinting`。
  if (event.k === 'skip') {
    skipPrinting(dlg, now)
    return
  }

  const space = event.k === 'space'
  if (dlg.speaking) {
    if (space) pressSpace(dlg, world.script, world.npcs, now)
    return
  }

  // 空格先试主线对话。`reader.getDialogueCode() != null` 那道门 = `code` 非空。
  let started = false
  if (space && world.script.code !== null) {
    if (checkDialogue(dlg, world.script, world.npcs, roleTile(d.px), roleTile(d.py), now)) {
      d.canStop = true
      started = true
    }
  }

  if (dlg.oral) {
    if (space) pressSpace(dlg, world.script, world.npcs, now)
    return
  }
  if (isArrowKey(event.k)) {
    // 原版 `ScenePanel.keyPressed`：先 `checkRun()`（只做 setRun(true)），
    // 再 `switchWalk()`。按住控制键**只在按下方向键的那一刻**置位跑步，
    // 松开控制键什么也不做——跑步是在跑步定时器停下时自己清掉的。
    if (event.ctrl) d.running = true
    pressDirection(d, event.k, now)
    return
  }
  if (space && !started) {
    checkNpcOral(dlg, world.script, world.npcs, roleTile(d.px), roleTile(d.py), now)
  }
}
