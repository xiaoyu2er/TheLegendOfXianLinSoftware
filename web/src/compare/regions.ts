import type { FrameDiff } from './diff'
import type { Bitmap } from './png'

/**
 * 分区判据（xl-1vu.3）：一张画布不再只有"整屏一个状态"，而是分成
 * **硬比区**与**缺口区**两种。
 *
 * 为什么需要它。整屏一个状态的表态只能表达"这条剧本现在必然红"，红在哪由注释
 * 里的一段散文钉住 —— 散文不会在缺口挪了位置的时候变红。而 DOM 面板那批
 * （菜单、商店、装备）几乎整屏都是文字，字形已裁定收敛不到逐像素
 * （xl-9bd.17），全屏比对会一片红、失去分辨力：背景、图标、血条这些**本来就
 * 该逐像素对上**的东西，会被埋在字形的噪声里。
 *
 * 分区之后判据变成两条，**两条的失败态都和成功态长得不一样**：
 *
 * - 缺口区**之外**的每一个像素都必须在容差内相等。不是"超过阈值才算偏"，是
 *   **一个都不许有** —— 硬比区里多出一个像素，就说明有东西画到了没人声明过
 *   的地方。
 * - 缺口区照旧记账，并且**每个区各自双向红**：某个区一帧都不差了，说明那笔账
 *   还完了而表没改，也红。整屏版的双向红是同一个性质，这里只是把分母从"整条
 *   剧本"缩到"每个区"——否则三个缺口里补上一个，另外两个会替它把红盖住。
 *   上面那一头是**幅度上界**（`GapRegion.maxPixels`，xl-l3o）：差得比声明的多
 *   也红。只有下界的时候，"字形还差着"与"这一块什么都没画出来"给出同一个结论。
 *
 * 判据本身（为什么不是哈希、容差是干什么的）见 `diff.ts`，这里只管分区。
 */

/** 闭区间矩形：`x0..x1`、`y0..y1` 两端都含。 */
export interface Rect {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

/** 一块声明出来的缺口区。`why` / `issue` 是它存在的理由，缺一不可。 */
export interface GapRegion {
  readonly name: string
  readonly rect: Rect
  readonly why: string
  readonly issue: string
  /**
   * **幅度上界**（xl-l3o）：这个区在**任意单帧**里超容差的像素数的上限。
   *
   * 为什么必须有。缺口区原本只有下界（"一帧都不差了就红"），上界是开的 ——
   * 于是"这块字形还没对上"与"这块什么都没画出来"给出同一个结论。实测过：把
   * 基准侧的 `snapshotImage()` 换成一张全黑图，`dorm-walk` 的最差帧从 0.7401%
   * 跳到 99.9565%，流水线照样放行。
   *
   * 取值必须**实测**（跑一遍比对，读 `report.json` 里这个区的 `gapWorst`），
   * 再按剧本注释里写明的余量放大。上界是**每帧**的，不是所有帧之和：帧数随
   * `--every` 变，和值跟着变，只有单帧的量在换采样密度时仍然成立。
   */
  readonly maxPixels: number
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
}

/** 两个闭区间矩形是否相交。相交的缺口区会让同一个像素被记两次账。 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1
}

/** 一帧按分区拆开之后的差异。 */
export interface PartitionedDiff {
  /**
   * 硬比区的差异。`ratio` 的分母是**硬比区自己的面积**（整屏减去缺口区），
   * 不是整屏 —— 拿整屏当分母会让"硬比区里坏了 300 个像素"看起来像 0.05%。
   */
  readonly strict: FrameDiff
  /** 硬比区的面积，即 `strict.ratio` 的分母。 */
  readonly strictArea: number
  /** 每个缺口区里超容差的像素数，与传进来的 `regions` 同序同长。 */
  readonly gaps: readonly number[]
}

/**
 * 按缺口区把一帧的差异拆成"硬比区"与"每个缺口区"。
 *
 * 尺寸不同是硬失败，理由同 `frameDiff`：那不是差异大，是接错了。
 * `regions` 允许为空 —— 那时整屏都是硬比区。
 */
export function partitionedDiff(
  a: Bitmap,
  b: Bitmap,
  regions: readonly Rect[],
  tolerance: number,
): PartitionedDiff {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `两端帧的尺寸不同：${a.width}×${a.height} vs ${b.width}×${b.height}。` +
        `逻辑画布锁死 1024×640，尺寸对不上说明取图那一步就错了，不是渲染差异。`,
    )
  }
  const gaps = new Array<number>(regions.length).fill(0)
  let strictArea = 0
  let differing = 0
  let maxDelta = 0
  let x0 = a.width
  let y0 = a.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4
      // alpha 不参与，理由同 frameDiff。
      const d = Math.max(
        Math.abs(a.rgba[i]! - b.rgba[i]!),
        Math.abs(a.rgba[i + 1]! - b.rgba[i + 1]!),
        Math.abs(a.rgba[i + 2]! - b.rgba[i + 2]!),
      )
      // 命中第一个就停：缺口区**不许互相重叠**（`expected.test.ts` 里有一条
      // 逐对检查），所以"第一个"就是"唯一一个"。一个像素只能记进一个区，
      // 否则"这个区一帧都不差了"这句话就不再可判。
      let inGap = false
      for (let k = 0; k < regions.length; k++) {
        if (inRect(regions[k]!, x, y)) {
          inGap = true
          if (d > tolerance) gaps[k]!++
          break
        }
      }
      if (inGap) continue
      strictArea++
      if (d > maxDelta) maxDelta = d
      if (d > tolerance) {
        differing++
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
  }
  return {
    strict: {
      differing,
      ratio: strictArea === 0 ? 0 : differing / strictArea,
      maxDelta,
      box: x1 < 0 ? null : { x0, y0, x1, y1 },
    },
    strictArea,
    gaps,
  }
}

/** 带 tick 号的分区差异 —— 报告要指出**第一个出问题的帧号**。 */
export interface PartitionedFrame extends PartitionedDiff {
  readonly tick: number
}

export interface RegionVerdict {
  readonly ok: boolean
  /** 一行结论，给报告用。 */
  readonly verdict: string
  /** 硬比区第一次出现超容差像素的帧号；没有则 `null`。 */
  readonly firstStrictBreak: number | null
  /** 硬比区在所有帧里超容差的像素总数。 */
  readonly strictDiffering: number
  /** 每个缺口区在所有帧里超容差的像素总数，与 `regions` 同序。 */
  readonly gapTotals: readonly number[]
  /**
   * 每个缺口区**最差的那一帧**：差了多少、是哪一帧。与 `regions` 同序。
   * 上界要拿它来定（`GapRegion.maxPixels`），所以报告里必须能读到。
   */
  readonly gapWorst: readonly { readonly tick: number; readonly pixels: number }[]
  /** 一帧都不差了的缺口区的名字 —— 这些是"账还完了而表没改"。 */
  readonly closedGaps: readonly string[]
  /** 超了上界的缺口区的名字 —— 这些是"差得比声明的多"。 */
  readonly blownGaps: readonly string[]
}

/**
 * 把一串分区差异收成一条剧本的结论。
 *
 * 空序列是硬失败，理由同 `summarize`：**"一帧都没比"和"比了全过"在只看退出码
 * 的检查里长得一模一样**。
 */
export function judgeRegions(
  frames: readonly PartitionedFrame[],
  regions: readonly GapRegion[],
): RegionVerdict {
  if (frames.length === 0) {
    throw new Error('一帧都没有比 —— 空的帧序列不算通过。')
  }
  if (regions.length === 0) {
    throw new Error(
      '分区表态里一个缺口区都没有。那等于"整屏都必须逐像素相等"，' +
        '直接写 status: match 就行，不要用一张空的分区表把它伪装成有缺口。',
    )
  }
  for (const r of regions) {
    if (!Number.isFinite(r.maxPixels) || r.maxPixels <= 0) {
      throw new Error(
        `缺口区 ${r.name} 没给出幅度上界（maxPixels=${String(r.maxPixels)}）。` +
          `没有上界的缺口区分辨不出"字形还差着"与"这一块什么都没画出来"，` +
          `不许当成默认放行 —— 跑一遍比对，把 report.json 里这个区的 gapWorst 加上余量填进去。`,
      )
    }
  }
  let firstStrictBreak: number | null = null
  let strictDiffering = 0
  let worstBreak: PartitionedFrame | null = null
  const gapTotals = new Array<number>(regions.length).fill(0)
  const gapWorst = regions.map(() => ({ tick: frames[0]!.tick, pixels: -1 }))
  for (const f of frames) {
    if (f.gaps.length !== regions.length) {
      throw new Error(`第 ${f.tick} 帧记了 ${f.gaps.length} 个缺口区，表里声明了 ${regions.length} 个`)
    }
    for (let k = 0; k < regions.length; k++) {
      gapTotals[k]! += f.gaps[k]!
      if (f.gaps[k]! > gapWorst[k]!.pixels) gapWorst[k] = { tick: f.tick, pixels: f.gaps[k]! }
    }
    strictDiffering += f.strict.differing
    if (f.strict.differing > 0) {
      if (firstStrictBreak === null) firstStrictBreak = f.tick
      if (worstBreak === null || f.strict.differing > worstBreak.strict.differing) worstBreak = f
    }
  }
  const closedGaps = regions.filter((_, k) => gapTotals[k] === 0).map((r) => r.name)
  const blownGaps = regions.filter((r, k) => gapWorst[k]!.pixels > r.maxPixels).map((r) => r.name)

  // 三条判据各自成句，**一次全报出来**：一次跑完要能看见这条剧本到底破在
  // 哪几处。以前是命中第一条就返回，于是"硬比区破了"会把"某个区超了上界"
  // 整个盖住 —— 而全黑图那种灾难两条会同时破。
  const problems: string[] = []
  if (firstStrictBreak !== null) {
    const w = worstBreak!
    const box = w.strict.box
    problems.push(
      `硬比区破了：第 ${firstStrictBreak} 帧起有像素超容差，${frames.length} 帧合计 ` +
        `${strictDiffering} 个；最坏的是第 ${w.tick} 帧 ${w.strict.differing} 个` +
        `${box ? ` @ (${box.x0},${box.y0})-(${box.x1},${box.y1})` : ''}。` +
        `硬比区不许有任何一个超容差的像素 —— 要么是回归了，要么是这一块本来就该` +
        `声明成缺口区而没声明。`,
    )
  }
  if (blownGaps.length > 0) {
    problems.push(
      `缺口区超了上界：` +
        regions
          .map((r, k) => ({ r, w: gapWorst[k]! }))
          .filter(({ r, w }) => w.pixels > r.maxPixels)
          .map(
            ({ r, w }) =>
              `${r.name} 第 ${w.tick} 帧 ${w.pixels} 个 > 上界 ${r.maxPixels}` +
              `（超了 ${w.pixels - r.maxPixels} 个，${(w.pixels / r.maxPixels).toFixed(2)} 倍）`,
          )
          .join('；') +
        `。缺口区记的是一笔说得清的账，差得比声明的多就不是那笔账了。`,
    )
  }
  if (closedGaps.length > 0) {
    problems.push(
      `缺口区 ${closedGaps.join('、')} 一帧都不差了 —— 账还完了而表没改，` +
        `把这些区从 expected.ts 的 gaps 里删掉（删干净之后整条就该是 match）。`,
    )
  }

  return {
    ok: problems.length === 0,
    verdict:
      problems.length > 0
        ? problems.join(' ')
        : `硬比区 ${frames.length} 帧逐像素相等；` +
          regions
            .map((r, k) => `${r.name} 合计 ${gapTotals[k]}、最差 ${gapWorst[k]!.pixels}/${r.maxPixels}`)
            .join(' · '),
    firstStrictBreak,
    strictDiffering,
    gapTotals,
    gapWorst,
    closedGaps,
    blownGaps,
  }
}
