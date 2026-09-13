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
 * **只比缓冲 alpha 没叠满（`a < 255`）的像素。** 叠满处两支上屏逐位相同，那部分
 * `'fresh'` 那一轮已经在判；这里再判一遍只会把字形那笔旧账（xl-9bd.17）重记一次。
 *
 * **红和绿长得不一样吗。** 两种会让它恒绿的形状，都当场判红：
 *
 * - **分母为空**：这一轮一个半透明像素都没有（缓冲已叠满、或剧本换了不透明的背景），
 *   逐像素比一个都不比 —— 与「全对」同形。
 * - **分不开**：半透明像素都在，但「盖在底色上」与「扔 alpha」两个预测差不出
 *   `2 × 容差`（比如背景边恰好是近 238 的灰）。那时渲染器扔不扔 alpha 读数都一样。
 *   取 2 倍：一个落在「扔 alpha」预测容差之内的像素，离「盖底色」预测必然超过容差。
 *
 * 所以通过的条件是：可分像素 > 0，且半透明像素里没有一个离「盖底色」预测超过容差。
 *
 * **覆盖边界**：判的只是缓冲没叠满的那几帧里的那些像素 —— battle-script3 按剧本自报的
 * 25 拍取帧，45 帧里只有第 0 帧有（2026-09-13 实测 3195 个）。keep 那一支若连叠满处都
 * 画错，这里看不见，'fresh' 那一轮也看不见（它走另一支）。`--skip-capture` 下判的是
 * 上一轮留在 `web-keep/` 的截图，与 `web/` 那一侧同样的前提。
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
}

export function presentKeepFrame(
  tick: number,
  java: Bitmap,
  web: Bitmap,
  tolerance: number,
  background = PANEL_BACKGROUND,
): PresentFrame {
  if (java.width !== web.width || java.height !== web.height) {
    throw new Error(`第 ${tick} 帧两端尺寸不同：${java.width}×${java.height} vs ${web.width}×${web.height}`)
  }
  const bg = rgbOf(background)
  let translucent = 0
  let separable = 0
  let differing = 0
  let maxDelta = 0
  for (let i = 0; i < java.rgba.length; i += 4) {
    const a = java.rgba[i + 3]!
    if (a === 255) continue
    translucent++
    let d = 0
    let gap = 0
    for (let k = 0; k < 3; k++) {
      const c = java.rgba[i + k]!
      const over = javaOver(c, a, bg[k]!)
      d = Math.max(d, Math.abs(web.rgba[i + k]! - over))
      // 「扔 alpha」预测就是缓冲的非预乘 RGB 本身（取图页 'fresh' 上屏的样子）。
      gap = Math.max(gap, Math.abs(c - over))
    }
    if (gap > 2 * tolerance) separable++
    if (d > tolerance) differing++
    if (d > maxDelta) maxDelta = d
  }
  return { tick, translucent, separable, differing, maxDelta }
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
  const bad = frames.filter((f) => f.differing > 0).map((f) => `#${f.tick}`)
  const counts =
    `半透明像素 ${translucent}（${frames.filter((f) => f.translucent > 0).length}/${frames.length} 帧）· ` +
    `可分 ${separable} · 超容差 ${differing} · 最大差 ${maxDelta}`
  if (separable === 0) {
    return {
      ok: false,
      verdict: `上屏 keep：判不出 —— ${counts}。没有一个像素分得开「盖底色」与「扔 alpha」，这一轮读数与渲染器扔不扔 alpha 无关`,
    }
  }
  if (differing > 0) {
    return { ok: false, verdict: `上屏 keep：不像原版上屏 —— ${counts}，坏在 ${bad.join('、')}` }
  }
  return { ok: true, verdict: `上屏 keep：与原版上屏一致 —— ${counts}` }
}
