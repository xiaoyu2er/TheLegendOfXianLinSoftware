/**
 * 选择框的摆位，从 `scene/SelectEvent.java` 的 `drawSelectImage` 里逐行搬出来
 * （xl-yg6.8）。
 *
 * **纯函数**，出参是逻辑画布（1024×640）上的矩形与基线坐标。抽出来的理由与
 * `narratageLayout.ts` / `ui/dialogueLayout.ts` 同一条：那几串常量
 * （`262, 245`、`292, 285 + 30 * i`、选中行的 `312` 与 `270 + 30 * i`）是
 * **可以对着原版逐个核**的，混进渲染器就只能靠眼睛看。
 *
 * ## 三支画法，这里做两支
 *
 * `drawSelectImage` 是 `if / else if / else if` 三支：
 *
 * | 分支 | 条件 | 用哪张图 | 光标 |
 * |---|---|---|---|
 * | 选择框 | `shopSelect \|\| battleSelect \|\| questionSelect \|\| equipmentSelect` | `选择框.png` | 是/否，画在 `count_selectYesNo` 那一行 |
 * | 问题框 | `isQuestion` | `问题框.png` | A/B/C/D，画在 `count_selectABCD` 那一行 |
 * | 回答框 | `isAnswer` | `选择框.png` | 无 |
 *
 * **第二支（问题框）归 xl-yg6.9**，这里只做第一、三支 —— 它们用的是同一张
 * `选择框.png`、同一套行距，差别只有画不画光标。`selectBox()` 对问题框那一段
 * 返回 `null`，由调用方（`sceneRenderer`）什么都不画。
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

/**
 * 选择框那张图这一帧露出多少。
 *
 * 原版是 `drawImage(img, 262, 245, 262 + w, 245 + h, 0, 0, w, h, ...)` ——
 * 源矩形与目标矩形**同尺寸**，所以它是一个"揭开"动画，不是缩放。
 *
 * ⚠️ **游标会长过图本身**：`x_selectImage` 的终值是 550、`y_selectImage` 是
 * 165，而图只有 500×150（判据是自增**前**的 `x <= 500`，见
 * `state/select.ts`）。Java2D 对超出图边界的那一截什么都不画，所以这里把两边
 * 一起夹到图的尺寸 —— 夹**源和目标两边**，画出来的像素与原版逐个相同；
 * 只夹源那一边就成了拉伸，那是另一回事。
 */
export interface BoxRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function boxRect(select: SelectState): BoxRect {
  return {
    x: BOX_X,
    y: BOX_Y,
    width: Math.min(select.boxW, BOX_WIDTH),
    height: Math.min(select.boxH, BOX_HEIGHT),
  }
}

/** 这一帧该画哪一支。`null` = 什么都不画（`isSelect` 为假，或者是问题框那一支）。 */
export type SelectBoxKind = 'chooser' | 'answer'

/**
 * `drawSelectImage` 那三支 `if` 的判别，外加 `paint()` 里那句
 * `if (selectEvent.isSelect)`。
 *
 * 返回 `null` 的两种情形要分得开，所以第二种在注释里写明：
 *
 * - `isSelect` 为假 —— 原版这一帧压根不调 `drawSelectImage`；
 * - 问题框那一支（`isQuestion` 且四个 `*Select` 都为假）—— **原版画的，
 *   这一层还没做**，归 xl-yg6.9。
 */
export function selectBoxKind(select: SelectState): SelectBoxKind | null {
  if (!select.isSelect) return null
  if (select.shop || select.battle || select.question || select.equipShop) return 'chooser'
  if (select.asking) return null
  if (select.answering) return 'answer'
  return null
}

/** 一行正文：从哪个 x 起、基线在哪、什么颜色、要不要在它左边画一个光标。 */
export interface SelectLine {
  readonly row: number
  readonly baseline: number
  readonly left: number
  readonly color: string
  readonly selected: boolean
  readonly text: string
}

/**
 * 这一帧要画的每一行。
 *
 * 原版遍历的是 `bufferedText` 整个数组、跳过 `null` 的那几格
 * （`if (bufferedText[i] != null)`）—— 所以**行号就是数组下标**，
 * 不是"第几行有字"。折行会让某几格空着，压紧就错位了。
 *
 * 光标只在 `chooser` 那一支画（回答框那一支原版没有 `i == ...` 的判断）。
 */
export function selectLines(select: SelectState, kind: SelectBoxKind): SelectLine[] {
  const lines: SelectLine[] = []
  select.text.forEach((text, row) => {
    if (text === null) return
    const selected = kind === 'chooser' && row === select.yesNo
    lines.push({
      row,
      baseline: baselineY(row),
      left: selected ? TEXT_LEFT_SELECTED : TEXT_LEFT,
      color: selected ? SELECTED_COLOR : TEXT_COLOR,
      selected,
      text,
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
