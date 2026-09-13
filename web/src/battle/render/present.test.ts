import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
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
 * `'over'` 上屏那一步的 8 位模型：Web 的缓冲存的是**预乘**值（`round(c·a/255)`，
 * 未核：Pixi 上传与合成的舍入是否正是这样），上屏是 Pixi 的普通混合 `src + dst·(1-a)`。
 * 这是对 GPU 的**描述**，不是被测对象 —— 被测的是 `presentFor` 带的底色与「不扔 alpha」。
 */
function screenPixel(present: Present, rgb: Rgb, alpha: number): Rgb {
  if (present.kind !== 'over') throw new Error(`这个模型只描述 'over'，收到 ${present.kind}`)
  const a = alpha / 255
  return rgb.map((c, i) => {
    const p = Math.round((c * alpha) / 255) / 255
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
    // 分母是黄金数据里的样本：为空时下面的循环一档都不比、worst 停在 0，与「全对」同形。
    expect(golden.samples.length).toBeGreaterThan(0)
    const present = presentFor('keep')
    let worst = 0
    for (const s of golden.samples) {
      expect(s.out).toHaveLength(256)
      for (let alpha = 0; alpha < 256; alpha++) {
        const got = screenPixel(present, s.rgb, alpha)
        for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(got[i]! - s.out[alpha]![i]!))
      }
    }
    expect(worst).toBeLessThanOrEqual(1)
  })
})

describe('上屏底色的前提：原版那两块面板没改过底色', () => {
  // 游戏里战斗面板底下的是 Swing 用「被画的组件自己的底色」铺的：第 0 帧是内容面板，
  // 之后是 BattlePanel。两者谁 setBackground 了，PANEL_BACKGROUND 就不再是那一块的底色。
  //
  // 分母现扫 `src/` 全部 `.java`；登记手签（dispatch.md 纪律 3）：原版里每一处
  // setBackground 都是**不带接收者**的（给自己设），且只在下面这四块黑底面板里。
  // 哪个文件多一处、或者出现 `x.setBackground(`（比如给内容面板设），都红。
  const REGISTERED = [
    'src/shop/EquipmentShopPanel.java',
    'src/shop/ShopPanel.java',
    'src/start/LoadAndSavePanel.java',
    'src/start/StartPanel.java',
  ]

  function javaFiles(dir: string): string[] {
    return readdirSync(repoPath(dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? javaFiles(join(dir, e.name)) : e.name.endsWith('.java') ? [join(dir, e.name)] : [],
    )
  }

  it('src/ 里的 setBackground 调用点与登记逐一相等，且都是给自己设', () => {
    const files = javaFiles('src')
    expect(files.length).toBeGreaterThan(0)
    const calls = files.flatMap((f) =>
      [...javaSource(f).matchAll(/(\.?)\s*\bsetBackground\s*\(/g)].map((m) => ({ file: f, qualified: m[1] === '.' })),
    )
    // 正对照：四块黑底面板一定读得出来，读成 0 就是 GBK 解码或正则失灵了。
    expect(calls.length).toBeGreaterThan(0)
    expect([...new Set(calls.map((c) => c.file))].sort()).toEqual(REGISTERED)
    expect(calls.filter((c) => c.qualified)).toEqual([])
  })

  it('两块面板本身都在：BattlePanel 与建内容面板的 GameLauncher', () => {
    expect(javaSource('src/battle/BattlePanel.java')).toMatch(/class BattlePanel extends JPanel/)
    expect(javaSource('src/main/GameLauncher.java')).toMatch(/getContentPane\(\)/)
  })
})
