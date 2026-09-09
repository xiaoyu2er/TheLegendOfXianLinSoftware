import { describe, expect, it } from 'vitest'
import { javaSource } from '../../test/javaSource'
import { MENU_LAYERS, menuDrawList } from './drawList'
import type { MenuDrawOp, MenuLayer } from './drawList'
import { MENU_BACKGROUND, funcButtonId, menuTextureIds, mouseId, tabId, useButtonId } from './assets'
import { DRUG_LIST_X, DRUG_LIST_Y, DRUG_ROW_H } from '../drugPanel'
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

  it('装备页与奇术页的 page 层还是空的 —— 那两页归 xl-6lo.9 / .11', () => {
    // ⚠️ 物品页**不再**在这条里：xl-6lo.10 把那一层画上了，见下面
    // 「物品页那一层」那一组。这条剩的是还欠着的那两页。
    for (const [tabX, panel] of [
      [619, 'magicPanel'],
      [515, 'equipPanel'],
    ] as const) {
      const w = world()
      stepMenu(w, [{ e: 'press', x: tabX, y: 62 }])
      expect(w.panel).toBe(panel)
      expect(menuDrawList(w).filter((op) => op.layer === 'page'), `${panel} 的 page 层`).toEqual([])
    }
    // 反方向：物品页那一层**不是**空的 —— 两页都空的话上面那条按构造成立。
    expect(menuDrawList(world()).filter((op) => op.layer === 'page')).not.toEqual([])
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

  it('special 层今天一条 op 都不出，而四页里只有三页的 drawSpecialImage 真是空的', () => {
    // ⚠️ 这一条守的是文件头注里那句话。原先写的是「四页都是空的」，实测
    // `FuncPanel` 那个不是 —— 它贴 `主人公4人2.png`（xl-a7m：文件不在那个
    // 路径下，原版自己也画不出来）。注释与实现分岔时，注释永远是绿的。
    //
    // ⚠️ **这条用例分两半，分辨力全在源码那一半。** 下面那个四页循环
    // （`special` 层为空）今天**恒真** —— `menuDrawList` 全文一处
    // `layer: 'special'` 都没 push，filter 按构造必空，换哪一页都绿
    // （/code-review 标准轴提的，属于"找不到东西就是通过条件"那一族）。
    // 它是**回归护栏**：哪天有人往 special 层塞东西，这里会响。真正在核
    // "四页有什么差别"的是上半段那个从 GBK 源码里现解的比对。
    const empty = ['DrugPanel', 'EquipPanel', 'MagicPanel'].map((file) => {
      const src = javaSource(`src/menu/${file}.java`)
      const body = /public void drawSpecialImage\(Graphics g\) \{([\s\S]*?)\n\t\}/.exec(src)
      expect(body, `${file}.drawSpecialImage 的方法体没解出来`).not.toBeNull()
      // 去掉空白与 `// TODO` 那行注释之后什么都不剩。
      return body![1]!.replace(/\/\/[^\n]*/g, '').trim()
    })
    expect(empty).toEqual(['', '', ''])
    const func = javaSource('src/menu/FuncPanel.java')
    expect(func).toContain('sources/菜单/主人公4人2.png')

    for (const panel of ['thingPanel', 'magicPanel', 'funcPanel', 'equipPanel'] as const) {
      const w = world()
      w.panel = panel
      expect(menuDrawList(w).filter((op) => op.layer === 'special'), `${panel} 的 special 层`).toEqual([])
    }
  })

  describe('物品页那一层（xl-6lo.10）', () => {
    /** 剧本 `menu-equip` 的开局：金创药 2 瓶。 */
    function thing(): MenuWorld {
      return createMenuWorld({ party: ['zhang'], fullHeal: true, drugs: [{ name: '金创药', count: 2 }] })
    }
    const pageText = (w: MenuWorld) =>
      menuDrawList(w).filter((op) => op.kind === 'text' && op.layer === 'page')

    it('清单：每种药一行，名字与数量分两列，行距 32', () => {
      const w = createMenuWorld({
        party: ['zhang'],
        fullHeal: true,
        drugs: [
          { name: '金创药', count: 2 },
          { name: '还魄丹', count: 7 },
        ],
      })
      const rows = pageText(w).slice(0, 4)
      expect(rows.map((op) => (op.kind === 'text' ? [op.text, op.x, op.y] : null))).toEqual([
        ['金创药', DRUG_LIST_X, DRUG_LIST_Y],
        ['2', DRUG_LIST_X + 180, DRUG_LIST_Y],
        ['还魄丹', DRUG_LIST_X, DRUG_LIST_Y + DRUG_ROW_H],
        ['7', DRUG_LIST_X + 180, DRUG_LIST_Y + DRUG_ROW_H],
      ])
    })

    it('存货为 0 的那几种一行都不画 —— 六种药里今天只有一种在包里', () => {
      const w = thing()
      expect(w.drugPack.length).toBeGreaterThan(1)
      const names = pageText(w).map((op) => (op.kind === 'text' ? op.text : ''))
      for (const stock of w.drugPack) {
        if (stock.count > 0) expect(names).toContain(stock.name)
        else expect(names).not.toContain(stock.name)
      }
    })

    it('「使用」按钮：没选中不画，选中之后画，贴的是当前那一态', () => {
      const w = thing()
      const images = (x: MenuWorld) =>
        menuDrawList(x).filter((op) => op.kind === 'image' && op.layer === 'page')
      expect(images(w)).toEqual([])
      // 第一行的命中带：y 从 y_start_point-32 起，x 在 (448, 578)。
      stepMenu(w, [{ e: 'move', x: DRUG_LIST_X + 1, y: DRUG_LIST_Y - DRUG_ROW_H / 2 }])
      expect(images(w)).toEqual([
        { kind: 'image', layer: 'page', id: useButtonId('normal'), x: 820, y: 418 },
      ])
      // 按在按钮上 → 第三张贴图。
      stepMenu(w, [{ e: 'press', x: 865, y: 432 }])
      expect(images(w)).toEqual([
        { kind: 'image', layer: 'page', id: useButtonId('pressed'), x: 820, y: 418 },
      ])
    })

    it('三行说明：坐标与两个字号都对回源码，选中与没选中走两支', () => {
      const src = javaSource('src/menu/DrugPanel.java')
      // 24 号那一句在 `if(currentDrug!=null)` 里面 —— 从源码里核一遍这件事，
      // 抹平成一个字号在画面上是"字大了一点"，没人会发现。
      const branch = /if\(currentDrug!=null\)\{([\s\S]*?)\}else \{/.exec(src)
      expect(branch, 'currentDrug!=null 那一支没解出来').not.toBeNull()
      expect(branch![1]).toContain('Font.BOLD, 24')
      expect(branch![1]).not.toContain('Font.BOLD, 26')

      // 坐标与字号也从源码现解 —— 这一格原先是三个手写常量在测试里被同样
      // 三个字面量复述一遍，自己证自己（/code-review 规格轴提的）。
      const intField = (name: string) => {
        const m = [...src.matchAll(new RegExp(`int\\s+${name}\\s*=\\s*(-?\\d+)\\s*;`, 'g'))]
        expect(m, `DrugPanel.java 里没解出 int ${name}`).toHaveLength(1)
        return Number(m[0]![1])
      }
      const offset = (message: string) => {
        const m = [...src.matchAll(new RegExp(`drawString\\(${message},\\s*x_message\\s*\\+\\s*(\\d+),`, 'g'))]
        expect(m, `${message} 那一行没解出偏移`).toHaveLength(1)
        return Number(m[0]![1])
      }
      const x1 = intField('x_message')
      const ys = intField('y_message')
      const xs = [x1, x1 + offset('message2'), x1 + offset('message3')]
      // 清单那一句的字号 26 —— 没选中时三行说明沿用的就是它。
      const listFont = [...src.matchAll(/new Font\("文鼎粗钢笔行楷", Font\.BOLD, 26\)/g)]
      expect(listFont, '清单那一句 26 号字没解出来').toHaveLength(1)

      const w = thing()
      const before = pageText(w).slice(-5, -2)
      expect(before.map((op) => (op.kind === 'text' ? [op.text, op.x, op.y, op.size] : null))).toEqual([
        ['没药了...', xs[0], ys, 26],
        ['快去药店买点吧~', xs[1], ys, 26],
        ['', xs[2], ys, 26],
      ])

      stepMenu(w, [{ e: 'move', x: DRUG_LIST_X + 1, y: DRUG_LIST_Y - DRUG_ROW_H / 2 }])
      const after = pageText(w).slice(-5, -2)
      expect(after.map((op) => (op.kind === 'text' ? [op.text, op.x, op.y, op.size] : null))).toEqual([
        ['金创药', xs[0], ys, 24],
        [': 生命 +300', xs[1], ys, 24],
        ['魔法 +0', xs[2], ys, 24],
      ])
    })

    it('血条：读的是物品页自己那个卷轴选中的人', () => {
      const w = createMenuWorld({ party: ['zhang', 'wen'], fullHeal: true })
      const zhang = w.heroes[0]!
      const yu = w.heroes[2]!
      // 两个人的血不同，这一条才观测得到。
      expect(zhang.hpMax).not.toBe(yu.hpMax)
      expect(pageText(w).slice(-2).map((op) => (op.kind === 'text' ? op.text : ''))).toEqual([
        `生命值:${zhang.hp}/${zhang.hpMax}`,
        `魔法值:${zhang.mp}/${zhang.mpMax}`,
      ])
      // ⚠️ 改的是**物品页**那个卷轴，不是装备页那个 —— 四页各有一个。
      w.panels.thingPanel.scoll!.whichHero = 4
      expect(pageText(w).slice(-2).map((op) => (op.kind === 'text' ? op.text : ''))).toEqual([
        `生命值:${yu.hp}/${yu.hpMax}`,
        `魔法值:${yu.mp}/${yu.mpMax}`,
      ])
      // 反方向：装备页那个卷轴动了，物品页这一层一个字都不该变。
      const other = createMenuWorld({ party: ['zhang', 'wen'], fullHeal: true })
      other.panels.equipPanel.scoll!.whichHero = 4
      expect(pageText(other).slice(-2).map((op) => (op.kind === 'text' ? op.text : ''))).toEqual([
        `生命值:${zhang.hp}/${zhang.hpMax}`,
        `魔法值:${zhang.mp}/${zhang.mpMax}`,
      ])
    })

    it('血条的坐标 / 字号 / 颜色对回 drawValueBar()', () => {
      const src = javaSource('src/menu/DrugPanel.java')
      expect(src).toContain('int x_value=107;')
      expect(src).toContain('int y_value=320;')
      expect(src).toContain('g.drawString(s2, x_value, y_value+45)')
      expect(src).toContain('g.setColor(Color.blue)')
      const bar = pageText(thing()).slice(-2)
      expect(bar[0]).toMatchObject({ x: 107, y: 320, size: 20, color: '#0000ff' })
      expect(bar[1]).toMatchObject({ x: 107, y: 365, size: 20, color: '#0000ff' })
    })

    it('物品页那三张「使用」贴图跟着当前页一起要 —— 翻到别页就不要了', () => {
      const w = thing()
      for (const image of ['normal', 'waitclick', 'pressed'] as const) {
        expect(menuTextureIds(w)).toContain(useButtonId(image))
      }
      stepMenu(w, [{ e: 'press', x: 619, y: 62 }])
      expect(w.panel).toBe('magicPanel')
      expect(menuTextureIds(w)).not.toContain(useButtonId('normal'))
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
