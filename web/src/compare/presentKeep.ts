import { PANEL_BACKGROUND } from '../battle/render/present'
import type { Bitmap } from './png'

/**
 * 战斗上屏 `'keep'` 那一支的渲染器层判据（xl-k9e）。
 *
 * `present.test.ts` 只守到**模型**（`presentFor` 选哪一支、底色取多少）；浏览器真的照
 * 那样画了没有，跨端逐帧比对看不见 —— 取图页只跑 `'fresh'`。这里补上：比对器让登记的
 * 剧本在取图页里**再以 `'keep'` 回放一遍**（`<剧本>/web-keep/`），拿原版导出的
 * `bufferedPic`（非预乘 RGBA PNG）**在 Node 这边盖到 `Panel.background` 上**当预测 ——
 * 那正是原版上屏的样子（`present.ts` 文件头）—— 与浏览器截图逐像素比。
 *
 * **对原版只比缓冲 alpha 没叠满（`a < 255`）的像素。** 叠满处两支上屏在模型上逐位相同，
 * 那部分 `'fresh'` 那一轮已经在对原版判；这里再对原版判一遍只会把字形那笔旧账
 * （xl-9bd.17）重记一次。叠满处另比 keep 与 fresh 两轮，见下面「叠满的像素」。
 *
 * **红和绿长得不一样吗。** 两种会让它恒绿的形状，都当场判红：
 *
 * - **分母为空**：这一轮一个半透明像素都没有（缓冲已叠满、或剧本换了不透明的背景），
 *   逐像素比一个都不比 —— 与「全对」同形。
 * - **分不开**：半透明像素都在，但「盖在底色上」与「扔 alpha」两个预测差不出
 *   `2 × 容差`（比如背景边恰好是近 238 的灰）。那时渲染器扔不扔 alpha 读数都一样。
 *   取 2 倍：一个落在「扔 alpha」预测容差之内的像素，离「盖底色」预测必然超过容差。
 *
 * **叠满的像素另判一件事（xl-ejr）**：keep 那一轮与 fresh 那一轮（`web/`，整屏那一套
 * 已经拿它对原版判过）**逐位相同**。不对原版直接比，是为了不把字形那笔旧账再记一遍；
 * 逐位而不给容差，是因为两轮是同一台浏览器画同一份清单，实测一个都不差
 * （battle-script3，45 帧 29488005 个叠满像素，2026-09-13 改前、改后各一趟，同一台机器）。
 * 换浏览器或 GPU 后两轮若不再逐位相同，这里会红（响的一侧，不是恒绿）—— 那时先量
 * 两轮的差，再决定给不给容差。
 *
 * ⚠️ **这一半分不开「盖底色」与「扔 alpha」，按构造就分不开**：`a = 255` 时
 * `javaOver(c, 255, bg) = c`，两个预测是同一个数。所以它不进 `separable`、也替代不了
 * 半透明那一半 —— keep 那一轮若整个照 fresh 画（取图页不认 `present`），叠满处必然
 * 逐位相同，红只能来自半透明那一半。它守的是半透明那一半看不见的：keep 那一支在叠满处
 * 多挂了什么、画错了什么。它自己的恒绿形状是分母为空（一个叠满像素都没有），当场判红。
 *
 * 所以通过的条件是：可分像素 > 0，半透明像素里没有一个离「盖底色」预测超过容差，
 * 叠满像素 > 0，且其中没有一个 keep 与 fresh 不同。
 *
 * **覆盖边界**：半透明那一半只有缓冲没叠满的那几帧 —— battle-script3 按剧本自报的
 * 25 拍取帧，45 帧里只有第 0 帧有（2026-09-13 实测 3195 个）。叠满那一半只证明 keep
 * 与 fresh 一样；fresh 在叠满处对不对原版，由整屏那一套判（含它的分区表态）。
 * `--skip-capture` 下判的是上一轮留在 `web-keep/`、`web/` 的截图。
 */

/**
 * 以 `'keep'` 再回放一遍的剧本 —— **手签的登记**，不现扫（dispatch.md 纪律 3）：
 * 挑的是头几帧缓冲叠不满的那一场（背景「校园小道」半透明的边）。每多一条就多开一次
 * 浏览器、多截一轮图；可分像素为 0 的剧本登记进来会当场红，登记不了恒绿的。
 */
export const PRESENT_KEEP_SCRIPTS: readonly string[] = ['battle-script3']

/** `0xRRGGBB` 拆成三个通道。 */
export function rgbOf(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]
}

/** 原版上屏的一个通道：非预乘 `c`、alpha `a` 以 SrcOver 盖在不透明底色 `bg` 上。 */
export function javaOver(c: number, a: number, bg: number): number {
  return Math.round((c * a + bg * (255 - a)) / 255)
}

export interface PresentFrame {
  readonly tick: number
  /** 原版缓冲 `a < 255` 的像素数 —— 这一帧的分母。 */
  readonly translucent: number
  /** 其中「盖底色」与「扔 alpha」两个预测差出 `2 × 容差` 的。 */
  readonly separable: number
  /** 其中浏览器离「盖底色」预测超过容差的。 */
  readonly differing: number
  /** 半透明像素上离「盖底色」预测的最大单通道差。 */
  readonly maxDelta: number
  /** 原版缓冲 `a = 255` 的像素数 —— 叠满那一半的分母（xl-ejr）。 */
  readonly opaque: number
  /** 其中 keep 那一轮与 fresh 那一轮不逐位相同的。 */
  readonly opaqueDiffering: number
}

export function presentKeepFrame(
  tick: number,
  java: Bitmap,
  keep: Bitmap,
  fresh: Bitmap,
  tolerance: number,
  background = PANEL_BACKGROUND,
): PresentFrame {
  for (const [side, b] of [['keep', keep], ['fresh', fresh]] as const) {
    if (java.width !== b.width || java.height !== b.height) {
      throw new Error(`第 ${tick} 帧两端尺寸不同：${java.width}×${java.height} vs ${side} ${b.width}×${b.height}`)
    }
  }
  const bg = rgbOf(background)
  let translucent = 0
  let separable = 0
  let differing = 0
  let maxDelta = 0
  let opaque = 0
  let opaqueDiffering = 0
  for (let i = 0; i < java.rgba.length; i += 4) {
    const a = java.rgba[i + 3]!
    if (a === 255) {
      // 叠满处两个预测按构造相同（`javaOver(c, 255, bg) = c`），这里分不开「盖底色」与
      // 「扔 alpha」，所以不进 `separable`；问的是另一件事：keep 与 fresh 两轮逐位相同。
      opaque++
      if (keep.rgba[i] !== fresh.rgba[i] || keep.rgba[i + 1] !== fresh.rgba[i + 1] || keep.rgba[i + 2] !== fresh.rgba[i + 2]) {
        opaqueDiffering++
      }
      continue
    }
    translucent++
    let d = 0
    let gap = 0
    for (let k = 0; k < 3; k++) {
      const c = java.rgba[i + k]!
      const over = javaOver(c, a, bg[k]!)
      d = Math.max(d, Math.abs(keep.rgba[i + k]! - over))
      // 「扔 alpha」预测就是缓冲的非预乘 RGB 本身（取图页 'fresh' 上屏的样子）。
      gap = Math.max(gap, Math.abs(c - over))
    }
    if (gap > 2 * tolerance) separable++
    if (d > tolerance) differing++
    if (d > maxDelta) maxDelta = d
  }
  return { tick, translucent, separable, differing, maxDelta, opaque, opaqueDiffering }
}

export interface PresentVerdict {
  readonly ok: boolean
  readonly verdict: string
}

export function judgePresentKeep(frames: readonly PresentFrame[]): PresentVerdict {
  const translucent = frames.reduce((n, f) => n + f.translucent, 0)
  const separable = frames.reduce((n, f) => n + f.separable, 0)
  const differing = frames.reduce((n, f) => n + f.differing, 0)
  const maxDelta = frames.reduce((n, f) => Math.max(n, f.maxDelta), 0)
  const opaque = frames.reduce((n, f) => n + f.opaque, 0)
  const opaqueDiffering = frames.reduce((n, f) => n + f.opaqueDiffering, 0)
  const bad = frames.filter((f) => f.differing > 0).map((f) => `#${f.tick}`)
  const badOpaque = frames.filter((f) => f.opaqueDiffering > 0).map((f) => `#${f.tick}`)
  const counts =
    `半透明像素 ${translucent}（${frames.filter((f) => f.translucent > 0).length}/${frames.length} 帧）· ` +
    `可分 ${separable} · 超容差 ${differing} · 最大差 ${maxDelta} · ` +
    `叠满像素 ${opaque} · keep≠fresh ${opaqueDiffering}`
  if (separable === 0) {
    return {
      ok: false,
      verdict: `上屏 keep：判不出 —— ${counts}。没有一个像素分得开「盖底色」与「扔 alpha」，这一轮读数与渲染器扔不扔 alpha 无关`,
    }
  }
  if (differing > 0) {
    return { ok: false, verdict: `上屏 keep：不像原版上屏 —— ${counts}，坏在 ${bad.join('、')}` }
  }
  if (opaque === 0) {
    return {
      ok: false,
      verdict: `上屏 keep：叠满处判不出 —— ${counts}。一个叠满像素都没有，keep 与 fresh 一个像素都没对过`,
    }
  }
  if (opaqueDiffering > 0) {
    return {
      ok: false,
      verdict: `上屏 keep：叠满处与 fresh 那一轮不逐位相同 —— ${counts}，坏在 ${badOpaque.join('、')}`,
    }
  }
  return { ok: true, verdict: `上屏 keep：半透明处与原版上屏一致、叠满处与 fresh 那一轮逐位相同 —— ${counts}` }
}
