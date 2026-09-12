import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'

/**
 * 舞台上没有系统光标（xl-03x.20）。
 *
 * 原版每一块面板都把系统光标换成一个全透明的自定义 cursor，面板自己画鼠标（场景连画都
 * 不画）。web 原先只有标题页写了 `cursor: none`，别的面板露出系统光标 —— 有自绘鼠标的
 * 那几块于是两只指针。
 *
 * jsdom 不加载样式表，所以这里读 `index.css` 的文本：`.stage` 那一条写着 `none`，而且
 * **别的规则里凡是把光标写回可见值的，只许是舞台外面那条工具栏**。后一半是这条判据的
 * 分辨力所在：给舞台里某个元素写一句 `cursor: pointer`，光标就在那一块上回来了。
 */

const CSS = readFileSync(repoPath('web/src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const RULES = [...CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }))

function cursorOf(body: string): string | undefined {
  return /(?:^|;|\s)cursor\s*:\s*([^;]+)/.exec(body)?.[1]?.trim()
}

describe('舞台光标', () => {
  it('原版确实每一块有鼠标的面板都藏了系统光标 —— 前提先现读', () => {
    // 场景、战斗、菜单、两家店各自 setCursor；标题与存读档经 start.Mouse。少一处这条前提就要重想。
    const panels = [
      'src/scene/ScenePanel.java',
      'src/battle/BattlePanel.java',
      'src/menu/MenuPanel.java',
      'src/shop/ShopPanel.java',
      'src/shop/EquipmentShopPanel.java',
      'src/start/Mouse.java',
    ]
    // 参数里有 `new Point(0, 0)`，所以不能用 `[^)]*` 找右括号。
    const without = panels.filter((p) => !/createCustomCursor\(.*?"hidden"\)/.test(javaSource(p).replace(/\s+/g, ' ')))
    expect(without).toEqual([])
  })

  it('.stage 写着 cursor: none', () => {
    const stage = RULES.filter((r) => r.selector === '.stage')
    expect(stage, 'index.css 里应当恰好一条 .stage 规则').toHaveLength(1)
    expect(cursorOf(stage[0]!.body)).toBe('none')
  })

  it('把光标写回可见值的规则只在舞台外的工具栏上', () => {
    const visible = RULES.filter((r) => {
      const c = cursorOf(r.body)
      return c !== undefined && c !== 'none' && c !== 'inherit'
    })
    // 空转要响：工具栏那几条 pointer 本来就在，一条都读不出来说明解析坏了。
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.map((r) => r.selector).filter((s) => !s.split(',').every((p) => p.trim().startsWith('.toolbar')))).toEqual([])
  })
})
