import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { SKILL_NUMBER } from '../battle/skills'
import { HEROES } from '../battle/units'
import { HEAD_H, HEAD_POS, HEAD_W } from './layout'
import { advanceMenu, createMenuTicker } from './loop'
import {
  MAGIC_ANIMATION_LENGTHS,
  MAGIC_BUTTON_COUNT,
  MAGIC_BUTTON_H,
  MAGIC_BUTTON_W,
  MAGIC_BUTTON_X,
  MAGIC_HEROES,
  magicButtonY,
} from './magic'
import { snapshotMenu } from './snapshot'
import { hitCenter } from './test/hitCenter'
import { stepMenu } from './step'
import { MENU_TRACE_NAMES, readMenuTrace } from './trace'
import { createMenuWorld } from './world'
import type { MenuWorld } from './types'

const SOURCE = 'src/menu/MagicPanel.java'

/** 只取 `addMagicButton()` 那一段，别把 `addMagicAnimation()` 的数混进来。 */
function methodBody(name: string): string {
  const source = javaSource(SOURCE)
  const at = source.indexOf(`private void ${name}(`)
  expect(at, `${SOURCE} 里没找到 ${name}()`).toBeGreaterThan(-1)
  const next = source.indexOf('\n\tprivate ', at + 1)
  const end = next < 0 ? source.length : next
  const body = source.slice(at, end)
  expect(body.length, `${name}() 截出来是空的`).toBeGreaterThan(200)
  return body
}

describe('奇术页的按钮几何，对回原版', () => {
  const body = methodBody('addMagicButton')

  /** `int x=320+12;` 这种：只有 `a` 或 `a+b` 两种形状，多的形状要报错不要静默。 */
  function localInt(name: string): number {
    const matches = [...body.matchAll(new RegExp(`int\\s+${name}\\s*=\\s*([\\d+]+)\\s*;`, 'g'))]
    expect(matches, `addMagicButton() 里没解出 ${name} 的初始化式`).toHaveLength(1)
    return matches[0]![1]!
      .split('+')
      .map(Number)
      .reduce((a, b) => a + b, 0)
  }

  it('x / width / height 抄的是那三个局部常量', () => {
    expect(MAGIC_BUTTON_X).toBe(localInt('x'))
    expect(MAGIC_BUTTON_W).toBe(localInt('width'))
    expect(MAGIC_BUTTON_H).toBe(localInt('height'))
  })

  it('五颗按钮的 y 是 y + i*(height+vgap)，i 从 0 数到 4 —— 四组各一遍', () => {
    // 原版的 y 是**写在构造函数入参里的算式**，五种形状各不相同。把这五种
    // 形状解出来再对，比重抄一遍数字硬：抄错一个 vgap 的表现是"按钮挤在
    // 一起"，而那要看图才发现。
    const y = localInt('y')
    const height = localInt('height')
    const vgap = localInt('vgap')
    const forms = [...body.matchAll(/new MenuButton\(x,\s*([^,]+?),\s*width,\s*height,/g)].map(
      (m) => m[1]!.replace(/\s+/g, ''),
    )
    // 四组 × 五颗 = 20 颗，宋大仁那一组也在源码里（这一层不建他，见 magic.ts）。
    expect(forms, 'addMagicButton() 里的 new MenuButton 条数').toHaveLength(20)
    const expected = ['y', 'y+height+vgap', 'y+2*(height+vgap)', 'y+3*(height+vgap)', 'y+4*(height+vgap)']
    for (let group = 0; group < 4; group++) {
      expect(forms.slice(group * 5, group * 5 + 5), `第 ${group} 组的 y 算式`).toEqual(expected)
    }
    for (let i = 0; i < MAGIC_BUTTON_COUNT; i++) {
      expect(magicButtonY(i), `第 ${i} 颗`).toBe(y + i * (height + vgap))
    }
  })

  it('每个人恒有五颗按钮 —— 与等级、与 skillNumber 都无关', () => {
    // 建的颗数是死的，**画得出来几颗**才由 skillNumber 说了算。两件事写在
    // 一起的话，"少建了一颗"与"少画了一颗"就分不开了。
    //
    // 分母从源码推（`toBe(5)` 是字面量对字面量，源码改了它不会响）：
    // `addMagicButton()` 建了 20 颗、四组，每组就是这个数。
    const built = [...body.matchAll(/new MenuButton\(x,/g)].length
    expect(built, 'addMagicButton() 里的 new MenuButton 条数').toBe(20)
    expect(MAGIC_BUTTON_COUNT).toBe(built / 4)
  })
})

describe('十五条技能动画的帧数，对回原版', () => {
  it('逐条对上 addMagicAnimation() 里那三个入参', () => {
    const body = methodBody('addMagicAnimation')
    const built = [...body.matchAll(/new MagicAnimation\((\d+),\s*(\d+),\s*(\d+),/g)].map((m) => ({
      hero: Number(m[1]),
      skill: Number(m[2]),
      length: Number(m[3]),
    }))
    // 空匹配是这类判据最常见的假绿（GBK 解码错、方法被挪走都长这样）。
    expect(built.length, 'addMagicAnimation() 里没解出 new MagicAnimation').toBeGreaterThan(0)

    const ported = MAGIC_HEROES.flatMap(({ hero }) =>
      MAGIC_ANIMATION_LENGTHS[hero].map((length, i) => ({ hero, skill: i + 1, length })),
    )
    expect(built).toEqual(ported)
  })

  it('宋大仁一条动画都没建 —— 所以这一层不建他', () => {
    const body = methodBody('addMagicAnimation')
    expect(body).not.toMatch(/new MagicAnimation\(3,/)
    expect(MAGIC_HEROES.map((h) => h.hero)).toEqual([1, 2, 4])
  })

  it('开局那条动画是最后建的那一条 —— currentAnimation 是个没清掉的临时变量', () => {
    const body = methodBody('addMagicAnimation')
    const built = [...body.matchAll(/new MagicAnimation\((\d+),\s*(\d+),\s*(\d+),/g)]
    const last = built[built.length - 1]!
    const w = createMenuWorld({ party: ['zhang'], fullHeal: true })
    const current = w.panels.magicPanel.magic!.current
    expect(current, '开局 currentAnimation 不该是 null').not.toBeNull()
    expect({ hero: current!.hero, skill: current!.skill, length: current!.length }).toEqual({
      hero: Number(last[1]),
      skill: Number(last[2]),
      length: Number(last[3]),
    })
    expect(current!.code).toBe(1)
  })
})

/**
 * 「按钮颗数由那三个 static 字段决定、不由等级决定」——**拿一个等级远高于
 * 初值的角色核一次**（票面那条验收）。
 *
 * 这条会红的样子长这样：把 `magicDrawThisPanel` 里的 `SKILL_NUMBER[...]`
 * 换成 `w.heroes[i].level`，等级 1 的两个人碰巧不变，而下面这个 20 级的
 * 张小凡会画出五颗（`visible` 全 true）——实测就是这么红的。
 */
describe('画几颗按钮由 skillNumber 说了算，不由等级', () => {
  function magicVisible(level: number): Record<string, boolean[]> {
    const live = { zhang: { level, ...HEROES.zhang.attributes(level), hp: 99999, mp: 99999 } }
    const w = createMenuWorld({ party: ['zhang', 'lu', 'wen'], fullHeal: true, live })
    // 切到奇术页：那一次按下之后紧跟着的 paint 才会现设 isDraw。
    stepMenu(w, [{ e: 'press', x: 619, y: 62 }])
    expect(w.panel).toBe('magicPanel')
    return (snapshotMenu(w).magic as { visible: Record<string, boolean[]> }).visible
  }

  it('20 级的张小凡与 1 级的张小凡，按钮画得出来的是同样几颗', () => {
    const low = createMenuWorld({ party: ['zhang'], fullHeal: true })
    expect(low.heroes[0]!.level, '前提：出厂等级不是 20').not.toBe(20)
    const high = createMenuWorld({
      party: ['zhang'],
      fullHeal: true,
      live: { zhang: { level: 20, ...HEROES.zhang.attributes(20), hp: 99999, mp: 99999 } },
    })
    // 前提要自己站得住：等级真的高了、属性真的跟着变了。这两条不断言的话，
    // 下面那条"两者相等"可能只是因为 live 根本没生效。
    expect(high.heroes[0]!.level).toBe(20)
    expect(high.heroes[0]!.hpMax).toBeGreaterThan(low.heroes[0]!.hpMax)

    expect(magicVisible(20)).toEqual(magicVisible(low.heroes[0]!.level))
  })

  it('画得出来的颗数是 skillNumber-1（原版那两个循环重叠了一格）', () => {
    const visible = magicVisible(20)
    const zhang = visible[MAGIC_HEROES[0]!.name]!
    expect(zhang.filter(Boolean)).toHaveLength(SKILL_NUMBER.zhang - 1)
    // 另外两个人**一颗都不画** —— 只有当前卷轴角色那一组画得出来。
    for (const { name } of MAGIC_HEROES.slice(1)) {
      expect(visible[name]!.filter(Boolean), `${name} 不是当前角色`).toHaveLength(0)
    }
  })
})

/**
 * 逐拍核那条最长的技能动画：**帧数现数，从真值上读**，不写死 37。
 *
 * 三件事一起核，缺一件这条就变松：动画每拍加一帧、末帧那一拍被撤下、
 * 撤下时动画对象自己的帧号被拨回起点（那一条真值记不到 —— 动画一撤下
 * `magic.animation` 就是 `null` —— 所以要读状态）。
 */
describe('技能动画逐拍推进', () => {
  /** 真值里第一次「上一拍还没有动画、这一拍有了」的那个位置。 */
  function firstStart(name: string) {
    const trace = readMenuTrace(name)
    const animOf = (i: number) =>
      (trace.ticks[i]!.magic as { animation: { code: number; length: number } | null }).animation
    for (let i = 1; i < trace.ticks.length; i++) {
      const before = animOf(i - 1)
      const now = animOf(i)
      if (!before && now) return { trace, at: i, animation: now }
    }
    return null
  }

  const started = MENU_TRACE_NAMES.map(firstStart).filter((s) => s !== null)

  it('真值里至少有一条动画是从头放起的 —— 没有的话下面那条一个断言都不跑', () => {
    expect(started.length).toBeGreaterThan(0)
  })

  for (const start of started) {
    const { trace, at, animation } = start!
    it(`${trace.script.name} 第 ${at} 步起那条 ${animation.length} 帧动画，逐拍走到撤下`, () => {
      const animOf = (i: number) =>
        (trace.ticks[i]!.magic as { animation: { code: number; length: number } | null }).animation
      // 从起点数到它变成 null 的那一拍。分母是数出来的，不是写下来的。
      let end = at
      while (end < trace.ticks.length && animOf(end)) end++
      expect(end, '这条动画在真值里没走完').toBeLessThan(trace.ticks.length)

      // 起点 1；**只有 tick 那种一步才推帧**（菜单真值把"一次输入"与"一次
      // 循环体"摆在同一列 `input` 里 —— 中间那几步松开是不推的，按步号
      // 直接算帧号会错开一格，实测就是这么红的）。
      expect(animOf(at)!.code).toBe(1)
      let ticks = 0
      for (let i = at; i < end; i++) {
        const isTick = trace.ticks[i]!.input.some((e) => e.e === 'tick')
        // 起手那一步是按下，它不推帧；此后每个 tick 推一帧，非 tick 不推。
        if (i > at && isTick) ticks++
        expect(animOf(i)!.code, `第 ${i} 步的帧号`).toBe(1 + ticks)
      }
      expect(animOf(end - 1)!.code).toBe(animation.length - 1)
      expect(animOf(end)).toBeNull()
      // 一整条动画占 length-1 拍：`update()` 推到 length 的那一拍同时撤下，
      // 所以末帧**画不出来**。撤下的那一拍也是个 tick，所以要加一。
      expect(trace.ticks[end]!.input.some((e) => e.e === 'tick'), '撤下的那一步是个 tick').toBe(true)
      expect(ticks + 1).toBe(animation.length - 1)
    })
  }

  it('撤下时帧号被拨回起点 —— 同一条技能再点一次是从头放的', () => {
    const w = playFirstSkill()
    const magic = w.panels.magicPanel.magic!
    const anim = magic.current!
    const { length } = anim
    for (let i = 0; i < length - 1; i++) stepMenu(w, [{ e: 'tick' }])
    expect(magic.current, `走满 ${length - 1} 拍之后动画该撤下`).toBeNull()
    // 动画对象还在（原版建好就不再 new），帧号回到 1。
    expect(anim.code).toBe(1)
    expect(magic.animations[1]![0]).toBe(anim)
  })
})

/**
 * 「进这一页的那一次按下会把当前动画清空」——**一拍之内的事**，单独核。
 *
 * 它藏在 `MenuPanel.mousePressed` 的三行里：切页发生在第二行，第三行那次
 * 派发落在**新的**那一页上，于是 `MagicPanel.checkAllButtonPressed` 里那句
 * 无条件的 `currentAnimation=null` 就跑了。按整条比对是抓不到的 —— 它与
 * "开局那条动画自己走完了"在往后每一拍上长得一模一样。
 */
describe('切进奇术页的那一次按下会把当前动画清空', () => {
  it('按下之前有动画在放，按下之后没有 —— 就这一拍', () => {
    const w = createMenuWorld({ party: ['zhang'], fullHeal: true })
    const magic = w.panels.magicPanel.magic!
    // 先在别的页上推两拍，让开局那条动画真的在走（不然"清空了"与"本来就
    // 停着"分不开）。
    stepMenu(w, [{ e: 'tick' }])
    stepMenu(w, [{ e: 'tick' }])
    expect(w.panel).not.toBe('magicPanel')
    expect(magic.current, '前提：按下之前有一条动画在放').not.toBeNull()
    expect(magic.current!.code).toBeGreaterThan(1)

    stepMenu(w, [{ e: 'press', x: 619, y: 62 }])
    expect(w.panel).toBe('magicPanel')
    expect(magic.current).toBeNull()
  })

  it('已经在奇术页上了，松开之后按在空处同样清空', () => {
    const w = playFirstSkill()
    const magic = w.panels.magicPanel.magic!
    const [bx, by] = hitCenter(MAGIC_BUTTON_X, magicButtonY(0), MAGIC_BUTTON_W, MAGIC_BUTTON_H)
    stepMenu(w, [{ e: 'release', x: bx, y: by }])
    expect(magic.current).not.toBeNull()
    // 按在按钮之外的一处（技能按钮那一列在 x=332 起、宽 220 一带）。
    stepMenu(w, [{ e: 'press', x: 20, y: 600 }])
    expect(magic.current).toBeNull()
  })

  it('⚠️ 没松开就按在空处，动画会被**重新接上** —— 原版如此，不是笔误', () => {
    // `isPressedButton` 没命中时只把贴图拨回常态、**不清 isclicked**，而清
    // isclicked 的只有松开。于是那句 `currentAnimation=null` 刚清完，紧接着
    // 的 isclicked 扫描又把同一条接了回去，并且**再出一次声**。
    const w = playFirstSkill()
    const magic = w.panels.magicPanel.magic!
    const anim = magic.current!
    stepMenu(w, [{ e: 'press', x: 20, y: 600 }])
    expect(magic.current).toBe(anim)
    expect(w.music).toEqual([MAGIC_HEROES[0]!.sound])
  })
})

/**
 * 「什么都不点时动画照样往前走」——与骨架那条循环（`loop.ts`）合起来验。
 *
 * 这一条与 `stepMenu(w,[{e:'tick'}])` 那条**不是同一件事**：那条证明"推一拍
 * 会动"，这条证明"没有任何输入到达时也会有人去推"。做成纯事件驱动的话前者
 * 照样绿。
 */
describe('没有任何输入时，动画照样往前走', () => {
  it('只让时间流逝，帧号跟着涨', () => {
    const w = playFirstSkill()
    const magic = w.panels.magicPanel.magic!
    const before = magic.current!.code
    const ticker = createMenuTicker(w)
    // 十拍的时间，一次输入都不给。
    advanceMenu(ticker, [], 10 * 100)
    expect(magic.current!.code).toBe(before + 10)
  })

  it('走满整条之后自己撤下，仍然一次输入都没有', () => {
    const w = playFirstSkill()
    const magic = w.panels.magicPanel.magic!
    const { length } = magic.current!
    const ticker = createMenuTicker(w)
    advanceMenu(ticker, [], (length - 1) * 100)
    expect(magic.current).toBeNull()
  })
})

/**
 * 点第一颗技能按钮：坐标**从原版的命中判据算出来**，并与真值里那一步的落点
 * 对一遍 —— 手写一个"点得中"的坐标，几何抄错了它也照样点得中。
 */
function playFirstSkill(): MenuWorld {
  const w = createMenuWorld({ party: ['zhang'], fullHeal: true })
  stepMenu(w, [{ e: 'press', x: 619, y: 62 }])
  stepMenu(w, [{ e: 'release', x: 619, y: 62 }])
  const [x, y] = hitCenter(MAGIC_BUTTON_X, magicButtonY(0), MAGIC_BUTTON_W, MAGIC_BUTTON_H)
  stepMenu(w, [{ e: 'press', x, y }])
  const magic = w.panels.magicPanel.magic!
  if (!magic.current) throw new Error(`(${x},${y}) 没点中第一颗技能按钮`)
  return w
}

describe('第一颗技能按钮的落点与真值一致', () => {
  it('真值里那一步按的正是这个坐标', () => {
    const trace = readMenuTrace('menu-magic')
    const presses = trace.ticks
      .flatMap((t) => t.input)
      .filter((i): i is { e: 'press'; x: number; y: number; target?: string } => i.e === 'press')
      .filter((i) => i.target === 'skill:1')
    expect(presses, 'menu-magic 里没有 skill:1 那一按').toHaveLength(1)
    const [x, y] = hitCenter(MAGIC_BUTTON_X, magicButtonY(0), MAGIC_BUTTON_W, MAGIC_BUTTON_H)
    expect([presses[0]!.x, presses[0]!.y]).toEqual([x, y])
  })

  it('点中之后出的是那个人的那一声', () => {
    const w = playFirstSkill()
    expect(w.music).toEqual([MAGIC_HEROES[0]!.sound])
  })

  it('松开会把 isclicked 清掉 —— 否则下一次按下会把动画凭空放第二遍', () => {
    const w = playFirstSkill()
    const magic = w.panels.magicPanel.magic!
    const [x, y] = hitCenter(MAGIC_BUTTON_X, magicButtonY(0), MAGIC_BUTTON_W, MAGIC_BUTTON_H)
    stepMenu(w, [{ e: 'release', x, y }])
    expect(magic.buttons[1]!.map((b) => b.isclicked)).toEqual([false, false, false, false, false])
    // 再在空处按一下：动画只该被清空，不该被重新接上。
    stepMenu(w, [{ e: 'press', x: 20, y: 600 }])
    expect(magic.current).toBeNull()
    expect(w.music).toEqual([])
  })
})

/**
 * `checkAllButtonPressed` 末尾那三个 `for` 循环 **组与组之间没有 break**：
 * 每个循环各带一个 `break`，可三个循环是并列的。于是两组同时 `isclicked` 时
 * **后一组赢，而且两声都响**。
 *
 * 这条走得到，只是要绕一下：`isclicked` 只由**松开**清掉，所以一路按着不松地
 * 换人，张小凡那一颗就一直挂着。把它做成判据的理由 —— 改成"第一组赢就收工"
 * （三组之间加一个整体的 `return`）在**两条真值上都是绿的**，实测如此。
 */
describe('两组同时 isclicked 时，后一组赢、两声都响', () => {
  it('一路不松手：按下张小凡那一颗 → 换到陆雪琪 → 再按一颗', () => {
    const w = createMenuWorld({ party: ['zhang', 'lu', 'wen'], fullHeal: true })
    const [bx, by] = hitCenter(MAGIC_BUTTON_X, magicButtonY(0), MAGIC_BUTTON_W, MAGIC_BUTTON_H)
    stepMenu(w, [{ e: 'press', x: 619, y: 62 }])
    stepMenu(w, [{ e: 'release', x: 619, y: 62 }])
    // 张小凡的第一颗，**按下不松** —— 往后一次松开都不发。
    stepMenu(w, [{ e: 'press', x: bx, y: by }])
    const magic = w.panels.magicPanel.magic!
    expect(magic.buttons[1]![0]!.isclicked).toBe(true)

    // 换人。先移一下鼠标：`checkMoveIn` 才会把二号头像的 isDraw 打开，
    // 而 `isPressedButton` 在 `isDraw=No` 时整个跳过。
    const head2 = HEAD_POS.find((h) => h.hero === 2)!
    const [hx, hy] = hitCenter(head2.x, head2.y, HEAD_W, HEAD_H)
    stepMenu(w, [{ e: 'move', x: hx, y: hy }])
    stepMenu(w, [{ e: 'press', x: hx, y: hy }])
    expect(w.panels.magicPanel.scoll!.whichHero).toBe(2)
    // 张小凡那一颗仍然挂着 —— 没人松开过它，而 `isPressedButton` 没命中时
    // 只把贴图拨回常态。
    expect(magic.buttons[1]![0]!.isclicked).toBe(true)

    // 这一按落在陆雪琪的第一颗上（换人之后那次 paint 已经把它打开了）。
    w.music = []
    stepMenu(w, [{ e: 'press', x: bx, y: by }])
    expect(magic.buttons[2]![0]!.isclicked).toBe(true)

    // 两声都响，次序是 张 → 陆；接上的是**后一组**。
    // ⚠️ 头一声是「换头像.wav」：二号头像那一颗也没被松开过，所以
    // `Scoll.checkPressed` 这一按上又认了它一次 —— 同一个 `isclicked` 只由
    // 松开清掉的缘故，卷轴上也照样发生。
    expect(w.music).toEqual(['换头像.wav', MAGIC_HEROES[0]!.sound, MAGIC_HEROES[1]!.sound])
    expect(magic.current).toBe(magic.animations[2]![0])
  })
})
