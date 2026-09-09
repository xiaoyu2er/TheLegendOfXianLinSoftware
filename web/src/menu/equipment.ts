/**
 * 六类装备的全表（`shop.EquipmentPack` 那六个 `static ArrayList<Equipment>`）。
 *
 * 数据源是 `sources/Shop/` 下那六份 GBK+CRLF 的表，`shop.ShopReader.readEquipment`
 * 按 `/` 切列读进来：
 *
 *     名字 / 体力 / 敏捷 / 武力 / 精气 / 图片文件名 / 价钱 / ??? / 使用者
 *
 * **第 8 列（下标 7）原版一个字都没读** —— `readEquipment` 只取 0..6 与 8，
 * 所以这里也不建模它。第 9 列只有 `武器.txt` 有：`if(lineArray.length==9)`
 * 才 `setUser`，别的五份都是 8 列，`user` 停在字段初始化式的 **0**（谁都能用）。
 * 也就是说**「不是这个人能用的」这条拒绝路径只可能发生在武器上**。
 *
 * 抄一份而不是读磁盘：这一层要进浏览器包（`battle/drugs.ts` / `menu/defaultWeapons.ts`
 * 同一个理由）。而"抄了一份"必须有人核 —— `equipment.test.ts` 自己去读那六份
 * GBK 数据逐行对，**分母从磁盘现扫**（`sources/Shop/*.txt` 减掉 `drug.txt`），
 * 抄错一位、少抄一行、多一份表没人认领，都红。
 */

/** 六个槽位。次序照 `EquipPanel` 里 `buttonlist[0..5]` 的排布（也是页面上那一排的左右次序）。 */
export type EquipSlot = 'weapon' | 'armor' | 'helmet' | 'shoe' | 'glove' | 'decoration'

/**
 * 槽位 → `EquipPanel` 里那个 `CURRENTLIST` 整数。真值的 `equip.tab` 那一列
 * 就是这个数经 `MenuDriver.slotName()` 换回来的名字。
 */
export const SLOT_CODE: Readonly<Record<EquipSlot, number>> = {
  weapon: 1,
  armor: 2,
  helmet: 3,
  shoe: 4,
  glove: 5,
  decoration: 6,
}

/** 槽位 → `sources/Shop/<名字>.txt`，也就是 `ShopReader.readEquipment(s)` 的那个 `s`。 */
export const SLOT_FILE: Readonly<Record<EquipSlot, string>> = {
  weapon: '武器',
  armor: '盔甲',
  helmet: '头',
  shoe: '脚',
  glove: '手',
  decoration: '饰品',
}

/** 六个槽位的**遍历次序**。`EquipPanel.buttonlist` 与真值 `equipped` 那六个键都是它。 */
export const EQUIP_SLOTS: readonly EquipSlot[] = [
  'weapon',
  'armor',
  'helmet',
  'shoe',
  'glove',
  'decoration',
]

export interface EquipmentSpec {
  readonly name: string
  readonly addPhysicalPower: number
  readonly addAgile: number
  readonly addStrength: number
  readonly addSpirit: number
  /** `sources/Shop/装备/<SLOT_FILE[slot]>/<picture>`。装备页中间那张图就是它。 */
  readonly picture: string
  readonly reduceMoney: number
  /**
   * `Equipment.user`：**0 = 谁都能用**，否则只有 `Scoll.whichHero` 等于它的那个人
   * 能用（1 张小凡 / 2 陆雪琪 / 4 玉洁）。
   * 只有武器表有这一列，别的五类全是 0 —— 见文件头注。
   */
  readonly user: number
}

/** `EquipmentPack.weaponList` —— `sources/Shop/武器.txt`，逐行同序。 */
const WEAPONS: readonly EquipmentSpec[] = [
  { name: '藏璎环', addPhysicalPower: 0, addAgile: 0, addStrength: 3, addSpirit: 2, picture: '藏璎环.png', reduceMoney: 5000, user: 2 },
  { name: '茶罗骨环', addPhysicalPower: 0, addAgile: 0, addStrength: 3, addSpirit: 4, picture: '茶罗骨环.png', reduceMoney: 10000, user: 2 },
  { name: '叹云竹环', addPhysicalPower: 0, addAgile: 0, addStrength: 5, addSpirit: 6, picture: '叹云竹环.png', reduceMoney: 20000, user: 2 },
  { name: '颀鉴巨环', addPhysicalPower: 0, addAgile: 0, addStrength: 6, addSpirit: 8, picture: '颀鉴巨环.png', reduceMoney: 30000, user: 2 },
  { name: '瑑琼环', addPhysicalPower: 1, addAgile: 1, addStrength: 5, addSpirit: 15, picture: '瑑琼环.png', reduceMoney: 60000, user: 2 },
  { name: '日月乾坤圈', addPhysicalPower: 1, addAgile: 1, addStrength: 0, addSpirit: 30, picture: '日月乾坤圈.png', reduceMoney: 80000, user: 2 },
  { name: '月苗刀', addPhysicalPower: 0, addAgile: 1, addStrength: 2, addSpirit: 1, picture: '月苗刀.png', reduceMoney: 3000, user: 0 },
  { name: '鸳鸯刀', addPhysicalPower: 3, addAgile: 0, addStrength: 2, addSpirit: 0, picture: '鸳鸯刀.png', reduceMoney: 5000, user: 4 },
  { name: '鱼肠', addPhysicalPower: 0, addAgile: 3, addStrength: 2, addSpirit: 4, picture: '鱼肠.png', reduceMoney: 16000, user: 1 },
  { name: '工布', addPhysicalPower: 0, addAgile: 5, addStrength: 2, addSpirit: 10, picture: '工布.png', reduceMoney: 30000, user: 4 },
  { name: '鬼煞胡刀', addPhysicalPower: 0, addAgile: 10, addStrength: 0, addSpirit: 15, picture: '鬼煞胡刀.png', reduceMoney: 60000, user: 0 },
  { name: '御衡镇日刀', addPhysicalPower: 0, addAgile: 20, addStrength: 20, addSpirit: -10, picture: '御衡镇日刀.png', reduceMoney: 80000, user: 4 },
  { name: '湛卢', addPhysicalPower: 2, addAgile: 2, addStrength: 2, addSpirit: 2, picture: '湛卢.png', reduceMoney: 8000, user: 1 },
  { name: '巨阙', addPhysicalPower: 4, addAgile: 2, addStrength: 6, addSpirit: 0, picture: '巨阙.png', reduceMoney: 12000, user: 1 },
  { name: '龙泉', addPhysicalPower: 0, addAgile: 5, addStrength: 8, addSpirit: 4, picture: '龙泉.png', reduceMoney: 30000, user: 1 },
  { name: '泰阿', addPhysicalPower: 0, addAgile: 0, addStrength: 23, addSpirit: 0, picture: '泰阿.png', reduceMoney: 50000, user: 1 },
  { name: '青钢剑', addPhysicalPower: 0, addAgile: 0, addStrength: 5, addSpirit: 5, picture: '青钢剑.png', reduceMoney: 30000, user: 0 },
  { name: '鬼眼法刀', addPhysicalPower: 0, addAgile: 0, addStrength: 5, addSpirit: 12, picture: '鬼眼法刀.png', reduceMoney: 40000, user: 0 },
  { name: '千月星痕', addPhysicalPower: 0, addAgile: 0, addStrength: 15, addSpirit: 8, picture: '千月星痕.png', reduceMoney: 60000, user: 0 },
  { name: '赤龙牙', addPhysicalPower: 0, addAgile: 0, addStrength: 15, addSpirit: 20, picture: '赤龙牙.png', reduceMoney: 80000, user: 0 },
]

/** `EquipmentPack.armorList` —— `sources/Shop/盔甲.txt`。 */
const ARMORS: readonly EquipmentSpec[] = [
  { name: '棉布衣', addPhysicalPower: 3, addAgile: 0, addStrength: 0, addSpirit: 0, picture: '棉布衣.png', reduceMoney: 6000, user: 0 },
  { name: '蓝格怪衣', addPhysicalPower: 4, addAgile: 0, addStrength: 2, addSpirit: 0, picture: '蓝格怪衣.png', reduceMoney: 7000, user: 0 },
  { name: '铁甲', addPhysicalPower: 5, addAgile: 0, addStrength: 1, addSpirit: 4, picture: '铁甲.png', reduceMoney: 10000, user: 0 },
  { name: '血殷长袍', addPhysicalPower: 6, addAgile: 0, addStrength: 0, addSpirit: 6, picture: '血殷长袍.png', reduceMoney: 25000, user: 0 },
  { name: '玄雪丝衣', addPhysicalPower: 8, addAgile: 0, addStrength: 3, addSpirit: 8, picture: '玄雪丝衣.png', reduceMoney: 35000, user: 0 },
  { name: '天仙神衣', addPhysicalPower: 8, addAgile: 8, addStrength: 8, addSpirit: 8, picture: '天仙神衣.png', reduceMoney: 50000, user: 0 },
]

/**
 * `EquipmentPack.helmetList` —— `sources/Shop/头.txt`。
 *
 * ⚠️ 「紫金冠」那一行的图片文件名写的是 `圣兽玲珑冠.png`（与上一行同一张）。
 * 原版数据就是这样，**不许"顺手修好"**（CLAUDE.md：不要"修"脚本数据）。
 */
const HELMETS: readonly EquipmentSpec[] = [
  { name: '金刚斗笠', addPhysicalPower: 3, addAgile: 0, addStrength: 0, addSpirit: 0, picture: '金刚斗笠.png', reduceMoney: 5000, user: 0 },
  { name: '武兜', addPhysicalPower: 4, addAgile: 2, addStrength: 0, addSpirit: 0, picture: '武兜.png', reduceMoney: 12000, user: 0 },
  { name: '龙鳞盔', addPhysicalPower: 7, addAgile: 0, addStrength: 0, addSpirit: 1, picture: '龙鳞盔.png', reduceMoney: 16000, user: 0 },
  { name: '圣兽玲珑冠', addPhysicalPower: 6, addAgile: 0, addStrength: 0, addSpirit: 3, picture: '圣兽玲珑冠.png', reduceMoney: 20000, user: 0 },
  { name: '紫金冠', addPhysicalPower: 8, addAgile: 0, addStrength: 0, addSpirit: 6, picture: '圣兽玲珑冠.png', reduceMoney: 20000, user: 0 },
  { name: '金霞兜', addPhysicalPower: 14, addAgile: 0, addStrength: 0, addSpirit: 4, picture: '金霞兜.png', reduceMoney: 40000, user: 0 },
]

/** `EquipmentPack.shoeList` —— `sources/Shop/脚.txt`。 */
const SHOES: readonly EquipmentSpec[] = [
  { name: '皮靴', addPhysicalPower: 1, addAgile: 2, addStrength: 0, addSpirit: 0, picture: '皮靴.png', reduceMoney: 2000, user: 0 },
  { name: '踏风草鞋', addPhysicalPower: 2, addAgile: 3, addStrength: 0, addSpirit: 0, picture: '踏风草鞋.png', reduceMoney: 3000, user: 0 },
  { name: '混天泥鞋', addPhysicalPower: 4, addAgile: 5, addStrength: 0, addSpirit: 0, picture: '混天泥鞋.png', reduceMoney: 8000, user: 0 },
  { name: '五行鞋', addPhysicalPower: 5, addAgile: 6, addStrength: 0, addSpirit: 2, picture: '五行鞋.png', reduceMoney: 15000, user: 0 },
  { name: '七星法靴', addPhysicalPower: 1, addAgile: 8, addStrength: 0, addSpirit: 6, picture: '七星法靴.png', reduceMoney: 20000, user: 0 },
  { name: '钛珖奇鞋', addPhysicalPower: 2, addAgile: 10, addStrength: 0, addSpirit: 8, picture: '钛珖奇鞋.png', reduceMoney: 40000, user: 0 },
]

/** `EquipmentPack.gloveList` —— `sources/Shop/手.txt`。 */
const GLOVES: readonly EquipmentSpec[] = [
  { name: '狂狮战腕', addPhysicalPower: 1, addAgile: 2, addStrength: 0, addSpirit: 2, picture: '狂狮战腕.png', reduceMoney: 6000, user: 0 },
  { name: '冰晶腕', addPhysicalPower: 1, addAgile: 0, addStrength: 0, addSpirit: 6, picture: '冰晶腕.png', reduceMoney: 12000, user: 0 },
  { name: '蓝堂护手', addPhysicalPower: 0, addAgile: 0, addStrength: 7, addSpirit: 3, picture: '蓝堂护手.png', reduceMoney: 30000, user: 0 },
  { name: '青电臂', addPhysicalPower: 0, addAgile: 0, addStrength: 4, addSpirit: 4, picture: '青电臂.png', reduceMoney: 20000, user: 0 },
  { name: '灵蛇手套', addPhysicalPower: 2, addAgile: 0, addStrength: 4, addSpirit: 5, picture: '灵蛇手套.png', reduceMoney: 30000, user: 0 },
  { name: '蛟精奇腕', addPhysicalPower: 4, addAgile: 2, addStrength: 8, addSpirit: 4, picture: '蛟精奇腕.png', reduceMoney: 80000, user: 0 },
]

/** `EquipmentPack.decorationList` —— `sources/Shop/饰品.txt`。 */
const DECORATIONS: readonly EquipmentSpec[] = [
  { name: '铁戒指', addPhysicalPower: 0, addAgile: 0, addStrength: 0, addSpirit: 2, picture: '铁戒指.png', reduceMoney: 2000, user: 0 },
  { name: '铜戒指', addPhysicalPower: 0, addAgile: 0, addStrength: 2, addSpirit: 0, picture: '铜戒指.png', reduceMoney: 2000, user: 0 },
  { name: '银戒指', addPhysicalPower: 0, addAgile: 2, addStrength: 0, addSpirit: 0, picture: '银戒指.png', reduceMoney: 2000, user: 0 },
  { name: '金戒指', addPhysicalPower: 3, addAgile: 0, addStrength: 0, addSpirit: 0, picture: '金戒指.png', reduceMoney: 5000, user: 0 },
  { name: '银项链', addPhysicalPower: 0, addAgile: 3, addStrength: 0, addSpirit: 0, picture: '银项链.png', reduceMoney: 5000, user: 0 },
  { name: '金项练', addPhysicalPower: 2, addAgile: 0, addStrength: 1, addSpirit: 2, picture: '金项练.png', reduceMoney: 8000, user: 0 },
  { name: '珍珠戒指', addPhysicalPower: 1, addAgile: 1, addStrength: 3, addSpirit: 4, picture: '珍珠戒指.png', reduceMoney: 25000, user: 0 },
  { name: '玉戒指', addPhysicalPower: 1, addAgile: 2, addStrength: 4, addSpirit: 5, picture: '玉戒指.png', reduceMoney: 25000, user: 0 },
  { name: '白玉龙纹佩', addPhysicalPower: 2, addAgile: 3, addStrength: 5, addSpirit: 6, picture: '白玉龙纹佩.png', reduceMoney: 40000, user: 0 },
  { name: '白玉飞天佩', addPhysicalPower: 0, addAgile: 0, addStrength: 6, addSpirit: 6, picture: '白玉飞天佩.png', reduceMoney: 20000, user: 0 },
  { name: '太极护符', addPhysicalPower: 5, addAgile: 0, addStrength: 0, addSpirit: 10, picture: '太极护符.png', reduceMoney: 40000, user: 0 },
  { name: '五彩石项练', addPhysicalPower: 5, addAgile: 5, addStrength: 10, addSpirit: 10, picture: '五彩石项练.png', reduceMoney: 60000, user: 0 },
]

/** 六张表，按槽位取。`EquipmentPack.listTable(String)` 的对应物。 */
export const EQUIPMENT_LISTS: Readonly<Record<EquipSlot, readonly EquipmentSpec[]>> = {
  weapon: WEAPONS,
  armor: ARMORS,
  helmet: HELMETS,
  shoe: SHOES,
  glove: GLOVES,
  decoration: DECORATIONS,
}
