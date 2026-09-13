import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { javaSource } from '../../test/javaSource'
import { repoPath } from '../../test/repoPath'
import { PANEL_BACKGROUND, presentFor } from './present'
import type { Present } from './present'

/**
 * 上屏模型对 Java 的黄金数据（`tools/export-present.sh` 导出，xl-eit）。
 *
 * **守的是模型，不是浏览器**：底色取多少、alpha 扔不扔。渲染器真的照 `presentFor`
 * 那样画了没有，这里看不见（渲染器没有测试缝，跨端逐帧比对只跑 `'fresh'`）。
 */

type Rgb = [number, number, number]
interface Golden {
  lookAndFeel: string
  panelBackground: Rgb
  samples: { rgb: Rgb; out: Rgb[] }[]
}

const golden = JSON.parse(
  readFileSync(repoPath('tools/present-golden/java-present.json'), 'utf8'),
) as Golden

/**
 * GPU 上屏那一步的 8 位模型：Web 的缓冲存的是**预乘**值（源纹理按预乘上传，
 * `round(c·a/255)`），`'over'` 是 Pixi 的普通混合 `src + dst·(1-a)`，`'unpremultiply'`
 * 是 `battleRenderer.ts` 那段 GLSL。这是对 GPU 的**描述**，不是被测对象 —— 被测的是
 * `presentFor` 选了哪一种、带什么底色。
 */
function screenPixel(present: Present, rgb: Rgb, alpha: number): Rgb {
  const a = alpha / 255
  return rgb.map((c, i) => {
    const p = Math.round((c * alpha) / 255) / 255
    if (present.kind === 'unpremultiply') return a > 0 ? Math.round((p / a) * 255) : 0
    const bg = (present.background >> (16 - 8 * i)) & 0xff
    return Math.round((p + (bg / 255) * (1 - a)) * 255)
  }) as Rgb
}

const pack = ([r, g, b]: Rgb): number => (r << 16) | (g << 8) | b

describe('上屏：游戏与取图页分开（xl-eit）', () => {
  it('取图页（fresh）反预乘 —— 跨端逐帧比对对的是导出的缓冲，这一支不许动', () => {
    expect(presentFor('fresh')).toEqual({ kind: 'unpremultiply' })
  })

  it('游戏（keep）盖在 Panel.background 上，底色是 Java 现取的那一个', () => {
    expect(golden.samples.length).toBeGreaterThan(0)
    expect(PANEL_BACKGROUND).toBe(pack(golden.panelBackground))
    expect(presentFor('keep')).toEqual({ kind: 'over', background: pack(golden.panelBackground) })
  })

  it('游戏那一支的上屏结果与 Java2D 逐档对得上（差不过 1）', () => {
    const present = presentFor('keep')
    let compared = 0
    let worst = 0
    for (const s of golden.samples) {
      expect(s.out).toHaveLength(256)
      for (let alpha = 0; alpha < 256; alpha++) {
        const got = screenPixel(present, s.rgb, alpha)
        for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(got[i]! - s.out[alpha]![i]!))
        compared++
      }
    }
    // 分母：样本数 × 256 档，为 0 就是一档都没比。
    expect(compared).toBe(golden.samples.length * 256)
    expect(worst).toBeLessThanOrEqual(1)
  })
})

describe('上屏底色的前提：原版那两块面板没改过底色', () => {
  // 游戏里战斗面板底下的是 Swing 用「被画的组件自己的底色」铺的：第 0 帧是内容面板，
  // 之后是 BattlePanel。两者谁 setBackground 了，PANEL_BACKGROUND 就不再是那一块的底色。
  const SET_BACKGROUND = /\bsetBackground\s*\(/

  it('正对照：别的面板里的 setBackground 读得出来（GBK 解码与正则没失灵）', () => {
    expect(javaSource('src/start/StartPanel.java')).toMatch(SET_BACKGROUND)
  })

  it.each(['src/battle/BattlePanel.java', 'src/main/GameLauncher.java'])('%s 里没有 setBackground', (path) => {
    const src = javaSource(path)
    expect(src.length).toBeGreaterThan(0)
    expect(src).not.toMatch(SET_BACKGROUND)
  })
})
