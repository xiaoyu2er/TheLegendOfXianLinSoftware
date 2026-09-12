import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { DRUGS } from './drugs'
import { DRUG_TYPE } from './step'

/**
 * 战斗里用药那六个 type（xl-byy）。
 *
 * `battle-drugs` 那份真值只点过第 1、2 味（金创药回血、姜黄粉回蓝），剩下四个
 * type 没有真值走到 —— 抄错一位与抄对了在逐字段比对里长得一样。所以这四位
 * （连同已经有真值的两位）回到 GBK 源码上取：`DrugMenu.checkReleased` 里那六句
 * `checkDrugNumber(DrugPack.drugList.get(i), type)`。
 */
describe('DrugMenu.checkReleased 的六个 type 对回原版源码', () => {
  const calls = [
    ...javaSource('src/battle/DrugMenu.java').matchAll(
      /checkDrugNumber\(DrugPack\.drugList\.get\((\d)\),\s*(\d)\)/g,
    ),
  ].map((m) => [Number(m[1]), Number(m[2])] as const)

  it('从源码里真的解出了调用 —— 解析器空转要响', () => {
    // 分母是药表的行数（`DRUGS` 对过 drug.txt），不写死 6。
    expect(calls.length).toBe(DRUGS.length)
    expect(calls.map(([i]) => i)).toEqual(DRUGS.map((_, i) => i))
  })

  it('逐位相等', () => {
    expect(DRUG_TYPE).toEqual(calls.map(([, type]) => type))
  })

  it('type 与药性对得上 —— 今天的药表恰好是回血、回蓝交替', () => {
    // 这一条不是规格（原版按位置写死，见 `DRUG_TYPE` 的注释），是个提示：哪天
    // 它红了，说明药表换了次序，而原版会拿回血药去加灵力 —— 那时照原版，
    // 把这一条改成登记那个缺陷，不要改 `DRUG_TYPE`。
    DRUGS.forEach((d, i) => {
      expect(DRUG_TYPE[i] === 1 ? d.addHp : d.addMp).toBeGreaterThan(0)
    })
  })
})
