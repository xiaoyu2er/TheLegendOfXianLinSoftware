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

  /**
   * `addButton()` 里那批局部常量（`int name=<字面量>;`）。
   *
   * 与 `layout.test.ts` 的 `intField` 同形，但这里还多一步：把每颗按钮
   * `new MenuButton(...)` 的**前四个实参表达式**原样取出来，代入这些常量
   * **算一遍**。只对比一串坐标数字的话，那是把同一批数字抄第二遍 —— 抄错的
   * 那一位在两边都是错的，判据全绿（/code-review 的 Standards 轴提的）。
   */
  function intLocals(source: string): Record<string, number> {
    const out: Record<string, number> = {}
    for (const m of source.matchAll(/int\s+(\w+)\s*=\s*(-?\d+)\s*;/g)) {
      out[m[1]!] = Number(m[2])
    }
    return out
  }

  /** 一颗按钮的前四个实参，代入常量算出来的 x/y/width/height。 */
  function geometryOf(source: string, name: string): [number, number, number, number] {
    const m = new RegExp(`${name}\\s*=\\s*new MenuButton\\(([^;]*?),\\s*image1,`).exec(source)
    if (!m) throw new Error(`FuncButtons.java 里没解出 ${name} 的 new MenuButton(...)`)
    // 顶层逗号切四段 —— 参数里有括号（`y_MenuButton+1*(y_move+height_MenuButton)`）。
    const args: string[] = []
    let depth = 0
    let buf = ''
    for (const ch of m[1]!) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) {
        args.push(buf)
        buf = ''
      } else buf += ch
    }
    args.push(buf)
    if (args.length !== 4) throw new Error(`${name} 的实参切出了 ${args.length} 段，应为 4 段`)
    const locals = intLocals(source)
    return args.map((expr) => {
      const cleaned = expr.trim()
      // 只放行「标识符 / 整数 / + - * ( ) 空白」—— 别的一律拒，免得把源码里
      // 的任意表达式喂进 Function。
      if (!/^[\w\s+\-*()]+$/.test(cleaned)) throw new Error(`${name} 的实参不是纯算术：${cleaned}`)
      const names = [...new Set([...cleaned.matchAll(/[A-Za-z_]\w*/g)].map((x) => x[0]!))]
      for (const n of names) {
        if (!(n in locals)) throw new Error(`${name} 的实参里 ${n} 不是 addButton() 的局部常量`)
      }
      const fn = new Function(...names, `return (${cleaned})`) as (...a: number[]) => number
      return fn(...names.map((n) => locals[n]!))
    }) as [number, number, number, number]
  }

  it('addButton() 里那批常量真的解出来了 —— 解析器空转要响', () => {
    const locals = intLocals(src)
    for (const name of ['x_GameButton', 'y_GameButton', 'width_GameButton', 'height_GameButton',
      'y_move', 'x_move', 'y_MenuButton', 'width_MenuButton', 'height_MenuButton',
      'width_on', 'height_on']) {
      expect(locals[name], `addButton() 里没解出 ${name}`).toBeDefined()
    }
  })

  it('九颗子按钮的几何，代入原版常量算出来对得上', () => {
    const fb = createFuncButtons()
    for (const key of ['setBGM', 'setClick', 'setKey', 'on_BGM', 'off_BGM', 'on_click',
      'off_click', 'exitForSure', 'restart'] as const) {
      const b = fb.sub[key]
      expect([b.x, b.y, b.width, b.height], `${key} 的几何`).toEqual(geometryOf(src, key))
    }
  })

  it('五颗主按钮的次序与几何，对回 addButton()', () => {
    // `buttonList[0..4]=…`，按下标解出来。
    const matches = [...src.matchAll(/buttonList\[(\d)\]=(\w+);/g)]
    expect(matches, 'buttonList 那五行没解出来').toHaveLength(5)
    const order = matches
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((m) => m[2]!)
    expect(FUNC_MAIN_ORDER).toEqual(order)

    const fb = createFuncButtons()
    for (const key of FUNC_MAIN_ORDER) {
      const b = fb.main[key]
      expect([b.x, b.y, b.width, b.height], `${key} 的几何`).toEqual(geometryOf(src, key))
      expect(b.isDraw, `${key} 开局要画得出来`).toBe(true)
    }
    // 五颗真的排成一行、互不重叠 —— 上面那条要是把它们全算成同一个位置，
    // 它照样绿（两边同一个来源）。
    expect(new Set(FUNC_MAIN_ORDER.map((k) => fb.main[k].x)).size).toBe(FUNC_MAIN_ORDER.length)
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
