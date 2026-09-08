/**
 * 开始界面上那两颗按钮的摆位与命中框（xl-kaa）。
 *
 * 数字全部照抄 `src/start/StartPanel.java` 的 `initialButtons()`：
 *
 *     start = new StartButton(200, 150, 50, 50, 起.png,  起2.png, 起2.png, …)
 *     load  = new StartButton(200, 250, 50, 50, 承.png,  承2.png, 承2.png, …)
 *
 * `buttons.test.ts` 把这两行从 GBK 源码里现读出来逐个数比，所以这里抄错一个
 * 数会红 —— 不然"按钮偏了 50 px"在画面上完全说不出对错。
 *
 * ## 画在哪儿 ≠ 点在哪儿
 *
 * 原版 `StartButton.drawButton` 画在 `(x, y)`，而三个判定
 * （`isMoveIn` / `isPressedButton` / `isRelesedButton`）用的都是同一个
 * **偏移过的**矩形：
 *
 *     currentX > x-15 && currentX < x+width-15 && currentY > y-6 && currentY < y+height-6
 *
 * 也就是命中框整个往左上挪了 (15, 6)。这不是笔误，是原版三处一致的写法，
 * 而且战斗面板的命令按钮是**同一个** −15 / −6（见 `game/session.test.ts` 里
 * 那个 `attack.x - 15, attack.y - 6`）。照抄。
 *
 * 四个不等号都是**严格**的，所以命中框的四条边本身不算命中；宽高各少一格。
 */

/** 原版那两颗按钮的逻辑名。与 `assets.ts` 的图片名一一对应。 */
export type StartButtonKey = 'newGame' | 'load'

export interface StartButtonSpec {
  readonly key: StartButtonKey
  /** `new StartButton(x, y, width, height, …)` 的前四个数。**画**在这里。 */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** 读屏与测试要的名字。原版按钮上只有一个「起」/「承」字，没有可读文本。 */
  readonly label: string
}

/** 命中框相对绘制位置的偏移，见文件头注。 */
export const HIT_OFFSET_X = -15
export const HIT_OFFSET_Y = -6

export const START_BUTTONS: readonly StartButtonSpec[] = [
  { key: 'newGame', x: 200, y: 150, width: 50, height: 50, label: '开始新游戏' },
  { key: 'load', x: 200, y: 250, width: 50, height: 50, label: '读取存档' },
]

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** 一颗按钮**点得着**的那个矩形（不是画出来的那个）。 */
export function startButtonHitBox(button: StartButtonSpec): Rect {
  return {
    x: button.x + HIT_OFFSET_X,
    y: button.y + HIT_OFFSET_Y,
    width: button.width,
    height: button.height,
  }
}

/** 舞台逻辑坐标 `(px, py)` 落在这颗按钮上吗。四个不等号照抄原版，都是严格的。 */
export function hitsStartButton(button: StartButtonSpec, px: number, py: number): boolean {
  return (
    px > button.x - 15 &&
    px < button.x + button.width - 15 &&
    py > button.y - 6 &&
    py < button.y + button.height - 6
  )
}
