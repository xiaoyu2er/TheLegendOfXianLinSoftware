import type { PartyKey } from '../battle/units'

/**
 * 三个人**开局身上那把武器**，以及它加的四项属性。
 *
 * 为什么这四个数属于这一层：菜单里三个人的属性不是 `HEROES[key].attributes(level)`
 * 那一份。`new MenuPanel()` 走的是三个**空构造函数**（一行代码都没有），四项
 * 基础属性因此停在 static 字段的初值上；真正把它们推到真值里那几个数上的是
 * `EquipPanel` 的构造函数 —— 它调 `addPack()`，给三个人各穿一把写死下标的武器
 * 并把武器的加成 `+=` 上去，然后 `refreshValue()`。
 *
 * 也就是说：**菜单真值第 0 帧的属性 = static 初值 + 这三把武器的加成**。少了这
 * 一步，张小凡的敏捷会是 10 而不是真值里的 11 —— 一个完全合法、完全错误的数。
 *
 * 抄一份而不是读磁盘：这一层要进浏览器包（`battle/drugs.ts` 同一个理由）。
 * 而"抄了一份"必须有人核 —— `defaultWeapons.test.ts` 同时核两头：下标从
 * `src/menu/EquipPanel.java` 的 `addPack()` 里解出来，四个数从
 * `sources/Shop/武器.txt` 的那一行里读出来。抄错一位在别处长得跟抄对了一样。
 */
export interface WeaponBonus {
  /** `EquipmentPack.weaponList.get(n)` 里的那个 n —— 判据从原版源码里解。 */
  readonly index: number
  readonly name: string
  readonly addPhysicalPower: number
  readonly addAgile: number
  readonly addStrength: number
  readonly addSpirit: number
}

export const DEFAULT_WEAPONS: Readonly<Record<PartyKey, WeaponBonus>> = {
  zhang: { index: 6, name: '月苗刀', addPhysicalPower: 0, addAgile: 1, addStrength: 2, addSpirit: 1 },
  lu: { index: 0, name: '藏璎环', addPhysicalPower: 0, addAgile: 0, addStrength: 3, addSpirit: 2 },
  yu: { index: 7, name: '鸳鸯刀', addPhysicalPower: 3, addAgile: 0, addStrength: 2, addSpirit: 0 },
}
