import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../../test/repoPath'
import { nearestBlitRuns, nearestSourceIndexes } from './scaledBlit'

/**
 * 黄金测试：这里算出来的采样表与**真的 Java2D** 扫出来的逐个相同。
 *
 * 期望值不是这里写的，是 `tools/export-scaled-blit.sh` 用一张梯度图从 Java2D
 * 自己身上量出来的（`tools/src/devtools/ExportScaledBlit.java`），所以不是自己
 * 出题自己判卷。
 *
 * 判据要挡住四种「看起来通过」：
 *
 * 1. **黄金数据读不到 / 是空的**。分母不是写死的常量，是从文件里数出来的
 *    （`map.length - 1`），而下面「覆盖范围」那一条要求它至少到源长的两倍；
 *    空表在那里就红，不会安静地跑零轮。
 * 2. **对错了那一张表**。黄金数据里有两张：源图带透明与全不透明各一份，Java2D
 *    对这两种走的是不同的 blit 循环。提示图全都带透明，所以复刻必须对上
 *    `transparent` 那张；「两张表确实不同，而且我们用的是带透明那张」单列一条，
 *    对上另一张就红。
 * 3. **表对了但用不上**。`nearestBlitRuns` 是渲染器真正照着搬像素的那份，
 *    所以它要还原回同一张表，而不是只测那个下标函数。
 * 4. **退回 GPU 的那套四舍五入**。「打平的位置」单列一条：提示图那两个真的会
 *    用到的目标长度上，`floor(k*i + k/2)`（GPU 最近邻的算法）与 Java 不一致的
 *    位置在这里被点名，改回去就红。
 */

const GOLDEN_PATH = 'tools/scaled-blit-golden/java-scaled-blit.json'

type Axis = { srcLen: number; map: number[][] }
type Tables = { x: Axis; y: Axis }
type Golden = { note: string; transparent: Tables; opaque: Tables }

const golden = JSON.parse(readFileSync(repoPath(GOLDEN_PATH), 'utf8')) as Golden

/** 复刻要对上的那一张：提示图带透明。 */
const USED = golden.transparent

const AXES: [string, Axis][] = [
  ['X（源 128 宽）', USED.x],
  ['Y（源 24 高）', USED.y],
]

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
      expect(nearestSourceIndexes(axis.srcLen, destLen)).toEqual(axis.map[destLen])
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
    for (const destLen of got) {
      expect(nearestSourceIndexes(128, destLen)).toEqual(golden.transparent.x.map[destLen])
      expect(nearestSourceIndexes(128, destLen)).not.toEqual(golden.opaque.x.map[destLen])
    }
  })

  it('Y 上两张表差在这些目标长度，其中 10 是提示图真的会走到的一档', () => {
    const got = differing(golden.transparent.y, golden.opaque.y)
    expect(got).toContain(10)
    for (const destLen of got) {
      expect(nearestSourceIndexes(24, destLen)).toEqual(golden.transparent.y.map[destLen])
      expect(nearestSourceIndexes(24, destLen)).not.toEqual(golden.opaque.y.map[destLen])
    }
  })
})

describe('nearestBlitRuns', () => {
  it.each(AXES)('%s 的区间还原回同一张表', (_name, axis) => {
    for (let destLen = 1; destLen < axis.map.length; destLen++) {
      const flat: number[] = []
      for (const run of nearestBlitRuns(axis.srcLen, destLen)) {
        expect(run.destStart).toBe(flat.length)
        expect(run.length).toBeGreaterThan(0)
        for (let k = 0; k < run.length; k++) flat.push(run.srcIndex)
      }
      expect(flat).toEqual(axis.map[destLen])
    }
  })

  it('放大时一个源像素铺成一段', () => {
    const runs = nearestBlitRuns(24, 48)
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
    expect(disagreements(USED.x, 80)).toEqual(expected)
    for (const i of expected) expect(USED.x.map[80]![i]).toBe(gpu(128, 80, i) - 1)
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
    expect(ties(USED.y, 2)).toEqual({ up: 2, down: 0 })
    expect(ties(USED.y, 10)).toEqual({ up: 0, down: 2 })
  })

  it('不透明那条循环更进一步：同一档里两个方向都有', () => {
    // 这不是复刻要走的那条路（提示图全带透明），列在这里是因为它是「平局不是
    // 一条能凑的规则」最硬的那个证据，而且它是数据不是转述。
    const tiesOf = (axis: Axis, destLen: number) => ties(axis, destLen)
    expect(tiesOf(golden.opaque.x, 20)).toEqual({ up: 1, down: 3 })
    expect(tiesOf(golden.opaque.y, 10)).toEqual({ up: 1, down: 1 })
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
    expect(() => nearestSourceIndexes(srcLen, destLen)).toThrow(/正整数/)
  })

  it('源长超出量过的范围要响，而不是编一个答案', () => {
    expect(() => nearestSourceIndexes(256, 100)).toThrow(/量过/)
  })
})
