import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { EQUIPMENT_LISTS } from '../menu/equipment'
import { hits } from './buttons'
import { BACK_BOX, categoryBox, stepBox } from './layout'
import { cursorRow, pressedLabels, stepShop } from './step'
import { snapshotShop } from './snapshot'
import { createShopWorld, stepBase } from './world'
import type { ShopConfig } from './world'
import type { ShopWorld } from './types'

const BASE: ShopConfig = { party: ['zhang'], coins: 10000, seed: 1 }

/** 一颗按钮的命中中心，与 `ShopDriver.center()` 同一个算法。 */
function center(box: { x: number; y: number; width: number; height: number }): [number, number] {
  return [box.x - 15 + Math.floor(box.width / 2), box.y - 6 + Math.floor(box.height / 2)]
}

/** 按下再松开一颗按钮 —— 两步，与导出器同一个口径。 */
function click(w: ShopWorld, box: { x: number; y: number; width: number; height: number }): void {
  const [x, y] = center(box)
  stepShop(w, [{ e: 'press', x, y }])
  stepShop(w, [{ e: 'release', x, y }])
}

function open(w: ShopWorld, shop: 'drug' | 'equipment'): void {
  stepShop(w, [{ e: 'open', shop }])
}

describe('商店状态层的那几步', () => {
  it('换店：两家店各有一份落点，切过去不带过来', () => {
    const w = createShopWorld(BASE)
    stepShop(w, [{ e: 'move', x: 600, y: 190 }])
    expect(w.drug.currentX).toBe(600)
    open(w, 'equipment')
    expect(w.active).toBe('equipment')
    // ⚠️ 装备店那一份还停在 (0,0) —— 原版两个面板各有自己的 currentX/currentY，
    // 共用一份的表现是"刚进店就已经选中了上一家店那一行"。
    expect(w.equipment.currentX).toBe(0)
    expect(w.equipment.currentY).toBe(0)
    expect(snapshotShop(w)['cursor']).toEqual({ x: 0, y: 0, row: -1 })
    open(w, 'drug')
    expect(w.drug.currentX).toBe(600)
  })

  it('落点落在第几行，跟着当前那一栏的行数走', () => {
    const w = createShopWorld(BASE)
    open(w, 'equipment')
    // 武器栏 20 行，第 6 行的带是 y∈(300,320)。
    stepShop(w, [{ e: 'move', x: 600, y: 310 }])
    expect(cursorRow(w)).toBe(6)
    // 切到鞋子（6 行）之后，同一个落点谁都不是。
    click(w, categoryBox('shoe'))
    expect(cursorRow(w)).toBe(-1)
  })

  it('切分类：换栏、出声、把加减按钮整段重建', () => {
    const w = createShopWorld(BASE)
    open(w, 'equipment')
    const before = w.equipment.buttons.length
    expect(before).toBe(stepBase('equipment') + 2 * EQUIPMENT_LISTS.weapon.length)
    click(w, categoryBox('shoe'))
    expect(w.equipment.category).toBe('shoe')
    expect(w.equipment.buttons).toHaveLength(
      stepBase('equipment') + 2 * EQUIPMENT_LISTS.shoe.length,
    )
    expect(before).not.toBe(w.equipment.buttons.length)
    // 松开那一步出一声。
    expect(w.music).toEqual(['换list.wav'])
    // 重建出来的那批 isclicked 全是 false。
    expect(pressedLabels(w)).toEqual([])
  })

  it('⚠️ 切分类**不清图标框** —— 框里还是上一件，而它不在新那一栏里', () => {
    const w = createShopWorld(BASE)
    open(w, 'equipment')
    stepShop(w, [{ e: 'move', x: 600, y: 310 }])
    const picture = w.equipment.iconPicture
    expect(picture).not.toBeNull()
    click(w, categoryBox('shoe'))
    // 字段没动 —— 原版 `setButton` 换 `equipment` 时一个字都没碰 `equipmentImage`。
    expect(w.equipment.iconPicture).toBe(picture)
    // 而快照那一列是 -1：那张图不属于鞋子那一栏任何一行。
    expect(snapshotShop(w)['icon']).toEqual({ row: -1, name: null })
  })

  it('「返回游戏」：出一声、把"该走了"记下来 —— 换面板是外面那一层的事', () => {
    // 原版那一句就是 `GameLauncher.switchTo("scene")`，两家店逐字相同。
    for (const file of ['src/shop/ShopPanel.java', 'src/shop/EquipmentShopPanel.java']) {
      const source = javaSource(file)
      const m = [...source.matchAll(/back\.isIsclicked\(\)==true\)\{\s*\r?\n\s*MusicReader\.readmusic\("([^"]+)"\);\s*\r?\n\s*GameLauncher\.switchTo\("(\w+)"\);/g)]
      expect(m, `${file} 的 back 分支`).toHaveLength(1)
      expect(m[0]![1]).toBe('换头像.wav')
      expect(m[0]![2]).toBe('scene')
    }
    for (const shop of ['drug', 'equipment'] as const) {
      const w = createShopWorld(BASE)
      open(w, shop)
      expect(w.leaving).toBe(false)
      click(w, BACK_BOX)
      expect(w.music).toEqual(['换头像.wav'])
      expect(w.leaving).toBe(true)
      // ⚠️ 真值不记它 —— 商店那三条剧本一次都没按过「返回游戏」。
      expect(Object.keys(snapshotShop(w))).not.toContain('leaving')
    }
  })

  it('按下那一步 pressed 里有它，松开那一步是空的', () => {
    const w = createShopWorld(BASE)
    const box = stepBox(0, true)
    const [x, y] = center(box)
    expect(hits(box, x, y)).toBe(true)
    stepShop(w, [{ e: 'press', x, y }])
    expect(pressedLabels(w)).toEqual(['plus:0'])
    stepShop(w, [{ e: 'release', x, y }])
    expect(pressedLabels(w)).toEqual([])
  })

  it('音效是这一步的 —— 每步开头清空', () => {
    const w = createShopWorld(BASE)
    click(w, BACK_BOX)
    expect(w.music).toEqual(['换头像.wav'])
    stepShop(w, [{ e: 'move', x: 0, y: 0 }])
    expect(w.music).toEqual([])
  })

  it('anim 那一支不碰任何一个真值记着的字段', () => {
    const w = createShopWorld(BASE)
    stepShop(w, [{ e: 'move', x: 600, y: 190 }])
    const before = JSON.stringify(snapshotShop(w))
    stepShop(w, [{ e: 'anim' }])
    // 只有 `music` 被这一步的开头清空过，而它本来就是空的。
    expect(JSON.stringify(snapshotShop(w))).toBe(before)
  })
})
