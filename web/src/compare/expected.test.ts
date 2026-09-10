import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CANVAS_HEIGHT, CANVAS_WIDTH, EXPECTED, expectationOf, scriptNames } from './expected'
import type { Expectation } from './expected'
import { exactRectsOf } from './exactRegions'
import type { ExactRectSource, ExactTraceTick } from './exactRegions'
import { rectsOverlap } from './regions'
import { repoPath } from '../test/repoPath'

/**
 * `unassembled` / `unpainted` 共用的那四条规矩：一帧都没比过的剧本不许带任何
 * 量出来的数，而且必须说清楚为什么、挂着哪张票。
 *
 * **抽出来是因为两份登记现在都空着**（xl-rh9.15 清空了 `unpainted`，xl-knp.10
 * 清空了 `unassembled`）。照旧只在 `for` 里断言的话，两个 it 块各自**一轮都不
 * 跑** —— 而「一条都没验到」与「全验过了」长得一模一样，正是本仓库最不许有的
 * 那种通过条件。抽出来之后同一个函数跑两处：真登记上（今天零轮），以及下面
 * 那组**合成**的正反例上（分母写死的 1 + 4，与登记空不空无关）。
 */
function assertNothingMeasured(name: string, e: Expectation, issue: RegExp): void {
  expect(e.maxRatio, `${name} 比不了却写了 maxRatio`).toBeUndefined()
  expect(e.gaps, `${name} 比不了却写了分区表态`).toBeUndefined()
  expect(e.why, `${name} 要说清楚为什么比不了`).toBeTruthy()
  expect(e.issue ?? '', `${name} 要挂上接它的那张票`).toMatch(issue)
}

/** 那四条规矩各自真的会咬人 —— 逐条改坏一处，确认它抛。 */
function assertRulesBite(status: 'unassembled' | 'unpainted', issue: RegExp): void {
  const good = { status, why: '合成出来的处境', issue: 'xl-knp.10' } as const
  expect(() => assertNothingMeasured('合成', good, issue)).not.toThrow()
  const bad: readonly Partial<Expectation>[] = [
    { maxRatio: 0.1 },
    { gaps: [] },
    { why: '' },
    { issue: '' },
  ]
  for (const one of bad) {
    expect(
      () => assertNothingMeasured('合成', { ...good, ...one }, issue),
      `改坏 ${JSON.stringify(one)} 之后它居然没抛`,
    ).toThrow()
  }
}

/**
 * 期望表本身的体检。跑得起来不需要 Java、不需要 Chrome，所以它在 CI 里，
 * 而整条比对流水线不在。
 */
/**
 * 这份体检**逐个来源**扫过的那些。手签的一份登记：加一个新来源而不加扫法，
 * 上面那条判据会点名要求补上，而不是静静放行。
 */
const SCANNED_SOURCES: readonly ExactRectSource[] = ['reminder']

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

  it('unpainted 的表态不许带任何量出来的数，且必须挂着接它的那张票', () => {
    // 与 unassembled 同一条理由（一帧都没比过），只是「比不了」的原因不同：
    // 驱动器装得出，可这条剧本会走进一层还没实现的绘制。分母从表里现数。
    const unpainted = Object.entries(EXPECTED).filter(([, e]) => e.status === 'unpainted')
    // **这是一份登记，逐条签在这里**（xl-rh9.18）。xl-rh9.12 把菜单 / 提示图 /
    // 状态图标四层画出来、xl-rh9.13 把胜利结算画出来之后，六条 unpainted 里
    // 五条换成了真量出来的 gap，只剩 `battle-mishu-lu` 撞第 11 层小精灵；
    // xl-rh9.15 把那一层画出来，它也换成了真量出来的分区 gap，**这张表因此
    // 空了**。
    //
    // 为什么是手写一份名单而不是 `filter` 一下就完事（纪律 3 那条误用）：
    // 这一行两头都会红 —— 谁新表一条 unpainted，它红；谁把最后一层画出来了
    // 却没改这张表，它也红。写成"现扫出来的就是对的"，这两件事都不会响。
    //
    // 空着的那一侧不是没人守：`drawList.test.ts` 的「表没说画不出来，那它就
    // 不许在末拍之前抛」逐条剧本地验着 —— 谁让 battleDrawList 又抛起来而
    // 这里还写着 []，那边红。
    expect(
      unpainted.map(([name]) => name),
      '表 unpainted 的剧本变了？改这份登记，下面那几条会跟着验它',
    ).toEqual([])
    for (const [name, e] of unpainted) assertNothingMeasured(name, e, /^xl-/)
    // 登记空着时上面那个 for 一轮都不跑。分母写死的那一半在这里（xl-knp.10
    // 收 /code-review 时补）：合成一条表态，逐条改坏，确认那四条规矩真会咬人。
    assertRulesBite('unpainted', /^xl-/)
  })

  it('unassembled 的表态不许带任何量出来的数 —— 一帧都没比过，写了就是编的', () => {
    // xl-1vu.4 与 xl-1vu.5 合流时定的状态（见 expected.ts 的 status 注释）。
    // 它是个「还没得比」，不是「比过了但差着」。加这条判据是因为一个不带任何
    // 要求的状态就是一个逃生舱：以后谁想绕开上界，把 status 改成它就行了。
    // 分母从表里现数。
    const unassembled = Object.entries(EXPECTED).filter(([, e]) => e.status === 'unassembled')
    // **这是一份登记，逐条签在这里**，与上面那条 unpainted 同一个套路：xl-knp.10
    // 把最后一支驱动器（shop）接上之后，三条 shop 剧本换成了真量出来的分区表态，
    // **这张表因此空了**。原先那句 `toBeGreaterThan(0)` 从此恒红。
    //
    // 为什么不是 `filter` 一下就完事（纪律 3 那条误用）：这一行两头都会红 ——
    // 谁新表一条 unassembled（新驱动器落了真值、还没接线），它红；谁把最后一套
    // 装配做出来了却没改这张表，它也红。写成"现扫出来的就是对的"，两件事都不响。
    //
    // 空着的那一侧不是没人守：`unassembled.test.ts` 拿一条**合成的** ghost 剧本
    // 验着「表说 unassembled 而页面装得出 → 抛」两个方向，分母写死，不依赖磁盘上
    // 碰巧还剩几条没接线的。
    //
    // xl-i06.6 签进两条：第五支驱动器（saveload，存读档面板）的真值先落了，web 侧
    // 面板与取图页装配归 xl-i06.12。那张票接上之后这两条要改成量出来的表态，
    // 这份登记跟着清空。
    expect(
      unassembled.map(([name]) => name),
      '表 unassembled 的剧本变了？改这份登记，下面那几条会跟着验它',
    ).toEqual(['saveload-menu', 'saveload-start'])
    for (const [name, e] of unassembled) assertNothingMeasured(name, e, /./)
    // 同上：登记空着时上面那个 for 一轮都不跑，分母写死的那一半在这里。
    assertRulesBite('unassembled', /./)
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

  it('逐像素相等区都写清楚了理由与票号，且一条剧本里不重名', () => {
    for (const [name, e] of Object.entries(EXPECTED)) {
      if (!e.exact) continue
      expect(e.exact.length, `${name} 的 exact 是空数组`).toBeGreaterThan(0)
      const seen = new Set<string>()
      for (const x of e.exact) {
        expect(seen.has(x.name), `${name} 的逐像素相等区 ${x.name} 重名`).toBe(false)
        seen.add(x.name)
        expect(x.why, `${name}/${x.name} 没写原因`).toBeTruthy()
        expect(x.issue, `${name}/${x.name} 没挂 issue`).toMatch(/^xl-/)
        expect(x.drawnTicks, `${name}/${x.name} 的登记拍数要是正整数`).toBeGreaterThan(0)
        // 下面那条对撞是**逐个来源**扫的。表里冒出一个还没人扫的来源时，那条
        // 判据会安安静静地不核它 —— 正是"选择器匹配不到即通过"那个形状。
        // 所以来源名单在这里签一份，加来源就得同时加扫法。
        expect(
          SCANNED_SOURCES,
          `${name}/${x.name} 的来源 ${x.source} 还没有人扫 —— ` +
            `给它加一支扫法（exactRectsOf 与下面那条对撞），再把它写进 SCANNED_SOURCES`,
        ).toContain(x.source)
        // 同一条剧本上同一个来源只许有一块：下面那条对撞用 find 取，两块的话
        // 第二块永远不会被核到。
        expect(
          e.exact.filter((y) => y.source === x.source).length,
          `${name} 上来源 ${x.source} 声明了不止一块`,
        ).toBe(1)
      }
    }
  })

  it('逐像素相等区的登记与入库真值对撞 —— 两头都会红', () => {
    // xl-aq0。这是这套判据在 CI 里唯一跑得到的一半（另一半要 Java 与 Chrome），
    // 而且它是**双向**的：
    //
    // - 真值里有拍画着提示图、表里却没声明这块区 → 红（漏了一条剧本没守）；
    // - 表里声明了、真值里一拍都没有 → 红（守着一块空地，判据恒真）；
    // - 两边都有但拍数对不上 → 红（真值变了，分母得有人重新签）。
    //
    // 名单**不从 expected.ts 现扫**，是从 `tools/traces/out/` 那份行为真值扫的
    // ——被守的东西不给自己签字（纪律 3）。
    const names = scriptNames()
    expect(names.length).toBeGreaterThan(0)
    let declared = 0
    for (const name of names) {
      const file = join(repoPath('tools/traces/out'), `${name}.trace.json`)
      expect(existsSync(file), `${name} 没有入库真值：${file}`).toBe(true)
      const ticks = (JSON.parse(readFileSync(file, 'utf8')) as { ticks: ExactTraceTick[] }).ticks
      const spec = EXPECTED[name]?.exact?.find((x) => x.source === 'reminder')
      // 场景 / 菜单 / 商店那几条真值里根本没有提示图这一层，读它是硬失败，
      // 所以先分流；分流之后「没有这一层」就等于「不许声明这块区」。
      if (!ticks.some((t) => t.reminder !== undefined)) {
        expect(spec, `${name} 的真值里没有提示图这一层，却声明了逐像素相等区`).toBeUndefined()
        continue
      }
      const drawn = exactRectsOf('reminder', ticks).size
      if (drawn === 0) {
        expect(spec, `${name} 的真值里一拍都没画提示图，却声明了逐像素相等区`).toBeUndefined()
        continue
      }
      expect(
        spec,
        `${name} 的真值里有 ${drawn} 拍画着提示图，却没声明逐像素相等区 —— ` +
          `那条剧本上提示图的缩放采样没人守（xl-aq0）`,
      ).toBeDefined()
      expect(spec!.drawnTicks, `${name} 的登记拍数与真值对不上`).toBe(drawn)
      declared++
    }
    // 「一条都没扫到」与「全都对上了」不许长得一样。
    expect(declared, '一条剧本都没有逐像素相等区 —— 这套判据等于没挂上').toBeGreaterThan(0)
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
