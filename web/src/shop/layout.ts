import { EQUIPMENT_LISTS } from '../menu/equipment'
import type { EquipSlot } from '../menu/equipment'
import { DRUGS } from '../battle/drugs'

/**
 * 两个商店面板的**几何**——按钮摆位、商品行的命中带、绘制用的那几列 x。
 *
 * 数字全部照抄 `src/shop/ShopPanel.java` 与 `src/shop/EquipmentShopPanel.java`
 * 的构造函数与 `drawIcon()`。抄一份而不是读源码：这一层要进浏览器包。
 * 抄对了没有由 `layout.test.ts` 去 GBK 源码里把那几行现读出来逐个数比 ——
 * 少了它，"按钮偏了 40 px" 在画面上说不出对错，而在真值里压根看不见
 * （真值不记按钮几何，只记 `pressed` 那一列，而按钮中心永远点得中）。
 *
 * ## 两家店共用这一个文件，这是有意的
 *
 * 加减按钮、买卖按钮、返回游戏三处的坐标两边**逐字相同**（两个构造函数是
 * 复制粘贴的关系）。抄成两份的表现是改了一处忘了另一处，而两家店长得几乎
 * 一样，肉眼分不出来。不同的那几处（分类栏、`stock` 那一列的 x、按钮表的
 * 次序）在下面各自单列，并且都标了出处。
 */

/** 面板尺寸：`32*32 × 32*20`。与舞台一致。 */
export const SHOP_WIDTH = 32 * 32
export const SHOP_HEIGHT = 32 * 20

/** 两家店的判别名。与真值 `shop` 那一列、`ShopScript.SHOPS` 是同一套字符串。 */
export type ShopKind = 'drug' | 'equipment'
export const SHOP_KINDS: readonly ShopKind[] = ['drug', 'equipment']

/**
 * 装备店六个分类的**次序**。
 *
 * ⚠️ 它**不是** `menu/equipment.ts` 的 `EQUIP_SLOTS`（那一份是装备页六个槽位的
 * 排布，次序是 weapon/armor/helmet/shoe/glove/decoration）。这里是
 * `EquipmentShopPanel` 构造函数里 `buttonList.add(...)` 那六行的次序，
 * 也是 `ShopScript.CATEGORIES` 与真值 `pressed` 里 `category:<名>` 的次序 ——
 * 按钮表的下标算法整个挂在它上面。两份名单碰巧是同一个集合、不同的序，
 * 拿错一份的表现是点了「头盔」却切到了「盔甲」。
 */
export const SHOP_CATEGORIES: readonly EquipSlot[] = [
  'weapon',
  'helmet',
  'armor',
  'glove',
  'shoe',
  'decoration',
]

/** `EquipmentShopPanel.equipment` 的初值：`String equipment="weapon"`。 */
export const FIRST_CATEGORY: EquipSlot = 'weapon'

/** 一颗按钮画在哪、多大。命中框另算，见 `buttons.ts` 的 `hits`。 */
export interface ShopButtonBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** `buy` / `sell` / `back` 三颗，两家店逐字相同。 */
export const BUY_BOX: ShopButtonBox = { x: 445, y: 75, width: 149, height: 40 }
export const SELL_BOX: ShopButtonBox = { x: 594, y: 75, width: 149, height: 40 }
export const BACK_BOX: ShopButtonBox = { x: 880, y: 20, width: 149, height: 40 }

/** 分类栏那一排：`int x=448,y=133`，逐颗右移 47。只有装备店有。 */
export const CATEGORY_X0 = 448
export const CATEGORY_Y = 133
export const CATEGORY_W = 47
export const CATEGORY_H = 20

export function categoryBox(category: EquipSlot): ShopButtonBox {
  const i = SHOP_CATEGORIES.indexOf(category)
  // 空转要响：认不出的分类名算出来会是 x=448-47=401，正好落在分类栏左边一格，
  // 画得出来、点得着，而它谁都不是。
  if (i < 0) throw new Error(`装备店没有叫 ${category} 的分类`)
  return { x: CATEGORY_X0 + CATEGORY_W * i, y: CATEGORY_Y, width: CATEGORY_W, height: CATEGORY_H }
}

/**
 * 加减按钮：两个构造函数里 `int x = 453, y = 200`，减在 `(x+90, y-10)`、
 * 加在 `(x+130, y-10)`，每行 `y+=20`。都是 7×12。
 */
export const STEP_ROW_H = 20
export const MINUS_X = 453 + 90
export const PLUS_X = 453 + 130
export const STEP_Y0 = 200 - 10
export const STEP_W = 7
export const STEP_H = 12

export function stepBox(row: number, plus: boolean): ShopButtonBox {
  return {
    x: plus ? PLUS_X : MINUS_X,
    y: STEP_Y0 + STEP_ROW_H * row,
    width: STEP_W,
    height: STEP_H,
  }
}

/**
 * 商品行的命中带，抄自两个面板的 `isMoveIn()`：
 * `currentX>440 && currentX<795 && currentY>oringinY && currentY<oringinY+20`，
 * `oringinY` 从 180 起每行 +20。
 *
 * ⚠️ 四个不等号全是**严格**的，照抄 —— 行与行之间因此有一条 1px 的死带
 * （y=200 既不属于第 0 行也不属于第 1 行）。
 */
export const ROW_BAND_X0 = 440
export const ROW_BAND_X1 = 795
export const ROW_BAND_Y0 = 180

/** 落在 `(x, y)` 的那一行；不在任何一行的命中带上是 `-1`。 */
export function rowAt(x: number, y: number, rows: number): number {
  if (!(x > ROW_BAND_X0 && x < ROW_BAND_X1)) return -1
  let hit = -1
  // 原版那个 for **没有 break**，逐行覆写同一个变量。命中带不重叠，所以
  // "最后一个命中的"就是唯一那个 —— 照抄它的形状，别改写成 find。
  for (let i = 0; i < rows; i++) {
    const y0 = ROW_BAND_Y0 + STEP_ROW_H * i
    if (y > y0 && y < y0 + STEP_ROW_H) hit = i
  }
  return hit
}

/** `drawIcon()` 里那几列的绘制坐标（x 是左边，y 是**基线**）。 */
export const LIST_X = 453
export const LIST_Y0 = 200
/** `g.setFont(new Font("文鼎粗钢笔行楷", Font.BOLD, 20))`。 */
export const LIST_FONT_SIZE = 20
export const LIST_COLOR = '#ffffff'
/** `" "+getReduceMoney()` 画在 `x+180`。两家店相同。 */
export const PRICE_DX = 180
/** ⚠️ 存货那一列两家店**不一样**：药店 `x+245`，装备店 `x+260`。 */
export const STOCK_DX_DRUG = 245
export const STOCK_DX_EQUIP = 260
/** 背包持有量画在 `x+300`。两家店相同。 */
export const HELD_DX = 300
/** ⚠️ 这一单要买几件也不一样：药店 `x+100`，装备店 `x+102`。 */
export const PURCHASE_DX_DRUG = 100
export const PURCHASE_DX_EQUIP = 102
/** `" "+Money.getCoins()` 画在固定的 (900, 20)，与行无关。 */
export const COINS_X = 900
export const COINS_Y = 20

/** 中间那张商品图贴在 (820, 200)。 */
export const ICON_X = 820
export const ICON_Y = 200

/** 店主那三行话的基线。药店没有第三行（`ShopPanel` 没有 `messageremark`）。 */
export const MESSAGE_X = 453
export const MESSAGE_Y = 610
export const MESSAGE_PLUS_Y = 630
export const REMARK_X = 730
export const REMARK_Y = 610

/** 招牌与钱袋两张固定贴图。招牌两家店不是同一张，见 `render/assets.ts`。 */
export const SIGN_X = 200
export const SIGN_Y = 0
export const PURSE_X = 880
export const PURSE_Y = 0

/**
 * 队伍那三个人的动画位置与四行属性图标 —— `new ShopAnimation(角色, 0, 0/160/320, 8, this)`
 * 与 `drawIcon()` 里 `30+i*150` 那一串。第四条动画是店主 / 小妹，(364, 515)。
 *
 * 下面这四个数与 {@link ANIMATION_FRAMES} / {@link ANIMATION_INTERVAL_MS}
 * **由 `render/animation.test.ts` 逐个对回 GBK 源码那五个实参**（xl-knp.9）。
 * 在这里手改一个数，那条判据当场红。
 */
export const PARTY_ANIMATION_X = 0
export const PARTY_ANIMATION_Y: readonly number[] = [0, 160, 320]
export const KEEPER_ANIMATION_X = 364
export const KEEPER_ANIMATION_Y = 515
/** 四行属性：字画在 (55, 30+i*150+j*20)，图标贴在 (60, 同一个 y)。 */
export const STAT_TEXT_X = 55
export const STAT_ICON_X = 60
export const STAT_Y0 = 30
export const STAT_ROW_GAP = 150
export const STAT_LINE_GAP = 20

/**
 * 鼠标图与四条人物动画都是 **8 帧**（`new ShopAnimation(…, 8, …)` 与
 * `final Image[] mouses = new Image[8]`），由同一条线程用同一个 `i` 推着走。
 */
export const ANIMATION_FRAMES = 8

/**
 * 那条动画线程每格睡多久：`tools.Clock.sleep(120)`。
 *
 * 它推的是鼠标图与四条人物动画（同一个 `i`）。**真值里一个都不记** ——
 * 导出时 `Clock.setFactor(1e-9)` 把这一句拉成约 3800 年，两条线程各自停在
 * 第一次 sleep 上。所以它只服务于真的跑起来的那一版。
 */
export const ANIMATION_INTERVAL_MS = 120

/** 一家店当前这一列有几行。`rowCount` 的唯一出处。 */
export function shopRowCount(kind: ShopKind, category: EquipSlot): number {
  return kind === 'drug' ? DRUGS.length : EQUIPMENT_LISTS[category].length
}
