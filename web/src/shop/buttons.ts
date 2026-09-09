import type { ShopButtonBox } from './layout'

/**
 * `tools.GameButton` 那三个判定方法，逐行照抄 —— **基类那一份，不是
 * `menu.MenuButton` 的覆写版**。
 *
 * 这是与 `menu/buttons.ts` 唯一的实质差别，也是不共用那一份的理由：
 * `MenuButton` 覆写了 `isPressedButton`，`isDraw` 为 `No` 时整个跳过；
 * 商店的按钮是**裸的 `GameButton`**，没有 `isDraw` 这回事。共用菜单那一份的
 * 表现是这里凭空多出一个恒为 `true` 的字段，而"永远真的守卫"与"没有守卫"
 * 长得一样。
 *
 * 两处照抄的缺陷：
 *
 * 1. **命中框比画出来的位置偏左 15、偏上 6**（`x-15 < cx < x+width-15`，
 *    `y-6 < cy < y+height-6`），四个不等号都是严格的。原版历史遗留。
 * 2. **`isMoveIn` 字段恒为 `false`**：`else` 只盖住了 `buttonImage=normalImage;`
 *    那一句，`isMoveIn=false;` 少了大括号，每次调用无条件跑。贴图照样换成
 *    `waitclickImage`（那一句在 `if` 里面），所以画面上悬停是好的、字段是坏的。
 */

/** 一颗按钮现在贴三张里的哪一张。真值不记它；绘制层与逐帧比对记。 */
export type ShopButtonImage = 'normal' | 'waitclick' | 'pressed'

/**
 * 按钮的**逻辑名**。它就是真值 `pressed` 那一列里的字符串，也是
 * `ShopDriver.buttonLabel(i)` 算出来的那一个。
 */
export type ShopButtonLabel =
  | 'buy'
  | 'sell'
  | 'back'
  | `category:${string}`
  | `plus:${number}`
  | `minus:${number}`

export interface ShopButtonState extends ShopButtonBox {
  readonly label: ShopButtonLabel
  isclicked: boolean
  isMoveIn: boolean
  image: ShopButtonImage
}

export function shopButton(label: ShopButtonLabel, box: ShopButtonBox): ShopButtonState {
  return { label, ...box, isclicked: false, isMoveIn: false, image: 'normal' }
}

/** `currentX>x-15&&currentX<(x+width-15)&&currentY>(y-6)&&currentY<(y+height-6)` */
export function hits(b: ShopButtonBox, x: number, y: number): boolean {
  return x > b.x - 15 && x < b.x + b.width - 15 && y > b.y - 6 && y < b.y + b.height - 6
}

/**
 * `GameButton.isPressedButton`。⚠️ **`else` 里不置 `isclicked=false`** ——
 * 原版就没有那一句，所以按下之后 `isclicked` 一直挂着，直到
 * `isRelesedButton` 把它抹掉。整个 `setButton()` 依赖这件事。
 */
export function pressButton(b: ShopButtonState, x: number, y: number): void {
  if (hits(b, x, y)) {
    b.image = 'pressed'
    b.isclicked = true
  } else {
    b.image = 'normal'
  }
}

/** `GameButton.isRelesedButton`。 */
export function releaseButton(b: ShopButtonState, x: number, y: number): void {
  if (hits(b, x, y)) {
    b.image = 'waitclick'
    b.isclicked = false
  } else {
    b.image = 'normal'
  }
}

/** `GameButton.isMoveIn`。见文件头注第 2 条：`isMoveIn` 这个字段恒为 `false`。 */
export function moveInButton(b: ShopButtonState, x: number, y: number): void {
  if (hits(b, x, y)) {
    b.image = 'waitclick'
    b.isMoveIn = true
  } else {
    b.image = 'normal'
  }
  // ⚠️ 原版这一句在 `else` 外面（少了大括号），照抄。
  b.isMoveIn = false
}

/** 当前 `isclicked` 的那几颗，**按按钮表的次序**。真值 `pressed` 那一列。 */
export function clickedLabels(buttons: readonly ShopButtonState[]): ShopButtonLabel[] {
  return buttons.filter((b) => b.isclicked).map((b) => b.label)
}
