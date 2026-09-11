import type { BlitRect } from '../battle/render/scaledBlit'

/**
 * 测试用的软件 blitter：关掉插值时 `ctx.drawImage(src, sx,sy,sw,sh, dx,dy,dw,dh)`
 * 该做的事，搬的是一维数组里的像素值。
 *
 * 只认 `scaledBlitPasses` 给出的两种段：整段拷贝（`sw === dw`）与一个源像素铺成
 * 一段（`sw === 1`），两者用同一句表达。`scaledBlit.test.ts` 与
 * `narratageLayout.test.ts` 共用（xl-03x.15 从前者抽出来）。
 */
export function softBlit(
  from: Int32Array,
  fromWidth: number,
  to: Int32Array,
  toWidth: number,
  r: BlitRect,
): void {
  for (let y = 0; y < r.dh; y++) {
    for (let x = 0; x < r.dw; x++) {
      const sx = r.sx + (r.sw === r.dw ? x : Math.floor((x * r.sw) / r.dw))
      const sy = r.sy + (r.sh === r.dh ? y : Math.floor((y * r.sh) / r.dh))
      to[(r.dy + y) * toWidth + (r.dx + x)] = from[sy * fromWidth + sx]!
    }
  }
}
