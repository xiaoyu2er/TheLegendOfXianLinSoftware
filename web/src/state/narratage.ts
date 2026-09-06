/**
 * 旁白层：进场时逐字播完的那几句话，播完才把场景交还给玩家。
 *
 * 原版是 `scene/Narratage.java` 加 `ScenePanel.step()` 的第 1 步（每 10 ms
 * 问一次"该不该起旁白"）。这里逐行照抄那两处，**不重新设计**：两个定时器的
 * 间隔、游标的三个计数器、以及背景帧的循环，都是真值里逐 tick 看得见的行为
 * （`tools/traces/out/dorm-intro.trace.json` 的 `narratage` 字段）。
 *
 * ## 三个计数器
 *
 * 原版的 `count0/count1/count2` 在 trace 里叫 `line/cursor/row`，这里用后者：
 *
 * - `line`   第几句（`narratage` 数组的下标）；
 * - `cursor` 这一句已经打出了几个字；
 * - `row`    这一句打在第几行（**不等于 `line`**，见 `begin()` 那条翻页）。
 *
 * ## 两处 `Clock.sleep` 不在这里
 *
 * `WordRun` 一句打完会 `Clock.sleep(500)`、整段播完会 `Clock.sleep(1000)`，
 * 两处都是**在 EDT 上直接睡**，睡的是真实时间。trace 跑在虚拟时钟上，那两段
 * 睡眠一个 tick 都不占（实测：第 0 句 19 个字，从 vt=50 打到 vt=950，下一次
 * 触发就在 vt=1000 换行，中间没有 500 ms 的空档）。真值既然分辨不出它们，
 * 这里就不去模拟——模拟了反而与真值差 150 个 tick。
 *
 * 代价说清楚：浏览器里跑起来，句与句之间会少那半秒的停顿。这是**已知的偏离**，
 * 不是遗漏；要复刻它得先有一份能看见它的真值。
 */
import type { SceneScript } from '../data/types'
import { fireDue, startTimer, stopTimer } from './timer'
import type { MutableTimer } from './timer'
import type { TimerState } from './types'

/** 逐字打印的间隔。原版 `new Timer(Clock.delay(50), new WordRun())`。 */
export const WORD_MS = 50

/** 背景动画的间隔。原版 `new Timer(Clock.delay(180), new Background())`。 */
export const BACKGROUND_MS = 180

/** 旁白最多同屏几行。原版 `Narratage.maxLine = 10`。 */
export const MAX_LINE = 10

/**
 * 背景动画的帧。原版构造函数读的是
 * `backImages//NarratageBackImages//all_magic_21-{2..53}.png`，**从 2 开始**，
 * 共 52 张；`index` 在 `0 .. 51` 之间循环，所以第 `index` 帧对应的文件是
 * `all_magic_21-{index + 2}.png`。这个偏移只在烘焙器里出现一次
 * （`scripts/bake.ts`），状态层与渲染层都只认 `0 .. 51`。
 */
export const BG_FIRST_FILE = 2
export const BG_LAST_FILE = 53
export const BG_COUNT = BG_LAST_FILE - BG_FIRST_FILE + 1

const STOPPED: TimerState = { running: false, dueMs: 0 }

/**
 * 旁白。字段与原版 `scene.Narratage` 一一对应：
 *
 * | 这里 | 原版 | trace |
 * |---|---|---|
 * | `active` | `isNarratage` | `narratage.active` |
 * | `over` | `narratageOver` | `narratage.over` |
 * | `started` | `isRun` | — |
 * | `line` | `count0` | `narratage.line` |
 * | `cursor` | `count1` | `narratage.cursor` |
 * | `row` | `count2` | `narratage.row` |
 * | `bg` | `index` | `narratage.bg` |
 * | `text` | `bufferedText` | —（绘制要用，见 `drawNarratage`） |
 *
 * `lines` 是这个场景的旁白原文。原版 `stop()` 会把它 `clear()` 掉，这里保留
 * 数组本身、靠 `over` 关门：清空是为了让"再触发一次"变成空转，而 `over` 已经
 * 把那扇门关死了（`ScenePanel.step()` 的第 1 步）。
 */
export interface NarratageState {
  readonly lines: readonly string[]
  readonly active: boolean
  readonly over: boolean
  readonly started: boolean
  readonly line: number
  readonly cursor: number
  readonly row: number
  readonly bg: number
  /** 每一行当前已打出的部分；`null` = 这一行还没写过（原版的 `null` 初值）。 */
  readonly text: readonly (string | null)[]
  readonly background: TimerState
  readonly wordRun: TimerState
}

/**
 * 一个场景的初始旁白状态。
 *
 * **没有 `Narratage` 段就直接 `over`**：原版构造函数里
 * `if (narratage == null) narratageOver = true;`，于是 `ScenePanel.step()`
 * 第 1 步那道门从一开始就是关的。96 个场景里绝大多数是这种。
 */
export function createNarratage(scene: SceneScript): NarratageState {
  const lines = scene.narratage
  return {
    lines: lines ?? [],
    active: false,
    over: lines === null,
    started: false,
    line: 0,
    cursor: 0,
    row: 0,
    bg: 0,
    text: new Array<string | null>(MAX_LINE).fill(null),
    background: STOPPED,
    wordRun: STOPPED,
  }
}

export interface NarratageDraft {
  lines: readonly string[]
  active: boolean
  over: boolean
  started: boolean
  line: number
  cursor: number
  row: number
  bg: number
  text: (string | null)[]
  background: MutableTimer
  wordRun: MutableTimer
}

export function toNarratageDraft(n: NarratageState): NarratageDraft {
  return {
    lines: n.lines,
    active: n.active,
    over: n.over,
    started: n.started,
    line: n.line,
    cursor: n.cursor,
    row: n.row,
    bg: n.bg,
    text: [...n.text],
    background: { ...n.background },
    wordRun: { ...n.wordRun },
  }
}

export function fromNarratageDraft(d: NarratageDraft): NarratageState {
  return {
    lines: d.lines,
    active: d.active,
    over: d.over,
    started: d.started,
    line: d.line,
    cursor: d.cursor,
    row: d.row,
    bg: d.bg,
    text: [...d.text],
    background: { running: d.background.running, dueMs: d.background.dueMs },
    wordRun: { running: d.wordRun.running, dueMs: d.wordRun.dueMs },
  }
}

/**
 * `ScenePanel.step()` 的第 1 步 + `Narratage.checkNarratage()`。
 *
 * 原版的门是
 * `currentPanel == scenePanel && isScript && !isNarratage && !narratageOver`，
 * 前一半是"现在显示的确实是场景面板"（菜单、商店、战斗里不起旁白），Web 侧
 * 今天只有场景面板一块，那一半恒真。`isScript` 由调用方给：从大地图走进宿舍
 * 时原版把它置成 false，那时旁白与主线对话的轮询整个跳过。
 *
 * 起旁白的那一 tick，`init()` 把两个定时器 `start()` 起来，到期时刻是
 * **本 tick 的 now + 间隔**——所以第一个字落在 now+50、第一次换背景落在
 * now+180。真值第 0 tick 就已经 `active`，第 5 tick（vt=50）才有第一个字。
 */
export function checkNarratage(d: NarratageDraft, isScript: boolean, now: number): void {
  if (!isScript || d.active || d.over) return
  if (d.lines.length === 0) return
  if (d.started) return
  // init()：缓存清空、两个定时器起跑。
  d.text = new Array<string | null>(MAX_LINE).fill(null)
  startTimer(d.background, now, BACKGROUND_MS)
  startTimer(d.wordRun, now, WORD_MS)
  d.started = true
  d.active = true
}

/**
 * `Narratage.WordRun`：逐字打印的一拍。
 *
 * 照抄，包括那两处顺序上的讲究：
 *
 * - `count2 == maxLine` 的翻页检查在**写完这一行之后**、`count2++` 之前。
 *   于是 `begin()` 把 `count2` 清成 0 后紧接着又 `++`，第 0 行**被跳过**——
 *   原版就是这样，不修。
 * - 整段播完的判断在 `count0++` 之后，所以最后一句打完的那一拍就 `stop()`，
 *   真值里 `active` 与 `over` 在同一个 tick 翻转（dorm-intro 的 t=810）。
 *
 * 写到第 `maxLine` 行是硬失败：原版在那里会 `ArrayIndexOutOfBoundsException`
 * （`bufferedText` 只有 10 格）。JS 的数组会默默变长，于是"原版根本跑不起来
 * 的数据"在这边表现为多画一行——那是没人查得出来的错。今天 96 个场景里最长的
 * 一段旁白是 7 句，这条路走不到。
 */
export function tickNarratageWord(d: NarratageDraft): void {
  const line = d.lines[d.line]
  if (line === undefined) throw new Error(`旁白只有 ${d.lines.length} 句，取不到第 ${d.line} 句`)
  if (d.row >= MAX_LINE) {
    throw new Error(`旁白写到第 ${d.row} 行，原版的缓存只有 ${MAX_LINE} 行（会数组越界）`)
  }
  if (d.cursor === line.length) {
    d.text[d.row] = line.slice(0, d.cursor)
    // 原版这里 Clock.sleep(500)，睡的是真实时间，虚拟时钟上不占 tick。
    // 下面这行在原版里**永远走不到**：`count2` 要等于 10，上一行的
    // `bufferedText[10]` 就已经越界了。照抄进来，连同它走不到这件事一起。
    if (d.row === MAX_LINE) begin(d)
    d.line++
    d.row++
    d.cursor = 0
  } else {
    d.cursor++
    d.text[d.row] = line.slice(0, d.cursor)
  }
  if (d.line === d.lines.length) {
    // 同上，原版这里 Clock.sleep(1000)。
    stop(d)
  }
}

/** `Narratage.begin()`：清空缓存换一屏。**顺带把 `row` 清成 0**，照抄。 */
function begin(d: NarratageDraft): void {
  d.text = new Array<string | null>(MAX_LINE).fill(null)
  d.row = 0
}

/** `Narratage.stop()`：计数器归零、两个定时器停下、`over` 置位。 */
function stop(d: NarratageDraft): void {
  d.line = 0
  d.cursor = 0
  d.row = 0
  stopTimer(d.wordRun)
  stopTimer(d.background)
  d.active = false
  d.over = true
}

/** `Narratage.Background`：背景帧在 `0 .. BG_COUNT-1` 之间循环。 */
export function tickNarratageBackground(d: NarratageDraft): void {
  if (d.bg < BG_COUNT - 1) d.bg++
  else d.bg = 0
}

/**
 * 这一 tick 到期的旁白定时器。
 *
 * 次序是 `background` 再 `wordRun`：导出器按**字段名排序**装定时器
 * （`ExportTrace.sortedFields`），`Narratage` 的两个字段就是这个次序。
 * **这一条真值分辨得出来**：整段播完的那一拍 `stop()` 会把背景定时器停掉，
 * 反过来就少推一帧——dorm-intro 的 t=810 记的是 `bg=45`，先 `wordRun` 会得到 44。
 */
export function tickNarratageTimers(d: NarratageDraft, now: number): void {
  fireDue(d.background, now, BACKGROUND_MS, () => tickNarratageBackground(d), '旁白的背景定时器')
  fireDue(d.wordRun, now, WORD_MS, () => tickNarratageWord(d), '旁白的逐字定时器')
}
