import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import { DRUGS } from '../battle/drugs'
import {
  DRUG_HIT_W,
  DRUG_LIST_X,
  DRUG_LIST_Y,
  DRUG_PICTURE_X,
  DRUG_PICTURE_Y,
  DRUG_ROW_H,
  USE_BUTTON_H,
  USE_BUTTON_W,
  USE_BUTTON_X,
  USE_BUTTON_Y,
  createDrugPack,
  drinkDrug,
  visibleDrugs,
} from './drugPanel'
import { MENU_HERO_ORDER } from './heroes'
import type { MenuHero } from './heroes'
import { snapshotMenu } from './snapshot'
import { stepMenu } from './step'
import { MENU_TRACE_NAMES, readMenuTrace, replayMenu } from './trace'
import { createMenuWorld } from './world'
import { SCOLL_HEROES } from './types'

/**
 * 物品页那几个数抄得对不对，由**原版源码**与**行为真值**两头说了算
 * （xl-6lo.10）。
 *
 * 分工是有意的，两头看的不是同一件事：
 *
 * - **几何**（清单起点 / 行高 / 命中带宽 / 「使用」按钮）从
 *   `src/menu/DrugPanel.java` 的字段初始化式里现解。这些数在真值里**只有一
 *   个落点**被走过（第 21 步那一下移动），抄错第二位以后的东西照样绿。
 * - **喝下去的后果**（数量减一、气血涨上去）从 `tools/traces/out/` 里现取。
 *   期望值一个都不是手写的 —— 连"喝的是哪一瓶、喝给谁"都是从真值那一行读的。
 *
 * ⚠️ 真值那一列 `drug` 的逐步比对在 `menuTrace.test.ts`（登记表里
 * `drug × menu-equip` / `drug × menu-magic` 两格）。这个文件补的是那条比对
 * **看不见**的两样：源码里那些没被走到的常量，以及 `heroes` 那一列里属于
 * 喝药的那一小段 —— 那一整列还挂在 xl-6lo.9 名下（装备页第 8 步起就在改它），
 * 所以整组还翻不了，而喝药这一步的读数必须现在就有人核。
 */

const source = javaSource('src/menu/DrugPanel.java')

/** `int <name>=<数字>;`。解不出来是零匹配 —— 每一处都先断言解出来了。 */
function intField(name: string): number {
  const m = [...source.matchAll(new RegExp(`int\\s+${name}\\s*=\\s*(-?\\d+)\\s*;`, 'g'))]
  expect(m, `DrugPanel.java 里没解出 int ${name}=<数字>`).toHaveLength(1)
  return Number(m[0]![1])
}

describe('物品页的几何，对回 src/menu/DrugPanel.java', () => {
  it('清单起点与「使用」按钮的四个数', () => {
    expect([DRUG_LIST_X, DRUG_LIST_Y]).toEqual([intField('x_start_point'), intField('y_start_point')])
    expect([DRUG_PICTURE_X, DRUG_PICTURE_Y]).toEqual([intField('x_picture'), intField('y_picture')])
    expect([USE_BUTTON_W, USE_BUTTON_H]).toEqual([intField('width_button'), intField('height_button')])
    // `x_button=x_picture;` / `y_button=y_picture+240;` —— 是表达式不是字面量，
    // 所以两条各自解自己那一行，不共用上面那个 helper。
    const bx = [...source.matchAll(/int\s+x_button\s*=\s*(\w+)\s*;/g)]
    expect(bx, 'x_button 那一行没解出来').toHaveLength(1)
    expect(bx[0]![1]).toBe('x_picture')
    expect(USE_BUTTON_X).toBe(DRUG_PICTURE_X)

    const by = [...source.matchAll(/int\s+y_button\s*=\s*(\w+)\s*\+\s*(\d+)\s*;/g)]
    expect(by, 'y_button 那一行没解出来').toHaveLength(1)
    expect(by[0]![1]).toBe('y_picture')
    expect(USE_BUTTON_Y).toBe(DRUG_PICTURE_Y + Number(by[0]![2]))
  })

  it('命中带：起点比第一行基线高一整行，宽 130 —— 比画出来的那一行窄', () => {
    // `int originalY=y_start_point-32;`
    const start = [...source.matchAll(/int\s+originalY\s*=\s*y_start_point\s*-\s*(\d+)\s*;/g)]
    expect(start, 'originalY 的起点没解出来').toHaveLength(1)
    expect(DRUG_ROW_H).toBe(Number(start[0]![1]))
    // `originalY += 32;` 与 `y += 32;` 是同一个行高。
    const step = [...source.matchAll(/originalY\s*\+=\s*(\d+)\s*;/g)]
    expect(step, 'originalY 的步进没解出来').toHaveLength(1)
    expect(DRUG_ROW_H).toBe(Number(step[0]![1]))

    const hit = [...source.matchAll(/currentX\s*<\s*x_start_point\s*\+\s*(\d+)/g)]
    expect(hit, '命中带宽度没解出来').toHaveLength(1)
    expect(DRUG_HIT_W).toBe(Number(hit[0]![1]))

    // ⚠️ 数量那一列画在 `x + 180`，落在 130 宽的命中带**外面**。抹平这件事
    // （把带子拉到 180）在真值里看不出来 —— 那一下移动的落点是 x_start_point+1。
    const count = [...source.matchAll(/drawString\(""\s*\+\s*e\.getNumberGOT\(\),\s*x\s*\+\s*(\d+),/g)]
    expect(count, '数量那一列的 x 偏移没解出来').toHaveLength(1)
    expect(DRUG_HIT_W).toBeLessThan(Number(count[0]![1]))
  })

  it('`showDrug()` 至今零调用者 —— 有意不抄，不是漏了', () => {
    // 全仓 88 个 `.java` 里只有它自己那一处定义。哪天有人把它接上，这条红，
    // 那时才该抄它。"有意不抄"与"漏了"在代码里长得一样，所以要有人签。
    const files = execFileSync('git', ['ls-files', '*.java'], { cwd: repoPath('.'), encoding: 'utf8' })
      .split('\n')
      .filter((f) => f !== '')
    // 空转要响：一个文件都没扫到时下面那句 filter 也是空的。
    expect(files.length).toBeGreaterThan(50)
    const mentions = files.filter((f) => javaSource(f).includes('showDrug'))
    expect(mentions).toEqual(['src/menu/DrugPanel.java'])
    // 那一处必须是**定义**，不是调用 —— 只数文件名的话"它自己调自己"也算。
    expect([...source.matchAll(/showDrug\s*\(/g)]).toHaveLength(1)
  })

  it('两张表同一个次序 —— 卷轴上的第 n 颗头像就是队伍里的第 n 个人', () => {
    // `heroOnScoll` 靠下标把 `SCOLL_HEROES` 与 `MENU_HERO_ORDER` 对上，而
    // 两张表的键名不是一套（`wen` vs `yu`），按名字对会把后两个对调。
    expect(SCOLL_HEROES.map((h) => h.hero)).toEqual([1, 2, 4])
    expect(MENU_HERO_ORDER.map((h) => h.key)).toEqual(['zhang', 'lu', 'yu'])
    expect(SCOLL_HEROES).toHaveLength(MENU_HERO_ORDER.length)
  })
})

describe('存货：六种药全在包里，没有的那几种是 0', () => {
  it('分母是药品表本身，缺席等于一瓶都没有', () => {
    const pack = createDrugPack()
    expect(pack.map((s) => s.name)).toEqual(DRUGS.map((d) => d.name))
    expect(visibleDrugs(pack)).toEqual([])
  })

  it('`addDrug` 是累加，不是赋值', () => {
    const name = DRUGS[0]!.name
    const pack = createDrugPack([
      { name, count: 2 },
      { name, count: 3 },
    ])
    expect(visibleDrugs(pack)).toEqual([{ name, count: 5 }])
  })

  it('名字对不上当场抛 —— 静默跳过的话「这一局没那种药」与「打错字」长得一样', () => {
    expect(() => createDrugPack([{ name: '不存在的药', count: 1 }])).toThrow('不存在的药')
  })
})

/**
 * 真值这两条剧本**走不到**的那三条路。
 *
 * 三条都是篡改矩阵抓出来的真空洞（篡改了却全绿），不是补充说明：
 * `menu-equip` 全程只有一种药、只有一号在卷轴上、清单一次都没空过，于是
 * "清单空了要关按钮"、"喝给卷轴上那个人"、"下标按过滤后的清单算"这三件事
 * 换成错的照样绿。
 */
describe('两条真值走不到的三条路', () => {
  /** `sources/Shop/drug.txt` 里下标不是 0 的一种药 —— 下面第三条要它。 */
  const LATER = DRUGS[2]!

  it('清单空了，鼠标一动就关掉「使用」按钮', () => {
    const w = createMenuWorld({ party: ['zhang'], fullHeal: true, drugs: [{ name: DRUGS[0]!.name, count: 1 }] })
    const p = w.panels.thingPanel
    // 先选中，把按钮打开 —— 不打开的话下面那条"关掉了"按构造成立。
    stepMenu(w, [{ e: 'move', x: DRUG_LIST_X + 1, y: DRUG_LIST_Y - DRUG_ROW_H / 2 }])
    expect(p.drug!.useButton.isDraw).toBe(true)
    // 存货清零（药店卖光、读档换了一份包都会走到这儿），再动一下鼠标。
    for (const stock of w.drugPack) stock.count = 0
    stepMenu(w, [{ e: 'move', x: DRUG_LIST_X + 1, y: DRUG_LIST_Y - DRUG_ROW_H / 2 }])
    expect(p.drug!.useButton.isDraw).toBe(false)
  })

  it('喝给卷轴上那个人 —— 换个人就该换个人涨血', () => {
    const w = createMenuWorld({
      party: ['zhang', 'wen'],
      fullHeal: false,
      drugs: [{ name: DRUGS[0]!.name, count: 1 }],
    })
    const p = w.panels.thingPanel
    // `fullHeal:false` 时三个人的 hp 都是 0（空构造函数不碰它们）——
    // 满血的话加了血也看不出来。
    expect(w.heroes.map((h) => h.hp)).toEqual([0, 0, 0])
    // ⚠️ 改的是**物品页自己那个卷轴**（`Scoll` 四页各有一个）。
    p.scoll!.whichHero = 4
    stepMenu(w, [{ e: 'move', x: DRUG_LIST_X + 1, y: DRUG_LIST_Y - DRUG_ROW_H / 2 }])
    stepMenu(w, [{ e: 'press', x: 865, y: 432 }])
    expect(w.heroes.map((h) => h.hp)).toEqual([0, 0, DRUGS[0]!.addHp])
  })

  it('`selected` 是过滤后清单里的下标，不是六种药那张全表里的', () => {
    // 这一种在全表里是第 2 行，在"包里有的"那份清单里是第 0 行。两个数不同，
    // 这条才分得开 —— `menu-equip` 那一局两者都是 0。
    expect(DRUGS.findIndex((d) => d.name === LATER.name)).toBeGreaterThan(0)
    const w = createMenuWorld({ party: ['zhang'], fullHeal: true, drugs: [{ name: LATER.name, count: 1 }] })
    stepMenu(w, [{ e: 'move', x: DRUG_LIST_X + 1, y: DRUG_LIST_Y - DRUG_ROW_H / 2 }])
    expect(snapshotMenu(w)['drug']).toEqual({
      list: [{ name: LATER.name, count: 1 }],
      selected: 0,
      selectedName: LATER.name,
      useDraw: true,
    })
  })
})

/**
 * **喝药前后的读数，全部从行为真值里现取。**
 *
 * 找的是"总存货减少了"的那一拍 —— 分母是磁盘上的真值名单，判据是至少找到
 * 一拍：一拍都没有的话下面那批断言一条都不跑，而"零轮循环"与"全对上了"
 * 长得一模一样。
 */
describe('喝药那一步：数量减一、气血涨上去', () => {
  interface Drink {
    readonly trace: string
    readonly t: number
    readonly heroIndex: number
    readonly drug: string
    readonly before: MenuHero
    readonly after: MenuHero
    /** 三个人整份 —— `addValue()` 头上那三句 `refreshValue()` 刷的是三个。 */
    readonly beforeAll: readonly MenuHero[]
    readonly afterAll: readonly MenuHero[]
  }

  const drinks: Drink[] = []
  for (const name of MENU_TRACE_NAMES) {
    const trace = readMenuTrace(name)
    for (const [i, tick] of trace.ticks.entries()) {
      if (i === 0) continue
      const prev = trace.ticks[i - 1]!
      const total = (t: (typeof trace.ticks)[number]) =>
        (t['drug'] as { list: { count: number }[] }).list.reduce((s, e) => s + e.count, 0)
      if (total(tick) >= total(prev)) continue
      const selected = (prev['drug'] as { selectedName: string | null }).selectedName
      // ⚠️ `not.toBeNull()` 放 `undefined` 过去（`toBeNull` 严格判 null）——
      // 真值那一行少了这个键时"没取到"就成了通过条件（/code-review 标准轴）。
      expect(typeof selected, `${name} 第 ${tick.t} 步喝了药，可上一步没有选中的药`).toBe('string')
      const heroIndex = SCOLL_HEROES.findIndex((h) => h.hero === prev['hero'])
      expect(heroIndex, `${name} 第 ${tick.t} 步的卷轴上是 ${prev['hero']} 号`).toBeGreaterThanOrEqual(0)
      drinks.push({
        trace: name,
        t: tick.t,
        heroIndex,
        drug: selected!,
        before: (prev['heroes'] as MenuHero[])[heroIndex]!,
        after: (tick['heroes'] as MenuHero[])[heroIndex]!,
        beforeAll: prev['heroes'] as MenuHero[],
        afterAll: tick['heroes'] as MenuHero[],
      })
    }
  }

  it('真值里真的有人喝过药 —— 一拍都没有的话下面一条断言都不跑', () => {
    expect(drinks.map((d) => `${d.trace}#${d.t}`)).not.toEqual([])
  })

  it('喝之前与喝之后的气血不是同一个数 —— 否则这条判据观测不到任何东西', () => {
    // ⚠️ 这一条守的是**判据本身**：真值里那一口药要是没把血喝上去（喝的是
    // 满血的人、或者加的是灵力），下面那条 `toEqual` 就是"没变 == 没变"，
    // 恒真。今天走的是 700 → 1000 那一条。
    const moved = drinks.filter((d) => d.before.hp !== d.after.hp || d.before.mp !== d.after.mp)
    expect(moved.map((d) => `${d.trace}#${d.t}`)).not.toEqual([])
  })

  for (const drink of drinks) {
    it(`${drink.trace} 第 ${drink.t} 步喝 ${drink.drug}：${drink.before.hp}/${drink.before.mp} → 真值的读数`, () => {
      const spec = DRUGS.find((d) => d.name === drink.drug)
      expect(spec, `药品表里没有 ${drink.drug}`).toBeDefined()
      // 起点整份从真值那一行拷过来 —— 一个数都不是这边算的。**三个人都拷**：
      // `addValue()` 头上那三句 `refreshValue()` 刷的是三个人，只核喝药那一个
      // 的话"刷坏了另外两个"看不出来。
      const heroes: MenuHero[] = drink.beforeAll.map((h) => ({ ...h }))
      drinkDrug(heroes, drink.heroIndex, spec!)
      expect(heroes).toEqual(drink.afterAll)
    })

    it(`${drink.trace} 第 ${drink.t} 步：喝到上限就停在上限`, () => {
      // 原版 `if(h>=hero.getHpMax()){hero.setHp(hero.getHpMax());}`。真值这一
      // 场没走到夹的那一支（700+300=1000 < 1050），所以起点按真值的上限往回
      // 挪一格现造。
      //
      // ⚠️ **夹到的那个上限是 `refreshMenuHero` 用 `derive()` 现算的，不是这里
      // 塞进去的那个** —— 上一条 `toEqual(afterAll)` 已经证明两者相等，但这条
      // 自己也核一遍，免得注释说"上限是真值给的"而实际不是（/code-review 标准轴）。
      const spec = DRUGS.find((d) => d.name === drink.drug)!
      const heroes: MenuHero[] = drink.beforeAll.map((h) => ({ ...h }))
      const me = heroes[drink.heroIndex]!
      me.hp = drink.after.hpMax - 1
      me.mp = drink.after.mpMax - 1
      drinkDrug(heroes, drink.heroIndex, spec)
      expect([me.hpMax, me.mpMax], '现算的上限与真值那一行不同').toEqual([
        drink.after.hpMax,
        drink.after.mpMax,
      ])
      expect([me.hp, me.mp]).toEqual([
        spec.addHp > 0 ? drink.after.hpMax : drink.after.hpMax - 1,
        spec.addMp > 0 ? drink.after.mpMax : drink.after.mpMax - 1,
      ])
    })
  }

  /**
   * 整条剧本跑一遍，核**那一拍的音效**。
   *
   * `music` 这一整列还挂在 PENDING 上（两条剧本里都还有别的页发的声，见
   * `menuTrace.test.ts`），所以这里只核喝药这一拍 —— 不核的话「喝了药却
   * 一声不响」要等到装备页那张票才露头。
   */
  it('喝药那一拍的音效与真值相等', () => {
    expect(drinks).not.toEqual([])
    for (const drink of drinks) {
      const trace = readMenuTrace(drink.trace)
      const world = replayMenu(trace)
      let got: unknown = null
      let want: unknown = null
      for (const tick of trace.ticks) {
        stepMenu(world, tick.input)
        if (tick.t === drink.t) {
          got = snapshotMenu(world)['music']
          want = tick['music']
        }
      }
      // 同上：真值缺 `music` 这一列时 `want` 是 `undefined`，`not.toBeNull()`
      // 会放它过去，而下一行 `toEqual(undefined)` 只要我们也没出声就绿。
      expect(Array.isArray(want), `${drink.trace} 第 ${drink.t} 步的真值音效没取到`).toBe(true)
      expect(got, `${drink.trace} 第 ${drink.t} 步`).toEqual(want)
    }
  })
})
