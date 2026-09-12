import { beforeAll, describe, expect, it } from 'vitest'
import { START_SCENE } from '../../data/scenes'
import { enemySpec } from '../../battle/units'
import { getScene } from '../../data/scenesEager'
import { loadTruths, readPlotBosses, readStart, walkChain } from './chain'
import { type Outcome, describeGap, describeOutcome, monsterGap, newGame, runMainline, specExists } from './playthrough'

/**
 * **主线状态层连跑 —— 真实产品数据**（xl-03x.18）：从新游戏一路按键走向结局。
 * 机制与它**证不了什么**写在 `playthrough.ts` 的头注里：**证不了画面，也不是有人真的在浏览器里
 * 从头玩到尾**（那归 xl-x0t）。
 *
 * ## 历史：它曾经断在第 4 跳
 *
 * 2026-09-11 实跑时真实产品断在脚本3 的剧情战（「武林高手1」没有出厂数据，`enemySpec` 抛），
 * 断点登记在这里的 `KNOWN_BREAK`，断点之后那一段由一份挂测试替身的连跑补着看。xl-3hn 把全库脚本
 * 用到的怪连同各自一场的行为真值补齐之后，那条登记如设计地变红，于是登记与替身那份文件一起删了，
 * 这里改成直接断言走到结局。
 */

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
    expect(chain.hops.length).toBeGreaterThan(0)
    expect(`${START_SCENE}.txt`).toBe(start.script)
  })

  it('从起点连着走到结局，不抛、不卡', () => {
    expect(outcome.kind, describeOutcome(outcome)).toBe('ended')
  })

  it('每一跳都按链的次序落了地，交接那把尺全认', () => {
    expect(outcome.landings.map((l) => l.hop)).toEqual(chain.hops.map((h) => h.index))
    for (const l of outcome.landings) expect(l.mismatches, `第 ${l.hop} 跳`).toEqual([])
  })

  /**
   * 全库脚本用到的怪（现数，`monsterGap` 扫的是全部数据层真值，不只是链上那几本）在出厂表里都有。
   * 连跑走到结局只证明**链上**的仗都开得起来；闭包里、链外的遭遇撞到缺口，只有这一条看得见。
   */
  it('全库脚本用到的怪，出厂表里一只不缺', () => {
    const gap = monsterGap(truths, chain, productHas)
    // 分母先行：一只都没收集到时 `missing` 也是空的，下一句就恒真了。
    expect(gap.used.length, '全库脚本里一只怪都没收集到 —— monsterGap 空转了').toBeGreaterThan(0)
    expect(gap.missing, describeGap(gap)).toEqual([])
  })
})
