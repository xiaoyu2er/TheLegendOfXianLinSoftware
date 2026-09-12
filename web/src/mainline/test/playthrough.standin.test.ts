import { beforeAll, describe, expect, it, vi } from 'vitest'
import { getScene } from '../../data/scenesEager'
import { loadTruths, readPlotBosses, readStart, walkChain } from './chain'
import { HOP_BUDGET, type Outcome, describeGap, describeOutcome, monsterGap, newGame, runMainline } from './playthrough'

/**
 * **主线连跑 —— 带测试替身**（xl-03x.18）：真实产品在第一场缺出厂数据的仗上就断了
 * （`playthrough.test.ts` 的登记，xl-3hn）。这一份问的是另一件事：**那一处之外，主线还有没有别的
 * 地方走不通**。
 *
 * ## ⚠️ 这里的绿不等于「产品跑通了」
 *
 * 缺出厂数据的那几只怪，在这份文件里被**测试替身**换成了 {@link STAND_IN}：它们的出厂数据是假的、
 * 那几场仗是假的。所以这里证的只是「挡路的只有那一件」—— 不是「玩家走得到结局」。
 *
 * 替身的存在要能从判据上看出来，不能和「产品真的跑通了」长得一样：
 *
 * - **替身清单是显式的**（`standIn.names`），而且是**现数**的：全库脚本用到、而**真实产品**的
 *   `enemySpec` 抛的那几只（`monsterGap`）。不手写名单；
 * - 有一条断言说**产品侧没有这份替身**：清单上每一只，真实产品的 `enemySpec` 都抛；
 * - 有一条断言说**替身真的被用上了**，而且只用在清单上的怪身上。
 *
 * 替身只在这份文件里（`vi.mock` 是文件级的），产品代码一行没动。**xl-3hn 补完之后清单变空**，
 * 这里会红 —— 那时删掉这份文件。
 */

/** 缺数据的怪一律换成它。它自己必须有出厂数据（有断言）。 */
const STAND_IN = '怪物1'

const standIn = vi.hoisted(() => ({
  names: new Set<string>(),
  used: new Map<string, number>(),
}))

vi.mock('../../battle/units', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../battle/units')>()
  return {
    ...real,
    enemySpec: (name: string) => {
      if (!standIn.names.has(name)) return real.enemySpec(name)
      standIn.used.set(name, (standIn.used.get(name) ?? 0) + 1)
      return real.enemySpec(STAND_IN)
    },
  }
})

const truths = loadTruths()
const chain = walkChain(truths, 'win32', readStart().script, readPlotBosses())

/** 真实产品的那一份 `enemySpec`（绕开上面的替身）。 */
const real = await vi.importActual<typeof import('../../battle/units')>('../../battle/units')
const productHas = (name: string): boolean => {
  try {
    real.enemySpec(name)
    return true
  } catch {
    return false
  }
}

const gap = monsterGap(truths, chain, productHas)
let outcome: Outcome

beforeAll(() => {
  for (const n of gap.missing) standIn.names.add(n)
  outcome = runMainline(chain, truths, newGame(getScene), { hopBudget: HOP_BUDGET })
  console.log(describeOutcome(outcome))
  console.log(describeGap(gap))
  console.log(`替身用了：${JSON.stringify([...standIn.used])}`)
}, 120_000)

describe('替身的存在看得见', () => {
  it('替身清单不空 —— 空了就是 xl-3hn 补完了，删掉这份文件', () => {
    expect(gap.missing.length).toBeGreaterThan(0)
  })

  it('产品侧没有这份替身：清单上每一只，真实产品的 enemySpec 都抛；替身自己有出厂数据', () => {
    for (const n of gap.missing) expect(productHas(n), n).toBe(false)
    expect(productHas(STAND_IN)).toBe(true)
  })

  it('替身真的被用上了，而且只用在清单上的怪身上', () => {
    expect(standIn.used.size).toBeGreaterThan(0)
    for (const n of standIn.used.keys()) expect(gap.missing).toContain(n)
  })
})

describe('主线连跑（缺数据的怪换成替身）', () => {
  it('从起点连着走到结局，不抛、不卡', () => {
    expect(outcome.kind, describeOutcome(outcome)).toBe('ended')
  })

  it('每一跳都按链的次序落了地，交接那把尺全认', () => {
    expect(outcome.landings.map((l) => l.hop)).toEqual(chain.hops.map((h) => h.index))
    for (const l of outcome.landings) expect(l.mismatches, `第 ${l.hop} 跳`).toEqual([])
  })
})
