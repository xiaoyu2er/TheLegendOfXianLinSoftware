import { beforeAll, describe, expect, it } from 'vitest'
import { START_SCENE } from '../../data/scenes'
import { enemySpec } from '../../battle/units'
import { getScene } from '../../data/scenesEager'
import { loadTruths, readPlotBosses, readStart, walkChain } from './chain'
import { type Outcome, describeGap, describeOutcome, monsterGap, newGame, runMainline, specExists } from './playthrough'

/**
 * **主线状态层连跑 —— 真实产品数据**（xl-03x.18）：从新游戏一路按键走向结局，看它在哪断。
 * 机制与它**证不了什么**写在 `playthrough.ts` 的头注里：**证不了画面，也不是有人真的在浏览器里
 * 从头玩到尾**（那归 xl-x0t）。
 *
 * ## ⚠️ 今天它走不到结局 —— 断点是登记的，不是推导的
 *
 * 2026-09-11 实跑：真实产品断在一场仗上，因为那一场的怪 Web 端没有出厂数据（`enemySpec` 抛）。
 * 这不是这张票能修的（每只怪要连同它那一场的行为真值一起补，xl-3hn），所以把断点**指名道姓**
 * 地登记在下面 `KNOWN_BREAK` 里，由人签。
 *
 * **xl-3hn 补完怪之后这里会红** —— 那正是要的：逼人回来删掉登记、删掉
 * `playthrough.standin.test.ts`，把这里改成直接断言走到结局。
 *
 * 断点之后那一段走不走得通，由 `playthrough.standin.test.ts` 用**显式的测试替身**跑；那一份的
 * 绿**不等于**产品跑通了，理由写在那份文件里。
 */

/**
 * 登记（**人签，不许改成推导**）：真实产品数据下，连跑断在第几跳、因为哪只怪没有出厂数据、归哪张票。
 * 跳号是 `Hop.index`（从 1 数），与 `chain.ts` 同一套编号。
 */
const KNOWN_BREAK = { hop: 4, monster: '武林高手1', issue: 'xl-3hn' } as const

const truths = loadTruths()
const start = readStart()
const chain = walkChain(truths, 'win32', start.script, readPlotBosses())

const productHas = specExists(enemySpec)

let outcome: Outcome

beforeAll(() => {
  outcome = runMainline(chain, truths, newGame(getScene))
  console.log(`链 ${chain.scripts.length} 本 / ${chain.hops.length} 跳（win32）`)
  console.log(describeOutcome(outcome))
  console.log(describeGap(monsterGap(truths, chain, productHas)))
}, 120_000)

describe('主线连跑（真实产品数据）', () => {
  it('前提：链是通的，起点就是 Web 开局进的那一本', () => {
    expect(chain.broken).toBeUndefined()
    expect(chain.hops.length).toBeGreaterThan(KNOWN_BREAK.hop)
    expect(`${START_SCENE}.txt`).toBe(start.script)
  })

  it(`断在登记的第 ${KNOWN_BREAK.hop} 跳，因为「${KNOWN_BREAK.monster}」没有出厂数据（${KNOWN_BREAK.issue}）`, () => {
    const stale =
      `登记的断点对不上了：${describeOutcome(outcome)}。如果是 ${KNOWN_BREAK.issue} 补完了怪，` +
      '删掉 KNOWN_BREAK 与 playthrough.standin.test.ts，把这里改成断言走到结局；否则就是连跑断在了别处，去查。'
    expect(outcome.kind, stale).toBe('broken')
    if (outcome.kind !== 'broken') return
    expect(outcome.hop, stale).toBe(KNOWN_BREAK.hop)
    expect(outcome.how, stale).toBe('threw')
    expect(outcome.reason, stale).toContain(`怪物「${KNOWN_BREAK.monster}」还没有出厂数据`)
  })

  it('断点之前的每一跳都按链的次序落了地，交接那把尺全认', () => {
    expect(outcome.landings.map((l) => l.hop)).toEqual(
      chain.hops.filter((h) => h.index < KNOWN_BREAK.hop).map((h) => h.index),
    )
    for (const l of outcome.landings) expect(l.mismatches, `第 ${l.hop} 跳`).toEqual([])
  })

  it('登记的那只怪确实在出厂数据的缺口里（现数），而且链上真的有仗撞到它', () => {
    const gap = monsterGap(truths, chain, productHas)
    expect(gap.missing).toContain(KNOWN_BREAK.monster)
    expect(gap.fights.some((f) => f.monsters.includes(KNOWN_BREAK.monster))).toBe(true)
  })
})
