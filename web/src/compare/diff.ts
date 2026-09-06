import type { Bitmap } from './png'

/**
 * 逐帧比对的判据。
 *
 * **为什么不是哈希。** 本项目已经踩过一次：战斗截图用 MD5 判"唯一帧"，
 * 结论是"60/60 唯一、没问题"，实际上 16 场里 14 场两秒后完全静止、九成的帧
 * 是废的 —— 行动条挪一个像素就算"不同"，这个判据没有诊断力。所以这里量的是
 * **有多少像素差了多少**，并且把差异的**位置**一起报出来：
 *
 * - `tolerance`：单通道容差。地图资产在 Web 侧走 WebP，JPG 源那批是有损的
 *   （见 `web/README.md`），逐字节相等做不到，也不该要求。
 * - `ratio`：超出容差的像素占比 —— 判"这一帧算不算偏了"的量。
 * - `maxDelta` / `box`：**坏了要长得不一样**。红了以后要能一眼看出是"整屏都
 *   差一点点"（资产编码）还是"一小块差很多"（画错了一个精灵）。
 */
export interface FrameDiff {
  /** 超出容差的像素数。 */
  readonly differing: number
  /** `differing / (width * height)`。 */
  readonly ratio: number
  /** 全图最大的单通道差值（0..255）。 */
  readonly maxDelta: number
  /** 超出容差的像素的包围盒；一个都没有时为 `null`。 */
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null
}

export const DEFAULT_TOLERANCE = 8

/** 两张同尺寸位图的差异。尺寸不同是硬失败 —— 那不是"差异大"，是接错了。 */
export function frameDiff(a: Bitmap, b: Bitmap, tolerance = DEFAULT_TOLERANCE): FrameDiff {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `两端帧的尺寸不同：${a.width}×${a.height} vs ${b.width}×${b.height}。` +
        `逻辑画布锁死 1024×640，尺寸对不上说明取图那一步就错了，不是渲染差异。`,
    )
  }
  let differing = 0
  let maxDelta = 0
  let x0 = a.width
  let y0 = a.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4
      // alpha 不参与：Java 的位图不带 alpha，浏览器截图恒为 255，
      // 拿它比只会得到一个恒真的结论。
      const d = Math.max(
        Math.abs(a.rgba[i]! - b.rgba[i]!),
        Math.abs(a.rgba[i + 1]! - b.rgba[i + 1]!),
        Math.abs(a.rgba[i + 2]! - b.rgba[i + 2]!),
      )
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
    differing,
    ratio: differing / (a.width * a.height),
    maxDelta,
    box: x1 < 0 ? null : { x0, y0, x1, y1 },
  }
}

/** 一帧的比对结果，带上它是哪个 tick —— 报告要指出**第一个偏离的帧号**。 */
export interface FrameResult extends FrameDiff {
  readonly tick: number
}

export interface SequenceResult {
  /** 比了多少帧。这就是这条剧本的分母。 */
  readonly frames: number
  /** 超过阈值的帧的 tick，升序。 */
  readonly divergent: readonly number[]
  /** 第一个偏离的帧号；全过为 `null`。 */
  readonly firstDivergent: number | null
  /** 差异最大的那一帧（按 `ratio`）。全 0 时是第一帧。 */
  readonly worst: FrameResult
}

/**
 * 把一串逐帧结果收成一条剧本的结论。
 *
 * `threshold` 是"这一帧算偏了"的占比阈值。空序列是硬失败：**"一帧都没比"
 * 和"比了全过"在任何只看退出码的检查里长得一模一样**，而前者是这条流水线
 * 最容易出的故障（取图那一步默默没出图）。
 */
export function summarize(results: readonly FrameResult[], threshold: number): SequenceResult {
  if (results.length === 0) {
    throw new Error('一帧都没有比 —— 空的帧序列不算通过。')
  }
  const divergent = results.filter((r) => r.ratio > threshold).map((r) => r.tick)
  let worst = results[0]!
  for (const r of results) if (r.ratio > worst.ratio) worst = r
  return {
    frames: results.length,
    divergent,
    firstDivergent: divergent.length > 0 ? divergent[0]! : null,
    worst,
  }
}

/**
 * 差异可视化：原版帧压暗打底，超出容差的像素涂成洋红。
 *
 * 报告说"第 325 帧偏了 0.4%"之后，人要能立刻看见那 0.4% 在哪儿。
 */
export function diffImage(a: Bitmap, b: Bitmap, tolerance = DEFAULT_TOLERANCE): Bitmap {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`两端帧的尺寸不同：${a.width}×${a.height} vs ${b.width}×${b.height}`)
  }
  const rgba = new Uint8Array(a.width * a.height * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    const d = Math.max(
      Math.abs(a.rgba[i]! - b.rgba[i]!),
      Math.abs(a.rgba[i + 1]! - b.rgba[i + 1]!),
      Math.abs(a.rgba[i + 2]! - b.rgba[i + 2]!),
    )
    if (d > tolerance) {
      rgba[i] = 255
      rgba[i + 1] = 0
      rgba[i + 2] = 255
    } else {
      rgba[i] = a.rgba[i]! >> 2
      rgba[i + 1] = a.rgba[i + 1]! >> 2
      rgba[i + 2] = a.rgba[i + 2]! >> 2
    }
    rgba[i + 3] = 255
  }
  return { width: a.width, height: a.height, rgba }
}
