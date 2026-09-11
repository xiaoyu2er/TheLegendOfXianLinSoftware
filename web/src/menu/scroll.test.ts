import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { decodePng, scanDarkBox } from '../test/png'
import { readMenuTrace, replayMenu } from './trace'
import type { MenuTrace, MenuTraceTick } from './trace'
import {
  DRUG_LIST_BOX,
  EQUIP_LIST_BOX,
  LIST_BOX_MEASUREMENT,
  SCROLLBAR_MIN_THUMB,
  SCROLLBAR_WIDTH,
  WHEEL_ROWS,
  clampScroll,
  inListBox,
  maxScroll,
  rowBandTop,
  rowBaseline,
  scrollbar,
  viewportRows,
  visibleRange,
  wheelRows,
} from './scroll'
import { EQUIP_LIST_VIEW, EQUIP_HIT_W, EQUIP_X_START, equipList, snapshotEquip } from './equipPanel'
import { DRUG_HIT_W, DRUG_LIST_VIEW, DRUG_LIST_X, visibleDrugs } from './drugPanel'
import { stepMenu } from './step'
import { snapshotMenu } from './snapshot'
import type { MenuWorld } from './types'

/**
 * 滚动条（xl-6lo.13）。
 *
 * ## 期望值从哪来
 *
 * 三处，**一个都不是手写的**：
 *
 * 1. **列表有多长、选中的是第几行** —— 从 `menu-scroll` 那份真值现读
 *    （xl-6lo.7 补的，剧本描述里写明"给 xl-6lo.13 的滚动条当真值"）。武器
 *    列表 20 件、盔甲 1 件、药品 6 种，三份长度都是**从数据源头顶到头**的；
 *    行号 0 / 15 / 16 / 19 正好跨过框底那条线。这里不写这几个数，从真值的
 *    `equip.list` / `equip.selected` / `drug.list` 里取。
 * 2. **一屏放得下几行** —— 由列表框内区的底算出来，而那个数只在像素里：
 *    每跑一次这个文件就把两张背景图重新扫一遍（下面第一条），扫出来的框与
 *    `scroll.ts` 里那两个常量必须逐字相等。抄错一个数、图换了一张，当场红。
 * 3. **命中带的位置** —— 原版那两个常量（`y_start_point` / 行高），已经由
 *    `equipPanel.test.ts` / `drugPanel.test.ts` 对回 GBK 源码。
 *
 * ## 两侧都验
 *
 * 撑过框的那一侧（20 件武器）与装得下的那一侧（1 件盔甲、6 种药）各有各的
 * 判据。**只验撑过的那一侧的话，「装得下时不画滚动条」与「这段代码根本没跑」
 * 长得一样** —— 而物品页在原版数据下永远是后一侧。
 */

const trace: MenuTrace = readMenuTrace('menu-scroll')

interface EquipColumn {
  readonly tab: string
  readonly list: readonly { readonly name: string; readonly count: number }[]
  readonly selected: number
  readonly selectedName: string | null
}

interface DrugColumn {
  readonly list: readonly { readonly name: string; readonly count: number }[]
  readonly selected: number
  readonly selectedName: string | null
}

/** 真值一行里 `equip` 那一列。形状不对一律抛 —— 静默给个空的等于这条判据没跑。 */
function equipColumn(tick: MenuTraceTick): EquipColumn {
  const e = tick['equip'] as EquipColumn | undefined
  if (!e || typeof e.tab !== 'string' || !Array.isArray(e.list) || typeof e.selected !== 'number') {
    throw new Error(`menu-scroll 第 ${tick.t} 步的 equip 那一列不是预期的形状`)
  }
  return e
}

function drugColumn(tick: MenuTraceTick): DrugColumn {
  const d = tick['drug'] as DrugColumn | undefined
  if (!d || !Array.isArray(d.list) || typeof d.selected !== 'number') {
    throw new Error(`menu-scroll 第 ${tick.t} 步的 drug 那一列不是预期的形状`)
  }
  return d
}

/**
 * 真值里某个分类的列表有多长。**跨全部步取唯一值**：同一个分类在不同步长度
 * 不一样的话抛，因为那时候"这个分类有多长"就不是一个数了，下面每条判据的
 * 分母都会含糊掉。
 */
function listLengthOf(tab: string): number {
  const seen = new Set(
    trace.ticks.filter((t) => equipColumn(t).tab === tab).map((t) => equipColumn(t).list.length),
  )
  if (seen.size !== 1) {
    throw new Error(`menu-scroll 里 ${tab} 分类的列表长度不唯一：${[...seen].join(' / ')}`)
  }
  return [...seen][0]!
}

/** 真值里在某个分类上**真的选中过**的那几个行号（`-1` 是没选中，不算）。 */
function selectedRowsOf(tab: string): number[] {
  const rows = new Set(
    trace.ticks
      .filter((t) => equipColumn(t).tab === tab)
      .map((t) => equipColumn(t).selected)
      .filter((i) => i >= 0),
  )
  return [...rows].sort((a, b) => a - b)
}

/** 撑过框的那一侧：武器分类。 */
const WEAPON_ROWS = listLengthOf('weapon')
/** 装得下的那一侧之一：盔甲分类。 */
const ARMOR_ROWS = listLengthOf('armor')
/** 装得下的那一侧之二：药品清单。真值每一步都一样长（没喝过药）。 */
const DRUG_ROWS = (() => {
  const seen = new Set(trace.ticks.map((t) => drugColumn(t).list.length))
  if (seen.size !== 1) throw new Error(`menu-scroll 里药品清单长度不唯一：${[...seen].join(' / ')}`)
  return [...seen][0]!
})()

/** 真值在武器分类上选中过的行号 —— 剧本挑的就是跨过框底那条线的那几个。 */
const WEAPON_SELECTED = selectedRowsOf('weapon')

/** 照真值的 setup 建一个世界，停在装备页上。 */
function equipWorld(): MenuWorld {
  const w = replayMenu(trace)
  w.panel = 'equipPanel'
  return w
}

/** 装备页那一摊。世界一定建得出来，建不出来是世界坏了。 */
function equipOf(w: MenuWorld) {
  const e = w.panels.equipPanel.equip
  if (!e) throw new Error('equipPanel 没有装备页状态')
  return e
}

function drugOf(w: MenuWorld) {
  const d = w.panels.thingPanel.drug
  if (!d) throw new Error('thingPanel 没有物品页状态')
  return d
}

/** 把鼠标移到列表**屏幕上第 k 个格子**的正中（`MenuDriver.move()` 那条落点公式）。 */
function moveToSlot(w: MenuWorld, slot: number, offset: number): void {
  const y = rowBandTop(EQUIP_LIST_VIEW, slot + offset, offset) + Math.floor(EQUIP_LIST_VIEW.rowHeight / 2)
  stepMenu(w, [{ e: 'move', x: EQUIP_X_START + 1, y }])
}

describe('滚动条：量出来的列表框', () => {
  /**
   * ⚠️ **这是一次真的测量，不是一句"量过了"。** 扫的是入库的原始素材
   * （`sources/` 那 640 个文件），种子点与 `menu-scroll` 那份真值描述里用的
   * 是同两个 —— 也就是说这组数被**两次独立测量**量到过。
   *
   * 失败的样子与通过的样子不一样：种子点落到亮处（框挪了）会抛"不在暗区里"，
   * 而不是安安静静地返回一个空区间。
   */
  it('两张背景图现扫一遍，框的内区与常量逐字相等', () => {
    const cases = [
      { name: '装备页', spec: LIST_BOX_MEASUREMENT.equip, box: EQUIP_LIST_BOX },
      { name: '物品页', spec: LIST_BOX_MEASUREMENT.drug, box: DRUG_LIST_BOX },
    ]
    for (const { name, spec, box } of cases) {
      const bmp = decodePng(readFileSync(repoPath(spec.image)))
      // 舞台是 1024×640，背景图必须整张铺满 —— 尺寸不对的话下面扫出来的坐标
      // 与游戏里的坐标就不是同一套了。
      expect([bmp.width, bmp.height], `${name}背景图的尺寸`).toEqual([1024, 640])
      expect(scanDarkBox(bmp, spec.seedX, spec.seedY), `${name}的列表框内区`).toEqual(box)
    }
  })

  /**
   * ⚠️ 这一条**不能写成"把 `viewportRows` 的算式再抄一遍"** —— 那是按构造
   * 成立的（dispatch.md 那条）。所以分母走的是另一条路：**从现扫出来的框**
   * 一行一行数下去，数到基线掉出框为止，再与 `viewportRows` 对。常量抄错了
   * 两边一起变的路被这条切断了。
   */
  it('一屏放得下几行 —— 从现扫的框上一行行数出来，与算式对上', () => {
    const cases = [
      { name: '装备页', spec: LIST_BOX_MEASUREMENT.equip, view: EQUIP_LIST_VIEW },
      { name: '物品页', spec: LIST_BOX_MEASUREMENT.drug, view: DRUG_LIST_VIEW },
    ]
    for (const { name, spec, view } of cases) {
      const bmp = decodePng(readFileSync(repoPath(spec.image)))
      const scanned = scanDarkBox(bmp, spec.seedX, spec.seedY)
      let counted = 0
      while (view.firstBaseline + counted * view.rowHeight <= scanned.bottom) counted++
      expect(counted, `${name}一屏放得下几行`).toBe(viewportRows(view))
      expect(counted, `${name}一行都放不下`).toBeGreaterThan(1)
      // 末行的基线还在框里，再下一行掉出去 —— "放得下"就是这个意思。
      expect(rowBaseline(view, counted - 1, 0)).toBeLessThanOrEqual(scanned.bottom)
      expect(rowBaseline(view, counted, 0)).toBeGreaterThan(scanned.bottom)
    }
  })
})

describe('滚动条：撑过框的那一侧（真值里的武器列表）', () => {
  it('真值那份武器列表确实撑过了框，而世界建出来的长度与真值相同', () => {
    // 这一条是下面所有判据的前提：真值说 20 行、框放得下 16 行。哪天
    // `sources/Shop/武器.txt` 短了或者框大了，这里先红 —— 而不是让下面那些
    // 判据变成"列表装得下"的恒真。
    expect(WEAPON_ROWS).toBeGreaterThan(viewportRows(EQUIP_LIST_VIEW))
    expect(equipList(equipOf(equipWorld())).length).toBe(WEAPON_ROWS)
  })

  it('翻得动的行数 = 列表长度 − 一屏的行数', () => {
    expect(maxScroll(EQUIP_LIST_VIEW, WEAPON_ROWS)).toBe(WEAPON_ROWS - viewportRows(EQUIP_LIST_VIEW))
    expect(maxScroll(EQUIP_LIST_VIEW, WEAPON_ROWS)).toBeGreaterThan(0)
  })

  it('滚动位置夹在 [0, 翻得动的行数] 里，两头都夹', () => {
    const max = maxScroll(EQUIP_LIST_VIEW, WEAPON_ROWS)
    expect(clampScroll(EQUIP_LIST_VIEW, WEAPON_ROWS, -3)).toBe(0)
    expect(clampScroll(EQUIP_LIST_VIEW, WEAPON_ROWS, max + 3)).toBe(max)
    expect(clampScroll(EQUIP_LIST_VIEW, WEAPON_ROWS, max)).toBe(max)
    expect(() => clampScroll(EQUIP_LIST_VIEW, WEAPON_ROWS, 1.5)).toThrow()
  })

  it('真值选中过的行号里，有的在框里、有的在框外 —— 剧本挑的就是这条线', () => {
    // ⚠️ 两边都要非空。真值里全落在框里的话，这条判据读起来像在验分界，
    // 其实一次都没跨过去（dispatch.md 那条"按构造成立"）。
    const rows = viewportRows(EQUIP_LIST_VIEW)
    const inside = WEAPON_SELECTED.filter((i) => i < rows)
    const outside = WEAPON_SELECTED.filter((i) => i >= rows)
    expect(inside, 'menu-scroll 在框内一行都没选过').not.toEqual([])
    expect(outside, 'menu-scroll 在框外一行都没选过 —— 那这份真值验不了滚动条').not.toEqual([])
    // 框外那几行的基线确实掉在框外，而且还在面板里（原版就是这么画出去的）。
    for (const i of outside) {
      expect(rowBaseline(EQUIP_LIST_VIEW, i, 0)).toBeGreaterThan(EQUIP_LIST_VIEW.box.bottom)
      expect(rowBaseline(EQUIP_LIST_VIEW, i, 0)).toBeLessThan(640)
    }
  })

  it('翻到底之后，框外那几行进了框、开头那几行出了框', () => {
    const max = maxScroll(EQUIP_LIST_VIEW, WEAPON_ROWS)
    const top = visibleRange(EQUIP_LIST_VIEW, WEAPON_ROWS, 0)
    const bottom = visibleRange(EQUIP_LIST_VIEW, WEAPON_ROWS, max)
    expect(top).toEqual({ from: 0, to: viewportRows(EQUIP_LIST_VIEW) })
    expect(bottom).toEqual({ from: max, to: WEAPON_ROWS })
    // 真值选中过的每一行，两种滚动位置合起来至少能让它露一次面 ——
    // "翻不到的那几行"正是这张票要消灭的东西。
    for (const i of WEAPON_SELECTED) {
      const shown = (i >= top.from && i < top.to) || (i >= bottom.from && i < bottom.to)
      expect(shown, `第 ${i} 行怎么翻都看不见`).toBe(true)
    }
    // 而且真值在框外选中过的那几行，恰恰是翻到底才看得见的。
    for (const i of WEAPON_SELECTED.filter((n) => n >= top.to)) {
      expect(i >= bottom.from && i < bottom.to, `第 ${i} 行翻到底也看不见`).toBe(true)
    }
  })

  it('滚动条画得出来：槽盖住那几条命中带，滑块在槽里从头走到尾', () => {
    const max = maxScroll(EQUIP_LIST_VIEW, WEAPON_ROWS)
    const top = scrollbar(EQUIP_LIST_VIEW, WEAPON_ROWS, 0)
    const bottom = scrollbar(EQUIP_LIST_VIEW, WEAPON_ROWS, max)
    expect(top).not.toBeNull()
    expect(bottom).not.toBeNull()
    const track = top!.track
    // 槽贴着框的右内沿，纵向正好盖住那 `viewportRows` 条命中带。
    expect(track.x + track.width - 1).toBe(EQUIP_LIST_VIEW.box.right)
    expect(track.width).toBe(SCROLLBAR_WIDTH)
    expect(track.y).toBe(rowBandTop(EQUIP_LIST_VIEW, 0, 0))
    expect(track.height).toBe(viewportRows(EQUIP_LIST_VIEW) * EQUIP_LIST_VIEW.rowHeight)
    // 滑块：顶到顶、底到底，中间不越界。
    expect(top!.thumb.y).toBe(track.y)
    expect(bottom!.thumb.y + bottom!.thumb.height).toBe(track.y + track.height)
    expect(top!.thumb.height).toBe(bottom!.thumb.height)
    expect(top!.thumb.height).toBeLessThan(track.height)
    expect(top!.thumb.height).toBeGreaterThanOrEqual(SCROLLBAR_MIN_THUMB)
    // 滑块占槽的比例 = 一屏占整份列表的比例（差一像素以内，取整）。
    // ⚠️ 这两句也是**实测补上的**：只核"比槽短、不比最小高矮"的话，把滑块
    // 高度写死成最小高（12 像素）全套判据是绿的 —— 而那样的滚动条根本不告诉
    // 玩家列表有多长。
    const rows = viewportRows(EQUIP_LIST_VIEW)
    expect(Math.abs(top!.thumb.height / track.height - rows / WEAPON_ROWS)).toBeLessThan(
      1 / track.height,
    )
    // 列表越长滑块越短。
    const longer = scrollbar(EQUIP_LIST_VIEW, WEAPON_ROWS * 4, 0)!
    expect(longer.thumb.height).toBeLessThan(top!.thumb.height)
    // 滑块单调往下走，一格都不许倒着来。
    let last = -1
    for (let at = 0; at <= max; at++) {
      const y = scrollbar(EQUIP_LIST_VIEW, WEAPON_ROWS, at)!.thumb.y
      expect(y).toBeGreaterThan(last)
      last = y
    }
  })
})

describe('滚动条：装得下的那一侧', () => {
  /**
   * ⚠️ 这一组守的是**另一半**。只验撑过的那一侧的话，"装得下时不画滚动条"
   * 与"这段代码根本没跑"长得一样 —— 而物品页在原版的数据下**永远**是这一侧
   * （6 种药，框里放得下 11 行）。
   */
  it('真值里那两份短列表确实装得下', () => {
    expect(ARMOR_ROWS).toBeGreaterThan(0)
    expect(ARMOR_ROWS).toBeLessThanOrEqual(viewportRows(EQUIP_LIST_VIEW))
    expect(DRUG_ROWS).toBeGreaterThan(0)
    expect(DRUG_ROWS).toBeLessThanOrEqual(viewportRows(DRUG_LIST_VIEW))
  })

  it('翻不动、滚动条不画、一行都不裁', () => {
    for (const [v, length, name] of [
      [EQUIP_LIST_VIEW, ARMOR_ROWS, '盔甲'],
      [DRUG_LIST_VIEW, DRUG_ROWS, '药品'],
    ] as const) {
      expect(maxScroll(v, length), `${name}`).toBe(0)
      expect(scrollbar(v, length, 0), `${name}的滚动条`).toBeNull()
      // 存着一个越界的滚动位置也照样从第 0 行画起 —— 列表变短是会发生的
      // （喝掉最后一瓶、穿上最后一件），那时候存着的 offset 指到列表外面去。
      expect(scrollbar(v, length, 5), `${name}的滚动条`).toBeNull()
      expect(visibleRange(v, length, 5), `${name}`).toEqual({ from: 0, to: length })
    }
  })

  it('物品页的清单从真值里取得到读数，且世界建出来一样长', () => {
    const w = replayMenu(trace)
    expect(visibleDrugs(w.drugPack).length).toBe(DRUG_ROWS)
  })
})

describe('滚动条：翻页这件事真的做得成', () => {
  it('滚轮在装备页的列表框里翻得动，框外一行都不动', () => {
    const w = equipWorld()
    const e = equipOf(w)
    const inside = { x: EQUIP_LIST_VIEW.box.left + 10, y: EQUIP_LIST_VIEW.box.top + 10 }
    expect(inListBox(EQUIP_LIST_VIEW, inside.x, inside.y)).toBe(true)
    stepMenu(w, [{ e: 'wheel', ...inside, rows: 1 }])
    expect(e.scroll).toBe(1)

    // 框外：卷轴那一侧（x 远小于框左沿）。滚一下，位置一格不动。
    const outside = { x: EQUIP_LIST_VIEW.box.left - 50, y: EQUIP_LIST_VIEW.box.top + 10 }
    expect(inListBox(EQUIP_LIST_VIEW, outside.x, outside.y)).toBe(false)
    stepMenu(w, [{ e: 'wheel', ...outside, rows: 5 }])
    expect(e.scroll).toBe(1)
  })

  it('滚到顶与滚到底都不越界', () => {
    const w = equipWorld()
    const e = equipOf(w)
    const inside = { x: EQUIP_LIST_VIEW.box.left + 10, y: EQUIP_LIST_VIEW.box.top + 10 }
    stepMenu(w, [{ e: 'wheel', ...inside, rows: 999 }])
    expect(e.scroll).toBe(maxScroll(EQUIP_LIST_VIEW, WEAPON_ROWS))
    stepMenu(w, [{ e: 'wheel', ...inside, rows: -999 }])
    expect(e.scroll).toBe(0)
  })

  it('物品页装得下，所以滚轮在它的框里也翻不动 —— 这不是没接上，是没得翻', () => {
    const w = replayMenu(trace)
    w.panel = 'thingPanel'
    const d = drugOf(w)
    const inside = { x: DRUG_LIST_VIEW.box.left + 10, y: DRUG_LIST_VIEW.box.top + 10 }
    expect(inListBox(DRUG_LIST_VIEW, inside.x, inside.y)).toBe(true)
    stepMenu(w, [{ e: 'wheel', ...inside, rows: 3 }])
    expect(d.scroll).toBe(0)
    // 而同一条路在列表够长时是通的 —— 否则上面那个 0 也可能是"滚轮压根没接到
    // 物品页"。药品表长出第 12 行的那天，这一页就翻得动了。
    const longEnough = viewportRows(DRUG_LIST_VIEW) + 4
    expect(maxScroll(DRUG_LIST_VIEW, longEnough)).toBe(4)
  })

  /**
   * ⚠️ **这一条用的是一份编出来的存货，不是真值。**
   *
   * 理由是实测出来的：把物品页那个循环的下界从 `offset` 改回 `0`（也就是
   * 「卷上去的行照样点得中」这个错），**整套判据是绿的** —— 因为原版数据下
   * 药品只有 6 种、框里放得下 11 行，`offset` 恒为 0，两种写法逐字等价。
   * 这是「这一场观测不到」，不是判据失灵：`menu-scroll` 那份真值验的是物品页
   * **装得下**的那一侧，它验不了翻页。
   *
   * 所以这里编一份长到撑过框的存货，把那条路真的走一遍。**编的是输入不是
   * 期望值**：期望值仍然是"第 k 个格子选中的是第 k+offset 行"，从列表自己算。
   * 药品表（`sources/Shop/drug.txt`）长出第 12 行的那天，这条路在真实数据上
   * 就活了。
   */
  it('物品页翻起页来，第 k 个格子选中的是第 k+offset 种药（编的存货）', () => {
    const w = replayMenu(trace)
    w.panel = 'thingPanel'
    const d = drugOf(w)
    const rows = viewportRows(DRUG_LIST_VIEW)
    // 撑过框 4 行。名字只在这一层当标识用（选中的是"哪一瓶"由名字决定）。
    w.drugPack = Array.from({ length: rows + 4 }, (_, i) => ({ name: `试药${i}`, count: 1 }))
    const list = visibleDrugs(w.drugPack)
    expect(list.length).toBeGreaterThan(rows)
    const offset = maxScroll(DRUG_LIST_VIEW, list.length)
    expect(offset).toBe(4)

    const slotY = (slot: number, at: number) =>
      rowBandTop(DRUG_LIST_VIEW, slot + at, at) + Math.floor(DRUG_LIST_VIEW.rowHeight / 2)
    // 没翻页：第 0 个格子选中第 0 种。
    stepMenu(w, [{ e: 'move', x: DRUG_LIST_X + 1, y: slotY(0, 0) }])
    expect(d.currentDrug).toBe(list[0]!.name)
    // 翻到底：同一个格子选中的是第 offset 种。
    stepMenu(w, [
      { e: 'wheel', x: DRUG_LIST_VIEW.box.left + 10, y: DRUG_LIST_VIEW.box.top + 10, rows: offset },
    ])
    expect(d.scroll).toBe(offset)
    stepMenu(w, [{ e: 'move', x: DRUG_LIST_X + 1, y: slotY(0, offset) }])
    expect(d.currentDrug).toBe(list[offset]!.name)
    // 卷到框上面去的那几行点不中。
    const before = d.currentDrug
    stepMenu(w, [{ e: 'move', x: DRUG_LIST_X + 1, y: rowBandTop(DRUG_LIST_VIEW, 0, offset) + 1 }])
    expect(d.currentDrug, '卷上去的行还点得中').toBe(before)

    // 框外滚不动。⚠️ 这一句是**实测补上的**：头一版两页各有各的 `inListBox`
    // 守卫，删掉物品页那一份，装备页那条判据一点都不红。守卫后来收成了一份
    // （`scroll.ts` 的 `wheelScroll`），这一句仍然留着 —— 它现在守的是"物品页
    // 真的走了那条共用的路"，而不再是"这一页自己的守卫还在"。
    stepMenu(w, [
      { e: 'wheel', x: DRUG_LIST_VIEW.box.left - 50, y: DRUG_LIST_VIEW.box.top + 10, rows: -offset },
    ])
    expect(d.scroll, '在框外滚也翻动了物品页').toBe(offset)
  })

  it('滚轮只送给当前显示的那一页', () => {
    const w = equipWorld()
    w.panel = 'thingPanel'
    const e = equipOf(w)
    stepMenu(w, [
      { e: 'wheel', x: EQUIP_LIST_VIEW.box.left + 10, y: EQUIP_LIST_VIEW.box.top + 10, rows: 3 },
    ])
    expect(e.scroll, '人在物品页，装备页的列表却翻了').toBe(0)
  })

  it('在滚动条的槽里按一下翻一屏，按在滑块上不动', () => {
    const w = equipWorld()
    const e = equipOf(w)
    const rows = viewportRows(EQUIP_LIST_VIEW)
    const max = maxScroll(EQUIP_LIST_VIEW, WEAPON_ROWS)
    const bar = scrollbar(EQUIP_LIST_VIEW, WEAPON_ROWS, 0)!
    // 滑块下方：往下翻一屏，但列表只剩 max 行可翻，所以夹在 max 上。
    const below = { x: bar.track.x + 1, y: bar.thumb.y + bar.thumb.height + 5 }
    stepMenu(w, [{ e: 'press', ...below }])
    expect(e.scroll).toBe(Math.min(rows, max))
    // 按在滑块上：一格不动。
    const nowBar = scrollbar(EQUIP_LIST_VIEW, WEAPON_ROWS, e.scroll)!
    const onThumb = { x: nowBar.track.x + 1, y: nowBar.thumb.y + 1 }
    stepMenu(w, [{ e: 'press', ...onThumb }])
    expect(e.scroll).toBe(Math.min(rows, max))
    // 滑块上方：翻回去。
    const above = { x: nowBar.track.x + 1, y: nowBar.track.y + 1 }
    stepMenu(w, [{ e: 'press', ...above }])
    expect(e.scroll).toBe(0)

    // ⚠️ 槽的命中是**左上闭、右下开**：右边界外那一列不算。这一条是实测补的
    // —— 把 `inRect` 改回两头闭区间，上面那几句全是绿的，而那时 8 像素宽的槽
    // 会命中 9 列、越过量出来的框右内沿一列。
    const past = { x: bar.track.x + bar.track.width, y: bar.thumb.y + bar.thumb.height + 5 }
    expect(past.x, '槽的右边界外那一列').toBe(EQUIP_LIST_VIEW.box.right + 1)
    stepMenu(w, [{ e: 'press', ...past }])
    expect(e.scroll, '槽外一列按下去也翻页了').toBe(0)
  })

  it('一格滚轮翻几行只看方向，不看 deltaY 的大小', () => {
    expect(wheelRows(1)).toBe(WHEEL_ROWS)
    expect(wheelRows(0.5)).toBe(WHEEL_ROWS)
    expect(wheelRows(240)).toBe(WHEEL_ROWS)
    expect(wheelRows(-1)).toBe(-WHEEL_ROWS)
    expect(wheelRows(0)).toBe(0)
  })
})

describe('滚动条：够得着那一半没被改掉', () => {
  /**
   * ⚠️ **原版不裁剪也不加下界**：框外那几行照样点得中。`menu-scroll`
   * 第 9 / 10 步点的正是它们，逐步比对已经守着这件事；这里把它单独拎出来，
   * 是因为"给滚动条加个下界"是这张票最顺手、也最容易犯的错，而它的代价是
   * 真值当场变红、然后有人去改真值。
   */
  it('offset 为 0 时，框外那几行照样点得中（真值第 9 / 10 步走的就是这条路）', () => {
    const rows = viewportRows(EQUIP_LIST_VIEW)
    const outside = WEAPON_SELECTED.filter((i) => i >= rows)
    expect(outside).not.toEqual([])
    for (const i of outside) {
      const w = equipWorld()
      const e = equipOf(w)
      const name = equipList(e)[i]!.name
      moveToSlot(w, i, 0)
      expect(e.currentEquipment, `第 ${i} 行点不中了`).toBe(name)
      // 而真值里选中这一行时记的名字就是它 —— 两侧对上，才说明行号的含义没歪。
      const tick = trace.ticks.find((t) => equipColumn(t).tab === 'weapon' && equipColumn(t).selected === i)
      expect(tick, `真值里没有选中第 ${i} 行的那一步`).toBeTruthy()
      expect(equipColumn(tick!).selectedName).toBe(name)
    }
  })

  it('翻了页之后，同一个屏幕格子选中的是往下 offset 行的那一件', () => {
    const w = equipWorld()
    const e = equipOf(w)
    const list = equipList(e)
    const offset = maxScroll(EQUIP_LIST_VIEW, WEAPON_ROWS)
    expect(offset).toBeGreaterThan(0)
    stepMenu(w, [
      { e: 'wheel', x: EQUIP_LIST_VIEW.box.left + 10, y: EQUIP_LIST_VIEW.box.top + 10, rows: offset },
    ])
    moveToSlot(w, 0, offset)
    expect(e.currentEquipment).toBe(list[offset]!.name)
    // 没翻页时同一个格子选的是第 0 件 —— 两者不同，才说明翻页真的改了命中。
    expect(list[offset]!.name).not.toBe(list[0]!.name)
  })

  it('翻上去的那几行点不中 —— 那片地方住着六颗槽位按钮', () => {
    const w = equipWorld()
    const e = equipOf(w)
    const offset = maxScroll(EQUIP_LIST_VIEW, WEAPON_ROWS)
    stepMenu(w, [
      { e: 'wheel', x: EQUIP_LIST_VIEW.box.left + 10, y: EQUIP_LIST_VIEW.box.top + 10, rows: offset },
    ])
    const before = e.currentEquipment
    // 第 0 行这时被推到框上面去了，它那条带子落在槽位按钮那一排里。
    const y = rowBandTop(EQUIP_LIST_VIEW, 0, offset) + Math.floor(EQUIP_LIST_VIEW.rowHeight / 2)
    expect(y).toBeLessThan(EQUIP_LIST_VIEW.firstBaseline - EQUIP_LIST_VIEW.rowHeight)
    stepMenu(w, [{ e: 'move', x: EQUIP_X_START + 1, y }])
    expect(e.currentEquipment, '卷到框上面去的行还点得中').toBe(before)
  })

  it('命中带的左右两界没动过（原版那两个数）', () => {
    const w = equipWorld()
    const e = equipOf(w)
    const y = rowBandTop(EQUIP_LIST_VIEW, 0, 0) + Math.floor(EQUIP_LIST_VIEW.rowHeight / 2)
    const first = equipList(e)[0]!.name
    // 左界与右界都是开区间：正好落在界上不选中。
    stepMenu(w, [{ e: 'move', x: EQUIP_X_START, y }])
    expect(e.currentEquipment).toBe(null)
    stepMenu(w, [{ e: 'move', x: EQUIP_X_START + EQUIP_HIT_W, y }])
    expect(e.currentEquipment).toBe(null)
    stepMenu(w, [{ e: 'move', x: EQUIP_X_START + 1, y }])
    expect(e.currentEquipment).toBe(first)
    // 两界与 `EQUIP_LIST_VIEW` 是同一份，别的地方不许再抄一遍。
    expect([EQUIP_LIST_VIEW.hitLeft, EQUIP_LIST_VIEW.hitRight]).toEqual([
      EQUIP_X_START,
      EQUIP_X_START + EQUIP_HIT_W,
    ])
    expect([DRUG_LIST_VIEW.hitLeft, DRUG_LIST_VIEW.hitRight]).toEqual([
      DRUG_LIST_X,
      DRUG_LIST_X + DRUG_HIT_W,
    ])
  })

  /**
   * ⚠️ 物品页那两界得**自己走一遍**，不能靠上面那条 `toEqual`：那一条核的是
   * 「`DRUG_LIST_VIEW` 里存的是不是那两个数」，而命中判定读没读它是另一回事。
   * 实测过 —— 把 `drugCheckMoveIn` 的右界改成 `hitRight + 400`，全套判据是
   * 绿的（这个文件里所有物品页的落点都取 `x+1`，一次都没碰过右边那条线）。
   *
   * ⚠️ 命中带**比画出来的那一行窄**：数量那一列画在 `x+180`，落在带外。原版
   * 就是这样（`drugPanel.ts` 的 `DRUG_HIT_W`），所以右界那一下不该选中任何东西。
   */
  it('物品页命中带的左右两界也没动过', () => {
    const w = replayMenu(trace)
    w.panel = 'thingPanel'
    const d = drugOf(w)
    const drugs = visibleDrugs(w.drugPack)
    expect(drugs.length).toBeGreaterThan(0)
    const y = rowBandTop(DRUG_LIST_VIEW, 0, 0) + Math.floor(DRUG_LIST_VIEW.rowHeight / 2)

    stepMenu(w, [{ e: 'move', x: DRUG_LIST_VIEW.hitLeft, y }])
    expect(d.currentDrug, '左界上不该选中').toBe(null)
    stepMenu(w, [{ e: 'move', x: DRUG_LIST_VIEW.hitRight, y }])
    expect(d.currentDrug, '右界上不该选中').toBe(null)
    // 数量那一列的落点（名字右边 180）在命中带外面 —— 原版的窄命中带。
    stepMenu(w, [{ e: 'move', x: DRUG_LIST_X + 180, y }])
    expect(d.currentDrug, '数量那一列落在命中带外面').toBe(null)
    stepMenu(w, [{ e: 'move', x: DRUG_LIST_VIEW.hitLeft + 1, y }])
    expect(d.currentDrug).toBe(drugs[0]!.name)
  })
})

describe('滚动条：拖拽滑块（xl-03x.9）', () => {
  /**
   * 期望值全从 `scrollbar()` 与真值那份武器列表算：拖多少像素该到第几行，
   * 看的是「滑块在第 at 行时画在哪」—— 把指针挪过去，列表就该在第 at 行。
   * 这把尺子与画出来的滑块是同一把，所以不写一个像素常量。
   */
  const V = EQUIP_LIST_VIEW

  /** 按在滑块正中，返回按下的点。 */
  function grabThumb(w: MenuWorld): { x: number; y: number } {
    const bar = scrollbar(V, WEAPON_ROWS, equipOf(w).scroll)
    if (!bar) throw new Error('这一场的列表没撑过框，滚动条都不画，拖拽判据是恒真的')
    const at = { x: bar.thumb.x + 1, y: bar.thumb.y + Math.floor(bar.thumb.height / 2) }
    stepMenu(w, [{ e: 'press', ...at }])
    return at
  }

  /** 滑块在第 `at` 行时比在第 `from` 行时往下挪了几像素。 */
  function thumbShift(from: number, at: number): number {
    return scrollbar(V, WEAPON_ROWS, at)!.thumb.y - scrollbar(V, WEAPON_ROWS, from)!.thumb.y
  }

  it('按住滑块往下拖，列表逐行跟着走 —— 每一行都拖得到', () => {
    const w = equipWorld()
    const e = equipOf(w)
    const max = maxScroll(V, WEAPON_ROWS)
    expect(max, '翻不动的列表验不了拖拽').toBeGreaterThan(1)
    const grab = grabThumb(w)
    for (let at = 0; at <= max; at++) {
      stepMenu(w, [{ e: 'move', x: grab.x, y: grab.y + thumbShift(0, at) }])
      expect(e.scroll, `滑块拖到第 ${at} 行的位置`).toBe(at)
    }
    // 往回拖同样逐行跟着。
    for (let at = max; at >= 0; at--) {
      stepMenu(w, [{ e: 'move', x: grab.x, y: grab.y + thumbShift(0, at) }])
      expect(e.scroll, `往回拖到第 ${at} 行的位置`).toBe(at)
    }
  })

  it('拖过两端夹住；从端点外往回拖，从端点起算', () => {
    const w = equipWorld()
    const e = equipOf(w)
    const max = maxScroll(V, WEAPON_ROWS)
    const grab = grabThumb(w)
    stepMenu(w, [{ e: 'move', x: grab.x, y: grab.y + 1000 }])
    expect(e.scroll, '拖过底').toBe(max)
    stepMenu(w, [{ e: 'move', x: grab.x, y: grab.y - 1000 }])
    expect(e.scroll, '拖过顶').toBe(0)
    // 指针回到按下的那一点：列表回到按下时的那一行（锚点不随夹取漂）。
    stepMenu(w, [{ e: 'move', x: grab.x, y: grab.y }])
    expect(e.scroll).toBe(0)
  })

  it('松手就停：松手之后再移动，列表一行都不动', () => {
    const w = equipWorld()
    const e = equipOf(w)
    const grab = grabThumb(w)
    stepMenu(w, [{ e: 'move', x: grab.x, y: grab.y + thumbShift(0, 2) }])
    expect(e.scroll).toBe(2)
    stepMenu(w, [{ e: 'release', x: grab.x, y: grab.y + thumbShift(0, 2) }])
    expect(e.drag, '松手之后还在拖').toBeNull()
    stepMenu(w, [{ e: 'move', x: grab.x, y: grab.y + 1000 }])
    expect(e.scroll, '松了手移动鼠标还在翻').toBe(2)
  })

  it('按在滑块上不动就不翻 —— 按下本身不改位置', () => {
    const w = equipWorld()
    const e = equipOf(w)
    const grab = grabThumb(w)
    expect(e.drag, '按在滑块上没开始拖').toBeTruthy()
    stepMenu(w, [{ e: 'move', ...grab }])
    expect(e.scroll).toBe(0)
  })

  it('与槽内点击不打架：按在槽里滑块以外不开始拖，按在别处结束拖拽', () => {
    const w = equipWorld()
    const e = equipOf(w)
    const rows = viewportRows(V)
    const max = maxScroll(V, WEAPON_ROWS)
    const bar = scrollbar(V, WEAPON_ROWS, 0)!
    // 按在滑块下方：翻一屏（槽内点击那条路），**不**进入拖拽。
    const below = { x: bar.track.x + 1, y: bar.thumb.y + bar.thumb.height + 5 }
    stepMenu(w, [{ e: 'press', ...below }])
    expect(e.scroll).toBe(Math.min(rows, max))
    expect(e.drag, '槽内点击进了拖拽').toBeNull()
    stepMenu(w, [{ e: 'move', x: below.x, y: below.y - 1000 }])
    expect(e.scroll, '槽内点击之后移动鼠标把列表拖走了').toBe(Math.min(rows, max))

    // 拖着的时候（松手丢了）再按一下别处：拖拽结束，之后移动不翻。
    const w2 = equipWorld()
    const e2 = equipOf(w2)
    const grab = grabThumb(w2)
    stepMenu(w2, [{ e: 'press', x: V.box.left - 50, y: V.box.top + 10 }])
    expect(e2.drag, '按在别处之后还在拖').toBeNull()
    stepMenu(w2, [{ e: 'move', x: grab.x, y: grab.y + 1000 }])
    expect(e2.scroll).toBe(0)
  })

  it('与滚轮不打架：拖到一半滚一格，滚出来的位置不被下一次移动吃掉', () => {
    const w = equipWorld()
    const e = equipOf(w)
    const max = maxScroll(V, WEAPON_ROWS)
    expect(max, '这一场翻得动的行数不够拖一行再滚一行').toBeGreaterThanOrEqual(2)
    const grab = grabThumb(w)
    const y1 = grab.y + thumbShift(0, 1)
    stepMenu(w, [{ e: 'move', x: grab.x, y: y1 }])
    expect(e.scroll).toBe(1)
    stepMenu(w, [{ e: 'wheel', x: grab.x, y: y1, rows: 1 }])
    expect(e.scroll).toBe(2)
    // 指针没动：位置留在滚轮给的那一行，而不是被拖拽拽回第 1 行。
    stepMenu(w, [{ e: 'move', x: grab.x, y: y1 }])
    expect(e.scroll, '滚轮的结果被拖拽吃掉了').toBe(2)
    // 再往回拖一行的距离：从滚轮给的那一行起算。
    stepMenu(w, [{ e: 'move', x: grab.x, y: y1 - thumbShift(1, 2) }])
    expect(e.scroll).toBe(1)
  })

  it('拖完之后，滚轮与槽内点击都从拖到的那一行接着走', () => {
    const w = equipWorld()
    const e = equipOf(w)
    const rows = viewportRows(V)
    const grab = grabThumb(w)
    stepMenu(w, [
      { e: 'move', x: grab.x, y: grab.y + thumbShift(0, 2) },
      { e: 'release', x: grab.x, y: grab.y + thumbShift(0, 2) },
    ])
    expect(e.scroll).toBe(2)
    stepMenu(w, [{ e: 'wheel', x: V.box.left + 10, y: V.box.top + 10, rows: -1 }])
    expect(e.scroll).toBe(1)
    const bar = scrollbar(V, WEAPON_ROWS, e.scroll)!
    stepMenu(w, [{ e: 'press', x: bar.track.x + 1, y: bar.track.y }])
    expect(e.scroll, '滑块上方按一下翻回去一屏').toBe(Math.max(0, 1 - rows))
  })

  it('物品页走的是同一条路（编的存货，理由同上面那条）', () => {
    const w = replayMenu(trace)
    w.panel = 'thingPanel'
    const d = drugOf(w)
    const rows = viewportRows(DRUG_LIST_VIEW)
    w.drugPack = Array.from({ length: rows + 4 }, (_, i) => ({ name: `试药${i}`, count: 1 }))
    const length = visibleDrugs(w.drugPack).length
    const max = maxScroll(DRUG_LIST_VIEW, length)
    expect(max).toBeGreaterThan(0)
    const bar = scrollbar(DRUG_LIST_VIEW, length, 0)!
    const grab = { x: bar.thumb.x + 1, y: bar.thumb.y + 1 }
    stepMenu(w, [{ e: 'press', ...grab }])
    const shift = scrollbar(DRUG_LIST_VIEW, length, max)!.thumb.y - bar.thumb.y
    stepMenu(w, [{ e: 'move', x: grab.x, y: grab.y + shift }])
    expect(d.scroll).toBe(max)
    stepMenu(w, [{ e: 'release', x: grab.x, y: grab.y + shift }])
    expect(d.drag).toBeNull()
  })

  it('拖回顶之后，真值在框外选中过的那几行照样点得中（够得着那一半）', () => {
    const rows = viewportRows(V)
    const outside = WEAPON_SELECTED.filter((i) => i >= rows)
    expect(outside).not.toEqual([])
    for (const i of outside) {
      const w = equipWorld()
      const e = equipOf(w)
      const grab = grabThumb(w)
      stepMenu(w, [{ e: 'move', x: grab.x, y: grab.y + 1000 }])
      expect(e.scroll, '这一场根本没拖起来').toBeGreaterThan(0)
      stepMenu(w, [
        { e: 'move', ...grab },
        { e: 'release', ...grab },
      ])
      expect(e.scroll).toBe(0)
      moveToSlot(w, i, 0)
      const tick = trace.ticks.find((t) => equipColumn(t).tab === 'weapon' && equipColumn(t).selected === i)
      expect(e.currentEquipment, `拖过一趟之后第 ${i} 行点不中了`).toBe(equipColumn(tick!).selectedName)
    }
  })
})

describe('滚动条：滚动不进真值', () => {
  /**
   * 拖拽状态（「正在拖、从哪一行拖起」）同样**不进真值**：它是 web 侧那条
   * 滚动条例外的一部分，原版连滚动条都没有，更没有对应物（xl-03x.9）。
   */
  it('拖一趟滑块，快照里 equip 与 drug 两列一个字都没变，也没有 drag 这一列', () => {
    const w = equipWorld()
    const e = equipOf(w)
    const before = snapshotMenu(w)
    const bar = scrollbar(EQUIP_LIST_VIEW, WEAPON_ROWS, 0)!
    const grab = { x: bar.thumb.x + 1, y: bar.thumb.y + 1 }
    stepMenu(w, [{ e: 'press', ...grab }])
    stepMenu(w, [{ e: 'move', x: grab.x, y: grab.y + 1000 }])
    expect(e.drag, '这一场根本没进拖拽，下面那条比对就是恒真').toBeTruthy()
    expect(e.scroll, '这一场根本没拖起来').toBeGreaterThan(0)
    const during = snapshotMenu(w)
    expect(during['equip']).toEqual(before['equip'])
    expect(during['drug']).toEqual(before['drug'])
    expect(during['music'], '拖拽不出声').toEqual([])
    expect(JSON.stringify(during)).not.toContain('drag')
  })

  /**
   * 原版没有滚动条，所以真值里没有任何一列会因为翻页而变。这条判据是
   * `menuTrace.test.ts` 那 45 个格子的**补充**：那边跑的是 offset 恒为 0 的
   * 那条路，这边把它翻起来再看一遍。
   */
  it('翻到底之后，快照里 equip 与 drug 两列一个字都没变', () => {
    const w = equipWorld()
    const before = snapshotMenu(w)
    stepMenu(w, [
      {
        e: 'wheel',
        x: EQUIP_LIST_VIEW.box.left + 10,
        y: EQUIP_LIST_VIEW.box.top + 10,
        rows: maxScroll(EQUIP_LIST_VIEW, WEAPON_ROWS),
      },
    ])
    expect(equipOf(w).scroll, '这一场根本没翻起来，下面那条比对就是恒真').toBeGreaterThan(0)
    const after = snapshotMenu(w)
    expect(after['equip']).toEqual(before['equip'])
    expect(after['drug']).toEqual(before['drug'])
    expect(after['mouse'], '滚轮不移动指针').toEqual(before['mouse'])
    expect(after['music'], '滚轮不出声').toEqual([])
  })

  it('快照里根本没有 scroll 这一列', () => {
    const e = equipOf(equipWorld())
    e.scroll = 3
    expect(JSON.stringify(snapshotEquip(e))).not.toContain('scroll')
  })
})
