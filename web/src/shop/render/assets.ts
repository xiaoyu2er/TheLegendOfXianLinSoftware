import { battleAssetId } from '../../assets/battleAssets'
import { equipPictureAssetId } from '../../assets/ids'
import type { AssetId } from '../../assets/ids'
import { shopAssetId } from '../shopAssets'
import { KNOWN_MISSING_EQUIP_PICTURES } from '../../menu/equipmentPictures'
import { SLOT_FILE } from '../../menu/equipment'
import type { EquipSlot } from '../../menu/equipment'
import { ANIMATION_FRAMES, SHOP_CATEGORIES } from '../layout'
import type { ShopKind } from '../layout'
import { activePanel, currentRows } from '../world'
import type { ShopButtonLabel } from '../buttons'
import type { ShopWorld } from '../types'

/**
 * 商店那两张面板要贴的图，**逻辑 ID 一处算全**。
 *
 * 路径逐字照抄两个构造函数与 `drawIcon()` 里的字面量 —— 抄错一条的表现是
 * `resolveAsset` 抛（还好），或者恰好撞上另一张图（画错了，且悄无声息）。
 * `assets.test.ts` 把下面每一条都拿去 `resolveAsset` 走一遍，映射表里没有的
 * 当场红。
 *
 * ## 两个前缀不是 `shop:`，各有各的理由
 *
 * - `battle:` —— 鼠标那八张在 `image/鼠标图/` 下（两个构造函数拼的是
 *   `"image/鼠标图/"+i+".png"`）。⚠️ **`sources/菜单/鼠标图/` 下另有一份同名的
 *   八张**，菜单用的是那一份。两处**不是同一批文件**，`menu:` 与 `battle:`
 *   两个前缀在映射表里各占八条 —— 拿错一份画出来几乎一样，而它是错的。
 * - `drug:` / `equip:` —— 商品图在 `sources/Shop/药品/回复类/` 与
 *   `sources/Shop/装备/<类>/` 下，由 xl-rh9.12 与 xl-234 先烘进主包，
 *   `shop/shopAssets.ts` 的 `SHOP_ASSETS_OWNED_ELSEWHERE` 把这两摊整个让给了
 *   原主。它们不在这里算，直接取自 `ShopRow.picture`。
 */

/** `sources/Shop/<relative>`。 */
function id(relative: string): AssetId {
  return shopAssetId(relative)
}

/** 两家店共用的那张底图。 */
export const SHOP_BACKGROUND: AssetId = id('shopback.png')

/** 钱袋。`drawIcon()` 最后一句。 */
export const PURSE: AssetId = id('按钮组件/钱.png')

/** ⚠️ 招牌两家店**不是同一张**：药店 `招牌.png`，装备店 `招牌_副本.png`。 */
export const SIGN: Readonly<Record<ShopKind, AssetId>> = {
  drug: id('按钮组件/招牌.png'),
  equipment: id('按钮组件/招牌_副本.png'),
}

/** 四行属性的图标，**次序就是 `drawIcon()` 里那四对的次序**。 */
export const STAT_ROWS: readonly { readonly text: string; readonly icon: AssetId }[] = [
  { text: '体', icon: id('按钮组件/体力.png') },
  { text: '敏', icon: id('按钮组件/敏捷.png') },
  { text: '武', icon: id('按钮组件/武力.png') },
  { text: '精', icon: id('按钮组件/精气.png') },
]

/** 游标那八张。`mouses[i] = readImage("image/鼠标图/"+(i+1)+".png")`，下标从 0 起。 */
export function mouseId(frame: number): AssetId {
  return battleAssetId(`image/鼠标图/${frame + 1}.png`)
}

/**
 * 人物动画的一帧。`new ShopAnimation(s,…)` 拼的是
 * `sources/Shop/商店人物/<s>/<s> (<i>).png`，`i` 从 **1** 起。
 */
export function animationFrameId(role: string, frame: number): AssetId {
  return id(`商店人物/${role}/${role} (${frame + 1}).png`)
}

/** 队伍那三条动画的角色名，**次序照抄 `ani.add(...)` 的前三句**。 */
export const PARTY_ROLES: readonly { readonly key: 'zhang' | 'lu' | 'wen'; readonly role: string }[] =
  [
    { key: 'zhang', role: '张小凡' },
    { key: 'lu', role: '陆雪琪' },
    { key: 'wen', role: '文敏' },
  ]

/** ⚠️ 第四条动画两家店不是同一个人：药店是店主，装备店是小妹。 */
export const KEEPER_ROLE: Readonly<Record<ShopKind, string>> = {
  drug: '店主',
  equipment: '小妹',
}

/** 一颗按钮的三张贴图。 */
export interface ButtonImages {
  readonly normal: AssetId
  readonly waitclick: AssetId
  readonly pressed: AssetId
}

export const BUY_IMAGES: ButtonImages = {
  normal: id('购买1.png'),
  waitclick: id('购买2.png'),
  pressed: id('购买3.png'),
}
export const SELL_IMAGES: ButtonImages = {
  normal: id('卖出1.png'),
  waitclick: id('卖出2.png'),
  pressed: id('卖出3.png'),
}
export const BACK_IMAGES: ButtonImages = {
  normal: id('返回游戏 (1).png'),
  waitclick: id('返回游戏 (2).png'),
  pressed: id('返回游戏 (3).png'),
}
/** ⚠️ 加减按钮只有两张图：`waitclick` 与 `pressed` 传的是**同一个** `2.png`。 */
export const MINUS_IMAGES: ButtonImages = {
  normal: id('减少1.png'),
  waitclick: id('减少2.png'),
  pressed: id('减少2.png'),
}
export const PLUS_IMAGES: ButtonImages = {
  normal: id('增加1.png'),
  waitclick: id('增加2.png'),
  pressed: id('增加2.png'),
}

/**
 * 分类按钮的图片名 —— **与 `menu/equipment.ts` 的 `SLOT_FILE` 不是同一套字**。
 *
 * `SLOT_FILE` 是数据文件名（`武器` / `盔甲` / `头` / `脚` / `手` / `饰品`），
 * 这里是按钮贴图名（`武器` / `盔甲` / `头盔` / `靴子` / `护臂` / `饰品`）——
 * 四个词不一样。共用一份的表现是四张图 404。
 */
export const CATEGORY_IMAGE_NAME: Readonly<Record<EquipSlot, string>> = {
  weapon: '武器',
  helmet: '头盔',
  armor: '盔甲',
  glove: '护臂',
  shoe: '靴子',
  decoration: '饰品',
}

/**
 * 分类按钮的三张。⚠️ **`normal` 与 `waitclick` 传的是同一张 `1.png`** ——
 * 原版那六行就是这么写的，所以悬停在分类栏上画面纹丝不动。
 */
export function categoryImages(category: EquipSlot): ButtonImages {
  const name = CATEGORY_IMAGE_NAME[category]
  return {
    normal: id(`按钮组件/${name}1.png`),
    waitclick: id(`按钮组件/${name}1.png`),
    pressed: id(`按钮组件/${name}2.png`),
  }
}

/**
 * 按钮的逻辑名 → 它那三张图。
 *
 * 收的是 {@link ShopButtonLabel} 而不是裸 `string`：那个联合类型就在隔壁，
 * 用裸 string 等于把"名字有哪几种"这件事在两处各答一遍。
 */
export function buttonImages(label: ShopButtonLabel): ButtonImages {
  if (label === 'buy') return BUY_IMAGES
  if (label === 'sell') return SELL_IMAGES
  if (label === 'back') return BACK_IMAGES
  if (label.startsWith('minus:')) return MINUS_IMAGES
  if (label.startsWith('plus:')) return PLUS_IMAGES
  const category = SHOP_CATEGORIES.find((c) => label === `category:${c}`)
  // 认不出来一律抛，不猜：猜出来的 ID 要么查不到，要么撞上别的素材。
  if (!category) throw new Error(`商店按钮的逻辑名认不出来：${label}`)
  return categoryImages(category)
}

/**
 * 这一帧**可能**用得到的每一张 —— 载入名单。
 *
 * **从世界现推**，不写死一份清单：写死的表现是新加一颗按钮之后它那张图没载，
 * 而渲染器那边是一句"没有载入它"的抛错，与"这一块偶尔不见了"分不开。
 *
 * 八帧动画全推进去（而不是只推当前那一帧）：帧号由渲染层自己数，来回换纹理
 * 时再去 `await load` 会让某一帧闪一下。
 */
export function shopTextureIds(w: ShopWorld): AssetId[] {
  const ids: AssetId[] = [SHOP_BACKGROUND, PURSE, SIGN[w.active]]
  for (const row of STAT_ROWS) ids.push(row.icon)
  for (let frame = 0; frame < ANIMATION_FRAMES; frame++) {
    ids.push(mouseId(frame))
    for (const { key, role } of PARTY_ROLES) {
      if (w.party[key]) ids.push(animationFrameId(role, frame))
    }
    ids.push(animationFrameId(KEEPER_ROLE[w.active], frame))
  }
  for (const b of activePanel(w).buttons) {
    const images = buttonImages(b.label)
    ids.push(images.normal, images.waitclick, images.pressed)
  }
  // 商品图：当前这一栏每一行都可能被悬停选中。
  for (const row of currentRows(w)) {
    const picture = pictureTextureId(row.picture)
    if (picture !== null) ids.push(picture)
  }
  return [...new Set(ids)]
}

/**
 * 数据点名了、仓库里却没有的那三张装备图（`menu/equipmentPictures.ts` 的
 * `KNOWN_MISSING_EQUIP_PICTURES`，归 xl-234 / xl-1dv.2）。
 *
 * 原版在这三处画的是 `new ImageIcon(<不存在的路径>).getImage()` —— 一个宽度
 * −1 的空壳，`g.drawImage` 什么都不画。所以这里返回 `null`，绘制清单与载入
 * 名单里都没有那一条。
 *
 * ⚠️ **`ShopRow.picture` 那个字段照旧是那条不存在的路径**，不是 `null`：
 * 它同时是"图标框里那张图"的**身份**，而原版那个空壳仍然是一个逐行不同的
 * 对象。抹成 `null` 的话，三件缺图的装备会全部认成"框里没图"，
 * `icon.row` 那一列当场对不上。
 *
 * 名单是**别人签的**，这里只转手：抄第二份的表现是两边分家，而分家之后
 * "这一张该不该画"两处答得不一样。
 */
const MISSING_PICTURES: ReadonlySet<AssetId> = new Set(
  KNOWN_MISSING_EQUIP_PICTURES.map((m) => equipPictureAssetId(SLOT_FILE[m.slot], m.picture)),
)

/** 这张商品图画得出来吗。画不出来（数据点名了、文件不在）时返回 `null`。 */
export function pictureTextureId(picture: AssetId): AssetId | null {
  return MISSING_PICTURES.has(picture) ? null : picture
}
