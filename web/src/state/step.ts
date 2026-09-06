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
import {
  checkNarratage,
  createNarratage,
  fromNarratageDraft,
  tickNarratageTimers,
  toNarratageDraft,
} from './narratage'
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
 * 它**不在脚本数据里**——原版是 `ScenePanel` 的字段，默认 `true`（原版的字段
 * 初值），从大地图走进宿舍那种"回到已经走过的场景"会把它置 `false`（出口
 * 事件，另一张票）。回放真值时由剧本头的 `isScript` 决定。
 *
 * 原版里它是**一个**字段，旁白与对话两边都读同一个（`Narratage.checkNarratage`
 * 与 `DialogueEvent.checkDialogue` 里都写着 `scene.isScript`），所以这里也只存
 * 一份，挂在 `World` 上，不再往 `DialogueScript` 里抄一遍。
 */
export function createWorld(scene: SceneScript, isScript = true): World {
  const script = dialogueScriptOf(scene)
  return {
    timeMs: 0,
    collision: collisionOf(scene),
    npcs: createNpcs(scene),
    role: createRole(scene.roleX, scene.roleY),
    script,
    dialogue: createDialogue(script),
    narratage: createNarratage(scene),
    isScript,
  }
}

/**
 * 世界推进一个 tick。**纯函数**：不读时钟、不碰 DOM、不画一个像素。
 *
 * 一个 tick 里的顺序固定为 **输入 → 定时器 → `ScenePanel.step()`**，与 trace
 * 导出器的 `输入 → 定时器 → step() → paint()` 对齐。`paint()` 唯一的状态副作用
 * 是对话正文里的 `@` / `$`，那两个标志改在写进字符缓冲的那一刻
 * （见 `dialogue.ts` 的 `writeChar`）。
 *
 * **`ScenePanel.step()` 的那几道门今天全由这一层自己算**：旁白由
 * `state/narratage.ts` 推进，主线对话由 `state/dialogue.ts` 推进，`step()` 不再
 * 从调用方（更不用说从真值）接任何一个门的状态。xl-9bd.10 与 xl-9bd.11 各自
 * 在只有一半的时候留过一个"另一半先从真值喂"的临时口子，两边的注释都写着同一
 * 句话：喂进来就等于把两端的分歧提前抹平，跟喂主角坐标是同一个错。两半都到齐
 * 之后，那两个口子在这里一起关掉（xl-4rx）。
 *
 * 定时器的次序**要紧**，照抄导出器 `installTimers` 的装表顺序（根对象依次是
 * `sp.role`、`sp.dialogue`、`sp.narratage`、…、然后才是 `sp.npcs`，每个根对象
 * 内部按字段名排序）：`sp.role`（`run`、`walk`）→ `sp.dialogue`（六个）→
 * `sp.narratage`（`background`、`wordRun`）→ 每个 NPC（`action`、`walk`）。
 * 所以主角在第 t 个 tick 判碰撞时看到的是 NPC 在第 t-1 个 tick 末的位置 ——
 * 这一格的时差在真值里看得见，把 NPC 提前推进就对不上。旁白那两个的先后同样
 * 分辨得出来，理由写在 `narratage.ts` 的 `tickNarratageTimers`。
 *
 * 主角自己的两个定时器实际上永远不会同时在跑（`setEvent` 起跑步之前先
 * `walk.stop()`），钉死次序只是不留"万一"。
 *
 * `input` 是本 tick 收到的输入事件，按到达顺序（见 `applyInput`）。
 */
export function step(world: World, input: readonly InputEvent[], dtMs: number): World {
  const now = world.timeMs
  const d = toDraft(world.role)
  // NPC 的格子坐标在主角的定时器跑完之前是冻住的：它们这一 tick 还没动。
  const tiles: readonly TilePos[] = world.npcs
  const npcs = world.npcs.map(toNpcDraft)
  const dlg = toDialogueDraft(world.dialogue)
  const nar = toNarratageDraft(world.narratage)
  const script = world.script

  for (const event of input) applyInput(world, d, dlg, event, now)

  fireDue(d.run, now, ROLE_TIMER_MS, () => tickRun(d, world.collision, tiles), '跑步定时器')
  fireDue(d.walk, now, ROLE_TIMER_MS, () => tickWalk(d, world.collision, tiles), '走路定时器')
  tickDialogueTimers(dlg, now)
  tickNarratageTimers(nar, now)
  for (const npc of npcs) tickNpcTimers(npc, now)

  // ——— `ScenePanel.step()` ———
  // 主角的位置取**定时器跑完之后**的：原版就是这个次序。
  // 第 4 步（出口）、第 6 步（宝箱）、第 7 步（计步战斗）各是别的票。
  const rx = roleTile(d.px)
  const ry = roleTile(d.py)
  // 1. 检查旁白。它在第 2/3/5 步之前，所以**起旁白的那一 tick 就已经把后面
  //    三道门关上了**——真值第 0 tick 记的就是 active。
  checkNarratage(nar, world.isScript, now)
  // 2. 检查自动的对话（进场就播的那一段，触发码写着 -1）
  if (storyGateOpen(world, dlg, nar) && checkAutoDialogue(dlg, script, now)) {
    // `startSpeak` 里那句 `scene.role.setEvent(true)`：开口就松手。
    d.canStop = true
  }
  // 3. 检查 NPC
  if (!dlg.speaking && !nar.active) checkNpcStop(npcs, rx, ry, now)
  // 5. 检查位置对话
  if (storyGateOpen(world, dlg, nar) && checkLocationDialogue(dlg, script, rx, ry, now)) {
    d.canStop = true
  }

  return {
    ...world,
    timeMs: now + dtMs,
    role: fromDraft(d),
    npcs: npcs.map(fromNpcDraft),
    dialogue: fromDialogueDraft(dlg),
    narratage: fromNarratageDraft(nar),
  }
}

/**
 * `ScenePanel.step()` 第 2 / 5 步共用的那道门：
 * `isScript && !isSpeaking && !dialogueEventOver && !isNarratage`。
 *
 * **旁白那一项读的是第 1 步之后的草稿**（`nar.active`），不是本 tick 之初的
 * 快照——原版这四个条件是在 `checkNarratage()` 已经跑过之后才求值的。差别看得
 * 见：dorm-intro 的旁白在第 0 tick 就起来了，取旧值的话进场那段自动对话会抢在
 * 旁白前面开口。
 */
function storyGateOpen(
  world: World,
  dlg: ReturnType<typeof toDialogueDraft>,
  nar: ReturnType<typeof toNarratageDraft>,
): boolean {
  return world.isScript && !dlg.speaking && !dlg.eventOver && !nar.active
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
 * 置 `canStop`。差别看得见：旁白起来时主角正走着，玩家松了手 —— 漏了这条，
 * 他会一直走到旁白结束。
 *
 * 旁白那道门读的是 `world.narratage`，也就是**本 tick 的定时器与 `step()` 都
 * 还没跑之前**的值 —— 原版的按键正是在那个时刻到达的。
 *
 * **今天的真值分辨不出这道门**：dorm-intro 从头到尾没有一次按键落在旁白期间。
 * 所以它是照着 `ScenePanel.keyPressed` 抄的，由 `step.test.ts` 钉住，不是从
 * trace 里读出来的。
 *
 * 选择框（`selectEvent.isSelect`）、宝箱、ESC 进菜单各是别的票，那几行在原版
 * 里与这里的分支并列，不影响这几条的先后。
 */
function applyInput(
  world: World,
  d: ReturnType<typeof toDraft>,
  dlg: ReturnType<typeof toDialogueDraft>,
  event: InputEvent,
  now: number,
): void {
  if (event.e === 'release') {
    // `ScenePanel.keyReleased` 的 switch 只有四个方向键的分支。
    if (isArrowKey(event.k)) d.canStop = true
    return
  }
  if (world.narratage.active) return

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
    if (
      checkDialogue(
        dlg,
        world.script,
        world.isScript,
        world.npcs,
        roleTile(d.px),
        roleTile(d.py),
        now,
      )
    ) {
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
