import { deflateSync, inflateSync } from 'node:zlib'

/**
 * 一张解码后的位图。`rgba` 是行优先的 4 通道字节，长度恒为 `width * height * 4`。
 */
export interface Bitmap {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

/**
 * 最小 PNG 解码器 —— 只为跨端逐帧比对服务，**不是通用解码器**。
 *
 * 为什么自己写而不是装一个包：两端的帧只有两个生产者，Java 的 `ImageIO`（8 位
 * 真彩，无 alpha）与 Chrome 的 `Page.captureScreenshot`（8 位真彩带 alpha），
 * 形状是已知且窄的。装一个通用解码器换来的是一条新依赖和"它到底怎么处理
 * 我们这两种输入"的新问题。
 *
 * 关键取舍：**不认识的形状一律抛异常，绝不"尽力而为"**。位深 16、调色板、
 * 隔行扫描，任何一种被悄悄降级处理，比对出来的差异都会是解码器的差异而不是
 * 渲染的差异 —— 而那种错误看起来完全像一次真实的回归。
 */
export function decodePng(bytes: Uint8Array): Bitmap {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error('不是 PNG：文件头对不上')
  }

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  const idat: Uint8Array[] = []

  let p = 8
  while (p + 8 <= bytes.length) {
    const length = view.getUint32(p)
    const type = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!)
    const body = bytes.subarray(p + 8, p + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(p + 8)
      height = view.getUint32(p + 12)
      bitDepth = bytes[p + 16]!
      colorType = bytes[p + 17]!
      const interlace = bytes[p + 20]!
      if (bitDepth !== 8) throw new Error(`只支持 8 位 PNG，这张是 ${bitDepth} 位`)
      if (colorType !== 2 && colorType !== 6) {
        throw new Error(`只支持真彩 PNG（colorType 2/6），这张是 ${colorType}`)
      }
      if (interlace !== 0) throw new Error('不支持隔行扫描的 PNG')
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    p += 12 + length
  }
  if (colorType < 0) throw new Error('PNG 里没有 IHDR')
  if (idat.length === 0) throw new Error('PNG 里没有 IDAT')

  const channels = colorType === 6 ? 4 : 3
  const raw = new Uint8Array(inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c)))))
  const stride = width * channels
  const expected = (stride + 1) * height
  if (raw.length !== expected) {
    throw new Error(`PNG 解压后是 ${raw.length} 字节，按 ${width}×${height} 应为 ${expected}`)
  }

  const lines = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const src = y * (stride + 1) + 1
    const dst = y * stride
    const up = dst - stride
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!
      const a = i >= channels ? lines[dst + i - channels]! : 0
      const b = y > 0 ? lines[up + i]! : 0
      const c = y > 0 && i >= channels ? lines[up + i - channels]! : 0
      let value: number
      switch (filter) {
        case 0: value = x; break
        case 1: value = x + a; break
        case 2: value = x + b; break
        case 3: value = x + ((a + b) >> 1); break
        case 4: value = x + paeth(a, b, c); break
        default: throw new Error(`第 ${y} 行的滤镜是 ${filter}，PNG 只定义了 0..4`)
      }
      lines[dst + i] = value & 0xff
    }
  }

  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0, o = 0, s = 0; i < width * height; i++, o += 4, s += channels) {
    rgba[o] = lines[s]!
    rgba[o + 1] = lines[s + 1]!
    rgba[o + 2] = lines[s + 2]!
    rgba[o + 3] = channels === 4 ? lines[s + 3]! : 255
  }
  return { width, height, rgba }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/**
 * 最小 PNG 编码器：8 位 RGBA、无隔行、每行滤镜 0。
 *
 * 只用来写**差异图**（人要看的那张），不追求体积；用滤镜 0 是为了让编码器本身
 * 无从出错 —— 差异图要是自己画错了，读它的人会去改渲染。
 */
export function encodePng(bitmap: Bitmap): Uint8Array {
  const { width, height, rgba } = bitmap
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    )
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'latin1')
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0)
  return Buffer.concat([head, body, tail])
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = -1
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return c ^ -1
}
