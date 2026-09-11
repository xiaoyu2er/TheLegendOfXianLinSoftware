import { describe, expect, it } from 'vitest'
import { menuDrawList } from './drawList'
import type { MenuDrawOp } from './drawList'
import { scrollbarOps } from './scrollbar'
import { EQUIP_LIST_VIEW, EQUIP_X_START, equipList } from '../equipPanel'
import { DRUG_LIST_VIEW, DRUG_LIST_X, visibleDrugs } from '../drugPanel'
import { maxScroll, scrollbar, viewportRows } from '../scroll'
import { readMenuTrace, replayMenu } from '../trace'
import { stepMenu } from '../step'
import { clickButton } from '../../test/menuClicks'
import type { MenuWorld } from '../types'

/**
 * 滚动条画出来的那一半（xl-6lo.13）。状态那一半在 `menu/scroll.test.ts`
 * —— 分成两个文件不是分类癖：`menu/` 那一层有一条判据禁止它 import 渲染层
 * （`menuTrace.test.ts` 的「状态层整个目录都不碰渲染」），而这里非碰不可。
 *
 * 期望值同样从 `menu-scroll` 那份真值来：世界照它的 `setup` 建，列表有多长
 * 是真值说了算。
 */

const trace = readMenuTrace('menu-scroll')

function equipWorld(): MenuWorld {
  const w = replayMenu(trace)
  w.panel = 'equipPanel'
  return w
}

/** 装备页列表那几行的绘制 op（名字那一半，数量那一半画在 x+150）。 */
function listRows(ops: readonly MenuDrawOp[], x: number): { text: string; y: number }[] {
  return ops.flatMap((op) =>
    op.kind === 'text' && op.layer === 'page' && op.x === x ? [{ text: op.text, y: op.y }] : [],
  )
}

function rects(ops: readonly MenuDrawOp[]): MenuDrawOp[] {
  return ops.filter((op) => op.kind === 'rect')
}

describe('滚动条画出来的那一半', () => {
  it('撑过框时只画一屏的行数，画的是滚动窗口里的那几件', () => {
    const w = equipWorld()
    const e = w.panels.equipPanel.equip!
    const list = equipList(e)
    const rows = viewportRows(EQUIP_LIST_VIEW)
    expect(list.length, '这一场的列表没撑过框，下面的裁剪判据是恒真的').toBeGreaterThan(rows)

    const top = listRows(menuDrawList(w), EQUIP_X_START)
    expect(top.map((r) => r.text)).toEqual(list.slice(0, rows).map((i) => i.name))
    // 每一行都落在框里 —— 裁掉的正是掉出去的那几行。
    for (const r of top) expect(r.y).toBeLessThanOrEqual(EQUIP_LIST_VIEW.box.bottom)

    // 翻到底：画的是最后那 rows 件，第一件不见了。
    const max = maxScroll(EQUIP_LIST_VIEW, list.length)
    stepMenu(w, [
      { e: 'wheel', x: EQUIP_LIST_VIEW.box.left + 10, y: EQUIP_LIST_VIEW.box.top + 10, rows: max },
    ])
    const bottom = listRows(menuDrawList(w), EQUIP_X_START)
    expect(bottom.map((r) => r.text)).toEqual(list.slice(max).map((i) => i.name))
    expect(bottom.map((r) => r.text)).not.toContain(list[0]!.name)
    // 两屏的落点相同 —— 行在原地，动的是内容。
    expect(bottom.map((r) => r.y)).toEqual(top.map((r) => r.y))
  })

  /**
   * 拖拽（xl-03x.9）走的是另一条改 `scroll` 的路，画的那一半要**在这条路上**
   * 再核一遍：仍然只画一屏、画的是拖到的那几件，滑块画在拖到的位置上。
   */
  it('拖滑块到底：仍然只画一屏，画的是最后那几件，滑块画在底上', () => {
    const w = equipWorld()
    const list = equipList(w.panels.equipPanel.equip!)
    const rows = viewportRows(EQUIP_LIST_VIEW)
    const max = maxScroll(EQUIP_LIST_VIEW, list.length)
    expect(max, '这一场翻不动，下面的判据是恒真的').toBeGreaterThan(0)
    const bar = scrollbar(EQUIP_LIST_VIEW, list.length, 0)!
    const grab = { x: bar.thumb.x + 1, y: bar.thumb.y + 1 }
    stepMenu(w, [{ e: 'press', ...grab }])
    stepMenu(w, [{ e: 'move', x: grab.x, y: grab.y + 1000 }])
    expect(w.panels.equipPanel.equip!.scroll).toBe(max)

    const drawn = listRows(menuDrawList(w), EQUIP_X_START)
    expect(drawn).toHaveLength(rows)
    expect(drawn.map((r) => r.text)).toEqual(list.slice(max).map((i) => i.name))
    for (const r of drawn) expect(r.y).toBeLessThanOrEqual(EQUIP_LIST_VIEW.box.bottom)
    const thumb = rects(menuDrawList(w))[1]!
    const atBottom = scrollbar(EQUIP_LIST_VIEW, list.length, max)!.thumb
    expect(thumb.kind === 'rect' && [thumb.y, thumb.height]).toEqual([atBottom.y, atBottom.height])
  })

  it('撑过框时画出滚动条那两块矩形，位置与 `scrollbar()` 算的相同', () => {
    const w = equipWorld()
    const list = equipList(w.panels.equipPanel.equip!)
    const bar = scrollbar(EQUIP_LIST_VIEW, list.length, 0)!
    const drawn = rects(menuDrawList(w))
    expect(drawn).toHaveLength(2)
    // 槽在前、滑块在后 —— 次序就是 z 序，反过来滑块会被槽盖住。
    expect(drawn.map((op) => (op.kind === 'rect' ? [op.x, op.y, op.width, op.height] : []))).toEqual([
      [bar.track.x, bar.track.y, bar.track.width, bar.track.height],
      [bar.thumb.x, bar.thumb.y, bar.thumb.width, bar.thumb.height],
    ])
    for (const op of drawn) {
      expect(op.kind === 'rect' && op.layer).toBe('page')
      expect(op.kind === 'rect' && op.alpha).toBeGreaterThan(0)
      expect(op.kind === 'rect' && op.alpha).toBeLessThanOrEqual(1)
    }
  })

  it('装得下时一条矩形都不画 —— 两页各验一次', () => {
    // 装备页：切到盔甲分类（真值里那 1 件）。**照真值那样点槽位按钮切**，
    // 不是直接改 `currentList` —— 后者会留下一个穿着武器的 `heroEquipment`，
    // 那是一个原版到不了的状态。
    const w = equipWorld()
    const e = w.panels.equipPanel.equip!
    clickButton(w, e.slots.armor)
    expect(e.currentList).toBe('armor')
    expect(equipList(e).length).toBeLessThanOrEqual(viewportRows(EQUIP_LIST_VIEW))
    expect(rects(menuDrawList(w))).toEqual([])

    // 物品页：六种药，框里放得下 11 行。
    const t = replayMenu(trace)
    t.panel = 'thingPanel'
    const drugs = visibleDrugs(t.drugPack)
    expect(drugs.length).toBeGreaterThan(0)
    expect(drugs.length).toBeLessThanOrEqual(viewportRows(DRUG_LIST_VIEW))
    expect(rects(menuDrawList(t))).toEqual([])
    // 而且一行都没被裁掉。
    expect(listRows(menuDrawList(t), DRUG_LIST_X).map((r) => r.text)).toEqual(drugs.map((d) => d.name))
  })

  it('`scrollbarOps` 自己：滚不动就一条 op 都不出', () => {
    const rows = viewportRows(DRUG_LIST_VIEW)
    expect(scrollbarOps(DRUG_LIST_VIEW, rows, 0)).toEqual([])
    expect(scrollbarOps(DRUG_LIST_VIEW, rows + 1, 0)).toHaveLength(2)
  })
})
