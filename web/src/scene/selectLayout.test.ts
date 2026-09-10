import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { createSelect, selectKeyPressed, showSelectQuestion, tickSelectTimers, toSelectDraft, fromSelectDraft } from '../state/select'
import type { SelectDraft, SelectState } from '../state/select'
import { TICK_MS } from '../state/step'
import { javaSource } from '../test/javaSource'
import { QUESTION_BOX_SIZE, boxFrame, selectBoxKind, selectLines } from './selectLayout'

/**
 * 问题框那一支的摆位（xl-yg6.9）。**每一个数都从 `drawSelectImage` 的
 * `else if (isQuestion)` 那一段现读**，不在这里另抄。
 *
 * 真值不记这些：状态层记的是 `qx1..qy2` 与 `abcd`（那些逐 tick 已对齐），而
 * 它们落到画布上的哪个像素，是这一层的事 —— 跨端逐帧比对之外，就只有这里。
 */

/** `drawSelectImage` 里问题框那一段的原文，挤掉空白。 */
function questionBranch(): string {
  const source = javaSource('src/scene/SelectEvent.java').replace(/\s+/g, ' ')
  const start = source.indexOf('} else if (isQuestion) {')
  const end = source.indexOf('} else if (isAnswer) {')
  // 空转要响：解码或界标错了，下面每一个 readInts 都会抛"没匹配到"，而不是
  // 拿一个空串悄悄比过去。
  if (start < 0 || end <= start) throw new Error('SelectEvent.drawSelectImage 里找不到问题框那一段')
  return source.slice(start, end)
}

/** 一条正则在那一段里恰好一处匹配，返回各组的整数。组数不是 `n` 也抛。 */
function readInts(text: string, re: RegExp, n: 1): [number]
function readInts(text: string, re: RegExp, n: 3): [number, number, number]
function readInts(text: string, re: RegExp, n: number): number[] {
  const all = [...text.matchAll(new RegExp(re.source, 'g'))]
  if (all.length !== 1) throw new Error(`${re} 在问题框那一段里匹配到 ${all.length} 处，应为 1 处`)
  const groups = all[0]!.slice(1).map(Number)
  if (groups.length !== n || groups.some(Number.isNaN)) throw new Error(`${re} 取出来的是 ${groups}，应为 ${n} 个整数`)
  return groups
}

const BRANCH = questionBranch()
/** `drawImage(questionImage, x1, y1, x2, y2, x1 - X, y1 - Y, ...)` 里的 X / Y：图贴在画布上的左上角。 */
const [IMAGE_X] = readInts(BRANCH, /x1_questionImage - (\d+), y1_questionImage - \d+, x2_questionImage/, 1)
const [IMAGE_Y] = readInts(BRANCH, /x1_questionImage - \d+, y1_questionImage - (\d+), x2_questionImage/, 1)
/** 光标：`drawImage(selectIcon, X, Y + STEP * i, scene)`。 */
const [ICON_X, ICON_TOP, ICON_STEP] = readInts(BRANCH, /g\.drawImage\(selectIcon, (\d+), (\d+) \+ (\d+) \* i, scene\)/, 3)
/** 选中那一行：`drawString(bufferedText[i], X, Y + STEP * i)`，紧跟在 `Color.red` 之后。 */
const [SELECTED_X, SELECTED_BASE, SELECTED_STEP] = readInts(
  BRANCH,
  /setColor\(Color\.red\); g\.drawString\(bufferedText\[i\], (\d+), (\d+) \+ (\d+) \* i\)/,
  3,
)
/** 其余的行：`else { drawString(bufferedText[i], X, Y + STEP * i) }`。 */
const [PLAIN_X, PLAIN_BASE, PLAIN_STEP] = readInts(
  BRANCH,
  /\} else \{ g\.drawString\(bufferedText\[i\], (\d+), (\d+) \+ (\d+) \* i\)/,
  3,
)

function settle(d: SelectDraft, from: number): number {
  let now = from
  for (let i = 0; i < 4000; i++) {
    if (!d.selectImageMove.running && !d.questionImageMove.running && !d.wordsRun.running) return now
    tickSelectTimers(d, now)
    now += TICK_MS
  }
  throw new Error('选择框的三个定时器 4000 拍还没停下来')
}

const noHost = {
  fight: () => {},
  switchTo: () => {},
  present: () => {},
  random: () => 0.5,
}

/** 大活第 0 道题：选「是」之后翻到问题框，`upTo` 拍之前停下（`Infinity` = 吐完）。 */
function asking(upTo = Infinity): SelectState {
  const built = createSelect(getScene('大活'), [])
  const d = toSelectDraft(built.select, built.recorder)
  showSelectQuestion(d, 0, 0)
  let now = settle(d, 0)
  selectKeyPressed(d, 'enter', now, noHost)
  for (let i = 0; i < upTo && (d.questionImageMove.running || d.wordsRun.running); i++) {
    tickSelectTimers(d, now)
    now += TICK_MS
  }
  if (!d.asking) throw new Error('夹具没走到问题框')
  return fromSelectDraft(d)
}

describe('问题框（drawSelectImage 的第二支）', () => {
  it('isQuestion 且四个 *Select 都为假时画问题框', () => {
    const s = asking()
    expect(selectBoxKind(s)).toBe('question')
    // 反面：同一个状态落回「要不要答题」那一步，画的就是选择框 —— 否则
    // "判成问题框"与"什么都判成问题框"长得一样。
    expect(selectBoxKind({ ...s, question: true })).toBe('chooser')
    expect(selectBoxKind({ ...s, isSelect: false })).toBeNull()
  })

  /**
   * 源矩形 = 目标矩形 −(X, Y)：同尺寸，是"揭开"不是缩放。游标会长过图本身
   * （`x1` 停在 237、`x2` 停在 787，图只有 500 宽），Java2D 对图外那一截什么都
   * 不画，所以两边一起夹到图的范围里 —— 与选择框那一支同一个处理。
   */
  it('撑开的过程：以图的左上角为原点揭开，夹在图的范围里', () => {
    const first = asking(0)
    // 刚翻过来那一拍四个游标都在屏幕中心：宽高都是 0。
    expect(boxFrame(first, 'question')).toMatchObject({ width: 0, height: 0 })

    // 12 拍 = 120 ms：问题框的定时器 50 ms 一次，撑过两回、还没撑出图外。
    const mid = asking(12)
    const f = boxFrame(mid, 'question')
    expect(f).toEqual({
      x: mid.qx1,
      y: mid.qy1,
      width: mid.qx2 - mid.qx1,
      height: mid.qy2 - mid.qy1,
      srcX: mid.qx1 - IMAGE_X,
      srcY: mid.qy1 - IMAGE_Y,
    })
    expect(f.width).toBeGreaterThan(0)

    const done = asking()
    // 撑过头了（夹具先核一遍，否则"夹住了"与"本来就没超出"长得一样）……
    expect(done.qx1).toBeLessThan(IMAGE_X)
    expect(done.qx2 - done.qx1).toBeGreaterThan(QUESTION_BOX_SIZE)
    // ……画出来的正好是整张图，贴在 (X, Y)。
    expect(boxFrame(done, 'question')).toEqual({
      x: IMAGE_X,
      y: IMAGE_Y,
      width: QUESTION_BOX_SIZE,
      height: QUESTION_BOX_SIZE,
      srcX: 0,
      srcY: 0,
    })
  })

  it('每一行：选中的是 count_selectABCD 那一行，光标与两种行的坐标都照原版', () => {
    const s = asking()
    const lines = selectLines(s, 'question')
    expect(lines.length).toBeGreaterThan(0)
    const selected = lines.filter((l) => l.selected)
    expect(selected.map((l) => l.row)).toEqual([s.abcd])
    for (const line of lines) {
      if (line.selected) {
        expect([line.left, line.baseline]).toEqual([SELECTED_X, SELECTED_BASE + SELECTED_STEP * line.row])
        expect([line.iconX, line.iconY]).toEqual([ICON_X, ICON_TOP + ICON_STEP * line.row])
      } else {
        expect([line.left, line.baseline]).toEqual([PLAIN_X, PLAIN_BASE + PLAIN_STEP * line.row])
      }
    }
    // 光标换一行，选中的那一行跟着换 —— 不是恰好落在某个固定行上。
    const moved = selectLines({ ...s, abcd: s.abcd + 1 }, 'question').filter((l) => l.selected)
    expect(moved.map((l) => l.row)).toEqual([s.abcd + 1])
  })

  it('选择框那一支不受影响：光标仍跟 count_selectYesNo 走', () => {
    const s = { ...asking(), question: true }
    // 夹具先核：是/否光标落的那一行确实有字 —— 否则"没有选中行"也会过。
    expect(s.text[s.yesNo]).not.toBeNull()
    const selected = selectLines(s, 'chooser').filter((l) => l.selected)
    expect(selected.map((l) => l.row)).toEqual([s.yesNo])
  })
})
