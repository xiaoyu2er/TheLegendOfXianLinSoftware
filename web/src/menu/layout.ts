import type { MenuTabKey, ScollHero } from './types'

/**
 * 菜单骨架那两组按钮的几何。全部照抄原版的字段初始化式，判据在
 * `layout.test.ts`（从 GBK 源码里现读）。
 *
 * 顶栏那四颗**有真值兜底**：菜单真值里每一次切页的落点都是按钮中心算出来的，
 * 几何错了 `panel` 那一列当场对不上。卷轴那三颗**今天没有**（两条 menu 真值
 * 一次都没点过头像，`hero` 全程是 1）—— 补真值那张票是 xl-6lo.2 列的三条之一，
 * 所以这里只有源码这一头核着。
 */

/** `Command` 里那四颗页签。`x_of_GameButton + n*width`，n = 0/2/4/6。 */
export const TAB_X = 400
export const TAB_Y = 50
export const TAB_W = 52
export const TAB_H = 37

/**
 * 四颗页签的**次序与横向倍数**，逐个对应 `Command.addGameButton()` 里的四段。
 * 倍数是 0 / 2 / 4 / 6 —— 中间空着一颗按钮的宽度。
 */
export const TABS: readonly { key: MenuTabKey; multiple: number; label: string }[] = [
  { key: 'thing', multiple: 0, label: '物品' },
  { key: 'equip', multiple: 2, label: '装备' },
  { key: 'magic', multiple: 4, label: '奇术' },
  { key: 'func', multiple: 6, label: '天书' },
]

export function tabX(multiple: number): number {
  return TAB_X + multiple * TAB_W
}

/** `Scoll` 的卷轴与三颗头像。`x_scoll=60+32`、`y_scoll=70`。 */
export const SCOLL_X = 60 + 32
export const SCOLL_Y = 70
export const HEAD_X = SCOLL_X + 14
export const HEAD_Y = SCOLL_Y + 20
export const HEAD_W = 40
export const HEAD_H = 40
export const HEAD_GAP = 10

/**
 * 三颗头像各自的左上角。⚠️ **二号头像比另外两颗低 6 像素**
 * （`new MenuButton(x_head+width_head+hgap, y_head+6, …)`）—— 原版就是这样，
 * 抹平它会让逐帧比对在那一小块上红。
 */
export const HEAD_POS: readonly { hero: ScollHero; x: number; y: number }[] = [
  { hero: 1, x: HEAD_X, y: HEAD_Y },
  { hero: 2, x: HEAD_X + HEAD_W + HEAD_GAP, y: HEAD_Y + 6 },
  { hero: 4, x: HEAD_X + 2 * (HEAD_W + HEAD_GAP), y: HEAD_Y },
]
