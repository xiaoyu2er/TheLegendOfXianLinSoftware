import { declareFake } from './fake'

/**
 * **假的背包**（`shop.DrugPack`）。归 xl-6lo.1（M3 菜单 / 物品面板）。
 *
 * 原版是一个静态的 `ArrayList<Drug>`，由 `ShopReader.readDrug()` 从
 * `sources/Drug/` 读出来，`addDrug(name, number)` 在这张表里**按名字找**，
 * 找不到就**什么都不做**（原版那个 for 循环没有 else）。
 *
 * 这一份假在哪：
 *
 * - **不读 `sources/Drug/`**，没有那张出厂表，于是**来者不拒** —— 原版会
 *   悄悄丢掉的名字，这里会收下。真货做出来之后这条差别是看得见的。
 * - 只有"名字 → 件数"，没有 `Drug` 的价格、说明、图标那些字段。
 *
 * 真的那一份要连 `sources/Drug/` 的读取一起做，见 xl-6lo.1。
 */
export const FAKE = declareFake('drugPack')

/** 原版那个 `public static ArrayList<Drug> drugList` 的位置：模块级单例。 */
const bag = new Map<string, number>()

/** `DrugPack.addDrug(name, number)`。 */
export function addDrug(name: string, number: number): void {
  bag.set(name, (bag.get(name) ?? 0) + number)
}

/**
 * `Drug.setNumberGOT(number)` —— 直接写件数，不是加。唯一的调用方是读档
 * （`ShopPanel.initialShopInfo`，xl-i06.10）。
 */
export function setDrugCount(name: string, number: number): void {
  bag.set(name, number)
}

/** 背包里某个药品有几件。原版是 `Drug.getNumberGOT()`。 */
export function drugCount(name: string): number {
  return bag.get(name) ?? 0
}

/** 背包现在装了什么。**只给判据用** —— 原版没有这个方法。 */
export function drugEntries(): ReadonlyArray<readonly [string, number]> {
  return [...bag.entries()]
}

/**
 * 清空。原版没有这个方法：它的背包是进程级静态字段，一局游戏只有一份。
 * 这里要它是因为测试之间不能互相污染 —— 而"上一条用例留下的药"与
 * "这一场真的发了药"长得一样。
 */
export function resetDrugPack(): void {
  bag.clear()
}
