import { DEFAULT_TOLERANCE } from './diff'
import type { Rect } from './regions'

/**
 * **从实际差异图上量缺口区**用的那几件算术（xl-knp.10）。
 *
 * 它不是判据 —— 判据是 `regions.ts`。这里交出的是**读数**：一组矩形与几个数，
 * 由人认过成因、留够余量之后抄进 `expected.ts`。CLI 外壳在
 * `web/scripts/measureGaps.ts`，读盘与打印全在那边。
 *
 * ⚠️ **为什么这一半要有测试。** 它量的是 `tools/traces/compare/` 下当下这一轮
 * 的产物，那个目录整个不入库，所以「跑一遍看对不对」这件事没有可复现的分母；
 * 而它一旦算错，错的读数会被原样抄进 `expected.ts`，从此由一条**看起来很硬**
 * 的判据守着一组错矩形。所以纯算术这一半搬进 `src/`，用合成位图逐条验：
 * 聚类的外接框、区外像素怎么点名、以及「一帧都没有」必须抛。
 */

/** 一块量出来的连通区：外接框 + 它里面有多少个差异像素。 */
export interface MeasuredBox extends Rect {
  /** 这一块在**并集**里的差异像素数（不是任何单帧的）。 */
  readonly pixels: number
}

/** 聚类时把差异像素向外胀这么多再判连通 —— 一个字的笔画之间本来就是断开的。 */
export const DILATE = 4

/**
 * 两张同尺寸位图的**超容差掩码**。
 *
 * **与 `diff.ts` 的 `frameDiff` 同一条规则**：alpha 不参与（Java 的位图不带
 * alpha、浏览器截图恒为 255，拿它比只会得到一个恒真的结论），容差同一个常量。
 * 两处规则岔开的话，量出来的矩形与判据看的差异就不是同一批像素了。
 */
export function diffMask(a: Uint8Array, b: Uint8Array, pixels: number): Uint8Array {
  const mask = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i++) {
    const p = i * 4
    const d = Math.max(
      Math.abs(a[p]! - b[p]!),
      Math.abs(a[p + 1]! - b[p + 1]!),
      Math.abs(a[p + 2]! - b[p + 2]!),
    )
    if (d > DEFAULT_TOLERANCE) mask[i] = 1
  }
  return mask
}

/** 逐帧掩码的并集。`masks` 为空是硬失败，见文件头。 */
export function unionOf(masks: readonly Uint8Array[], pixels: number): Uint8Array {
  if (masks.length === 0) throw new Error('一帧都没有，量不出任何东西')
  const union = new Uint8Array(pixels)
  for (const mask of masks) {
    for (let i = 0; i < mask.length; i++) if (mask[i]) union[i] = 1
  }
  return union
}

/**
 * 并集掩码 → 连通块的外接框，按并集像素数从多到少。
 *
 * **膨胀只用于判连通，框仍是原始像素的外接框** —— 拿膨胀后的框当读数的话，
 * 抄进 `expected.ts` 的矩形会白白胖 `DILATE` 圈，而那几圈是硬比区。
 */
export function clusterBoxes(union: Uint8Array, width: number, height: number): MeasuredBox[] {
  const label = new Int32Array(width * height).fill(-1)
  const boxes: { x0: number; y0: number; x1: number; y1: number; pixels: number }[] = []
  const stack: number[] = []
  for (let seed = 0; seed < union.length; seed++) {
    if (!union[seed] || label[seed] !== -1) continue
    const id = boxes.length
    const box = { x0: width, y0: height, x1: -1, y1: -1, pixels: 0 }
    boxes.push(box)
    label[seed] = id
    stack.push(seed)
    while (stack.length > 0) {
      const i = stack.pop()!
      const x = i % width
      const y = (i / width) | 0
      if (x < box.x0) box.x0 = x
      if (x > box.x1) box.x1 = x
      if (y < box.y0) box.y0 = y
      if (y > box.y1) box.y1 = y
      box.pixels++
      for (let dy = -DILATE; dy <= DILATE; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -DILATE; dx <= DILATE; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const j = ny * width + nx
          if (union[j] && label[j] === -1) {
            label[j] = id
            stack.push(j)
          }
        }
      }
    }
  }
  return boxes.sort((p, q) => q.pixels - p.pixels)
}

/** 一个区回核出来的读数。`worstFrame` 是「单帧最多」落在第几帧（下标）。 */
export interface RegionReading {
  readonly worst: number
  readonly worstFrame: number
  readonly framesHit: number
  /** 区里那些差异像素并集的外接框；一帧都不差时是 `null`。 */
  readonly box: Rect | null
}

/** 逐帧数一个矩形里有多少个超容差像素，交出「单帧最多」与实测外接框。 */
export function readRegion(
  masks: readonly Uint8Array[],
  width: number,
  rect: Rect,
): RegionReading {
  if (masks.length === 0) throw new Error('一帧都没有，量不出任何东西')
  let worst = 0
  let worstFrame = -1
  let framesHit = 0
  let x0 = rect.x1
  let y0 = rect.y1
  let x1 = rect.x0 - 1
  let y1 = rect.y0 - 1
  masks.forEach((mask, k) => {
    let n = 0
    for (let y = rect.y0; y <= rect.y1; y++) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        if (!mask[y * width + x]) continue
        n++
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
    if (n > 0) framesHit++
    if (n > worst) {
      worst = n
      worstFrame = k
    }
  })
  return { worst, worstFrame, framesHit, box: x1 < rect.x0 ? null : { x0, y0, x1, y1 } }
}

/** 落在所有区**之外**的差异像素 —— 硬比区一个都不许有。 */
export interface OutsideReading {
  readonly pixels: number
  readonly frames: number
  readonly box: Rect | null
}

/**
 * 数区外的差异像素。
 *
 * 这是「不许拿一个更大的框把没认出来的成因盖掉」那句话的算术：**区外多一个
 * 像素，就说明还有一个没认出来的成因**，而它的位置比它的个数更有用。
 */
export function readOutside(
  masks: readonly Uint8Array[],
  width: number,
  height: number,
  rects: readonly Rect[],
): OutsideReading {
  if (masks.length === 0) throw new Error('一帧都没有，量不出任何东西')
  const inside = new Uint8Array(width * height)
  for (const r of rects) {
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) inside[y * width + x] = 1
    }
  }
  let pixels = 0
  let frames = 0
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (const mask of masks) {
    let hit = false
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || inside[i]) continue
      pixels++
      hit = true
      const x = i % width
      const y = (i / width) | 0
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
    if (hit) frames++
  }
  return { pixels, frames, box: x1 < 0 ? null : { x0, y0, x1, y1 } }
}
