import { describe, expect, it } from 'vitest'
import { exactRectsOf, judgeExact, rectDiffering } from './exactRegions'
import type { ExactFrame, ExactRegionSpec, ExactTraceTick } from './exactRegions'
import type { Bitmap } from './png'
import type { Rect } from './regions'

/**
 * 逐像素相等区的体检（xl-aq0）。不需要 Java、不需要 Chrome，所以它在 CI 里，
 * 而整条比对流水线不在。
 *
 * 位图是合成的，理由同 `regions.test.ts`：每一条断言的分母都数得出来。
 * 这套判据挂在真剧本上的样子由 `expected.test.ts` 那条「登记与入库真值对撞」
 * 守着，那一条读的是 `tools/traces/out/` 里真的真值。
 */

const W = 8
const H = 6

function solid(value: number): Bitmap {
  const rgba = new Uint8Array(W * H * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = value
    rgba[i + 1] = value
    rgba[i + 2] = value
    rgba[i + 3] = 255
  }
  return { width: W, height: H, rgba }
}

function poke(b: Bitmap, x: number, y: number, value: number): Bitmap {
  const rgba = new Uint8Array(b.rgba)
  const i = (y * b.width + x) * 4
  rgba[i] = value
  rgba[i + 1] = value
  rgba[i + 2] = value
  return { width: b.width, height: b.height, rgba }
}

const RECT: Rect = { x0: 2, y0: 1, x1: 4, y1: 2 } // 3×2

function tick(t: number, r: Partial<NonNullable<ExactTraceTick['reminder']>> = {}): ExactTraceTick {
  return {
    t,
    reminder: {
      image: 20,
      stopped: false,
      dx1: 460,
      dy1: 112,
      dx2: 540,
      dy2: 128,
      ...r,
    },
  }
}

const SPEC: ExactRegionSpec = {
  name: 'reminder',
  source: 'reminder',
  drawnTicks: 2,
  why: '提示图的缩放采样',
  issue: 'xl-ttu / xl-aq0',
}

describe('从真值现读矩形', () => {
  it('画着的那几拍各出一个闭区间矩形 —— dx2/dy2 是开区间，要减一', () => {
    const rects = exactRectsOf('reminder', [tick(0), tick(25)])
    expect(rects.size).toBe(2)
    // 目标是 (460,112) 起 80×16，闭区间就是 460..539 × 112..127。
    expect(rects.get(0)).toEqual({ x0: 460, y0: 112, x1: 539, y1: 127 })
  })

  it('停住的、没有图的、以及零宽的拍都不算 —— 空矩形会变成一块永远相等的假硬比区', () => {
    const rects = exactRectsOf('reminder', [
      tick(0, { stopped: true }),
      tick(25, { image: null }),
      // `show()` 之后、第一次 `update()` 之前：目标 0 宽，原版什么都不画。
      tick(50, { dx1: 500, dx2: 500 }),
      tick(75, { dy1: 120, dy2: 120 }),
      tick(100),
    ])
    expect([...rects.keys()]).toEqual([100])
  })

  it('真值里整层字段都没有是硬失败，不是"这条剧本不出提示图"', () => {
    expect(() => exactRectsOf('reminder', [{ t: 0 }, { t: 25 }])).toThrow(/一拍都没有 reminder/)
  })

  it('不认识的来源当场抛，不猜', () => {
    expect(() => exactRectsOf('victory' as 'reminder', [tick(0)])).toThrow(/不认识的矩形来源/)
  })
})

describe('矩形里的像素账', () => {
  it('只数矩形里的，区外改坏了不算', () => {
    const a = solid(0)
    expect(rectDiffering(a, poke(solid(0), 0, 0, 200), RECT, 8)).toBe(0)
    expect(rectDiffering(a, poke(solid(0), 3, 1, 200), RECT, 8)).toBe(1)
  })

  it('容差之内的不算 —— 与整屏判据同一条口径', () => {
    const a = solid(0)
    expect(rectDiffering(a, poke(solid(0), 3, 1, 8), RECT, 8)).toBe(0)
    expect(rectDiffering(a, poke(solid(0), 3, 1, 9), RECT, 8)).toBe(1)
  })

  it('矩形越出画面是硬失败 —— 那是接错了，不是差异大', () => {
    const a = solid(0)
    expect(() => rectDiffering(a, solid(0), { x0: 0, y0: 0, x1: W, y1: 0 }, 8)).toThrow(/越出了/)
    expect(() => rectDiffering(a, solid(0), { x0: -1, y0: 0, x1: 1, y1: 0 }, 8)).toThrow(/越出了/)
  })

  it('两端尺寸不同是硬失败', () => {
    expect(() =>
      rectDiffering(solid(0), { width: 4, height: 4, rgba: new Uint8Array(64) }, RECT, 8),
    ).toThrow(/尺寸不同/)
  })
})

describe('逐像素相等区的判定', () => {
  const frame = (t: number, differing: number): ExactFrame => ({ tick: t, rect: RECT, differing })

  it('一个都不差才算过，并报出比了几帧几个像素', () => {
    const v = judgeExact(SPEC, 2, [frame(0, 0), frame(25, 0)])
    expect(v.ok).toBe(true)
    expect(v.frames).toBe(2)
    expect(v.pixels).toBe(3 * 2 * 2)
    expect(v.differing).toBe(0)
    expect(v.firstBreak).toBeNull()
  })

  it('差一个就红 —— 这一块没有上界，给它上界等于给回归留位置', () => {
    const v = judgeExact(SPEC, 2, [frame(0, 0), frame(25, 1)])
    expect(v.ok).toBe(false)
    expect(v.firstBreak).toBe(25)
    expect(v.differing).toBe(1)
    expect(v.verdict).toMatch(/第 25 帧起/)
    // 报告要点得出最坏的那一帧与它的矩形，否则查起来只知道"某处红了"。
    expect(v.verdict).toMatch(/1\/6 @ \(2,1\)-\(4,2\)/)
  })

  it('登记与真值对不上是硬失败 —— 分母不许悄悄跟着真值走', () => {
    expect(() => judgeExact(SPEC, 3, [frame(0, 0)])).toThrow(/登记过期/)
  })

  it('一帧都没命中不算通过，且要说清楚是取帧太稀', () => {
    expect(() => judgeExact(SPEC, 2, [])).toThrow(/一帧都没命中/)
    expect(() => judgeExact(SPEC, 2, [])).toThrow(/--every/)
  })
})
