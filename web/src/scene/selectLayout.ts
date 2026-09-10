/**
 * 选择框的摆位，从 `scene/SelectEvent.java` 的 `drawSelectImage` 里逐行搬出来
 * （xl-yg6.8）。
 *
 * **纯函数**，出参是逻辑画布（1024×640）上的矩形与基线坐标。抽出来的理由与
 * `narratageLayout.ts` / `ui/dialogueLayout.ts` 同一条：那几串常量
 * （`262, 245`、`292, 285 + 30 * i`、选中行的 `312` 与 `270 + 30 * i`）是
 * **可以对着原版逐个核**的，混进渲染器就只能靠眼睛看。
 *
 * ## 三支画法
 *
 * `drawSelectImage` 是 `if / else if / else if` 三支：
 *
 * | 分支 | 条件 | 用哪张图 | 光标 |
 * |---|---|---|---|
 * | 选择框 | `shopSelect \|\| battleSelect \|\| questionSelect \|\| equipmentSelect` | `选择框.png` | 是/否，画在 `count_selectYesNo` 那一行 |
 * | 问题框 | `isQuestion` | `问题框.png` | A/B/C/D，画在 `count_selectABCD` 那一行 |
 * | 回答框 | `isAnswer` | `选择框.png` | 无 |
 *
 * 第一、三支用的是同一张 `选择框.png`、同一套行距，差别只有画不画光标
 * （xl-yg6.8）。第二支是另一张图、另一套行距、光标跟另一个游标走（xl-yg6.9），
 * 它的每一个数由 `selectLayout.test.ts` 从 GBK 源码现读去撞。
 */
import { layoutLine } from './narratageLayout'
import type { Cell } from './narratageLayout'
import type { SelectState } from '../state/select'

/** 选择框贴在画布上的左上角。原版 `drawImage(selectImage, 262, 245, ...)`。 */
export const BOX_X = 262
export const BOX_Y = 245

/** `选择框.png` 的原始尺寸。源码注释写着 `// 500*150`，实测就是这个数。 */
export const BOX_WIDTH = 500
export const BOX_HEIGHT = 150

/** `icon.png` 的原始尺寸。源码注释写着 `// 24*24`。 */
export const ICON_SIZE = 24

/** `问题框.png` 贴在画布上的左上角：`x1_questionImage - 262`、`y1_questionImage - 70`。 */
export const QUESTION_BOX_X = 262
export const QUESTION_BOX_Y = 70

/** `问题框.png` 的原始尺寸。源码注释写着 `// 500*500`。 */
export const QUESTION_BOX_SIZE = 500

/** 问题框里第 0 行光标的顶边与正文的基线：`83 + 30 * i`、`100 + 30 * i`。 */
export const QUESTION_ICON_TOP = 83
export const QUESTION_BASELINE_TOP = 100

/** 正文字号。原版 `new Font("正楷", Font.BOLD, fontSize)` 的 `fontSize = 20`。 */
export const FONT_SIZE = 20

/** 一行的纵向步进。原版那三处 `30 * i`。 */
export const LINE_HEIGHT = 30

/** 正文左边缘：没选中的行 292，选中的行让开光标缩到 312。 */
export const TEXT_LEFT = 292
export const TEXT_LEFT_SELECTED = 312

/** 光标图的左边缘。 */
export const ICON_LEFT = 292

/** 第 `row` 行正文的**基线** y：`285 + 30 * i`。 */
export function baselineY(row: number): number {
  return 285 + LINE_HEIGHT * row
}

/** 第 `row` 行光标图的**顶边** y：`270 + 30 * i`。 */
export function iconY(row: number): number {
  return 270 + LINE_HEIGHT * row
}

/** 没选中的行是青色，选中的行是红色。原版 `Color.CYAN` / `Color.red`。 */
export const TEXT_COLOR = '#00ffff'
export const SELECTED_COLOR = '#ff0000'

/** 这一帧该画哪一支。`null` = 什么都不画。 */
export type SelectBoxKind = 'chooser' | 'question' | 'answer'

/**
 * `drawSelectImage` 那三支 `if` 的判别，外加 `paint()` 里那句
 * `if (selectEvent.isSelect)`。`null` 只有两种：`isSelect` 为假（原版这一帧
 * 压根不调 `drawSelectImage`），或者三个旗标一个都没亮（原版三支都不进）。
 */
export function selectBoxKind(select: SelectState): SelectBoxKind | null {
  if (!select.isSelect) return null
  if (select.shop || select.battle || select.question || select.equipShop) return 'chooser'
  if (select.asking) return 'question'
  if (select.answering) return 'answer'
  return null
}

/**
 * 这一帧那张图画在哪、从图上哪一块取。
 *
 * 两支都是 `drawImage(img, dx1, dy1, dx2, dy2, sx1, sy1, sx2, sy2, ...)`，而且
 * 源矩形与目标矩形**同尺寸**，所以是"揭开"动画，不是缩放：
 *
 * - 选择框：`(262, 245) → (262 + w, 245 + h)`，源从 `(0, 0)` 起；
 * - 问题框：`(x1, y1) → (x2, y2)`，源是它减去 `(262, 70)` —— 图贴在 (262, 70)，
 *   四个游标从屏幕中心往四角撑。
 *
 * ⚠️ **游标会长过图本身**：选择框的 `x_selectImage` 终值是 550、`y_selectImage`
 * 是 165，而图只有 500×150（判据是自增**前**的 `x <= 500`，见 `state/select.ts`）；
 * 问题框的 `x1` 停在 237、`x2` 停在 787，而图只有 500 宽。Java2D 对超出图边界
 * 的那一截什么都不画，所以这里把目标矩形夹进图在画布上占的那块、源跟着平移
 * —— 夹**源和目标两边**，画出来的像素与原版逐个相同；只夹源那一边就成了
 * 拉伸，那是另一回事。
 */
export interface BoxFrame {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** 源矩形在图上的左上角。 */
  readonly srcX: number
  readonly srcY: number
}

export function boxFrame(select: SelectState, kind: SelectBoxKind): BoxFrame {
  if (kind === 'question') {
    return clipped(
      select.qx1,
      select.qy1,
      select.qx2,
      select.qy2,
      QUESTION_BOX_X,
      QUESTION_BOX_Y,
      QUESTION_BOX_SIZE,
      QUESTION_BOX_SIZE,
    )
  }
  return clipped(BOX_X, BOX_Y, BOX_X + select.boxW, BOX_Y + select.boxH, BOX_X, BOX_Y, BOX_WIDTH, BOX_HEIGHT)
}

/** 目标矩形 `(x1,y1)-(x2,y2)` 与图在画布上那块 `(ox,oy,w,h)` 的交；源 = 交 − 图的原点。 */
function clipped(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  ox: number,
  oy: number,
  w: number,
  h: number,
): BoxFrame {
  const left = Math.max(x1, ox)
  const top = Math.max(y1, oy)
  const right = Math.min(x2, ox + w)
  const bottom = Math.min(y2, oy + h)
  const width = Math.max(0, right - left)
  const height = Math.max(0, bottom - top)
  return { x: left, y: top, width, height, srcX: left - ox, srcY: top - oy }
}

/** 一行正文：从哪个 x 起、基线在哪、什么颜色、要不要在它左边画一个光标、光标画在哪。 */
export interface SelectLine {
  readonly row: number
  readonly baseline: number
  readonly left: number
  readonly color: string
  readonly selected: boolean
  readonly text: string
  /** 光标图的左上角。只有 `selected` 的那一行才画它。 */
  readonly iconX: number
  readonly iconY: number
}

/**
 * 这一帧要画的每一行。
 *
 * 原版遍历的是 `bufferedText` 整个数组、跳过 `null` 的那几格
 * （`if (bufferedText[i] != null)`）—— 所以**行号就是数组下标**，
 * 不是"第几行有字"。折行会让某几格空着，压紧就错位了。
 *
 * 选中哪一行：选择框跟 `count_selectYesNo`、问题框跟 `count_selectABCD`，
 * 回答框没有光标（原版那一支没有 `i == ...` 的判断）。问题框的行距与选择框
 * 相同（`30 * i`），起点不同：光标 `83`、基线 `100`，横向两支都是 292 / 312。
 */
export function selectLines(select: SelectState, kind: SelectBoxKind): SelectLine[] {
  const selectedRow = kind === 'chooser' ? select.yesNo : kind === 'question' ? select.abcd : null
  const lines: SelectLine[] = []
  select.text.forEach((text, row) => {
    if (text === null) return
    const selected = row === selectedRow
    lines.push({
      row,
      baseline: kind === 'question' ? QUESTION_BASELINE_TOP + LINE_HEIGHT * row : baselineY(row),
      left: selected ? TEXT_LEFT_SELECTED : TEXT_LEFT,
      color: selected ? SELECTED_COLOR : TEXT_COLOR,
      selected,
      text,
      iconX: ICON_LEFT,
      iconY: kind === 'question' ? QUESTION_ICON_TOP + LINE_HEIGHT * row : iconY(row),
    })
  })
  return lines
}

/**
 * 一行正文铺成的字符格。**与旁白共用 `layoutLine`**：两处都是
 * `Font.BOLD, 20` 的 `drawString(整行)`，全角字在 Java2D 里都是整 20 px 的
 * 步进，浏览器的不是 —— 理由与实测见 `narratageLayout.ts`。
 */
export function selectCells(line: SelectLine, measure: (char: string) => number): Cell[] {
  return layoutLine(line.text, measure, line.left)
}
