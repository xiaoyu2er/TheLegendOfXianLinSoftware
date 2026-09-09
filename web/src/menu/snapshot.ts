import { drawnFuncButtons } from './funcButtons'
import { MENU_PANEL_ORDER } from './world'
import type { FuncButtonsState } from './funcButtons'
import type { MenuWorld } from './types'

/**
 * 把菜单世界快照成**行为真值那一行的形状**（`docs/trace-format.md` §菜单真值）。
 * 字段名、字段个数、嵌套层级与 `tools/src/devtools/MenuDriver.snapshotState`
 * 逐字对应，逐字段比对时 `toEqual` 直接就能对上。
 *
 * ## 这里**只出已经实现的那几组**，这是有意的
 *
 * 真值一行有九组可断言的列（`music` / `panel` / `hero` / `heroes` / `equip` /
 * `drug` / `magic` / `func` / `mouse`），而这里只出**已经有人实现的**那几组：
 * 骨架那五组加上天书页的 `func`（xl-6lo.12）。还没做的三页不在这里编一份
 * 占位值 —— 编出来的占位值会被逐字段比对当成"实现了但是错的"，而它其实是
 * "还没做"，两者的处置完全不同。
 *
 * 谁做完了、谁还欠着，由 `menuTrace.test.ts` 那张**按字段组的手写登记表**说，
 * 并与真值现出的那份分母对撞。
 */
export function snapshotMenu(w: MenuWorld): Record<string, unknown> {
  const mouse: Record<string, unknown> = {}
  for (const name of MENU_PANEL_ORDER) {
    const m = w.panels[name].mouse
    mouse[name] = { code: m.code, frame: m.frame, x: m.x, y: m.y }
  }
  return {
    music: [...w.music],
    panel: w.panel,
    // 天书页没有卷轴 —— 那一列是 `null`，不是"某个默认的人"。
    hero: w.panels[w.panel].scoll?.whichHero ?? null,
    heroes: w.heroes.map((h) => ({
      name: h.name,
      level: h.level,
      physicalPower: h.physicalPower,
      agile: h.agile,
      strength: h.strength,
      spirit: h.spirit,
      hp: h.hp,
      hpMax: h.hpMax,
      mp: h.mp,
      mpMax: h.mpMax,
      defense: h.defense,
      skillDefense: h.skillDefense,
      skillNumber: h.skillNumber,
    })),
    /**
     * 天书页那一列（`MenuDriver.funcJson`）：**当前 `isDraw` 为真的按钮名**，
     * 按字段名排序。读的永远是 `funcPanel` 那一份，与当前显示哪一页无关 ——
     * 导出器那边取的也是 `funcPanel().fb`。
     */
    func: { drawn: drawnFuncButtons(funcButtons(w)) },
    mouse,
  }
}

function funcButtons(w: MenuWorld): FuncButtonsState {
  const fb = w.panels.funcPanel.funcButtons
  // 天书页一定有这一排按钮（`world.ts` 的 `createSubPanel`）。空转要响：
  // 给它编一个空的 `drawn: []` 出来，与"这一页一颗都没画"长得一模一样。
  if (!fb) throw new Error('funcPanel 没有 funcButtons —— 世界建坏了')
  return fb
}
