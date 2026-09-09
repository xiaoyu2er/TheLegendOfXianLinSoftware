import { describe, expect, it } from 'vitest'
import { DRUGS } from '../battle/drugs'
import { javaSource } from '../test/javaSource'
import { JavaRandom } from '../game/javaRandom'
import { EQUIPMENT_LISTS } from '../menu/equipment'
import { SHOP_CATEGORIES } from './layout'
import { STOCK_ROLL_ORDER, createShopWorld, stepBase } from './world'
import type { ShopConfig } from './world'

const BASE: ShopConfig = { party: ['zhang'], coins: 10000, seed: 1 }

describe('建商店世界', () => {
  it('掷骰的次序，从 EquipmentShopPanel 六段 readEquipment 的先后解出来', () => {
    const source = javaSource('src/shop/EquipmentShopPanel.java')
    // `<字段>List=ShopReader.readEquipment("<中文名>");` 六段，按出现顺序。
    const reads = [...source.matchAll(/(\w+)List=ShopReader\.readEquipment\("[^"]+"\);/g)].map(
      (m) => m[1],
    )
    expect(reads, '六段 readEquipment 没解出来').toHaveLength(6)
    expect(STOCK_ROLL_ORDER).toEqual(reads)
    // ⚠️ **它与分类栏的左右次序不同** —— 武器在最后一个读、却是第一颗按钮。
    // 抄混了的表现是六栏存货整体错位，而每个数仍是 0..9 的合法值。
    expect([...STOCK_ROLL_ORDER]).not.toEqual([...SHOP_CATEGORIES])
    expect([...STOCK_ROLL_ORDER].sort()).toEqual([...SHOP_CATEGORIES].sort())
  })

  it('62 次掷骰共用一条流，先药店后装备店', () => {
    const w = createShopWorld(BASE)
    // 分母从数据源头来：药品表 + 六张装备表各自的长度。
    const rolls =
      DRUGS.length + STOCK_ROLL_ORDER.reduce((n, s) => n + EQUIPMENT_LISTS[s].length, 0)
    const rng = new JavaRandom(BASE.seed)
    const want = Array.from({ length: rolls }, () => rng.scaledInt(10))
    const got = [
      ...w.drug.rows.map((r) => r.stock),
      ...STOCK_ROLL_ORDER.flatMap((slot) => w.equipment.rows[slot].map((r) => r.stock)),
    ]
    // ⚠️ 这一条**只守"同一条流、按这个顺序取"**，守不住"顺序对不对" ——
    // 两边是同一份 `STOCK_ROLL_ORDER` 算出来的（按构造成立的那一族）。
    // 顺序对不对由 `shopTrace.test.ts` 的 `list × shop-categories` 钉着：
    // 那条剧本六栏全走了一遍，62 个数字全部来自原版。
    expect(got).toEqual(want)
    expect(got).toHaveLength(62)
  })

  it('同种子同结果，不同种子不同结果', () => {
    const a = createShopWorld(BASE).drug.rows.map((r) => r.stock)
    const b = createShopWorld(BASE).drug.rows.map((r) => r.stock)
    const c = createShopWorld({ ...BASE, seed: 2 }).drug.rows.map((r) => r.stock)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('按钮表的次序 = ShopDriver.buttonLabel 的下标算法', () => {
    const w = createShopWorld(BASE)
    // 照 `ShopDriver.buttonLabel(i)` 再算一遍：下标 → 名字。两边对不上说明
    // 按钮表排错了，而排错之后每一颗照样画得出来、点得着。
    const label = (kind: 'drug' | 'equipment', i: number): string => {
      const base = stepBase(kind)
      if (i >= base) {
        const row = Math.floor((i - base) / 2)
        return `${(i - base) % 2 === 0 ? 'minus:' : 'plus:'}${row}`
      }
      if (kind === 'drug') return ['buy', 'sell', 'back'][i]!
      if (i < 3) return ['sell', 'buy', 'back'][i]!
      return `category:${SHOP_CATEGORIES[i - 3]}`
    }
    expect(w.drug.buttons.map((b) => b.label)).toEqual(
      w.drug.buttons.map((_, i) => label('drug', i)),
    )
    expect(w.equipment.buttons.map((b) => b.label)).toEqual(
      w.equipment.buttons.map((_, i) => label('equipment', i)),
    )
    // 颗数：固定那几颗 + 每行两颗。
    expect(w.drug.buttons).toHaveLength(stepBase('drug') + 2 * DRUGS.length)
    expect(w.equipment.buttons).toHaveLength(
      stepBase('equipment') + 2 * EQUIPMENT_LISTS.weapon.length,
    )
  })

  it('背包与商品表逐下标对齐，开局全是 0', () => {
    const w = createShopWorld(BASE)
    expect(w.pack.drugs).toHaveLength(DRUGS.length)
    for (const slot of SHOP_CATEGORIES) {
      expect(w.pack.equipment[slot], slot).toHaveLength(EQUIPMENT_LISTS[slot].length)
      expect(w.pack.equipment[slot].every((n) => n === 0)).toBe(true)
    }
    expect(w.pack.drugs.every((n) => n === 0)).toBe(true)
  })

  it('剧本的开局背包按名字加进对应那一格', () => {
    const w = createShopWorld({
      ...BASE,
      drugs: [{ name: '金创药', count: 2 }],
      equipment: [{ name: '皮靴', count: 1 }],
    })
    expect(w.pack.drugs[DRUGS.findIndex((d) => d.name === '金创药')]).toBe(2)
    expect(w.pack.equipment.shoe[EQUIPMENT_LISTS.shoe.findIndex((e) => e.name === '皮靴')]).toBe(1)
    // 别处一个都没多。
    expect(w.pack.drugs.reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('⚠️ 名字对不上是硬失败 —— 原版是静默丢掉，这里改成抛', () => {
    expect(() => createShopWorld({ ...BASE, drugs: [{ name: '不存在的药', count: 1 }] })).toThrow(
      /没有叫 不存在的药/,
    )
    expect(() =>
      createShopWorld({ ...BASE, equipment: [{ name: '不存在的装备', count: 1 }] }),
    ).toThrow(/没有叫 不存在的装备/)
  })

  it('开局的店主欢迎词与那一栏，逐字对回源码', () => {
    const w = createShopWorld(BASE)
    const drugSource = javaSource('src/shop/ShopPanel.java')
    const equipSource = javaSource('src/shop/EquipmentShopPanel.java')
    const welcome = (source: string): string => {
      const m = [...source.matchAll(/String message="([^"]+)";/g)]
      if (m.length !== 1) throw new Error(`message 的初始化式解出了 ${m.length} 处`)
      return m[0]![1]!
    }
    expect(w.drug.message).toBe(welcome(drugSource))
    expect(w.equipment.message).toBe(welcome(equipSource))
    // 第二、三行没有初始化式，开局是 null。
    expect(w.drug.messagePlus).toBeNull()
    expect(w.equipment.messagePlus).toBeNull()
    expect(w.equipment.messageRemark).toBeNull()
    expect(w.equipment.category).toBe('weapon')
  })
})
