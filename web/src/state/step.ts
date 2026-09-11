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
import { battleBgm } from '../battle/units'
import { normalizePath } from '../assets/path'
import {
  COL_BACKGROUND,
  advancesScript,
  checkBattle0,
  createFight,
  fromFightDraft,
  startBattle1,
  toFightDraft,
} from './fight'
import type { BattleInfo, FightDraft } from './fight'
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
import {
  checkSelectEvent,
  createSelect,
  fromSelectDraft,
  selectKeyPressed,
  tickSelectTimers,
  toSelectDraft,
} from './select'
import type { SelectDraft, SelectHost, SelectRecord } from './select'
import {
  checkBoxes,
  createTreasure,
  drawString,
  fromTreasureDraft,
  tickTreasureTimers,
  toTreasureDraft,
  treasureKeyPressed,
} from './treasure'
import type { TreasureDraft, TreasureGain } from './treasure'
import { fireDue } from './timer'
import { NO_REQUESTS, isArrowKey } from './types'
import type { CollisionMap, InputEvent, ReaderStaticFields, SceneRequests, TilePos, World } from './types'
import { readerStaticsFor } from '../data/readerStatics'
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
export function createWorld(scene: SceneScript, isScript = true, recorder: readonly SelectRecord[] = []): World {
  return { ...initiate(null, scene, recorder), isScript }
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
 *
 * `recorder` 只在 `prev` 为 `null` 时用：那两张答题表是 static，新开一局时（「起」）
 * 它们是上一局留下的（xl-i06.11，见 `game/session.ts` 的 `carryIntoNewGame`）。
 */
export function initiate(prev: World | null, scene: SceneScript, recorder: readonly SelectRecord[] = []): World {
  const script = dialogueScriptOf(scene)
  // `new SelectEvent(...)` 的构造函数会往那两张 static 表里登记一条，所以它
  // 同时产出一张**可能长了一条**的 recorder（见 `state/select.ts`）。
  const select = createSelect(scene, prev?.recorder ?? recorder)
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
    // FightEvent 同样是 initiation 里 new 出来的，所以 battle1Over 与
    // countOfBattle1 每换一个场景都回到起点（xl-rh9.17）。
    fight: createFight(scene),
    select: select.select,
    recorder: select.recorder,
    // `new EquipmentEvent(this, reader.getTreasureBox())` 排在 `new SelectEvent`
    // 之后，同样每次 initiation 都新建（xl-yg6.10）。
    treasure: createTreasure(scene),
    // 只亮一拍的输出，任何一个新建的世界里都是空的。
    ...NO_REQUESTS,
    showing: prev?.showing ?? true,
    sceneMusic: scene.sceneMusic,
    // `GameLauncher.SCENE_SIGNAL` 是 static，`initiation` 不碰它。
    sceneSignal: prev?.sceneSignal ?? false,
    readerStatics: readerStaticsAfter(prev, scene),
    // `else if (sal.isLoad) { …; sal.isLoad = false; }`：只有无对话编号的场景清它（见 `World.isLoad`）。
    isLoad: script.code !== null && (prev?.isLoad ?? false),
  }
}

/**
 * `new Reader(fileName)` 读完之后那几个静态字段的样子（见 `World.readerStatics`）。
 * `mapName` 恒被改写；`Task` / `Role` 两段缺席就留着上一个场景的（没有上一个
 * 就是原版字段初值）。
 */
function readerStaticsAfter(prev: World | null, scene: SceneScript): ReaderStaticFields {
  const read = readerStaticsFor(scene.script)
  const before = prev?.readerStatics
  const role = read.role
  return {
    mapName: scene.mapName,
    task: read.task ?? before?.task ?? null,
    zhang: role ? role[0] : (before?.zhang ?? false),
    lu: role ? role[1] : (before?.lu ?? false),
    wen: role ? role[2] : (before?.wen ?? false),
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
 *
 * **例外是读档之后**（`else if (sal.isLoad)` 那一支，xl-i06.11）：`isLoad` 还亮着时，没有
 * `Dialogue` 段的场景也新建一份（编号为 null → `eventOver` 为真、进度 0），不带上一份。
 */
function carryDialogue(prev: World | null, script: DialogueScript): DialogueState {
  const fresh = createDialogue(script)
  if (prev === null || script.code !== null || prev.isLoad) return fresh
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
 *
 * `random` 是 `Math.random()` 的替身。读它的有三处：计步战斗挑场次
 * （`FightEvent.startBattle0`）、答对答错的加扣金币（`SelectEvent.keyPressed`，
 * xl-yg6.8）、开箱给几个（`TreasureBox.keyPressed`，xl-yg6.10）。做成入参是
 * 为了这几个数能被断言：默认值就是 `Math.random`，所以生产路径一个字都不变。
 */
export function step(
  world: World,
  input: readonly InputEvent[],
  dtMs: number,
  scenes: SceneSource = missingSceneSource,
  random: () => number = Math.random,
): World {
  const now = world.timeMs
  const d = toDraft(world.role)
  let npcs = world.npcs.map(toNpcDraft)
  let dlg = toDialogueDraft(world.dialogue)
  let nar = toNarratageDraft(world.narratage)
  let fight = toFightDraft(world.fight)
  let sel = toSelectDraft(world.select, world.recorder)
  let tre = toTreasureDraft(world.treasure)
  let base = world
  /**
   * 这一拍的请求（`SceneRequests`）。**每一拍都从全 `null` 起**，返回时整个
   * 铺回世界上 —— 上一拍亮过的，这一拍一定熄。战斗一拍最多起一场。
   */
  const req: { -readonly [K in keyof SceneRequests]: SceneRequests[K] } = { ...NO_REQUESTS }

  /**
   * **换过场景之后，手上这几份草稿全部作废** —— 一份一份从新的 `base` 重摊。
   *
   * 一个 tick 里有两处会换场景（起一场推进剧情的战斗、走出一道门），两处摊的
   * 必须是同一批草稿：漏掉一份的表现是"那一层还留在上一个场景里"，而画面上
   * 只是"走回宿舍时进的场景不对"。抽成一处，加一份新草稿时就不会只加到其中
   * 一边 —— 这一票加 `sel` 时原本正是要往两处各加一行。
   *
   * `d` 是 `Object.assign` 而不是重新赋值：它是 `const`，而下面每一处都在就地
   * 改它。
   */
  const resync = (): void => {
    Object.assign(d, toDraft(base.role))
    npcs = base.npcs.map(toNpcDraft)
    dlg = toDialogueDraft(base.dialogue)
    nar = toNarratageDraft(base.narratage)
    fight = toFightDraft(base.fight)
    sel = toSelectDraft(base.select, base.recorder)
    tre = toTreasureDraft(base.treasure)
  }

  /**
   * `FightEvent.fight()` 开头那两句跨世界的动作：**打赢会推进剧情的那几场**
   * 先 `exitEvent.nextScript()` 把整个场景换掉，然后 `role.setEvent(true)`。
   */
  const requestBattle = (info: BattleInfo): void => {
    req.battleRequest = info
    if (advancesScript(info)) {
      base = nextScriptAdvance(base, scenes)
      resync()
    }
    // `GameLauncher.battlePanel.initial(fileName, ...)` 排在 `nextScript()` 之后：
    // 它先 `normalizePath` 再按背景图 `readBGM(...)`（xl-yg6.11）。
    // `MusicPlayer.currentPlayingBGM` 是全局的，所以**场景这一列跟着变**
    // （真值 `battle-door` 记着）。那个 switch 没有 default，认不出的背景一首
    // 都不换 —— 于是这里是"换或不换"，不是"换成 null"。
    const bgm = battleBgm(normalizePath(info[COL_BACKGROUND] ?? ''))
    if (bgm !== null) base = { ...base, audio: { bgm } }
    // `scene.role.setEvent(true)` —— 起战斗就松手，回来时主角不会接着走。
    d.canStop = true
  }

  /**
   * 选择框那三件跨对象的动作（见 `state/select.ts` 的 `SelectHost`）。
   * 三件都**明写在这里**，一件都不静默丢：`fight` 走场景已有的那条路，
   * 另外两件做成只亮一拍的输出，各自归后面那两张票。
   */
  const host: SelectHost = {
    fight: (info) => requestBattle(info),
    switchTo: (panel) => {
      req.selectPanelRequest = panel
    },
    present: (request) => {
      req.presentRequest = request
      // `Money.addCoins/reduceCoins` 之后紧跟的那句
      // `scene.equipmentEvent.drawString(...)`：提示框当拍就弹（xl-yg6.10）。
      drawString(tre, request.text, now)
    },
    random,
  }
  /** 开箱开出来的东西。一拍里按两下空格、或一下开两个箱子，都往后接。 */
  const gain = (gains: readonly TreasureGain[]): void => {
    if (gains.length > 0) req.treasureRequest = [...(req.treasureRequest ?? []), ...gains]
  }

  for (const event of input) {
    const info = applyInput(base, d, dlg, fight, sel, tre, event, now, host, gain, () => {
      req.endRequest = true
    })
    if (info !== null) requestBattle(info)
  }

  const script = base.script
  // NPC 的格子坐标在主角的定时器跑完之前是冻住的：它们这一 tick 还没动。
  const tiles: readonly TilePos[] = base.npcs

  fireDue(d.run, now, ROLE_TIMER_MS, () => tickRun(d, world.collision, tiles), '跑步定时器')
  fireDue(d.walk, now, ROLE_TIMER_MS, () => tickWalk(d, world.collision, tiles), '走路定时器')
  tickDialogueTimers(dlg, now)
  tickNarratageTimers(nar, now)
  // 选择框的三个定时器排在旁白之后、NPC 之前 —— 导出器 `installTimers` 的
  // 根对象名单里 `sp.selectEvent` 就在 `sp.narratage` 与 `sp.npcs` 之间。
  tickSelectTimers(sel, now)
  // 提示框的两个定时器紧跟在选择框之后：根对象名单里 `sp.equipmentEvent` 就排在
  // `sp.selectEvent` 后面、`sp.npcs` 前面（xl-yg6.10）。⚠️ 今天的真值分辨不出
  // 这个落点：整组挪到 NPC 之后，篡改矩阵两边都绿（见 `treasure.test.ts`）。
  tickTreasureTimers(tre, now)
  for (const npc of npcs) tickNpcTimers(npc, now)

  // ——— `ScenePanel.step()` ———
  // 主角的位置取**定时器跑完之后**的：原版就是这个次序。
  // 第 4 步（出口）、第 6 步（宝箱）、第 7 步（计步战斗）各是别的票。
  let rx = roleTile(d.px)
  let ry = roleTile(d.py)
  // 1. 检查旁白。它在第 2/3/5 步之前，所以**起旁白的那一 tick 就已经把后面
  //    三道门关上了**——真值第 0 tick 记的就是 active。
  // 第 1 步比第 2/3/5 步多一个条件：`currentPanel.equals(scenePanel)`。
  // 战斗期间场景那条线程照跑，但旁白不查（xl-rh9.17）。
  checkNarratage(nar, base.showing && base.isScript, now)
  // 2. 检查自动的对话（进场就播的那一段，触发码写着 -1）
  if (storyGateOpen(base, dlg, nar) && checkAutoDialogue(dlg, script, now)) {
    // `startSpeak` 里那句 `scene.role.setEvent(true)`：开口就松手。
    d.canStop = true
  }
  // 3. 检查 NPC
  if (!dlg.speaking && !nar.active) checkNpcStop(npcs, rx, ry, now)
  // 4. 检查出口（xl-9bd.12）。命中就**当场**换场景：原版的 `initiation` 是同步的，
  //    第 5 步之后的每一件事都已经发生在新场景里了。所以这里换掉 `base` 与四份
  //    草稿，下面第 5 步读的就是新世界 —— 不换的话，"走出门的那一 tick"会拿旧
  //    场景的对话数据再判一次，而那一 tick 在真值里看得见。
  const exited = checkExit(base, fight, rx, ry, dlg, scenes)
  if (exited !== null) {
    base = exited
    resync()
    // 第 5 步读的是**换过场景之后**的主角坐标：原版 `checkLocationDialogue`
    // 现问 `scene.role.getX()`，而那时 role 已经是新场景里站在入口上的那一个。
    rx = roleTile(d.px)
    ry = roleTile(d.py)
  }
  // 5. 检查位置对话
  if (storyGateOpen(base, dlg, nar) && checkLocationDialogue(dlg, base.script, rx, ry, now)) {
    d.canStop = true
  }

  // 6. 检查宝箱（xl-yg6.10）。`if (reader.getTreasureBox() != null)` 那道门就是
  //    `boxes !== null`，在 `checkBoxes` 里。读的是**第 4 步换过场景之后**的
  //    坐标与草稿 —— 原版 `role.getX()` 是现问的。
  checkBoxes(tre, rx, ry)
  // 7. 检查计步战斗（xl-rh9.17）。**这一拍已经起过一场就不再查**：原版一拍
  //    里 `startBattle1()` 与 `checkBattle0()` 确实都可能跑到，但两者都调
  //    `battlePanel.initial(...)`，后一场会把前一场整个盖掉，而面板只切一次。
  //    今天到不了（有 `@` 的 12 个脚本与有 `battle0` 的 4 个场景不相交），
  //    所以这不是"照抄"，是**一条明写出来的取舍**：起两场只能留一场。
  if (fight.battle0 !== null && req.battleRequest === null) {
    const info = checkBattle0(fight, rx, ry, random)
    if (info !== null) requestBattle(info)
  }
  // `if (GameLauncher.SCENE_SIGNAL == 1) { readBGM(reader.getSceneMusic()); SCENE_SIGNAL = 0; }`
  // —— 第 7 步之后、`repaint()` 之前（xl-yg6.11）。从战斗 / 商店 / 菜单回来，
  // 把场景自己的曲子放回去；读的是**第 4 步换过场景之后**的那一首。
  if (base.sceneSignal) {
    base = { ...base, audio: { bgm: base.sceneMusic }, sceneSignal: false }
  }

  return {
    ...base,
    timeMs: now + dtMs,
    role: fromDraft(d),
    npcs: npcs.map(fromNpcDraft),
    dialogue: fromDialogueDraft(dlg),
    narratage: fromNarratageDraft(nar),
    fight: fromFightDraft(fight),
    select: fromSelectDraft(sel),
    recorder: sel.recorder,
    treasure: fromTreasureDraft(tre),
    ...req,
  }
}

/**
 * `ExitEvent.nextScript()`：剧情往前推一段。
 *
 * 四句照抄：`currentScript = nextScript` → `initiation(nextScript[2])` →
 * `isScript = true` → 主角站到 `currentScript[0]`（`"66/15"` 那种写法）。
 *
 * 出口那一路（`applyExit` 的分支 1）做的是同一件事，但它是**先换场景再赋
 * currentScript**，落点也一样。两处没有合并：原版是两个方法，而合并之后
 * 「哪一处先赋值」这个差别就再也读不出来了。
 */
function nextScriptAdvance(world: World, scenes: SceneSource): World {
  const ns = world.nextScript
  if (ns === null) {
    throw new Error(
      `${world.scene} 里这一场要推进剧情（FightEvent.fight 那串一号位判断），` +
        '可 nextScript 是空的 —— 原版这里是空指针。',
    )
  }
  const next = { ...enter(world, ns[2], scenes, 'NextScript'), currentScript: ns, isScript: true }
  return atTile(next, parseEntrance(ns[0], world, 'NextScript'))
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
  fight: FightDraft,
  x: number,
  y: number,
  dlg: ReturnType<typeof toDialogueDraft>,
  scenes: SceneSource,
): World | null {
  const table = world.exit
  // 剧情固定战不止一场的场景，要全打完（`battle1Over`）才轮到查出口。
  // 读的是**这一拍的草稿**：同一拍里刚按完最后一段对话把它置真的话，
  // 出口这一拍就已经开了 —— 原版的 `startBattle1()` 也在第 4 步之前。
  if (table === null || (table.needsBattle1Over && !fight.battle1Over)) return null
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
function enter(
  world: World,
  file: string | undefined,
  scenes: SceneSource,
  where: number | string,
): World {
  const scene = file === undefined ? undefined : scenes(file)
  if (scene === undefined) {
    throw new Error(
      `${world.scene} 的第 ${where} 个出口要进 ${String(file)}，但这个场景没准备好；` +
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
function parseEntrance(spec: string | undefined, world: World, where: number | string): TilePos {
  const parts = (spec ?? '').split('/')
  const x = Number(parts[0])
  const y = Number(parts[1])
  if (parts.length !== 2 || !Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error(
      `${world.scene} 的第 ${where} 个出口要按剧情推进，但 currentScript[0] 不是 "x/y"：${String(spec)}`,
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
 * **选择框（xl-yg6.8）**在原版里占两处，位置都要紧：
 *
 * - 方向键那一支外面套着 `if (!selectEvent.isSelect)` —— 选择框开着就走不动，
 *   同一下方向键归光标。⚠️ 它套在 `checkRun()` **外面**，所以选择框开着时
 *   连"按住 Ctrl 起跑"都不发生；
 * - `if (selectEvent.isSelect) selectEvent.keyPressed(keyCode)` 排在
 *   `checkNPCOral()` **之后** —— 于是弹出选择框的那一下空格，会紧接着又被
 *   选择框自己收一次（`isAnswer` 时那一下就把回答框关掉了）。
 *
 * **宝箱（xl-yg6.10）**那一行 `equipmentEvent.keyPressed(keyCode)` 排在
 * `checkNPCOral()` 之后、`selectEvent.keyPressed` 之前，同在
 * `if (!npcEvent.isOral)` 那一支里。它只认空格，所以方向键那一支与它不打架。
 *
 * ESC 进菜单是别的票，那一行在原版里与这里的分支并列，不影响这几条的先后。
 */
function applyInput(
  world: World,
  d: ReturnType<typeof toDraft>,
  dlg: ReturnType<typeof toDialogueDraft>,
  fight: FightDraft,
  sel: SelectDraft,
  tre: TreasureDraft,
  event: InputEvent,
  now: number,
  host: SelectHost,
  gain: (gains: readonly TreasureGain[]) => void,
  end: () => void,
): BattleInfo | null {
  if (event.e === 'release') {
    // `ScenePanel.keyReleased` 的 switch 只有四个方向键的分支。
    if (isArrowKey(event.k)) d.canStop = true
    return null
  }
  if (world.narratage.active) return null

  // 回车有两个身份。**选择框开着时它是原版的确认键**（往下走，交给
  // `SelectEvent.keyPressed`）；没开着时它是那个加出来的"跳过逐字打印"
  // （原版没有这个键，见 `dialogue.ts` 的 `skipPrinting`）。
  //
  // 两者不会打架，而这是**数出来的**：11 条场景真值里一共 13 次回车，
  // **没有一次**落在选择框之外（判据取的是上一拍末的 `select.active`，
  // 也就是按键真正到达的那个时刻 —— 取本拍的快照会把"这一下正好把框关掉"
  // 误判成"落在框外"）。所以这条分支一次都碰不到真值管着的行为。
  if (event.k === 'enter' && !sel.isSelect) {
    skipPrinting(dlg, now)
    return null
  }

  const space = event.k === 'space'
  if (dlg.speaking) {
    if (space) pressSpace(dlg, world.script, world.npcs, now)
    // `DialogueEvent.keyPressed` 那三句：**这一按把一段对话按完了**
    // （`isSpeaking` 由真转假）而正文里有过 `@`（`dialogueFight`），
    // 就在这里起剧情固定战，并把标志清掉。
    //
    // 判据是"speaking 由真转假"，不是"groupOver 为真" —— `groupOver` 在
    // 最后一句打完的那一按之前就已经是真的了，拿它当条件会**早一按**起战斗，
    // 而早的那一按画面上什么都看不出来（对话框还开着）。
    //
    // 结局（xl-czb.6）是紧挨着的另一句：`if (gameOver) { switchTo("end"); gameOver = false; }`，
    // 同一个判据、同一个「清标志」。它排在剧情战**之前**写，是因为下面那一支会 return；
    // 原版两句都执行，先起战斗后切结局 —— 同一段对话里既有 `@` 又有 `$` 的，全部 96 本
    // 脚本里一段都没有（`$` 只出现在 脚本41 的对话里，那一本一个 `@` 都没有；
    // `end/trigger.test.ts` 现扫），所以两句的先后这里观测不到。
    if (dlg.gameOver && !dlg.speaking) {
      dlg.gameOver = false
      end()
    }
    if (dlg.fight && !dlg.speaking) {
      dlg.fight = false
      return startBattle1(fight)
    }
    return null
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
    return null
  }
  if (isArrowKey(event.k)) {
    if (!sel.isSelect) {
      // 原版 `ScenePanel.keyPressed`：先 `checkRun()`（只做 setRun(true)），
      // 再 `switchWalk()`。按住控制键**只在按下方向键的那一刻**置位跑步，
      // 松开控制键什么也不做——跑步是在跑步定时器停下时自己清掉的。
      if (event.ctrl) d.running = true
      pressDirection(d, event.k, now)
    }
  } else if (space && !started) {
    checkNpcOral(dlg, world.npcs, roleTile(d.px), roleTile(d.py), now, (npcNo) =>
      checkSelectEvent(sel, npcNo, now),
    )
  }
  // `if (reader.getTreasureBox() != null) equipmentEvent.keyPressed(keyCode)`。
  // 随机数与选择框加扣金币共用同一个 `random`：两者一个只认空格、一个只认回车，
  // 同一下按键里不会都掷骰。
  gain(treasureKeyPressed(tre, event.k, now, host.random))
  // `if (selectEvent.isSelect) selectEvent.keyPressed(keyCode)` —— 排在最后，
  // 而且读的是**刚刚可能被 `checkNPCOral` 打开的**那个 `isSelect`。
  if (sel.isSelect) selectKeyPressed(sel, event.k, now, host)
  return null
}
