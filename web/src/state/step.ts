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
import { exitTableOf } from './exit'
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
import type { DialogueScript, DialogueState } from './dialogue'

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
  return { ...initiate(null, scene), isScript }
}

/**
 * `ScenePanel` 构造函数里写死的那三个字段：`currentScript = {"7/7", "宿舍.txt",
 * "脚本1.txt"}`。**它是剧情的起点，不是任何一个场景的属性**——所以它在这里，
 * 不在场景数据里。
 */
export const START_SCRIPT: readonly string[] = ['7/7', '宿舍.txt', '脚本1.txt']

/**
 * `ScenePanel.initiation(fileName)`：换一个场景。
 *
 * `prev` 为 `null` 就是"游戏刚开机"（`createWorld`）；否则是从 `prev` 那个
 * 场景走过来的，于是有三样东西**跨场景活着**，一样都不能顺手清掉：
 *
 * 1. **`nextScript` 是粘的**。原版写的是 `if (reader.getNextScript() != null)`，
 *    新场景没有 `NextScript` 段就留着上一个的。
 * 2. **主线对话的进度也是粘的**。`initiation` 只在 `reader.getDialogueCode()
 *    != null` 时才 `new DialogueEvent(...)`；新场景没有 `Dialogue` 段时那个
 *    对象**原封不动地留着**，`dialogueEventOver` / `dialogueOrder` 一起留着。
 *    宿舍与大地图都没有 `Dialogue` 段，所以在这两个场景之间来回走，剧情进度
 *    是上一段剧情脚本留下的那份——这不是巧合，出口的分支正是靠它分开的。
 *    重建的只有 `Dialogue`（正文缓冲、游标、弹出动画）与 `NPCEvent`（口头语）。
 * 3. **世界时间**。换场景不重置虚拟时钟。
 *
 * `isScript` 在原版里不归 `initiation` 管：它是调用方在 `initiation` 前后
 * 自己置的（`ExitEvent` 的三条分支各置各的）。所以这里原样带过来，
 * 由调用方覆盖。
 */
export function initiate(prev: World | null, scene: SceneScript): World {
  const script = dialogueScriptOf(scene)
  return {
    timeMs: prev?.timeMs ?? 0,
    scene: scene.script,
    collision: collisionOf(scene),
    exit: exitTableOf(scene),
    // NPC 的两个定时器在构造函数里就 start() 了，起算点是**此刻**，
    // 不是 0 —— 从出口走进来时时钟已经跑了几秒（见 `createNpcs` 的注释）。
    npcs: createNpcs(scene, prev?.timeMs ?? 0),
    role: createRole(scene.roleX, scene.roleY),
    script,
    dialogue: carryDialogue(prev, script),
    narratage: createNarratage(scene),
    audio: { bgm: scene.sceneMusic },
    isScript: prev?.isScript ?? true,
    currentScript: prev?.currentScript ?? START_SCRIPT,
    nextScript: scene.nextScript ?? prev?.nextScript ?? null,
    // ExitEvent 跟着 initiation 一起重建，它记的那个进度也就跟着回到 0。
    savedOrder: 0,
  }
}

/**
 * 换场景时对话状态的去留，照 `ScenePanel.initiation` 那两行分：
 * `Dialogue` 与 `NPCEvent` 每次都新建，`DialogueEvent` 只在新场景**有**
 * `Dialogue` 段时才新建。
 *
 * 于是新场景没有 `Dialogue` 段时，`DialogueEvent` 的六个字段整个从上一个
 * 场景带过来。少带一个（尤其是 `eventOver`）就会让出口走错分支，而画面上
 * 的表现只是"走回宿舍时进的场景不对"——查不出来的那种。
 */
function carryDialogue(prev: World | null, script: DialogueScript): DialogueState {
  const fresh = createDialogue(script)
  if (prev === null || script.code !== null) return fresh
  const d = prev.dialogue
  return {
    ...fresh,
    speaking: d.speaking,
    groupOver: d.groupOver,
    eventOver: d.eventOver,
    groupOrder: d.groupOrder,
    sentenceOrder: d.sentenceOrder,
    fight: d.fight,
    gameOver: d.gameOver,
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
export function step(
  world: World,
  input: readonly InputEvent[],
  dtMs: number,
  scenes: SceneSource = missingSceneSource,
): World {
  const now = world.timeMs
  const d = toDraft(world.role)
  // NPC 的格子坐标在主角的定时器跑完之前是冻住的：它们这一 tick 还没动。
  const tiles: readonly TilePos[] = world.npcs
  let npcs = world.npcs.map(toNpcDraft)
  let dlg = toDialogueDraft(world.dialogue)
  let nar = toNarratageDraft(world.narratage)
  let base = world
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
  let rx = roleTile(d.px)
  let ry = roleTile(d.py)
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
  // 4. 检查出口（xl-9bd.12）。命中就**当场**换场景：原版的 `initiation` 是同步的，
  //    第 5 步之后的每一件事都已经发生在新场景里了。所以这里换掉 `base` 与四份
  //    草稿，下面第 5 步读的就是新世界 —— 不换的话，"走出门的那一 tick"会拿旧
  //    场景的对话数据再判一次，而那一 tick 在真值里看得见。
  const exited = checkExit(base, rx, ry, dlg, scenes)
  if (exited !== null) {
    base = exited
    Object.assign(d, toDraft(base.role))
    npcs = base.npcs.map(toNpcDraft)
    dlg = toDialogueDraft(base.dialogue)
    nar = toNarratageDraft(base.narratage)
    // 第 5 步读的是**换过场景之后**的主角坐标：原版 `checkLocationDialogue`
    // 现问 `scene.role.getX()`，而那时 role 已经是新场景里站在入口上的那一个。
    rx = roleTile(d.px)
    ry = roleTile(d.py)
  }
  // 5. 检查位置对话
  if (storyGateOpen(base, dlg, nar) && checkLocationDialogue(dlg, base.script, rx, ry, now)) {
    d.canStop = true
  }

  return {
    ...base,
    timeMs: now + dtMs,
    role: fromDraft(d),
    npcs: npcs.map(fromNpcDraft),
    dialogue: fromDialogueDraft(dlg),
    narratage: fromNarratageDraft(nar),
  }
}

/**
 * 换场景时"下一个场景的数据从哪来"。**同步**的，因为原版的
 * `ScenePanel.initiation` 是同步的：出口命中的那一 tick，第 5 步之后的每一件
 * 事都已经发生在新场景里了。异步取数据就得把这一 tick 掰成两半，而那一 tick
 * 在真值里看得见。
 *
 * 于是调用方要负责**在走到门口之前**把这个场景所有出口的目标准备好
 * （见 `game/useGame.ts` 的预取）。取不到就抛：静默不切场景的表现是"走到门口
 * 什么也没发生"，跟"这一格不是出口"一模一样。
 */
export type SceneSource = (file: string) => SceneScript | undefined

/** 没有传 `scenes` 时的占位：真踩到出口才抛，平时（96 个场景里 92 个有出口）不碍事。 */
const missingSceneSource: SceneSource = () => undefined

/**
 * `ScenePanel.step()` 第 4 步 + `ExitEvent.checkExit()`（xl-9bd.12）。
 *
 * 返回换好的新世界，没踩到出口就是 `null`。
 *
 * **第一个命中的出口就返回**。原版是两层 `for` 全部跑完，命中之后还接着比
 * 剩下的格子（用的是进函数时抓拍的那对坐标），所以理论上一 tick 能切两次场景。
 * 实测 96 个场景里 92 个有 `Exit` 段，出口格**无一重复**（`exit.test.ts` 拿
 * 烘焙产物现数一遍，重复了就红），所以第二次命中在今天的数据上不存在。
 *
 * 三条分支照抄原版，一个字不改：
 *
 * 1. 主线对话放完了、而且这个出口的目标就是 `nextScript` 指的那个场景
 *    → 剧情往前走一段：进 `nextScript[2]`，主角站在 `currentScript[0]`。
 * 2. 目标就是当前剧情所在的场景（也就是"走回去"）→ 重进
 *    `currentScript[2]` 那段剧情脚本，`isScript` 重新为真，主线对话的进度
 *    按走之前记下的 `savedOrder` 还原，**旁白被 `narratageOver` 压掉**
 *    （不然一回门口就再听一遍开场白）。
 * 3. 其余 → 进目标场景本身，`isScript` 置假。
 *
 * 分支 1/3 的落点是出口表里的 `entrance[i]`，分支 1 的落点是
 * `currentScript[0]`（`"66/15"` 这种写法）。
 */
function checkExit(
  world: World,
  x: number,
  y: number,
  dlg: ReturnType<typeof toDialogueDraft>,
  scenes: SceneSource,
): World | null {
  const table = world.exit
  if (table === null || table.blockedByBattle) return null
  for (let i = 0; i < table.exits.length; i++) {
    for (const tile of table.exits[i]!) {
      if (tile.x === x && tile.y === y) return applyExit(world, i, dlg, scenes)
    }
  }
  return null
}

function applyExit(
  world: World,
  i: number,
  dlg: ReturnType<typeof toDialogueDraft>,
  scenes: SceneSource,
): World {
  const table = world.exit!
  const target = table.nextScene[i]!
  // 记下走之前的对话进度。**在下面那句可能改写 currentScript 之前**读，
  // 原版就是这个次序。
  const savedOrder =
    target === world.currentScript[1] && !dlg.eventOver ? dlg.groupOrder : world.savedOrder
  const currentScript = dlg.eventOver ? (world.nextScript ?? EMPTY_SCRIPT) : world.currentScript
  const carry = { currentScript, savedOrder }

  // 1. 剧情往前走一段。
  if (dlg.eventOver && world.nextScript !== null && target === world.nextScript[1]) {
    const next = { ...enter(world, world.nextScript[2], scenes, i), ...carry, isScript: true }
    return atTile(next, parseEntrance(currentScript[0], world, i))
  }
  // 2. 走回当前这段剧情所在的场景。
  if (target === currentScript[1]) {
    const next = { ...enter(world, currentScript[2], scenes, i), ...carry, isScript: true }
    return atTile(
      {
        ...next,
        dialogue: { ...next.dialogue, groupOrder: savedOrder },
        // `narratage.narratageOver = true`：这段旁白已经听过了。
        narratage: { ...next.narratage, over: true },
      },
      table.entrance[i]!,
    )
  }
  // 3. 就是走进目标场景本身。
  const next = { ...enter(world, target, scenes, i), ...carry, isScript: false }
  return atTile(next, table.entrance[i]!)
}

/** `currentScript` 被 `nextScript` 覆盖而 `nextScript` 从来没有过时的那份空三元组。 */
const EMPTY_SCRIPT: readonly string[] = [];

/** 取下一个场景的数据并 `initiation` 进去。取不到是硬失败，理由见 `SceneSource`。 */
function enter(world: World, file: string | undefined, scenes: SceneSource, i: number): World {
  const scene = file === undefined ? undefined : scenes(file)
  if (scene === undefined) {
    throw new Error(
      `${world.scene} 的第 ${i} 个出口要进 ${String(file)}，但这个场景没准备好；` +
        `调用方要先把本场景所有出口的目标取到（见 state/step.ts 的 SceneSource）。`,
    )
  }
  return initiate(world, scene)
}

/** `role.setX(tile) / setY(tile)`：格子坐标乘 32。其余字段是刚建出来那个 Role 的初值。 */
function atTile(world: World, tile: TilePos): World {
  return { ...world, role: { ...world.role, px: tile.x * TILE, py: tile.y * TILE } }
}

/** `currentScript[0]` 是 `"66/15"` 这种写法（`ExitEvent` 里那两句 `split("/")`）。 */
function parseEntrance(spec: string | undefined, world: World, i: number): TilePos {
  const parts = (spec ?? '').split('/')
  const x = Number(parts[0])
  const y = Number(parts[1])
  if (parts.length !== 2 || !Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error(
      `${world.scene} 的第 ${i} 个出口要按剧情推进，但 currentScript[0] 不是 "x/y"：${String(spec)}`,
    )
  }
  return { x, y }
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
