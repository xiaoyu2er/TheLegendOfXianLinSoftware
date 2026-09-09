import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import {
  BACK_BOX,
  BUY_BOX,
  CATEGORY_H,
  CATEGORY_W,
  CATEGORY_X0,
  CATEGORY_Y,
  COINS_X,
  COINS_Y,
  FIRST_CATEGORY,
  HELD_DX,
  ICON_X,
  ICON_Y,
  KEEPER_ANIMATION_X,
  KEEPER_ANIMATION_Y,
  LIST_FONT_SIZE,
  LIST_X,
  LIST_Y0,
  MESSAGE_PLUS_Y,
  MESSAGE_X,
  MESSAGE_Y,
  MINUS_X,
  PARTY_ANIMATION_X,
  PARTY_ANIMATION_Y,
  PLUS_X,
  PRICE_DX,
  PURCHASE_DX_DRUG,
  PURCHASE_DX_EQUIP,
  PURSE_X,
  PURSE_Y,
  REMARK_X,
  REMARK_Y,
  ROW_BAND_X0,
  ROW_BAND_X1,
  ROW_BAND_Y0,
  SELL_BOX,
  SHOP_CATEGORIES,
  SHOP_HEIGHT,
  SHOP_WIDTH,
  SIGN_X,
  SIGN_Y,
  STAT_Y0,
  STAT_ICON_X,
  STAT_LINE_GAP,
  STAT_ROW_GAP,
  STAT_TEXT_X,
  STEP_H,
  STEP_ROW_H,
  STEP_W,
  STEP_Y0,
  STOCK_DX_DRUG,
  STOCK_DX_EQUIP,
  categoryBox,
  rowAt,
  stepBox,
} from './layout'

/**
 * `layout.ts` 里抄的那几十个数，**逐个对回 GBK 源码**。
 *
 * 为什么非要有这一份：真值里**一个按钮几何都没有** —— 它只记 `pressed`
 * 那一列，而落点是按钮中心，命中框偏 15/6 也好、整颗按钮挪 40 px 也好，
 * 中心永远还在框里。也就是说这一层抄错了，`shopTrace.test.ts` 一条都不会红，
 * 画面上又说不出对错。这是典型的"失败长得和成功一样"，所以判据要另找 ——
 * 找的就是源码自己。
 *
 * 每一条都先断言"解出来的条数对"，理由见 `test/javaSource.ts`：零匹配的逐行
 * 对比是一条恒真的检查，而 GBK 解错、界标写错、那一段被挪走，表现全是零匹配。
 */

const drugShop = javaSource('src/shop/ShopPanel.java')
const equipShop = javaSource('src/shop/EquipmentShopPanel.java')

/** 一份源码里 `<字段名> = new GameButton(<a>,<b>,<c>,<d>,` 的前四个实参。 */
function buttonArgs(source: string, field: string): number[] {
  const matches = [
    ...source.matchAll(
      new RegExp(
        `GameButton\\s+${field}\\s*=\\s*new GameButton\\(\\s*([^,]+),\\s*([^,]+),\\s*([^,]+),\\s*([^,]+),`,
        'g',
      ),
    ),
  ]
  if (matches.length !== 1) {
    throw new Error(`源码里 ${field} 的 new GameButton 解出了 ${matches.length} 处，应为 1 处`)
  }
  return matches[0]!.slice(1, 5).map((s) => evalIntExpr(s.trim()))
}

/** 只认 `448`、`x+47*1` 这两种形状 —— 认不出来就抛，别猜。 */
function evalIntExpr(expr: string): number {
  const plain = expr.match(/^(\d+)$/)
  if (plain) return Number(plain[1])
  const shifted = expr.match(/^x\+47\*(\d+)$/)
  if (shifted) return CATEGORY_X0_FROM_SOURCE + 47 * Number(shifted[1])
  if (expr === 'x') return CATEGORY_X0_FROM_SOURCE
  if (expr === 'y') return CATEGORY_Y_FROM_SOURCE
  throw new Error(`认不出的按钮坐标表达式：${expr}`)
}

/**
 * 一份源码里 `int x=<a>,y=<b>;` 那一句的两个数。
 *
 * ⚠️ **允许出现多处，但每一处必须相同**：`EquipmentShopPanel` 的
 * `int x = 453, y = 200;` 在构造函数与 `setList()` 里各有一份，两份分家的表现
 * 是"切过一次分类之后整排加减按钮挪位"。一处都没有仍然是硬失败（零匹配的
 * 逐行对比是恒真的检查）。
 */
function twoInts(source: string, re: RegExp): [number, number] {
  const matches = [...source.matchAll(re)]
  if (matches.length === 0) throw new Error(`${re} 一处都没解出来`)
  const pairs = matches.map((m) => `${m[1]},${m[2]}`)
  if (new Set(pairs).size !== 1) {
    throw new Error(`${re} 解出了不一致的 ${matches.length} 处：${pairs.join(' / ')}`)
  }
  return [Number(matches[0]![1]), Number(matches[0]![2])]
}

const [CATEGORY_X0_FROM_SOURCE, CATEGORY_Y_FROM_SOURCE] = twoInts(
  equipShop,
  /int x=(\d+),y=(\d+);/g,
)

describe('商店面板的几何，对回 GBK 源码', () => {
  it('面板尺寸 32*32 × 32*20，两家店相同', () => {
    for (const [what, source] of [
      ['药店', drugShop],
      ['装备店', equipShop],
    ] as const) {
      const w = [...source.matchAll(/int WIDTH = 32 \* (\d+);/g)]
      const h = [...source.matchAll(/int HEIGHT = 32 \* (\d+);/g)]
      expect(w, `${what} 的 WIDTH 没解出来`).toHaveLength(1)
      expect(h, `${what} 的 HEIGHT 没解出来`).toHaveLength(1)
      expect(SHOP_WIDTH).toBe(32 * Number(w[0]![1]))
      expect(SHOP_HEIGHT).toBe(32 * Number(h[0]![1]))
    }
  })

  it('购买 / 卖出 / 返回游戏三颗，两家店逐字相同', () => {
    for (const source of [drugShop, equipShop]) {
      expect(buttonArgs(source, 'buy')).toEqual([BUY_BOX.x, BUY_BOX.y, BUY_BOX.width, BUY_BOX.height])
      expect(buttonArgs(source, 'sell')).toEqual([
        SELL_BOX.x,
        SELL_BOX.y,
        SELL_BOX.width,
        SELL_BOX.height,
      ])
      expect(buttonArgs(source, 'back')).toEqual([
        BACK_BOX.x,
        BACK_BOX.y,
        BACK_BOX.width,
        BACK_BOX.height,
      ])
    }
  })

  it('分类栏那一排：起点 (448,133)、47×20、逐颗右移 47', () => {
    expect(CATEGORY_X0).toBe(CATEGORY_X0_FROM_SOURCE)
    expect(CATEGORY_Y).toBe(CATEGORY_Y_FROM_SOURCE)
    for (const category of SHOP_CATEGORIES) {
      // 原版的字段名与这一层的分类名逐字相同，所以直接拿来当界标。
      expect(buttonArgs(equipShop, category), `${category} 那一颗`).toEqual([
        categoryBox(category).x,
        CATEGORY_Y,
        CATEGORY_W,
        CATEGORY_H,
      ])
    }
  })

  it('分类栏的次序就是 buttonList.add 的次序', () => {
    const adds = [...equipShop.matchAll(/buttonList\.add\((\w+)\);/g)].map((m) => m[1])
    // 头三颗是 sell / buy / back，接着才是六个分类。⚠️ `add` 在构造函数与
    // `setList()` 里都有，后者加的是 decrease / increase —— 所以取前九个。
    expect(adds.slice(0, 3)).toEqual(['sell', 'buy', 'back'])
    expect(adds.slice(3, 9)).toEqual([...SHOP_CATEGORIES])
    // 药店那边是 buy / sell / back —— **前两颗与装备店对调**，抄混了也画得出来。
    const drugAdds = [...drugShop.matchAll(/buttonlist\.add\((\w+)\);/g)].map((m) => m[1])
    expect(drugAdds.slice(0, 3)).toEqual(['buy', 'sell', 'back'])
  })

  it('先出现的那一栏是 weapon', () => {
    const m = [...equipShop.matchAll(/String equipment="(\w+)";/g)]
    expect(m, 'equipment 字段的初始化式没解出来').toHaveLength(1)
    expect(FIRST_CATEGORY).toBe(m[0]![1])
  })

  it('加减按钮：(x+90, y-10) 与 (x+130, y-10)，7×12，每行 +20', () => {
    for (const [what, source] of [
      ['药店', drugShop],
      ['装备店', equipShop],
    ] as const) {
      const base = twoInts(source, /int x = (\d+), y = (\d+);/g)
      expect(base, `${what} 的加减按钮起点`).toEqual([LIST_X, LIST_Y0])
      const dec = [...source.matchAll(/new GameButton\(x\+(\d+),y-(\d+),(\d+),(\d+),/g)]
      // 药店那两颗在构造函数里；装备店的构造函数与 setList() 各一份，**两份
      // 必须逐字相同** —— 不同的话切一次分类按钮就整排挪位。
      const want = what === '药店' ? 2 : 4
      expect(dec, `${what} 解出的加减按钮`).toHaveLength(want)
      for (const [i, m] of dec.entries()) {
        const dx = Number(m[1])
        expect(dx, `${what} 第 ${i} 颗`).toBe(i % 2 === 0 ? MINUS_X - LIST_X : PLUS_X - LIST_X)
        expect(LIST_Y0 - Number(m[2])).toBe(STEP_Y0)
        expect(Number(m[3])).toBe(STEP_W)
        expect(Number(m[4])).toBe(STEP_H)
      }
      const step = [...source.matchAll(/y\+=(\d+);/g)]
      expect(step.length, `${what} 的 y+=`).toBeGreaterThan(0)
      for (const m of step) expect(Number(m[1])).toBe(STEP_ROW_H)
    }
  })

  it('stepBox 第 n 行 = 起点 + 20n', () => {
    expect(stepBox(0, false)).toEqual({ x: MINUS_X, y: STEP_Y0, width: STEP_W, height: STEP_H })
    expect(stepBox(3, true)).toEqual({
      x: PLUS_X,
      y: STEP_Y0 + 3 * STEP_ROW_H,
      width: STEP_W,
      height: STEP_H,
    })
  })

  it('商品行的命中带：x∈(440,795)、y 从 180 起每行 20，四个不等号都是严格的', () => {
    for (const [what, source] of [
      ['药店', drugShop],
      ['装备店', equipShop],
    ] as const) {
      const origin = [...source.matchAll(/int oringinY = (\d+);/g)]
      expect(origin, `${what} 的 oringinY`).toHaveLength(1)
      expect(Number(origin[0]![1])).toBe(ROW_BAND_Y0)
      const band = [
        ...source.matchAll(
          /currentX > (\d+) && currentX < (\d+) && currentY > oringinY\s*\r?\n?\s*&& currentY < oringinY \+ (\d+)/g,
        ),
      ]
      expect(band, `${what} 的 isMoveIn 命中带`).toHaveLength(1)
      expect([Number(band[0]![1]), Number(band[0]![2]), Number(band[0]![3])]).toEqual([
        ROW_BAND_X0,
        ROW_BAND_X1,
        STEP_ROW_H,
      ])
    }
  })

  it('rowAt：边界是开区间，两行之间有一条 1px 的死带', () => {
    // 第 0 行的带是 y∈(180,200)。
    expect(rowAt(600, 180, 6)).toBe(-1)
    expect(rowAt(600, 181, 6)).toBe(0)
    expect(rowAt(600, 199, 6)).toBe(0)
    // ⚠️ 200 既不属于第 0 行也不属于第 1 行 —— 照抄原版的严格不等号。
    expect(rowAt(600, 200, 6)).toBe(-1)
    expect(rowAt(600, 201, 6)).toBe(1)
    // 横向同理。
    expect(rowAt(440, 190, 6)).toBe(-1)
    expect(rowAt(441, 190, 6)).toBe(0)
    expect(rowAt(794, 190, 6)).toBe(0)
    expect(rowAt(795, 190, 6)).toBe(-1)
    // 行数是分母：只有 6 行时第 6 行的带上没人。
    expect(rowAt(600, 310, 6)).toBe(-1)
    expect(rowAt(600, 310, 20)).toBe(6)
  })

  it('drawIcon 那几列的 x 偏移，两家店各自对回自己的源码', () => {
    // ⚠️ 只压缩**逗号与加号周围**的空白，不是把所有空白削掉 —— 那会把
    // `" "+drug.getReduceMoney()` 里那个当参数的空格也削掉，于是每一条都对不上，
    // 而"对不上"看起来像坐标抄错了。
    const drawStrings = (source: string) =>
      [...source.matchAll(/g\.drawString\(([^;]+)\);/g)].map((m) =>
        m[1]!.replace(/\s*,\s*/g, ',').replace(/\s*\+\s*/g, '+').trim(),
      )
    const drug = drawStrings(drugShop)
    const equip = drawStrings(equipShop)
    expect(drug.length, '药店的 drawString').toBeGreaterThan(0)
    expect(equip.length, '装备店的 drawString').toBeGreaterThan(0)
    // 名字画在 (x, y)。
    expect(drug).toContain('drug.getName(),x,y')
    expect(equip).toContain('e.getName(),x,y')
    expect(drug).toContain(`" "+drug.getReduceMoney(),x+${PRICE_DX},y`)
    expect(equip).toContain(`" "+e.getReduceMoney(),x+${PRICE_DX},y`)
    // ⚠️ 存货那一列两家店**不一样**。
    expect(drug).toContain(`" "+drug.getNumber(),x+${STOCK_DX_DRUG},y`)
    expect(equip).toContain(`" "+e.getNumber(),x+${STOCK_DX_EQUIP},y`)
    expect(STOCK_DX_DRUG).not.toBe(STOCK_DX_EQUIP)
    expect(drug).toContain(`" "+DrugPack.drugList.get(i).getNumberGOT(),x+${HELD_DX},y`)
    expect(equip).toContain(
      `" "+EquipmentPack.listTable(equipment).get(i).getNumberGOT(),x+${HELD_DX},y`,
    )
    // ⚠️ 这一单要买几件也不一样：100 与 102。
    expect(drug).toContain(`" "+drug.getPurchaseNumber(),x+${PURCHASE_DX_DRUG},y`)
    expect(equip).toContain(`" "+e.getPurchaseNumber(),x+${PURCHASE_DX_EQUIP},y`)
    expect(PURCHASE_DX_DRUG).not.toBe(PURCHASE_DX_EQUIP)
    for (const list of [drug, equip]) {
      expect(list).toContain(`" "+Money.getCoins(),${COINS_X},${COINS_Y}`)
      expect(list).toContain(`message,${MESSAGE_X},${MESSAGE_Y}`)
      expect(list).toContain(`messageplus,${MESSAGE_X},${MESSAGE_PLUS_Y}`)
    }
    // 第三行只有装备店有。
    expect(equip).toContain(`messageremark,${REMARK_X},${REMARK_Y}`)
    expect(drug.some((s) => s.includes('messageremark'))).toBe(false)
  })

  it('字号 20，两家店相同', () => {
    for (const source of [drugShop, equipShop]) {
      const fonts = [...source.matchAll(/new Font\("[^"]+", Font\.BOLD, (\d+)\)/g)]
      expect(fonts.length).toBeGreaterThan(0)
      for (const m of fonts) expect(Number(m[1])).toBe(LIST_FONT_SIZE)
    }
  })

  it('图标框、招牌、钱袋三处固定贴图的坐标', () => {
    const images = (source: string) =>
      [...source.matchAll(/g\.drawImage\(([^;]+),\s*this\);/g)].map((m) =>
        m[1]!.replace(/\s*,\s*/g, ',').replace(/\s*\+\s*/g, '+').trim(),
      )
    const drug = images(drugShop)
    const equip = images(equipShop)
    expect(drug.length).toBeGreaterThan(0)
    expect(equip.length).toBeGreaterThan(0)
    expect(drug).toContain(`drugImage,${ICON_X},${ICON_Y}`)
    expect(equip).toContain(`equipmentImage,${ICON_X},${ICON_Y}`)
    expect(drug.some((s) => s.includes(`招牌.png"),${SIGN_X},${SIGN_Y}`))).toBe(true)
    expect(equip.some((s) => s.includes(`招牌_副本.png"),${SIGN_X},${SIGN_Y}`))).toBe(true)
    for (const list of [drug, equip]) {
      expect(list.some((s) => s.includes(`钱.png"),${PURSE_X},${PURSE_Y}`))).toBe(true)
    }
  })

  it('四条人物动画的位置，从 new ShopAnimation(...) 里解出来', () => {
    for (const [what, source] of [
      ['药店', drugShop],
      ['装备店', equipShop],
    ] as const) {
      const ani = [...source.matchAll(/new ShopAnimation\("([^"]+)",\s*(\d+),\s*(\d+),\s*(\d+),/g)]
      expect(ani, `${what} 的 ShopAnimation`).toHaveLength(4)
      for (const [i, m] of ani.slice(0, 3).entries()) {
        expect(Number(m[2]), `${what} 第 ${i} 条的 x`).toBe(PARTY_ANIMATION_X)
        expect(Number(m[3]), `${what} 第 ${i} 条的 y`).toBe(PARTY_ANIMATION_Y[i])
      }
      // 第四条是店主 / 小妹。
      expect(Number(ani[3]![2])).toBe(KEEPER_ANIMATION_X)
      expect(Number(ani[3]![3])).toBe(KEEPER_ANIMATION_Y)
      // 八帧，两家店四条都一样。
      for (const m of ani) expect(Number(m[4])).toBe(8)
    }
  })

  it('四行属性的排布：(55, 30+i*150+j*20) 与图标的 (60, 同一个 y)', () => {
    for (const [what, source] of [
      ['药店', drugShop],
      ['装备店', equipShop],
    ] as const) {
      const texts = [
        ...source.matchAll(/g\.drawString\("[体敏武精]", (\d+), (\d+)\+(\d+)\*(\d+)(?:\+(\d+))?\);/g),
      ]
      // 三个人 × 四行。
      expect(texts, `${what} 的属性字`).toHaveLength(12)
      for (const m of texts) {
        expect(Number(m[1])).toBe(STAT_TEXT_X)
        expect(Number(m[2])).toBe(STAT_Y0)
        expect(Number(m[4])).toBe(STAT_ROW_GAP)
        const line = Number(m[5] ?? 0)
        expect(line % STAT_LINE_GAP).toBe(0)
      }
      const icons = [
        ...source.matchAll(/精气\.png"\),(\d+),(\d+)\+(\d+)\*(\d+)\+(\d+),this\);/g),
      ]
      expect(icons, `${what} 的属性图标`).toHaveLength(3)
      for (const m of icons) expect(Number(m[1])).toBe(STAT_ICON_X)
    }
  })
})
