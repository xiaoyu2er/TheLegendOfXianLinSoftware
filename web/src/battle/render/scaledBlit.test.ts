import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../../test/repoPath'
import { softBlit } from '../../test/softBlit'
import {
  blitShift,
  measuredThumbnailSources,
  nearestBlitRuns,
  nearestSourceIndexes,
  opaqueSourceIndexes,
  scaledBlitPasses,
} from './scaledBlit'
import type { BlitExtent, BlitLoop, BlitRect } from './scaledBlit'

/**
 * 黄金测试：这里算出来的采样表与**真的 Java2D** 扫出来的逐个相同。
 *
 * 期望值不是这里写的，是 `tools/export-scaled-blit.sh` 用梯度图从 Java2D 自己身上量
 * 出来的（`tools/src/devtools/ExportScaledBlit.java`），所以不是自己出题自己判卷。
 *
 * 判据要挡住这几种「看起来通过」：
 *
 * 1. **黄金数据读不到 / 是空的**。分母不是写死的常量，是从文件里数出来的
 *    （`map.length - 1`），而「覆盖范围」那几条要求它至少到约定的长度；空表在那里就红，
 *    不会安静地跑零轮。
 * 2. **对错了那一张表**。每批都有两张：源图带透明与全不透明，Java2D 对这两种走的是
 *    不同的 blit 循环。「两张表确实不同」单列，否则「对上某一张」是恒真的。
 * 3. **表对了但用不上**。`nearestBlitRuns` 是渲染器真正照着搬像素的那份，所以它要
 *    还原回同一张表，而不是只测那个下标函数。
 * 4. **退回 GPU 的那套四舍五入**。「打平的位置」单列一条。
 * 5. **退回旧的常数位数**（xl-cpo）。「带透明 16 位 / 不透明 23 位」在两轴扫描上一处不差，
 *    所以只拿两轴扫描核是看不出来的；缩略图那一批里有两处专门钉它（纵轴跟着横轴的源宽变、
 *    大迷宫那一对），见「定点位数由源尺寸定」。
 */

const GOLDEN_PATH = 'tools/scaled-blit-golden/java-scaled-blit.json'

type Axis = { srcLen: number; map: number[][] }
type Tables = { x: Axis; y: Axis }
type Pair = { x: number[]; y: number[] }
type Sized = { width: number; height: number }
type ThumbSize = Sized & { transparent: Pair; opaque: Pair }
type Sweep = Sized & { transparent: { x: number[][]; y: number[][] }; opaque: { x: number[][]; y: number[][] } }
type Check = Sized & { destWidth: number; destHeight: number; transparent: Pair; opaque: Pair }
type Verdict = { loop: string; compared: number; distinguishing: number }
type ThumbMap = Sized & {
  name: string
  alphaChannel: boolean
  minAlpha: number
  loop: 'transparent' | 'opaque' | 'either' | 'unknown'
  atThumbnail: Verdict
  atProbe: (Verdict & Sized) | null
}
type Golden = {
  note: string
  transparent: Tables
  opaque: Tables
  thumbnail: {
    dest: { x: number; y0: number; stride: number; width: number; height: number }
    sizes: ThumbSize[]
    sweeps: Sweep[]
    checks: Check[]
    maps: ThumbMap[]
  }
}

const golden = JSON.parse(readFileSync(repoPath(GOLDEN_PATH), 'utf8')) as Golden

/** 两轴扫描那一批：源图 128×24（提示图）。 */
const SWEEP_EXTENT: BlitExtent = { width: golden.transparent.x.srcLen, height: golden.transparent.y.srcLen }

/** 复刻要对上的那一张：提示图带透明。 */
const TRANSPARENT = golden.transparent

const AXES: [string, Axis][] = [
  ['X（源 128 宽）', TRANSPARENT.x],
  ['Y（源 24 高）', TRANSPARENT.y],
]

const indexes = (loop: BlitLoop, srcLen: number, destLen: number, extent: BlitExtent): number[] =>
  loop === 'opaque' ? opaqueSourceIndexes(srcLen, destLen, extent) : nearestSourceIndexes(srcLen, destLen, extent)

describe('黄金数据本身', () => {
  it.each(AXES)('%s 的覆盖范围至少到源长的两倍', (_name, axis) => {
    expect(axis.srcLen).toBeGreaterThan(0)
    // `map[0]` 是占位的空表，真正的目标长度从 1 起。
    expect(axis.map.length - 1).toBeGreaterThanOrEqual(axis.srcLen * 2)
  })

  it.each(AXES)('%s 在目标长 = 源长时是恒等映射', (_name, axis) => {
    const identity = Array.from({ length: axis.srcLen }, (_, i) => i)
    expect(axis.map[axis.srcLen]).toEqual(identity)
  })

  it.each(AXES)('%s 每张表的长度就是它的目标长度', (_name, axis) => {
    for (let destLen = 1; destLen < axis.map.length; destLen++) {
      expect(axis.map[destLen]).toHaveLength(destLen)
    }
  })
})

describe('nearestSourceIndexes 与 Java2D 逐个相同', () => {
  it.each(AXES)('%s 的每一个目标长度', (_name, axis) => {
    for (let destLen = 1; destLen < axis.map.length; destLen++) {
      expect(nearestSourceIndexes(axis.srcLen, destLen, SWEEP_EXTENT)).toEqual(axis.map[destLen])
    }
  })
})

/**
 * 源图透不透明会换一条 blit 循环。这一条钉住两件事：两张表**真的不同**（否则
 * 上面那条「对上 transparent」是恒真的），以及**复刻对的是带透明那张**。
 */
describe('两条 blit 循环', () => {
  const differing = (a: Axis, b: Axis): number[] => {
    const out: number[] = []
    for (let destLen = 1; destLen < a.map.length; destLen++) {
      if (JSON.stringify(a.map[destLen]) !== JSON.stringify(b.map[destLen])) out.push(destLen)
    }
    return out
  }

  it('X 上两张表差在这些目标长度，其中 20 是提示图真的会走到的一档', () => {
    const got = differing(golden.transparent.x, golden.opaque.x)
    expect(got).toContain(20)
    expect(got.length).toBeGreaterThan(0)
    // 复刻跟的是带透明那张：在这些档上它必须对上 transparent、对不上 opaque。
    const srcLen = golden.transparent.x.srcLen
    for (const destLen of got) {
      expect(nearestSourceIndexes(srcLen, destLen, SWEEP_EXTENT)).toEqual(golden.transparent.x.map[destLen])
      expect(nearestSourceIndexes(srcLen, destLen, SWEEP_EXTENT)).not.toEqual(golden.opaque.x.map[destLen])
    }
  })

  it('Y 上两张表差在这些目标长度，其中 10 是提示图真的会走到的一档', () => {
    const got = differing(golden.transparent.y, golden.opaque.y)
    expect(got).toContain(10)
    const srcLen = golden.transparent.y.srcLen
    for (const destLen of got) {
      expect(nearestSourceIndexes(srcLen, destLen, SWEEP_EXTENT)).toEqual(golden.transparent.y.map[destLen])
      expect(nearestSourceIndexes(srcLen, destLen, SWEEP_EXTENT)).not.toEqual(golden.opaque.y.map[destLen])
    }
  })
})

/**
 * 不透明那条循环（xl-03x.15，旁白背景 639×395 全不透明）。两轴扫描的 `opaque`
 * 表此前只用来证明「两条循环不一样」，现在它是 `opaqueSourceIndexes` 的判据。
 */
describe('opaqueSourceIndexes 与不透明那条循环逐个相同', () => {
  it.each([
    ['X（源 128 宽）', golden.opaque.x],
    ['Y（源 24 高）', golden.opaque.y],
  ] as [string, Axis][])('%s 的每一个目标长度', (_name, axis) => {
    for (let destLen = 1; destLen < axis.map.length; destLen++) {
      expect(opaqueSourceIndexes(axis.srcLen, destLen, SWEEP_EXTENT)).toEqual(axis.map[destLen])
    }
  })

  it('扫描范围之外只认量过的那几对，别的照样响', () => {
    const narr = { width: 639, height: 395 }
    expect(opaqueSourceIndexes(639, 1024, narr)).toHaveLength(1024)
    expect(opaqueSourceIndexes(395, 640, narr)).toHaveLength(640)
    expect(() => opaqueSourceIndexes(639, 1023, narr)).toThrow(/量过/)
    expect(() => opaqueSourceIndexes(395, 641, narr)).toThrow(/量过/)
    // 同一个源长，换一张没登记的源图（位数就换了）也不给答案。
    expect(() => opaqueSourceIndexes(639, 1024, { width: 639, height: 640 })).toThrow(/量过/)
  })

  it('scaledBlitPasses 按 loop 分派，不透明那条对上 opaque 表', () => {
    const passes = scaledBlitPasses({ x: 0, y: 0, width: 128, height: 24 }, { width: 20, height: 10 }, 'opaque')
    const flat = passes.horizontal.flatMap((r) => Array.from({ length: r.dw }, () => r.sx))
    expect(flat).toEqual(golden.opaque.x.map[20])
    expect(flat).not.toEqual(golden.transparent.x.map[20])
  })
})

/**
 * **存读档缩略图那一批**（xl-cpo）：`drawImage(img, 100, 100+i*200, 150, 100)`，
 * `maps/` 下每一种尺寸、两条循环各一张表，外加三个样例槽源图的缩小扫描与单列的一对。
 */
describe('存读档缩略图：缩小区间', () => {
  const T = golden.thumbnail
  const sceneMaps = sceneMapNames()

  it('黄金数据量的是原版那一句的几何', () => {
    expect(T.dest).toEqual({ x: 100, y0: 100, stride: 200, width: 150, height: 100 })
  })

  it('maps/ 下每一张图都有判定，每一种尺寸都有两张表', () => {
    const onDisk = readdirSync(repoPath('maps')).sort()
    expect(T.maps.map((m) => m.name).sort()).toEqual(onDisk)
    expect(onDisk.length).toBeGreaterThan(0)
    const sizes = new Set(T.sizes.map((s) => `${s.width}x${s.height}`))
    for (const m of T.maps) expect(sizes).toContain(`${m.width}x${m.height}`)
    for (const s of T.sizes) {
      for (const loop of ['transparent', 'opaque'] as const) {
        expect(s[loop].x).toHaveLength(T.dest.width)
        expect(s[loop].y).toHaveLength(T.dest.height)
      }
    }
  })

  // 模型本身（不经护栏）对每一种尺寸 —— 包括那些放大的小图标 —— 都要对上：这是「拟合
  // 能不能外推到这里」那一问的答案，分母是 maps/ 下的全部尺寸。
  it.each(['transparent', 'opaque'] as const)('%s：每一种尺寸画成 150×100 的两张表都与模型逐个相同', (loop) => {
    let n = 0
    for (const s of T.sizes) {
      expect(model(loop, s.width, 150, s)).toEqual(s[loop].x)
      expect(model(loop, s.height, 100, s)).toEqual(s[loop].y)
      n++
    }
    expect(n).toBe(T.sizes.length)
    expect(n).toBeGreaterThan(0)
  })

  it('三个样例槽的源图各有一批缩小扫描（横 1..150、纵 1..100），与模型逐个相同', () => {
    const samples = sampleSlotMapSizes()
    expect(samples.length).toBeGreaterThan(0)
    for (const size of samples) {
      const sweep = T.sweeps.find((s) => s.width === size.width && s.height === size.height)
      expect(sweep, `${size.width}×${size.height} 没有扫描`).toBeDefined()
      for (const loop of ['transparent', 'opaque'] as const) {
        expect(sweep![loop].x.length - 1).toBe(150)
        expect(sweep![loop].y.length - 1).toBe(100)
        for (let d = 1; d <= 150; d++) expect(model(loop, size.width, d, size)).toEqual(sweep![loop].x[d])
        for (let d = 1; d <= 100; d++) expect(model(loop, size.height, d, size)).toEqual(sweep![loop].y[d])
      }
    }
  })

  it('单列的那几对也与模型逐个相同', () => {
    expect(T.checks.length).toBeGreaterThan(0)
    for (const c of T.checks) {
      for (const loop of ['transparent', 'opaque'] as const) {
        expect(model(loop, c.width, c.destWidth, c)).toEqual(c[loop].x)
        expect(model(loop, c.height, c.destHeight, c)).toEqual(c[loop].y)
        // 带护栏的产品函数也要对上（这几对登记在 MEASURED_BLITS 里）：测试侧那份模型只在两轴
        // 扫描上与产品对齐过，而两轴扫描看不出「带透明退回 16 位」。
        expect(indexes(loop, c.width, c.destWidth, c)).toEqual(c[loop].x)
        expect(indexes(loop, c.height, c.destHeight, c)).toEqual(c[loop].y)
      }
    }
  })

  it('场景地图出现过的每一种尺寸都登记成量过，登记里也没有多余的', () => {
    const want = new Set(
      T.maps.filter((m) => sceneMaps.has(m.name)).map((m) => `${m.width}x${m.height}`),
    )
    const got = new Set(measuredThumbnailSources().map((s) => `${s.width}x${s.height}`))
    expect([...got].sort()).toEqual([...want].sort())
  })

  it('登记过的尺寸经护栏照常给答案，而且就是黄金表', () => {
    for (const src of measuredThumbnailSources()) {
      const s = T.sizes.find((x) => x.width === src.width && x.height === src.height)!
      const passes = scaledBlitPasses({ x: 0, y: 0, ...src }, { width: 150, height: 100 }, 'opaque')
      const flatX = passes.horizontal.flatMap((r) => Array.from({ length: r.dw }, () => r.sx))
      const flatY = passes.vertical.flatMap((r) => Array.from({ length: r.dh }, () => r.sy))
      expect(flatX).toEqual(s.opaque.x)
      expect(flatY).toEqual(s.opaque.y)
    }
  })
})

/**
 * 定点位数由源尺寸定（`31 - bitLength(宽 | 高)`），两条循环共用，只差半步那一下的取整。
 * 这两条专门挡「退回旧的常数位数」—— 两轴扫描对它是瞎的（见文件头第 5 条）。
 */
describe('定点位数由源尺寸定', () => {
  const T = golden.thumbnail
  const size = (w: number, h: number) => T.sizes.find((s) => s.width === w && s.height === h)!

  it('同是 640 → 100，纵轴的表跟着横轴的源宽变：1024×640 与 2048×640 第 2 行不同', () => {
    const a = size(1024, 640).opaque.y
    const b = size(2048, 640).opaque.y
    expect(a).not.toEqual(b)
    expect([a[2], b[2]]).toEqual([15, 16])
    expect(blitShift({ width: 1024, height: 640 })).not.toBe(blitShift({ width: 2048, height: 640 }))
    expect(model('opaque', 640, 100, { width: 1024, height: 640 })).toEqual(a)
    expect(model('opaque', 640, 100, { width: 2048, height: 640 })).toEqual(b)
  })

  it('带透明那条也不是常数 16 位：2865×699 → 233×253 上 16 位对不上，按源尺寸定的对得上', () => {
    const c = T.checks.find((x) => x.width === 2865 && x.height === 699)!
    const shift16 = (srcLen: number, destLen: number) => {
      const inc = Math.floor((srcLen * 2 ** 16) / destLen)
      const loc = Math.floor(inc / 2)
      return Array.from({ length: destLen }, (_, i) => Math.floor((loc + i * inc) / 2 ** 16))
    }
    expect(shift16(2865, 233)).not.toEqual(c.transparent.x)
    expect(shift16(699, 253)).not.toEqual(c.transparent.y)
    expect(model('transparent', 2865, 233, c)).toEqual(c.transparent.x)
  })

  it('两轴扫描那张源图（128×24）上位数恰好是 23', () => {
    expect(blitShift(SWEEP_EXTENT)).toBe(23)
  })
})

/**
 * **哪张图走哪条循环是跑出来的**：导出器把每张真地图照原版那一句画一遍，看它对上哪张表
 * （`atThumbnail`），150×100 上两张表相同答不出来时，再挑一个两条循环不同的尺寸画一遍
 * （`atProbe`）。这里核那份读数自己说得通，以及它支持的那条规律。
 */
describe('每张地图走哪条循环', () => {
  const T = golden.thumbnail
  const decisive = T.maps.filter((m) => m.loop === 'transparent' || m.loop === 'opaque')

  it('分得出来的，全部符合「真有一个像素不透明度 < 255 才走带透明那条」', () => {
    for (const m of decisive) {
      expect({ name: m.name, loop: m.loop }).toEqual({
        name: m.name,
        loop: m.minAlpha < 255 ? 'transparent' : 'opaque',
      })
    }
    // 两边都得有人，否则这条规律是恒真的。
    expect(decisive.filter((m) => m.loop === 'transparent').length).toBeGreaterThan(0)
    expect(decisive.filter((m) => m.loop === 'opaque').length).toBeGreaterThan(0)
  })

  it('带 alpha 通道、但每个像素都不透明的 PNG 走的是不透明那条（宿舍.png）', () => {
    const m = T.maps.find((x) => x.name === '宿舍.png')!
    expect({ alphaChannel: m.alphaChannel, minAlpha: m.minAlpha, loop: m.loop }).toEqual({
      alphaChannel: true,
      minAlpha: 255,
      loop: 'opaque',
    })
  })

  it('每个分得出来的判定背后都有至少一格两张表预言不同的像素', () => {
    for (const m of decisive) {
      const v = m.atThumbnail.loop === m.loop ? m.atThumbnail : m.atProbe!
      expect(v.loop).toBe(m.loop)
      expect(v.distinguishing).toBeGreaterThan(0)
    }
  })

  it('分不出来的（either），在缩略图 150×100 上两张表逐个相同 —— 画出来一样', () => {
    for (const m of T.maps.filter((x) => x.loop === 'either')) {
      const s = T.sizes.find((x) => x.width === m.width && x.height === m.height)!
      expect(s.transparent).toEqual(s.opaque)
    }
  })
})

describe('nearestBlitRuns', () => {
  it.each(AXES)('%s 的区间还原回同一张表', (_name, axis) => {
    for (let destLen = 1; destLen < axis.map.length; destLen++) {
      const flat: number[] = []
      for (const run of nearestBlitRuns(axis.srcLen, destLen, SWEEP_EXTENT)) {
        expect(run.destStart).toBe(flat.length)
        expect(run.length).toBeGreaterThan(0)
        for (let k = 0; k < run.length; k++) flat.push(run.srcIndex)
      }
      expect(flat).toEqual(axis.map[destLen])
    }
  })

  it('放大时一个源像素铺成一段', () => {
    const runs = nearestBlitRuns(24, 48, SWEEP_EXTENT)
    expect(runs).toHaveLength(24)
    for (const run of runs) expect(run.length).toBe(2)
  })
})

/**
 * 打平的位置：`k*i + k/2` 恰好落在整数上时，GPU 的最近邻取那个整数，Java2D
 * 未必 —— 而**方向随目标长度而变**，所以它凑不出一次平移。
 */
describe('纹素边界上的平局', () => {
  /** GPU 最近邻：目标像素中心 (i+0.5) 映回源，向下取整。 */
  const gpu = (srcLen: number, destLen: number, i: number): number =>
    Math.floor(((i + 0.5) * srcLen) / destLen)

  const disagreements = (axis: Axis, destLen: number): number[] => {
    const java = axis.map[destLen]!
    const out: number[] = []
    for (let i = 0; i < destLen; i++) {
      if (java[i] !== gpu(axis.srcLen, destLen, i)) out.push(i)
    }
    return out
  }

  it('128→80（t=125 那一帧的宽）上，两者差在周期 5 的那几列', () => {
    // 1.6i+0.8 是整数当且仅当 i ≡ 2 (mod 5)。
    const expected = [2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57, 62, 67, 72, 77]
    expect(disagreements(TRANSPARENT.x, 80)).toEqual(expected)
    for (const i of expected) expect(TRANSPARENT.x.map[80]![i]).toBe(gpu(128, 80, i) - 1)
  })

  /** 一个目标长度里，平局向上与向下各有几个。 */
  const ties = (axis: Axis, destLen: number): { up: number; down: number } => {
    const java = axis.map[destLen]!
    let up = 0
    let down = 0
    for (let i = 0; i < destLen; i++) {
      const exact = ((i + 0.5) * axis.srcLen) / destLen
      if (!Number.isInteger(exact)) continue
      if (java[i] === exact) up++
      else if (java[i] === exact - 1) down++
      else throw new Error(`目标长 ${destLen} 的第 ${i} 个既不是 ${exact} 也不是 ${exact - 1}`)
    }
    return { up, down }
  }

  it('带透明那条循环里，平局的方向由目标长度整体定 —— 同一档不混', () => {
    let seen = 0
    for (const [, axis] of AXES) {
      for (let destLen = 1; destLen < axis.map.length; destLen++) {
        const { up, down } = ties(axis, destLen)
        if (up + down === 0) continue
        seen++
        expect({ destLen, up, down }).toEqual(
          up > 0 ? { destLen, up, down: 0 } : { destLen, up: 0, down },
        )
      }
    }
    // 「一档平局都没有」会让上面那句恒真，所以分母也要断言。
    expect(seen).toBeGreaterThan(50)
  })

  it('可方向随目标长度而变，所以一次平移凑不出来', () => {
    // 提示图高度走过的那几档：Y=2 全部向上，Y=10 全部向下。一个 ε 只能把
    // 所有平局往同一边推，两者必有一边被推错。
    expect(ties(TRANSPARENT.y, 2)).toEqual({ up: 2, down: 0 })
    expect(ties(TRANSPARENT.y, 10)).toEqual({ up: 0, down: 2 })
  })

  it('不透明那条循环更进一步：同一档里两个方向都有', () => {
    // 这不是提示图要走的那条路（提示图全带透明），列在这里是因为它是「平局不是
    // 一条能凑的规则」最硬的那个证据，而且它是数据不是转述。
    expect(ties(golden.opaque.x, 20)).toEqual({ up: 1, down: 3 })
    expect(ties(golden.opaque.y, 10)).toEqual({ up: 1, down: 1 })
  })
})

/**
 * **两趟搬法搬出来的像素**，不是它调了几次 drawImage。
 *
 * `scaledBlitPasses` 是渲染器唯一的几何来源，而轴搞反、源偏移漏加、中间位图
 * 尺寸取错这几种错，在画面上都只表现为「有点糊」—— 谁都不会去查。
 * 这里拿一个十行的软件 blitter 把两趟真的跑一遍，结果必须逐像素等于采样表的
 * 外积：目标 (i,j) = 源 (mx[i], my[j])。
 */
describe('scaledBlitPasses 搬出来的像素', () => {
  interface Buf {
    width: number
    height: number
    px: Int32Array
  }
  const make = (width: number, height: number): Buf => ({
    width,
    height,
    px: new Int32Array(width * height).fill(-1),
  })
  const blit = (src: Buf, dst: Buf, r: BlitRect) => softBlit(src.px, src.width, dst.px, dst.width, r)

  const SRC_W = golden.transparent.x.srcLen
  const SRC_H = golden.transparent.y.srcLen

  /** 像素值就是自己的坐标，与导出器那张梯度图同一个招。 */
  const gradient = (): Buf => {
    const b = make(SRC_W, SRC_H)
    for (let y = 0; y < SRC_H; y++) for (let x = 0; x < SRC_W; x++) b.px[y * SRC_W + x] = y * 1000 + x
    return b
  }

  // 提示图真的会走到的那 12 档：`Reminder.update()` 每拍宽 +10、高 +2。
  const SIZES = Array.from({ length: 12 }, (_, n) => ({ width: 10 * (n + 1), height: 2 * (n + 1) }))

  it.each(SIZES)('目标 $width×$height 的每个像素都取到了采样表说的那个源像素', (dest) => {
    const src = gradient()
    const passes = scaledBlitPasses({ x: 0, y: 0, width: SRC_W, height: SRC_H }, dest)
    const mid = make(dest.width, SRC_H)
    for (const r of passes.horizontal) blit(src, mid, r)
    const out = make(dest.width, dest.height)
    for (const r of passes.vertical) blit(mid, out, r)

    const mx = golden.transparent.x.map[dest.width]!
    const my = golden.transparent.y.map[dest.height]!
    for (let j = 0; j < dest.height; j++) {
      for (let i = 0; i < dest.width; i++) {
        expect({ i, j, v: out.px[j * dest.width + i] }).toEqual({ i, j, v: my[j]! * 1000 + mx[i]! })
      }
    }
  })

  it('源在图集里有偏移时，两趟都跟着偏移', () => {
    const passes = scaledBlitPasses({ x: 7, y: 3, width: SRC_W, height: SRC_H }, { width: 20, height: 4 })
    // 第一趟从源图取，要带偏移；第二趟是从中间位图取，中间位图的原点就是 0。
    expect(passes.horizontal[0]!.sx).toBe(7 + golden.transparent.x.map[20]![0]!)
    expect(passes.horizontal[0]!.sy).toBe(3)
    expect(passes.vertical[0]!.sx).toBe(0)
    expect(passes.vertical[0]!.sy).toBe(golden.transparent.y.map[4]![0]!)
  })

  it('中间位图是「目标宽 × 源高」，两趟各只动一条轴', () => {
    const passes = scaledBlitPasses({ x: 0, y: 0, width: SRC_W, height: SRC_H }, { width: 30, height: 6 })
    for (const r of passes.horizontal) {
      expect({ sh: r.sh, dh: r.dh, sw: r.sw }).toEqual({ sh: SRC_H, dh: SRC_H, sw: 1 })
    }
    for (const r of passes.vertical) {
      expect({ sw: r.sw, dw: r.dw, sh: r.sh }).toEqual({ sw: 30, dw: 30, sh: 1 })
    }
  })
})

describe('说不清楚的输入要响', () => {
  it.each([
    [0, 10],
    [-1, 10],
    [1.5, 10],
    [10, 0],
    [10, -3],
    [10, 2.5],
  ])('源长 %s 目标长 %s', (srcLen, destLen) => {
    expect(() => nearestSourceIndexes(srcLen, destLen, { width: 10, height: 10 })).toThrow(/正整数/)
  })

  it('源长超出量过的范围要响，而不是编一个答案', () => {
    expect(() => nearestSourceIndexes(256, 100, { width: 256, height: 24 })).toThrow(/量过/)
  })

  it('源长既不是源图的宽也不是高，要响', () => {
    expect(() => nearestSourceIndexes(100, 50, SWEEP_EXTENT)).toThrow(/既不是/)
  })

  it('目标长超出扫过的范围（源长的两倍）同样要响', () => {
    const srcLen = TRANSPARENT.y.srcLen
    // 边界上那一档是扫过的，必须照常给答案；再多一个就是外推。
    expect(nearestSourceIndexes(srcLen, srcLen * 2, SWEEP_EXTENT)).toHaveLength(srcLen * 2)
    expect(() => nearestSourceIndexes(srcLen, srcLen * 2 + 1, SWEEP_EXTENT)).toThrow(/外推/)
  })
})

/**
 * 模型本身，**不经护栏**：黄金数据里有些尺寸（放大的小图标、扫描、单列的一对）不在任何
 * 调用方的登记里，护栏会拦 —— 而这里要问的恰恰是「模型在那些地方成立吗」。所以照文件头
 * 那段公式另写一遍，并且先与带护栏的那两个函数在两轴扫描上逐个对齐，免得两份各说各的。
 */
function model(loop: BlitLoop, srcLen: number, destLen: number, extent: BlitExtent): number[] {
  const shift = blitShift(extent)
  const one = 2 ** shift
  const inc = Math.floor((srcLen * one) / destLen)
  const loc = loop === 'opaque' ? Math.floor((inc + 1) / 2) : Math.floor(inc / 2)
  return Array.from({ length: destLen }, (_, i) => Math.floor((loc + i * inc) / one))
}

describe('测试里那份不经护栏的模型与产品代码是同一份', () => {
  it.each(['transparent', 'opaque'] as const)('%s：两轴扫描的每一个目标长度', (loop) => {
    for (const [srcLen, max] of [
      [128, 256],
      [24, 48],
    ] as const) {
      for (let d = 1; d <= max; d++) {
        expect(model(loop, srcLen, d, SWEEP_EXTENT)).toEqual(indexes(loop, srcLen, d, SWEEP_EXTENT))
      }
    }
  })
})

/** 数据层真值里出现过的场景地图名（96 本脚本的 `mapName`，现扫）。 */
function sceneMapNames(): Set<string> {
  const dir = repoPath('tools/ground-truth')
  const names = new Set<string>()
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    names.add((JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as { mapName: string }).mapName)
  }
  if (names.size === 0) throw new Error('数据层真值里一个场景地图名都没读到')
  return names
}

/** 三个入库样例存档第一行的地图名 → 它在缩略图那一批里的尺寸。 */
function sampleSlotMapSizes(): Sized[] {
  const dir = repoPath('tools/ground-truth/存档')
  const out: Sized[] = []
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const save = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as { reads: { line: number; fields: string[] }[] }
    const map = save.reads.find((r) => r.line === 1)!.fields[3]!
    const m = golden.thumbnail.maps.find((x) => x.name === map)
    if (!m) throw new Error(`${f} 的地图 ${map} 不在缩略图那一批里`)
    out.push({ width: m.width, height: m.height })
  }
  return out
}
