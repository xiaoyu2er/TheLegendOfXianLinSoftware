/**
 * 选择框 / 答题那套状态机 —— `src/scene/SelectEvent.java` 一整个对象的移植
 * （xl-yg6.8）。
 *
 * 原版把四件不相干的事塞进了同一个对象，这里**照抄这个形状**，不拆：
 *
 * 1. 「要不要进药店」`shopSelect`；
 * 2. 「要不要进装备超市」`equipmentSelect`；
 * 3. 「要不要打一架」`battleSelect`；
 * 4. 「要不要答题」`questionSelect` → 问题框 `isQuestion` → 回答框 `isAnswer`。
 *
 * 拆开会好看，但那四支共用 `isSelect`、共用逐字打印的三个游标、共用
 * `count_selectYesNo`，而**真值是按这一个对象整列记的**
 * （`tools/traces/out/*.trace.json` 的 `select` 那一列，见 `docs/trace-format.md`）。
 * 拆成四个模块之后，"这一列对不对得上"就再也没有一个对应物了。
 *
 * ## 它同时是一道闸
 *
 * `isSelect` 为真时 `ScenePanel.keyPressed` 不再把方向键交给主角
 * （`if (!selectEvent.isSelect)`）—— 选择框开着就走不动。那道闸在
 * `state/step.ts` 的 `applyInput` 里，不在这里：它是 `ScenePanel` 的事。
 *
 * ## 跨场景活着的那张表
 *
 * `mapName` / `answeredRecorder` 在原版里是两个 **static** 字段，也就是
 * "这一局游戏里，哪个场景的哪几道题答过了"。这一层没有 static，那张表挂在
 * `World.recorder` 上，由 `initiate` 一路带过去（见 `state/step.ts`）。
 * 真值里看得见：`question-memory` 那条剧本走出大活、进大地图、再走回来，
 * `answered` 从 18 个值变成 `[]` 再变回来，而 `recorder` 一直记着。
 */
import type { SceneScript } from '../data/types'
import type { BattleInfo } from './fight'
import { fireDue, startTimer, stopTimer } from './timer'
import type { MutableTimer } from './timer'
import type { TimerState } from './types'

/** 三个定时器的间隔，照抄构造函数里那三句 `new Timer(Clock.delay(x), ...)`。 */
export const WORDS_MS = 30
export const SELECT_IMAGE_MS = 40
export const QUESTION_IMAGE_MS = 50

/** `maxLine`：`bufferedText` 有几行。写到第 20 行原版是数组越界。 */
export const MAX_LINE = 20

/** 一行几个字：选择框 22、问题框 44（`showQuestion` 把它改掉）。 */
export const SELECT_MAX_LENGTH = 22
export const QUESTION_MAX_LENGTH = 44

/**
 * 是 / 否 光标的两个取值。**原版就是 2 和 3**，不是 0 和 1 —— 它同时是
 * `bufferedText` 的行下标（`drawSelectImage` 里那句 `i == count_selectYesNo`），
 * 而选择框的第 2、3 行正是那两个选项。翻译成 0/1 会让绘制那一头也得跟着翻，
 * 而真值记的是原样。
 */
export const YES = 2
export const NO = 3

/** 选择框滑入的终点判据：**自增前**的 `x <= 500`，所以终值是 550/165。 */
export const SELECT_IMAGE_LIMIT = 500
export const SELECT_IMAGE_DX = 50
export const SELECT_IMAGE_DY = 15

/** 问题框从屏幕中心往四角撑，撑到 `x1 < 262` 停。 */
export const QUESTION_IMAGE_CENTER_X = 512
export const QUESTION_IMAGE_CENTER_Y = 320
export const QUESTION_IMAGE_LIMIT = 262
export const QUESTION_IMAGE_STEP = 25

/**
 * 选中的那一句在 `question` 那一组里的下标范围。原版两处写死的算式：
 * 初值 `size() - 5`，上界 `size() - 2`（`keyPressed` 里那两条边界）。
 *
 * 为什么不是"第几个选项"：题面会折行，一组 `question` 的行数不固定，
 * 而选项恒为最后四行 —— 所以下标是从**末尾**倒数出来的。
 */
export const ABCD_FIRST_FROM_END = 5
export const ABCD_LAST_FROM_END = 2

/**
 * 打赢选择战之后原版硬写在代码里的那一句回应（`keyPressed` 的 battleSelect
 * 分支）。**它不在脚本数据里**，所以它在这里，不在烘焙产物里。
 */
export const BATTLE_RESPONSE =
  '既然身手那么好就别装嫩了!唉,看来以后我要收敛点了!  你们软件堂的人就是闷骚!'

/**
 * 这个场景的四段选择数据。字段名换成 trace 里的说法，来源逐条对应
 * `SceneScript`（也就是 `tools.Reader` 的字段）。
 *
 * 六段都可能是 `null` —— 原版对应的 `ArrayList` 就是没初始化的 null，而
 * `checkSelectEvent` 的每一支都先判一次空。**"这个场景没有这一段"与"有这一段
 * 但是空的"不是一回事**，所以照留 `null`，不折成空数组。
 */
export interface SelectScript {
  readonly shop: readonly string[] | null
  readonly equipShop: readonly string[] | null
  readonly battlePanel: readonly (readonly string[])[] | null
  readonly battle2: readonly (readonly string[])[] | null
  readonly question: readonly (readonly string[])[] | null
  readonly questions: readonly (readonly string[])[] | null
  readonly answers: readonly (readonly string[])[] | null
}

export function selectScriptOf(scene: SceneScript): SelectScript {
  return {
    shop: scene.selectShopPanel,
    equipShop: scene.selectEquipmentShopPanel,
    battlePanel: scene.selectBattlePanel,
    battle2: scene.battle2,
    question: scene.selectQuestion,
    questions: scene.question,
    answers: scene.answer,
  }
}

/**
 * `SelectEvent.mapName` 与 `SelectEvent.answeredRecorder` 那两张 static 表
 * 配成的一条记录。导出器把它们配成 `[{scene, answered}]`
 * （`SceneDriver.answeredRecorder()`），这里用同一个形状 —— 两端不必翻译。
 */
export interface SelectRecord {
  readonly scene: string
  readonly answered: readonly boolean[]
}

/**
 * 选择框的全部状态。字段名跟 trace 的 `select` 那一列逐字对齐（见
 * `docs/trace-format.md` 的字段表），比对时不必再翻译一道。
 *
 * `sentences` / `text` 两样**不在真值里**：题面与选项来自脚本，数据层已经
 * 逐字段钉住了。它们在这里是因为绘制要用（`scene/selectLayout.ts`）与逐字
 * 打印要用（`WordsRun` 读 `currentSentences`）。
 */
export interface SelectState {
  readonly script: SelectScript
  /** `isSelect`：选择系统占用中。**它就是那道"走不动"的闸**。 */
  readonly isSelect: boolean
  readonly shop: boolean
  readonly equipShop: boolean
  readonly battle: boolean
  readonly question: boolean
  /** `isQuestion`：问题框阶段。 */
  readonly asking: boolean
  /** `isAnswer`：回答框阶段。 */
  readonly answering: boolean
  readonly yesNo: number
  readonly abcd: number
  readonly battleNo: number
  readonly questionNo: number
  readonly boxW: number
  readonly boxH: number
  readonly qx1: number
  readonly qy1: number
  readonly qx2: number
  readonly qy2: number
  /** `count_sentence`，**初值 1**：第 0 句是 NPC 序号（或 `null` 占位），不打印。 */
  readonly sentenceNo: number
  readonly wordNo: number
  readonly lineNo: number
  readonly maxLength: number
  readonly answered: readonly boolean[]
  readonly fought: readonly boolean[]
  /**
   * `count_scene`。⚠️ **只有有题的场景才是下标**：原版只在 `question != null`
   * 且认领到旧记录时才给它赋值，其余场景它就停在初值 0 —— 而那时 `recorder`
   * 可能非空（别的场景留下的），于是这个 0 指着别人。照抄，不"顺手修好"。
   */
  readonly sceneNo: number
  /**
   * 这个场景的 `haveAnswered` 在 `World.recorder` 里的**真实**下标；
   * 没有题的场景是 `null`。
   *
   * 原版没有这个字段 —— 它靠的是**对象别名**：`haveAnswered` 与
   * `answeredRecorder.get(i)` 是同一个 `ArrayList`，改一处两处都变。这一层
   * 的数组是不可变值，别名表达不出来，于是把那个下标显式记下来。
   *
   * ⚠️ 它与 `sceneNo` **不一定相等**，那正是上面那条警告：新登记的场景排在
   * 表尾（下标 `recorder.length-1`），而 `count_scene` 仍是 0。今天的真值里
   * 两条剧本都只有一条记录，两者恒等 —— 也就是**这个分支没有真值覆盖**，
   * 判据只能回到源码上取（见 `select.test.ts` 里那条两个有题场景的用例）。
   */
  readonly recordIndex: number | null
  /** `currentSentences`：正在逐字吐的那一组。第 0 句从不打印。 */
  readonly sentences: readonly (string | null)[]
  /** `bufferedText`：已经吐出来的每一行；`null` = 这一行还没写过。 */
  readonly text: readonly (string | null)[]
  readonly selectImageMove: TimerState
  readonly questionImageMove: TimerState
  readonly wordsRun: TimerState
}

const STOPPED: TimerState = { running: false, dueMs: 0 }

/**
 * `new SelectEvent(...)`：构造函数那两段。
 *
 * 返回的 `recorder` 是**可能长了一条的那张表** —— 原版构造函数会往两张
 * static 表里 `add` 一条，那是跨场景的副作用，这一层只能把它交回给调用方
 * （`state/step.ts` 的 `initiate`）。
 */
export function createSelect(
  scene: SceneScript,
  fileName: string,
  recorder: readonly SelectRecord[],
): { readonly select: SelectState; readonly recorder: readonly SelectRecord[] } {
  const script = selectScriptOf(scene)
  let answered: readonly boolean[] = []
  let sceneNo = 0
  let recordIndex: number | null = null
  let next = recorder

  if (script.questions !== null) {
    // 原版这个循环**不 break**，命中多次时留下的是最后一个下标。照抄。
    let entered = false
    for (let i = 0; i < recorder.length; i++) {
      if (recorder[i]!.scene === fileName) {
        entered = true
        sceneNo = i
      }
    }
    if (entered) {
      // `haveAnswered = answeredRecorder.get(count_scene)` —— 同一个对象。
      answered = recorder[sceneNo]!.answered
      recordIndex = sceneNo
    } else {
      answered = script.questions.map(() => false)
      next = [...recorder, { scene: fileName, answered }]
      recordIndex = next.length - 1
    }
  }

  const fought = script.battlePanel === null ? [] : script.battlePanel.map(() => false)

  return {
    recorder: next,
    select: {
      script,
      isSelect: false,
      shop: false,
      equipShop: false,
      battle: false,
      question: false,
      asking: false,
      answering: false,
      yesNo: YES,
      abcd: 0,
      battleNo: 0,
      questionNo: 0,
      boxW: 0,
      boxH: 0,
      qx1: 0,
      qy1: 0,
      qx2: 0,
      qy2: 0,
      sentenceNo: 1,
      wordNo: 0,
      lineNo: 0,
      maxLength: SELECT_MAX_LENGTH,
      answered,
      fought,
      sceneNo,
      recordIndex,
      sentences: [],
      text: new Array<string | null>(MAX_LINE).fill(null),
      selectImageMove: STOPPED,
      questionImageMove: STOPPED,
      wordsRun: STOPPED,
    },
  }
}

/** 逐 tick 就地改的草稿，与 `role` / `dialogue` / `narratage` 那几份同一个形状。 */
export interface SelectDraft {
  script: SelectScript
  isSelect: boolean
  shop: boolean
  equipShop: boolean
  battle: boolean
  question: boolean
  asking: boolean
  answering: boolean
  yesNo: number
  abcd: number
  battleNo: number
  questionNo: number
  boxW: number
  boxH: number
  qx1: number
  qy1: number
  qx2: number
  qy2: number
  sentenceNo: number
  wordNo: number
  lineNo: number
  maxLength: number
  answered: boolean[]
  fought: boolean[]
  sceneNo: number
  recordIndex: number | null
  sentences: readonly (string | null)[]
  text: (string | null)[]
  selectImageMove: MutableTimer
  questionImageMove: MutableTimer
  wordsRun: MutableTimer
  /**
   * 那张跨场景的表。**草稿要带着它**：答对答错的那一下同时改
   * `haveAnswered` 与 `answeredRecorder` 两处，而后者不属于这个场景。
   */
  recorder: SelectRecord[]
}

export function toSelectDraft(s: SelectState, recorder: readonly SelectRecord[]): SelectDraft {
  return {
    script: s.script,
    isSelect: s.isSelect,
    shop: s.shop,
    equipShop: s.equipShop,
    battle: s.battle,
    question: s.question,
    asking: s.asking,
    answering: s.answering,
    yesNo: s.yesNo,
    abcd: s.abcd,
    battleNo: s.battleNo,
    questionNo: s.questionNo,
    boxW: s.boxW,
    boxH: s.boxH,
    qx1: s.qx1,
    qy1: s.qy1,
    qx2: s.qx2,
    qy2: s.qy2,
    sentenceNo: s.sentenceNo,
    wordNo: s.wordNo,
    lineNo: s.lineNo,
    maxLength: s.maxLength,
    answered: [...s.answered],
    fought: [...s.fought],
    sceneNo: s.sceneNo,
    recordIndex: s.recordIndex,
    sentences: s.sentences,
    text: [...s.text],
    selectImageMove: { ...s.selectImageMove },
    questionImageMove: { ...s.questionImageMove },
    wordsRun: { ...s.wordsRun },
    recorder: recorder.map((r) => ({ scene: r.scene, answered: [...r.answered] })),
  }
}

export function fromSelectDraft(d: SelectDraft): SelectState {
  return {
    script: d.script,
    isSelect: d.isSelect,
    shop: d.shop,
    equipShop: d.equipShop,
    battle: d.battle,
    question: d.question,
    asking: d.asking,
    answering: d.answering,
    yesNo: d.yesNo,
    abcd: d.abcd,
    battleNo: d.battleNo,
    questionNo: d.questionNo,
    boxW: d.boxW,
    boxH: d.boxH,
    qx1: d.qx1,
    qy1: d.qy1,
    qx2: d.qx2,
    qy2: d.qy2,
    sentenceNo: d.sentenceNo,
    wordNo: d.wordNo,
    lineNo: d.lineNo,
    maxLength: d.maxLength,
    answered: [...d.answered],
    fought: [...d.fought],
    sceneNo: d.sceneNo,
    recordIndex: d.recordIndex,
    sentences: d.sentences,
    text: [...d.text],
    selectImageMove: { ...d.selectImageMove },
    questionImageMove: { ...d.questionImageMove },
    wordsRun: { ...d.wordsRun },
  }
}

/**
 * 选择框这一支要向外做的那几件事。原版是三处直接调用，这里做成回调，
 * **一处都不静默丢掉**：
 *
 * - `fight` ← `fightEvent.fight(battle2.get(count_battle2))`，
 *   场景这一侧已经有这条路（`state/step.ts` 的 `requestBattle`）；
 * - `switchTo` ← `GameLauncher.switchTo("shop" | "equipmentShop")`，
 *   药店与装备超市那两扇门 —— 归 **xl-yg6.11**；
 * - `present` ← `Money.addCoins/reduceCoins` + `equipmentEvent.drawString(...)`，
 *   答对答错的加扣金币与"得到物品"提示框 —— 归 **xl-yg6.9 / xl-yg6.10**。
 *
 * `random` 是 `Math.random()` 的替身，**只有加扣金币那一处读它**
 * （`500 + (int)(500 * Math.random())`）。做成入参是为了那个数能被断言。
 */
export interface SelectHost {
  fight(info: BattleInfo): void
  switchTo(panel: 'shop' | 'equipmentShop'): void
  present(request: PresentRequest): void
  random(): number
}

/** 答对答错那一下要递给"得到物品"提示框与钱包的东西。 */
export interface PresentRequest {
  readonly correct: boolean
  /** `500 + (int)(500 * Math.random())`。答错时是**扣**这么多。 */
  readonly coins: number
  /** `equipmentEvent.drawString(...)` 的那句话，逐字照抄原版的拼法。 */
  readonly text: string
}

/**
 * `SelectEvent.checkSelectEvent(npcNo)`：这个 NPC 身上有没有选择事件。
 *
 * 返回 `true` 表示"截胡了"—— `NPCEvent.checkNPCOral` 于是不给它说口头语。
 * 四支的先后照抄，**一支都不能合并**：
 *
 * - 药店 / 装备超市只认自己那一个 NPC 序号；
 * - 选择战会跳过**已经打过的**那几场，并且 `count_battle2 = i` 是无条件赋值
 *   （哪怕选择框已经开着）；
 * - 答题那一支开头有一句 `if (isSelect) return true;` —— 它**不看 npcNo**，
 *   于是选择框开着时，有题的场景里所有 NPC 都说不了口头语。这一条看着像
 *   笔误，但它是真值里看得见的行为（`question-answer` / `question-memory`），
 *   照抄。
 */
export function checkSelectEvent(d: SelectDraft, npcNo: number, now: number): boolean {
  const s = d.script
  if (s.shop !== null && npcNo === npcNoOf(s.shop)) {
    if (!d.isSelect) showSelectShopPanel(d, now)
    return true
  }
  if (s.equipShop !== null && npcNo === npcNoOf(s.equipShop)) {
    if (!d.isSelect) showSelectEquipmentShopPanel(d, now)
    return true
  }
  if (s.battlePanel !== null) {
    for (let i = 0; i < s.battlePanel.length; i++) {
      if (d.fought[i]) continue
      if (npcNo !== npcNoOf(s.battlePanel[i]!)) continue
      if (!d.isSelect) showSelectBattlePanel(d, i, now)
      d.battleNo = i
      return true
    }
  }
  if (s.question !== null) {
    if (d.isSelect) return true
    for (let i = 0; i < s.question.length; i++) {
      if (d.answered[i]) continue
      if (npcNo !== npcNoOf(s.question[i]!)) continue
      // 外层已经保证 `!d.isSelect`，原版这里还套了一层，照抄不影响行为。
      if (!d.isSelect) showSelectQuestion(d, i, now)
      return true
    }
  }
  return false
}

/**
 * 一段选择数据的第 0 列：触发它的 NPC 序号。
 *
 * 原版是 `Integer.parseInt(...)`，解不出来就抛。数据里没有这种情况（96 个
 * 脚本实测），解不出来时给一个**不可能命中的**值而不是 0 —— 0 是一个真实的
 * NPC 序号，当成 0 会让第一个 NPC 莫名其妙说不了话。
 */
function npcNoOf(row: readonly string[]): number {
  const n = Number.parseInt(row[0] ?? '', 10)
  return Number.isInteger(n) ? n : Number.NaN
}

/** `showSelectShopPanel` / `showSelectEquipmentShopPanel` / `showSelectBattlePanel`
 * / `showSelectQuestion` / `showAnswer` 共有的那五句。 */
function showSelectBox(d: SelectDraft, sentences: readonly (string | null)[], now: number): void {
  d.sentences = sentences
  d.boxW = 0
  d.boxH = 0
  clear(d)
  d.yesNo = YES
  d.maxLength = SELECT_MAX_LENGTH
  startTimer(d.selectImageMove, now, SELECT_IMAGE_MS)
}

export function showSelectShopPanel(d: SelectDraft, now: number): void {
  d.isSelect = true
  d.shop = true
  showSelectBox(d, d.script.shop ?? [], now)
}

export function showSelectEquipmentShopPanel(d: SelectDraft, now: number): void {
  d.isSelect = true
  d.equipShop = true
  showSelectBox(d, d.script.equipShop ?? [], now)
}

/** 选择战的招呼语只取那一行的**前 4 列**（原版那个 `for (i < 4)`）。 */
export function showSelectBattlePanel(d: SelectDraft, battleNo: number, now: number): void {
  d.isSelect = true
  d.battle = true
  showSelectBox(d, (d.script.battlePanel?.[battleNo] ?? []).slice(0, 4), now)
}

export function showSelectQuestion(d: SelectDraft, questionNo: number, now: number): void {
  d.questionNo = questionNo
  d.isSelect = true
  d.question = true
  showSelectBox(d, (d.script.question?.[questionNo] ?? []).slice(0, 4), now)
}

/**
 * `showQuestion`：从选择框翻到问题框。
 *
 * **不动 `count_selectYesNo`**（上面那五句里唯一没抄的一条），照抄。
 */
export function showQuestion(d: SelectDraft, questionNo: number, now: number): void {
  const lines = d.script.questions?.[questionNo] ?? []
  d.asking = true
  d.sentences = lines
  d.qx1 = QUESTION_IMAGE_CENTER_X
  d.qy1 = QUESTION_IMAGE_CENTER_Y
  d.qx2 = QUESTION_IMAGE_CENTER_X
  d.qy2 = QUESTION_IMAGE_CENTER_Y
  clear(d)
  d.maxLength = QUESTION_MAX_LENGTH
  d.abcd = lines.length - ABCD_FIRST_FROM_END
  startTimer(d.questionImageMove, now, QUESTION_IMAGE_MS)
}

export function showAnswer(d: SelectDraft, response: readonly (string | null)[], now: number): void {
  d.answering = true
  showSelectBox(d, response, now)
}

/** `clear()`：缓存清空，三个游标回到初值（`count_sentence` 的初值是 **1**）。 */
function clear(d: SelectDraft): void {
  d.text = new Array<string | null>(MAX_LINE).fill(null)
  d.sentenceNo = 1
  d.wordNo = 0
  d.lineNo = 0
}

/**
 * `SelectEvent.keyPressed(keyCode)`。**只有 `isSelect` 为真时才会被调到**
 * （`ScenePanel.keyPressed` 那道门），这里不重复判。
 *
 * 键名是状态层那一套（`down` / `up` / `enter` / `space`），与 trace 里
 * `ticks[].input` 的 `k` 逐字一致。左右键原版不处理，这里也不处理。
 */
export function selectKeyPressed(
  d: SelectDraft,
  key: string,
  now: number,
  host: SelectHost,
): void {
  if (key === 'down' || key === 'up') {
    cursorKey(d, key)
    return
  }
  if (key === 'enter') {
    confirmKey(d, now, host)
    return
  }
  if (key === 'space' && d.answering) {
    // 关掉回答框。**只有这一处能把 `isAnswer` 落回假**。
    d.isSelect = false
    d.answering = false
  }
}

/**
 * 上下键。**两个键对是/否光标是同一支**（都只是 2↔3 互换），只有问题框那一段
 * 才分上下。照抄，包括"哪怕正在问题框阶段也照样翻是/否光标"这一点 ——
 * 那个光标此刻画不出来，但它确实在变，真值记着。
 */
function cursorKey(d: SelectDraft, key: 'down' | 'up'): void {
  if (d.yesNo === YES) d.yesNo = NO
  else if (d.yesNo === NO) d.yesNo = YES
  if (!d.asking) return
  const size = d.script.questions?.[d.questionNo]?.length ?? 0
  const first = size - ABCD_FIRST_FROM_END
  const last = size - ABCD_LAST_FROM_END
  if (key === 'down') d.abcd = d.abcd < last ? d.abcd + 1 : first
  else d.abcd = d.abcd > first ? d.abcd - 1 : last
}

/** 回车。四个旗标各一支，**先后照抄**（`isQuestion` 排在最后）。 */
function confirmKey(d: SelectDraft, now: number, host: SelectHost): void {
  if (d.shop) {
    if (d.yesNo === YES) host.switchTo('shop')
    else {
      d.isSelect = false
      d.shop = false
    }
    return
  }
  if (d.equipShop) {
    if (d.yesNo === YES) host.switchTo('equipmentShop')
    else {
      d.isSelect = false
      d.equipShop = false
    }
    return
  }
  if (d.battle) {
    if (d.yesNo === YES) {
      const info = d.script.battle2?.[d.battleNo]
      if (info === undefined) {
        // 原版这里是 `battle2.get(count_battle2)`，越界就是异常。静默不打
        // 会让"这扇门坏了"表现为"按了没反应"。
        throw new Error(
          `选择战第 ${d.battleNo} 场没有对应的 Fight 数据（battle2 一共 ` +
            `${d.script.battle2?.length ?? 0} 行）`,
        )
      }
      host.fight(info)
      d.fought[d.battleNo] = true
      // 原版紧接着 `switchTo("battle")` 又 `showAnswer(...)`：选择框不但没关，
      // 还从头滑一遍、吐一句硬写在代码里的话。真值里看得见（battle-door）。
      showAnswer(d, [null, BATTLE_RESPONSE], now)
      d.battle = false
    } else {
      d.isSelect = false
      d.battle = false
    }
    return
  }
  if (d.question) {
    if (d.yesNo === YES) {
      showQuestion(d, d.questionNo, now)
      d.question = false
      d.asking = true
    } else {
      d.isSelect = false
      d.question = false
    }
    return
  }
  if (d.asking) answerKey(d, now, host)
}

/**
 * 问题框里按回车：对答案。
 *
 * 原版那两支（对 / 错）除了加钱还是扣钱、取第 3 列还是第 2 列之外**逐字相同**，
 * 这里合成一支 —— 合并的判据是那两段代码本身，不是"看起来一样"。
 */
function answerKey(d: SelectDraft, now: number, host: SelectHost): void {
  const row = d.script.answers?.[d.questionNo]
  if (row === undefined) {
    throw new Error(`第 ${d.questionNo} 道题没有对应的 Answer 段`)
  }
  const correct = d.abcd === Number.parseInt(row[0] ?? '', 10)
  const coins = 500 + Math.trunc(500 * host.random())
  host.present({
    correct,
    coins,
    text: correct ? `得到${coins}个金币` : `回答错误，扣掉${coins}个金币`,
  })
  d.asking = false
  d.answering = true
  // 答对取第 3 列、答错取第 2 列。
  showAnswer(d, [null, row[1] ?? null, correct ? (row[3] ?? null) : (row[2] ?? null)], now)
  d.answered[d.questionNo] = true
  recordAnswered(d)
}

/**
 * 把 `haveAnswered` 写回那张跨场景的表。原版是两件事，这里都做：
 *
 * 1. **对象别名**：`haveAnswered` 与 `answeredRecorder.get(recordIndex)` 是
 *    同一个 `ArrayList`，`remove`/`add` 一改，那条记录当场跟着变；
 * 2. 紧接着那两句 `answeredRecorder.remove(count_scene)` +
 *    `add(count_scene, haveAnswered)` —— 它按的是 **`count_scene`**，
 *    而那个下标在"这个场景是新登记的"时候是 0，指着别人。
 *
 * ⚠️ 两个下标不相等这件事**今天的真值盖不到**（两条有题的剧本都只有一条
 * 记录）。判据因此回到源码上取，见 `select.test.ts`。
 */
function recordAnswered(d: SelectDraft): void {
  const answered = [...d.answered]
  if (d.recordIndex !== null && d.recorder[d.recordIndex] !== undefined) {
    d.recorder[d.recordIndex] = { scene: d.recorder[d.recordIndex]!.scene, answered }
  }
  if (d.recorder[d.sceneNo] === undefined) {
    // 原版 `answeredRecorder.remove(count_scene)` 在这里是 IndexOutOfBounds。
    throw new Error(
      `count_scene = ${d.sceneNo}，而跨场景的记录表只有 ${d.recorder.length} 条`,
    )
  }
  d.recorder[d.sceneNo] = { scene: d.recorder[d.sceneNo]!.scene, answered }
}

/**
 * `SelectImageMove`：选择框滑入。
 *
 * 判据是**自增前**的 `x <= 500`，所以终值是 550/165 而不是 500/150；
 * 再下一拍才停下并起打字机。真值里看得见（shop-door 的 boxW 走到 550）。
 */
export function tickSelectImage(d: SelectDraft, now: number): void {
  if (d.boxW <= SELECT_IMAGE_LIMIT) {
    d.boxW += SELECT_IMAGE_DX
    d.boxH += SELECT_IMAGE_DY
  } else {
    stopTimer(d.selectImageMove)
    startTimer(d.wordsRun, now, WORDS_MS)
  }
}

/** `QuestionImageMove`：问题框从屏幕中心往四角撑，撑到 `x1 < 262` 停。 */
export function tickQuestionImage(d: SelectDraft, now: number): void {
  if (d.qx1 >= QUESTION_IMAGE_LIMIT) {
    d.qx1 -= QUESTION_IMAGE_STEP
    d.qy1 -= QUESTION_IMAGE_STEP
    d.qx2 += QUESTION_IMAGE_STEP
    d.qy2 += QUESTION_IMAGE_STEP
  } else {
    stopTimer(d.questionImageMove)
    startTimer(d.wordsRun, now, WORDS_MS)
  }
}

/**
 * `WordsRun`：逐字打印的一拍。照抄，包括那条**换行差一**的怪癖 ——
 * 满 `maxLength` 个字之后原版写进新一行的是
 * `substring(maxLength - 1, count_word)`，切点是 `maxLength - 1`，
 * 于是**一行实际只装 21 个字而那个常量写的是 22**。不修：改了逐 tick
 * 那几个游标照样全绿（它们数的是 `count_word`），只有画出来的行长会变。
 */
export function tickSelectWords(d: SelectDraft): void {
  if (d.sentenceNo < d.sentences.length) {
    const sentence = d.sentences[d.sentenceNo] ?? ''
    if (d.wordNo < sentence.length) {
      d.wordNo++
      if (d.wordNo === d.maxLength) d.lineNo++
      if (d.lineNo >= MAX_LINE) {
        // 原版这里是 `bufferedText[20]` —— 数组越界。JS 的数组会默默变长，
        // 于是"原版根本跑不起来的数据"在这边表现为多画几行。
        throw new Error(`选择框吐到第 ${d.lineNo} 行，原版的缓存只有 ${MAX_LINE} 行（会数组越界）`)
      }
      d.text[d.lineNo] =
        d.wordNo >= d.maxLength
          ? sentence.slice(d.maxLength - 1, d.wordNo)
          : sentence.slice(0, d.wordNo)
    } else {
      d.sentenceNo++
      d.lineNo++
      d.wordNo = 0
    }
  } else {
    stopTimer(d.wordsRun)
  }
}

/**
 * 这一 tick 到期的三个定时器。
 *
 * **次序照抄导出器**：它按字段名排序装表（`SceneDriver.sortedFields`），
 * `SelectEvent` 的三个 `Timer` 字段排下来就是
 * `questionImageMove` → `selectImageMove` → `wordsRun`。
 */
export function tickSelectTimers(d: SelectDraft, now: number): void {
  fireDue(
    d.questionImageMove,
    now,
    QUESTION_IMAGE_MS,
    () => tickQuestionImage(d, now),
    '问题框的滑入定时器',
  )
  fireDue(
    d.selectImageMove,
    now,
    SELECT_IMAGE_MS,
    () => tickSelectImage(d, now),
    '选择框的滑入定时器',
  )
  fireDue(d.wordsRun, now, WORDS_MS, () => tickSelectWords(d), '选择框的逐字定时器')
}
