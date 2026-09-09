import { decodePng } from '../compare/png'
import type { Bitmap } from '../compare/png'

/**
 * **在原始素材上量东西**用的两把尺子。解码那一步不在这里 ——
 * `compare/png.ts` 的 `decodePng` 已经解得了这两张图（8 位真彩、非隔行），
 * 那是跨端逐帧比对在用的同一份。
 *
 * 为什么需要它们：菜单那两张背景图上的「列表框」是画出来的，框的内区边界
 * 既不在 Java 源码里、也不在任何真值里，它只在像素里。滚动条一屏放得下几行
 * 由它决定（`menu/scroll.ts`），而把量出来的数字抄成常量、再在注释里写一句
 * 「量过了」，与没量过长得一模一样。这两把尺子让那次测量**每跑一次测试就
 * 重做一遍**：图换了、常量抄错了，立刻红。
 *
 * ⚠️ 量的是 `sources/` 下的**原始素材**（入库的），不是烘焙产物：产物是 WebP，
 * 解它得引一个库。两者同源（`bake.ts` 走 `-lossless`），量框的边界用哪一份
 * 都一样。
 */

/** 一个像素的亮度（ITU-R BT.601 的整数近似，与 `measure-list-box.md` 同一条式子）。 */
export function luminance(bmp: Bitmap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= bmp.width || y >= bmp.height) {
    throw new Error(`(${x},${y}) 在 ${bmp.width}×${bmp.height} 之外`)
  }
  const i = (y * bmp.width + x) * 4
  return Math.floor((bmp.rgba[i]! * 299 + bmp.rgba[i + 1]! * 587 + bmp.rgba[i + 2]! * 114) / 1000)
}

/**
 * 从一个种子点出发，把它所在的那一片**暗区**沿横竖两个方向走到头 ——
 * 也就是列表框的内区（框线是亮的，框里是暗的）。
 *
 * ⚠️ 种子点必须落在暗区里，否则**抛**：从亮处出发会得到一个长度为 1 的区间，
 * 而那与"量到了一个很窄的框"长得一模一样。`scripts/measure-list-box.md` 里
 * 那份手工脚本没有这道门，那是两者唯一实质的差别。
 */
export function scanDarkBox(
  bmp: Bitmap,
  seedX: number,
  seedY: number,
  threshold = 80,
): { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number } {
  const dark = (x: number, y: number) => luminance(bmp, x, y) < threshold
  if (!dark(seedX, seedY)) {
    throw new Error(`种子点 (${seedX},${seedY}) 的亮度是 ${luminance(bmp, seedX, seedY)}，不在暗区里`)
  }
  let left = seedX
  while (left > 0 && dark(left - 1, seedY)) left--
  let right = seedX
  while (right + 1 < bmp.width && dark(right + 1, seedY)) right++
  let top = seedY
  while (top > 0 && dark(seedX, top - 1)) top--
  let bottom = seedY
  while (bottom + 1 < bmp.height && dark(seedX, bottom + 1)) bottom++
  return { left, right, top, bottom }
}

export { decodePng }
