import { describe, expect, it } from 'vitest'
import { judgeRegions, partitionedDiff, rectsOverlap } from './regions'
import type { GapRegion, PartitionedFrame, Rect } from './regions'
import type { Bitmap } from './png'

/**
 * 分区判据的体检（xl-1vu.3）。跑得起来不需要 Java、不需要 Chrome，所以它在
 * CI 里，而整条比对流水线不在。
 *
 * 这里的位图是合成的：**每一条断言的分母都数得出来**（画布多大、区里多少个
 * 像素、改坏了几个），不用去猜一张真截图里有多少个像素该差。真剧本上的演示
 * 在 `tools/compare-frames.sh dorm-walk`，两次篡改的实测写在 commit message 里。
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

/** 把 (x,y) 那个像素改成 `value`。**篡改的入口只有这一个**。 */
function poke(b: Bitmap, x: number, y: number, value: number): Bitmap {
  const rgba = new Uint8Array(b.rgba)
  const i = (y * b.width + x) * 4
  rgba[i] = value
  rgba[i + 1] = value
  rgba[i + 2] = value
  return { width: b.width, height: b.height, rgba }
}

const GAP: Rect = { x0: 6, y0: 4, x1: 7, y1: 5 } // 右下角 2×2

describe('分区差异', () => {
  it('缺口区里的像素只记进缺口区，硬比区一个不沾', () => {
    const a = solid(0)
    const b = poke(solid(0), 7, 5, 200)
    const d = partitionedDiff(a, b, [GAP], 8)
    expect(d.gaps).toEqual([1])
    expect(d.strict.differing).toBe(0)
    expect(d.strict.box).toBeNull()
    // 分母是硬比区自己的面积：整屏 48 减去缺口区那 4 个。
    expect(d.strictArea).toBe(W * H - 4)
  })

  it('硬比区里的像素记进硬比区，并报出位置', () => {
    const a = solid(0)
    const b = poke(solid(0), 2, 1, 200)
    const d = partitionedDiff(a, b, [GAP], 8)
    expect(d.gaps).toEqual([0])
    expect(d.strict.differing).toBe(1)
    expect(d.strict.box).toEqual({ x0: 2, y0: 1, x1: 2, y1: 1 })
    expect(d.strict.maxDelta).toBe(200)
  })

  it('容差之内的差异两边都不算', () => {
    const d = partitionedDiff(solid(0), solid(8), [GAP], 8)
    expect(d.gaps).toEqual([0])
    expect(d.strict.differing).toBe(0)
    // 但最大通道差照样报出来 —— "刚好压在容差线下"和"完全一样"不该长得一样。
    expect(d.strict.maxDelta).toBe(8)
  })

  it('一个像素只记进第一个命中的区（缺口区不许重叠，所以第一个就是唯一一个）', () => {
    const one: Rect = { x0: 6, y0: 4, x1: 7, y1: 5 }
    const two: Rect = { x0: 7, y0: 5, x1: 7, y1: 5 }
    expect(rectsOverlap(one, two)).toBe(true)
    const d = partitionedDiff(solid(0), poke(solid(0), 7, 5, 200), [one, two], 8)
    expect(d.gaps).toEqual([1, 0])
  })

  it('尺寸不同是硬失败，不是"差异很大"', () => {
    const small: Bitmap = { width: 2, height: 2, rgba: new Uint8Array(16) }
    expect(() => partitionedDiff(solid(0), small, [GAP], 8)).toThrow(/尺寸不同/)
  })

  it('一个缺口区都不声明时整屏都是硬比区', () => {
    const d = partitionedDiff(solid(0), poke(solid(0), 7, 5, 200), [], 8)
    expect(d.strictArea).toBe(W * H)
    expect(d.strict.differing).toBe(1)
  })
})

// ================= 判定 =================

const REGIONS: readonly GapRegion[] = [
  // 两个区各 12 个像素，上界给 10 —— 分母数得出来：11 个就算超。
  { name: 'left', rect: { x0: 0, y0: 0, x1: 1, y1: 5 }, why: '左边那块还没画', issue: 'xl-aaa', maxPixels: 10 },
  { name: 'right', rect: { x0: 6, y0: 0, x1: 7, y1: 5 }, why: '右边那块还没画', issue: 'xl-bbb', maxPixels: 10 },
]

function frame(tick: number, strictDiffering: number, gaps: number[]): PartitionedFrame {
  return {
    tick,
    strict: {
      differing: strictDiffering,
      ratio: strictDiffering / 24,
      maxDelta: strictDiffering > 0 ? 200 : 0,
      box: strictDiffering > 0 ? { x0: 3, y0: 1, x1: 4, y1: 2 } : null,
    },
    strictArea: 24,
    gaps,
  }
}

describe('分区判定', () => {
  it('硬比区干净、每个缺口区都还差着 —— 通过', () => {
    const v = judgeRegions([frame(0, 0, [3, 5]), frame(25, 0, [3, 0])], REGIONS)
    expect(v.ok).toBe(true)
    expect(v.gapTotals).toEqual([6, 5])
    expect(v.closedGaps).toEqual([])
  })

  it('硬比区多一个像素就红，并指出第一个出问题的帧号', () => {
    const v = judgeRegions([frame(0, 0, [3, 5]), frame(25, 1, [3, 5]), frame(50, 9, [3, 5])], REGIONS)
    expect(v.ok).toBe(false)
    expect(v.firstStrictBreak).toBe(25)
    expect(v.strictDiffering).toBe(10)
    // 最坏的那一帧要报出来，否则"哪儿画错了"还得再跑一遍才知道。
    expect(v.verdict).toContain('第 25 帧起')
    expect(v.verdict).toContain('第 50 帧 9 个')
  })

  it('缺口区一帧都不差了 —— 也红（账还完了而表没改）', () => {
    const v = judgeRegions([frame(0, 0, [3, 0]), frame(25, 0, [4, 0])], REGIONS)
    expect(v.ok).toBe(false)
    expect(v.closedGaps).toEqual(['right'])
    expect(v.verdict).toContain('right')
  })

  it('每个区各自双向红 —— 别的区还差着，盖不住补上的那个', () => {
    // 这一条是分区相对整屏判据买到的东西：整屏版只要"还有偏离"就算通过，
    // 三个缺口里补上一个根本看不出来。
    const v = judgeRegions([frame(0, 0, [999, 0])], REGIONS)
    expect(v.ok).toBe(false)
    expect(v.closedGaps).toEqual(['right'])
  })

  it('硬比区破了优先报硬比区 —— 那是回归，比"表过期了"严重', () => {
    const v = judgeRegions([frame(0, 2, [0, 0])], REGIONS)
    expect(v.ok).toBe(false)
    expect(v.verdict).toContain('硬比区破了')
    expect(v.closedGaps).toEqual(['left', 'right'])
  })

  it('缺口区差得比上界多 —— 红，并点名是哪个区、哪一帧、超了多少', () => {
    // 这一条是这张票（xl-l3o）：上界之前缺口区只有下界，"字形还差着"与
    // "这一块什么都没画出来"给出同一个结论。
    const v = judgeRegions([frame(0, 0, [3, 5]), frame(25, 0, [3, 12])], REGIONS)
    expect(v.ok).toBe(false)
    expect(v.blownGaps).toEqual(['right'])
    expect(v.verdict).toContain('right 第 25 帧 12 个 > 上界 10')
    expect(v.gapWorst[1]).toEqual({ tick: 25, pixels: 12 })
  })

  it('压在上界上算过，多一个就红', () => {
    expect(judgeRegions([frame(0, 0, [10, 10])], REGIONS).ok).toBe(true)
    expect(judgeRegions([frame(0, 0, [10, 11])], REGIONS).ok).toBe(false)
  })

  it('硬比区破了与缺口区超界同时报出来 —— 全黑那种灾难两条会一起破', () => {
    const v = judgeRegions([frame(0, 7, [12, 12])], REGIONS)
    expect(v.ok).toBe(false)
    expect(v.verdict).toContain('硬比区破了')
    expect(v.verdict).toContain('超了上界')
    expect(v.blownGaps).toEqual(['left', 'right'])
  })

  it('缺口区没写上界是硬失败，不是默认放行', () => {
    const noBound = [{ ...REGIONS[0]!, maxPixels: 0 }]
    expect(() => judgeRegions([frame(0, 0, [3])], noBound)).toThrow(/上界/)
  })

  it('一帧都没比是硬失败，不是通过', () => {
    expect(() => judgeRegions([], REGIONS)).toThrow(/一帧都没有比/)
  })

  it('一个缺口区都没有的分区表态是硬失败 —— 那是 match 的伪装', () => {
    expect(() => judgeRegions([frame(0, 0, [])], [])).toThrow(/一个缺口区都没有/)
  })

  it('帧里记的区数与表里声明的对不上是硬失败', () => {
    expect(() => judgeRegions([frame(0, 0, [1])], REGIONS)).toThrow(/声明了 2 个/)
  })
})
