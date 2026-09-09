import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
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

  it('按钮表的次序 = ShopDriver.buttonLabel 的下标算法（三处都从源码现读）', () => {
    // ⚠️ **不要在这里手抄一份 `buttonLabel`**：抄出来的那一份用的是实现自己的
    // `stepBase()` 与 `SHOP_CATEGORIES`，于是"固定那几颗的下标"与"分类那六颗
    // 的次序"两半都按构造成立（/code-review 的 Standards 轴提的）。三样东西
    // 全部从 `ShopDriver.java` 现读 —— 它是**导出真值那一侧**算这几个名字的
    // 地方，两边分家的表现是"点了购买，真值里写着卖出"。
    const driver = readFileSync(repoPath('tools/src/devtools/ShopDriver.java'), 'utf8')

    // 1. 两家店固定那三颗的名字与次序。
    const arrays = [...driver.matchAll(/new String\[\] \{ ([^}]+) \}\[i\]/g)].map((m) =>
      m[1]!.split(',').map((x) => x.trim().replace(/"/g, '')),
    )
    expect(arrays, 'buttonLabel 里那两个字符串数组').toHaveLength(2)
    const [drugFixed, equipFixed] = arrays as [string[], string[]]
    // ⚠️ 头两颗真的是对调的 —— 抄混了也画得出来、点得着。
    expect(drugFixed).not.toEqual(equipFixed)

    // 2. 两家店 `stepBase()` 的返回值。
    const base = driver.match(/private int stepBase\(\) \{ return isDrugShop\(\) \? (\d+) : (\d+); \}/)
    expect(base, 'stepBase 没解出来').not.toBeNull()
    expect(stepBase('drug')).toBe(Number(base![1]))
    expect(stepBase('equipment')).toBe(Number(base![2]))

    // 3. 分类那六颗的次序 —— `ShopScript.CATEGORIES`，同样现读。
    // ⚠️ `tools/src/` 是 **UTF-8**，不是 GBK —— 那条 `javaSource()` 只管
    // `src/` 下原版那批（见 `test/javaSource.ts`）。
    const categories = readFileSync(repoPath('tools/src/devtools/ShopScript.java'), 'utf8').match(
      /CATEGORIES =\s*\r?\n?\s*Arrays\.asList\(([^)]+)\)/,
    )
    expect(categories, 'ShopScript.CATEGORIES 没解出来').not.toBeNull()
    expect(SHOP_CATEGORIES).toEqual(
      categories![1]!.split(',').map((x) => x.trim().replace(/"/g, '')),
    )

    const w = createShopWorld(BASE)
    const label = (fixed: string[], stepFrom: number, i: number): string => {
      if (i >= stepFrom) {
        const row = Math.floor((i - stepFrom) / 2)
        return `${(i - stepFrom) % 2 === 0 ? 'minus:' : 'plus:'}${row}`
      }
      if (fixed === equipFixed && i >= fixed.length) {
        return `category:${SHOP_CATEGORIES[i - fixed.length]}`
      }
      return fixed[i]!
    }
    expect(w.drug.buttons.map((b) => b.label)).toEqual(
      w.drug.buttons.map((_, i) => label(drugFixed, Number(base![1]), i)),
    )
    expect(w.equipment.buttons.map((b) => b.label)).toEqual(
      w.equipment.buttons.map((_, i) => label(equipFixed, Number(base![2]), i)),
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
