import { visibleDrugs } from './drugPanel'
import { drawnFuncButtons } from './funcButtons'
import { snapshotEquip } from './equipPanel'
import { MENU_PANEL_ORDER } from './world'
import type { FuncButtonsState } from './funcButtons'
import { magicSnapshot } from './magic'
import type { MagicState } from './magic'
import type { MenuWorld } from './types'

/**
 * 把菜单世界快照成**行为真值那一行的形状**（`docs/trace-format.md` §菜单真值）。
 * 字段名、字段个数、嵌套层级与 `tools/src/devtools/MenuDriver.snapshotState`
 * 逐字对应，逐字段比对时 `toEqual` 直接就能对上。
 *
 * ## 这里**只出已经实现的那几组**，这是有意的
 *
 * 真值一行有九组可断言的列（`music` / `panel` / `hero` / `heroes` / `equip` /
 * `drug` / `magic` / `func` / `mouse`），**五页的组现在都有人实现了**
 * （xl-6lo.9/.10/.11/.12）。⚠️ 没实现的组不在这里编占位值 —— 编出来的
 * 占位值会被逐字段比对当成"实现了但是错的"，而它其实是"还没做"，
 * 两者的处置完全不同。
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
    drug: drugSnapshot(w),
    /**
     * 天书页那一列（`MenuDriver.funcJson`）：**当前 `isDraw` 为真的按钮名**，
     * 按字段名排序。读的永远是 `funcPanel` 那一份，与当前显示哪一页无关 ——
     * 导出器那边取的也是 `funcPanel().fb`。
     */
    func: { drawn: drawnFuncButtons(funcButtons(w)) },
    // 奇术页是**它自己那一份状态**，不是当前页的：真值 `magic` 那一列记的
    // 永远是 `magicPanel` 上那十五颗按钮与那条动画，哪怕现在显示的是别的页。
    magic: magicSnapshot(magicOf(w)),
    // 装备页那一列。⚠️ **它取的是 `equipPanel` 自己的那一份，不是当前页的** ——
    // 真值也一样（`MenuDriver.equipJson()` 直接找 `mp.equipPanel`）：人在物品页
    // 时装备页的状态照记，`menu-equip` 第 19..23 步就是这么读的。
    equip: snapshotEquip(equipOf(w)),
    mouse,
  }
}

/**
 * 真值 `drug` 那一列（`MenuDriver.drugJson`）：
 *
 * - `list` —— **存货里 `count>0` 的那几种，按药品表的行序**。它读的是
 *   `DrugPack.drugList`（全局那一份），不是物品页缓存的 `list` 字段。
 * - `selected` —— 选中那瓶在**上面那份过滤后的清单**里的下标；没选中是 `-1`。
 *   ⚠️ 不是在六种药那张全表里的下标，喝空了别的药之后两者会分岔。
 * - `useDraw` —— `use_button.isDraw==1`。
 */
function drugSnapshot(w: MenuWorld): Record<string, unknown> {
  const list = visibleDrugs(w.drugPack)
  const d = w.panels.thingPanel.drug
  const current = d?.currentDrug ?? null
  return {
    list: list.map((s) => ({ name: s.name, count: s.count })),
    selected: current === null ? -1 : list.findIndex((s) => s.name === current),
    selectedName: current,
    useDraw: d?.useButton.isDraw === true,
  }
}

function funcButtons(w: MenuWorld): FuncButtonsState {
  const fb = w.panels.funcPanel.funcButtons
  // 天书页一定有这一排按钮（`world.ts` 的 `createSubPanel`）。空转要响：
  // 给它编一个空的 `drawn: []` 出来，与"这一页一颗都没画"长得一模一样。
  if (!fb) throw new Error('funcPanel 没有 funcButtons —— 世界建坏了')
  return fb
}

function magicOf(w: MenuWorld): MagicState {
  const magic = w.panels.magicPanel.magic
  // 空转要响：拿不到时给一份空的占位，等于让"没建出来"与"建了但全关着"
  // 长得一样。
  if (!magic) throw new Error('奇术页没有 magic 状态')
  return magic
}

function equipOf(w: MenuWorld) {
  const equip = w.panels.equipPanel.equip
  // 建世界时装备页一定有这一摊；没有的话下面那一整列会安静地缺席，而
  // 「这一列还没做」与「这一列全对」在逐字段比对里长得不一样但指向错的地方。
  if (!equip) throw new Error('equipPanel 没有装备页状态')
  return equip
}
