/**
 * 对话层：对话框、逐字打印、头像（xl-9bd.10）。
 *
 * 一处照抄三个原版类，**不重新设计**——它们互相调用得很紧，拆开会立刻长出一层
 * 翻译，而翻译层正是错位的来源：
 *
 * | 这里 | 原版 |
 * |---|---|
 * | `DialogueState` 的"对话框"那一段 | `scene/Dialogue.java`（6 个定时器 + 4×20 的字符缓冲） |
 * | "主线对话"那一段 | `scene/DialogueEvent.java`（哪一段、第几句、什么时候结束） |
 * | "口头语"那一段 | `scene/NPCEvent.java` 的 `isOral` 那几个字段 |
 *
 * ## 为什么这一层的每个字段都能断言
 *
 * `tools/traces/out/*.trace.json` 的每一 tick 都记着原版此刻的
 * `type / headNo / name / currentSentence / count_sentence / count_row /
 * count_col / isPrint / isSentenceOver / isBufferedTextOver`。这一层的字段就是
 * 那十个，一个不多一个不少，于是"逐字打印的速度对不对"不是看一眼画面，而是
 * `traceReplay.test.ts` 里逐 tick 的相等断言（dorm-walk 的口头语、dorm-intro
 * 的 23 句主线对话，含一次翻页）。
 *
 * ## 这一层**不做**渲染
 *
 * 对话框是真 DOM（`ui/DialogueBox.tsx`），不画进画布。原版把界面画进画布是
 * 当年 Swing 组件太丑的历史包袱，不是要继承的设计。但**摆位仍然是状态**：
 * 弹出动画（对话框滑入、头像/名字牌滑入）由三个定时器驱动，滑到位才开始打字
 * ——`isPrint` 什么时候变真，取决于滑了多少拍。dorm-walk 里那是 52 个 tick，
 * 差一拍逐字游标就整条错位。所以 `boxX/boxY/headX/nameX` 留在状态里，
 * 渲染层只读它们。
 */
import type { SceneScript } from '../data/types'
import { startTimer, stopTimer } from './timer'
import type { MutableTimer } from './timer'
import type { NpcState } from './npc'
import type { TimerState } from './types'

/** 一屏的规格。原版 `Dialogue.maxRow/maxCol`。 */
export const MAX_ROW = 4
export const MAX_COL = 20

/**
 * 六个定时器的间隔（毫秒），照抄 `Dialogue` 的构造函数。
 *
 * **键的顺序就是触发顺序**，而且不是随手排的：trace 导出器
 * （`ExportTrace.installTimers`）按 `Class.getDeclaredFields()` **排序后的字段名**
 * 装表，于是同一个 tick 里到期的定时器按字段名的字典序触发。这里的键名就是
 * 原版的字段名，顺序也就是那个字典序 —— 换个顺序，同一 tick 内互相 start()
 * 的那几拍就会错位（`dialogueMoveLeft` 的最后一拍会 start `nameRun`）。
 */
export const DIALOGUE_TIMER_MS = {
  dialogueMoveLeft: 20,
  dialogueMoveRight: 20,
  headRun: 10,
  icon1Run: 500,
  nameRun: 10,
  wordsRun: 30,
} as const

export type DialogueTimerName = keyof typeof DIALOGUE_TIMER_MS

/** 按字段名字典序的定时器名单。分母从 `DIALOGUE_TIMER_MS` 数，不另抄一份。 */
export const DIALOGUE_TIMER_NAMES = Object.keys(DIALOGUE_TIMER_MS).sort() as DialogueTimerName[]

const STOPPED: TimerState = { running: false, dueMs: 0 }

/**
 * 这个场景里跟对话有关的那部分脚本数据。
 *
 * 从 `SceneScript` 里挑出来存进 `World`，而不是让 `step()` 每次去翻整份脚本：
 * 状态推进是纯函数，它要的东西必须都在世界里。
 */
export interface DialogueScript {
  /**
   * `ScenePanel.isScript`：这个场景是"剧情脚本"还是普通场景。
   * `false` 时旁白、自动对话、位置对话、按空格触发的主线对话全部跳过 ——
   * 从大地图走进宿舍时原版就是这个状态（见 `docs/trace-format.md`）。
   */
  readonly isScript: boolean
  /** `Reader.dialogueCode`。`null` = 这个脚本没有 `Dialogue` 段。 */
  readonly code: readonly string[] | null
  /** `Reader.dialogue`：`[段][句] = [样式, 头像号或名字, 正文]`。 */
  readonly groups: readonly (readonly (readonly string[])[])[] | null
  /**
   * `SelectEvent.checkSelectEvent` 会截胡的那些 NPC 序号。
   *
   * 选择框本身是另一张票，但**这里必须知道它会截胡**：原版
   * `NPCEvent.checkNPCOral` 是 `if (!selectEvent.checkSelectEvent(i)) sayOral(i)`，
   * 漏掉这一句，走到商店大爷跟前按空格，Web 版会弹一句口头语而原版弹的是
   * "要不要进商店"。那是"多了个对话框"，不是"少了个面板"，肉眼分不出对错。
   *
   * 名单从四段选择数据的第 0 列现算（`haveFighted` / `haveAnswered` 都是
   * 进场时的全 false），不写死。
   */
  readonly selectNpcs: readonly number[]
}

/**
 * 对话的全部状态。三段，分别对应 `Dialogue` / `DialogueEvent` / `NPCEvent`。
 *
 * 字段名跟 trace 的 `dialogue` 对象对齐（`cursor` = `count_sentence`、
 * `row/col` = `count_row/count_col`、`printing` = `isPrint`、
 * `pageOver` = `isBufferedTextOver`），比对时不必再翻译一道。
 */
export interface DialogueState {
  // ——— Dialogue：对话框本身 ———
  /** 0 = 头像式（右下角大框 + 224×224 头像），1 = 名字式（居中窄框 + 名字牌）。 */
  readonly type: number
  /** `heads` 这个 ArrayList 的下标，不是文件编号（文件从 1 开始，见 `headAssetId`）。 */
  readonly headNo: number
  /**
   * 名字式对话框上的名字。**换成头像式时不会被清掉** —— `showSentence` 只在
   * `type == 1` 的分支里赋值。真值里看得见：脚本1 从第 6 句起 `name` 一直是
   * `曾书书:`，哪怕后面十几句都是头像式的。照抄，不"顺手修好"。
   */
  readonly name: string | null
  /** 当前这一句的全文。逐字打印的源。 */
  readonly sentence: string | null
  /** 打到第几个字（`count_sentence`）。**翻页不清零**，它是整句的游标。 */
  readonly cursor: number
  readonly row: number
  readonly col: number
  /** `isPrint`：弹出动画播完、开始打字了。它为假时对话框在滑入，正文不画。 */
  readonly printing: boolean
  /** `isSentenceOver`：这一句打完了，等玩家按空格。 */
  readonly sentenceOver: boolean
  /** `isBufferedTextOver`：一屏 4×20 打满了，等玩家翻页。 */
  readonly pageOver: boolean
  /** 4×20 的字符缓冲。`null` = 这一格还没打到（原版是 `char` 的 0）。 */
  readonly text: readonly (readonly (string | null)[])[]
  /** 等待提示的小图标在闪第几帧（`count_icon1`，0/1）。 */
  readonly iconFrame: number
  /** 对话框、头像、名字牌的当前位置。弹出动画的中间态，渲染层只读。 */
  readonly boxX: number
  readonly boxY: number
  readonly headX: number
  readonly headY: number
  readonly nameX: number
  readonly nameY: number
  readonly timers: Readonly<Record<DialogueTimerName, TimerState>>

  // ——— DialogueEvent：主线对话 ———
  /** `isSpeaking`。`ScenePanel.step()` 第 3 步那道门读的就是它。 */
  readonly speaking: boolean
  /** `dialogueOver`：这一段的最后一句也按过了，再按一次就收框。 */
  readonly groupOver: boolean
  /** `dialogueEventOver`：这个场景的主线对话全放完了（或者压根没有）。 */
  readonly eventOver: boolean
  readonly groupOrder: number
  readonly sentenceOrder: number
  /** 正文里出现过 `@` / `$`：触发剧情战 / 游戏结束。都是别的票，这里只记着。 */
  readonly fight: boolean
  readonly gameOver: boolean

  // ——— NPCEvent：NPC 口头语 ———
  /** `isOral`。它为真时方向键整个失效（`ScenePanel.keyPressed` 的那层 else）。 */
  readonly oral: boolean
  readonly oralOver: boolean
  /**
   * 说到这个 NPC 的第几句口头语。
   *
   * **它不随说话对象重置**，原版就是这样：`oralCount` 是 `NPCEvent` 的字段，
   * `sayOral` 只在句子说完时才把它清零。所以先跟一个有两句口头语的 NPC 说到
   * 一半、再去跟另一个说，会从第二句开始。照抄，不修。
   */
  readonly oralCount: number
  readonly oralNpc: number
}

/** 一个空的 4×20 缓冲。 */
function emptyText(): (string | null)[][] {
  return Array.from({ length: MAX_ROW }, () => Array.from({ length: MAX_COL }, () => null))
}

/**
 * 进场时的对话状态。全部是 Java 的字段默认值 —— `type = 0`、`headNo = 0`、
 * `name`/`currentSentence` 为 `null`、六个定时器都没启动。
 *
 * `eventOver` 的初值是 `DialogueEvent` 构造函数里那句
 * `if (dialogueCode == null) dialogueEventOver = true`。
 */
export function createDialogue(script: DialogueScript): DialogueState {
  return {
    type: 0,
    headNo: 0,
    name: null,
    sentence: null,
    cursor: 0,
    row: 0,
    col: 0,
    printing: false,
    sentenceOver: false,
    pageOver: false,
    text: emptyText(),
    iconFrame: 0,
    boxX: 0,
    boxY: 0,
    headX: 0,
    headY: 0,
    nameX: 0,
    nameY: 0,
    timers: Object.fromEntries(
      DIALOGUE_TIMER_NAMES.map((name) => [name, STOPPED]),
    ) as Record<DialogueTimerName, TimerState>,
    speaking: false,
    groupOver: false,
    eventOver: script.code === null,
    groupOrder: 0,
    sentenceOrder: 0,
    fight: false,
    gameOver: false,
    oral: false,
    oralOver: false,
    oralCount: 0,
    oralNpc: 0,
  }
}

/**
 * 从一份烘焙好的场景脚本取出对话要用的那几段。
 *
 * `isScript` 由调用方给：它是 `ScenePanel` 的字段，不在脚本数据里
 * （`trace` 的剧本头里有，游戏里由"怎么进的这个场景"决定）。
 */
export function dialogueScriptOf(scene: SceneScript, isScript: boolean): DialogueScript {
  return {
    isScript,
    code: scene.dialogueCode,
    groups: scene.dialogue,
    selectNpcs: selectNpcsOf(scene),
  }
}

/**
 * `SelectEvent.checkSelectEvent` 里被拿去跟 NPC 序号比的那几个数：四段选择
 * 数据各自的第 0 列。进场时 `haveFighted` / `haveAnswered` 全是 false，
 * 所以每一条都还生效。
 */
function selectNpcsOf(scene: SceneScript): number[] {
  const rows: (readonly string[] | undefined)[] = [
    scene.selectShopPanel ?? undefined,
    scene.selectEquipmentShopPanel ?? undefined,
    ...(scene.selectBattlePanel ?? []),
    ...(scene.selectQuestion ?? []),
  ]
  const npcs: number[] = []
  for (const row of rows) {
    const head = row?.[0]
    if (head === undefined) continue
    const n = Number.parseInt(head, 10)
    // 原版这里是 Integer.parseInt，解不出来就是异常。数据里没有这种情况
    // （96 个脚本实测），解不出来时宁可不截胡也不悄悄当成 0 —— 0 是一个真实的
    // NPC 序号，当成 0 会让第一个 NPC 莫名其妙说不了话。
    if (Number.isInteger(n)) npcs.push(n)
  }
  return npcs
}

// ============================ 草稿 ============================

/** `step()` 期间的可变镜像。改完再冻回 `DialogueState`。 */
export interface DialogueDraft {
  type: number
  headNo: number
  name: string | null
  sentence: string | null
  cursor: number
  row: number
  col: number
  printing: boolean
  sentenceOver: boolean
  pageOver: boolean
  text: (string | null)[][]
  iconFrame: number
  boxX: number
  boxY: number
  headX: number
  headY: number
  nameX: number
  nameY: number
  timers: Record<DialogueTimerName, MutableTimer>
  speaking: boolean
  groupOver: boolean
  eventOver: boolean
  groupOrder: number
  sentenceOrder: number
  fight: boolean
  gameOver: boolean
  oral: boolean
  oralOver: boolean
  oralCount: number
  oralNpc: number
}

export function toDialogueDraft(d: DialogueState): DialogueDraft {
  return {
    type: d.type,
    headNo: d.headNo,
    name: d.name,
    sentence: d.sentence,
    cursor: d.cursor,
    row: d.row,
    col: d.col,
    printing: d.printing,
    sentenceOver: d.sentenceOver,
    pageOver: d.pageOver,
    text: d.text.map((row) => [...row]),
    iconFrame: d.iconFrame,
    boxX: d.boxX,
    boxY: d.boxY,
    headX: d.headX,
    headY: d.headY,
    nameX: d.nameX,
    nameY: d.nameY,
    timers: Object.fromEntries(
      DIALOGUE_TIMER_NAMES.map((name) => [name, { ...d.timers[name] }]),
    ) as Record<DialogueTimerName, MutableTimer>,
    speaking: d.speaking,
    groupOver: d.groupOver,
    eventOver: d.eventOver,
    groupOrder: d.groupOrder,
    sentenceOrder: d.sentenceOrder,
    fight: d.fight,
    gameOver: d.gameOver,
    oral: d.oral,
    oralOver: d.oralOver,
    oralCount: d.oralCount,
    oralNpc: d.oralNpc,
  }
}

export function fromDialogueDraft(d: DialogueDraft): DialogueState {
  return {
    type: d.type,
    headNo: d.headNo,
    name: d.name,
    sentence: d.sentence,
    cursor: d.cursor,
    row: d.row,
    col: d.col,
    printing: d.printing,
    sentenceOver: d.sentenceOver,
    pageOver: d.pageOver,
    text: d.text.map((row) => [...row]),
    iconFrame: d.iconFrame,
    boxX: d.boxX,
    boxY: d.boxY,
    headX: d.headX,
    headY: d.headY,
    nameX: d.nameX,
    nameY: d.nameY,
    timers: Object.fromEntries(
      DIALOGUE_TIMER_NAMES.map((name) => [name, { ...d.timers[name] }]),
    ) as Record<DialogueTimerName, TimerState>,
    speaking: d.speaking,
    groupOver: d.groupOver,
    eventOver: d.eventOver,
    groupOrder: d.groupOrder,
    sentenceOrder: d.sentenceOrder,
    fight: d.fight,
    gameOver: d.gameOver,
    oral: d.oral,
    oralOver: d.oralOver,
    oralCount: d.oralCount,
    oralNpc: d.oralNpc,
  }
}

/** 对话框（主线或口头语）正显示着。原版 `dialogueEvent.isSpeaking || npcEvent.isOral`。 */
export function dialogueActive(d: DialogueState): boolean {
  return d.speaking || d.oral
}

// ============================ Dialogue ============================

/**
 * `Dialogue.showSentence`：换一句话，重新播弹出动画。
 *
 * `sentenceInfo` 就是脚本里按 `/` 切开的三段 `[样式, 头像号或名字, 正文]`；
 * 口头语那一路由 `NPCEvent.sayOral` 现拼一个 `["1", NPC 名, 那一句]`。
 */
export function showSentence(d: DialogueDraft, info: readonly string[], now: number): void {
  d.cursor = 0
  d.row = 0
  d.col = 0
  d.text = emptyText()
  d.sentence = info[2] ?? null
  d.type = Number.parseInt(info[0] ?? '0', 10)
  if (d.type === 0) {
    d.headNo = Number.parseInt(info[1] ?? '0', 10)
    d.boxX = 160
    d.boxY = 480
    d.headX = 1024
    d.headY = 416
  } else if (d.type === 1) {
    d.name = info[1] ?? null
    d.nameX = -192
    d.nameY = 0
    d.boxX = 752
    d.boxY = 192
  }
  if (d.type === 0) startTimer(d.timers.dialogueMoveRight, now, DIALOGUE_TIMER_MS.dialogueMoveRight)
  else if (d.type === 1)
    startTimer(d.timers.dialogueMoveLeft, now, DIALOGUE_TIMER_MS.dialogueMoveLeft)
  d.pageOver = false
  d.sentenceOver = false
  d.printing = false
}

/** `Dialogue.begin()`：翻页。**`cursor` 不清零** —— 它是整句的游标。 */
export function beginPage(d: DialogueDraft, now: number): void {
  if (d.sentenceOver) return
  d.text = emptyText()
  d.pageOver = false
  stopTimer(d.timers.icon1Run)
  d.row = 0
  d.col = 0
  startTimer(d.timers.wordsRun, now, DIALOGUE_TIMER_MS.wordsRun)
}

/**
 * 逐字打印的一拍（`Dialogue.timerWordsRun`）。
 *
 * 三条出路：写一个字 / 换行 / 这一屏满了（`pageOver`）；句子打完是
 * `sentenceOver`。后两者都停表并起等待提示的闪烁。
 *
 * `@` 与 `$` 在原版是**画的时候**才被认出来的（`drawDialogue` 里那两个
 * `continue`），这里在写进缓冲的时候就认。差别是零个 tick：原版每个 tick 都
 * `paint()` 一次，而这两个标志一旦置真就不会再变回去，读它的
 * `DialogueEvent.keyPressed` 隔着好几十个 tick。
 */
function tickWords(d: DialogueDraft, now: number): void {
  const sentence = d.sentence ?? ''
  if (d.cursor < sentence.length) {
    if (d.col < MAX_COL) {
      writeChar(d, sentence.charAt(d.cursor))
      return
    }
    d.row++
    d.col = 0
    if (d.row < MAX_ROW) {
      writeChar(d, sentence.charAt(d.cursor))
      return
    }
    d.pageOver = true
    stopTimer(d.timers.wordsRun)
    startTimer(d.timers.icon1Run, now, DIALOGUE_TIMER_MS.icon1Run)
    return
  }
  d.sentenceOver = true
  stopTimer(d.timers.wordsRun)
  startTimer(d.timers.icon1Run, now, DIALOGUE_TIMER_MS.icon1Run)
}

function writeChar(d: DialogueDraft, ch: string): void {
  d.text[d.row]![d.col] = ch
  if (ch === '@') d.fight = true
  else if (ch === '$') d.gameOver = true
  d.cursor++
  d.col++
}

/**
 * 六个定时器的一拍。**顺序照 `DIALOGUE_TIMER_NAMES`**（字段名字典序），
 * 与 trace 导出器装表的次序一致。
 */
export function tickDialogueTimers(d: DialogueDraft, now: number): void {
  for (const name of DIALOGUE_TIMER_NAMES) {
    const timer = d.timers[name]
    const interval = DIALOGUE_TIMER_MS[name]
    let guard = 0
    while (timer.running && now >= timer.dueMs) {
      timer.dueMs += interval
      fireDialogueTimer(d, name, now)
      if (++guard > 64) throw new Error(`对话定时器 ${name} 在一个 tick 内触发超过 64 次`)
    }
  }
}

function fireDialogueTimer(d: DialogueDraft, name: DialogueTimerName, now: number): void {
  switch (name) {
    // 名字式对话框从右下往左上滑进来，滑到位起名字牌。
    case 'dialogueMoveLeft':
      if (d.boxX > 272) {
        d.boxX -= 48
        d.boxY -= 16
      } else {
        stopTimer(d.timers.dialogueMoveLeft)
        startTimer(d.timers.nameRun, now, DIALOGUE_TIMER_MS.nameRun)
      }
      return
    // 头像式对话框从左上往右下滑，滑到位起头像。
    case 'dialogueMoveRight':
      if (d.boxX < 640) {
        d.boxX += 48
        d.boxY += 16
      } else {
        stopTimer(d.timers.dialogueMoveRight)
        startTimer(d.timers.headRun, now, DIALOGUE_TIMER_MS.headRun)
      }
      return
    case 'headRun':
      if (d.headX > 640) {
        d.headX -= 16
      } else {
        stopTimer(d.timers.headRun)
        startTimer(d.timers.wordsRun, now, DIALOGUE_TIMER_MS.wordsRun)
        d.printing = true
      }
      return
    case 'icon1Run':
      d.iconFrame = d.iconFrame === 0 ? 1 : 0
      return
    case 'nameRun':
      if (d.nameX < 272) {
        d.nameX += 16
      } else {
        stopTimer(d.timers.nameRun)
        startTimer(d.timers.wordsRun, now, DIALOGUE_TIMER_MS.wordsRun)
        d.printing = true
      }
      return
    case 'wordsRun':
      tickWords(d, now)
      return
  }
}

// ============================ NPCEvent：口头语 ============================

/** `NPCEvent.sayOral`。 */
function sayOral(d: DialogueDraft, npcs: readonly NpcState[], index: number, now: number): void {
  d.oral = true
  d.oralNpc = index
  const npc = npcs[index]
  if (!npc) return
  showSentence(d, ['1', npc.name, npc.oral[d.oralCount] ?? ''], now)
  d.oralCount++
}

/**
 * `NPCEvent.checkNPCOral`：按空格时，看有没有 NPC 该说话。
 *
 * 三种状态码三套判据，照抄：静止的看四个贴身位（那四个不对称的偏移是原版
 * 原文），走动/原地动的看它的定时器**是不是已经被 `checkNPCStop` 停住了**。
 *
 * 循环不 break —— 原版就没有。同时贴着两个该说话的 NPC，两次 `sayOral` 都会
 * 跑，后一次覆盖前一次。真值里没踩到，但它是原版的行为。
 */
export function checkNpcOral(
  d: DialogueDraft,
  script: DialogueScript,
  npcs: readonly NpcState[],
  roleX: number,
  roleY: number,
  now: number,
): void {
  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i]!
    const near = adjacent(npc.x, npc.y, roleX, roleY)
    const eligible =
      npc.type === 0 ? near : npc.type === 1 ? !npc.walk.running : npc.type === 2 ? !npc.action.running : false
    if (!eligible) continue
    if (script.selectNpcs.includes(i)) continue
    sayOral(d, npcs, i, now)
  }
}

/** 口头语进行中按空格（`NPCEvent.keyPress`）。 */
function oralKeyPressed(d: DialogueDraft, npcs: readonly NpcState[], now: number): void {
  if (d.pageOver) {
    beginPage(d, now)
    return
  }
  if (!d.sentenceOver) return
  stopTimer(d.timers.icon1Run)
  const oral = npcs[d.oralNpc]?.oral ?? []
  if (d.oralCount >= oral.length) {
    d.oralOver = true
    d.oralCount = 0
    d.oral = false
  } else {
    sayOral(d, npcs, d.oralNpc, now)
    d.oralOver = false
  }
}

/**
 * 原版那四个贴身位（`NPCEvent.checkNPCOral` / `DialogueEvent.checkDialogue`
 * 里一模一样的那串条件）。
 *
 * 它们**不对称**：左右两个要求主角在 NPC 下面一格，正上是同格，正下是差两格。
 * NPC 的贴图有两格高、脚下那一格才是它站的位置，所以"面对面"在格子坐标上就是
 * 这个样子。别整理成"曼哈顿距离 ≤ 1"，那会把四个位置变成五个。
 */
function adjacent(npcX: number, npcY: number, roleX: number, roleY: number): boolean {
  return (
    (npcX - 1 === roleX && npcY === roleY - 1) ||
    (npcX + 1 === roleX && npcY === roleY - 1) ||
    (npcX === roleX && npcY === roleY) ||
    (npcX === roleX && npcY + 2 === roleY)
  )
}

// ============================ DialogueEvent：主线对话 ============================

/** `DialogueEvent.startSpeak`。`role.setEvent(true)` 由调用方代劳（它要改主角）。 */
function startSpeak(d: DialogueDraft, script: DialogueScript, now: number): void {
  const sentence = script.groups?.[d.groupOrder]?.[0]
  if (!sentence) return
  d.groupOver = false
  d.sentenceOrder = 0
  d.speaking = true
  showSentence(d, sentence, now)
  d.sentenceOrder++
  d.groupOrder++
}

/**
 * `ScenePanel.step()` 第 2 步 → `DialogueEvent.checkAutoDialogue`：
 * 进场自动播的那一段（`Dialogue` 段的触发码写着 `-1`）。
 *
 * 返回是否真的开了口 —— 调用方要据此置主角的 `canStop`。
 */
export function checkAutoDialogue(d: DialogueDraft, script: DialogueScript, now: number): boolean {
  if (d.groupOrder !== 0) return false
  if (d.eventOver) return false
  const code = script.code?.[0]
  if (code === undefined || code.length > 2) return false
  if (Number.parseInt(code, 10) !== -1) return false
  startSpeak(d, script, now)
  return true
}

/**
 * `ScenePanel.step()` 第 5 步 → `DialogueEvent.checkLocationDialogue`：
 * 走到某一格就触发的那种。触发码是一串 `,` 分隔的 `x y`。
 */
export function checkLocationDialogue(
  d: DialogueDraft,
  script: DialogueScript,
  roleX: number,
  roleY: number,
  now: number,
): boolean {
  const code = script.code
  if (code === null || d.groupOrder >= code.length) return false
  if (d.eventOver) return false
  const entry = code[d.groupOrder]
  if (entry === undefined || entry.length <= 2) return false
  let started = false
  for (const location of entry.split(',')) {
    const [x, y] = location.split(' ')
    if (Number.parseInt(x ?? '', 10) === roleX && Number.parseInt(y ?? '', 10) === roleY) {
      startSpeak(d, script, now)
      started = true
    }
  }
  return started
}

/**
 * 按空格搭话（`DialogueEvent.checkDialogue`）：这个场景的下一段主线对话挂在
 * 某个 NPC 上，而主角正站在它跟前。返回是否搭上了 —— 搭上了就不再走口头语
 * 那一路（`ScenePanel.keyPressed` 里那个 `b`）。
 */
export function checkDialogue(
  d: DialogueDraft,
  script: DialogueScript,
  npcs: readonly NpcState[],
  roleX: number,
  roleY: number,
  now: number,
): boolean {
  if (!script.isScript || d.eventOver) return false
  const code = script.code
  const entry = code?.[d.groupOrder]
  if (entry === undefined || entry.length > 2) return false
  const index = Number.parseInt(entry, 10)
  if (index === -1) return false
  const npc = npcs[index]
  if (!npc) return false
  const eligible =
    npc.type === 0
      ? adjacent(npc.x, npc.y, roleX, roleY)
      : npc.type === 1
        ? !npc.walk.running
        : npc.type === 2
          ? !npc.action.running
          : false
  if (!eligible) return false
  startSpeak(d, script, now)
  return true
}

/** 主线对话进行中按空格（`DialogueEvent.keyPressed`）。 */
function storyKeyPressed(d: DialogueDraft, script: DialogueScript, now: number): void {
  const groups = script.groups ?? []
  if (d.groupOver) {
    if (d.groupOrder >= groups.length) d.eventOver = true
    d.speaking = false
    // `dialogueFight` / `gameOver` 在原版这里分别去起剧情战和切到结束面板。
    // 那两件事各自是别的票；标志留着不清，等它们接进来。
    return
  }
  if (d.pageOver) {
    beginPage(d, now)
    return
  }
  if (!d.sentenceOver) return
  const group = groups[d.groupOrder - 1] ?? []
  const sentence = group[d.sentenceOrder]
  if (sentence) showSentence(d, sentence, now)
  d.sentenceOrder++
  stopTimer(d.timers.icon1Run)
  if (d.sentenceOrder >= group.length) d.groupOver = true
}

// ============================ 键盘 ============================

/**
 * 空格键。**只在对话框已经开着的时候**走这里 —— 触发对话那一路
 * （`checkDialogue` / `checkNpcOral`）在 `step.ts` 里，因为它要读主角的位置
 * 和 NPC，而且原版那两个分支的先后（先主线、搭不上再口头语）是 `ScenePanel`
 * 的事，不是这一层的。
 */
export function pressSpace(
  d: DialogueDraft,
  script: DialogueScript,
  npcs: readonly NpcState[],
  now: number,
): void {
  if (d.speaking) storyKeyPressed(d, script, now)
  else if (d.oral) oralKeyPressed(d, npcs, now)
}

/**
 * **跳过逐字打印，直接看到整屏。**
 *
 * ⚠️ **原版没有这个功能。** `DialogueEvent.keyPressed` / `NPCEvent.keyPress`
 * 在句子还没打完时什么也不做，玩家只能等。这一票的验收标准要求"按键可跳过
 * 打印直接显示整句"，所以它是**加出来的**，而不是移植出来的。
 *
 * 因此它**不挂在空格上**（`game/keyboard.ts` 把它挂在回车）。理由是可证伪性：
 * 真值里的空格永远只在 `sentenceOver || pageOver` 之后才按下（三份 trace 里
 * 25 次空格实测无一例外），所以往空格上加一条"打印中就跳过"的分支，逐 tick
 * 比对**一次都不会踩到**——那条分支会成为整个状态层唯一没有真值管着的行为，
 * 而它改的恰恰是别人都在对齐的那个游标。挂在另一个键上，空格那一路就仍然与
 * 原版逐字节同构，跳过是一条明确的增量。
 *
 * 语义：把当前这一屏一次打满 —— 就是把 `wordsRun` 那一拍连着跑到它自己停表
 * 为止。所以终点与"等它慢慢打完"完全一致（同一个函数），不是另写一套。
 */
export function skipPrinting(d: DialogueDraft, now: number): void {
  if (!d.printing) return
  if (d.sentenceOver || d.pageOver) return
  let guard = 0
  while (d.timers.wordsRun.running) {
    tickWords(d, now)
    // 分母是一屏的格子数：4×20 打满必然停表，多一拍都说明上面那个循环的
    // 出口条件已经不成立了。
    if (++guard > MAX_ROW * MAX_COL + 1) {
      throw new Error('跳过逐字打印时没能停下来 —— wordsRun 的停表条件变了')
    }
  }
}
