import { inflateSync } from 'node:zlib'

/**
 * 一个**只够用来量东西**的 PNG 解码器，测试专用。
 *
 * 为什么要它：菜单那两张背景图上的「列表框」是画出来的，框的内区边界既不在
 * Java 源码里、也不在任何真值里 —— 它只在像素里。滚动条一屏放得下几行由它
 * 决定（`menu/scroll.ts`），而把量出来的数字抄成常量、再在注释里写一句
 * 「量过了」，与没量过长得一模一样。这个解码器让那次测量**每跑一次测试就重做
 * 一遍**：图换了、常量抄错了，立刻红。
 *
 * 只支持这两张图真实的格式：**8 位、色彩类型 6（RGBA）、非隔行**。别的一律抛
 * —— 悄悄按别的格式解出来的是一张看似合理的噪声图，而"扫不到边界"与"边界
 * 变了"分不开。
 *
 * ⚠️ 它读的是 `sources/` 下的**原始素材**（入库的，640 个文件），不是烘焙产物：
 * 产物是 WebP，而 WebP 要解码得引一个库。原始素材与产物同源（`bake.ts` 的
 * `-lossless`），量框的边界用哪一份都一样。
 */
export interface Bitmap {
  readonly width: number
  readonly height: number
  /** RGBA，每像素 4 字节，行优先。 */
  readonly data: Uint8Array
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function decodePng(bytes: Uint8Array): Bitmap {
  for (const [i, want] of SIGNATURE.entries()) {
    if (bytes[i] !== want) throw new Error('不是 PNG：文件头对不上')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 8
  let width = 0
  let height = 0
  const idat: Uint8Array[] = []
  while (pos + 8 <= bytes.length) {
    const length = view.getUint32(pos)
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8))
    const bodyAt = pos + 8
    const body = bytes.subarray(bodyAt, bodyAt + length)
    pos = bodyAt + length + 4
    if (type === 'IHDR') {
      width = view.getUint32(bodyAt)
      height = view.getUint32(bodyAt + 4)
      const [depth, colorType, interlace] = [body[8]!, body[9]!, body[12]!]
      if (depth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error(`只认 8 位 RGBA 非隔行 PNG，这张是 depth=${depth} color=${colorType} interlace=${interlace}`)
      }
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
  }
  if (width === 0 || height === 0) throw new Error('PNG 里没有 IHDR')
  if (idat.length === 0) throw new Error('PNG 里没有 IDAT')

  const raw = new Uint8Array(inflateSync(Buffer.concat(idat)))
  const bpp = 4
  const stride = width * bpp
  if (raw.length < height * (stride + 1)) {
    throw new Error(`IDAT 解出来只有 ${raw.length} 字节，${width}×${height} 要 ${height * (stride + 1)}`)
  }
  const data = new Uint8Array(width * height * bpp)
  let prev = new Uint8Array(stride)
  let p = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[p]!
    p += 1
    const line = raw.slice(p, p + stride)
    p += stride
    unfilter(filter, line, prev, bpp)
    data.set(line, y * stride)
    prev = line
  }
  return { width, height, data }
}

/** PNG 的五种行过滤器（RFC 2083 §6）。 */
function unfilter(filter: number, line: Uint8Array, prev: Uint8Array, bpp: number): void {
  const n = line.length
  switch (filter) {
    case 0:
      return
    case 1:
      for (let i = bpp; i < n; i++) line[i] = (line[i]! + line[i - bpp]!) & 0xff
      return
    case 2:
      for (let i = 0; i < n; i++) line[i] = (line[i]! + prev[i]!) & 0xff
      return
    case 3:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp]! : 0
        line[i] = (line[i]! + ((a + prev[i]!) >> 1)) & 0xff
      }
      return
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp]! : 0
        const c = i >= bpp ? prev[i - bpp]! : 0
        const b = prev[i]!
        const guess = a + b - c
        const da = Math.abs(guess - a)
        const db = Math.abs(guess - b)
        const dc = Math.abs(guess - c)
        const pick = da <= db && da <= dc ? a : db <= dc ? b : c
        line[i] = (line[i]! + pick) & 0xff
      }
      return
    default:
      throw new Error(`PNG 行过滤器 ${filter} 不认识`)
  }
}

/** 一个像素的亮度（ITU-R BT.601 的整数近似，与量的时候那个脚本同一条式子）。 */
export function luminance(bmp: Bitmap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= bmp.width || y >= bmp.height) {
    throw new Error(`(${x},${y}) 在 ${bmp.width}×${bmp.height} 之外`)
  }
  const i = (y * bmp.width + x) * 4
  return Math.floor((bmp.data[i]! * 299 + bmp.data[i + 1]! * 587 + bmp.data[i + 2]! * 114) / 1000)
}

/**
 * 从一个种子点出发，把它所在的那一片**暗区**沿横竖两个方向走到头 ——
 * 也就是列表框的内区（框线是亮的，框里是暗的）。
 *
 * 种子点必须落在暗区里，否则抛：从亮处出发会得到一个"整行都不暗"的空区间，
 * 而那与"框不见了"长得一样。
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
