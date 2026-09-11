import { describe, expect, it } from 'vitest'
import { judgeLedger } from './ledger'
import type { LedgerEntry } from './ledger'

const drugs = (n: number) => [
  { name: '金疮药', count: n },
  { name: '回灵散', count: 0 },
]
const entry = (coins: number, n = 0): LedgerEntry => ({ coins, drugs: drugs(n) })
/** Web 那一侧：假药包只记收到过的名字，没收到过的整个不在。 */
const webEntry = (coins: number, n = 0): LedgerEntry => ({ coins, drugs: n === 0 ? [] : [{ name: '金疮药', count: n }] })

describe('judgeLedger', () => {
  it('逐帧相等才算过，结论里带着末帧的数（关票要贴读数）', () => {
    const v = judgeLedger([0, 25], [entry(10000), entry(10750, 2)], [webEntry(10000), webEntry(10750, 2)])
    expect(v.ok).toBe(true)
    expect(v.verdict).toContain('10750')
  })

  it('金币差一个数就红，并指出第一帧', () => {
    const v = judgeLedger([0, 25, 50], [entry(10000), entry(9500), entry(9500)], [webEntry(10000), webEntry(10500), webEntry(9500)])
    expect(v.ok).toBe(false)
    expect(v.firstMismatch).toBe(25)
    expect(v.verdict).toContain('9500')
    expect(v.verdict).toContain('10500')
  })

  it('药的件数不同就红', () => {
    const v = judgeLedger([0], [entry(10000, 2)], [webEntry(10000, 1)])
    expect(v.ok).toBe(false)
    expect(v.verdict).toContain('金疮药')
  })

  it('Web 收下了原版药包里没有的名字（原版 addDrug 会悄悄丢掉）也红', () => {
    const v = judgeLedger([0], [entry(10000)], [{ coins: 10000, drugs: [{ name: '仙丹', count: 1 }] }])
    expect(v.ok).toBe(false)
    expect(v.verdict).toContain('仙丹')
  })

  it('Web 那边件数为 0 的陌生名字不算差（空着与没收过同值）', () => {
    expect(judgeLedger([0], [entry(10000)], [{ coins: 10000, drugs: [{ name: '仙丹', count: 0 }] }]).ok).toBe(true)
  })

  it('帧清单里没有账本是硬失败，不是「没什么可比」', () => {
    expect(() => judgeLedger([0], undefined, [webEntry(10000)])).toThrow(/ledger/)
  })

  it('原版药包是空表是硬失败 —— 对药等于对空气', () => {
    expect(() => judgeLedger([0], [{ coins: 10000, drugs: [] }], [webEntry(10000)])).toThrow(/药包/)
  })

  it('取图页某一帧没交账本、或帧数对不上，都是硬失败', () => {
    expect(() => judgeLedger([0, 25], [entry(10000), entry(10000)], [webEntry(10000), undefined])).toThrow(/第 25 帧/)
    expect(() => judgeLedger([0, 25], [entry(10000)], [webEntry(10000), webEntry(10000)])).toThrow(/帧/)
  })

  it('一帧都没有是硬失败', () => {
    expect(() => judgeLedger([], [], [])).toThrow()
  })
})
