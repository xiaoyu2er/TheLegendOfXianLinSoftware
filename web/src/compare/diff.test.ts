import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TOLERANCE, diffImage, frameDiff, summarize } from './diff'
import type { FrameResult } from './diff'
import { decodePng, encodePng } from './png'
import type { Bitmap } from './png'

/**
 * 比对引擎自己的测试。
 *
 * 这一层的失败模式非常具体：**判据没有诊断力**。本项目已经付过一次学费 ——
 * 战斗截图用 MD5 判"唯一帧"，报出"60/60 唯一、没问题"，而实际上九成的帧是
 * 废的。所以这里每一条用例都在问同一个问题：**坏的和好的长得一样吗**。
 */
describe('逐帧比对的判据', () => {
  it('两张一样的图：差异为 0，包围盒为空', () => {
    const a = noise(64, 48, 1)
    const d = frameDiff(a, clone(a))
    expect(d.differing).toBe(0)
    expect(d.ratio).toBe(0)
    expect(d.maxDelta).toBe(0)
    expect(d.box).toBeNull()
  })

  it('改坏一个 8×8 的块：像素数、占比、包围盒都指得出是哪一块', () => {
    const a = noise(64, 48, 2)
    const b = clone(a)
    paint(b, 10, 20, 8, 8, [255, 0, 255])
    const d = frameDiff(a, b)
    // 分母写死成 8×8 = 64：多算一个像素或少算一个都要响。
    expect(d.differing).toBe(64)
    expect(d.ratio).toBeCloseTo(64 / (64 * 48), 10)
    expect(d.box).toEqual({ x0: 10, y0: 20, x1: 17, y1: 27 })
    expect(d.maxDelta).toBeGreaterThan(DEFAULT_TOLERANCE)
  })

  it('容差是"小于等于不算"：正好等于容差的差值不计，多 1 就计', () => {
    const a = solid(4, 4, [100, 100, 100])
    expect(frameDiff(a, solid(4, 4, [100 + DEFAULT_TOLERANCE, 100, 100])).differing).toBe(0)
    expect(frameDiff(a, solid(4, 4, [100 + DEFAULT_TOLERANCE + 1, 100, 100])).differing).toBe(16)
  })

  it('alpha 不参与比较：Java 位图不带 alpha，浏览器截图恒为 255', () => {
    const a = solid(4, 4, [10, 20, 30])
    const b = clone(a)
    for (let i = 3; i < b.rgba.length; i += 4) b.rgba[i] = 0
    expect(frameDiff(a, b).differing).toBe(0)
  })

  it('尺寸不同是硬失败，不是"差异很大"', () => {
    expect(() => frameDiff(solid(4, 4, [0, 0, 0]), solid(4, 5, [0, 0, 0]))).toThrow(/尺寸不同/)
  })

  it('差异图把偏离的像素涂成洋红，其余压暗', () => {
    const a = solid(2, 1, [200, 200, 200])
    const b = clone(a)
    paint(b, 1, 0, 1, 1, [0, 0, 0])
    const img = diffImage(a, b)
    expect([...img.rgba.subarray(0, 4)]).toEqual([50, 50, 50, 255])
    expect([...img.rgba.subarray(4, 8)]).toEqual([255, 0, 255, 255])
  })
})

describe('一条剧本的结论', () => {
  /** 分母：一条剧本 12 帧。改坏第几帧，报告就要指出第几帧。 */
  const FRAMES = 12

  it('全过：没有偏离帧，首个偏离帧号为 null', () => {
    const seq = summarize(sequence(FRAMES, null), 0.001)
    expect(seq.frames).toBe(FRAMES)
    expect(seq.divergent).toEqual([])
    expect(seq.firstDivergent).toBeNull()
  })

  it('故意改坏第 7 帧：报红，并指出就是第 7 帧', () => {
    const seq = summarize(sequence(FRAMES, 7), 0.001)
    expect(seq.frames).toBe(FRAMES)
    expect(seq.firstDivergent).toBe(7)
    expect(seq.divergent).toEqual([7])
    expect(seq.worst.tick).toBe(7)
  })

  it('阈值以下的抖动不算偏离 —— 否则有损资产会让每一帧都红', () => {
    const results: FrameResult[] = Array.from({ length: FRAMES }, (_, tick) => ({
      tick,
      differing: 10,
      ratio: 0.0005,
      maxDelta: 12,
      box: { x0: 0, y0: 0, x1: 3, y1: 3 },
    }))
    expect(summarize(results, 0.001).firstDivergent).toBeNull()
  })

  it('一帧都没比是硬失败，不是通过', () => {
    expect(() => summarize([], 0.001)).toThrow(/一帧都没有比/)
  })
})

describe('PNG 编解码', () => {
  it('编码再解码回到同一张图', () => {
    const a = noise(37, 19, 3)
    expect([...decodePng(encodePng(a)).rgba]).toEqual([...a.rgba])
  })

  it('五种行滤镜都解得对 —— ImageIO 会挑着用，解错了就是一次假的回归', () => {
    const a = noise(16, 5, 4)
    // 分母是 PNG 规范定义的 5 种滤镜；每一行用一种。
    const filters = [0, 1, 2, 3, 4]
    expect(filters).toHaveLength(a.height)
    expect([...decodePng(encodeWithFilters(a, filters)).rgba]).toEqual([...a.rgba])
  })

  it('位深 16 / 隔行扫描一律抛异常，不"尽力而为"', () => {
    const png = encodePng(noise(4, 4, 5))
    const deep = Uint8Array.from(png)
    deep[24] = 16 // IHDR 的 bitDepth
    expect(() => decodePng(deep)).toThrow(/8 位/)
    const laced = Uint8Array.from(png)
    laced[28] = 1 // IHDR 的 interlace
    expect(() => decodePng(laced)).toThrow(/隔行/)
  })
})

// ================= 夹具 =================

function solid(width: number, height: number, rgb: readonly number[]): Bitmap {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = rgb[0]!
    rgba[i + 1] = rgb[1]!
    rgba[i + 2] = rgb[2]!
    rgba[i + 3] = 255
  }
  return { width, height, rgba }
}

/** 确定性的伪随机图。种子固定，两次跑出来一样。 */
function noise(width: number, height: number, seed: number): Bitmap {
  const rgba = new Uint8Array(width * height * 4)
  let s = Math.imul(seed, 2654435761) & 0x7fffffff
  for (let i = 0; i < rgba.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff
      rgba[i + c] = (s >> 16) & 0xff
    }
    rgba[i + 3] = 255
  }
  return { width, height, rgba }
}

function clone(b: Bitmap): Bitmap {
  return { width: b.width, height: b.height, rgba: Uint8Array.from(b.rgba) }
}

function paint(b: Bitmap, x: number, y: number, w: number, h: number, rgb: readonly number[]): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const i = ((y + dy) * b.width + x + dx) * 4
      b.rgba[i] = rgb[0]!
      b.rgba[i + 1] = rgb[1]!
      b.rgba[i + 2] = rgb[2]!
    }
  }
}

function sequence(frames: number, brokenTick: number | null): FrameResult[] {
  return Array.from({ length: frames }, (_, tick) => {
    const broken = tick === brokenTick
    return {
      tick,
      differing: broken ? 4096 : 0,
      ratio: broken ? 0.05 : 0,
      maxDelta: broken ? 255 : 0,
      box: broken ? { x0: 0, y0: 0, x1: 63, y1: 63 } : null,
    }
  })
}

/**
 * 按指定的每行滤镜编码一张 RGBA PNG。只在测试里用 —— 生产编码器恒用滤镜 0，
 * 而 `ImageIO` 会逐行挑，解码器必须五种全认。
 */
function encodeWithFilters(b: Bitmap, filters: readonly number[]): Uint8Array {
  const stride = b.width * 4
  const raw = Buffer.alloc((stride + 1) * b.height)
  for (let y = 0; y < b.height; y++) {
    const f = filters[y]!
    raw[y * (stride + 1)] = f
    for (let i = 0; i < stride; i++) {
      const cur = b.rgba[y * stride + i]!
      const a = i >= 4 ? b.rgba[y * stride + i - 4]! : 0
      const up = y > 0 ? b.rgba[(y - 1) * stride + i]! : 0
      const c = y > 0 && i >= 4 ? b.rgba[(y - 1) * stride + i - 4]! : 0
      const sub =
        f === 0 ? cur
        : f === 1 ? cur - a
        : f === 2 ? cur - up
        : f === 3 ? cur - ((a + up) >> 1)
        : cur - paethRef(a, up, c)
      raw[y * (stride + 1) + 1 + i] = sub & 0xff
    }
  }
  const png = encodePng(b)
  // 换掉 IDAT 的内容：头尾照抄生产编码器，只有像素数据是本函数造的。
  return replaceIdat(png, deflateSync(raw))
}

function paethRef(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

function replaceIdat(png: Uint8Array, body: Buffer): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let p = 8
  while (p + 8 <= png.length) {
    const length = view.getUint32(p)
    const type = Buffer.from(png.subarray(p + 4, p + 8)).toString('latin1')
    if (type === 'IDAT') {
      const head = Buffer.alloc(8)
      head.writeUInt32BE(body.length, 0)
      head.write('IDAT', 4, 'latin1')
      const tail = Buffer.alloc(4)
      tail.writeUInt32BE(crc32Ref(Buffer.concat([head.subarray(4), body])) >>> 0, 0)
      return new Uint8Array(
        Buffer.concat([
          Buffer.from(png.subarray(0, p)),
          head,
          body,
          tail,
          Buffer.from(png.subarray(p + 12 + length)),
        ]),
      )
    }
    p += 12 + length
  }
  throw new Error('夹具：PNG 里没有 IDAT')
}

function crc32Ref(buf: Buffer): number {
  let c = -1
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return c ^ -1
}
