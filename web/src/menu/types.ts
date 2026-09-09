import type { EquipPanelState } from './equipPanel'
import type { FuncButtonsState } from './funcButtons'
import type { MenuHero } from './heroes'
import type { MagicState } from './magic'

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

/** 一种药在包里的存货 —— `shop.Drug` 的 `name` 与 `numberGOT`。 */
export interface DrugStock {
  readonly name: string
  count: number
}

/**
 * 物品页自己那部分（`menu.DrugPanel`）。**只有 `thingPanel` 有**，其余三页
 * 是 `null`。存货不在这里 —— `DrugPack.drugList` 是 `static`，挂在
 * `MenuWorld.drugPack` 上（`drugPanel.ts` 文件头注）。
 */
export interface DrugPanelState {
  /**
   * `DrugPanel.currentDrug` 的**名字**（没选中是 `null`）。存的是名字不是
   * 对象：原版那个引用指向 `DrugPack.drugList` 里的元素，数量减到 0 时它被
   * 置回 `null`，而"哪一瓶"这件事本来就只由名字决定。
   */
  currentDrug: string | null
  /** `use_button`。⚠️ 开局 `isDraw` 是 **No**，构造函数最后一句按回去的。 */
  useButton: MenuButtonState
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
  /** 物品页那一份。**只有 `thingPanel` 有**，其余三页是 `null`。 */
  drug: DrugPanelState | null
  /** 奇术页那十五颗技能按钮与十五条动画。**只有 `magicPanel` 有**。 */
  magic: MagicState | null
  /**
   * 装备页那一大摊（六个槽位 / 背包 / 选中 / 两条拒绝 / 属性差值）。
   * **只有 `equipPanel` 有**，其余三页是 `null`。
   *
   * ⚠️ 它同时是**背包的唯一落点**：那六张装备表在原版里是 `static`，弃用一件
   * 东西三个人的列表里立刻都看得见（`equipPanel.ts` 的头注）。
   */
  equip: EquipPanelState | null
}

/**
 * 音频的两个开关 —— `MusicPlayer.CAN_PLAY_BGM` / `CAN_PLAY_MUSIC`。
 *
 * 原版是两个 **static** 字段，从开机活到关机；这一层把它们放在世界上，由会话
 * 在开菜单时喂进来、每一拍再记回去（`game/audioSettings.ts`），与队伍那一份
 * （`fakes/party.ts`）同一个手法。放在世界上而不是直接读写一个模块级全局，
 * 是为了让状态层保持纯的 —— `menuTrace.test.ts` 一条真值跑两遍必须同结果。
 *
 * **真值不记这两列**（`MenuDriver.snapshotState` 里没有），所以它们不进
 * `snapshotMenu`。守着它们的是 `funcButtons.test.ts` 与 `session.test.ts`。
 */
export interface MenuAudioSettings {
  /** `CAN_PLAY_BGM == YES`。`false` 时 `currentBgm()` 返回 `null`，播放器停。 */
  bgm: boolean
  /** `CAN_PLAY_MUSIC == YES`。今天没有音效播放器（xl-8l2），只是记着。 */
  sfx: boolean
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
   * `shop.DrugPack.drugList` —— **六种药的存货，全局一份**（那个字段是
   * `static`）。画得出来的清单是它按 `count>0` 过滤出来的，见
   * `drugPanel.ts` 的 `visibleDrugs`。
   */
  drugPack: DrugStock[]
  /**
   * `SaveAndLoad.zhang/lu/wen`：出战名单。卷轴上那三颗头像按钮画不画得出来
   * 由它决定（`Scoll.drawScoll`），**而它是剧本回显，不是状态**。
   */
  readonly party: Readonly<Record<'zhang' | 'lu' | 'wen', boolean>>
  /** **这一步**请求播放的音效，按调用先后。每步开头清空（对应 `MusicTap`）。 */
  music: string[]
  /**
   * 音频那两个开关。天书页的「背景音乐 开 / 关」改的就是它。
   *
   * ⚠️ **它不影响 `music` 那一列**：真值的观察点是 `MusicReader.readmusic` 的
   * **入口**，而 `CAN_PLAY_MUSIC` 的判断在再下一层的 `playmusic` 里 ——
   * 关掉音效之后文件名照样记得到。把 `music` 也一起关掉的话，真值当场对不上。
   */
  audio: MenuAudioSettings
  /** 已经推了几步。真值那一列 `t`。 */
  tick: number
}
