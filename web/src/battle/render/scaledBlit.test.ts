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
 * 判据要挡住三种「看起来通过」：
 *
 * 1. **黄金数据读不到 / 是空的**。分母不是写死的常量，是从文件里数出来的
 *    （`map.length - 1`），而下面「覆盖范围」那一条要求它至少到源长的两倍；
 *    空表在那里就红，不会安静地跑零轮。
 * 2. **表对了但用不上**。`nearestBlitRuns` 是渲染器真正照着搬像素的那份，
 *    所以它要还原回同一张表，而不是只测那个下标函数。
 * 3. **退回 GPU 的那套四舍五入**。「打平的位置」单列一条：提示图那两个真的会
 *    用到的目标长度上，`floor(k*i + k/2)`（GPU 最近邻的算法）与 Java 不一致的
 *    位置在这里被点名，改回去就红。
 */

const GOLDEN_PATH = 'tools/scaled-blit-golden/java-scaled-blit.json'

type Axis = { srcLen: number; map: number[][] }
type Golden = { note: string; x: Axis; y: Axis }

const golden = JSON.parse(readFileSync(repoPath(GOLDEN_PATH), 'utf8')) as Golden

const AXES: [string, Axis][] = [
  ['X（源 128 宽）', golden.x],
  ['Y（源 24 高）', golden.y],
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
 * 未必。**同一个目标长度里两个方向都可能出现**，所以它凑不出一次平移。
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
    expect(disagreements(golden.x, 80)).toEqual(expected)
    for (const i of expected) expect(golden.x.map[80]![i]).toBe(gpu(128, 80, i) - 1)
  })

  it('提示图真的会用到的两个混合长度上，平局两个方向都有', () => {
    // X=20 与 Y=10 —— `Reminder.update()` 每拍宽 +10、高 +2，这两个长度都在路上。
    for (const [axis, destLen] of [
      [golden.x, 20],
      [golden.y, 10],
    ] as [Axis, number][]) {
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
      expect(up).toBeGreaterThan(0)
      expect(down).toBeGreaterThan(0)
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
    expect(() => nearestSourceIndexes(srcLen, destLen)).toThrow(/正整数/)
  })

  it('源长超出量过的范围要响，而不是编一个答案', () => {
    expect(() => nearestSourceIndexes(256, 100)).toThrow(/量过/)
  })
})
