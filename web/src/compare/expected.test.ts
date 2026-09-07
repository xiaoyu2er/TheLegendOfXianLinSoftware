import { describe, expect, it } from 'vitest'
import { CANVAS_HEIGHT, CANVAS_WIDTH, EXPECTED, expectationOf, scriptNames } from './expected'
import { rectsOverlap } from './regions'

/**
 * 期望表本身的体检。跑得起来不需要 Java、不需要 Chrome，所以它在 CI 里，
 * 而整条比对流水线不在。
 */
describe('跨端比对的期望表', () => {
  it('磁盘上的每条剧本都表过态，表里也没有多余的条目', () => {
    // 分母从 tools/traces/scripts/ 现数，不写死数量：别人加一条剧本，
    // 这里会因为"它没表态"而红，而不是因为一个过期的数字。
    const onDisk = scriptNames()
    expect(onDisk.length).toBeGreaterThan(0)
    expect(Object.keys(EXPECTED).sort()).toEqual(onDisk)
  })

  it('每条 gap 都写清楚差在哪、归哪张票 —— 否则它就只是一句"先这样"', () => {
    for (const [name, e] of Object.entries(EXPECTED)) {
      if (e.status !== 'gap') continue
      expect(e.why, `${name} 的 gap 没写原因`).toBeTruthy()
      expect(e.issue, `${name} 的 gap 没挂 issue`).toMatch(/^xl-/)
    }
  })

  it('每条 gap 都带幅度上界 —— 整屏表态写 maxRatio，分区表态每个区写 maxPixels', () => {
    // xl-l3o：上界之前，gap 的通过条件只有一句"有偏离帧"，整屏全黑也算数。
    // 分母从表里现数，不写死条数。
    for (const [name, e] of Object.entries(EXPECTED)) {
      if (e.status !== 'gap') continue
      if (e.gaps) {
        // 分区表态的上界逐区挂着；整屏那个数对它没有意义，别两头都写。
        expect(e.maxRatio, `${name} 是分区表态，不该再写整屏的 maxRatio`).toBeUndefined()
        for (const g of e.gaps) {
          expect(g.maxPixels, `${name}/${g.name} 没写上界`).toBeGreaterThan(0)
        }
      } else {
        expect(e.maxRatio, `${name} 的 gap 没写幅度上界`).toBeGreaterThan(0)
        // 上界 ≥ 1 等于没有上界：占比最多就是 1（整屏全差）。
        expect(e.maxRatio, `${name} 的上界 ≥ 100%，等于没有上界`).toBeLessThan(1)
      }
    }
  })

  it('缺口区的上界必须够得着 —— 上界比这块区的面积还大就永远超不了', () => {
    // "破不了的检查"和"没有检查"是同一件事，而两者都安安静静地通过。
    // 分母从矩形自己算，不写死。
    for (const [name, e] of Object.entries(EXPECTED)) {
      if (!e.gaps) continue
      for (const g of e.gaps) {
        const area = (g.rect.x1 - g.rect.x0 + 1) * (g.rect.y1 - g.rect.y0 + 1)
        expect(g.maxPixels, `${name}/${g.name} 的上界够不着：区里一共才 ${area} 个像素`).toBeLessThan(
          area,
        )
      }
    }
  })

  it('没表过态的剧本是硬失败，不是默认放行', () => {
    expect(() => expectationOf('还没有的剧本')).toThrow(/没有在/)
  })

  it('至少有一条剧本用了分区表态 —— 这套判据必须真的挂在真剧本上', () => {
    // 分母从表里现数：分区表态是新东西（xl-1vu.3），一条都没有的时候
    // `regions.ts` 的全部测试都还是合成位图，等于这套判据从没跑过真截图。
    const partitioned = Object.entries(EXPECTED).filter(([, e]) => e.gaps)
    expect(partitioned.length, '一条分区表态都没有').toBeGreaterThan(0)
  })

  it('每个缺口区都落在画布里、写清楚了理由与票号，且互不重叠', () => {
    for (const [name, e] of Object.entries(EXPECTED)) {
      if (!e.gaps) continue
      // 空的 gaps 数组等于"整屏硬比"，那就该老实写 match，不该伪装成有缺口。
      expect(e.gaps.length, `${name} 的 gaps 是空的`).toBeGreaterThan(0)
      expect(e.status, `${name} 有分区表态却不是 gap`).toBe('gap')
      const seen = new Set<string>()
      for (const g of e.gaps) {
        expect(seen.has(g.name), `${name} 的缺口区 ${g.name} 重名`).toBe(false)
        seen.add(g.name)
        expect(g.why, `${name}/${g.name} 没写原因`).toBeTruthy()
        expect(g.issue, `${name}/${g.name} 没挂 issue`).toMatch(/^xl-/)
        const r = g.rect
        expect(r.x0, `${name}/${g.name} 的 x0>x1`).toBeLessThanOrEqual(r.x1)
        expect(r.y0, `${name}/${g.name} 的 y0>y1`).toBeLessThanOrEqual(r.y1)
        expect(r.x0, `${name}/${g.name} 越出画布左边`).toBeGreaterThanOrEqual(0)
        expect(r.y0, `${name}/${g.name} 越出画布上边`).toBeGreaterThanOrEqual(0)
        expect(r.x1, `${name}/${g.name} 越出画布右边`).toBeLessThan(CANVAS_WIDTH)
        expect(r.y1, `${name}/${g.name} 越出画布下边`).toBeLessThan(CANVAS_HEIGHT)
      }
      // 重叠会让"这个区一帧都不差了"不再可判：同一个像素被算进两个区，
      // 补上一个的时候另一个跟着归零，双向红就废了。
      for (let i = 0; i < e.gaps.length; i++) {
        for (let j = i + 1; j < e.gaps.length; j++) {
          const a = e.gaps[i]!
          const b = e.gaps[j]!
          expect(rectsOverlap(a.rect, b.rect), `${name} 的 ${a.name} 与 ${b.name} 重叠`).toBe(false)
        }
      }
    }
  })

  it('缺口区不许铺满整屏 —— 硬比区必须还剩下大半张画布', () => {
    // "把缺口区画大一点让它过"是这套判据唯一的作弊路子，所以给它一个上限。
    // 上限从画布面积推，不写死像素数。
    for (const [name, e] of Object.entries(EXPECTED)) {
      if (!e.gaps) continue
      // 区互不重叠（上一条已验），所以面积可以直接相加。
      const area = e.gaps.reduce(
        (n, g) => n + (g.rect.x1 - g.rect.x0 + 1) * (g.rect.y1 - g.rect.y0 + 1),
        0,
      )
      expect(
        area / (CANVAS_WIDTH * CANVAS_HEIGHT),
        `${name} 的缺口区盖掉了太多画布`,
      ).toBeLessThan(0.4)
    }
  })
})
