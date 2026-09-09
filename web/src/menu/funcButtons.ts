import { menuButton, pressButton, releaseButton } from './buttons'
import type { MenuButtonState } from './types'

/**
 * 天书页那一排按钮（`menu.FuncButtons`）—— **骨架这一票只做到它是一页、
 * 五颗按钮画得出来、「返回」回得去场景**。
 *
 * 完整的那一页（设定子菜单的展开与收起、BGM 开关、退出与重开、存档与提取）
 * 归 **xl-6lo.12**；存档 / 提取的后半段归 M6、退出与重开的后半段归 M7
 * （xl-6lo.2 §边界跟真值走）。所以下面那几颗按钮**建得出来、点得响、背后是
 * 空实现**，每一处空实现留一行注释指向接手的票号 —— 不画或者禁用都会引入一个
 * 原版没有的差异，而真值第 0 帧的 `func.drawn` 就写着六个按钮名。
 *
 * ⚠️ `setKey`（键盘设定）**开局就是画得出来的**，尽管它是个子按钮：
 * `addButton()` 末尾那两层循环只关 `subButtonList[1..4]`，而 `setKey` 一个
 * 数组都没进去。真值第 0 帧的 `func.drawn` 里有它，就是这么来的。这不是笔误。
 */

/** `addButton()` 里那五个局部常量。 */
const X = 400
const Y = 150
const W = 88
const H = 50
const SUB_Y = 230
const SUB_W = 145
const SUB_H = 40
const Y_MOVE = 10
const ON_W = 40
const ON_H = 40

/** 五颗主按钮，次序同 `buttonList[0..4]`。 */
export type FuncMainKey = 'saveButton' | 'readButton' | 'setButton' | 'returnButton' | 'exitButton'

export const FUNC_MAIN_ORDER: readonly FuncMainKey[] = [
  'saveButton',
  'readButton',
  'setButton',
  'returnButton',
  'exitButton',
]

/** 子按钮，按原版字段名。开局除 `setKey` 外一律不画。 */
export type FuncSubKey =
  | 'setBGM'
  | 'setClick'
  | 'setKey'
  | 'on_BGM'
  | 'off_BGM'
  | 'on_click'
  | 'off_click'
  | 'exitForSure'
  | 'restart'

export interface FuncButtonsState {
  readonly main: Readonly<Record<FuncMainKey, MenuButtonState>>
  readonly sub: Readonly<Record<FuncSubKey, MenuButtonState>>
  /** 「返回」这一步被按下了 —— 会话读它，把面板换回场景。 */
  exitToScene: boolean
}

export function createFuncButtons(): FuncButtonsState {
  const main = {} as Record<FuncMainKey, MenuButtonState>
  FUNC_MAIN_ORDER.forEach((key, i) => {
    // `x_move` 恒为 0，所以那几个 `+n*x_move` 项一律是 0。照抄倍数即可。
    main[key] = menuButton(X + i * W, Y, W, H, true)
  })
  const sub: Record<FuncSubKey, MenuButtonState> = {
    setBGM: menuButton(X + 2 * W, SUB_Y, SUB_W, SUB_H, false),
    setClick: menuButton(X + 2 * W, SUB_Y + (Y_MOVE + SUB_H), SUB_W, SUB_H, false),
    // ⚠️ 唯一开局就画的子按钮 —— 见文件头注。
    setKey: menuButton(X + 2 * W, SUB_Y + 2 * (Y_MOVE + SUB_H), SUB_W, SUB_H, true),
    on_BGM: menuButton(X + 4 * W, SUB_Y - Y_MOVE, ON_W, ON_H, false),
    off_BGM: menuButton(X + 4 * W, SUB_Y + 2 * Y_MOVE + 10, ON_W, ON_H, false),
    on_click: menuButton(X + 4 * W, SUB_Y - Y_MOVE + SUB_H, ON_W, ON_H, false),
    off_click: menuButton(X + 4 * W, SUB_Y + 2 * Y_MOVE + 10 + SUB_H, ON_W, ON_H, false),
    exitForSure: menuButton(X + 4 * W, SUB_Y, SUB_W, SUB_H, false),
    restart: menuButton(X + 4 * W, SUB_Y + (Y_MOVE + SUB_H), SUB_W, SUB_H, false),
  }
  return { main, sub, exitToScene: false }
}

/**
 * `FuncButtons.checkPressed` 的**骨架那一半**：五颗主按钮的命中判据、
 * 换页那一声、以及「返回」回场景。
 *
 * 没做的那一半（子按钮的展开与收起、BGM 开关、存档 / 提取 / 退出）归
 * xl-6lo.12，**所以这一层今天不出 `func` 这一组快照** —— 出一个只对了一半的
 * `func.drawn` 会让「做完了」与「只做了骨架」长得一样。登记见
 * `menuTrace.test.ts` 的 `PENDING.func`。
 */
export function funcCheckPressed(
  fb: FuncButtonsState,
  x: number,
  y: number,
  music: string[],
): void {
  for (const key of FUNC_MAIN_ORDER) pressButton(fb.main[key], x, y)
  for (const key of FUNC_MAIN_ORDER) {
    if (!fb.main[key].isclicked) continue
    music.push('换list.wav')
    // 存档 / 提取 → M6（进 ls 面板）；退出与重开 → M7；设定子菜单 → xl-6lo.12。
    if (key === 'returnButton') fb.exitToScene = true
    // ⚠️ 原版是 if-**else** 链，第一颗命中的就收工。
    return
  }
}

export function funcCheckReleased(fb: FuncButtonsState, x: number, y: number): void {
  for (const key of FUNC_MAIN_ORDER) releaseButton(fb.main[key], x, y)
}
