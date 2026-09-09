import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { createShopWorld } from '../shop/world'
import { EQUIPMENT_LISTS, EQUIP_SLOTS, SLOT_FILE } from './equipment'
import type { EquipSlot, EquipmentSpec } from './equipment'

/**
 * `equipment.ts` 抄的那六张表，逐行核回 `sources/Shop/` 下的 GBK 数据。
 *
 * 抄错一位、少抄一行、把两类的表接反了 —— 在别处全都长得跟抄对了一样：装备页
 * 的列表照样画得出来，属性照样在变，只是数字是错的。所以这里不是"再写一遍
 * 常量"，而是**拿原版自己的数据当分母**。
 *
 * ⚠️ 这个文件自己解 GBK（`sources/Shop/*.txt` 是**游戏数据**不是 Java 源码，
 * 与 `battle/drugs.test.ts` / `menu/defaultWeapons.test.ts` 同一个理由），
 * 已经手签进 `test/javaSource.test.ts` 的豁免表。
 */

/** 一份 GBK+CRLF 数据表的有效行。空行丢掉 —— 有的表末尾没有换行，有的有。 */
function dataLines(file: string): string[] {
  const text = new TextDecoder('gbk').decode(readFileSync(repoPath('sources/Shop', `${file}.txt`)))
  return text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0)
}

/** `ShopReader.readEquipment` 那一段，逐行照抄。 */
function parseLine(line: string): EquipmentSpec {
  const f = line.split('/')
  // 8 列（除武器外的五类）或 9 列（武器）。别的列数说明数据表的形状变了，
  // 而"多一列少一列"在下面那些 `Number(f[i])` 底下会静静地变成 NaN。
  expect([8, 9], `「${line}」的列数不是 8 或 9`).toContain(f.length)
  return {
    name: f[0]!,
    addPhysicalPower: Number(f[1]),
    addAgile: Number(f[2]),
    addStrength: Number(f[3]),
    addSpirit: Number(f[4]),
    picture: f[5]!,
    reduceMoney: Number(f[6]),
    // `if(lineArray.length==9){ setUser(...) }` —— 别的表没这一列，`user` 停在 0。
    user: f.length === 9 ? Number(f[8]) : 0,
  }
}

describe('六类装备的全表对齐原版数据', () => {
  it('分母：`sources/Shop` 下的装备表，一张都不许漏登记', () => {
    // **现扫**，不写死名单：新加一份装备表而没人抄进 `equipment.ts` 时要红。
    const tables = readdirSync(repoPath('sources/Shop'))
      .filter((n) => n.endsWith('.txt'))
      .map((n) => n.replace(/\.txt$/, ''))
      .sort()
    // `drug.txt` 是药品，归 `battle/drugs.ts`（列的含义都不一样）。
    const equipTables = tables.filter((n) => n !== 'drug')
    // 空转要响：目录名写错了与"一张表都没有"长得一样。
    expect(tables).toContain('drug')
    expect(equipTables.length).toBeGreaterThan(0)
    expect(equipTables).toEqual([...EQUIP_SLOTS].map((s) => SLOT_FILE[s]).sort())
  })

  it.each(EQUIP_SLOTS)('%s 那一张逐行相等', (slot: EquipSlot) => {
    const lines = dataLines(SLOT_FILE[slot])
    // 分母是磁盘上的行数。零行的逐行对比是恒真的 —— 文件名写错了就长这样。
    expect(lines.length, `${SLOT_FILE[slot]}.txt 一行都没读到`).toBeGreaterThan(0)
    expect(EQUIPMENT_LISTS[slot].map((e) => ({ ...e }))).toEqual(lines.map(parseLine))
  })

  /**
   * ⚠️ **第三个消费者的对撞判据**（xl-knp.8 / xl-knp.2，与 `battle/drugs.test.ts`
   * 里药店那一条同构、同一个理由）。
   *
   * 这六张表现在有三处在读：菜单的装备页、装备自选超市的六栏列表，以及这份
   * 数据本身。xl-knp.2 明确**决定不把它抽到共享位置**（抽公共件会撞 M3 刚落
   * 的文件，而抽到一起也防不住有人再抄一份出去），改用这一条：装备超市六栏
   * 列出来的与这里**逐字相等**。
   *
   * 哪天有人给商店另抄一份价格表，或者在 `shop/world.ts` 的 `equipRows` 里
   * 改了名字与价钱的来源，这一条立刻红 —— 而"三份分家"平时是**看不出来的**：
   * 各自的测试都还绿着，只有改了其中一份的那一天才会露头。
   */
  it('⚠️ 装备超市六栏列出来的与这六张表逐字相等 —— 三处消费的是同一份', () => {
    // 种子随便给：名字与价钱不是摇出来的，摇出来的只有存货。
    const shop = createShopWorld({ party: ['zhang'], coins: 10000, seed: 1 }).equipment.rows
    // ⚠️ **分母两头现数**：商店那一头的栏目名单从它自己的键现取，这一头从
    // `EQUIP_SLOTS`。少一栏、多一栏（或者两份名单认的不是同一个集合）都露头。
    const slots = Object.keys(shop).sort()
    expect(slots.length).toBeGreaterThan(0)
    expect(slots, '装备超市的栏目名单与这六张表的槽位名单不是同一个集合').toEqual(
      [...EQUIP_SLOTS].sort(),
    )
    for (const slot of EQUIP_SLOTS) {
      // 每一栏自己带分母：空栏的逐行对比是恒真的。
      expect(shop[slot]!.length, `装备超市 ${slot} 那一栏是空的`).toBeGreaterThan(0)
      expect(shop[slot]!.length, `装备超市 ${slot} 那一栏的行数`).toBe(EQUIPMENT_LISTS[slot].length)
      expect(
        shop[slot]!.map((r) => [r.name, r.price]),
        `装备超市 ${slot} 那一栏与这张表对不上`,
      ).toEqual(EQUIPMENT_LISTS[slot].map((e) => [e.name, e.reduceMoney]))
    }
  })

  it('只有武器有使用者限制 —— 「不是这个人能用的」那条拒绝路径只可能发生在武器上', () => {
    for (const slot of EQUIP_SLOTS) {
      // 每一槽自己带分母：表空了的话下面那条 `toEqual([])` 就是恒真，
      // 而"这张表没有使用者限制"与"这张表根本没读到"长得一样。
      expect(EQUIPMENT_LISTS[slot].length, `${slot} 那张表是空的`).toBeGreaterThan(0)
      const restricted = EQUIPMENT_LISTS[slot].filter((e) => e.user !== 0)
      if (slot === 'weapon') {
        expect(restricted.length, '武器表里一件带使用者限制的都没有').toBeGreaterThan(0)
      } else {
        expect(restricted.map((e) => e.name), `${slot} 表里出现了使用者限制`).toEqual([])
      }
    }
  })
})
