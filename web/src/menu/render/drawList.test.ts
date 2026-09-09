import { describe, expect, it } from 'vitest'
import { javaSource } from '../../test/javaSource'
import { MENU_LAYERS, menuDrawList } from './drawList'
import type { MenuDrawOp, MenuLayer } from './drawList'
import { MENU_BACKGROUND, funcButtonId, mouseId, tabId } from './assets'
import { FUNC_MAIN_ORDER, FUNC_SUB_ORDER } from '../funcButtons'
import { SCOLL_HEROES } from '../types'
import { MENU_HERO_ORDER } from '../heroes'
import { stepMenu } from '../step'
import { createMenuWorld } from '../world'
import type { MenuWorld } from '../types'

function world(): MenuWorld {
  return createMenuWorld({ party: ['zhang'], fullHeal: true })
}

function layersOf(ops: readonly MenuDrawOp[]): MenuLayer[] {
  return ops.map((op) => op.layer)
}

describe('菜单那六层绘制', () => {
  it('六层的名字与次序，从 FatherPanel.paint() 里解出来', () => {
    // 手抄一份清单，抄错一层的表现是"某个精灵被别的盖住了"，画面看起来完全
    // 正常 —— 所以这份次序从原版源码里现读（battle/render/drawList.test.ts
    // 立的规矩）。
    const src = javaSource('src/menu/FatherPanel.java')
    const body = /public void paint\(Graphics g\) \{([\s\S]*?)\n\t\}/.exec(src)
    expect(body, 'FatherPanel.paint 的方法体没解出来').not.toBeNull()
    const calls = [
      ...body![1]!.matchAll(
        /drawImage\(backgroundImage|drawSpecialImage\(|drawCommand\(|drawScoll\(|drawThisPanel\(|drawMouse\(/g,
      ),
    ].map((m) => m[0]!)
    expect(calls).toEqual([
      'drawImage(backgroundImage',
      'drawSpecialImage(',
      'drawCommand(',
      'drawScoll(',
      'drawThisPanel(',
      'drawMouse(',
    ])
    expect(MENU_LAYERS).toEqual(['background', 'special', 'command', 'scoll', 'page', 'mouse'])
  })

  it('清单里各层的先后与 MENU_LAYERS 一致 —— 背景在最底、游标在最顶', () => {
    const ops = menuDrawList(world())
    const order = layersOf(ops)
    const rank = (l: MenuLayer) => MENU_LAYERS.indexOf(l)
    for (let i = 1; i < order.length; i++) {
      expect(rank(order[i]!), `第 ${i} 条 ${order[i]} 排在 ${order[i - 1]} 前面`).toBeGreaterThanOrEqual(
        rank(order[i - 1]!),
      )
    }
    expect(order[0]).toBe('background')
    expect(order[order.length - 1]).toBe('mouse')
    // ⚠️ 上面那条只在**层名真的不止一种**时才有分辨力：全都是同一层的话
    // 「有序」按构造成立（dispatch.md 那族"断言本身按构造成立"）。所以顺带
    // 数一遍这一帧到底跨了几层。
    expect(new Set(order).size).toBeGreaterThan(2)
  })

  it('背景跟着当前页走 —— 另外三页走按需加载，一次全取等于取消了按需', () => {
    const w = world()
    expect(menuDrawList(w)[0]).toMatchObject({ id: MENU_BACKGROUND.thingPanel })
    stepMenu(w, [{ e: 'press', x: 619, y: 62 }])
    const ops = menuDrawList(w)
    expect(ops[0]).toMatchObject({ id: MENU_BACKGROUND.magicPanel })
    // 只有一张背景，不是四张。
    expect(ops.filter((op) => layersOf([op])[0] === 'background')).toHaveLength(1)
  })

  it('页签贴三态里的哪一张，跟着按钮状态走', () => {
    const w = world()
    expect(menuDrawList(w)).toContainEqual(
      expect.objectContaining({ id: tabId('magic', 'normal') }),
    )
    stepMenu(w, [{ e: 'press', x: 619, y: 62 }])
    // 按下那一颗贴第三张，其余三颗被那一轮 `isPressedButton` 拨回常态。
    expect(menuDrawList(w)).toContainEqual(
      expect.objectContaining({ id: tabId('magic', 'pressed') }),
    )
    stepMenu(w, [{ e: 'release', x: 619, y: 62 }])
    expect(menuDrawList(w)).toContainEqual(
      expect.objectContaining({ id: tabId('magic', 'waitclick') }),
    )
  })

  it('游标贴的是 frame 那一张，不是 code 那一张', () => {
    // 两者只在开局与绕回时不一致（`Mouse.update()` 先取图再自增）。贴错的话
    // 平时看不出来，只有第 8 张连画两帧那一下会跳。
    const w = world()
    for (let i = 0; i < 8; i++) stepMenu(w, [{ e: 'tick' }])
    expect(w.panels.thingPanel.mouse).toMatchObject({ code: 8, frame: 7 })
    const op = menuDrawList(w).find((o) => o.layer === 'mouse')!
    expect(op).toMatchObject({ id: mouseId(7) })
    stepMenu(w, [{ e: 'tick' }])
    expect(w.panels.thingPanel.mouse).toMatchObject({ code: 1, frame: 7 })
    expect(menuDrawList(w).find((o) => o.layer === 'mouse')!).toMatchObject({ id: mouseId(7) })
  })

  it('天书页没有卷轴那一层', () => {
    const w = world()
    expect(layersOf(menuDrawList(w))).toContain('scoll')
    stepMenu(w, [{ e: 'press', x: 723, y: 62 }])
    expect(w.panel).toBe('funcPanel')
    expect(layersOf(menuDrawList(w))).not.toContain('scoll')
  })

  it('天书页那一排按钮画得出来 —— 「返回」画不出来玩家就出不去', () => {
    const w = world()
    stepMenu(w, [{ e: 'press', x: 723, y: 62 }])
    stepMenu(w, [{ e: 'release', x: 723, y: 62 }])
    expect(w.panel).toBe('funcPanel')
    const page = menuDrawList(w).filter((op) => op.layer === 'page')
    // 五颗主按钮，一颗子按钮都不画（开局四组 subButtonList 全是 isDraw=No）。
    expect(page).toHaveLength(FUNC_MAIN_ORDER.length)
    // 次序照 drawFuncButtons()：buttonList 那五颗按数组下标。
    expect(page.map((op) => (op.kind === 'image' ? op.id : ''))).toEqual(
      FUNC_MAIN_ORDER.map((k) => funcButtonId(k, 'normal')),
    )
    expect(page.map((op) => (op.kind === 'image' ? op.id : ''))).toContain(
      funcButtonId('returnButton', 'normal'),
    )
  })

  it('⚠️ 「键盘设定」那颗 isDraw 是 Yes，却永远画不出来 —— 两个都是原版的', () => {
    // `addButton()` 末尾那两层关 isDraw 的循环扫不到 setKey（它一个
    // subButtonList 都没进），所以它是 Yes；而 `drawFuncButtons()` 也只遍历
    // buttonList 与 subButtonList[1..4]，同样扫不到它 —— 于是它进得了
    // `func.drawn`，却一帧都没画过。调和这两个事实就是改原版。
    const src = javaSource('src/menu/FuncButtons.java')
    const draw = /public void drawFuncButtons\(Graphics g\)\{([\s\S]*?)\n\t\}/.exec(src)
    expect(draw, 'drawFuncButtons 的方法体没解出来').not.toBeNull()
    expect(draw![1]!).not.toContain('setKey')
    expect(FUNC_SUB_ORDER).not.toContain('setKey')

    const w = world()
    stepMenu(w, [{ e: 'press', x: 723, y: 62 }])
    expect(w.panels.funcPanel.funcButtons!.sub.setKey.isDraw).toBe(true)
    expect(menuDrawList(w).map((op) => (op.kind === 'image' ? op.id : ''))).not.toContain(
      funcButtonId('setKey', 'normal'),
    )
  })

  it('别的三页 page 层是空的 —— 那三页归 xl-6lo.9 / .10 / .11', () => {
    const w = world()
    expect(menuDrawList(w).filter((op) => op.layer === 'page')).toEqual([])
    stepMenu(w, [{ e: 'press', x: 619, y: 62 }])
    expect(menuDrawList(w).filter((op) => op.layer === 'page')).toEqual([])
  })

  it('不在出战名单里的头像不画；张小凡一个人时只画一颗', () => {
    const only = menuDrawList(createMenuWorld({ party: ['zhang'], fullHeal: true }))
    const heads = only.filter((op) => op.kind === 'image' && op.id.startsWith('menu:scoll/hero'))
    expect(heads).toHaveLength(1)

    const all = menuDrawList(createMenuWorld({ party: ['zhang', 'lu', 'wen'], fullHeal: true }))
    expect(all.filter((op) => op.kind === 'image' && op.id.startsWith('menu:scoll/hero'))).toHaveLength(3)
  })

  it('卷轴那三颗与 heroes[] 是同一个次序 —— 等级那个下标全靠它', () => {
    // `scollLevel` 拿 `SCOLL_HEROES` 里的下标去索引 `w.heroes` —— 两张表一旦
    // 不同序，切到玉洁会画出陆雪琪的等级，而两个数都是合法的。
    expect(SCOLL_HEROES.map((h) => h.party)).toEqual(['zhang', 'lu', 'wen'])
    expect(MENU_HERO_ORDER.map((h) => h.key)).toEqual(['zhang', 'lu', 'yu'])
    expect(SCOLL_HEROES).toHaveLength(MENU_HERO_ORDER.length)
  })

  it('⚠️ 卷轴上的等级：张小凡在队里就永远是他的 —— 这是复刻的缺陷', () => {
    const src = javaSource('src/menu/Scoll.java')
    // `drawScoll()` 第一句就把 checkPressed 刚设好的 level 盖回去。
    expect(/drawScoll\(Graphics g\)\{[\s\S]*?if\(SaveAndLoad\.zhang\)\{[\s\S]*?level=""\+ZhangXiaoFan\.level;/.test(src)).toBe(true)

    const w = createMenuWorld({ party: ['zhang', 'wen'], fullHeal: true })
    const zhangLevel = w.heroes[0]!.level
    const yuLevel = w.heroes[2]!.level
    // 这一条只有在两个人等级不同的时候才观测得到 —— 相同的话抄错了也一样。
    expect(zhangLevel).not.toBe(yuLevel)
    w.panels.thingPanel.scoll!.whichHero = 4
    const text = menuDrawList(w).find((op) => op.kind === 'text' && op.layer === 'scoll')!
    expect(text).toMatchObject({ text: String(zhangLevel) })

    // 反方向：张小凡不在队里时，画的才是当前那个人的。
    const noZhang = createMenuWorld({ party: ['wen'], fullHeal: true })
    noZhang.panels.thingPanel.scoll!.whichHero = 4
    expect(menuDrawList(noZhang).find((op) => op.kind === 'text' && op.layer === 'scoll')).toMatchObject({
      text: String(yuLevel),
    })
  })

  it('顶栏那行字的基线与字号，对回 drawCommand()', () => {
    const src = javaSource('src/menu/Command.java')
    expect(src).toContain('new Font("文鼎粗钢笔行楷",Font.BOLD,25)')
    expect(src).toContain('g.drawString("当前任务:"+s, 10, y_of_GameButton-13)')
    const text = menuDrawList(world()).find((op) => op.kind === 'text' && op.layer === 'command')!
    expect(text).toMatchObject({ text: '当前任务:无', x: 10, y: 37, size: 25, color: '#ffffff' })
    // 有任务时走 if 那一支。
    expect(
      menuDrawList(world(), '找到大师兄').find((op) => op.kind === 'text' && op.layer === 'command'),
    ).toMatchObject({ text: '当前任务:找到大师兄' })
  })
})
