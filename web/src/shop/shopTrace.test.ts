import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { snapshotShop } from './snapshot'
import { stepShop } from './step'
import { SHOP_TRACE_NAMES, readShopTrace, replayShop, shopInputsOf } from './trace'
import type { ShopTrace } from './trace'

/**
 * 商店状态层**逐字段**对齐行为真值。
 *
 * 这是 M4 唯一的新判据，也是它存在的理由：写实现和写期望值的是同一个 agent、
 * 在同一个上下文窗口里，手写期望的测试会绿、而且是错的。这里的期望值一个都
 * 不是手写的 —— 全部来自 `tools/traces/out/shop-*.trace.json`，由原版 Java
 * 程序自己跑出来。
 *
 * **不启动渲染**：整个文件没有 canvas、没有 Pixi、没有 React、没有 DOM ——
 * 而这句话自己也是一条判据，见最后那条「这个文件不碰渲染」。
 *
 * 喂给状态层的只有两样，都不是状态：
 *
 * - 剧本回显（`setup.party` / `coins` / `seed` / `drugs` / `equipment`）——
 *   "这是哪一局"；
 * - 每一步的 `input`——那一步实际喂给原版的鼠标事件。⚠️ `open` 那一种是**空
 *   输入**，从剧本的指令里还原，两个方向都核过（`replay.ts` 的
 *   `shopInputsOfTicks`）。
 *
 * ## 登记按**（字段组 × 剧本）的格子**，不按整条剧本
 *
 * 与菜单那一份同构、同一个理由：状态层是三张票做的（骨架 xl-knp.6、
 * 药店 xl-knp.7、装备超市 xl-knp.8），而三条真值每一条都横跨不止一张。
 * 按整条剧本登记的话，骨架这一票**一条会红的判据都没有**。
 *
 * 两个方向都要检查，这也是格子式登记必须付的代价：
 *
 * - 登记成"已对齐"的格子，逐步 `toEqual` 必须真的过；
 * - 登记成"还欠着"的格子，逐步 `toEqual` 必须真的**不过** —— 否则那一格
 *   已经做完了却还挂着票号，而"做完了"与"没人对"就又长得一样了。
 */

/**
 * 真值一行里**不属于状态**的那几列。剩下的每一列都是一个字段组，都要有人登记。
 *
 * 这是**登记**不是分母：哪几列不算状态要人来读 `ShopDriver.snapshotState`
 * 才答得出。分母（一共有哪几列、有哪几条剧本）在下面全部从磁盘现数。
 */
const NON_STATE_COLUMNS: readonly string[] = ['t', 'ip', 'input']

/**
 * **已经对齐的格子 —— 手写登记。**
 *
 * ⚠️ 这张表**必须手写**。写成"从快照现有的键推"时，下面那条对撞用例的每一段
 * 都变成恒真：未登记的格子必空、`PENDING` 那个循环零轮、交集必空 —— 于是
 * "真值目录里冒出一份没人回放的剧本"会被**自动算作已对齐**，而那正是这一整套
 * 对撞要拦的东西。这是 `xl-rh9.8` 真栽过的坑（`docs/agents/dispatch.md` 纪律 3
 * 的那条 ⚠️）。
 *
 * 这不违反纪律 3「别把『目前只有 X』写死」：那一条禁的是把**分母**写死。
 * 这里分母仍然是磁盘上的 `SHOP_TRACE_NAMES` 与真值自己的列名，写死的是
 * "谁已经有人对齐了"这份需要人签字的登记。
 */
const ALIGNED: Readonly<Record<string, readonly string[]>> = {
  // **19 / 30 格**。这份名单是**跑出来的，不是宣布的**：先把 10 组 × 3 条剧本
  // 全填进来跑了一遍，红的那 11 格挪进了下面的 `PENDING`（2026-09-09，
  // xl-knp.6 落地时的读数）。
  //
  // 骨架这一票做的是：掷存货（62 次，顺序即规格）、金钱与背包的开局、
  // 两个面板的按钮表与命中框、落点与行号、换店、切分类、图标框换图。
  music: ['shop-categories'],
  shop: ['shop-categories', 'shop-edges', 'shop-trade'],
  category: ['shop-categories', 'shop-edges', 'shop-trade'],
  coins: ['shop-categories'],
  cursor: ['shop-categories', 'shop-edges', 'shop-trade'],
  // ⚠️ `list` 只有 `shop-categories` 那一格签得下，而它**恰恰是最要紧的一格**：
  // 那条剧本六栏全走了一遍，`stock` 那一排数字是原版自己摇出来的 —— 掷骰的
  // 次数与顺序（`world.ts` 的 `STOCK_ROLL_ORDER`）唯一的判据就在这里。
  // 另外两条剧本一按下加号就分岔，归 xl-knp.7 / .8。
  list: ['shop-categories'],
  icon: ['shop-categories', 'shop-edges', 'shop-trade'],
  pressed: ['shop-categories', 'shop-edges', 'shop-trade'],
  pack: ['shop-categories'],
}

/**
 * **还欠着的格子 —— 手写登记，每一格写明归哪张票。**
 *
 * 这两张表是**对撞**的：真值目录里冒出一份两边都没有的剧本，或者真值多出
 * 一列没人登记，下面第一条用例立刻红。
 *
 * ⚠️ 票号写的是**第一处分歧落在哪家店**，不是"这一格全做完要几张票"：
 * `shop-edges` 与 `shop-trade` 两条剧本各自都横跨两家店，所以下面每一格
 * 其实都要 xl-knp.7 与 xl-knp.8 两张一起做完才对得齐（菜单那边
 * `heroes × menu-equip` 是同一个形状）。挑第一处分歧那一张，是因为它**查得
 * 出来**：`BLOCKED_AT` 底下那批用例逐格核的正是"第一处分歧恰好是登记里写的
 * 那一步"。
 */
const PENDING: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // 店主说的三行话整个还没做 —— `step.ts` 的 `panelMoveIn` 里只做了换图标
  // 那一半，加对白是下面两张票**往那个 if 里加几句赋值**的事。
  message: {
    // 这条剧本一次都没打开药店，第一处分歧在装备店的属性加成那一行。
    'shop-categories': 'xl-knp.8',
    'shop-edges': 'xl-knp.7',
    'shop-trade': 'xl-knp.7',
  },
  // 加减 / 买卖那四声（`click.wav` × 2、`Clip986.wav` × 2）。切分类那声
  // `换list.wav` 已经有了，所以 `shop-categories` 那一格签得下。
  music: {
    'shop-edges': 'xl-knp.7',
    'shop-trade': 'xl-knp.7',
  },
  coins: {
    'shop-edges': 'xl-knp.7',
    'shop-trade': 'xl-knp.7',
  },
  // 分岔的只有 `purchase` 那一列（加减按钮）与买卖之后的 `stock` / `held`。
  list: {
    'shop-edges': 'xl-knp.7',
    'shop-trade': 'xl-knp.7',
  },
  pack: {
    'shop-edges': 'xl-knp.7',
    'shop-trade': 'xl-knp.7',
  },
}

/**
 * **`PENDING` 里那些「前半截已经对上了」的格子 —— 手写登记，写明卡在哪。**
 *
 * 光有 `PENDING` 的话，"第 2 步就开始错"与"一直对到第 13 步、卡在别人那张票上"
 * 长得一模一样：两者都只是"还没对上"。而这一票的成果恰恰全在那前半截里
 * （开局的存货 / 金钱 / 背包、落点、按钮、换店、切分类），没有这张表就没有
 * 一条判据在守它。
 *
 * 卡住的那一步**不写步号**，写成一句真值自己认得出的话（"药店上松开 buy 的
 * 第一步"）—— 步号会随着剧本改动整体平移，而那种失效是安静的。
 *
 * ⚠️ 十一格全在这里，一格不落：`PENDING` 里有而这里没有的格子，等于放弃了
 * "前半截对到哪儿"这条判据，而它与"前半截压根没对上"长得一样。
 */
interface BlockedAt {
  /** 那一步开着哪一家店。 */
  readonly shop: string
  /** 那一步的输入事件与它点的东西。 */
  readonly event: string
  readonly target: string
  /** 卡住的原因，一句话。 */
  readonly why: string
}

/** 十一格里反复出现的那几种卡法，写一处。 */
const HOVER_ROW_NO_MESSAGE = '店主对白还没做：第一次把鼠标停到某一行上，那三行话就该换了'
const STEP_NO_PURCHASE = '加减按钮还没接：松开加号那一下，这一行的 purchase 该变'
const STEP_NO_SOUND = '加减按钮还没接：松开那一下该出一声 click.wav'
const BUY_NO_EFFECT = '买入还没接：松开购买那一下，金钱与背包该动'

const BLOCKED_AT: Readonly<Record<string, Readonly<Record<string, BlockedAt>>>> = {
  message: {
    'shop-categories': { shop: 'equipment', event: 'move', target: 'row:6', why: HOVER_ROW_NO_MESSAGE },
    'shop-edges': { shop: 'drug', event: 'move', target: 'row:5', why: HOVER_ROW_NO_MESSAGE },
    'shop-trade': { shop: 'drug', event: 'move', target: 'row:0', why: HOVER_ROW_NO_MESSAGE },
  },
  music: {
    'shop-edges': { shop: 'drug', event: 'release', target: 'plus:5', why: STEP_NO_SOUND },
    // ⚠️ 这一条是**减号**：`shop-trade` 头一下点的是减号，而原版那个守卫
    // （`purchaseNumber>0` 才减）让它一个数都没改 —— 变的只有那一声。
    'shop-trade': { shop: 'drug', event: 'release', target: 'minus:0', why: STEP_NO_SOUND },
  },
  coins: {
    'shop-edges': { shop: 'drug', event: 'release', target: 'buy', why: BUY_NO_EFFECT },
    'shop-trade': { shop: 'drug', event: 'release', target: 'buy', why: BUY_NO_EFFECT },
  },
  list: {
    'shop-edges': { shop: 'drug', event: 'release', target: 'plus:5', why: STEP_NO_PURCHASE },
    'shop-trade': { shop: 'drug', event: 'release', target: 'plus:0', why: STEP_NO_PURCHASE },
  },
  pack: {
    'shop-edges': { shop: 'drug', event: 'release', target: 'buy', why: BUY_NO_EFFECT },
    'shop-trade': { shop: 'drug', event: 'release', target: 'buy', why: BUY_NO_EFFECT },
  },
}

/** 同名只读一次 —— 下面每个格子都要把整条真值跑一遍。 */
const traceCache = new Map<string, ShopTrace>()
function traceOf(name: string): ShopTrace {
  let trace = traceCache.get(name)
  if (!trace) {
    trace = readShopTrace(name)
    traceCache.set(name, trace)
  }
  return trace
}

/**
 * 一条真值上**有哪几个字段组** —— 从真值第一行的列名现数，减去那三列非状态列。
 *
 * 这是分母：真值多一列（原版又多记了一样东西），这里立刻多一格，而那一格
 * 两张登记表里都没有 → 红。
 */
function groupsOf(trace: ShopTrace): readonly string[] {
  const first = trace.ticks[0]!
  return Object.keys(first)
    .filter((k) => !NON_STATE_COLUMNS.includes(k))
    .sort()
}

/** 把一条真值从头跑到尾，返回每一步的快照。**不做任何比对。** */
function runAll(name: string): Record<string, unknown>[] {
  const trace = traceOf(name)
  const world = replayShop(trace)
  const inputs = shopInputsOf(trace)
  return inputs.map((step) => {
    stepShop(world, step)
    return snapshotShop(world)
  })
}

const snapshotCache = new Map<string, Record<string, unknown>[]>()
function snapshotsOf(name: string): Record<string, unknown>[] {
  let snaps = snapshotCache.get(name)
  if (!snaps) {
    snaps = runAll(name)
    snapshotCache.set(name, snaps)
  }
  return snaps
}

/** 这一格**第一处**对不上的那一步；全对上时返回 `ticks.length`。 */
function firstDivergence(name: string, group: string): number {
  const trace = traceOf(name)
  const snaps = snapshotsOf(name)
  const at = trace.ticks.findIndex((tick, i) => {
    const got = snaps[i]![group]
    if (got === undefined) return true
    try {
      expect(got).toEqual(tick[group])
      return false
    } catch {
      return true
    }
  })
  return at === -1 ? trace.ticks.length : at
}

/** 这一格逐步全对上了吗。给"还欠着"那半边用 —— 它要的是**不对上**。 */
function cellMatches(name: string, group: string): boolean {
  return firstDivergence(name, group) === traceOf(name).ticks.length
}

describe('商店状态层对齐行为真值', () => {
  it('每一个（字段组 × 剧本）的格子要么已对齐、要么记着归谁 —— 没有第三种', () => {
    // 分母两头都从磁盘现数。一份都没有时 `traceNamesOf` 已经抛过了，这条
    // 是给"目录还在但空了"留的。
    expect(SHOP_TRACE_NAMES.length).toBeGreaterThan(0)

    // 每条真值的列名必须一致 —— 不一致说明导出器对两条剧本记的东西不一样，
    // 那时"这一格不存在"与"这一格没人登记"就分不开了。
    const groups = groupsOf(traceOf(SHOP_TRACE_NAMES[0]!))
    expect(groups.length).toBeGreaterThan(0)
    for (const name of SHOP_TRACE_NAMES) {
      expect(groupsOf(traceOf(name)), `${name} 的字段组与其他真值不一致`).toEqual(groups)
    }

    const unaccounted: string[] = []
    const both: string[] = []
    for (const group of groups) {
      for (const name of SHOP_TRACE_NAMES) {
        const aligned = (ALIGNED[group] ?? []).includes(name)
        const pending = name in (PENDING[group] ?? {})
        if (!aligned && !pending) unaccounted.push(`${group} × ${name}`)
        if (aligned && pending) both.push(`${group} × ${name}`)
      }
    }
    expect(
      unaccounted,
      '新的商店真值或新的字段组：要么在这里对齐它，要么写明归哪张票',
    ).toEqual([])
    // 同一格同时写进两边时，上面那条过得去 —— "已经对齐了"与"还欠着"就又
    // 长得一样了。
    expect(both, '同一个格子同时登记在 ALIGNED 与 PENDING 里').toEqual([])

    // 反方向：两张登记表里不许有磁盘上没有的组名或剧本名，否则表在骗人。
    for (const [group, names] of Object.entries(ALIGNED)) {
      expect(groups, `ALIGNED 里的 ${group} 不是真值的字段组`).toContain(group)
      for (const name of names) {
        expect(SHOP_TRACE_NAMES, `ALIGNED[${group}] 里的 ${name} 不在真值目录里`).toContain(name)
      }
    }
    for (const [group, byTrace] of Object.entries(PENDING)) {
      expect(groups, `PENDING 里的 ${group} 不是真值的字段组`).toContain(group)
      for (const [name, issue] of Object.entries(byTrace)) {
        expect(SHOP_TRACE_NAMES, `PENDING[${group}] 里的 ${name} 不在真值目录里`).toContain(name)
        // 票号是登记的一半：没有票号的"还欠着"等于"忘了"。
        expect(issue, `PENDING[${group}][${name}] 没写票号`).toMatch(/^xl-[\w.]+$/)
        // 每一格都要写明「前半截对到哪儿」。少一格的表现是那一格的前半截
        // 再也没人守 —— 而这一票的成果**全在前半截里**。
        expect(
          BLOCKED_AT[group]?.[name],
          `PENDING 里有 ${group} × ${name}，BLOCKED_AT 里却没有 —— ` +
            `那一格"前半截对到哪儿"就没人守了`,
        ).toBeTruthy()
      }
    }
  })

  it('每一条剧本都至少签下了一格 —— 否则那条剧本整条一个断言都不跑，还全绿', () => {
    // 分母是磁盘上的真值名单，所以新加一份真值而它一格都没签时这条就红 ——
    // 那正是「加了却没人回放」与「全都对上了」之间的差别。
    for (const name of SHOP_TRACE_NAMES) {
      const signed = Object.entries(ALIGNED).filter(([, names]) => names.includes(name))
      expect(
        signed.map(([group]) => group),
        `${name} 一格都没签 —— 它下面那批逐格用例一条都不会生成`,
      ).not.toEqual([])
    }
  })

  for (const name of SHOP_TRACE_NAMES) {
    for (const group of Object.keys(ALIGNED)) {
      if (!ALIGNED[group]!.includes(name)) continue
      it(`${name} · ${group}：逐步与真值相等`, () => {
        const trace = traceOf(name)
        expect(trace.tickCount).toBeGreaterThan(0)
        const snaps = snapshotsOf(name)
        for (const [i, tick] of trace.ticks.entries()) {
          // 带上 t：比对失败时要一眼看得出是第几步开始偏的。
          expect({ t: tick.t, [group]: snaps[i]![group] }).toEqual({
            t: tick.t,
            [group]: tick[group],
          })
        }
      })
    }
  }

  describe('「前半截已经对上了」的格子：卡住的那一步就是登记里写的那一步', () => {
    // ⚠️ `BLOCKED_AT` 空着的时候这个 describe 一条用例都不生成，而
    // **「一条都没生成」与「都过了」在测试报告里长得一样**（vitest 会为空 suite
    // 报错，那是它替我们兜的底，别指望它一直兜）。所以放一条明写当前读数的
    // 用例在这里：为空时它在，非空时它自己就没了。
    if (Object.keys(BLOCKED_AT).length === 0) {
      it('今天没有「只对到半截」的格子 —— 这是读数，不是这张表的形状', () => {
        expect(BLOCKED_AT).toEqual({})
      })
    }
    for (const [group, byTrace] of Object.entries(BLOCKED_AT)) {
      for (const [name, blocked] of Object.entries(byTrace)) {
        it(`${name} · ${group}：一路对到「${blocked.shop} 店上 ${blocked.event} ${blocked.target}」那一步`, () => {
          // 先核这一格确实还挂在 PENDING 上 —— 两张表说的必须是同一件事。
          expect(
            PENDING[group]?.[name],
            `BLOCKED_AT 里有 ${group} × ${name}，PENDING 里却没有`,
          ).toBeTruthy()

          // 卡住的那一步**从真值里认**，不写步号：步号会随剧本改动整体平移。
          const trace = traceOf(name)
          const want = trace.ticks.findIndex(
            (tick) =>
              tick['shop'] === blocked.shop &&
              tick.input.some(
                (e) => e.e === blocked.event && 'target' in e && e.target === blocked.target,
              ),
          )
          // ⚠️ 两件事分开断言：`findIndex` 的 -1（找不到）与命中第 0 步是两回事。
          expect(
            want,
            `${name} 里找不到「${blocked.shop} 店上 ${blocked.event} ${blocked.target}」这一步 ——` +
              ` 剧本改了，这条登记要跟着改`,
          ).not.toBe(-1)
          expect(
            want,
            `${name} 卡在第 0 步 —— 那等于前半截一格都没对上，这条登记就没有意义了`,
          ).toBeGreaterThan(0)

          // 正题：第一处分歧**恰好**是那一步。早一步 → 这一票自己做错了；
          // 晚一步或没有 → 已经全对上了，该挪进 ALIGNED。
          expect(firstDivergence(name, group), `${blocked.why}`).toBe(want)
        })
      }
    }
  })

  describe('反方向：登记成「还欠着」的格子必须真的还没对上', () => {
    // 同上：`PENDING` 空着时这个 describe 也是零用例。
    if (Object.keys(PENDING).length === 0) {
      it('今天没有「还欠着」的格子 —— 全部字段组 × 全部剧本都对齐了', () => {
        expect(PENDING).toEqual({})
      })
    }
    for (const [group, byTrace] of Object.entries(PENDING)) {
      for (const [name, issue] of Object.entries(byTrace)) {
        it(`${name} · ${group}（${issue}）还没对上`, () => {
          expect(
            cellMatches(name, group),
            `${name} 的 ${group} 已经逐步对上了，把它从 PENDING 挪进 ALIGNED —— ` +
              `留在 PENDING 里的话，"做完了"与"没人对"长得一样`,
          ).toBe(false)
        })
      }
    }
  })

  it('步数与 t 自洽 —— 一步就是一行，不多不少', () => {
    for (const name of SHOP_TRACE_NAMES) {
      const trace = traceOf(name)
      const world = replayShop(trace)
      const inputs = shopInputsOf(trace)
      for (const [i, tick] of trace.ticks.entries()) {
        expect(world.tick, `${name} 第 ${tick.t} 步`).toBe(tick.t)
        stepShop(world, inputs[i]!)
      }
      expect(world.tick).toBe(trace.tickCount)
    }
  })

  /**
   * 「不启动渲染」这句话自己也要跑一遍。注释里写着"这里没有 Pixi"和真的没有
   * 长得一模一样，而一旦有人顺手在这一层 import 了渲染器，这条缝就不再是
   * "纯状态"了 —— 它会开始需要 canvas，而失败的样子是一句 jsdom 的报错，
   * 跟"实现错了"分不开。
   */
  it('状态层整个目录都不碰渲染', () => {
    // **分母从磁盘现扫**：写死一份文件名单的话，明天新加的
    // `shop/xxx.ts` 里 import 一个 Pixi 进来，这条静默放过（dispatch.md 纪律 3）。
    // 只扫 `shop/` 这一层，不进 `shop/render/` —— 那一层的活就是碰渲染。
    const files = readdirSync(repoPath('web/src/shop'), { withFileTypes: true })
      .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
      .map((e) => e.name)
      .sort()
    // 空转要响：目录名写错了与"这一层干净"长得一样。
    expect(files.length).toBeGreaterThan(5)
    expect(files).toContain('step.ts')
    const banned = /from '([^']*(pixi|react|\/render\/|render\/)[^']*)'/
    for (const file of files) {
      const source = readFileSync(repoPath('web/src/shop', file), 'utf8')
      expect(banned.test(source), `${file} 里 import 了渲染层`).toBe(false)
    }
  })
})
