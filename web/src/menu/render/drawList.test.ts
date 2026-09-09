import { describe, expect, it } from 'vitest'
import { javaSource } from '../../test/javaSource'
import { MAGIC_LAYOUT, MENU_LAYERS, menuDrawList } from './drawList'
import type { MenuDrawOp, MenuLayer } from './drawList'
import { MENU_BACKGROUND, funcButtonId, menuTextureIds, mouseId, tabId } from './assets'
import { MAGIC_SKILL_DESCRIPTIONS, magicAnimationFrameId, magicSkillButtonId } from './magicSkills'
import {
  MAGIC_BUTTON_H,
  MAGIC_BUTTON_W,
  MAGIC_BUTTON_X,
  magicButtonY,
} from '../magic'
import { FUNC_MAIN_ORDER, FUNC_SUB_ORDER } from '../funcButtons'
import { SCOLL_HEROES } from '../types'
import { MENU_HERO_ORDER } from '../heroes'
import { HEAD_H, HEAD_POS, HEAD_W } from '../layout'
import { stepMenu } from '../step'
import { hitCenter } from '../test/hitCenter'
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

  it('物品页与装备页的 page 层还是空的 —— 那两页归 xl-6lo.10 / .9', () => {
    const w = world()
    expect(menuDrawList(w).filter((op) => op.layer === 'page')).toEqual([])
    // 装备页。
    stepMenu(w, [{ e: 'press', x: 515, y: 62 }])
    expect(w.panel).toBe('equipPanel')
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
