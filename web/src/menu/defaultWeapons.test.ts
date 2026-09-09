import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import { DEFAULT_WEAPONS } from './defaultWeapons'
import type { PartyKey } from '../battle/units'

/**
 * `defaultWeapons.ts` 抄得对不对，由原版自己说了算 —— **两头都核**：
 *
 * - **下标**从 `src/menu/EquipPanel.java` 的 `addPack()` 里解出来。写死一个
 *   6/0/7 是抄来的数，而抄错一位之后属性仍然合法、仍然三个人各不相同，
 *   只有跟真值逐字段比才露头 —— 那时已经分不清是这里错了还是别处错了。
 * - **四项加成**从 `sources/Shop/武器.txt` 的那一行按 `ShopReader.readEquipment`
 *   的列序读出来。
 *
 * 两份数据都是 GBK；源码走 `javaSource`，数据文件按 `battle/drugs.test.ts`
 * 立下的规矩自己解（那份豁免登记在 `test/javaSource.ts`）。
 */
describe('三个人开局那把武器，对回原版', () => {
  /** `hero1/hero2/hero4` 三个字段名对应的队伍键 —— `MenuPanel` 的字段顺序。 */
  const FIELD_OF: Readonly<Record<PartyKey, string>> = {
    zhang: 'equipPack_hero1',
    lu: 'equipPack_hero2',
    yu: 'equipPack_hero4',
  }

  const equipPanel = javaSource('src/menu/EquipPanel.java')

  /** `sources/Shop/武器.txt`：GBK + CRLF，`ShopReader.readEquipment` 按 `/` 切。 */
  const weaponRows = new TextDecoder('gbk')
    .decode(readFileSync(repoPath('sources/Shop/武器.txt')))
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.split('/'))

  it('武器表真的读到了行 —— 解析器空转要响', () => {
    expect(weaponRows.length).toBeGreaterThan(0)
    for (const cols of weaponRows) {
      // `readEquipment` 读到第 7 列（下标 6）为止，第 9 列才是 user。
      expect(cols.length).toBeGreaterThanOrEqual(7)
    }
  })

  for (const key of Object.keys(FIELD_OF) as PartyKey[]) {
    it(`${key}：下标与四项加成都对得上`, () => {
      const field = FIELD_OF[key]
      // `equipPack_hero1.weapon=EquipmentPack.weaponList.get(6);`
      const matches = [
        ...equipPanel.matchAll(
          new RegExp(`${field}\\.weapon\\s*=\\s*EquipmentPack\\.weaponList\\.get\\((\\d+)\\)`, 'g'),
        ),
      ]
      // 解不出来就是零匹配，而零匹配下面的循环一条断言都不跑（javaSource 的规矩）。
      expect(matches, `${field}.weapon 那一行在 EquipPanel.java 里没解出来`).toHaveLength(1)
      const index = Number(matches[0]![1])
      expect(DEFAULT_WEAPONS[key].index).toBe(index)

      const row = weaponRows[index]
      expect(row, `武器表里没有第 ${index} 行`).toBeDefined()
      expect([
        DEFAULT_WEAPONS[key].name,
        DEFAULT_WEAPONS[key].addPhysicalPower,
        DEFAULT_WEAPONS[key].addAgile,
        DEFAULT_WEAPONS[key].addStrength,
        DEFAULT_WEAPONS[key].addSpirit,
      ]).toEqual([row![0]!, Number(row![1]), Number(row![2]), Number(row![3]), Number(row![4])])
    })
  }

  it('三把不是同一把 —— 否则「谁穿哪把」抄错了也看不见', () => {
    const names = Object.values(DEFAULT_WEAPONS).map((w) => w.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
