import type { ButtonImage, MenuButtonState } from './types'

/**
 * `tools.GameButton` 与 `menu.MenuButton` 的那四个方法，逐行照抄。
 *
 * 三件事在这里，因为三件事都会**悄悄地错**：
 *
 * 1. **命中框比画出来的位置偏左 15、偏上 6**（`currentX>x-15 && currentX<x+width-15`）。
 *    原版历史遗留，不是笔误。抹掉它之后按钮中心照样点得中 —— 菜单真值里那几个
 *    落点正是按钮中心，两个矩形都盖得住（`docs/agents/dispatch.md` 那条
 *    「这一场观测不到」）。真正会露头的是边缘。
 * 2. **`isMoveIn` 字段恒为 `false`**：`else` 只盖住了 `buttonImage=normalImage;`
 *    一句，`isMoveIn=false;` 少了大括号，每次调用无条件跑。贴图照样换成
 *    `waitclickImage`（那一句在 `if` 里面），所以画面上悬停是好的、字段是坏的。
 * 3. **`isDraw=No` 时 `isPressedButton` 整个跳过**（`MenuButton` 的覆写），
 *    而 `isRelesedButton` **没有**这层保护（`MenuButton` 不覆写它）。
 */

/** `currentX>x-15&&currentX<(x+width-15)&&currentY>(y-6)&&currentY<(y+height-6)` */
export function hits(b: MenuButtonState, x: number, y: number): boolean {
  return x > b.x - 15 && x < b.x + b.width - 15 && y > b.y - 6 && y < b.y + b.height - 6
}

/** `MenuButton.isPressedButton`：`isDraw` 为 `No` 时什么都不做。 */
export function pressButton(b: MenuButtonState, x: number, y: number): void {
  if (!b.isDraw) return
  if (hits(b, x, y)) {
    b.image = 'pressed'
    b.isclicked = true
  } else {
    b.image = 'normal'
  }
}

/** `GameButton.isRelesedButton`。**不看 `isDraw`** —— 原版没覆写它。 */
export function releaseButton(b: MenuButtonState, x: number, y: number): void {
  if (hits(b, x, y)) {
    b.image = 'waitclick'
    b.isclicked = false
  } else {
    b.image = 'normal'
  }
}

/** `GameButton.isMoveIn`。见文件头注第 2 条：`isMoveIn` 这个字段恒为 `false`。 */
export function moveInButton(b: MenuButtonState, x: number, y: number): void {
  if (hits(b, x, y)) {
    b.image = 'waitclick'
    b.isMoveIn = true
  } else {
    b.image = 'normal'
  }
  // ⚠️ 原版这一句在 `else` 外面（少了大括号），照抄。
  b.isMoveIn = false
}

export function menuButton(
  x: number,
  y: number,
  width: number,
  height: number,
  isDraw: boolean,
): MenuButtonState {
  const image: ButtonImage = 'normal'
  return { x, y, width, height, isDraw, isclicked: false, isMoveIn: false, image }
}
