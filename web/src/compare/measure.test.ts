import { describe, expect, it } from 'vitest'
import { DEFAULT_TOLERANCE } from './diff'
import { DILATE, clusterBoxes, diffMask, readOutside, readRegion, unionOf } from './measure'
import type { Rect } from './regions'

/**
 * 量缺口区那几件算术的判据（xl-knp.10）。
 *
 * 为什么它值得有测试，而 `scripts/compare.ts` 那种外壳没有：这一半算出来的
 * 数会被**人手抄进 `expected.ts`**，从此由 `regions.ts` 那套看起来很硬的判据
 * 守着。它算错的样子是「一组错矩形 + 一条绿判据」—— 没有任何地方会响。
 *
 * 位图全是合成的：`tools/traces/compare/` 整个不入库，拿它当分母的话这份测试
 * 在别人的机器上会因为"目录是空的"而恒真，正是它自己要防的那种错。
 */

const W = 20
const H = 10

/** 一张全黑的 RGBA 位图。 */
function blank(): Uint8Array {
  const px = new Uint8Array(W * H * 4)
  for (let i = 3; i < px.length; i += 4) px[i] = 255
  return px
}

/** 把 `(x,y)` 涂成差得动的白色（三个通道都拉满，远超容差）。 */
function paint(px: Uint8Array, x: number, y: number): void {
  const i = (y * W + x) * 4
  px[i] = 255
  px[i + 1] = 255
  px[i + 2] = 255
}

/** 一帧掩码：`points` 里那几个像素超容差，其余相等。 */
function maskOf(points: readonly (readonly [number, number])[]): Uint8Array {
  const a = blank()
  const b = blank()
  for (const [x, y] of points) paint(b, x, y)
  return diffMask(a, b, W * H)
}

describe('diffMask', () => {
  it('alpha 不参与 —— 只有 alpha 不同的两张图差异为 0', () => {
    // Java 的位图不带 alpha、浏览器截图恒为 255。拿 alpha 比只会得到恒真的结论，
    // 而那正是 `diff.ts` 的 frameDiff 排除它的理由；两处规则岔开就不是同一批像素了。
    const a = blank()
    const b = blank()
    for (let i = 3; i < b.length; i += 4) b[i] = 0
    expect(diffMask(a, b, W * H).reduce((s, v) => s + v, 0)).toBe(0)
  })

  it('容差是闭区间的上沿：正好等于容差不算差，多一个就算', () => {
    // 判据是 `d > tolerance`。写成 `>=` 的话所有 8 级噪点会一起变成差异像素，
    // 而画面看起来完全正常 —— 逐条钉住这个边界。
    for (const [delta, expected] of [
      [DEFAULT_TOLERANCE, 0],
      [DEFAULT_TOLERANCE + 1, 1],
    ] as const) {
      const a = blank()
      const b = blank()
      b[0] = delta
      expect(diffMask(a, b, W * H).reduce((s, v) => s + v, 0), `差 ${delta}`).toBe(expected)
    }
  })
})

describe('unionOf / clusterBoxes', () => {
  it('并集是逐帧的或：只在某一帧差过的像素也算进去', () => {
    const masks = [maskOf([[2, 2]]), maskOf([[15, 8]])]
    const union = unionOf(masks, W * H)
    expect(union[2 * W + 2]).toBe(1)
    expect(union[8 * W + 15]).toBe(1)
    expect(union.reduce((s, v) => s + v, 0)).toBe(2)
  })

  it('外接框是原始像素的框，不是膨胀之后的', () => {
    // 拿膨胀后的框当读数的话，抄进 expected.ts 的矩形会白胖 DILATE 圈，
    // 而那几圈本该是硬比区。
    const union = unionOf([maskOf([[5, 5]])], W * H)
    expect(clusterBoxes(union, W, H)).toEqual([{ x0: 5, y0: 5, x1: 5, y1: 5, pixels: 1 }])
  })

  it('隔着不到 DILATE 的两点连成一块，隔得更开就是两块', () => {
    // 一个字的笔画之间是断开的 —— 不膨胀的话一个字会被切成十几块。
    const near = unionOf([maskOf([[2, 2], [2, 2 + DILATE]])], W * H)
    expect(clusterBoxes(near, W, H)).toHaveLength(1)
    const far = unionOf([maskOf([[2, 2], [2, 2 + DILATE + 1]])], W * H)
    expect(clusterBoxes(far, W, H)).toHaveLength(2)
  })

  it('按并集像素数从多到少排', () => {
    const union = unionOf([maskOf([[1, 1], [2, 1], [3, 1], [15, 8]])], W * H)
    expect(clusterBoxes(union, W, H).map((b) => b.pixels)).toEqual([3, 1])
  })

  it('一帧都没有 → 抛，不是安安静静地交出一张空并集', () => {
    // 空并集会让每个区都报"一帧都不差"、区外报"逐像素相等" —— 与真的量过一遍
    // 逐字相同。实测过：把这道守卫拿掉，空目录上整轮退出码 0 并打印
    // 「硬比区：逐像素相等（0 个超容差像素）」。
    expect(() => unionOf([], W * H)).toThrow(/一帧都没有/)
  })
})

describe('readRegion', () => {
  const rect: Rect = { x0: 4, y0: 4, x1: 8, y1: 8 }

  it('单帧最多取的是各帧里的最大值，不是合计', () => {
    // maxPixels 是**每帧**的上界：帧数随 --every 变，合计跟着变，只有单帧的量
    // 在换采样密度时仍然成立。
    const masks = [
      maskOf([[5, 5]]),
      maskOf([[5, 5], [6, 6], [7, 7]]),
      maskOf([[6, 6]]),
    ]
    const r = readRegion(masks, W, rect)
    expect(r.worst).toBe(3)
    expect(r.worstFrame).toBe(1)
    expect(r.framesHit).toBe(3)
  })

  it('区外的差异像素不算进这个区', () => {
    const r = readRegion([maskOf([[5, 5], [0, 0], [19, 9]])], W, rect)
    expect(r.worst).toBe(1)
    expect(r.box).toEqual({ x0: 5, y0: 5, x1: 5, y1: 5 })
  })

  it('实测外接框是区里那些差异像素的并集框', () => {
    const masks = [maskOf([[4, 6]]), maskOf([[8, 5]])]
    expect(readRegion(masks, W, rect).box).toEqual({ x0: 4, y0: 5, x1: 8, y1: 6 })
  })

  it('一帧都不差 → box 为 null 且 worst 为 0（那个区该删掉）', () => {
    const r = readRegion([maskOf([[0, 0]])], W, rect)
    expect(r.worst).toBe(0)
    expect(r.box).toBeNull()
  })

  it('一帧都没有 → 抛', () => {
    expect(() => readRegion([], W, rect)).toThrow(/一帧都没有/)
  })
})

describe('readOutside', () => {
  const rects: readonly Rect[] = [
    { x0: 4, y0: 4, x1: 8, y1: 8 },
    { x0: 12, y0: 0, x1: 14, y1: 2 },
  ]

  it('区里的差异一个都不算区外', () => {
    const masks = [maskOf([[5, 5], [13, 1]])]
    expect(readOutside(masks, W, H, rects)).toEqual({ pixels: 0, frames: 0, box: null })
  })

  it('区外多一个像素就点名，并给出它的位置', () => {
    // 「多出一个像素落在没人声明过的地方」正是"还有一个没认出来的成因"的样子，
    // 位置比个数有用 —— 它是回去认成因的唯一线索。
    const masks = [maskOf([[5, 5], [1, 9]]), maskOf([[18, 0]])]
    expect(readOutside(masks, W, H, rects)).toEqual({
      pixels: 2,
      frames: 2,
      box: { x0: 1, y0: 0, x1: 18, y1: 9 },
    })
  })

  it('同一帧里区外差了好几个像素，帧数只记一次', () => {
    const masks = [maskOf([[0, 0], [1, 0], [2, 0]])]
    const r = readOutside(masks, W, H, rects)
    expect(r.pixels).toBe(3)
    expect(r.frames).toBe(1)
  })

  it('一个区都不声明时，所有差异都是区外的', () => {
    expect(readOutside([maskOf([[5, 5]])], W, H, []).pixels).toBe(1)
  })

  it('一帧都没有 → 抛', () => {
    expect(() => readOutside([], W, H, rects)).toThrow(/一帧都没有/)
  })
})
