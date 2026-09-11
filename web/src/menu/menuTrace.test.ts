import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { replayMenuTask } from './replay'
import { snapshotMenu } from './snapshot'
import { stepMenu } from './step'
import { MENU_TRACE_NAMES, readMenuTrace, replayMenu } from './trace'
import type { MenuTrace } from './trace'

/**
 * 菜单状态层**逐字段**对齐行为真值。
 *
 * 这是 M3 唯一的新判据，也是它存在的理由：写实现和写期望值的是同一个 agent、
 * 在同一个上下文窗口里，手写期望的测试会绿、而且是错的。这里的期望值一个都
 * 不是手写的 —— 全部来自 `tools/traces/out/menu-*.trace.json`，由原版 Java
 * 程序自己跑出来（`docs/trace-format.md` §菜单剧本与菜单真值）。
 *
 * **不启动渲染**：整个文件没有 canvas、没有 Pixi、没有 React、没有 DOM ——
 * 而这句话自己也是一条判据，见最后那条「这个文件不碰渲染」。
 *
 * 喂给状态层的只有两样，都不是状态：
 *
 * - 剧本回显（`setup.party` / `setup.fullHeal` / `setup.drugs`）——"这是哪一局"；
 * - 每一步的 `input`——那一步实际喂给原版的鼠标事件，或者那一下时钟脉冲。
 *
 * ## 登记按**字段组**，不按整条剧本
 *
 * 战斗那一份（`battle/battleTrace.test.ts`）的登记单位是**整条剧本**，因为
 * 那一层是一张票做完的。菜单不是：骨架、装备页、物品页、奇术页、天书页是
 * 五张票，而两条真值每一条都横跨全部五张。按整条剧本登记的话，骨架这一票
 * **一条会红的判据都没有** —— 两条真值都得挂在"还欠着"里，一直挂到最后一页
 * 做完。所以这里的登记是**（字段组 × 剧本）**的格子。
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
 * 这是**登记**不是分母：哪几列不算状态要人来读 `MenuDriver.snapshotState`
 * 才答得出。分母（一共有哪几列、有哪几条剧本）在下面全部从磁盘现数。
 */
const NON_STATE_COLUMNS: readonly string[] = ['t', 'ip', 'input']

/**
 * **已经对齐的格子 —— 手写登记。**
 *
 * ⚠️ 这张表**必须手写**。写成"从快照现有的键推"（`Object.keys(snapshotMenu(...))`）
 * 时，下面那条对撞用例的每一段都变成恒真：未登记的格子必空、`PENDING` 那个
 * 循环零轮、交集必空 —— 于是"真值目录里冒出一份没人回放的剧本"会被**自动
 * 算作已对齐**，而那正是这一整套对撞要拦的东西。这是 `xl-rh9.8` 真栽过的坑
 * （`docs/agents/dispatch.md` 纪律 3 的那条 ⚠️）。
 *
 * 这不违反纪律 3「别把『目前只有 X』写死」：那一条禁的是把**分母**写死。
 * 这里分母仍然是磁盘上的 `MENU_TRACE_NAMES` 与真值自己的列名，写死的是
 * "谁已经有人对齐了"这份需要人签字的登记。
 */
const ALIGNED: Readonly<Record<string, readonly string[]>> = {
  // **九组 × 五条剧本，45 个格子全部对齐了**（M3 的五张页票做完之后）。
  //
  // ⚠️ 这份「全满」是**跑出来的，不是宣布的**：主干合并 xl-6lo.9 时把 45 格
  // 全填进来跑了一遍，逐格用例一条都没红。别把「全满」读成「这张表没用了」——
  // 它现在守的是两件事：
  //   1. 新真值进来时先红一次（xl-6lo.7 落三条新剧本那次就红了 27 格）；
  //   2. 谁把某一组改回去时那一格立刻红。
  // 下面 PENDING 与 BLOCKED_AT 都空着，那是**当前的读数**，不是这张表的形状。
  music: ['menu-equip', 'menu-magic', 'menu-func', 'menu-hero', 'menu-scroll', 'menu-task'],
  panel: ['menu-equip', 'menu-magic', 'menu-func', 'menu-hero', 'menu-scroll', 'menu-task'],
  hero: ['menu-equip', 'menu-magic', 'menu-func', 'menu-hero', 'menu-scroll', 'menu-task'],
  // `heroes` 是 xl-6lo.9 与 .10 合起来才齐的：装备页的弃用/换装归 .9，
  // 物品页第 22 步喝药那一下 700→1000 归 .10 —— 两张票各自都对不齐这一组。
  heroes: ['menu-equip', 'menu-magic', 'menu-func', 'menu-hero', 'menu-scroll', 'menu-task'],
  // 装备页那 13 个字段（六个槽位 / 选中 / 属性差值 / 两条拒绝提示 /
  // 可用可弃两个绘制旗标 / 背包列表），xl-6lo.9。
  equip: ['menu-equip', 'menu-magic', 'menu-func', 'menu-hero', 'menu-scroll', 'menu-task'],
  // xl-6lo.10。⚠️ 五条里只有 `menu-equip` 那一格真的会动（第 21 步选中、
  // 第 22 步 2→1）；其余四条 `setup.drugs` 是空的，守的是"别凭空冒出清单来"。
  drug: ['menu-equip', 'menu-magic', 'menu-func', 'menu-hero', 'menu-scroll', 'menu-task'],
  // xl-6lo.11。`menu-equip` 也签得下 —— 它第 24 步切进奇术页那一次按下同样会
  // 把动画清空、把按钮按 skillNumber 关掉。
  magic: ['menu-equip', 'menu-magic', 'menu-func', 'menu-hero', 'menu-scroll', 'menu-task'],
  // xl-6lo.12。⚠️ `menu-equip` / `menu-magic` 两条里 `func.drawn` 从头到尾没变过
  // （没点过天书页），它们守的是"开局那六颗对得上、没被别处偷偷改掉"。
  // **子菜单展开收起的逐次相等靠 `menu-func`** —— 那条剧本是 xl-6lo.7 补的。
  mouse: ['menu-equip', 'menu-magic', 'menu-func', 'menu-hero', 'menu-scroll', 'menu-task'],
  func: ['menu-equip', 'menu-magic', 'menu-func', 'menu-hero', 'menu-scroll', 'menu-task'],
  // xl-03x.10。`Reader.task` —— 不是菜单世界的状态，快照里那一格来自 `replayMenuTask`
  // （见 `runAll`）。没给 `setup.scene` 的剧本恒为 null；非 null 那一支靠 `menu-task`。它画成什么字
  // 另有逐步判据：`render/taskTitle.test.ts`。
  task: ['menu-equip', 'menu-magic', 'menu-func', 'menu-hero', 'menu-scroll', 'menu-task'],
}

/**
 * **还欠着的格子 —— 手写登记，每一格写明归哪张票。**
 *
 * 这两张表是**对撞**的：真值目录里冒出一份两边都没有的剧本，或者真值多出
 * 一列没人登记，下面第一条用例立刻红。
 */
const PENDING: Readonly<Record<string, Readonly<Record<string, string>>>> = {
}

/**
 * **`PENDING` 里那些「前半截已经对上了」的格子 —— 手写登记，写明卡在哪。**
 *
 * 光有 `PENDING` 的话，"第 8 步就开始错"与"一直对到第 22 步、卡在别人那张票上"
 * 长得一模一样：两者都只是"还没对上"。而 xl-6lo.9 的验收标准恰恰落在那中间
 * 一段（弃用后属性跌回去、穿上盔甲后气血上限 700→1050），没有这张表就一条
 * 会红的判据都没有。
 *
 * 卡住的那一步**不写步号**，写成一句真值自己认得出的话（"物品页上按下「使用」
 * 的第一步"）—— 步号会随着剧本改动整体平移，而那种失效是安静的。
 */
interface BlockedAt {
  /** 那一步显示着哪一页。 */
  readonly panel: string
  /** 那一步的输入事件与它点的东西。 */
  readonly event: string
  readonly target: string
  /** 卡住的原因，一句话。 */
  readonly why: string
}

const BLOCKED_AT: Readonly<Record<string, Readonly<Record<string, BlockedAt>>>> = {
  // 空的。xl-6lo.9 落地时这里有两条（heroes × menu-equip、music × menu-equip，
  // 都卡在物品页喝药那一下），而 xl-6lo.10 恰好把那一步做了 —— 两张票各自都
  // 对不齐这两组，合到一起就齐了。主干合并时把 45 个格子全填进 ALIGNED 跑了
  // 一遍：逐格用例一条都没红，红的只有「BLOCKED_AT 里有、PENDING 里却没有」
  // 这条一致性检查，于是把这两条撤掉。
  //
  // ⚠️ 撤掉不等于这张表没用了：下一条新真值进来时，某一组多半又会只对到半截。
}

/** 同名只读一次 —— 下面每个格子都要把整条真值跑一遍。 */
const traceCache = new Map<string, MenuTrace>()
function traceOf(name: string): MenuTrace {
  let trace = traceCache.get(name)
  if (!trace) {
    trace = readMenuTrace(name)
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
function groupsOf(trace: MenuTrace): readonly string[] {
  const first = trace.ticks[0]!
  return Object.keys(first)
    .filter((k) => !NON_STATE_COLUMNS.includes(k))
    .sort()
}

/** 把一条真值从头跑到尾，返回每一步的快照。**不做任何比对。** */
function runAll(name: string): Record<string, unknown>[] {
  const trace = traceOf(name)
  const world = replayMenu(trace)
  // `task` 不在菜单世界里（原版画的时候现读 `Reader.task`），照剧本回显推，与取图页同一条路。
  const task = replayMenuTask(trace.script.setup)
  return trace.ticks.map((tick) => {
    stepMenu(world, tick.input)
    return { ...snapshotMenu(world), task }
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

describe('菜单状态层对齐行为真值', () => {
  it('每一个（字段组 × 剧本）的格子要么已对齐、要么记着归谁 —— 没有第三种', () => {
    // 分母两头都从磁盘现数。一份都没有时 `traceNamesOf` 已经抛过了，这条
    // 是给"目录还在但空了"留的。
    expect(MENU_TRACE_NAMES.length).toBeGreaterThan(0)

    // 每条真值的列名必须一致 —— 不一致说明导出器对两条剧本记的东西不一样，
    // 那时"这一格不存在"与"这一格没人登记"就分不开了。
    const groups = groupsOf(traceOf(MENU_TRACE_NAMES[0]!))
    expect(groups.length).toBeGreaterThan(0)
    for (const name of MENU_TRACE_NAMES) {
      expect(groupsOf(traceOf(name)), `${name} 的字段组与其他真值不一致`).toEqual(groups)
    }

    const unaccounted: string[] = []
    const both: string[] = []
    for (const group of groups) {
      for (const name of MENU_TRACE_NAMES) {
        const aligned = (ALIGNED[group] ?? []).includes(name)
        const pending = name in (PENDING[group] ?? {})
        if (!aligned && !pending) unaccounted.push(`${group} × ${name}`)
        if (aligned && pending) both.push(`${group} × ${name}`)
      }
    }
    expect(
      unaccounted,
      '新的菜单真值或新的字段组：要么在这里对齐它，要么写明归哪张票',
    ).toEqual([])
    // 同一格同时写进两边时，上面那条过得去 —— "已经对齐了"与"还欠着"就又
    // 长得一样了。
    expect(both, '同一个格子同时登记在 ALIGNED 与 PENDING 里').toEqual([])

    // 反方向：两张登记表里不许有磁盘上没有的组名或剧本名，否则表在骗人。
    for (const [group, names] of Object.entries(ALIGNED)) {
      expect(groups, `ALIGNED 里的 ${group} 不是真值的字段组`).toContain(group)
      for (const name of names) {
        expect(MENU_TRACE_NAMES, `ALIGNED[${group}] 里的 ${name} 不在真值目录里`).toContain(name)
      }
    }
    for (const [group, byTrace] of Object.entries(PENDING)) {
      expect(groups, `PENDING 里的 ${group} 不是真值的字段组`).toContain(group)
      for (const [name, issue] of Object.entries(byTrace)) {
        expect(MENU_TRACE_NAMES, `PENDING[${group}] 里的 ${name} 不在真值目录里`).toContain(name)
        // 票号是登记的一半：没有票号的"还欠着"等于"忘了"。
        expect(issue, `PENDING[${group}][${name}] 没写票号`).toMatch(/^xl-[\w.]+$/)
      }
    }
  })

  it('每一条剧本都至少签下了一格 —— 否则那条剧本整条一个断言都不跑，还全绿', () => {
    // ⚠️ 这一条曾经写成 `Object.values(ALIGNED).reduce(...) > 0` —— 数的是
    // 同一个文件里 130 行以上那个字面量，**按构造成立**（/code-review 提的）。
    // 改成按**剧本**分：分母是磁盘上的真值名单，所以新加一份真值而它一格都
    // 没签时这条就红 —— 那正是「加了却没人回放」与「全都对上了」之间的差别。
    for (const name of MENU_TRACE_NAMES) {
      const signed = Object.entries(ALIGNED).filter(([, names]) => names.includes(name))
      expect(
        signed.map(([group]) => group),
        `${name} 一格都没签 —— 它下面那批逐格用例一条都不会生成`,
      ).not.toEqual([])
    }
  })

  for (const name of MENU_TRACE_NAMES) {
    for (const group of Object.keys(ALIGNED)) {
      if (!ALIGNED[group]!.includes(name)) continue
      it(`${name} · ${group}：逐步与真值相等`, () => {
        const trace = traceOf(name)
        expect(trace.tickCount).toBeGreaterThan(0)
        const snaps = snapshotsOf(name)
        for (const [i, tick] of trace.ticks.entries()) {
          // 带上 t：比对失败时要一眼看得出是第几步开始偏的。
          expect({ t: tick.t, [group]: snaps[i]![group] }).toEqual({ t: tick.t, [group]: tick[group] })
        }
      })
    }
  }

  describe('「前半截已经对上了」的格子：卡住的那一步就是登记里写的那一步', () => {
    // ⚠️ `BLOCKED_AT` 空着的时候这个 describe 一条用例都不生成，而
    // **「一条都没生成」与「都过了」在测试报告里长得一样**（vitest 会为空 suite
    // 报错，那是它替我们兜的底，别指望它一直兜）。所以放一条明写当前读数的
    // 用例在这里：今天是空的，非空时它自己就没了。
    if (Object.keys(BLOCKED_AT).length === 0) {
      it('今天没有「只对到半截」的格子 —— 这是读数，不是这张表的形状', () => {
        expect(BLOCKED_AT).toEqual({})
      })
    }
    for (const [group, byTrace] of Object.entries(BLOCKED_AT)) {
      for (const [name, blocked] of Object.entries(byTrace)) {
        it(`${name} · ${group}：一路对到「${blocked.panel} 上 ${blocked.event} ${blocked.target}」那一步`, () => {
          // 先核这一格确实还挂在 PENDING 上 —— 两张表说的必须是同一件事。
          expect(
            PENDING[group]?.[name],
            `BLOCKED_AT 里有 ${group} × ${name}，PENDING 里却没有`,
          ).toBeTruthy()

          // 卡住的那一步**从真值里认**，不写步号：步号会随剧本改动整体平移。
          const trace = traceOf(name)
          const want = trace.ticks.findIndex(
            (tick) =>
              tick['panel'] === blocked.panel &&
              tick.input.some(
                (e) => e.e === blocked.event && 'target' in e && e.target === blocked.target,
              ),
          )
          // ⚠️ 两件事分开断言：`findIndex` 的 -1（找不到）与命中第 0 步是两回事，
          // 并成一档 `toBeGreaterThan(0)` 的话，报错文案只说得出其中一件
          // （/code-review 的 Standards 轴提的）。
          expect(
            want,
            `${name} 里找不到「${blocked.panel} 上 ${blocked.event} ${blocked.target}」这一步 ——` +
              ` 剧本改了，这条登记要跟着改`,
          ).not.toBe(-1)
          expect(
            want,
            `${name} 卡在第 0 步 —— 那等于前半截一格都没对上，这条登记就没有意义了`,
          ).toBeGreaterThan(0)

          // 正题：第一处分歧**恰好**是那一步。早一步 → 这一票自己做错了；
          // 晚一步或没有 → 已经全对上了，该挪进 ALIGNED。
          expect(
            firstDivergence(name, group),
            `${blocked.why}`,
          ).toBe(want)
        })
      }
    }
  })

  describe('反方向：登记成「还欠着」的格子必须真的还没对上', () => {
    // 同上：`PENDING` 空着时这个 describe 也是零用例。
    if (Object.keys(PENDING).length === 0) {
      it('今天没有「还欠着」的格子 —— 九组 × 五条剧本全对齐了', () => {
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
    for (const name of MENU_TRACE_NAMES) {
      const trace = traceOf(name)
      const world = replayMenu(trace)
      for (const tick of trace.ticks) {
        expect(world.tick, `${name} 第 ${tick.t} 步`).toBe(tick.t)
        stepMenu(world, tick.input)
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
    // `menu/xxx.ts` 里 import 一个 Pixi 进来，这条静默放过（dispatch.md 纪律 3）。
    // 只扫 `menu/` 这一层，不进 `menu/render/` —— 那一层的活就是碰渲染。
    const files = readdirSync(repoPath('web/src/menu'), { withFileTypes: true })
      .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
      .map((e) => e.name)
      .sort()
    // 空转要响：目录名写错了与"这一层干净"长得一样。
    expect(files.length).toBeGreaterThan(5)
    expect(files).toContain('step.ts')
    const banned = /from '([^']*(pixi|react|\/render\/|render\/)[^']*)'/
    for (const file of files) {
      const source = readFileSync(repoPath('web/src/menu', file), 'utf8')
      expect(banned.test(source), `${file} 里 import 了渲染层`).toBe(false)
    }
  })
})
