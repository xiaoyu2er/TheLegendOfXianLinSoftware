import { describe, expect, it } from 'vitest'
import { DRUGS } from '../battle/drugs'
import { javaSource } from '../test/javaSource'
import { BUY_BOX } from './layout'
import { hitCenter } from './test/hitCenter'
import { snapshotShop } from './snapshot'
import { DRUG_EXPENSIVE_FROM, DRUG_TRADE_ROWS, stepShop } from './step'
import { SHOP_TRACE_NAMES, readShopTrace, replayShop, shopInputsOf } from './trace'
import type { ShopTrace, ShopTraceTick } from './trace'

/**
 * 药店那半边（xl-knp.7）的三条判据，都**不手写期望值**：
 *
 * 1. **源码参照模型** —— 店主对白的拼接格式、6000 那道坎、买卖循环的上界、
 *    以及"卖价等于买价"这件反直觉的事，全部从 GBK 源码 `src/shop/ShopPanel.java`
 *    现读，再拿状态层逐条对过去。
 * 2. **真值账本** —— 三条真值里每一笔药店成交的金钱变化，用真值自己记的
 *    单价与件数核一遍。卖出被"顺手修好"成打折时这一条立刻红。
 * 3. **两条边界路径确实在真值里** —— 钱不够被拒、以及 `purchase` 已经是 0 时
 *    再按减号。它们是验收标准点名的两条路，而**"这条路径没人走过"与"走过且
 *    对上了"在 `shopTrace.test.ts` 里长得一模一样**（都是绿的），所以分母要
 *    在这里现数。
 *
 * ⚠️ 这里**只管药店**。装备店那半边归 xl-knp.8，它的账本与源码参照模型
 * （属性加成 / 三档价位 / 谁能用）是另一张票的事 —— 下面每一处都按真值的
 * `shop` 那一列筛过。
 */

const SOURCE = javaSource('src/shop/ShopPanel.java')
const MOVE_IN = SOURCE.slice(
  SOURCE.indexOf('private void isMoveIn()'),
  SOURCE.indexOf('public void setMouse()'),
)
const SET_BUTTON = SOURCE.slice(
  SOURCE.indexOf('public void setButton()'),
  SOURCE.indexOf('public void drawIcon('),
)

describe('药店的源码参照模型：期望值从 ShopPanel.java 现读', () => {
  it('两段界标真的切出来了 —— 切空了与"这一段没有那句话"长得一样', () => {
    expect(SOURCE).toContain('class ShopPanel')
    expect(MOVE_IN.length).toBeGreaterThan(0)
    expect(SET_BUTTON.length).toBeGreaterThan(0)
    // GBK 解错时中文全是乱码，而乱码在下面每一条正则下都是零匹配。
    expect(MOVE_IN).toContain('messageplus')
    expect(SET_BUTTON).toContain('isIsclicked')
  })

  it('店主第一行的拼接格式：逗号、空格与「Mp」的大小写都从源码来', () => {
    const m = MOVE_IN.match(
      /message="([^"]*)"\+[^;"]*getAddHp\(\)\+"([^"]*)"\+[^;"]*getAddMp\(\);/,
    )
    expect(m, 'ShopPanel.isMoveIn 里那句 message= 没解析出来').not.toBeNull()
    const head = m![1]!
    const mid = m![2]!
    // 逐行核到状态层：`drugHoverMessage` 拼出来的必须与源码拼出来的一字不差。
    const world = replayShop(readShopTrace(SHOP_TRACE_NAMES[0]!))
    for (const [i, drug] of DRUGS.entries()) {
      world.active = 'drug'
      // 第 i 行的命中带（`layout.ts` 的 rowAt：y ∈ (180+20i, 200+20i)）。
      stepShop(world, [{ e: 'move', x: 600, y: 190 + 20 * i }])
      expect(snapshotShop(world)['message']).toEqual({
        message: `${head}${drug.addHp}${mid}${drug.addMp}`,
        plus: expect.any(String),
        remark: null,
      })
    }
  })

  it('第二行按价位分档：那道坎与两句话都从源码来，且两档在真值里各自取到', () => {
    const m = MOVE_IN.match(
      /getReduceMoney\(\)>=(\d+)\)\s*\r?\n\s*messageplus="([^"]+)";\s*\r?\n\s*else\s*\r?\n\s*messageplus="([^"]+)";/,
    )
    expect(m, 'ShopPanel.isMoveIn 里那个价位分档没解析出来').not.toBeNull()
    const threshold = Number(m![1]!)
    const expensive = m![2]!
    const cheap = m![3]!

    // ⚠️ **先直接对那个数**：`drug.txt` 里没有一件药落在 5000 与 6000 之间，
    // 所以下面那一圈"分档的结果"对 5000 与对 6000 完全一样 —— 篡改矩阵实测
    // 把常数改成 5000 时它是绿的。这一行是那个洞唯一的补丁。
    expect(DRUG_EXPENSIVE_FROM, 'ShopPanel.isMoveIn 里那道坎').toBe(threshold)

    // (a) 状态层逐行对源码。
    const world = replayShop(readShopTrace(SHOP_TRACE_NAMES[0]!))
    const got: string[] = []
    for (const [i, drug] of DRUGS.entries()) {
      world.active = 'drug'
      stepShop(world, [{ e: 'move', x: 600, y: 190 + 20 * i }])
      const want = drug.reduceMoney >= threshold ? expensive : cheap
      expect(
        (snapshotShop(world)['message'] as { plus: string }).plus,
        `第 ${i} 行（${drug.name} ${drug.reduceMoney}）`,
      ).toBe(want)
      got.push(want)
    }
    // 分母现数：数据表本身要真的横跨这道坎，否则上面那一圈只走了一档。
    expect(new Set(got), 'drug.txt 的价格全落在同一档里，这条分档判据是恒真的').toEqual(
      new Set([expensive, cheap]),
    )

    // (b) 两档在**真值**里各自取到 —— 光有 (a) 的话，剧本一次都没停到贵药上
    // 也照样绿，而验收标准要的正是"真值里各自取到"。
    const seen = new Set<string>()
    for (const name of SHOP_TRACE_NAMES) {
      for (const tick of readShopTrace(name).ticks) {
        if (tick['shop'] !== 'drug') continue
        const plus = (tick['message'] as { plus: string | null }).plus
        if (plus !== null) seen.add(plus)
      }
    }
    expect(seen, '真值里药店店主的第二行只取到了这几句').toEqual(new Set([expensive, cheap]))
  })

  /**
   * ⚠️ **`drugBuy` 注释里 ⚠️ 第 2 条自称"照抄"的那一句，原来一条判据都没有。**
   *
   * 退款循环里 `temp` 是**重算**的，而 `stock` 已经被上面那个买入循环减过了
   * —— 买的件数超过原存货一半时就**退不干净**（原版缺陷，ADR-0001 要求照抄）。
   * 三条真值都没走到那一路，所以把它"顺手修好"成一次退干净时**全套判据仍然
   * 全绿**（/code-review Spec 轴实测）。这与 6000 那道坎是同一个形状的洞。
   *
   * 补两条，两个角度各一条：源码那一侧核**两句 `temp` 逐字相同**（这就是
   * "重算"的全部内容），状态层那一侧核它**真的退不干净**。
   */
  it('⚠️ 退款循环里的 temp 与买入循环里的逐字相同 —— 那就是"重算"', () => {
    const temps = [...SET_BUTTON.matchAll(/int temp=Math\.min\((.+?)\);/g)].map((m) =>
      m[1]!.trim(),
    )
    // 分母现数：解析不出来时下面两条是恒真的。买 / 退款 / 卖，三句。
    expect(temps.length, 'setButton 里那几句 int temp=Math.min(...) 没解析出来').toBe(3)
    const [buyTemp, undoTemp, sellTemp] = temps as [string, string, string]
    // 买与退款那两句**一字不差** —— 退款没有换用"买之前的存货"，所以它重算。
    expect(undoTemp, '退款循环的 temp 与买入循环的不一样了').toBe(buyTemp)
    // 卖那一句必须**不同**（它比的是背包，不是店里）；相同说明界标切错了段。
    expect(sellTemp, '卖出那一句与买入的一样 —— 界标多半切错了').not.toBe(buyTemp)
  })

  it('⚠️ 买超过原存货一半又被拒时**退不干净** —— 金钱、存货与背包都回不去', () => {
    const world = replayShop(readShopTrace(SHOP_TRACE_NAMES[0]!))
    world.active = 'drug'
    // 挑最贵那一行，把这一单摆成 `purchase > stock - purchase`：买入循环
    // 成交 purchase 件、存货只剩 stock-purchase，退款那一句于是只退得回
    // stock-purchase 件。数字随便挑，判据不是它们，是"回不去"。
    const row = world.drug.rows[DRUGS.length - 1]!
    const [stock, purchase] = [4, 3]
    expect(purchase, '这一单没摆成"超过原存货一半"，下面几条就成了恒真').toBeGreaterThan(
      stock - purchase,
    )
    row.stock = stock
    row.purchase = purchase
    const coins0 = world.coins
    const pack0 = world.pack.drugs[DRUGS.length - 1]!
    // 钱确实不够 —— 否则走的是成交那一路，下面核的就不是这条缺陷了。
    expect(row.price * purchase).toBeGreaterThan(coins0)

    // 按下再松开 —— `setButton` 认的是 `isclicked`，只松开一下什么都不会发生
    // （而"什么都没发生"与"退干净了"在下面几条上长得一样，所以这两步不能省）。
    const [bx, by] = hitCenter(BUY_BOX)
    stepShop(world, [{ e: 'press', x: bx, y: by }])
    stepShop(world, [{ e: 'release', x: bx, y: by }])
    // 空转要响：这一下真的点着了买入按钮。
    expect(world.music).toEqual(['Clip986.wav'])

    // 店主那句话变了（这一半是"被拒"的正常表现）……
    expect(world.drug.message).toBe('哎呀,小兄弟,你的钱不顾了,要省着点花啊')
    expect(world.drug.messagePlus).toBeNull()
    // ……而金钱、存货与背包**一个都没回到原位**。退干净的实现会让这三条全红。
    expect(world.coins, '金钱退回原位了 —— 有人把那个原版缺陷"修好"了').not.toBe(coins0)
    expect(row.stock, '存货退回原位了').not.toBe(stock)
    expect(world.pack.drugs[DRUGS.length - 1], '背包退回原位了').not.toBe(pack0)
    // 而 `purchase` 照样清零（那一句在最外面，买成了没成都清）。
    expect(row.purchase).toBe(0)
  })

  it('买卖那几个循环的上界是**字面量**，且与 drug.txt 的行数相等', () => {
    const bounds = [...SET_BUTTON.matchAll(/for\(int i=0;i<(\d+);i\+\+\)/g)].map((m) =>
      Number(m[1]),
    )
    // 分母现数：一个都没解析出来时下面两条是恒真的。
    expect(bounds.length, 'setButton 里一个 for(int i=0;i<N;i++) 都没解析出来').toBeGreaterThan(0)
    expect(new Set(bounds), '几个循环的上界不一样').toEqual(new Set([DRUGS.length]))
    // ⚠️ **对到常量本身**，不只对到 `DRUGS.length`：只对后者的话，把
    // `DRUG_TRADE_ROWS` 改成 5 时这一条仍然是绿的（与 6000 那道坎同一个洞）。
    expect(DRUG_TRADE_ROWS, 'ShopPanel.setButton 里那几个循环的上界').toBe(bounds[0])
    // ⚠️ 原版写的是字面量而不是 `drugList.size()` —— 数据多一行时原版不会跟着变。
    expect(SET_BUTTON).not.toMatch(/for\(int i=0;i<drugList\.size\(\);i\+\+\)/)
  })

  it('⚠️ 卖价等于买价，不打折 —— 买与卖那两句只差一个正负号', () => {
    const terms = [...SET_BUTTON.matchAll(/Money\.setCoins\(Money\.coins([-+])(.+?)\);/g)]
    expect(terms.length, 'setButton 里那几句 Money.setCoins 没解析出来').toBeGreaterThan(1)
    // ⚠️ 期望值仍然一个都不写：判据是**买与卖那两句的被加减项逐字相同**。
    const expressions = new Set(terms.map((m) => m[2]!.trim()))
    expect(
      [...expressions],
      '买入与卖出算钱的表达式不是同一个 —— 有人给卖出加了折扣',
    ).toHaveLength(1)
    const expression = [...expressions][0]!
    // 而且那一项就是"单价 × 件数"：折扣的形状是里面多一个数或一个除号。
    expect(expression).toContain('getReduceMoney()')
    expect(expression, `算钱的表达式里多了系数：${expression}`).not.toMatch(/[\d/]/)
    // 正负号两种都在（只有 `-` 说明卖出那一段没解析到，那时上面几条是恒真的）。
    expect(new Set(terms.map((m) => m[1]))).toEqual(new Set(['-', '+']))
  })
})

/** 一条真值里药店那几步成交（松开 buy / sell 的那一步），连着它的前一步。 */
function drugTrades(trace: ShopTrace): { i: number; kind: string; prev: ShopTraceTick; cur: ShopTraceTick }[] {
  const out: { i: number; kind: string; prev: ShopTraceTick; cur: ShopTraceTick }[] = []
  for (const [i, cur] of trace.ticks.entries()) {
    if (i === 0 || cur['shop'] !== 'drug') continue
    for (const e of cur.input) {
      if (e.e !== 'release' || !('target' in e)) continue
      if (e.target === 'buy' || e.target === 'sell') {
        out.push({ i, kind: e.target, prev: trace.ticks[i - 1]!, cur })
      }
    }
  }
  return out
}

interface Row {
  readonly name: string
  readonly price: number
  readonly stock: number
  readonly purchase: number
  readonly held: number
}
const listOf = (tick: ShopTraceTick): readonly Row[] => tick['list'] as readonly Row[]

describe('真值账本：药店每一笔成交的金钱变化', () => {
  /**
   * 每一笔的差额。**一个数都不是手写的** —— 单价、件数与金钱全部从真值里读，
   * 这条判据核的是它们三个自洽。
   *
   * 买与卖用**同一个**等式：`Δ金钱 = -Σ(单价 × Δ背包件数)`。卖出打了折的话
   * 卖那一笔立刻不成立 —— 这就是"卖价等于买价"这件反直觉的事的判据。
   */
  const ledger: string[] = []

  it('逐笔：Δ金钱 = -Σ(单价 × Δ背包件数)，买与卖同一个等式', () => {
    let trades = 0
    for (const name of SHOP_TRACE_NAMES) {
      const trace = readShopTrace(name)
      for (const { i, kind, prev, cur } of drugTrades(trace)) {
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
          `${name}@${i} ${kind}: Δ金钱 ${got >= 0 ? '+' : ''}${got}` +
            (moved.length > 0 ? ` [${moved.join(', ')}]` : ' [一个数都没动]'),
        )
      }
    }
    // 分母现数：一笔都没有时上面那一圈零轮，而零轮的 for 是恒真的。
    expect(trades, '三条真值里一笔药店成交都没有').toBeGreaterThan(0)
    // eslint-disable-next-line no-console -- 验收标准要"贴出每一笔的差额"
    console.log(['药店成交账本', ...ledger].join('\n  '))
  })

  it('同一件药：买入付出的单价与卖出拿回的单价相等', () => {
    // 从账本反推每件药买、卖两个方向各自的**实付单价**，两边必须相等。
    const paid = new Map<string, Set<number>>()
    for (const name of SHOP_TRACE_NAMES) {
      const trace = readShopTrace(name)
      for (const { prev, cur } of drugTrades(trace)) {
        const before = listOf(prev)
        const after = listOf(cur)
        const dCoins = (cur['coins'] as number) - (prev['coins'] as number)
        const moved = after
          .map((row, j) => ({ row, d: row.held - before[j]!.held }))
          .filter((x) => x.d !== 0)
        // 一次点击里只动了一行时，单价才反推得出来（三条剧本都是这样）。
        if (moved.length !== 1) continue
        const { row, d } = moved[0]!
        const unit = Math.abs(dCoins / d)
        if (!paid.has(row.name)) paid.set(row.name, new Set())
        paid.get(row.name)!.add(unit)
      }
    }
    expect(paid.size, '一笔单行成交都没有，这条判据是恒真的').toBeGreaterThan(0)
    // 同一件药买过也卖过时，两个方向的单价落进同一个集合 —— 打折的话是两个数。
    for (const [drug, units] of paid) {
      expect([...units], `${drug} 买入与卖出的单价不一样`).toHaveLength(1)
    }
    // 而且那个单价就是数据表里的价格。
    for (const [drug, units] of paid) {
      const spec = DRUGS.find((d) => d.name === drug)
      expect(spec, `${drug} 不在 drug.txt 里`).toBeTruthy()
      expect([...units][0]).toBe(spec!.reduceMoney)
    }
  })

  it('真值里确实有一笔"钱不够被拒"—— 否则那条验收标准是恒真的', () => {
    // ⚠️ **自己数一遍**，不靠上一条用例的副作用：上一条先红时那个计数停在 0，
    // 而"没数到"与"真值里没有这条路"长得一模一样。
    let refusals = 0
    for (const name of SHOP_TRACE_NAMES) {
      const trace = readShopTrace(name)
      for (const { kind, prev, cur } of drugTrades(trace)) {
        if (kind !== 'buy') continue
        // ⚠️ 识别式要**认得出原因**：光看"金钱与背包没动"的话，店里存货
        // 全是 0 的那种购买也会被算进来，而那是另一条路（`shop-edges` 走的）。
        // 这里按原版的判据认：`Money.getCoins()<0`，即整单要付的钱**超过**
        // 手上的钱 —— 而"要付多少"只算得进店里真有存货的那几件。
        const asked = listOf(prev).reduce(
          (sum, r) => sum + r.price * Math.min(r.purchase, r.stock),
          0,
        )
        if (asked <= (prev['coins'] as number)) continue
        expect(cur['coins'], `${name} 那一笔该被拒`).toBe(prev['coins'])
        expect(listOf(cur).map((r) => r.held)).toEqual(listOf(prev).map((r) => r.held))
        refusals++
      }
    }
    expect(refusals, '三条真值里没有一笔金钱与背包都没动的购买').toBeGreaterThan(0)
  })
})

describe('两条边界路径：从真值里认出来，再逐字段核状态层', () => {
  /** 把一条真值跑完，返回逐步快照。 */
  function snapshots(trace: ShopTrace): Record<string, unknown>[] {
    const world = replayShop(trace)
    return shopInputsOf(trace).map((step) => {
      stepShop(world, step)
      return snapshotShop(world)
    })
  }

  it('钱不够：金钱、商品列表与背包一个数都不动，只有店主那句话变了', () => {
    let checked = 0
    for (const name of SHOP_TRACE_NAMES) {
      const trace = readShopTrace(name)
      const snaps = snapshots(trace)
      for (const { i, kind, prev, cur } of drugTrades(trace)) {
        if (kind !== 'buy') continue
        // 认出"被拒"那一笔，按原版的判据（`Money.getCoins()<0`）：整单要付的
        // 钱超过手上的钱。⚠️ 不用"金钱没动"来认 —— 店里存货全是 0 的那种
        // 购买金钱同样没动，而那是另一条路。
        const owed = listOf(prev).reduce(
          (sum, r) => sum + r.price * Math.min(r.purchase, r.stock),
          0,
        )
        if (owed <= (prev['coins'] as number)) continue
        checked++
        const before = snaps[i - 1]!
        const after = snaps[i]!
        // 逐字段核，期望值来自**我们自己上一步的快照**，不是手写的。
        expect(after['coins'], `${name}@${i} 金钱`).toEqual(before['coins'])
        expect(after['pack'], `${name}@${i} 背包`).toEqual(before['pack'])
        // ⚠️ `list` 只有 `purchase` 那一列该被清零，`stock` / `held` 一个不动。
        const strip = (rows: unknown) =>
          (rows as Row[]).map(({ purchase: _p, ...rest }) => rest)
        expect(strip(after['list']), `${name}@${i} 存货与持有`).toEqual(strip(before['list']))
        expect((after['list'] as Row[]).every((r) => r.purchase === 0)).toBe(true)
        // 变的只有店主那句话。
        expect(after['message']).not.toEqual(before['message'])
        // 而且它就是真值里那一句 —— 这一整条因此不是"只要变了就算"。
        expect(after['message']).toEqual(cur['message'])
      }
    }
    expect(checked, '一笔"钱不够被拒"都没核到').toBeGreaterThan(0)
  })

  it('purchase 已经是 0 时再按减号：一个数都不动，**但照样出声**', () => {
    let checked = 0
    for (const name of SHOP_TRACE_NAMES) {
      const trace = readShopTrace(name)
      const snaps = snapshots(trace)
      for (const [i, cur] of trace.ticks.entries()) {
        if (i === 0 || cur['shop'] !== 'drug') continue
        const minus = cur.input.find(
          (e) => e.e === 'release' && 'target' in e && /^minus:\d+$/.test(e.target ?? ''),
        )
        if (!minus || !('target' in minus)) continue
        const row = Number(minus.target!.slice('minus:'.length))
        if (listOf(trace.ticks[i - 1]!)[row]!.purchase !== 0) continue
        checked++
        // 商品列表一个数不动（期望值是上一步的快照）。
        expect(snaps[i]!['list'], `${name}@${i}`).toEqual(snaps[i - 1]!['list'])
        // ⚠️ 但那一声在守卫**外面** —— "什么都不发生"是错的读法，而这两种
        // 读法在除 music 之外的每一列上长得一样。这里的期望值来自真值。
        expect(snaps[i]!['music'], `${name}@${i} 那一声`).toEqual(cur['music'])
        expect(cur['music'], `${name}@${i} 真值里那一步是没声的？`).not.toEqual([])
      }
    }
    expect(checked, '真值里没有一次"减到 0 之后再按减号"').toBeGreaterThan(0)
  })
})
