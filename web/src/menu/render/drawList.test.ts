import { describe, expect, it } from 'vitest'
import { javaSource } from '../../test/javaSource'
import { MAGIC_LAYOUT, MENU_LAYERS, menuDrawList } from './drawList'
import type { MenuDrawOp, MenuLayer } from './drawList'
import {
  MENU_BACKGROUND,
  drugPictureId,
  funcButtonId,
  menuTextureIds,
  mouseId,
  tabId,
  useButtonId,
} from './assets'
import { DRUGS } from '../../battle/drugs'
import { DRUG_LIST_X, DRUG_LIST_Y, DRUG_ROW_H } from '../drugPanel'
import { FUNC_MAIN_ORDER, FUNC_SUB_ORDER } from '../funcButtons'
import {
  MAGIC_BUTTON_H,
  MAGIC_BUTTON_W,
  MAGIC_BUTTON_X,
  magicButtonY,
} from '../magic'
import { MAGIC_SKILL_DESCRIPTIONS, magicAnimationFrameId, magicSkillButtonId } from './magicSkills'
import { HEAD_H, HEAD_POS, HEAD_W } from '../layout'
import { hitCenter } from '../test/hitCenter'
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

  it('四页的 page 层现在都不空了 —— 这条一红就说明哪一页的绘制掉了', () => {
    // ⚠️ 这条原先是反过来写的（「还没做的那几页 page 层是空的」）。四页做完之后
    // 那个对象不存在了，而**留着它等于留一条按构造成立的断言**：没有任何一页
    // 还该是空的。换成正向之后，「这一页归别人」与「menuDrawList 的 page 层
    // 整个坏了」不再长得一样。
    for (const [tabX, panel] of [
      [411, 'thingPanel'],
      [619, 'magicPanel'],
      [515, 'equipPanel'],
      [723, 'funcPanel'],
    ] as const) {
      const w = world()
      if (panel !== 'thingPanel') stepMenu(w, [{ e: 'press', x: tabX, y: 62 }])
      expect(w.panel).toBe(panel)
      expect(menuDrawList(w).filter((op) => op.layer === 'page'), `${panel} 的 page 层`).not.toEqual(
        [],
      )
    }
  })

  it('装备页 page 层不空了（xl-6lo.9）—— 上面那两条才有分辨力', () => {
    // 没有这一条的话，「这一页归别人」与「menuDrawList 的 page 层整个坏了」
    // 长得一样：两者都是空数组。
    const w = world()
    stepMenu(w, [{ e: 'press', x: 515, y: 62 }])
    expect(w.panel).toBe('equipPanel')
    expect(menuDrawList(w).filter((op) => op.layer === 'page').length).toBeGreaterThan(0)
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
      // ⚠️ 选中之后 `page` 层的图有**两张**：按钮，加上那瓶药的插图
      // （xl-6lo.15）。这一条整份列出来而不是只挑按钮 —— 只挑一张的话，
      // 哪天插图掉了这里照样绿。
      stepMenu(w, [{ e: 'move', x: DRUG_LIST_X + 1, y: DRUG_LIST_Y - DRUG_ROW_H / 2 }])
      expect(images(w)).toEqual([
        { kind: 'image', layer: 'page', id: useButtonId('normal'), x: 820, y: 418 },
        { kind: 'image', layer: 'page', id: drugPictureId(DRUGS[0]!), x: 820, y: 178 },
      ])
      // 按在按钮上 → 第三张贴图。
      stepMenu(w, [{ e: 'press', x: 865, y: 432 }])
      expect(images(w)).toEqual([
        { kind: 'image', layer: 'page', id: useButtonId('pressed'), x: 820, y: 418 },
        { kind: 'image', layer: 'page', id: drugPictureId(DRUGS[0]!), x: 820, y: 178 },
      ])
    })

    describe('选中那瓶药的插图（xl-6lo.15）', () => {
      /** `page` 层那一串 op 的 kind 序列 —— 插图夹在清单与三行说明中间。 */
      const pageOps = (w: MenuWorld) => menuDrawList(w).filter((op) => op.layer === 'page')

      it('落点与图路径都对回源码：x_picture / y_picture + drug.txt 第 4 列', () => {
        const src = javaSource('src/menu/DrugPanel.java')
        // 那一句本身：图是 `currentDrug.getPicture()`，落点是那两个字段。
        expect(src).toContain('g.drawImage(currentDrug.getPicture(), x_picture, y_picture, this)')
        const intField = (name: string) => {
          const m = [...src.matchAll(new RegExp(`int\\s+${name}\\s*=\\s*(-?\\d+)\\s*;`, 'g'))]
          expect(m, `DrugPanel.java 里没解出 int ${name}`).toHaveLength(1)
          return Number(m[0]![1])
        }
        // 图路径由 `ShopReader.readDrug()` 拼 —— 前缀与列号都从 GBK 源码里现读，
        // 免得这一层的 ID 自己证自己。
        const shop = javaSource('src/shop/ShopReader.java')
        const dir = /new ImageIcon\("([^"]+)"\s*\n?\s*\+ lineArray\[(\d)\]\)/.exec(shop)
        expect(dir, 'ShopReader.readDrug 里那句拼图片路径没解出来').not.toBeNull()
        expect(dir![1]).toBe('sources/Shop/药品/回复类/')
        expect(Number(dir![2])).toBe(3)

        const w = thing()
        stepMenu(w, [{ e: 'move', x: DRUG_LIST_X + 1, y: DRUG_LIST_Y - DRUG_ROW_H / 2 }])
        const picture = pageOps(w).filter(
          (op) => op.kind === 'image' && op.id.startsWith('drug:'),
        )
        expect(picture).toEqual([
          {
            kind: 'image',
            layer: 'page',
            // `drug:` + `drug.txt` 第 4 列那个文件名，扩展名留着。
            id: `drug:${DRUGS[0]!.picture}`,
            x: intField('x_picture'),
            y: intField('y_picture'),
          },
        ])
      })

      it('没选中的时候一张插图都不画 —— 原版那句在 if(currentDrug!=null) 里', () => {
        const w = thing()
        expect(w.panels.thingPanel.drug!.currentDrug).toBeNull()
        expect(pageOps(w).filter((op) => op.kind === 'image' && op.id.startsWith('drug:'))).toEqual(
          [],
        )
      })

      it('换一瓶药就换一张图 —— 六种药的文件名各不相同', () => {
        expect(new Set(DRUGS.map((d) => d.picture)).size).toBe(DRUGS.length)
        const w = createMenuWorld({
          party: ['zhang'],
          fullHeal: true,
          drugs: [
            { name: '金创药', count: 1 },
            { name: '灵神天药', count: 1 },
          ],
        })
        const idOfPicture = () => {
          const op = pageOps(w).find((x) => x.kind === 'image' && x.id.startsWith('drug:'))
          return op && op.kind === 'image' ? op.id : null
        }
        stepMenu(w, [{ e: 'move', x: DRUG_LIST_X + 1, y: DRUG_LIST_Y - DRUG_ROW_H / 2 }])
        expect(idOfPicture()).toBe(drugPictureId(DRUGS[0]!))
        // 第二行（清单只画存货 >0 的那两种，第二行是灵神天药）。
        stepMenu(w, [
          { e: 'move', x: DRUG_LIST_X + 1, y: DRUG_LIST_Y + DRUG_ROW_H - DRUG_ROW_H / 2 },
        ])
        expect(idOfPicture()).toBe(drugPictureId(DRUGS[5]!))
        expect(drugPictureId(DRUGS[5]!)).not.toBe(drugPictureId(DRUGS[0]!))
      })

      it('次序照原版：清单画完、三行说明之前', () => {
        const w = thing()
        stepMenu(w, [{ e: 'move', x: DRUG_LIST_X + 1, y: DRUG_LIST_Y - DRUG_ROW_H / 2 }])
        const ops = pageOps(w)
        const picture = ops.findIndex((op) => op.kind === 'image' && op.id.startsWith('drug:'))
        const lastRow = ops.map((op) => (op.kind === 'text' ? op.text : '')).lastIndexOf('2')
        // ⚠️ 认第二行说明，不认第一行 —— 第一行说明的字与清单那一行的药名
        // **逐字相同**（都是「金创药」），拿它找下标会撞上清单那一行，
        // 于是这条次序断言读出来是"插图排在说明后面"。
        const message = ops.findIndex((op) => op.kind === 'text' && op.text === ': 生命 +300')
        expect(picture, '插图没画').toBeGreaterThan(-1)
        expect(lastRow, '清单那一行没画').toBeGreaterThan(-1)
        expect(message, '三行说明第一行没画').toBeGreaterThan(-1)
        expect(lastRow).toBeLessThan(picture)
        expect(picture).toBeLessThan(message)
      })

      it('六张插图跟着物品页一起要过来，不等到选中才取', () => {
        const w = thing()
        const ids = menuTextureIds(w)
        // 分母是 `DRUGS`，不是手写的六。
        for (const drug of DRUGS) expect(ids).toContain(drugPictureId(drug))
        // 开局一瓶都没选中，而图已经在要的名单里 —— 这一条守的正是"别等到
        // 选中才取"。
        expect(w.panels.thingPanel.drug!.currentDrug).toBeNull()
        // 翻到别页就不要了。
        stepMenu(w, [{ e: 'press', x: 619, y: 62 }])
        expect(w.panel).toBe('magicPanel')
        expect(menuTextureIds(w)).not.toContain(drugPictureId(DRUGS[0]!))
      })
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

/**
 * 奇术页那一层（xl-6lo.11）。
 *
 * 落点与"哪一颗亮着"由状态层说了算，这里核的是**它照着 `drawThisPanel()`
 * 摊出来的那一串**：按钮在前、说明两行、动画一帧在后。
 */
describe('奇术页的 page 层', () => {
  /**
   * 一条说明的绘制条目。`skillIndex` 是 0 基的招号、`line` 是第几行 ——
   * 落点由 `MAGIC_LAYOUT` 算，而 `MAGIC_LAYOUT` 自己由下面那条对回 GBK 源码。
   */
  function textOp(text: string, skillIndex: number, line: number): MenuDrawOp {
    return {
      kind: 'text',
      layer: 'page',
      text,
      x: MAGIC_LAYOUT.textX,
      y: MAGIC_LAYOUT.textY + skillIndex * MAGIC_LAYOUT.textVgap + line * MAGIC_LAYOUT.textLine,
      size: MAGIC_LAYOUT.fontSize,
      color: MAGIC_LAYOUT.color,
    }
  }

  it('那七个数对回原版 —— 四个在 MagicPanel、三个在 MagicAnimation', () => {
    // ⚠️ 不对源码的话，期望值那一侧只能重抄一遍同样的字面量：**两侧都是
    // 这一次的转写，抄错了两边一起错**。顶栏那行字的判据一直是这么写的
    // （见上面「对回 drawCommand()」那条），奇术页这一层原先漏了。
    const panel = javaSource('src/menu/MagicPanel.java')
    const body = panel.slice(panel.indexOf('private void addMagicAnimation'))
    const locals = /int x=([\d+]+),y=(\d+);[\s\S]{0,80}?int a=(\d+);[\s\S]{0,40}?int b=(\d+);[\s\S]{0,40}?int vgap=(\d+);/.exec(
      body,
    )
    expect(locals, 'addMagicAnimation() 里那几个局部常量没解出来').not.toBeNull()
    const sum = (expr: string) => expr.split('+').map(Number).reduce((a, b) => a + b, 0)
    expect(MAGIC_LAYOUT.animX).toBe(sum(locals![1]!))
    expect(MAGIC_LAYOUT.animY).toBe(Number(locals![2]))
    expect(MAGIC_LAYOUT.textX).toBe(Number(locals![3]))
    expect(MAGIC_LAYOUT.textY).toBe(Number(locals![4]))
    expect(MAGIC_LAYOUT.textVgap).toBe(Number(locals![5]))

    const anim = javaSource('src/menu/MagicAnimation.java')
    const font = /new Font\("[^"]*", Font\.BOLD, (\d+)\)/.exec(anim)
    expect(font, 'drawMagicAnimation 里的字号没解出来').not.toBeNull()
    expect(MAGIC_LAYOUT.fontSize).toBe(Number(font![1]))
    const second = /y_discription\+(\d+)\)/.exec(anim)
    expect(second, '第二行的行距没解出来').not.toBeNull()
    expect(MAGIC_LAYOUT.textLine).toBe(Number(second![1]))
    // 颜色只有一处 `g.setColor(Color.white)`。
    expect(anim).toContain('g.setColor(Color.white)')
    expect(MAGIC_LAYOUT.color).toBe('#ffffff')

    // 贴图那一句用的正是 AnimationX / AnimationY，不是别的两个数。
    expect(anim).toContain('g.drawImage(image, AnimationX, AnimationY, fp)')
  })

  /** 点开奇术页并放第一招。坐标从原版的命中判据算，不手写。 */
  function playing(): MenuWorld {
    const w = createMenuWorld({ party: ['zhang'], fullHeal: true })
    stepMenu(w, [{ e: 'press', x: 619, y: 62 }])
    stepMenu(w, [{ e: 'release', x: 619, y: 62 }])
    const [x, y] = hitCenter(MAGIC_BUTTON_X, magicButtonY(0), MAGIC_BUTTON_W, MAGIC_BUTTON_H)
    stepMenu(w, [{ e: 'press', x, y }])
    if (!w.panels.magicPanel.magic!.current) throw new Error('没点中第一颗技能按钮')
    return w
  }

  it('只画得出来那几颗 —— 张小凡两个 skillNumber 只亮一颗（原版那个重叠的循环）', () => {
    const w = createMenuWorld({ party: ['zhang'], fullHeal: true })
    stepMenu(w, [{ e: 'press', x: 619, y: 62 }])
    const page = menuDrawList(w).filter((op) => op.layer === 'page')
    expect(page).toEqual([
      {
        kind: 'image',
        layer: 'page',
        // 贴的是**常态**那一张：切页那一按落在页签上，技能按钮那一组
        // `isPressedButton` 没命中，而没命中时原版把贴图拨回 normal。
        id: magicSkillButtonId(1, 1, 'normal'),
        x: MAGIC_BUTTON_X,
        y: magicButtonY(0),
      },
    ])
  })

  it('放着动画时：按钮在前，说明两行、动画一帧在后', () => {
    const w = playing()
    const anim = w.panels.magicPanel.magic!.current!
    const page = menuDrawList(w).filter((op) => op.layer === 'page')
    const lines = MAGIC_SKILL_DESCRIPTIONS[1][anim.skill - 1]!
    expect(page).toEqual([
      {
        kind: 'image',
        layer: 'page',
        id: magicSkillButtonId(1, 1, 'pressed'),
        x: MAGIC_BUTTON_X,
        y: magicButtonY(0),
      },
      textOp(lines[0], 0, 0),
      textOp(lines[1], 0, 1),
      {
        kind: 'image',
        layer: 'page',
        id: magicAnimationFrameId(anim.hero, anim.skill, anim.code),
        x: MAGIC_LAYOUT.animX,
        y: MAGIC_LAYOUT.animY,
      },
    ])
  })

  it('说明的落点由招号决定 —— 玉洁的第二招落在第二行的位置上', () => {
    // ⚠️ 只用第一招是核不到这一条的：`(招号-1)*64` 在招号 1 上恒为 0，
    // 把那一项整个抹掉照样绿（实测：篡改矩阵的 R2 头一轮就是这么绿的）。
    // 所以这一条特意挑一个招号 ≠ 1 的，而且要挑一个**画得出两颗按钮**的人
    // —— 玉洁的 skillNumber 是 3，重叠那个循环之后亮两颗。
    const w = createMenuWorld({ party: ['zhang', 'lu', 'wen'], fullHeal: true })
    stepMenu(w, [{ e: 'press', x: 619, y: 62 }])
    stepMenu(w, [{ e: 'release', x: 619, y: 62 }])
    const head4 = HEAD_POS.find((h) => h.hero === 4)!
    const [hx, hy] = hitCenter(head4.x, head4.y, HEAD_W, HEAD_H)
    stepMenu(w, [{ e: 'move', x: hx, y: hy }])
    stepMenu(w, [{ e: 'press', x: hx, y: hy }])
    stepMenu(w, [{ e: 'release', x: hx, y: hy }])
    expect(w.panels.magicPanel.scoll!.whichHero).toBe(4)

    const [x, y] = hitCenter(MAGIC_BUTTON_X, magicButtonY(1), MAGIC_BUTTON_W, MAGIC_BUTTON_H)
    stepMenu(w, [{ e: 'press', x, y }])
    const anim = w.panels.magicPanel.magic!.current
    expect(anim, `(${x},${y}) 没点中玉洁的第二颗技能按钮`).not.toBeNull()
    expect(anim!.skill).toBe(2)

    const texts = menuDrawList(w).filter((op) => op.layer === 'page' && op.kind === 'text')
    const lines = MAGIC_SKILL_DESCRIPTIONS[4][1]!
    expect(texts).toEqual([textOp(lines[0], 1, 0), textOp(lines[1], 1, 1)])
  })

  it('动画那一帧跟着 code 走 —— 推一拍换一张', () => {
    const w = playing()
    const anim = w.panels.magicPanel.magic!.current!
    const frameOf = () => {
      const ops = menuDrawList(w).filter((op) => op.layer === 'page' && op.kind === 'image')
      return (ops[ops.length - 1] as { id: string }).id
    }
    expect(frameOf()).toBe(magicAnimationFrameId(anim.hero, anim.skill, 1))
    stepMenu(w, [{ e: 'tick' }])
    expect(frameOf()).toBe(magicAnimationFrameId(anim.hero, anim.skill, 2))
  })

  it('没有动画在放时，说明一个字都不画', () => {
    const w = createMenuWorld({ party: ['zhang'], fullHeal: true })
    stepMenu(w, [{ e: 'press', x: 619, y: 62 }])
    expect(w.panels.magicPanel.magic!.current, '切进这一页那一按会把动画清空').toBeNull()
    expect(menuDrawList(w).filter((op) => op.layer === 'page' && op.kind === 'text')).toEqual([])
  })

  it('这一帧的贴图名单里有十五颗按钮，动画的帧整条一起要', () => {
    const w = playing()
    const anim = w.panels.magicPanel.magic!.current!
    const ids = menuTextureIds(w)
    // 清单上出现的每一张都必须在名单里 —— 少一张的表现是渲染器当场抛，
    // 而"少推了一条"与"这一帧本来就不画它"在别处看不出来。
    for (const op of menuDrawList(w)) {
      if (op.kind === 'image') expect(ids, `名单里没有 ${op.id}`).toContain(op.id)
    }
    // 整条都在（不是只有当前那一帧）。
    expect(ids).toContain(magicAnimationFrameId(anim.hero, anim.skill, anim.length))
  })

  it('不在奇术页时，名单里一张技能按钮都没有', () => {
    const w = createMenuWorld({ party: ['zhang'], fullHeal: true })
    expect(menuTextureIds(w)).not.toContain(magicSkillButtonId(1, 1, 'normal'))
  })
})
