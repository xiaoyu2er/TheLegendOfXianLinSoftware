import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { javaSource } from '../test/javaSource'
import {
  FUNC_ALL_KEYS,
  FUNC_MAIN_ORDER,
  FUNC_SUB_GROUPS,
  FUNC_SUB_ORDER,
  createFuncButtons,
  drawnFuncButtons,
} from './funcButtons'
import type { FuncMainKey, FuncSubKey } from './funcButtons'
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

/**
 * 天书页**整页**（xl-6lo.12）：设定与退出子菜单的展开收起、BGM 开关、
 * 三颗空实现按钮。
 *
 * ## 期望值零手写：从 GBK 源码里现读 `checkPressed()`
 *
 * 两条 menu 真值里 `func.drawn` 从第 0 拍到末拍**一个字都没变**（两条剧本
 * 都没点过天书页的按钮），所以真值盖不到"展开收起"这件事 —— 逐次相等的那份
 * 真值要等 xl-6lo.7 的「天书设定」剧本。在那之前，能证明这一页的只有原版
 * 自己：下面把 `FuncButtons.checkPressed()` 那十五段解析出来，**每一段的
 * `isDraw` 赋值、出几声、开不开关 BGM 与音效全从源码里读**，据此建一个参照
 * 模型，再拿真的状态层逐次点过去对。
 *
 * 这不是"照着实现抄一遍期望"：参照模型的每一个动作都出自
 * `src/menu/FuncButtons.java`，实现写错一段，模型不会跟着错。
 */
describe('天书页 · 设定与退出子菜单', () => {
  const raw = javaSource('src/menu/FuncButtons.java')
  /**
   * 先把字符串字面量与注释挖掉，再把空白收成单个空格。
   *
   * 三步都不能少：注释里有中文和花括号，会把下面那个括号配对带歪；字符串里
   * 的 `/` 会被当成注释起手；而原版那几段的换行与缩进毫无规律。
   */
  const flat = raw
    .replace(/"[^"\n]*"/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')

  /** 从 `open` 那个 `{` 起做括号配对，返回块内文本。 */
  function blockAt(text: string, open: number): string {
    if (text[open] !== '{') throw new Error(`第 ${open} 个字符不是 {`)
    let depth = 0
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') {
        depth--
        if (depth === 0) return text.slice(open + 1, i)
      }
    }
    throw new Error('括号没配上')
  }

  function methodBody(name: string): string {
    const m = new RegExp(`(?:public|private) void ${name}\\(\\) ?\\{`).exec(flat)
    if (!m) throw new Error(`FuncButtons.java 里没解出 ${name}()`)
    return blockAt(flat, m.index + m[0].length - 1)
  }

  /** 一段里的 isDraw 动作，**按源码顺序**。 */
  type DrawOp = { kind: 'all'; on: boolean } | { kind: 'group'; n: number; on: boolean }

  /** `for(int i=1;i<5;i++){ for(MenuButton b:subButtonList[i]) b.isDraw=…; …` */
  const ALL_SRC =
    'for\\(int i=1;i<5;i\\+\\+\\)\\s*\\{\\s*for\\(MenuButton \\w+:subButtonList\\[i\\]\\)\\s*\\w+\\.isDraw=MenuButton\\.(Yes|No);'
  /** `for(MenuButton button:subButtonList[3]) button.isDraw=…;` —— 下标是数字。 */
  const GROUP_SRC =
    'for\\(MenuButton \\w+:subButtonList\\[(\\d)\\]\\)\\s*\\w+\\.isDraw=MenuButton\\.(Yes|No);'

  function drawOps(block: string): DrawOp[] {
    const found: { at: number; op: DrawOp }[] = []
    for (const m of block.matchAll(new RegExp(ALL_SRC, 'g'))) {
      found.push({ at: m.index, op: { kind: 'all', on: m[1] === 'Yes' } })
    }
    for (const m of block.matchAll(new RegExp(GROUP_SRC, 'g'))) {
      found.push({ at: m.index, op: { kind: 'group', n: Number(m[1]), on: m[2] === 'Yes' } })
    }
    return found.sort((a, b) => a.at - b.at).map((f) => f.op)
  }

  interface Section {
    /** 守卫读的那颗按钮的字段名；`tabs` 是开头那段读页签的。 */
    readonly guard: string
    readonly ops: readonly DrawOp[]
    /** 这一段调了几次 `MusicReader.readmusic`。 */
    readonly music: number
    /** `openBGM()` → true、`closeBGM()` → false、都没有 → null。 */
    readonly bgm: boolean | null
    readonly sfx: boolean | null
  }

  /** 把 `checkPressed()` 拆成十五段（页签那一段 + 五颗主按钮 + 九颗子按钮）。 */
  function sections(): Section[] {
    const body = methodBody('checkPressed')
    const out: Section[] = []
    for (const m of body.matchAll(/if\((?:this\.)?(\w+)\.(?:isclicked|isIsclicked\(\))\)\s*\{/g)) {
      const block = blockAt(body, m.index + m[0].length - 1)
      const name = m[1]!
      out.push({
        guard: name === 'button' ? 'tabs' : name,
        ops: drawOps(block),
        music: [...block.matchAll(/MusicReader\.readmusic\(/g)].length,
        bgm: block.includes('MusicReader.openBGM()')
          ? true
          : block.includes('MusicReader.closeBGM()')
            ? false
            : null,
        sfx: block.includes('MusicReader.openMusic()')
          ? true
          : block.includes('MusicReader.closeMusic()')
            ? false
            : null,
      })
    }
    return out
  }

  const SECTIONS = sections()
  function sectionOf(guard: string): Section {
    const hit = SECTIONS.find((s) => s.guard === guard)
    if (!hit) throw new Error(`checkPressed() 里没解出 ${guard} 那一段`)
    return hit
  }

  it('解析器空转要响：十四颗按钮 + 十五段守卫都解出来了', () => {
    // 分母从源码现数：`MenuButton xxx;` 那批字段声明。多一颗少一颗都要响。
    const fields = [...raw.matchAll(/^\s*MenuButton (\w+);\r?$/gm)].map((m) => m[1]!)
    expect(fields.length, 'FuncButtons 的 MenuButton 字段没解出来').toBeGreaterThan(0)
    expect([...fields].sort()).toEqual([...FUNC_ALL_KEYS].map(String).sort())

    expect(SECTIONS.map((s) => s.guard)).toEqual([
      'tabs',
      'saveButton',
      'readButton',
      'setButton',
      'returnButton',
      'exitButton',
      'setBGM',
      'setClick',
      'setKey',
      'on_BGM',
      'off_BGM',
      'on_click',
      'off_click',
      'restart',
      'exitForSure',
    ])
    // 每一段都得解出至少一条 isDraw 动作 —— 一条都没有的话下面整套对照恒真。
    for (const s of SECTIONS) {
      expect(s.ops.length, `${s.guard} 那一段一条 isDraw 都没解出来`).toBeGreaterThan(0)
    }
  })

  it('`setKey` 那一段是死代码 —— 没有任何一条路能把它的 isclicked 置真', () => {
    // 命中判据那两层循环只走 subButtonList[1..4]，而 setKey 一个数组都没进去；
    // 也没有谁单独给它补一句 isPressedButton。
    expect(/subButtonList\[\d\]\[\d\]=setKey;/.test(raw)).toBe(false)
    expect(/setKey\.isPressedButton\(/.test(raw)).toBe(false)
    // 而那一段本身确实存在（不是我们读漏了），且注释下面一行代码都没有。
    expect(sectionOf('setKey').ops.length).toBeGreaterThan(0)
    expect(raw).toContain('//重新设置键盘')
  })

  /** `MenuButton` 的构造函数把每一颗都设成 Yes，随后 `addButton()` 末尾关掉四组。 */
  function initialModel(): { drawn: Set<string>; bgm: boolean; sfx: boolean } {
    expect(javaSource('src/menu/MenuButton.java')).toContain('this.isDraw=MenuButton.Yes;')
    const drawn = new Set<string>(FUNC_ALL_KEYS.map(String))
    const tail = drawOps(methodBody('addButton'))
    expect(tail.length, 'addButton() 末尾那两层循环没解出来').toBeGreaterThan(0)
    applyOps(drawn, tail)
    return { drawn, bgm: true, sfx: true }
  }

  function applyOps(drawn: Set<string>, ops: readonly DrawOp[]): void {
    for (const op of ops) {
      const groups = op.kind === 'all' ? [1, 2, 3, 4] : [op.n]
      for (const n of groups) {
        const group = FUNC_SUB_GROUPS[n - 1]
        if (!group) throw new Error(`subButtonList 没有第 ${n} 组`)
        for (const key of group) {
          if (op.on) drawn.add(key)
          else drawn.delete(key)
        }
      }
    }
  }

  const centerOf = (b: { x: number; y: number; width: number; height: number }) => ({
    x: b.x - 15 + Math.floor(b.width / 2),
    y: b.y - 6 + Math.floor(b.height / 2),
  })

  /** 覆盖登记：每条用例走过哪几段，最后拿解析出来的段落数当分母对撞。 */
  const walked = new Set<string>()

  /**
   * 走一串点击，每一步都拿参照模型对一遍。
   *
   * 每一步先断言这个落点**只**打中当前画得出来的那一颗 —— 参照模型的前提是
   * "一次点击 = 一段"，那个前提不成立时它就默默地不对了，而画面上看不出来
   * （原版那些子按钮的矩形确实互相重叠，只是从来不同时画）。
   */
  function walk(clicks: readonly string[]): Set<string> {
    const w = createMenuWorld({ party: ['zhang'], fullHeal: true })
    w.panel = 'funcPanel'
    const fb = w.panels.funcPanel.funcButtons
    if (!fb) throw new Error('funcPanel 没有 funcButtons')
    const ref = initialModel()
    expect(new Set(drawnFuncButtons(fb)), '开局那一份对不上').toEqual(ref.drawn)

    const buttonOf = (k: string) =>
      k in fb.main ? fb.main[k as FuncMainKey] : fb.sub[k as FuncSubKey]

    for (const key of clicks) {
      walked.add(key)
      const { x, y } = centerOf(buttonOf(key))
      expect(ref.drawn.has(key), `${key} 这时候画不出来，点不着`).toBe(true)
      const alsoHit = FUNC_ALL_KEYS.map(String).filter(
        (k) => k !== key && ref.drawn.has(k) && hits(buttonOf(k), x, y),
      )
      expect(alsoHit, `点 ${key} 的落点同时打中了别的按钮，一次点击不止一段`).toEqual([])

      stepMenu(w, [{ e: 'press', x, y }])
      const s = sectionOf(key)
      applyOps(ref.drawn, s.ops)
      if (s.bgm !== null) ref.bgm = s.bgm
      if (s.sfx !== null) ref.sfx = s.sfx
      expect(new Set(drawnFuncButtons(fb)), `点完 ${key} 之后画得出来的那批`).toEqual(ref.drawn)
      expect(w.music.length, `点 ${key} 出了几声`).toBe(s.music)
      expect(w.audio.bgm, `点 ${key} 之后的 BGM 开关`).toBe(ref.bgm)
      expect(w.audio.sfx, `点 ${key} 之后的音效开关`).toBe(ref.sfx)
      // 松开，把 isclicked 收干净 —— 原版一次点击是按下 + 松开两个事件。
      stepMenu(w, [{ e: 'release', x, y }])
    }
    return ref.drawn
  }

  it('点「设定」展开背景音乐 / 特殊音效 / 键盘设定三组子按钮', () => {
    const drawn = walk(['setButton'])
    expect(drawn.has('setBGM')).toBe(true)
    expect(drawn.has('setClick')).toBe(true)
    // ⚠️「键盘设定」在这个集合里是因为它的 isDraw 从开局起就是 Yes ——
    // 它其实一次都没被画出来过，也点不着（见上面那条）。真值记的正是 isDraw。
    expect(drawn.has('setKey')).toBe(true)
  })

  it('设定 → 背景音乐 → 开 / 关：BGM 开关真的跟着变', () => {
    walk(['setButton', 'setBGM', 'off_BGM'])
    walk(['setButton', 'setBGM', 'off_BGM', 'on_BGM'])
  })

  it('设定 → 特殊音效 → 开 / 关', () => {
    walk(['setButton', 'setClick', 'off_click', 'on_click'])
  })

  it('点「退出」展开确认离开 / 重新开始；两颗都点得响', () => {
    walk(['exitButton', 'exitForSure'])
    walk(['exitButton', 'restart'])
  })

  it('存档 / 提取 / 返回：三颗都出一声换页音，且把子菜单全收起来', () => {
    for (const key of ['saveButton', 'readButton', 'returnButton'] as const) {
      const drawn = walk(['setButton', key])
      for (const sub of FUNC_SUB_ORDER) {
        expect(drawn.has(sub), `点完 ${key} 之后 ${sub} 不该还画着`).toBe(false)
      }
      // setKey 谁都关不掉 —— 它不在那四组里。
      expect(drawn.has('setKey')).toBe(true)
    }
  })

  it('按一下页签就把子菜单收起来 —— checkPressed 开头那一段', () => {
    const w = createMenuWorld({ party: ['zhang'], fullHeal: true })
    w.panel = 'funcPanel'
    const fb = w.panels.funcPanel.funcButtons
    if (!fb) throw new Error('funcPanel 没有 funcButtons')
    const set = centerOf(fb.main.setButton)
    stepMenu(w, [{ e: 'press', ...set }])
    stepMenu(w, [{ e: 'release', ...set }])
    expect(drawnFuncButtons(fb)).toContain('setBGM')

    // 点「天书」页签（当前就在天书页）：`command.checkPressed` 把它置 isclicked，
    // 紧接着 `FuncButtons.checkPressed` 开头那一段就把子菜单全收起来。
    const tab = centerOf(w.tabs.func)
    stepMenu(w, [{ e: 'press', ...tab }])
    const ref = initialModel()
    applyOps(ref.drawn, sectionOf('tabs').ops)
    expect(new Set(drawnFuncButtons(fb))).toEqual(ref.drawn)
    walked.add('tabs')
  })

  it('「特殊音效 关」一声都不出，而「开」出一声 —— 两段的不对称照抄', () => {
    // 两段的 isDraw 动作完全相同，唯一的差别就是出不出声：抹平了逐帧比对
    // 也看不出来，只有这一条与上面 `walk` 里那句 `w.music.length` 拦得住。
    expect(sectionOf('off_click').ops).toEqual(sectionOf('on_click').ops)
    expect(sectionOf('off_click').music).toBe(0)
    expect(sectionOf('on_click').music).toBe(1)
  })

  it('第 4 段少的那句 hideAll 观测不到 —— 它把四组全显式赋了值', () => {
    // 篡改验证里唯一一条**绿**的（给 setClick 补上开头那句 `hideAll`）。
    // 追下去不是判据失灵：第 3 段是「先全关，再开 1、开 2」，剩下两组靠那句
    // hideAll 定；第 4 段是「开 1、关 2、开 3、关 4」——**四组一个不落**，
    // 于是前面再加一句全关是个恒等变换，任何判据都看不见它。
    //
    // 这一条把那件事变成一条会红的登记：哪天第 4 段变成只赋三组，补不补那句
    // hideAll 就有了区别，而这条会当场红，提醒下一个人去把它照抄回来。
    const touched = new Set(
      sectionOf('setClick').ops.flatMap((op) => (op.kind === 'group' ? [op.n] : [1, 2, 3, 4])),
    )
    expect([...touched].sort()).toEqual([1, 2, 3, 4])
    // 而第 3 段确实**不是**四组全赋 —— 两段的差别是真的，不是我们读错了。
    const bgmTouched = new Set(
      sectionOf('setBGM').ops.flatMap((op) => (op.kind === 'group' ? [op.n] : [])),
    )
    expect([...bgmTouched].sort()).not.toEqual([1, 2, 3, 4])
  })

  it('点「键盘设定」什么都不会发生 —— 复刻原版的空，别"顺手实现"它', () => {
    // 上面那条只读源码，读不到"有人在 TS 这一侧给它补了一句 isPressedButton"
    // —— 篡改验证里那一条（把 setKey 接进命中判据）当时是**绿**的，这条就是
    // 补它的。落点真的打在「键盘设定」上，而它 isDraw 是 Yes，所以"点不着"
    // 这件事必须由**没有任何变化**来证明，不能由"画不出来"绕过去。
    const w = createMenuWorld({ party: ['zhang'], fullHeal: true })
    w.panel = 'funcPanel'
    const fb = w.panels.funcPanel.funcButtons
    if (!fb) throw new Error('funcPanel 没有 funcButtons')
    expect(fb.sub.setKey.isDraw, 'setKey 开局就该是 Yes，否则这条用例证不到东西').toBe(true)
    const at = centerOf(fb.sub.setKey)
    expect(hits(fb.sub.setKey, at.x, at.y), '落点没打中「键盘设定」').toBe(true)

    const before = drawnFuncButtons(fb)
    stepMenu(w, [{ e: 'press', x: at.x, y: at.y }])
    // 那一段真要是跑了，`subButtonList[1]` 会展开、还会出一声 —— 两条都在这。
    expect(drawnFuncButtons(fb), '点「键盘设定」把子菜单展开了').toEqual(before)
    expect(w.music, '点「键盘设定」出声了').toEqual([])
    expect(fb.sub.setKey.isclicked, 'setKey 的 isclicked 被置真了').toBe(false)
    // 贴图也不该动：命中判据一次都没跑到它身上。
    expect(fb.sub.setKey.image).toBe('normal')
  })

  it('解析出来的每一段都被走过 —— 除了那段死代码', () => {
    // 分母是**解析出来的**段落名单，不是手写的。新加一段而没人走它就红。
    const unreached = SECTIONS.map((s) => s.guard).filter((g) => !walked.has(g) && g !== 'setKey')
    expect(unreached, 'checkPressed() 里有段落一次都没走到').toEqual([])
    // 反过来：`setKey` 那一段必须走不到（它是死代码），走到了说明有人"修好"了它。
    expect(walked.has('setKey')).toBe(false)
  })
})
