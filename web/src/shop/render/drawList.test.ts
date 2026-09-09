import { describe, expect, it } from 'vitest'
import { javaSource } from '../../test/javaSource'
import { DRUGS } from '../../battle/drugs'
import { EQUIPMENT_LISTS } from '../../menu/equipment'
import {
  ANIMATION_FRAMES,
  BACK_BOX,
  COINS_X,
  COINS_Y,
  HELD_DX,
  ICON_X,
  ICON_Y,
  LIST_X,
  LIST_Y0,
  MESSAGE_X,
  MESSAGE_Y,
  PRICE_DX,
  PURCHASE_DX_DRUG,
  PURCHASE_DX_EQUIP,
  STEP_ROW_H,
  STOCK_DX_DRUG,
  STOCK_DX_EQUIP,
  categoryBox,
} from '../layout'
import { PREVIEW_CONFIG } from '../preview'
import { stepShop } from '../step'
import { hitCenter } from '../test/hitCenter'
import { createShopWorld } from '../world'
import type { ShopWorld } from '../types'
import { PURSE, SHOP_BACKGROUND, SIGN, animationFrameId, mouseId } from './assets'
import { SHOP_LAYERS, shopDrawList } from './drawList'
import type { ShopDrawOp } from './drawList'

function world(party: string[] = ['zhang']): ShopWorld {
  return createShopWorld({ party, coins: 10000, seed: 1 })
}

function texts(ops: readonly ShopDrawOp[]): string[] {
  return ops.filter((o) => o.kind === 'text').map((o) => (o as { text: string }).text)
}

function at(ops: readonly ShopDrawOp[], x: number, y: number): ShopDrawOp[] {
  return ops.filter((o) => o.x === x && o.y === y)
}

describe('商店的绘制清单', () => {
  it('四层的次序就是 paint() 那四句的次序', () => {
    // 判据是源码：`paint()` 里那四段的先后。
    for (const file of ['src/shop/ShopPanel.java', 'src/shop/EquipmentShopPanel.java']) {
      const source = javaSource(file)
      const body = source.match(/public void paint\(Graphics g\) \{([\s\S]*?)\n\t\}/)
      expect(body, `${file} 的 paint()`).not.toBeNull()
      const order = [
        body![1]!.indexOf('drawImage(backgroundImage'),
        body![1]!.indexOf('drawIcon('),
        body![1]!.indexOf('drawButton('),
        body![1]!.indexOf('drawImage(mouse,'),
      ]
      expect(order.every((i) => i >= 0), `${file} 的四层没都找到`).toBe(true)
      expect([...order].sort((a, b) => a - b)).toEqual(order)
    }
    const ops = shopDrawList(world(), 0)
    const layers = ops.map((o) => o.layer)
    // 清单里各层是**连成一段**的，而且按 SHOP_LAYERS 的次序。
    const seen = [...new Set(layers)]
    expect(seen).toEqual(SHOP_LAYERS.filter((l) => seen.includes(l)))
    expect(layers).toEqual([...layers].sort((a, b) => SHOP_LAYERS.indexOf(a) - SHOP_LAYERS.indexOf(b)))
  })

  it('底图、招牌、钱袋、游标各一条，招牌两家店不是同一张', () => {
    const w = world()
    const drug = shopDrawList(w, 0)
    expect(drug[0]).toEqual({ kind: 'image', layer: 'background', id: SHOP_BACKGROUND, x: 0, y: 0 })
    expect(drug.filter((o) => o.kind === 'image' && o.id === SIGN.drug)).toHaveLength(1)
    expect(drug.filter((o) => o.kind === 'image' && o.id === PURSE)).toHaveLength(1)
    stepShop(w, [{ e: 'open', shop: 'equipment' }])
    const equip = shopDrawList(w, 0)
    expect(equip.filter((o) => o.kind === 'image' && o.id === SIGN.equipment)).toHaveLength(1)
    expect(equip.filter((o) => o.kind === 'image' && o.id === SIGN.drug)).toHaveLength(0)
  })

  it('游标画在当前落点上，最后一条', () => {
    const w = world()
    stepShop(w, [{ e: 'move', x: 321, y: 123 }])
    const ops = shopDrawList(w, 3)
    const last = ops[ops.length - 1]!
    expect(last).toEqual({ kind: 'image', layer: 'mouse', id: mouseId(3), x: 321, y: 123 })
  })

  it('每一行六列，价钱与持有量前面那个空格照抄', () => {
    const w = world()
    const ops = shopDrawList(w, 0)
    const row0 = w.drug.rows[0]!
    expect(at(ops, LIST_X, LIST_Y0).map((o) => (o as { text: string }).text)).toEqual([row0.name])
    expect(at(ops, LIST_X + PRICE_DX, LIST_Y0).map((o) => (o as { text: string }).text)).toEqual([
      ` ${row0.price}`,
    ])
    expect(at(ops, LIST_X + STOCK_DX_DRUG, LIST_Y0).map((o) => (o as { text: string }).text)).toEqual(
      [` ${row0.stock}`],
    )
    expect(at(ops, LIST_X + HELD_DX, LIST_Y0).map((o) => (o as { text: string }).text)).toEqual([' 0'])
    expect(
      at(ops, LIST_X + PURCHASE_DX_DRUG, LIST_Y0).map((o) => (o as { text: string }).text),
    ).toEqual([' 0'])
    // 第 n 行的基线 = 200 + 20n。
    expect(at(ops, LIST_X, LIST_Y0 + STEP_ROW_H).map((o) => (o as { text: string }).text)).toEqual([
      w.drug.rows[1]!.name,
    ])
  })

  it('⚠️ 金钱那一句在循环体里 —— 有几行就有几条重叠的 op', () => {
    const w = world()
    expect(at(shopDrawList(w, 0), COINS_X, COINS_Y)).toHaveLength(DRUGS.length)
    stepShop(w, [{ e: 'open', shop: 'equipment' }])
    // 武器栏 20 行 → 20 条。改成 1 条画面上一模一样，而清单是这一层唯一的判据。
    expect(at(shopDrawList(w, 0), COINS_X, COINS_Y)).toHaveLength(EQUIPMENT_LISTS.weapon.length)
  })

  it('⚠️ 两家店的存货列与 purchase 列 x 不同', () => {
    const w = world()
    const drug = shopDrawList(w, 0)
    stepShop(w, [{ e: 'open', shop: 'equipment' }])
    const equip = shopDrawList(w, 0)
    expect(at(drug, LIST_X + STOCK_DX_DRUG, LIST_Y0)).toHaveLength(1)
    expect(at(drug, LIST_X + STOCK_DX_EQUIP, LIST_Y0)).toHaveLength(0)
    expect(at(equip, LIST_X + STOCK_DX_EQUIP, LIST_Y0)).toHaveLength(1)
    expect(at(equip, LIST_X + STOCK_DX_DRUG, LIST_Y0)).toHaveLength(0)
    expect(at(drug, LIST_X + PURCHASE_DX_DRUG, LIST_Y0)).toHaveLength(1)
    expect(at(equip, LIST_X + PURCHASE_DX_EQUIP, LIST_Y0)).toHaveLength(1)
  })

  it('图标框：开局没有那一条，悬停过一行之后才有', () => {
    const w = world()
    expect(at(shopDrawList(w, 0), ICON_X, ICON_Y)).toHaveLength(0)
    stepShop(w, [{ e: 'move', x: 600, y: 190 }])
    expect(at(shopDrawList(w, 0), ICON_X, ICON_Y)).toEqual([
      { kind: 'image', layer: 'icon', id: w.drug.rows[0]!.picture, x: ICON_X, y: ICON_Y },
    ])
  })

  it('店主那三行话：null 的不画', () => {
    const w = world()
    const ops = shopDrawList(w, 0)
    // 开局只有第一行有内容。
    expect(at(ops, MESSAGE_X, MESSAGE_Y).map((o) => (o as { text: string }).text)).toEqual([
      w.drug.message,
    ])
    expect(texts(ops).filter((t) => t === w.drug.messagePlus)).toEqual([])
    // 手动把第二三行放上去（xl-knp.7 / .8 会真的填它们）。
    w.drug.messagePlus = '物美价廉，呵呵'
    expect(texts(shopDrawList(w, 0))).toContain('物美价廉，呵呵')
    stepShop(w, [{ e: 'open', shop: 'equipment' }])
    w.equipment.messageRemark = '每个人都能使用'
    expect(texts(shopDrawList(w, 0))).toContain('每个人都能使用')
  })

  it('⚠️ 第三行只有装备店画 —— 药店根本没有那个字段', () => {
    const w = world()
    // 药店那一份的类型里就没有 messageRemark，画不出来也传不进去。
    expect('messageRemark' in w.drug).toBe(false)
    expect('messageRemark' in w.equipment).toBe(true)
  })

  it('出战名单决定画几个人的动画与几组属性', () => {
    const one = shopDrawList(world(['zhang']), 0)
    const three = shopDrawList(world(['zhang', 'lu', 'wen']), 0)
    expect(one.filter((o) => o.kind === 'image' && o.id === animationFrameId('陆雪琪', 0))).toHaveLength(0)
    expect(three.filter((o) => o.kind === 'image' && o.id === animationFrameId('陆雪琪', 0))).toHaveLength(1)
    // 一个人 = 1 条动画 + 4 行字 + 4 张图标 = 9 条。
    expect(three.length - one.length).toBe(2 * 9)
    // 店主那一条不看名单。
    expect(one.filter((o) => o.kind === 'image' && o.id === animationFrameId('店主', 0))).toHaveLength(1)
  })

  it('帧号推着五处动画一起走', () => {
    const w = world(['zhang'])
    const a = shopDrawList(w, 0)
    const b = shopDrawList(w, 5)
    const ids = (ops: readonly ShopDrawOp[]) =>
      ops.filter((o) => o.kind === 'image').map((o) => (o as { id: string }).id)
    expect(ids(a)).not.toEqual(ids(b))
    expect(ids(b)).toContain(animationFrameId('张小凡', 5))
    expect(ids(b)).toContain(animationFrameId('店主', 5))
    expect(ids(b)).toContain(mouseId(5))
  })

  it('越界的帧号是硬失败 —— 算出来的 ID 查不到，而"查不到"分不清是谁的错', () => {
    const w = world()
    expect(() => shopDrawList(w, -1)).toThrow(/动画帧号/)
    expect(() => shopDrawList(w, ANIMATION_FRAMES)).toThrow(/动画帧号/)
    expect(() => shopDrawList(w, 1.5)).toThrow(/动画帧号/)
  })

  it('按钮那一层：每颗一条，贴的是它此刻那张', () => {
    const w = world()
    const buttons = () => shopDrawList(w, 0).filter((o) => o.layer === 'button')
    expect(buttons()).toHaveLength(w.drug.buttons.length)
    const back = w.drug.buttons.find((b) => b.label === 'back')!
    const before = buttons().find((o) => o.x === BACK_BOX.x && o.y === BACK_BOX.y)
    stepShop(w, [{ e: 'press', x: BACK_BOX.x, y: BACK_BOX.y }])
    expect(back.image).toBe('pressed')
    const after = buttons().find((o) => o.x === BACK_BOX.x && o.y === BACK_BOX.y)
    expect(after).not.toEqual(before)
  })

  it('开发用预览那一局，两家店八帧都画得出清单', () => {
    // 判据在这里而不在 `preview.test.ts`：那个目录被「状态层不碰渲染」整个
    // 扫着（连测试文件一起）。
    const w = createShopWorld(PREVIEW_CONFIG)
    for (const active of ['drug', 'equipment'] as const) {
      w.active = active
      for (let frame = 0; frame < ANIMATION_FRAMES; frame++) {
        expect(shopDrawList(w, frame).length, `${active} 第 ${frame} 帧`).toBeGreaterThan(0)
      }
    }
  })

  it('切分类之后按钮那一层跟着变长变短', () => {
    const w = world()
    stepShop(w, [{ e: 'open', shop: 'equipment' }])
    const before = shopDrawList(w, 0).filter((o) => o.layer === 'button').length
    const [x, y] = hitCenter(categoryBox('shoe'))
    stepShop(w, [{ e: 'press', x, y }])
    stepShop(w, [{ e: 'release', x, y }])
    const after = shopDrawList(w, 0).filter((o) => o.layer === 'button').length
    expect(before - after).toBe(2 * (EQUIPMENT_LISTS.weapon.length - EQUIPMENT_LISTS.shoe.length))
  })
})
