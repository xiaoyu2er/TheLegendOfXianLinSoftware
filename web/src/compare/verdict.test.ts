import { describe, expect, it } from 'vitest'
import { summarize } from './diff'
import type { FrameResult } from './diff'
import type { Expectation } from './expected'
import { judgeWhole } from './verdict'

/**
 * 整屏表态的判定（xl-l3o）。跑得起来不需要 Java、不需要 Chrome，所以它在 CI 里，
 * 而整条比对流水线不在。
 *
 * 每一条断言的分母都数得出来：帧是合成的，占比是自己填的。真剧本上的篡改演示
 * （基准侧换成全黑图）写在 commit message 里。
 */

const THRESHOLD = 0.0002

function frame(tick: number, ratio: number): FrameResult {
  return {
    tick,
    differing: Math.round(ratio * 1024 * 640),
    ratio,
    maxDelta: ratio > 0 ? 200 : 0,
    box: ratio > 0 ? { x0: 1, y0: 2, x1: 3, y1: 4 } : null,
  }
}

function seq(...ratios: readonly number[]) {
  return summarize(
    ratios.map((r, i) => frame(i * 25, r)),
    THRESHOLD,
  )
}

const GAP: Expectation = { status: 'gap', why: '字形还没对上', issue: 'xl-aaa', maxRatio: 0.01 }

describe('整屏表态的判定', () => {
  it('match 全过就是过，出现偏离帧就是回归', () => {
    const m: Expectation = { status: 'match' }
    expect(judgeWhole(seq(0, 0, 0), m).ok).toBe(true)
    const bad = judgeWhole(seq(0, 0.5, 0), m)
    expect(bad.ok).toBe(false)
    expect(bad.verdict).toContain('第 25 帧')
  })

  it('gap 在上界之内 —— 通过，并把最差帧与上界都报出来', () => {
    const v = judgeWhole(seq(0.001, 0.008, 0.002), GAP)
    expect(v.ok).toBe(true)
    expect(v.verdict).toContain('0.8000%')
    expect(v.verdict).toContain('1.0000%')
  })

  it('gap 一帧都不差了 —— 红（账还完了而表没改）', () => {
    const v = judgeWhole(seq(0, 0, 0), GAP)
    expect(v.ok).toBe(false)
    expect(v.verdict).toContain('改成 match')
  })

  it('gap 差得比上界多 —— 也红，并点名是哪一帧、超了多少', () => {
    // 这一条就是这张票（xl-l3o）：改这个数之前，下面这个 99.96% 是**通过**的
    // —— 通过条件只有一句"有偏离帧"，而整屏全黑同样能提供偏离。
    const v = judgeWhole(seq(0.001, 0.9996, 0.002), GAP)
    expect(v.ok).toBe(false)
    expect(v.verdict).toContain('第 25 帧')
    expect(v.verdict).toContain('99.9600%')
    expect(v.verdict).toContain('上界 1.0000%')
    expect(v.verdict).toContain('99.96 倍')
  })

  it('上界正好压在线上算过，多一点点就红 —— 判据是 ≤，不是"差不多"', () => {
    expect(judgeWhole(seq(0.001, 0.01), GAP).ok).toBe(true)
    expect(judgeWhole(seq(0.001, 0.0100001), GAP).ok).toBe(false)
  })

  it('gap 没写上界是硬失败，不是默认放行', () => {
    const noBound: Expectation = { status: 'gap', why: '差着', issue: 'xl-aaa' }
    expect(() => judgeWhole(seq(0.5), noBound)).toThrow(/上界/)
  })
})
