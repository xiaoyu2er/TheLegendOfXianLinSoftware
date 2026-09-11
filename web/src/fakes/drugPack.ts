import { DRUGS } from '../battle/drugs'
import { declareFake } from './fake'

/**
 * **假的背包**（`shop.DrugPack`）。归 xl-6lo.1（M3 菜单 / 物品面板）。
 *
 * 原版是一个静态的 `ArrayList<Drug>`，由 `ShopReader.readDrug()` 从
 * `sources/Shop/drug.txt` 读出来，`addDrug(name, number)` 在这张表里**按名字找**，
 * 找不到就**什么都不做**（原版那个 for 循环没有 else）。
 *
 * 这一份假在哪：
 *
 * - 只有"名字 → 件数"，没有 `Drug` 的价格、说明、图标那些字段。
 *
 * ⚠️ 从前这里还有一条「来者不拒」：没有出厂表，原版会悄悄丢掉的名字这里照收。
 * xl-03x.3 的账本对撞第一次在真剧本上撞出了它 —— maze-treasure 那个箱子写的是
 * 「金疮药」（脚本错字；2026-09-11 iconv 转码后现数，5 本脚本有这个词），原版药表里是「金创药」，原版开箱**一件都
 * 没进背包**，这里进了 2 件。现在按名字对照 `DRUGS`（逐行对过 drug.txt，见
 * `battle/drugs.test.ts`），对不上什么都不做。脚本数据按约定不修。
 */
export const FAKE = declareFake('drugPack')

/** 原版那个 `public static ArrayList<Drug> drugList` 的位置：模块级单例。 */
const bag = new Map<string, number>()

/** 原版药表里有的名字。`addDrug` 只认它们。 */
const KNOWN = new Set(DRUGS.map((d) => d.name))

/**
 * `DrugPack.addDrug(name, number)`。名字不在原版药表里时**什么都不做** ——
 * 与 `shop/world.ts` 的同名函数不同，那边的名字来自剧本 setup，所以改成了抛；这里的
 * 名字来自游戏数据（宝箱、战利品），原版就是一声不响地丢掉。
 */
export function addDrug(name: string, number: number): void {
  if (!KNOWN.has(name)) return
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
