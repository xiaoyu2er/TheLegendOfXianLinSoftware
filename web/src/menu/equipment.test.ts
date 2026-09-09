import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { EQUIPMENT_LISTS, EQUIP_SLOTS, SLOT_CODE, SLOT_FILE } from './equipment'
import type { EquipSlot, EquipmentSpec } from './equipment'
import { javaSource } from '../test/javaSource'

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

  it('只有武器有使用者限制 —— 「不是这个人能用的」那条拒绝路径只可能发生在武器上', () => {
    for (const slot of EQUIP_SLOTS) {
      const restricted = EQUIPMENT_LISTS[slot].filter((e) => e.user !== 0)
      if (slot === 'weapon') {
        expect(restricted.length, '武器表里一件带使用者限制的都没有').toBeGreaterThan(0)
      } else {
        expect(restricted.map((e) => e.name), `${slot} 表里出现了使用者限制`).toEqual([])
      }
    }
  })

  it('CURRENTLIST 的六个常量与原版相同', () => {
    // 真值 `equip.tab` 那一列是这个数换回来的名字，错一位就是"选中的槽位是另一个"。
    const src = javaSource('src/menu/EquipPanel.java')
    const found = new Map<string, number>()
    for (const m of src.matchAll(/final int (WEAPON|ARMOR|HELMET|SHOE|GLOVE|DECORATION)=(\d+);/g)) {
      found.set(m[1]!, Number(m[2]))
    }
    // 解不出来与"解出来全对"长得一样（GBK 源码被当成二进制、字段被挪走都是零匹配）。
    expect(found.size, 'EquipPanel.java 里一个槽位常量都没解出来').toBe(EQUIP_SLOTS.length)
    for (const slot of EQUIP_SLOTS) {
      expect(found.get(SLOT_FILE_CONST[slot]), `${slot} 的 CURRENTLIST`).toBe(SLOT_CODE[slot])
    }
  })
})

/** 槽位 → `EquipPanel` 里那个 `final int` 常量名。 */
const SLOT_FILE_CONST: Readonly<Record<EquipSlot, string>> = {
  weapon: 'WEAPON',
  armor: 'ARMOR',
  helmet: 'HELMET',
  shoe: 'SHOE',
  glove: 'GLOVE',
  decoration: 'DECORATION',
}
