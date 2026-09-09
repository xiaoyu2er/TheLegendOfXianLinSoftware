import { describe, expect, it } from 'vitest'
import { EQUIPMENT_LISTS, EQUIP_SLOTS } from '../menu/equipment'
import type { EquipSlot, EquipmentSpec } from '../menu/equipment'
import { javaSource } from '../test/javaSource'
import { BUY_BOX, SELL_BOX, SHOP_CATEGORIES, categoryBox, stepBox } from './layout'
import type { ShopButtonBox } from './layout'
import { hitCenter } from './test/hitCenter'
import { snapshotShop } from './snapshot'
import {
  CATEGORY_BRANCH_ORDER,
  DRUG_TRADE_ROWS,
  EQUIP_PRICE_BANDS,
  EQUIP_USER_REMARKS,
  stepShop,
} from './step'
import { SHOP_TRACE_NAMES, readShopTrace, replayShop, shopInputsOf } from './trace'
import type { ShopTrace } from './trace'
import { listOf, tradesOf } from './test/trades'
import type { Trade, TradeRow } from './test/trades'
import { stepBase } from './world'
import type { ShopWorld } from './types'

/**
 * 装备自选超市那半边（xl-knp.8）的三条判据，都**不手写期望值**：
 *
 * 1. **源码参照模型** —— 店主那三行话（四段属性的拼接、价位三档、「谁能用」
 *    四档）、买卖循环的上界、退款循环那个"重算"、被拒时清哪几行、以及加减
 *    按钮的 `base` 与下标偏移，全部从 GBK 源码
 *    `src/shop/EquipmentShopPanel.java` 现读，再拿状态层逐条对过去。
 * 2. **真值账本** —— 三条真值里每一笔装备店成交的金钱变化，用真值自己记的
 *    单价与件数核一遍。
 * 3. **数据对撞** —— 「谁能用」那四档里**有两支任何数据都走不到**
 *    （见下面 `UNREACHABLE_REMARKS` 与 `NO_REMARK_USERS`），这两份登记
 *    手签、分母现数，两者对撞。
 *
 * ## ⚠️ 为什么「谁能用」这一条非要回到源码上取
 *
 * 主 session 在验收 xl-knp.3 时量过：`message.remark` 那四档里真值只盖到三档，
 * **「但是只有文敏可以使用」一次都没出现**。这一票追下去发现那不是"剧本恰好
 * 没走到"，而是**死支**：只有 `武器.txt` 有第 9 列，它取到的值是 0 / 1 / 2 / 4，
 * 而源码那四个 `if` 认的是 0 / 1 / 2 / **3**。所以补一条真值走到它是**做不到
 * 的** —— 那需要一件 `user==3` 的装备，而"改数据"是 CLAUDE.md 明令禁止的。
 *
 * 顺带落出第二支走不到的：`user==4` 的那三件武器**四档一个都不匹配**，于是
 * `messageremark` 留着上一件那句话。两支都只有源码这一头盖得住。
 *
 * ⚠️ 这里**只管装备店**。药店那半边在 `drugShop.test.ts`，下面每一处都按真值
 * 的 `shop` 那一列筛过。
 */

const SOURCE = javaSource('src/shop/EquipmentShopPanel.java')
const MOVE_IN = SOURCE.slice(
  SOURCE.indexOf('private void isMoveIn()'),
  SOURCE.indexOf('public void setMouse()'),
)
const SET_BUTTON = SOURCE.slice(
  SOURCE.indexOf('public void setButton()'),
  SOURCE.indexOf('public ArrayList<Equipment> listTable('),
)

/** 药店那份，只在"两句『钱不顾了』逐字相同"那一条上用。 */
const DRUG_SOURCE = javaSource('src/shop/ShopPanel.java')

/**
 * `getAddXxx()` → `EquipmentSpec` 的字段名。**这一张是命名，不是期望值**：
 * 每个字段"该是什么数"已经由 `menu/equipment.test.ts` 逐行核回
 * `sources/Shop/*.txt` 的列了，这里只是把源码里的 getter 名字接到那份表上。
 * 少一项、多一项都会在下面那条"分母 = 解析出来的段数"上露头。
 */
const STAT_FIELD: Readonly<Record<string, keyof EquipmentSpec>> = {
  getAddPhysicalPower: 'addPhysicalPower',
  getAddAgile: 'addAgile',
  getAddStrength: 'addStrength',
  getAddSpirit: 'addSpirit',
}

/** 一个干净的装备店世界，停在装备店上。种子随便给 —— 名字与价钱不是摇出来的。 */
function equipWorld(): ShopWorld {
  const world = replayShop(readShopTrace(SHOP_TRACE_NAMES[0]!))
  world.active = 'equipment'
  return world
}

/**
 * 切到某一栏 —— **按下再松开那颗分类按钮**，不是直接改字段。
 *
 * 直接写 `w.equipment.category = c` 会留下一张按上一栏行数建的加减按钮表
 * （原版 `setButton` 那一支是"整段删掉再 `setList()`"），于是下面按 `plus:k`
 * 的用例会点到不存在的按钮上 —— 而"点不着"与"点了没反应"长得一样。
 */
function switchTo(w: ShopWorld, category: EquipSlot): void {
  const [x, y] = hitCenter(categoryBox(category))
  stepShop(w, [{ e: 'press', x, y }])
  stepShop(w, [{ e: 'release', x, y }])
  expect(w.equipment.category, `没切到 ${category} 那一栏`).toBe(category)
}

/** 把鼠标停到当前那一栏的第 `row` 行上（`layout.ts` 的 rowAt：y ∈ (180+20i, 200+20i)）。 */
function hover(w: ShopWorld, row: number): void {
  stepShop(w, [{ e: 'move', x: 600, y: 190 + 20 * row }])
}

/** 按下再松开一颗按钮 —— `setButton` 认的是 `isclicked`，只松开什么都不会发生。 */
function click(w: ShopWorld, box: ShopButtonBox): void {
  const [x, y] = hitCenter(box)
  stepShop(w, [{ e: 'press', x, y }])
  stepShop(w, [{ e: 'release', x, y }])
}

describe('装备店的源码参照模型：期望值从 EquipmentShopPanel.java 现读', () => {
  it('两段界标真的切出来了 —— 切空了与"这一段没有那句话"长得一样', () => {
    expect(SOURCE).toContain('class EquipmentShopPanel')
    expect(MOVE_IN.length).toBeGreaterThan(0)
    expect(SET_BUTTON.length).toBeGreaterThan(0)
    // GBK 解错时中文全是乱码，而乱码在下面每一条正则下都是零匹配。
    expect(MOVE_IN).toContain('messageremark')
    expect(SET_BUTTON).toContain('isIsclicked')
    // ⚠️ 两段不许互相串门：`setButton` 里也有 `message=`（被拒那一句），
    // 而 `isMoveIn` 里也有 `getReduceMoney()` —— 界标切错时两边都还有匹配。
    expect(MOVE_IN).not.toContain('isIsclicked')
    expect(SET_BUTTON).not.toContain('oringinY')
  })

  it('店主第一行：四段属性的标签与次序从源码来，**段与段之间一个分隔符都没有**', () => {
    const assignment = MOVE_IN.match(/message=("[^;]*getAddSpirit\(\));/)
    expect(assignment, 'isMoveIn 里那句 message= 没解析出来').not.toBeNull()
    // 逐段取「标签 + 紧跟它的那个 getter」。⚠️ 标签在**值的前面**，所以把
    // 它们按次序拼起来就是原版那一串 —— 段间没有任何分隔符这件事，正是
    // "不额外插东西"这个拼法自己表达的。
    const parts = [...assignment![1]!.matchAll(/"([^"]*)"\+[^"]*?\.(get\w+)\(\)/g)].map((m) => ({
      label: m[1]!,
      getter: m[2]!,
    }))
    // 分母现数：解析不出来（或只解出一段）时下面那一圈是恒真的。
    expect(parts.length, 'message= 那一串里一段都没解析出来').toBeGreaterThan(0)
    expect(parts.length, 'message= 拼的段数与 STAT_FIELD 登记的不一样').toBe(
      Object.keys(STAT_FIELD).length,
    )
    // 每一个 getter 都得认得出来 —— 认不出的那一段会在下面变成 undefined，
    // 而 `undefined` 拼进字符串是"undefined"这几个字，看起来像实现错了。
    for (const { getter } of parts) {
      expect(STAT_FIELD, `源码里的 ${getter} 没登记在 STAT_FIELD 里`).toHaveProperty(getter)
    }

    /** 按源码那四段拼出第 `row` 行该显示的第一行话。 */
    const wanted = (spec: EquipmentSpec): string =>
      parts.map(({ label, getter }) => `${label}${spec[STAT_FIELD[getter]!]}`).join('')

    // 六栏逐栏逐行对过去 —— 分母是数据表自己的行数。
    const world = equipWorld()
    let rows = 0
    for (const category of SHOP_CATEGORIES) {
      switchTo(world, category)
      const specs = EQUIPMENT_LISTS[category]
      expect(specs.length, `${category} 那张表是空的`).toBeGreaterThan(0)
      for (const [i, spec] of specs.entries()) {
        hover(world, i)
        rows++
        expect(
          (snapshotShop(world)['message'] as { message: string }).message,
          `${category} 第 ${i} 行（${spec.name}）`,
        ).toBe(wanted(spec))
      }
    }
    expect(rows, '六栏加起来一行都没走到').toBeGreaterThan(0)
  })

  it('店主第二行按价位三档：那三个数与三句话逐字来自源码，且是**升序的 else-if 链**', () => {
    const bands = [
      ...MOVE_IN.matchAll(
        /(else\s+)?if\(.*?\.getReduceMoney\(\)<(\d+)\)\s*\r?\n\s*messageplus="([^"]*)";/g,
      ),
    ].map((m) => ({ chained: m[1] !== undefined, below: Number(m[2]), text: m[3]! }))
    // 分母现数：一支都没解析出来时下面每一条都是恒真的。
    expect(bands.length, 'isMoveIn 里一个价位档都没解析出来').toBeGreaterThan(0)

    // (a) 那张表与源码**逐字相等**。⚠️ 这一条不能只对"分档的结果"：
    // 100000 那道坎两侧没有商品（六张表最贵的是 80000），只对结果的话把它
    // 改坏是绿的 —— 与药店 6000 那道坎同一个形状的洞。
    expect(
      EQUIP_PRICE_BANDS.map((b) => ({ below: b.below, text: b.text })),
      'EQUIP_PRICE_BANDS 与 isMoveIn 里那三支对不上',
    ).toEqual(bands.map(({ below, text }) => ({ below, text })))

    // (b) 它是 else-if 链，第一支不带 else、其余每一支都带 —— 抄成四个独立的
    // `if`（remark 那四档的形状）之后，每一件便宜货都会先说"物美价廉"再被
    // 后面那两支覆写成"当世之宝器"。
    expect(bands.map((b) => b.chained)).toEqual(bands.map((_b, i) => i > 0))
    // (c) 升序。降序排的话每一件都命中第一支。
    expect([...bands].sort((a, b) => a.below - b.below).map((b) => b.below)).toEqual(
      bands.map((b) => b.below),
    )
    // (d) **没有 else** —— `messageplus=` 在 isMoveIn 里出现的次数恰好是档数。
    // 多一次说明有人给它补了兜底，而兜底与"留着上一件那句话"分得开。
    expect(
      [...MOVE_IN.matchAll(/messageplus=/g)].length,
      'isMoveIn 里 messageplus= 的次数不等于档数 —— 多半是多了一支 else',
    ).toBe(bands.length)

    // (e) 逐栏逐行对状态层：命中就该换、一支都不命中就该**留着上一件那句**。
    const world = equipWorld()
    const taken = new Set<number>()
    let sticky = 0
    for (const category of SHOP_CATEGORIES) {
      switchTo(world, category)
      for (const [i, spec] of EQUIPMENT_LISTS[category].entries()) {
        const before = (snapshotShop(world)['message'] as { plus: string | null }).plus
        hover(world, i)
        const got = (snapshotShop(world)['message'] as { plus: string | null }).plus
        const band = bands.findIndex((b) => spec.reduceMoney < b.below)
        if (band < 0) {
          sticky++
          expect(got, `${category} 第 ${i} 行（${spec.reduceMoney}）该留着上一句`).toBe(before)
          continue
        }
        taken.add(band)
        expect(got, `${category} 第 ${i} 行（${spec.name} ${spec.reduceMoney}）`).toBe(
          bands[band]!.text,
        )
      }
    }
    // (f) **登记走不到的那一支**，分母现数。三档在数据里都取到，第四支
    // （`>=100000`，也就是"一支都不命中"）一件都没有 —— 上面那个 `sticky`
    // 因此必须是 0。哪天数据里出现一件十万以上的装备，这一条立刻红，而那
    // 正是"留着上一件那句话"这条缺陷第一次真的会被看见的时候。
    expect([...taken].sort(), '三档没有全部取到 —— 上面那一圈只走了一部分').toEqual(
      bands.map((_b, i) => i),
    )
    expect(
      sticky,
      '出现了价钱 >=100000 的装备 —— 原版那三支 else-if 没有兜底，它会留着上一件那句话',
    ).toBe(0)
  })

  /**
   * ⚠️ **篡改矩阵露出来的那一格：价位那三支「没有 else」在实现上没人守。**
   *
   * 上面那条 (d) 数的是**源码**里 `messageplus=` 出现了几次 —— 源码没变，
   * 所以给**实现**补一个 `?? '绝对是当世之宝器,'` 兜底之后它照样绿，而其余
   * 每一条也绿：六张表最贵的是 80000，`>=100000` 那一路一件商品都走不到，
   * 于是"照抄了"与"补了兜底"推出来的读数完全相同（dispatch.md「篡改了却是
   * 绿的」第三种）。
   *
   * 补法：**把那一路造出来**。上界从源码现读，然后把某一行的价钱抬到它以上
   * —— `price` 是店里那一列自己的状态（原版 `Equipment` 对象上那个字段），
   * 造它不用改任何数据文件。
   */
  it('⚠️ 价钱超过最高那一档时 messagePlus **留着上一件那句** —— 那一路数据里走不到，造出来', () => {
    const tops = [...MOVE_IN.matchAll(/\.getReduceMoney\(\)<(\d+)\)/g)].map((m) => Number(m[1]))
    expect(tops.length, 'isMoveIn 里一个价位上界都没解析出来').toBeGreaterThan(0)
    const top = Math.max(...tops)

    // 先确认这一路**真的**是数据走不到的 —— 否则这条用例与上面那一圈重复，
    // 而"重复"与"守着一条别人守不到的路"长得不一样。
    const dearest = Math.max(...EQUIP_SLOTS.flatMap((s) => EQUIPMENT_LISTS[s]).map((e) => e.reduceMoney))
    expect(dearest, `数据里已经有价钱 >= ${top} 的装备了，这条路不用造`).toBeLessThan(top)

    const world = equipWorld()
    switchTo(world, 'weapon')
    // 垫一句出来：第 0 行的价钱在最低那一档里。
    hover(world, 0)
    const before = (snapshotShop(world)['message'] as { plus: string | null }).plus
    expect(before, '垫不出一句 plus').not.toBeNull()

    // 把第 1 行抬到最高那一档以上，再停到它上头。⚠️ `price` 在 `ShopRow` 上是
    // readonly（原版运行时也不改它），所以换的是**那一行整个对象**，不是拿
    // 断言绕开类型 —— 店里那一列本身是可变数组（切栏就是整段换掉）。
    const rows = world.equipment.rows['weapon']
    rows[1] = { ...rows[1]!, price: top }
    hover(world, 1)
    const after = snapshotShop(world)['message'] as { plus: string | null; message: string }
    expect(
      after.plus,
      `价钱 ${top} 落在三支 else-if 之外，messagePlus 该一个字都不动 —— 有人给它补了 else？`,
    ).toBe(before)
    // 而第一行**确实换了**（否则"没变"是因为整个 hover 没生效）。
    expect(after.message).toContain(`${EQUIPMENT_LISTS['weapon'][1]!.addSpirit}`)
  })

  /**
   * **手签登记：源码里那四段，哪几段任何数据都走不到。**
   *
   * ⚠️ 这张表**必须手写**（dispatch.md 纪律 3：分母现数、登记手签）。写成
   * "从数据里推"的话它与下面那条对撞就变成同一句话，于是"这一段走不到"与
   * "这一段没人对"再也分不开。
   */
  const UNREACHABLE_REMARKS: Readonly<Record<number, string>> = {
    // 六张表里没有一件 `user==3`：只有 `武器.txt` 有第 9 列，取值是 0/1/2/4。
    3: '六张装备表里一件 user==3 的都没有 —— 「文敏」那句话在原版里一次也印不出来',
  }

  it('店主第三行「谁能用」：四段逐字来自源码，且是**四个独立的 `if`**', () => {
    const remarks = [
      ...MOVE_IN.matchAll(
        /(else\s+)?if\(.*?\.getUser\(\)==(\d+)\)\s*\r?\n\s*messageremark="([^"]*)";/g,
      ),
    ].map((m) => ({ chained: m[1] !== undefined, user: Number(m[2]), text: m[3]! }))
    // 分母现数 —— 这就是那份「解析出来的段落名单」。
    expect(remarks.length, 'isMoveIn 里一段「谁能用」都没解析出来').toBeGreaterThan(0)

    // (a) 那张表与源码逐字相等。
    expect(
      EQUIP_USER_REMARKS.map((r) => ({ user: r.user, text: r.text })),
      'EQUIP_USER_REMARKS 与 isMoveIn 里那几支对不上',
    ).toEqual(remarks.map(({ user, text }) => ({ user, text })))

    // (b) 四个**独立**的 `if`，一支都不带 else —— 与上面价位那三支正好相反。
    // 抄成 else-if 在今天观测不出差别（`getUser()` 只有一个值），但它们是
    // 四个独立的分支，真值里也是四行独立的源码。
    expect(remarks.map((r) => r.chained)).toEqual(remarks.map(() => false))
    // (c) 没有 else：`messageremark=` 在 isMoveIn 里的次数恰好是段数。
    expect(
      [...MOVE_IN.matchAll(/messageremark=/g)].length,
      'isMoveIn 里 messageremark= 的次数不等于段数 —— 多半是多了一支 else',
    ).toBe(remarks.length)

    // (d) 逐段驱动状态层。**分母是解析出来的段落名单**，走过哪几段现记。
    const world = equipWorld()
    const exercised = new Set<number>()
    for (const [seg, remark] of remarks.entries()) {
      for (const category of SHOP_CATEGORIES) {
        const row = EQUIPMENT_LISTS[category].findIndex((e) => e.user === remark.user)
        if (row < 0) continue
        switchTo(world, category)
        hover(world, row)
        expect(
          (snapshotShop(world)['message'] as { remark: string | null }).remark,
          `${category} 第 ${row} 行（user=${remark.user}）`,
        ).toBe(remark.text)
        exercised.add(seg)
      }
    }

    // (e) **对撞**：走过的段 + 手签登记为"走不到"的段 = 解析出来的全部段落。
    // 少一段说明有一段既没走到也没登记（判据静静地少了一支）；
    // 多一段说明登记在骗人（登记为走不到的那一段其实走到了）。
    const unreachable = remarks
      .map((r, seg) => ({ seg, user: r.user }))
      .filter(({ user }) => user in UNREACHABLE_REMARKS)
    for (const { seg, user } of unreachable) {
      expect(
        exercised.has(seg),
        `登记说 user==${user} 那一段走不到，可它走到了 —— 把它从 UNREACHABLE_REMARKS 里删掉`,
      ).toBe(false)
      // 而"走不到"这件事本身也要现数：数据里真的一件都没有。
      const found = EQUIP_SLOTS.flatMap((s) => EQUIPMENT_LISTS[s]).filter((e) => e.user === user)
      expect(found.map((e) => e.name), UNREACHABLE_REMARKS[user]!).toEqual([])
    }
    expect(
      [...exercised].sort((a, b) => a - b),
      '有一段既没走到也没登记成"走不到" —— 那一段的文案就没人守了',
    ).toEqual(
      remarks.map((_r, seg) => seg).filter((seg) => !unreachable.some((u) => u.seg === seg)),
    )
    // 空转要响：全部登记成"走不到"的话上面那一圈零轮，而零轮是恒真的。
    expect(exercised.size, '一段都没走到').toBeGreaterThan(0)
  })

  /**
   * **手签登记：数据里出现了、而源码那四段一个都不匹配的 `user` 值。**
   *
   * 后果是 `messageremark` **留着上一件那句话**（原版缺陷，ADR-0001 要求照抄）。
   * 三条真值一次都没停到那三件武器上，所以这一格只有源码这一头盖得住。
   */
  const NO_REMARK_USERS: Readonly<Record<number, string>> = {
    // `menu/equipment.ts` 头注：1 张小凡 / 2 陆雪琪 / **4 玉洁**，而源码认 0..3。
    4: '玉洁（user==4）那几件武器：源码那四个 if 一个都不匹配，remark 留着上一件的',
  }

  it('⚠️ `user` 不在那四段里时 remark **留着上一件那句话** —— 真值一次都没走到', () => {
    const segments = new Set(
      [...MOVE_IN.matchAll(/\.getUser\(\)==(\d+)\)/g)].map((m) => Number(m[1])),
    )
    expect(segments.size, 'isMoveIn 里一段 getUser()== 都没解析出来').toBeGreaterThan(0)

    // 分母现数：数据里那些**不在**解析出的段落值里的 user。
    const orphans: { slot: EquipSlot; row: number; spec: EquipmentSpec }[] = []
    for (const slot of EQUIP_SLOTS) {
      EQUIPMENT_LISTS[slot].forEach((spec, row) => {
        if (!segments.has(spec.user)) orphans.push({ slot, row, spec })
      })
    }
    // 现数出来的 user 值必须与手签登记逐个对上 —— 多一个说明又冒出一档没人
    // 想过的；少一个（一个都没有）说明这条判据是恒真的。
    expect(
      [...new Set(orphans.map((o) => o.spec.user))].sort(),
      '数据里"四段都不匹配"的 user 值与 NO_REMARK_USERS 登记的不一样',
    ).toEqual(Object.keys(NO_REMARK_USERS).map(Number).sort())
    expect(orphans.length, `NO_REMARK_USERS 登记了却一件都没有：${Object.values(NO_REMARK_USERS)}`)
      .toBeGreaterThan(0)

    // 逐件核"粘着"：先停到一件**有**文案的上头，再停到这一件上。
    const world = equipWorld()
    for (const { slot, row, spec } of orphans) {
      switchTo(world, slot)
      const priming = EQUIPMENT_LISTS[slot].findIndex((e) => segments.has(e.user))
      expect(priming, `${slot} 那一栏没有一件命中四段的，垫不出"上一句"`).not.toBe(-1)
      hover(world, priming)
      const before = (snapshotShop(world)['message'] as { remark: string | null }).remark
      // 空转要响：垫的那一下真的把话垫上了，否则下面比的是 null 对 null。
      expect(before, `${slot} 第 ${priming} 行没垫出一句话`).not.toBeNull()
      hover(world, row)
      const after = snapshotShop(world)['message'] as { remark: string | null; message: string }
      expect(after.remark, `${slot} 第 ${row} 行（${spec.name} user=${spec.user}）该留着上一句`)
        .toBe(before)
      // 而第一行**确实换了** —— 否则"留着上一句"可能是因为整个 hover 没生效。
      expect(after.message).toContain(`${spec.addSpirit}`)
    }

    // 反方向：这条缺陷在**真值里一次都没被观测到**（三条剧本没停到这几件上）。
    // 哪天有人补了一条走到它的真值，这一条会红 —— 那时它该被挪进真值那一侧。
    let visits = 0
    for (const name of SHOP_TRACE_NAMES) {
      for (const tick of readShopTrace(name).ticks) {
        if (tick['shop'] !== 'equipment') continue
        const icon = tick['icon'] as { name: string | null }
        if (icon.name !== null && orphans.some((o) => o.spec.name === icon.name)) visits++
      }
    }
    expect(
      visits,
      '真值里已经停到"四段都不匹配"的装备上了 —— 这一格现在有真值盖了，去 shopTrace 那边核',
    ).toBe(0)
  })

  it('买卖那几个循环的上界是 `listTable(equipment).size()` **现算的**，不是字面量', () => {
    // ⚠️ 与药店正好相反：`ShopPanel.setButton` 写的是字面量 6。抄错的方向
    // 因此是"把装备店也写成 6"，而那在武器（20 行）与饰品（12 行）两栏上
    // 会漏掉第 6 行以后的每一行。
    const sized = [...SET_BUTTON.matchAll(/for\(int i=0;i<listTable\(equipment\)\.size\(\);i\+\+\)/g)]
    // 分母现数。买 / 退款 / 清零 / 卖，四处。
    expect(sized.length, 'setButton 里一个 .size() 上界都没解析出来').toBeGreaterThan(0)
    expect(
      [...SET_BUTTON.matchAll(/for\(int i=0;i<(\d+);i\+\+\)/g)].map((m) => m[1]),
      'setButton 里出现了字面量上界 —— 装备店那几个循环该是 .size()',
    ).toEqual([])

    // 行为面：挑一栏行数**超过药店那个 6** 的，在第 6 行以后成交一笔。
    // 上界抄成 6 的实现在这里买不到东西。
    // ⚠️ 「超过药店那个 6」里的 6 **引药店那个常量**，不写字面量：药店数据
    // 改一行时那个常量会跟着改，而写死的 6 只会让这条判据的意图安静地失效
    // （dispatch.md 纪律 3）。
    const wide = SHOP_CATEGORIES.filter((c) => EQUIPMENT_LISTS[c].length > DRUG_TRADE_ROWS)
    expect(wide.length, `六栏没有一栏超过 ${DRUG_TRADE_ROWS} 行，这条判据是恒真的`).toBeGreaterThan(0)
    for (const category of wide) {
      const world = equipWorld()
      switchTo(world, category)
      const rows = world.equipment.rows[category]
      const last = rows.length - 1
      expect(last, `${category} 只有 ${rows.length} 行`).toBeGreaterThanOrEqual(DRUG_TRADE_ROWS)
      rows[last]!.stock = 1
      rows[last]!.purchase = 1
      world.coins = rows[last]!.price
      const held0 = world.pack.equipment[category][last]!
      click(world, BUY_BOX)
      expect(world.music, `${category} 那一下没点着购买`).toEqual(['Clip986.wav'])
      expect(
        world.pack.equipment[category][last],
        `${category} 第 ${last} 行没成交 —— 循环上界多半抄成了字面量`,
      ).toBe(held0 + 1)
    }
  })

  it('加减按钮的 `base` 与下标偏移从源码现读，且逐行点得准', () => {
    const loop = SET_BUTTON.match(/for\(int i=(\d+);i<buttonList\.size\(\);i\+=2\)/)
    expect(loop, 'setButton 里那个加减循环没解析出来').not.toBeNull()
    const base = Number(loop![1])
    const offsets = [...SET_BUTTON.matchAll(/listTable\(equipment\)\.get\(i\/2-(\d+)\)/g)].map((m) =>
      Number(m[1]),
    )
    expect(offsets.length, 'setButton 里一处 get(i/2-N) 都没解析出来').toBeGreaterThan(0)
    expect(new Set(offsets), '加减那几处的偏移不一样').toEqual(new Set([offsets[0]]))

    // `base` 对到那个唯一的出处。
    expect(stepBase('equipment'), 'EquipmentShopPanel 那个加减循环的起点').toBe(base)
    // ⚠️ `base/2` 取整恰好等于偏移（9→4）是**巧合** —— 这一条把它记下来：
    // 它成立，所以不许有人把偏移写成 `Math.floor(base/2)`（原版哪天某一侧
    // 多一颗固定按钮，那个写法会安静地错位）。
    expect(Math.floor(base / 2), 'base/2 与源码里的偏移不再相等了').toBe(offsets[0])

    // 行为面：逐行按加号，只有那一行的 purchase 该变。偏移抄错一格的表现是
    // 整栏集体错位一行，而**最后一行会点到不存在的行上**（现在是抛）。
    const category = SHOP_CATEGORIES.reduce((a, b) =>
      EQUIPMENT_LISTS[a].length >= EQUIPMENT_LISTS[b].length ? a : b,
    )
    const world = equipWorld()
    switchTo(world, category)
    const rows = world.equipment.rows[category]
    expect(rows.length, `${category} 那一栏是空的`).toBeGreaterThan(0)
    for (let row = 0; row < rows.length; row++) {
      click(world, stepBox(row, true))
      expect(world.music, `第 ${row} 行按加号没出声`).toEqual(['click.wav'])
      expect(
        rows.map((r) => r.purchase),
        `按了第 ${row} 行的加号，动的不是那一行`,
      ).toEqual(rows.map((_r, i) => (i === row ? 1 : 0)))
      click(world, stepBox(row, false))
      expect(rows.map((r) => r.purchase)).toEqual(rows.map(() => 0))
    }
  })

  /**
   * ⚠️ **收 `/code-review` Spec 轴：主 session 在票面评论 2 里点名要现读的那几行。**
   *
   * 「减到 0 再按减号什么都不发生」是**错的读法** —— `readmusic("click.wav")`
   * 在 `if(...getPurchaseNumber()>0)` 守卫**前面**，所以数字不动、照样出声。
   * 药店那一侧有一条行为用例守着（`drugShop.test.ts`，从真值里认出那一步），
   * 装备店这一侧**真值里一次都没有**「装备店上减到 0 再按减号」，所以判据回到
   * 源码上取，再补一条造出来的行为用例。
   *
   * ⚠️ 实现是两家店共用一份（`stepPurchaseButtons`），所以这一条今天不会红。
   * 那正是它该在的理由：「两家店同形」在这一票里原本只是注释里的一句断言，
   * 而假注释与真判据长得一样。
   */
  it('⚠️ 那一声 click.wav 在 `>0` 守卫**前面** —— 减到 0 再按减号，数字不动照样出声', () => {
    // 源码那一侧：在加减那个 for 里，`readmusic` 的位置必须早于那个守卫。
    const loop = SET_BUTTON.slice(SET_BUTTON.indexOf('for(int i=9;i<buttonList.size();i+=2)'))
    expect(loop.length, '加减那个 for 没切出来').toBeGreaterThan(0)
    const sound = loop.indexOf('MusicReader.readmusic("click.wav")')
    const guard = loop.indexOf('.getPurchaseNumber()>0)')
    // 两处都要真的找到 —— `indexOf` 的 -1 与"排在最前面"在 `<` 底下长得一样。
    expect(sound, '加减那个 for 里没有 readmusic("click.wav")').not.toBe(-1)
    expect(guard, '加减那个 for 里没有 getPurchaseNumber()>0 那个守卫').not.toBe(-1)
    expect(sound, '那一声跑到守卫后面去了 —— 「什么都不发生」会变成真的').toBeLessThan(guard)

    // 行为面：purchase 已经是 0（开局就是），按减号 —— 一个数不动，但出一声。
    const world = equipWorld()
    switchTo(world, 'weapon')
    const rows = world.equipment.rows['weapon']
    const before = rows.map((r) => r.purchase)
    // 空转要响：这一栏此刻真的全是 0，否则走的是"减 1"那一路。
    expect(before, '这一栏的 purchase 不全是 0，走的不是这条路').toEqual(rows.map(() => 0))
    click(world, stepBox(0, false))
    expect(rows.map((r) => r.purchase), '减到 0 之后又减出负数了').toEqual(before)
    expect(world.music, '那一声不见了 —— 有人把它挪进守卫里了').toEqual(['click.wav'])
  })

  /**
   * ⚠️ **收 `/code-review` Spec 轴：`CATEGORY_BRANCH_ORDER` 是 xl-knp.6 留下的
   * 一份手写名单，一条判据都没有** —— 而本票是收口那一张。
   *
   * 它在今天**观测不出来**：六颗分类按钮互不重叠，一次最多一颗 `isclicked`，
   * 所以次序抄错在真值上、在画面上都看不出。判据只能回到源码。
   */
  it('分类切换那六个 `if` 的次序从源码现读 —— 它在真值上观测不出来', () => {
    // 六段都是同样的三句，认「哪个按钮的 isIsclicked + 紧跟一句 换list.wav」。
    // ⚠️ `buy` / `sell` / `back` 也有 isIsclicked，它们后面不是 换list.wav。
    const order = [
      ...SET_BUTTON.matchAll(
        /if\((\w+)\.isIsclicked\(\)==true\)\{?\s*\r?\n\s*MusicReader\.readmusic\("换list\.wav"\)/g,
      ),
    ].map((m) => m[1]!)
    // 分母现数：一段都没解析出来时下面那条是恒真的。
    expect(order.length, 'setButton 里一段分类切换都没解析出来').toBeGreaterThan(0)
    expect(order.length, '解析出来的段数与那张表不一样').toBe(CATEGORY_BRANCH_ORDER.length)
    // ⚠️ 原版那六个字段名与 web 侧的槽位名逐字相同，所以直接对。
    expect(order, 'CATEGORY_BRANCH_ORDER 与源码里那六个 if 的先后对不上').toEqual([
      ...CATEGORY_BRANCH_ORDER,
    ])
    // 而它与**按钮表的次序**（`SHOP_CATEGORIES`）确实不是同一份 —— 两份一样时
    // 上面那条判据就退化成"随便哪一份都行"了。
    expect([...CATEGORY_BRANCH_ORDER], '两份名单变成同一个序了 —— 那条判据失去分辨力').not.toEqual(
      [...SHOP_CATEGORIES],
    )
    // 但集合必须相同：少一类 / 多一类都在这里露头。
    expect([...CATEGORY_BRANCH_ORDER].sort()).toEqual([...SHOP_CATEGORIES].sort())
  })

  it('⚠️ 退款循环里的 temp 与买入循环里的逐字相同 —— 那就是"重算"', () => {
    // 与药店同一个洞、同一条判据：`stock` 已经被买入循环减过了，所以买超过
    // 原存货一半时**退不干净**（原版缺陷，照抄）。三条真值都没走到那一路。
    const temps = [...SET_BUTTON.matchAll(/int temp=Math\.min\((.+?)\);/g)].map((m) => m[1]!.trim())
    // 分母现数。买 / 退款 / 卖，三句。
    expect(temps.length, 'setButton 里那几句 int temp=Math.min(...) 没解析出来').toBe(3)
    const [buyTemp, undoTemp, sellTemp] = temps as [string, string, string]
    expect(undoTemp, '退款循环的 temp 与买入循环的不一样了').toBe(buyTemp)
    // 卖那一句必须**不同**（它比的是背包 `getNumberGOT()`，不是店里 `getNumber()`）。
    expect(sellTemp, '卖出那一句与买入的一样 —— 界标多半切错了段').not.toBe(buyTemp)
  })

  it('⚠️ 买超过原存货一半又被拒时**退不干净**，且三行话全被清了', () => {
    // 被拒那三句也从源码现读 —— 药店那一支只清两行，装备店多清一行 remark。
    const refusal = SET_BUTTON.match(
      /message="([^"]*)";\s*\r?\n\s*messageplus=null;\s*\r?\n\s*messageremark=null;/,
    )
    expect(refusal, 'setButton 里被拒那三句没解析出来').not.toBeNull()

    const world = equipWorld()
    switchTo(world, 'weapon')
    const rows = world.equipment.rows['weapon']
    // 挑最贵那一行，把这一单摆成 `purchase > stock - purchase`：买入循环成交
    // purchase 件、存货只剩 stock-purchase，退款那一句于是只退得回那么多。
    const last = rows.length - 1
    const row = rows[last]!
    const [stock, purchase] = [4, 3]
    expect(purchase, '这一单没摆成"超过原存货一半"，下面几条就成了恒真').toBeGreaterThan(
      stock - purchase,
    )
    row.stock = stock
    row.purchase = purchase
    // 先垫一句 remark 出来 —— 否则"被清成 null"与"本来就是 null"长得一样。
    hover(world, last)
    expect(world.equipment.messageRemark, '垫不出一句 remark').not.toBeNull()
    expect(world.equipment.messagePlus).not.toBeNull()
    const coins0 = world.coins
    const held0 = world.pack.equipment['weapon'][last]!
    // 钱确实不够 —— 否则走的是成交那一路。
    expect(row.price * purchase).toBeGreaterThan(coins0)

    click(world, BUY_BOX)
    expect(world.music, '这一下没点着购买按钮').toEqual(['Clip986.wav'])

    // 三行话：第一行换成源码里那句，第二、三行都清成 null。
    expect(world.equipment.message).toBe(refusal![1])
    expect(world.equipment.messagePlus).toBeNull()
    expect(world.equipment.messageRemark, 'remark 没被清 —— 装备店那一支多清一行').toBeNull()
    // 而金钱、存货与背包**一个都没回到原位**。退干净的实现会让这三条全红。
    expect(world.coins, '金钱退回原位了 —— 有人把那个原版缺陷"修好"了').not.toBe(coins0)
    expect(row.stock, '存货退回原位了').not.toBe(stock)
    expect(world.pack.equipment['weapon'][last], '背包退回原位了').not.toBe(held0)
    // 而 `purchase` 照样清零（那一句在最外面，买成了没成都清）。
    expect(row.purchase).toBe(0)
  })

  it('⚠️ 两个面板那句"钱不顾了"逐字相同 —— 抄成两份就该有人核', () => {
    const one = (text: string) => text.match(/message="([^"]*钱[^"]*)";/)![1]!
    const equip = one(SET_BUTTON)
    const drug = one(
      DRUG_SOURCE.slice(
        DRUG_SOURCE.indexOf('public void setButton()'),
        DRUG_SOURCE.indexOf('public void drawIcon('),
      ),
    )
    // 空转要响：解出空串时下面那条 `toBe` 是恒真的。
    expect(equip.length).toBeGreaterThan(0)
    expect(equip, '两个面板被拒那句话不一样了').toBe(drug)
  })

  it('⚠️ 钱正好花光（余额 0）算买得起 —— 那个比较符从源码现读', () => {
    const m = SET_BUTTON.match(/if\(Money\.getCoins\(\)(<=?)0\)/)
    expect(m, 'setButton 里那句 if(Money.getCoins()<0) 没解析出来').not.toBeNull()
    const refusedAtZero = m![1]! === '<='

    const world = equipWorld()
    switchTo(world, 'weapon')
    const row = world.equipment.rows['weapon'][0]!
    const [purchase, stock] = [2, 5]
    row.purchase = purchase
    row.stock = stock
    world.coins = row.price * purchase
    const held0 = world.pack.equipment['weapon'][0]!
    const message0 = world.equipment.message

    click(world, BUY_BOX)
    expect(world.music, '这一下没点着购买按钮').toEqual(['Clip986.wav'])

    // 无论哪一边，余额都停在 0；分岔的是"东西到手了没有"。
    expect(world.coins).toBe(0)
    if (refusedAtZero) {
      expect(world.pack.equipment['weapon'][0]).toBe(held0)
      expect(world.equipment.message).not.toBe(message0)
    } else {
      expect(world.pack.equipment['weapon'][0], '钱正好花光却被拒了 —— 比较符抄成了 <=').toBe(
        held0 + purchase,
      )
      expect(world.equipment.message, '成交了却换成了"钱不顾了"那句').toBe(message0)
    }
  })

  it('卖出那一支从头到尾不碰店主那三行话，也没有"钱不够"那一支', () => {
    // 源码那一侧：`if(sell.isIsclicked())` 那个大括号里**一句 message 都没有**，
    // 也没有 `Money.getCoins()<0`（钱只会变多）。界标就是那两个分支各自的
    // 开头，切出来的那一段要真的非空。
    const sell = SET_BUTTON.slice(
      SET_BUTTON.indexOf('if(sell.isIsclicked()'),
      SET_BUTTON.indexOf('if(back.isIsclicked()'),
    )
    expect(sell.length, '卖出那一支没切出来').toBeGreaterThan(0)
    expect(sell, '卖出那一支里出现了 message 赋值').not.toMatch(/message(plus|remark)?=/)
    expect(sell, '卖出那一支里出现了"钱不够"那道坎').not.toContain('Money.getCoins()<0')
    // ⚠️ 空转要响：切出来的那一段真的是卖出那一支（它得有那句加钱的）。
    expect(sell).toContain('Money.setCoins(Money.coins+')

    // 行为面：先垫出三行话，卖一件，三行一个字都不许动。
    const world = equipWorld()
    switchTo(world, 'weapon')
    const rows = world.equipment.rows['weapon']
    const held = world.pack.equipment['weapon']
    hover(world, 0)
    const said = { ...snapshotShop(world)['message'] as Record<string, unknown> }
    // 垫得出来才比得出没变 —— 三行全是 null 时下面那条是恒真的。
    expect(Object.values(said).filter((v) => v !== null).length).toBe(3)
    held[0] = 2
    rows[0]!.purchase = 1
    const coins0 = world.coins
    click(world, SELL_BOX)
    expect(world.music, '这一下没点着卖出按钮').toEqual(['Clip986.wav'])
    // 真的卖出去了（否则"三行没变"是因为整个分支没跑）。
    expect(held[0]).toBe(1)
    expect(world.coins).toBe(coins0 + rows[0]!.price)
    expect(snapshotShop(world)['message'], '卖出改了店主那三行话').toEqual(said)
    // `purchase` 清零那一句在循环**里面**，卖成了就清。
    expect(rows[0]!.purchase).toBe(0)
  })

  it('⚠️ 卖价等于买价，不打折 —— 买与卖那两句只差一个正负号', () => {
    const terms = [...SET_BUTTON.matchAll(/Money\.setCoins\(Money\.coins([-+])(.+?)\);/g)]
    expect(terms.length, 'setButton 里那几句 Money.setCoins 没解析出来').toBeGreaterThan(1)
    const expressions = new Set(terms.map((m) => m[2]!.trim()))
    expect(
      [...expressions],
      '买入与卖出算钱的表达式不是同一个 —— 有人给卖出加了折扣',
    ).toHaveLength(1)
    const expression = [...expressions][0]!
    expect(expression).toContain('getReduceMoney()')
    expect(expression, `算钱的表达式里多了系数：${expression}`).not.toMatch(/[\d/]/)
    // 正负号两种都在（只有 `-` 说明卖出那一段没解析到）。
    expect(new Set(terms.map((m) => m[1]))).toEqual(new Set(['-', '+']))
  })
})

/** 这一票只看装备店那几笔。药店那半边在 `drugShop.test.ts`。 */
const equipTrades = (trace: ShopTrace): Trade[] => tradesOf(trace, 'equipment')

describe('真值账本：装备店每一笔成交的金钱变化', () => {
  const ledger: string[] = []

  it('逐笔：Δ金钱 = -Σ(单价 × Δ背包件数)，买与卖同一个等式', () => {
    let trades = 0
    for (const name of SHOP_TRACE_NAMES) {
      const trace = readShopTrace(name)
      for (const { i, kind, prev, cur } of equipTrades(trace)) {
        trades++
        const before = listOf(prev)
        const after = listOf(cur)
        expect(after.length).toBe(before.length)
        let want = 0
        const moved: string[] = []
        for (const [j, row] of after.entries()) {
          const dHeld = row.held - before[j]!.held
          const dStock = row.stock - before[j]!.stock
          // 店里少几件、背包就多几件 —— 两边是同一笔。
          expect(dStock + dHeld, `${name}@${i} 第 ${j} 行的存货与背包对不上`).toBe(0)
          want -= row.price * dHeld
          if (dHeld !== 0) moved.push(`${row.name} ${dHeld > 0 ? '+' : ''}${dHeld} × ${row.price}`)
        }
        const got = (cur['coins'] as number) - (prev['coins'] as number)
        expect(got, `${name}@${i} 那一笔 ${kind} 的金钱差额`).toBe(want)
        ledger.push(
          `${name}@${i} ${kind}(${String(cur['category'])}): Δ金钱 ${got >= 0 ? '+' : ''}${got}` +
            (moved.length > 0 ? ` [${moved.join(', ')}]` : ' [一个数都没动]'),
        )
      }
    }
    // 分母现数：一笔都没有时上面那一圈零轮，而零轮的 for 是恒真的。
    expect(trades, '三条真值里一笔装备店成交都没有').toBeGreaterThan(0)
    // eslint-disable-next-line no-console -- 验收标准要"贴出每一笔的差额"
    console.log(['装备店成交账本', ...ledger].join('\n  '))
  })

  it('买入与卖出的单价相等，且就是数据表里的价格', () => {
    const paid = new Map<string, Set<number>>()
    for (const name of SHOP_TRACE_NAMES) {
      const trace = readShopTrace(name)
      for (const { prev, cur } of equipTrades(trace)) {
        const before = listOf(prev)
        const after = listOf(cur)
        const dCoins = (cur['coins'] as number) - (prev['coins'] as number)
        const moved = after
          .map((row, j) => ({ row, d: row.held - before[j]!.held }))
          .filter((x) => x.d !== 0)
        // 一次点击里只动了一行时，单价才反推得出来。
        if (moved.length !== 1) continue
        const { row, d } = moved[0]!
        if (!paid.has(row.name)) paid.set(row.name, new Set())
        paid.get(row.name)!.add(Math.abs(dCoins / d))
      }
    }
    expect(paid.size, '一笔单行成交都没有，这条判据是恒真的').toBeGreaterThan(0)
    const all = EQUIP_SLOTS.flatMap((s) => EQUIPMENT_LISTS[s])
    for (const [item, units] of paid) {
      expect([...units], `${item} 买入与卖出的单价不一样`).toHaveLength(1)
      const spec = all.find((e) => e.name === item)
      expect(spec, `${item} 不在那六张装备表里`).toBeTruthy()
      expect([...units][0], `${item} 的成交单价与数据表不一样`).toBe(spec!.reduceMoney)
    }
  })
})

describe('两条交叉路径：从真值里认出来，再逐字段核状态层', () => {
  /** 把一条真值跑完，返回逐步快照。 */
  function snapshots(trace: ShopTrace): Record<string, unknown>[] {
    const world = replayShop(trace)
    return shopInputsOf(trace).map((step) => {
      stepShop(world, step)
      return snapshotShop(world)
    })
  }

  /**
   * 验收标准点名的那一条：**切到另一类再切回来，刚买的东西还在背包里**。
   *
   * 这条路真值里走过（`shop-trade` 尾巴上买月苗刀 → 去鞋子栏卖皮靴 → 切回
   * 武器栏），而它在 `shopTrace.test.ts` 里已经被 `pack` 那一格盖住了。这里
   * 补的是**分母**：那一格全绿也可能是因为"没有一条剧本切走再切回来"，
   * 而"这条路没人走过"与"走过且对上了"在那边长得一模一样。
   */
  it('切到另一类再切回来，刚买的还在背包里 —— 这条路真值里真的走过', () => {
    let checked = 0
    for (const name of SHOP_TRACE_NAMES) {
      const trace = readShopTrace(name)
      const snaps = snapshots(trace)
      // 每一笔装备店买入之后，看后面有没有"离开这一栏再回到这一栏"。
      for (const { i, kind, prev, cur } of equipTrades(trace)) {
        if (kind !== 'buy') continue
        const category = cur['category'] as string
        const bought = listOf(cur)
          .map((row, j) => ({ row, d: row.held - listOf(prev)[j]!.held }))
          .filter((x) => x.d > 0)
        if (bought.length === 0) continue
        // 之后切走了吗，又切回来了吗。
        const left = trace.ticks.findIndex((t, k) => k > i && t['category'] !== category)
        if (left < 0) continue
        const back = trace.ticks.findIndex((t, k) => k > left && t['category'] === category)
        if (back < 0) continue
        checked++
        // 回来那一步，背包里那几件**还在** —— 期望值来自我们自己的快照，
        // 而它同时也与真值那一列对齐（`shopTrace.test.ts` 的 pack 那一格）。
        const held = (snaps[back]!['list'] as TradeRow[]).map((r) => r.held)
        for (const { row, d } of bought) {
          const j = listOf(cur).findIndex((r) => r.name === row.name)
          expect(
            held[j],
            `${name}：${category} 栏买的 ${row.name} 切走再切回来之后不见了`,
          ).toBeGreaterThanOrEqual(d)
        }
        // 而且真值自己也这么说 —— 两边不一致时这一条会红。
        expect(held).toEqual((trace.ticks[back]!['list'] as TradeRow[]).map((r) => r.held))
      }
    }
    expect(
      checked,
      '三条真值里没有一次"买完切走再切回来" —— 那条验收标准现在是恒真的',
    ).toBeGreaterThan(0)
  })

  it('切分类那一步：加减按钮整段重建，所以那一步一个 purchase 都点不着', () => {
    // 原版 `setButton` 里分类切换排在最前，它 `remove` 到第 9 颗再 `setList()`，
    // 新按钮的 `isclicked` 全是 false —— 后面那个加减循环因此在切栏那一步
    // 什么都点不着。⚠️ 这与"切栏时恰好没点加减"分得开：`music` 里只该有
    // 一声 `换list.wav`，没有 `click.wav`。
    let checked = 0
    for (const name of SHOP_TRACE_NAMES) {
      const trace = readShopTrace(name)
      const snaps = snapshots(trace)
      for (const [i, cur] of trace.ticks.entries()) {
        if (i === 0 || cur['shop'] !== 'equipment') continue
        const switched = cur.input.some(
          (e) => e.e === 'release' && 'target' in e && (e.target ?? '').startsWith('category:'),
        )
        if (!switched) continue
        checked++
        expect(snaps[i]!['music'], `${name}@${i} 切栏那一步的音效`).toEqual(cur['music'])
        expect(cur['music'], `${name}@${i} 切栏却没出声？`).toContain('换list.wav')
        expect(cur['music'], `${name}@${i} 切栏那一步出了 click.wav`).not.toContain('click.wav')
        // 新那一栏的 purchase 全是 0（真值自己这么说，我们对上它）。
        expect(snaps[i]!['list'], `${name}@${i} 切栏之后那一列`).toEqual(cur['list'])
      }
    }
    expect(checked, '三条真值里一次分类切换都没有').toBeGreaterThan(0)
  })
})
