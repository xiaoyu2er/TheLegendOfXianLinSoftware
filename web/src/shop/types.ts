import type { AssetId } from '../assets/ids'
import type { EquipSlot } from '../menu/equipment'
import type { ShopButtonState } from './buttons'
import type { ShopKind } from './layout'

/**
 * 商店状态层的世界。**与场景 / 战斗 / 菜单平级的一块面板**（真值 `shop` 那一列
 * 的取值是 `drug` / `equipment`，没有"场景"这个值）。
 *
 * 状态是**就地改**的，与 `battle/types.ts` / `menu/types.ts` 同一个规矩。
 *
 * ## ⚠️ 两家店共用一个世界，这是原版的形状不是简化
 *
 * `Money.coins` 与 `DrugPack` / `EquipmentPack` 在原版里都是 **static**，
 * 两个面板读写的是同一份；`GameLauncher` 在开机时就把两个面板都建出来了。
 * 拆成"一次开一家店、各自一个世界"的话，「在装备店花掉的钱回药店还是那个数」
 * 就再也观测不到了 —— 而 `shop-trade` 那条真值走的正是这一路。
 */

/**
 * 店里这一列的一行。五个数就是 `drawIcon()` 画在屏幕上的那五列里的四列
 * （第五列 `held` 在背包上，见 {@link ShopPack}）。
 */
export interface ShopRow {
  readonly name: string
  /** `Equipment/Drug.getReduceMoney()`。 */
  readonly price: number
  /**
   * 图标框里那张图的**身份**。原版比的是 `Image` 对象，而 `ImageIcon` 按
   * 文件名缓存 —— 所以这里用逻辑 ID 当身份，两行共用同一张 png（头盔那两行）
   * 时它们的 ID 相同，`iconRow` 于是只认得出头一行，与原版一致。
   */
  readonly picture: AssetId
  /** `setNumber((int)(Math.random()*10))` 摇出来的存货。 */
  stock: number
  /** `purchaseNumber`：这一单要买卖几件。 */
  purchase: number
}

/**
 * 背包。**与商品表逐行对齐的计数**，不是一份自己的名单 —— 原版的买卖是
 * `DrugPack.drugList.get(i)` 按**下标**对上店里那一行的，名字对不上也照买。
 * 存成 `Map<名字, 件数>` 的话这条对齐关系就没人守了。
 */
export interface ShopPack {
  /** 与 `battle/drugs.ts` 的 `DRUGS` 逐行对齐。 */
  drugs: number[]
  /** 与 `menu/equipment.ts` 的 `EQUIPMENT_LISTS[slot]` 逐行对齐。 */
  equipment: Record<EquipSlot, number[]>
}

/** 两家店共有的那一摊（两个构造函数是复制粘贴的关系）。 */
export interface ShopPanelBase {
  readonly kind: ShopKind
  /** `currentX` / `currentY`。⚠️ **两个面板各有一份**，切店不会带过去。 */
  currentX: number
  currentY: number
  /** `message` —— 店主说的第一行。开局是各自构造函数里那句欢迎词。 */
  message: string | null
  /** `messageplus` —— 第二行。开局 `null`（字段没有初始化式）。 */
  messagePlus: string | null
  /**
   * 图标框里那张图（`drugImage` / `equipmentImage`）。开局 `null`。
   *
   * ⚠️ **切分类不清它** —— 原版 `setButton` 换 `equipment` 时一个字都没动
   * `equipmentImage`，于是切到不含那张图的一栏之后，真值的 `icon.row` 是 -1
   * 而框里还画着上一件。照抄。
   */
  iconPicture: AssetId | null
  /** 按钮表，**次序就是原版 `add` 的次序** —— 下标算法与 `pressed` 都挂在它上面。 */
  buttons: ShopButtonState[]
}

export interface DrugShopState extends ShopPanelBase {
  readonly kind: 'drug'
  rows: ShopRow[]
}

export interface EquipShopState extends ShopPanelBase {
  readonly kind: 'equipment'
  /** `String equipment` —— 那个"决定先出现哪个栏目的重要字符串"。 */
  category: EquipSlot
  /** 六栏各自的存货。切分类只是换读哪一栏，存货一直都在。 */
  rows: Record<EquipSlot, ShopRow[]>
  /** `messageremark` —— 第三行。**只有装备店有**（`ShopPanel` 没这个字段）。 */
  messageRemark: string | null
}

export type ShopPanelState = DrugShopState | EquipShopState

export interface ShopWorld {
  /** 现在开着哪一家。真值 `shop` 那一列。 */
  active: ShopKind
  drug: DrugShopState
  equipment: EquipShopState
  /** `Money.coins`，两家店共享。 */
  coins: number
  /** `DrugPack` / `EquipmentPack`，两家店共享。 */
  pack: ShopPack
  /**
   * **队伍名单**（剧本 `Role` 那一行 → `SaveAndLoad.zhang/lu/wen`）。
   * **剧本回显，不是状态**。⚠️ **不是出战名单**，两份的区别见
   * {@link ShopConfig.party} 与 `render/animation.test.ts`。
   */
  readonly party: Readonly<Record<'zhang' | 'lu' | 'wen', boolean>>
  /** **这一步**请求播放的音效，按调用先后。每步开头清空（对应 `MusicTap`）。 */
  music: string[]
  /**
   * 点过「返回游戏」了。原版那一句是 `GameLauncher.switchTo("scene")` ——
   * 面板自己不知道要去哪，换面板是外面那一层的事，浏览器里同理（会话侧
   * 接它，xl-yg6.2）。
   *
   * ⚠️ **真值不记它**（商店剧本一次都没按过「返回游戏」），所以它不进
   * `snapshotShop`。守着它的是 `step.test.ts`。
   */
  leaving: boolean
  /** 已经推了几步。真值那一列 `t`。 */
  tick: number
}
