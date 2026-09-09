import type { EquipPanelState } from './equipPanel'
import type { FuncButtonsState } from './funcButtons'
import type { MenuHero } from './heroes'

/**
 * 菜单状态层的世界。**与场景 / 战斗平级的一块面板**，不是覆盖层
 * （xl-6lo.2「状态机里的位置」）—— 真值的 `panel` 字段取值是 `thingPanel` /
 * `equipPanel` 这一类，压根没有"场景"这个值。
 *
 * 状态是**就地改**的，与 `battle/types.ts` 同一个规矩：一拍里要改的字段散在
 * 四个子面板与三个人身上，逐层拷贝出来的写法读起来全是 spread，而改错一处
 * 与改对了长得一样。
 */

/** 四个子面板的名字。真值 `panel` 那一列的取值域，也是 `getName()` 的返回。 */
export type MenuPanelName = 'thingPanel' | 'magicPanel' | 'funcPanel' | 'equipPanel'

/** 四个页签。`Command` 里那四颗 `MenuButton` 的键。 */
export type MenuTabKey = 'thing' | 'equip' | 'magic' | 'func'

/** 一颗按钮现在贴三张里的哪一张。真值不记它；逐帧比对与渲染层记。 */
export type ButtonImage = 'normal' | 'waitclick' | 'pressed'

/** `tools.GameButton` + `menu.MenuButton` 的可断言字段。 */
export interface MenuButtonState {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** `MenuButton.isDraw`：`No` 时不画，**而且 `isPressedButton` 整个跳过**。 */
  isDraw: boolean
  isclicked: boolean
  /**
   * `GameButton.isMoveIn` 字段。⚠️ **它恒为 `false`**：原版
   * `isMoveIn(int,int)` 的 `else` 只盖住了 `buttonImage=normalImage;` 那一句，
   * `isMoveIn=false;` 少了大括号、每次调用都跑（`src/tools/GameButton.java`）。
   * 这是照抄的缺陷，不是笔误 —— 判据在 `buttons.test.ts`。
   */
  isMoveIn: boolean
  image: ButtonImage
}

/** `menu.Mouse`：四个子面板各有一个，四条 run 线程各推各的。 */
export interface MouseState {
  /** "下一格拿哪张图"的计数器。1..8 循环，开局 0。 */
  code: number
  /** **这一帧真的画出来的那张**在 `images` 里的下标（0..7）。 */
  frame: number
  x: number
  y: number
}

/**
 * `Scoll.whichHero` 的取值域：**1 张小凡 / 2 陆雪琪 / 4 玉洁**。
 *
 * 3 号（宋大仁）原版没做进菜单 —— `Scoll` 里那个 `songdaren=3` 只是个没人读的
 * 静态字段，`initial()` 一颗头像都没给他建。写成 `number` 的话「切到 3 号」
 * 会是一个合法值，而它在原版里根本到不了。
 */
export type ScollHero = 1 | 2 | 4

/**
 * 三颗头像的**编号 → 卷轴上的字段名 → 出战名单里的键**。
 *
 * 这三样在原版里是三套不一样的写法（`hero1/hero2/hero4` 的字段名、
 * `whichHero` 的 1/2/4、`SaveAndLoad.zhang/lu/wen`），而它们**必须一一对应**。
 * 收成一张表，是因为散着写的时候「二号是 lu 还是 wen」要在四五个地方各答一遍
 * —— 答错一处的表现是「切了人但换的是另一个人的头像」。
 * ⚠️ 玉洁那一位在出战名单里的键是 **`wen`**，不是 `yu`。
 */
export const SCOLL_HEROES: readonly {
  hero: ScollHero
  field: 'hero1' | 'hero2' | 'hero4'
  party: 'zhang' | 'lu' | 'wen'
}[] = [
  { hero: 1, field: 'hero1', party: 'zhang' },
  { hero: 2, field: 'hero2', party: 'lu' },
  { hero: 4, field: 'hero4', party: 'wen' },
]

/** 卷轴。天书页没有（`FuncPanel` 不建 `Scoll`）。 */
export interface ScollState {
  whichHero: ScollHero
  hero1: MenuButtonState
  hero2: MenuButtonState
  hero4: MenuButtonState
}

/** 一个子面板（`menu.FatherPanel`）。 */
export interface MenuSubPanel {
  readonly name: MenuPanelName
  /** `FatherPanel.currentX/currentY` —— **只有当时是当前页的那一个**收得到。 */
  currentX: number
  currentY: number
  mouse: MouseState
  scoll: ScollState | null
  /** 天书页那一排按钮。**只有 `funcPanel` 有**，其余三页是 `null`。 */
  funcButtons: FuncButtonsState | null
  /**
   * 装备页那一大摊（六个槽位 / 背包 / 选中 / 两条拒绝 / 属性差值）。
   * **只有 `equipPanel` 有**，其余三页是 `null`。
   *
   * ⚠️ 它同时是**背包的唯一落点**：那六张装备表在原版里是 `static`，弃用一件
   * 东西三个人的列表里立刻都看得见（`equipPanel.ts` 的头注）。
   */
  equip: EquipPanelState | null
}

export interface MenuWorld {
  /** `MenuPanel.currentPanel` 的名字。 */
  panel: MenuPanelName
  /** `MenuPanel.currentX/currentY`：顶栏的命中判据读的是它。 */
  currentX: number
  currentY: number
  panels: Readonly<Record<MenuPanelName, MenuSubPanel>>
  tabs: Readonly<Record<MenuTabKey, MenuButtonState>>
  heroes: MenuHero[]
  /**
   * `SaveAndLoad.zhang/lu/wen`：出战名单。卷轴上那三颗头像按钮画不画得出来
   * 由它决定（`Scoll.drawScoll`），**而它是剧本回显，不是状态**。
   */
  readonly party: Readonly<Record<'zhang' | 'lu' | 'wen', boolean>>
  /** **这一步**请求播放的音效，按调用先后。每步开头清空（对应 `MusicTap`）。 */
  music: string[]
  /** 已经推了几步。真值那一列 `t`。 */
  tick: number
}
