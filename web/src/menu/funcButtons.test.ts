import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { javaSource } from '../test/javaSource'
import { FUNC_MAIN_ORDER, createFuncButtons } from './funcButtons'
import { hits } from './buttons'
import { menuWantsScene, stepMenu } from './step'
import { createMenuWorld } from './world'

/**
 * 天书页骨架那三条。第三条（「返回」是唯一的出口）是这一票的验收标准之一，
 * 而它的反面 —— 按 ESC 出不去 —— 是**复刻的缺陷**，所以也在这里跑一遍。
 */
describe('天书页骨架', () => {
  const src = javaSource('src/menu/FuncButtons.java')

  it('五颗主按钮的次序与几何，对回 addButton()', () => {
    // `buttonList[0..4]=…`，按下标解出来。
    const matches = [...src.matchAll(/buttonList\[(\d)\]=(\w+);/g)]
    expect(matches, 'buttonList 那五行没解出来').toHaveLength(5)
    const order = matches
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((m) => m[2]!)
    expect(FUNC_MAIN_ORDER).toEqual(order)

    const fb = createFuncButtons()
    expect(FUNC_MAIN_ORDER.map((k) => fb.main[k].x)).toEqual([400, 488, 576, 664, 752])
    for (const key of FUNC_MAIN_ORDER) {
      expect(fb.main[key].isDraw, `${key} 开局要画得出来`).toBe(true)
    }
  })

  it('setKey 开局就画得出来 —— 那两层循环没关到它', () => {
    // 原版：`subButtonList[1][0]=setBGM; subButtonList[1][1]=setClick;` ——
    // setKey 一个数组都没进去，所以末尾那两层 `isDraw=No` 的循环碰不到它。
    expect(src).toContain('subButtonList[1][0]=setBGM;')
    expect(src).toContain('subButtonList[1][1]=setClick;')
    expect(/subButtonList\[\d\]\[\d\]=setKey;/.test(src)).toBe(false)

    const fb = createFuncButtons()
    expect(fb.sub.setKey.isDraw).toBe(true)
    for (const key of ['setBGM', 'setClick', 'on_BGM', 'exitForSure', 'restart'] as const) {
      expect(fb.sub[key].isDraw, `${key} 开局不该画`).toBe(false)
    }
  })

  it('点「返回」要回场景；点别的四颗都不回', () => {
    for (const key of FUNC_MAIN_ORDER) {
      const w = createMenuWorld({ party: ['zhang'], fullHeal: true })
      w.panel = 'funcPanel'
      const fb = w.panels.funcPanel.funcButtons!
      const b = fb.main[key]
      const x = b.x - 15 + Math.floor(b.width / 2)
      const y = b.y - 6 + Math.floor(b.height / 2)
      expect(hits(b, x, y), `${key} 的落点没打中`).toBe(true)
      stepMenu(w, [{ e: 'press', x, y }])
      expect(menuWantsScene(w), `点 ${key} 之后`).toBe(key === 'returnButton')
      // 五颗都出一声换页音，这一条不随按钮变。
      expect(w.music).toEqual(['换list.wav'])
    }
  })

  it('菜单内部不监听任何键盘 —— 按 ESC 出不去（这是复刻，不是缺陷）', () => {
    // 原版 MenuPanel 里那个 keyPressed(ESC) 是死代码：顶层 keyPressed 只分发
    // 给场景 / 存档 / 战斗三家。判据在这里现读一遍，免得下一个人"顺手修好"。
    const launcher = javaSource('src/main/GameLauncher.java')
    const dispatched = [...launcher.matchAll(/(\w+Panel)\.keyPressed\(/g)].map((m) => m[1]!)
    expect(dispatched.length, 'GameLauncher 里没解出 keyPressed 的分发').toBeGreaterThan(0)
    expect(dispatched).not.toContain('menuPanel')
    expect(javaSource('src/menu/MenuPanel.java')).toContain('VK_ESCAPE')

    // 这一层的对应物：`MenuInput` 那个联合类型里根本没有键盘那一种 ——
    // 输入的取值域就是判据，比"我们没写键盘处理"那种散文强。
    const step = readFileSync(repoPath('web/src/menu/step.ts'), 'utf8')
    const union = /export type MenuInput =([\s\S]*?)\n\nexport function stepMenu/.exec(step)
    expect(union, 'step.ts 里没解出 MenuInput 的联合类型').not.toBeNull()
    expect([...union![1]!.matchAll(/e: '([a-z|' ]+)'/g)].map((m) => m[1]!)).toEqual([
      'press' + "' | '" + 'release' + "' | '" + 'move',
      'tick',
    ])
  })
})
