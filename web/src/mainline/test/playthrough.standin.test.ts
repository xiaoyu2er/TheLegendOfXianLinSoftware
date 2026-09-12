import { beforeAll, describe, expect, it, vi } from 'vitest'
import { getScene } from '../../data/scenesEager'
import { loadTruths, readPlotBosses, readStart, walkChain } from './chain'
import { enemySpec } from '../../battle/units'
import { type Outcome, describeGap, describeOutcome, monsterGap, newGame, runMainline, specExists } from './playthrough'

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
 * - 有一条断言说**这份文件里的产品不是真实产品**：清单上每一只，会话看到的 `enemySpec`（被替身
 *   换过的那一份）给出的是替身的数据 —— 替身没挂上的话，这里当场抛；
 * - 有一条断言说**替身真的顶过主线上的每一场**：链上剧情战里撞到缺口的每一只，替身都真的被调过。
 *
 * ⚠️ 「清单上每一只，真实产品都抛」**不是**判据：清单本来就是拿真实产品的 `enemySpec` 筛出来的，
 * 那一句按构造成立（/code-review 逮到的）。清单是现数的、以显式入参交给替身（`standIn.names`）。
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
const productHas = specExists(real.enemySpec)

const gap = monsterGap(truths, chain, productHas)
let outcome: Outcome

beforeAll(() => {
  for (const n of gap.missing) standIn.names.add(n)
  outcome = runMainline(chain, truths, newGame(getScene))
  console.log(describeOutcome(outcome))
  console.log(describeGap(gap))
  console.log(`替身用了：${JSON.stringify([...standIn.used])}`)
}, 120_000)

describe('替身的存在看得见', () => {
  it('替身清单不空 —— 空了就是 xl-3hn 补完了，删掉这份文件', () => {
    expect(gap.missing.length).toBeGreaterThan(0)
  })

  it('这份文件里的产品不是真实产品：清单上每一只，会话看到的 enemySpec 给的是替身的数据', () => {
    expect(productHas(STAND_IN)).toBe(true)
    for (const n of gap.missing) expect(enemySpec(n), n).toEqual(real.enemySpec(STAND_IN))
  })

  it('替身真的顶过主线上的每一场：链上剧情战里撞到缺口的每一只，都真的被调过', () => {
    const plot = gap.fights.filter((f) => f.kind === 'battle1')
    expect(plot.length).toBeGreaterThan(0)
    for (const f of plot) {
      for (const n of f.monsters) if (gap.missing.includes(n)) expect(standIn.used.has(n), `${f.script} 的 ${n}`).toBe(true)
    }
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
