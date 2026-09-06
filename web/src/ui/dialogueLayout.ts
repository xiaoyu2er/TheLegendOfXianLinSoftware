/**
 * 对话框的摆位，从 `scene/Dialogue.java` 的 `drawDialogue` 里逐行搬出来。
 *
 * **纯函数**，入参是 `DialogueState`，出参是逻辑画布（1024×640）上的矩形与
 * 字符格。抽出来的理由只有一条：`drawDialogue` 里那几串常量
 * （`160 + 40 + j * 20`、`480 + 30 + i * 30`、两种对话框各自的源矩形）是
 * **可以对着原版逐个核**的，而它们一旦混进 React 组件里就只能靠眼睛看。
 * 这里核完，`DialogueBox.tsx` 就只剩"把矩形贴成 div"这一件事。
 *
 * ## 两种对话框
 *
 * | | 样式 0（头像式） | 样式 1（名字式） |
 * |---|---|---|
 * | 对话框 | 从 (160,480) 往右下**长**到 640×640 | 从 (752,192) 往左上**长**到 (272,32) |
 * | 陪衬 | 224×224 的头像从右边滑进来 | 192×32 的名字牌从左边滑进来 |
 * | 正文原点 | 固定 (200, 520) | 跟着对话框：(boxX+40, boxY+40) |
 *
 * 两种都是**源矩形与目标矩形同尺寸**的"揭开"动画，不是缩放：原版那两句
 * `drawImage` 的 8 个参数算下来 `dw == sw`、`dh == sh`。所以 CSS 侧就是一个
 * 裁剪窗口加一个背景偏移，不需要 `background-size`。
 *
 * ## 不追求逐像素
 *
 * 正文用的是 `文鼎粗钢笔行楷`，绝大多数机器上没有；Java2D 的基线与 DOM 的
 * 行盒也不是一回事。所以这一层给的是**原版的基线坐标**，组件把它换算成
 * `top` 时要减一个近似的上伸高度（`BASELINE_TO_TOP`）。跨端逐帧比对里对话框
 * 这一块因此永远是"已知缺口"，`src/compare/expected.ts` 里写明了。
 */
import type { DialogueState } from '../state/dialogue'
import { MAX_COL, MAX_ROW } from '../state/dialogue'

/** 正文字号与名字字号。原版 `fontSize_dialogue` / `fontSize_name`。 */
export const FONT_SIZE = 20
export const NAME_FONT_SIZE = 30

/** 一个字符格的步进：横向 20（= 字号），纵向 30。 */
export const CELL_WIDTH = FONT_SIZE
export const CELL_HEIGHT = 30

/** 四张固定图的原始尺寸。 */
export const BOX_WIDTH = 480
export const BOX_HEIGHT = 160
export const NAME_WIDTH = 192
export const NAME_HEIGHT = 32
export const HEAD_SIZE = 224
export const ICON_SIZE = 32

/**
 * 等待提示比正文基线高多少。原版正文画在 `+40`、图标画在 `+30`，差 10。
 */
export const ICON_BASELINE_LIFT = 10

/**
 * 基线 → 行盒顶边的近似换算。CJK 字形的上伸高度约 0.8 em，这里取整。
 * **它是近似**：Java2D 按字体的 ascent 摆，DOM 按行盒摆，同一个数字在两边
 * 不会得到同一行像素。见文件头。
 */
export const BASELINE_TO_TOP = 16

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** 一块从大图里裁出来贴上去的区域。`sourceX/Y` 是背景图要偏移的量。 */
export interface Patch extends Rect {
  readonly sourceX: number
  readonly sourceY: number
}

/** 一个字符格。`x`/`y` 是原版的 `drawString` 基线坐标。 */
export interface Cell {
  readonly char: string
  readonly x: number
  readonly y: number
  /** 处在 `【…】` 里面（含两个括号本身）—— 原版把这一段画成红色。 */
  readonly red: boolean
}

/** 对话框本身。`null` = 这个样式号原版不画（`type` 只有 0 和 1 两个分支）。 */
export function boxPatch(d: DialogueState): Patch | null {
  if (d.type === 0) {
    // g.drawImage(img, 160, 480, x, y, 0, 0, x - 160, y - 480)
    return { x: 160, y: 480, width: d.boxX - 160, height: d.boxY - 480, sourceX: 0, sourceY: 0 }
  }
  if (d.type === 1) {
    // g.drawImage(img, x, y, 752, 192, x - 272, y - 32, 480, 160)
    return {
      x: d.boxX,
      y: d.boxY,
      width: 752 - d.boxX,
      height: 192 - d.boxY,
      sourceX: d.boxX - 272,
      sourceY: d.boxY - 32,
    }
  }
  return null
}

/** 头像。只有样式 0 有。 */
export function headRect(d: DialogueState): Rect | null {
  if (d.type !== 0) return null
  return { x: d.headX, y: d.headY, width: HEAD_SIZE, height: HEAD_SIZE }
}

/** 名字牌。只有样式 1 有。名字本身画在 `(x, y + 28)` 的基线上。 */
export function namePlateRect(d: DialogueState): Rect | null {
  if (d.type !== 1) return null
  return { x: d.nameX, y: d.nameY, width: NAME_WIDTH, height: NAME_HEIGHT }
}

/** 名字的基线 y。原版 `g.drawString(name, x_name, y_name + 28)`。 */
export function nameBaselineY(d: DialogueState): number {
  return d.nameY + 28
}

/** 正文这一屏的原点（第 0 行第 0 列那个字的基线）。 */
function textOrigin(d: DialogueState): { x: number; y: number } | null {
  if (d.type === 0) return { x: 160 + 40, y: 480 + 40 }
  if (d.type === 1) return { x: d.boxX + 40, y: d.boxY + 40 }
  return null
}

/**
 * 这一屏要画的字符格。
 *
 * `isPrint` 为假时**一个字都不画** —— 对话框还在滑入，原版那整段
 * `if (isPrint)` 都不进。
 *
 * `@` 与 `$` 占着格子但不画（原版是两个 `continue`，副作用已经在状态层里
 * 处理了，见 `state/dialogue.ts` 的 `writeChar`）。红色是从 `【` 起、到 `】`
 * 止，**两个括号本身也是红的**：原版在画完 `】` 之后才把颜色调回蓝色。
 * 颜色跨行、跨格延续，因为原版那个 `g.setColor` 是整个循环共用的。
 */
export function textCells(d: DialogueState): Cell[] {
  if (!d.printing) return []
  const origin = textOrigin(d)
  if (!origin) return []
  const cells: Cell[] = []
  let red = false
  for (let i = 0; i < MAX_ROW; i++) {
    for (let j = 0; j < MAX_COL; j++) {
      const char = d.text[i]?.[j]
      if (char === null || char === undefined) continue
      if (char === '@' || char === '$') continue
      if (char === '【') red = true
      cells.push({
        char,
        x: origin.x + j * CELL_WIDTH,
        y: origin.y + i * CELL_HEIGHT,
        red,
      })
      if (char === '】') red = false
    }
  }
  return cells
}

/**
 * 等待提示（那个一闪一闪的小图标）。
 *
 * 只在"这一句打完了"或"这一屏满了"时画，位置是**最后一个画出来的字**那一格
 * ——原版在循环里每画一个字就把 `x_icon1/y_icon1` 覆盖一次，出了循环剩下的
 * 就是最后一个。纵向比正文基线高 10 px（`+30` 对 `+40`）。
 */
export function waitIconRect(d: DialogueState): Rect | null {
  if (!d.printing) return null
  if (!d.sentenceOver && !d.pageOver) return null
  const cells = textCells(d)
  const last = cells[cells.length - 1]
  if (!last) return null
  return {
    x: last.x,
    y: last.y - ICON_BASELINE_LIFT,
    width: ICON_SIZE,
    height: ICON_SIZE,
  }
}
