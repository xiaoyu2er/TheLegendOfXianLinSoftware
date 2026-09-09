import { magicSnapshot } from './magic'
import { MENU_PANEL_ORDER } from './world'
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
 * `drug` / `magic` / `func` / `mouse`），而这一票只做骨架。没实现的四页
 * 不在这里编一份占位值 —— 编出来的占位值会被逐字段比对当成"实现了但是错的"，
 * 而它其实是"还没做"，两者的处置完全不同。
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
    // 奇术页是**它自己那一份状态**，不是当前页的：真值 `magic` 那一列记的
    // 永远是 `magicPanel` 上那十五颗按钮与那条动画，哪怕现在显示的是别的页。
    magic: magicSnapshot(magicOf(w)),
    mouse,
  }
}

function magicOf(w: MenuWorld): MagicState {
  const magic = w.panels.magicPanel.magic
  // 空转要响：拿不到时给一份空的占位，等于让"没建出来"与"建了但全关着"
  // 长得一样。
  if (!magic) throw new Error('奇术页没有 magic 状态')
  return magic
}
