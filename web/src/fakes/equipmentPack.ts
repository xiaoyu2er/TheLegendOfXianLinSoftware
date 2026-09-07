import { declareFake } from './fake'

/**
 * **假的装备包**（`shop.EquipmentPack`）。归 xl-6lo.1（M3 菜单 / 装备面板）。
 *
 * 原版是六个静态 `ArrayList<Equipment>`（头 / 盔甲 / 武器 / 手 / 脚 / 饰品），
 * 由 `ShopReader.readEquipment(...)` 从 `sources/` 读出来；
 * `addEqupment(name, number)`（原版就是这个拼写）挨个把六张表扫一遍，
 * **找不到同样什么都不做**。
 *
 * 这一份假在哪：
 *
 * - **不分六类**，也不读 `sources/`，于是同样**来者不拒**；
 * - 只有"名字 → 件数"，没有 `Equipment` 的属性加成、部位、价格。
 *
 * 真的那一份见 xl-6lo.1。
 */
export const FAKE = declareFake('equipmentPack')

const pack = new Map<string, number>()

/** `EquipmentPack.addEqupment(name, number)`。**名字照抄原版的拼写。** */
export function addEqupment(name: string, number: number): void {
  pack.set(name, (pack.get(name) ?? 0) + number)
}

/** 装备包里某件装备有几件。 */
export function equipmentCount(name: string): number {
  return pack.get(name) ?? 0
}

/** 装备包现在装了什么。**只给判据用**。 */
export function equipmentEntries(): ReadonlyArray<readonly [string, number]> {
  return [...pack.entries()]
}

/** 清空。理由同 `resetDrugPack`。 */
export function resetEquipmentPack(): void {
  pack.clear()
}
