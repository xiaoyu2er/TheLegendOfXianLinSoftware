import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { javaSource } from '../test/javaSource'
import { EQUIPMENT_LISTS } from '../menu/equipment'
import { BACK_BOX, categoryBox, stepBox } from './layout'
import type { ShopButtonBox } from './layout'
import { hitCenter } from './test/hitCenter'
import { cursorRow, pressedLabels, stepShop } from './step'
import { snapshotShop } from './snapshot'
import { createShopWorld, stepBase } from './world'
import type { ShopConfig } from './world'
import type { ShopWorld } from './types'

const BASE: ShopConfig = { party: ['zhang'], coins: 10000, seed: 1 }

/** 按下再松开一颗按钮 —— 两步，与导出器同一个口径。 */
function click(w: ShopWorld, box: ShopButtonBox): void {
  const [x, y] = hitCenter(box)
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

  /**
   * 按住移动（xl-bwl）：两家店的 `mouseDragged` 只记 `currentX/Y` 再 `repaint()`，**不跑**
   * 按钮的 `isMoveIn` 与面板的 `isMoveIn()` —— 在按钮上按下再拖走，悬停贴图、图标框与店主
   * 台词都停在拖动之前那一份。
   */
  it('拖动只挪落点：悬停、图标框、台词都不动', () => {
    for (const file of ['src/shop/ShopPanel.java', 'src/shop/EquipmentShopPanel.java']) {
      const m = [...javaSource(file).matchAll(/public void mouseDragged\(MouseEvent ex\) \{([^}]*)\}/g)]
      expect(m, `${file} 的 mouseDragged`).toHaveLength(1)
      expect(m[0]![1]!.replace(/\s+/g, '')).toBe('currentX=ex.getX();currentY=ex.getY();repaint();')
    }
    for (const shop of ['drug', 'equipment'] as const) {
      const w = createShopWorld(BASE)
      open(w, shop)
      stepShop(w, [{ e: 'move', x: 600, y: 190 }])
      const before = structuredClone(shop === 'drug' ? w.drug : w.equipment) as { currentX: number; currentY: number }
      // 拖到另一行、再拖到一颗按钮上 —— 两处 move 都会改悬停，drag 一处都不该改。
      stepShop(w, [{ e: 'drag', x: 600, y: 310 }])
      const [bx, by] = hitCenter(BACK_BOX)
      stepShop(w, [{ e: 'drag', x: bx, y: by }])
      const after = shop === 'drug' ? w.drug : w.equipment
      expect(after.currentX).toBe(bx)
      expect(after.currentY).toBe(by)
      expect({ ...after, currentX: before.currentX, currentY: before.currentY }).toEqual(before)
    }
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

  it('⚠️ setButton 六段的先后：分类 → 买 → 卖 → 返回 → 加减 → 松手，两边都现读', () => {
    // 原版那一侧：从 `setButton()` 的方法体里现读六段的出现位置。
    for (const [what, file, stepLoop] of [
      ['药店', 'src/shop/ShopPanel.java', /for\(int i=3;i<buttonlist\.size\(\);i\+=2\)/],
      ['装备店', 'src/shop/EquipmentShopPanel.java', /for\(int i=9;i<buttonList\.size\(\);i\+=2\)/],
    ] as const) {
      const source = javaSource(file)
      const body = source.slice(source.indexOf('public void setButton()'))
      const marks: [string, number][] = [
        ['buy', body.indexOf('buy.isIsclicked()==true')],
        ['sell', body.indexOf('sell.isIsclicked()==true')],
        ['back', body.indexOf('back.isIsclicked()==true')],
        ['加减', body.search(stepLoop)],
        ['松手', body.indexOf('isRelesedButton')],
      ]
      if (what === '装备店') marks.unshift(['分类', body.indexOf('weapon.isIsclicked()==true')])
      for (const [name, at] of marks) expect(at, `${what} 的「${name}」那一段`).toBeGreaterThan(-1)
      const order = marks.map(([, at]) => at)
      expect(order, `${what} 里六段的先后`).toEqual([...order].sort((a, b) => a - b))
    }

    // 这一侧：两个占位洞必须**分开**，`back` 夹在中间。合成一个洞的话，后面
    // 两张票把四段一起填进去，加减就跑到「返回游戏」前头去了 —— 而那一步的
    // 后果只是 `music` 那一列两声调了个个儿。
    const mine = readFileSync(repoPath('web/src/shop/step.ts'), 'utf8')
    const body = mine.slice(mine.indexOf('function setButton('))
    const order = [
      ['分类', body.indexOf('setEquipCategory(w, p)')],
      ['买卖', body.indexOf('buySellButtons(w)')],
      ['返回', body.indexOf("clicked(p.buttons, 'back')")],
      ['加减', body.indexOf('stepPurchaseButtons(w)')],
      ['松手', body.indexOf('releaseButton(b,')],
    ] as [string, number][]
    for (const [name, at] of order) expect(at, `setButton 里的「${name}」`).toBeGreaterThan(-1)
    expect(order.map(([, at]) => at)).toEqual([...order.map(([, at]) => at)].sort((a, b) => a - b))
  })

  it('按下那一步 pressed 里有它，松开那一步是空的', () => {
    const w = createShopWorld(BASE)
    const [x, y] = hitCenter(stepBox(0, true))
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
