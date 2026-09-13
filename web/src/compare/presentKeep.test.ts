import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PANEL_BACKGROUND } from '../battle/render/present'
import { repoPath } from '../test/repoPath'
import { DEFAULT_TOLERANCE } from './diff'
import { scriptNames } from './expected'
import type { Bitmap } from './png'
import { PRESENT_KEEP_SCRIPTS, javaOver, judgePresentKeep, presentKeepFrame, rgbOf } from './presentKeep'

/**
 * 判据自己的测试（xl-k9e）。每一条问的都是：坏的和好的长得一样吗。
 * 真浏览器那一半在 `scripts/compare.ts`（要 Java 与 Chrome，进不了 CI）。
 */

const T = DEFAULT_TOLERANCE
const BG = rgbOf(PANEL_BACKGROUND)

/** 原版缓冲：一行 256 个像素，红色，alpha 0..255 各一档。 */
function javaRamp(rgb: [number, number, number] = [255, 0, 0]): Bitmap {
  const rgba = new Uint8Array(256 * 4)
  for (let a = 0; a < 256; a++) rgba.set([...rgb, a], a * 4)
  return { width: 256, height: 1, rgba }
}

/** 浏览器截图：照某个规则把原版缓冲的每个像素上屏，alpha 恒 255。 */
function screen(java: Bitmap, f: (c: number, a: number, k: number) => number): Bitmap {
  const rgba = new Uint8Array(java.rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    for (let k = 0; k < 3; k++) rgba[i + k] = f(java.rgba[i + k]!, java.rgba[i + 3]!, k)
    rgba[i + 3] = 255
  }
  return { width: java.width, height: java.height, rgba }
}

const over = (java: Bitmap) => screen(java, (c, a, k) => javaOver(c, a, BG[k]!))
const dropAlpha = (java: Bitmap) => screen(java, (c) => c)

describe('上屏 keep 的渲染器层判据', () => {
  it('浏览器照原版盖在底色上：通过，分母与可分像素都数得出来', () => {
    const java = javaRamp()
    const f = presentKeepFrame(0, java, over(java), T)
    // 256 档里只有 a = 255 那一个不透明。
    expect(f.translucent).toBe(255)
    expect(f.separable).toBeGreaterThan(0)
    expect(f.differing).toBe(0)
    expect(judgePresentKeep([f]).ok).toBe(true)
  })

  it('浏览器扔 alpha（取图页 fresh 的上屏）：红', () => {
    const java = javaRamp()
    const f = presentKeepFrame(0, java, dropAlpha(java), T)
    expect(f.separable).toBeGreaterThan(0)
    const v = judgePresentKeep([f])
    expect(v.ok).toBe(false)
    expect(v.verdict).toContain('不像原版上屏')
  })

  it('底色差一点（盖在黑上）也红', () => {
    const java = javaRamp()
    const f = presentKeepFrame(0, java, screen(java, (c, a) => javaOver(c, a, 0)), T)
    expect(judgePresentKeep([f]).ok).toBe(false)
  })

  it('缓冲已叠满（没有半透明像素）：判不出，当场红 —— 不许与「全对」同形', () => {
    const java = javaRamp()
    for (let i = 3; i < java.rgba.length; i += 4) java.rgba[i] = 255
    const f = presentKeepFrame(0, java, dropAlpha(java), T)
    expect(f.translucent).toBe(0)
    const v = judgePresentKeep([f])
    expect(v.ok).toBe(false)
    expect(v.verdict).toContain('判不出')
  })

  it('半透明但颜色恰好就是底色：两个预测分不开，当场红', () => {
    const java = javaRamp(BG)
    const f = presentKeepFrame(0, java, dropAlpha(java), T)
    expect(f.translucent).toBe(255)
    expect(f.separable).toBe(0)
    expect(judgePresentKeep([f]).verdict).toContain('判不出')
  })

  it('一帧都没有也红', () => {
    expect(judgePresentKeep([]).ok).toBe(false)
  })

  it('尺寸不同是硬失败', () => {
    const java = javaRamp()
    expect(() => presentKeepFrame(0, java, { width: 1, height: 1, rgba: new Uint8Array(4) }, T)).toThrow()
  })
})

describe('「原版上屏」这个预测对 Java2D 的黄金数据', () => {
  // 预测不是手抄的公式说了算：`tools/present-golden/java-present.json` 是 Java2D 实跑
  // 的 SrcOver（xl-eit）。逐档差不过 1。
  const golden = JSON.parse(readFileSync(repoPath('tools/present-golden/java-present.json'), 'utf8')) as {
    panelBackground: [number, number, number]
    samples: { rgb: [number, number, number]; out: [number, number, number][] }[]
  }

  it('每个样本、每一档 alpha', () => {
    expect(golden.samples.length).toBeGreaterThan(0)
    let worst = 0
    for (const s of golden.samples) {
      expect(s.out).toHaveLength(256)
      for (let a = 0; a < 256; a++) {
        for (let k = 0; k < 3; k++) {
          worst = Math.max(worst, Math.abs(javaOver(s.rgb[k]!, a, golden.panelBackground[k]!) - s.out[a]![k]!))
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(1)
  })
})

describe('登记：以 keep 再回放的剧本', () => {
  it('每一条都在剧本目录里，而且是战斗剧本', () => {
    expect(PRESENT_KEEP_SCRIPTS.length).toBeGreaterThan(0)
    const names = scriptNames()
    for (const n of PRESENT_KEEP_SCRIPTS) {
      expect(names).toContain(n)
      const script = JSON.parse(readFileSync(repoPath(`tools/traces/scripts/${n}.json`), 'utf8')) as { driver?: string }
      expect(script.driver).toBe('battle')
    }
  })
})
