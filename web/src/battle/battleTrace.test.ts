import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../compare/png'
import { repoPath } from '../test/repoPath'
import { snapshotBattle } from './snapshot'
import { stepBattle } from './step'
import { replayBattle } from './replay'
import { BATTLE_TRACE_NAMES, readBattleTrace } from './trace'
import type { BattleTrace } from './trace'
import type { BattleWorld, ExitPanel } from './types'

/**
 * 战斗状态层逐字段对齐行为真值。
 *
 * 这是这一层唯一有分量的判据，也是它存在的理由：写实现和写期望值的是同一个
 * agent、在同一个上下文窗口里，手写期望的测试会绿、而且是错的。这里的期望值
 * 一个都不是手写的 —— 全部来自 `tools/traces/out/battle-*.trace.json`，
 * 由原版 Java 程序自己跑出来（见 `docs/trace-format.md` §战斗剧本与战斗 trace）。
 *
 * **不启动渲染**：整个文件没有 canvas、没有 Pixi、没有 React、没有 DOM。
 *
 * 喂给状态层的只有两样，都不是状态：
 *
 * - 剧本回显（背景 / 出战名单 / 等级 / 三个槽位 / 种子）——"打的是哪一场"；
 * - 每一拍的 `input`——那一拍实际喂给原版的鼠标事件。
 *
 * 怪物出场图的**像素尺寸**从 `image/怪物/<名字>/1.png` 的 IHDR 里读，
 * 不从真值里读：`EnemySlector` 量的就是那张图，而从真值里读框、再拿它去比框，
 * 是一条恒真的检查。
 *
 * ## 底下几条"这一场看不看得见"的判据是怎么写的
 *
 * 有几件事（负血、第三槽的框高借用第一只、两条打输出口）在**某些**场次里
 * 观测不到 —— 写对了和写错了推出来的数完全相同。所以下面不写"哪一场归哪条"
 * 的名单，而是**从真值现算**哪几场观测得到，再要求那个数至少是 1。名单会随
 * 真值目录漂，算出来的不会；而"缺陷不存在"与"缺陷看不见"长得一模一样，正是
 * 这几条 `toBeGreaterThan(0)` 要分开的东西。
 */

/**
 * 已经对齐的那几份 —— 每加一份都要在这里**显式登记**。
 *
 * ⚠️ 这张表**必须手写**。写成 `= BATTLE_TRACE_NAMES`（跟着磁盘走）时，下面
 * 第一条用例的四段断言全部变成恒真：`unaccounted` 必空、包含关系必真、
 * `PENDING` 那个循环零轮、交集必空 —— 于是"真值目录里冒出一份没人回放的
 * 剧本"会被**自动算作已对齐**，而那正是这一整套对撞要拦的东西。
 * （dispatch.md §「注释里写『这里会红』，就得像判据一样被跑一遍」。）
 *
 * 这不违反 dispatch.md 纪律 3「别把『目前只有 X』写死」—— 那一条禁的是把
 * **数量 / 分母**写死（`toHaveLength(5)`、`SCENES = […]` 当分母用）。这里
 * 分母仍然是磁盘上的 `BATTLE_TRACE_NAMES`，写死的是"谁已经有人回放了"这份
 * 登记，而登记正是要人来签的。
 */
const IMPLEMENTED: readonly string[] = [
  'battle-min',
  'battle-em3-box',
  'battle-defeat-scene',
  'battle-defeat-start',
  'battle-defeat-slot2',
  'battle-menus',
  // xl-rh9.14：剩下那些技能与秘术。
  'battle-zhang-skills',
  'battle-yu-skills',
  'battle-lu-skills',
  'battle-mishu-zhang',
  'battle-mishu-yu',
  'battle-mishu-lu',
  'battle-victory',
  // xl-3hn：主线上那几场剧情战，原样照搬 Fight 那一行。
  'battle-script3',
  'battle-script6',
  'battle-script12',
  'battle-script15',
  'battle-script17',
  'battle-script25',
  'battle-script31',
  'battle-script38-2',
  'battle-script38-3',
  'battle-script39',
  // xl-byy：战斗里真的用药（剧本的 `drugs` 预置存货）。
  'battle-drugs',
]

/**
 * 还没对齐的那几份，各自写明归哪张票。
 *
 * 这两张表是**对撞**的：真值目录里冒出一份两边都没有的剧本，下面第一条用例
 * 立刻红。没有这一条的话，新剧本"加了却没人回放"和"全都对上了"长得一样。
 *
 * xl-rh9.8 之后这张表是**空的** —— 五份真值全部逐字段对上了。它留在这里
 * 是因为下一份新真值多半又要先挂着。
 */
const PENDING: Readonly<Record<string, string>> = {}

/**
 * 读一份战斗真值，**同名只读一次**。下面几条判据要先"算哪几场观测得到"、
 * 再在那几场上断言，同一个名字会被读上三四遍；真值最大的一份有 744 步。
 */
const traceCache = new Map<string, BattleTrace>()
function traceOf(name: string): BattleTrace {
  let trace = traceCache.get(name)
  if (!trace) {
    trace = readBattleTrace(name)
    traceCache.set(name, trace)
  }
  return trace
}

/** 怪物出场图（`Images.get(0)`）的像素尺寸。 */
function spriteSize(name: string): { width: number; height: number } {
  const png = decodePng(readFileSync(repoPath('image/怪物', name, '1.png')))
  return { width: png.width, height: png.height }
}

/** 把一份真值从头跑到尾，返回真值与推出来的世界。**不做任何比对**。 */
function runToEnd(name: string): { trace: BattleTrace; world: BattleWorld } {
  const trace = traceOf(name)
  const world = replayBattle(trace, spriteSize)
  for (const tick of trace.ticks) stepBattle(world, tick.input)
  return { trace, world }
}

/** 真值末步的三个槽位（空槽位是 `null`）。 */
function lastEnemies(trace: BattleTrace) {
  return trace.ticks[trace.ticks.length - 1]!.enemies
}

/** 第 0 步里第 `slot` 槽（1/2/3）站着的怪；空槽位返回 `null`。 */
function enemyAt(trace: BattleTrace, slot: number) {
  return trace.ticks[0]!.enemies[slot - 1] ?? null
}

/** 剧本里那条 `awaitExit` 要的出口面板；没有这条指令就是 `null`。 */
function scriptedExit(trace: BattleTrace): ExitPanel | null {
  const step = trace.script.steps.find((s) => s.op === 'awaitExit')
  if (!step) return null
  if (step.panel === undefined) {
    throw new Error(`${trace.script.name} 的 awaitExit 没写 panel —— 那条指令就没有断言了`)
  }
  return step.panel
}

describe('战斗状态层对齐行为真值', () => {
  it('每一份战斗真值要么已经对齐、要么记着归谁 —— 没有第三种', () => {
    // 分母是磁盘上现有的那几份（BATTLE_TRACE_NAMES 一份都没有时会抛）。
    expect(BATTLE_TRACE_NAMES.length).toBeGreaterThan(0)
    const unaccounted = BATTLE_TRACE_NAMES.filter(
      (name) => !IMPLEMENTED.includes(name) && !(name in PENDING),
    )
    expect(unaccounted, '新的战斗真值：要么在这里对齐它，要么写明归哪张票').toEqual([])
    // 反方向：登记成"待办"的那几份必须真的还在磁盘上，否则这张表在骗人。
    for (const name of Object.keys(PENDING)) {
      expect(BATTLE_TRACE_NAMES, `PENDING 里的 ${name} 已经不在真值目录里了`).toContain(name)
    }
    for (const name of IMPLEMENTED) {
      expect(BATTLE_TRACE_NAMES, `已对齐的 ${name} 不在真值目录里`).toContain(name)
    }
    // 两张表**不许有交集**：同一份剧本同时写进两边时，上面那三条全都过得去
    // —— 「已经对齐了」与「还欠着」就又长得一样了。
    expect(
      IMPLEMENTED.filter((name) => name in PENDING),
      '同一份真值同时登记在 IMPLEMENTED 与 PENDING 里',
    ).toEqual([])
  })

  for (const name of IMPLEMENTED) {
    it(`${name}：逐步逐字段与真值相等`, () => {
      const trace = traceOf(name)
      expect(trace.tickCount).toBeGreaterThan(0)

      const world = replayBattle(trace, spriteSize)
      for (const tick of trace.ticks) {
        stepBattle(world, tick.input)
        const { t, vt, ip, input, ...expected } = tick
        void vt
        void ip
        void input
        // 带上 t：比对失败时要一眼看得出是第几步开始偏的。
        expect({ t, ...snapshotBattle(world) }).toEqual({ t, ...expected })
      }
    })

    it(`${name}：虚拟时间与步数自洽`, () => {
      const trace = traceOf(name)
      const world = replayBattle(trace, spriteSize)
      for (const tick of trace.ticks) {
        expect(world.tick).toBe(tick.t)
        expect(tick.vt).toBe(tick.t * trace.script.tickMs)
        stepBattle(world, tick.input)
      }
      expect(world.tick).toBe(trace.tickCount)
    })
  }

  describe('xl-1dv.9：Enemy.hp 不夹到 0，末步会留下负血', () => {
    /** 末步真的有负血的那几场 —— 从真值现算，不写名单。 */
    const observable = IMPLEMENTED.filter((name) =>
      lastEnemies(traceOf(name)).some((e) => e !== null && e.hp < 0),
    )

    it('至少有一份真值末步留着负血 —— 否则这条缺陷又观测不到了', () => {
      expect(
        observable.length,
        '五份战斗真值末步一格负血都没有 —— Enemy.hp 不夹到 0 这件事没有一处' +
          '观测得到，写对了和"夹到 0 了"推出来的数完全相同。',
      ).toBeGreaterThan(0)
    })

    for (const name of observable) {
      it(`${name}：推出来的末步血量与真值相等，且真的是负的`, () => {
        const { trace, world } = runToEnd(name)
        const hp = snapshotBattle(world).enemies.map((e) => e?.hp ?? null)
        expect(hp).toEqual(lastEnemies(trace).map((e) => e?.hp ?? null))
        expect(hp.filter((v) => v !== null && v < 0).length).toBeGreaterThan(0)
      })
    }
  })

  describe('xl-1dv.8：第三槽的命中框，高借用的是第一只怪的图高', () => {
    /**
     * 观测得到的那几场：第 1、3 槽都站着人，而两张图**不一样高**。
     * 一样高时（`battle-min` 的三只怪都是 172）`height1` 与 `height3` 相等，
     * 抄错了和抄对了推出来的框完全相同。
     */
    const observable = IMPLEMENTED.filter((name) => {
      const trace = traceOf(name)
      const em1 = enemyAt(trace, 1)
      const em3 = enemyAt(trace, 3)
      if (!em1 || !em3) return false
      return spriteSize(em1.name).height !== spriteSize(em3.name).height
    })

    it('至少有一份真值里第一只与第三只不一样高 —— 否则这条缺陷又观测不到了', () => {
      expect(
        observable.length,
        '五份战斗真值里 em1 与 em3 的图高全都一样 —— `snapshot.ts` 的 boxOf 用 ' +
          'height1 还是 height3 推出来的数完全相同，这条缺陷没有一处观测得到。',
      ).toBeGreaterThan(0)
    })

    for (const name of observable) {
      it(`${name}：第三槽框高等于第一只的图高，且不等于它自己的`, () => {
        const trace = traceOf(name)
        const em1 = enemyAt(trace, 1)!
        const em3 = enemyAt(trace, 3)!
        const h1 = spriteSize(em1.name).height
        const h3 = spriteSize(em3.name).height
        const world = replayBattle(trace, spriteSize)
        stepBattle(world, trace.ticks[0]!.input)
        const box = snapshotBattle(world).enemies[2]!.box
        // 正方向：这一层推出来的框高就是**别人的**高。
        expect(box[3], `${name} 第 3 槽的框高`).toBe(h1)
        // 反方向：它确实不是自己的高 —— 不然上面那条是恒真的。
        expect(box[3], `${name} 第 3 槽的框高不该等于它自己的图高`).not.toBe(h3)
        // 宽仍然是各量各的（这条错位只在高上）。
        expect(box[2], `${name} 第 3 槽的框宽`).toBe(spriteSize(em3.name).width)
      })
    }
  })

  describe('战斗状态（xl-rh9.11）', () => {
    /** 真值里**真的挂上过**战斗状态的那几场 —— 从真值现算，不写名单。 */
    const withState = IMPLEMENTED.filter((name) =>
      traceOf(name).ticks.some(
        (t) =>
          t.heroes.some((h) => h.state.usable) ||
          t.enemies.some((e) => e !== null && e.state.usable),
      ),
    )

    it('至少有一份真值挂上过战斗状态 —— 否则那两层的坐标与 type 又没人核了', () => {
      expect(
        withState.length,
        '没有一份战斗真值挂上过战斗状态 —— `setBattleState` / `heroApplyState` / ' +
          '`enemyApplyState` 写对了和写错了推出来的东西完全相同。',
      ).toBeGreaterThan(0)
    })

    it('敌我两侧各有一份真值挂上过 —— 只盖一侧时另一侧的坐标来源写反了看不出来', () => {
      // 我方的坐标是 `showX/showY`，怪物的是 `x/y`，两者取值不同（文敏挂在
      // (800,150) 而她的 x/y 是 (750,150)）。只盖住一侧的话，把两边都写成
      // `x/y` 推出来的结果在那一侧完全正确。
      const heroSide = withState.filter((n) =>
        traceOf(n).ticks.some((t) => t.heroes.some((h) => h.state.usable)),
      )
      const enemySide = withState.filter((n) =>
        traceOf(n).ticks.some((t) => t.enemies.some((e) => e !== null && e.state.usable)),
      )
      expect(heroSide.length, '没有一份真值给我方挂上过战斗状态').toBeGreaterThan(0)
      expect(enemySide.length, '没有一份真值给怪物挂上过战斗状态').toBeGreaterThan(0)
    })

    /** 某个还活着的我方单位，`state.usable` 从 true 变回 false 的那些拍。 */
    function clearedTicks(name: string): number[] {
      const ticks = traceOf(name).ticks
      const out: number[] = []
      for (let i = 1; i < ticks.length; i++) {
        const prev = ticks[i - 1]!
        if (
          ticks[i]!.heroes.some((h, k) => prev.heroes[k]!.state.usable && !h.state.usable && !h.dead)
        ) {
          out.push(i)
        }
      }
      return out
    }

    it('退回那一段（returnFromState）真的被调用过 —— 只盖住"挂上"时它写反了看不出来', () => {
      // 挂上（`checkState`）与退回（`returnFromState`）是严格互逆的两段。
      // 只盖住"挂上"的话，把退回那一段整个写错（甚至写成再加一次）推出来的
      // 过程一模一样 —— 因为它一次都没被调用。
      // `battle-menus` 里文敏的敏捷提升被退回时 speed 从 11 掉回 10，逐字段
      // 比对盖得住那一拍。
      const cleared = withState.filter((name) => clearedTicks(name).length > 0)
      expect(
        cleared.length,
        '没有一份真值里的战斗状态被退回过 —— returnFromState 一次都没被调用，' +
          '写反了和写对了推出来的东西完全相同。',
      ).toBeGreaterThan(0)
    })

    /**
     * 状态被退回有**两条路**，两条都要有真值走到：
     *
     * 1. **打赢那一刻**统一清（`Check.checkEnemyDead` 里那个
     *    `for(Hero hero:bp.heroes){ if(isUsable){ returnFromState(); clear(); } }`）；
     * 2. **回合数走完**（`BattleState.check()` 里 `roundNum<=0` 那一支）。
     *
     * `battle-menus` 走的是第 1 条：文敏那个 2 回合的敏捷提升在打赢那一拍
     * （t=460）被清掉，speed 11→10。第 2 条 xl-rh9.11 那会儿一次都没走到（登记
     * 在案：把 `clearState(s)` 整个删掉，逐字段比对全绿），**xl-rh9.14 之后
     * 走得到了** —— `battle-zhang-skills` 里武力上升那 2 回合在胜负未分时到期。
     * 于是这条登记换成了正面比对：两条路各自至少有一份真值。
     */
    it('两条清除路径各有真值走到 —— 打赢时统一清，与回合数走完', () => {
      const midBattle: string[] = []
      const atDecided: string[] = []
      for (const name of withState) {
        const ticks = traceOf(name).ticks
        for (const i of clearedTicks(name)) {
          const where = `${name}@${ticks[i]!.t}`
          if (ticks[i]!.outcome === 'undecided') midBattle.push(where)
          else atDecided.push(where)
        }
      }
      expect(
        midBattle.length,
        '没有一份真值在胜负未分时清掉战斗状态 —— `BattleState.check()` 里 roundNum ' +
          '用完那一支又没人走了，把 `clearState(s)` 整个删掉也不会红。',
      ).toBeGreaterThan(0)
      expect(
        atDecided.length,
        '没有一份真值在分出胜负那一刻清掉战斗状态 —— `Check.checkEnemyDead` 里' +
          '那个统一清的 for 又没人走了。',
      ).toBeGreaterThan(0)
    })

    /**
     * 怪物身上那几个加成的**数值**要真的进过伤害公式。
     *
     * xl-rh9.11 那会儿进不去：`battle-menus` 里挂上 type 8 的那一击**同时把那只
     * 怪打死了**（300 → −26），此后它再没挨过打 —— 把 `e.defense -= 40` 改成
     * `-= 0`，逐字段比对全绿。xl-rh9.14 的几份真值里怪物挨了状态之后还活着并且
     * 继续挨打，所以这条登记换成了正面比对。
     */
    it('挂了状态之后还活着并且又挨了打的怪，至少有一只', () => {
      const survivors: string[] = []
      for (const name of withState) {
        const ticks = traceOf(name).ticks
        for (let slot = 0; slot < 3; slot++) {
          const statedAt = ticks.findIndex((t) => t.enemies[slot]?.state.usable === true)
          if (statedAt < 0) continue
          const hpThen = ticks[statedAt]!.enemies[slot]!.hp
          const hpEnd = ticks[ticks.length - 1]!.enemies[slot]!.hp
          if (hpEnd < hpThen) survivors.push(`${name}#${slot + 1}`)
        }
      }
      expect(
        survivors.length,
        '没有一只怪在挂上战斗状态之后又挨过打 —— 那几个加成（speed ±1 / hurt ±40 / ' +
          'skillHurt ±30 / defense ±40）一个都没进过伤害公式，抄错了不会红。',
      ).toBeGreaterThan(0)
    })

    /**
     * 战斗状态一共有十二种 type，而**这一层实现了哪几种、真值又走到了哪几种**，
     * 是两件事。下面两条把它们对上（xl-rh9.14）。
     *
     * 挂上（`checkState`）与退回（`returnFromState`）分开数：一个 type 挂过而
     * 从没退回过，说明它的退回那一段抄错了也不会红。
     */
    function typesSeen(pick: (t: BattleTrace['ticks'][number]) => (number | null)[]) {
      const applied = new Set<number>()
      const returned = new Set<number>()
      for (const name of IMPLEMENTED) {
        const ticks = traceOf(name).ticks
        let prev: (number | null)[] = pick(ticks[0]!).map(() => null)
        for (const t of ticks) {
          const now = pick(t)
          now.forEach((type, k) => {
            if (type !== null) applied.add(type)
            // 退回被调用的那两种形状：状态整个没了，或者被另一个 type 顶掉。
            const was = prev[k] ?? null
            if (was !== null && was !== type) returned.add(was)
          })
          prev = now
        }
      }
      return { applied: [...applied].sort((a, b) => a - b), returned: [...returned].sort((a, b) => a - b) }
    }

    it('我方那六种 type 都挂上过，也都退回过', () => {
      const { applied, returned } = typesSeen((t) =>
        t.heroes.map((h) => (h.state.usable ? h.state.type : null)),
      )
      // 我方拿得到的就这六种：1..4 由陆雪琪技能5 现掷（技能1 只掷 1、文敏技能2
      // 掷 1、张小凡技能3 与文敏技能5 掷 2），11 是张小凡的秘术，12 是文敏的。
      // 5..8 与 10 全游戏没有一招挂给我方 —— `heroApplyState` 走到就抛。
      expect(applied).toEqual([1, 2, 3, 4, 11, 12])
      expect(returned).toEqual([1, 2, 3, 4, 11, 12])
    })

    /**
     * ⚠️ **登记在案（xl-rh9.14 篡改 T9）**：麻痹（type 10）的加成是
     * `hurt = 0` / `skillHurt = 0`，而 `skillHurt` 在怪物这一侧**根本没有读者**
     * （`Enemy.calDamage` 两种招式读的都是 `hurt`）。也就是说这一支唯一看得见
     * 的后果是「中了麻痹的怪打出 0 伤害」—— 而它得先轮到自己出手。
     *
     * 实测：把 `e.hurt = 0` 那一句删掉，逐字段比对全绿。原因是
     * `battle-lu-skills` 里两段麻痹（第 3 槽 t=298..362 与 t=598..1084）**期间
     * 那只怪一次都没轮到过**——蒙面怪人速度 9，而场上两个我方合起来 44。
     *
     * 判别法写在这里：哪天有一条真值让中麻痹的怪出了手，这一条就红，那时候
     * 上面的逐字段比对自己盖得住它，这条登记该撤掉。
     */
    it('麻痹期间那只怪一次都没出手 —— type 10 的 hurt=0 今天观测不到，登记在案', () => {
      const acted: string[] = []
      for (const name of IMPLEMENTED) {
        const ticks = traceOf(name).ticks
        for (const t of ticks) {
          for (const e of t.enemies) {
            if (!e || !e.state.usable || e.state.type !== 10) continue
            if (t.round === e.state.role) acted.push(`${name}@${t.t}#${e.slot}`)
          }
        }
      }
      expect(
        acted,
        '有中了麻痹的怪轮到自己出手了 —— `enemyApplyState` 里 type 10 的 hurt=0 ' +
          '现在进得了伤害公式了，把这条登记换成正面比对。',
      ).toEqual([])
    })

    /**
     * ⚠️ **登记在案（xl-rh9.14 篡改 T21）**：张小凡的秘术是给**每个活着的我方**
     * 挂金钟罩，而唯一走到它的 `battle-mishu-zhang` 是**一个人出战**的 ——
     * 把那个 for 换成"只给自己挂"，逐字段比对全绿。
     *
     * 一个人出战不是随便挑的：怒气要攒到 `hpMax*0.8` 才满，而人在 `hpMax` 就
     * 倒了 —— 伤害分给两个人就得挨两倍的打，攒满之前先死一个。哪天有一条多人
     * 队伍的秘术真值，这一条会红。
     */
    it('金钟罩那个「全体」今天观测不到 —— 走到秘术的只有单人队伍，登记在案', () => {
      const multi: string[] = []
      for (const name of IMPLEMENTED) {
        const ticks = traceOf(name).ticks
        for (const t of ticks) {
          const shielded = t.heroes.filter((h) => h.state.usable && h.state.type === 11)
          if (shielded.length > 0 && t.heroes.filter((h) => !h.dead).length > 1) {
            multi.push(`${name}@${t.t}`)
            break
          }
        }
      }
      expect(
        multi,
        '有多人队伍挂上了金钟罩 —— 张小凡秘术里那个「给每个活着的我方挂」现在' +
          '与「只给自己挂」分得开了，把这条登记换成正面比对。',
      ).toEqual([])
    })

    it('怪物那六种 type 都挂上过；type 8 的退回今天还观测不到 —— 登记在案', () => {
      const { applied, returned } = typesSeen((t) =>
        t.enemies.map((e) => (e && e.state.usable ? e.state.type : null)),
      )
      // 怪物拿得到的就这六种（1..4 是增益，全游戏没有一招给怪物挂）。
      expect(applied).toEqual([5, 6, 7, 8, 9, 10])
      // ⚠️ **8 不在退回那一列里**：`battle-menus` 里挂上它的那只怪当场就死了，
      // 而 `battle-lu-skills` 里掷到 8 的那一只是**最后一个**状态，剧本收工时
      // 还挂着。也就是说 `returnEnemyState` 的 `case 8`（defense += 40）今天
      // 一次都没被调用 —— 抄成别的数不会红。
      // 哪天有真值让它退回，这一条会红：那时候把 8 挪到上面那个 toEqual 里。
      expect(returned).toEqual([5, 6, 7, 9, 10])
    })
  })

  describe('打输的两条出口：GameOver.update() 只比第一只怪的名字', () => {
    /** 剧本里写了 `awaitExit` 的那几场，连它要的面板一起。 */
    const exits = IMPLEMENTED.map((name) => ({
      name,
      panel: scriptedExit(traceOf(name)),
    })).filter((e): e is { name: string; panel: ExitPanel } => e.panel !== null)

    it('两条出口都各有真值盖着 —— 只盖住一条时"分支走反了"看不出来', () => {
      const panels = new Set(exits.map((e) => e.panel))
      expect(
        [...panels].sort(),
        '打输的出口真值没有把 scenePanel 与 startPanel 两条都盖住 —— ' +
          '只剩一条时，把分支整个写反推出来的结果和写对了一模一样。',
      ).toEqual(['scenePanel', 'startPanel'])
    })

    for (const { name, panel } of exits) {
      it(`${name}：这一层切到的面板是 ${panel}`, () => {
        const { world } = runToEnd(name)
        // 期望值来自剧本里那条 awaitExit，而它是导出器在原版真的切面板的那一刻
        // 当场核过的（BattleDriver.awaitExit）—— 不是手写的。
        expect(world.exitPanel).toBe(panel)
      })
    }

    it('没写 awaitExit 的那几场，跑到末步一次面板都没切', () => {
      const noExit = IMPLEMENTED.filter((name) => scriptedExit(traceOf(name)) === null)
      expect(noExit.length, '五份真值全都以切面板收尾了？那上面那条反方向就没了').toBeGreaterThan(0)
      for (const name of noExit) {
        expect(runToEnd(name).world.exitPanel, `${name} 不该切面板`).toBeNull()
      }
    })

    /**
     * 回地图那条出口只摘 `em1`，回标题那条把三个槽位都摘掉 —— 而**这个差别
     * 在今天这批真值里观测不到**：唯一走回地图那条的 `battle-defeat-scene`
     * 只有一只怪，第 2 / 3 槽本来就是 `null`，多摘两下什么都不变。
     * 实测（xl-rh9.8 篡改验证 T6）：给 `exitToScene` 加上 `em2=null; em3=null`，
     * 逐字段比对全绿。
     *
     * 所以把这件事登记成一条判据：哪天走回地图那条的真值里第 2 / 3 槽站了人，
     * 这一条会红，那时候上面的逐字段比对就自己盖得住它了，这条登记该撤掉。
     */
    it('回地图那条出口摘不摘 em2/em3，今天还观测不到 —— 登记在案', () => {
      // **只看打输那条路**。打赢也回 scenePanel（`VictoryReminder` 结算完就切，
      // xl-rh9.13 的 `battle-victory` 走的正是那一条），可它根本不经过
      // `GameOver.update()`，摘不摘 em2/em3 与它无关 —— 不筛的话这条登记会被
      // 一份打赢的真值撞红，而红的理由是假的。
      const sceneExits = exits.filter(
        (e) => e.panel === 'scenePanel' && traceOf(e.name).ticks[traceOf(e.name).ticks.length - 1]!.outcome === 'defeat',
      )
      expect(sceneExits.length, '没有一份**打输**的真值走回地图那条出口').toBeGreaterThan(0)
      for (const { name } of sceneExits) {
        const trace = traceOf(name)
        expect(
          [enemyAt(trace, 2), enemyAt(trace, 3)],
          `${name} 走的是回地图那条出口，而它第 2/3 槽站了人 —— ` +
            '「只摘 em1」与「三个都摘」现在分得开了，把这条登记换成正面比对。',
        ).toEqual([null, null])
      }
    })

    /**
     * 下面三条验的是**这批真值本身还分得开那三种写错法**，不是实现。
     * 真值一改（换一场、删一场），这几条会先红 —— 而"判据失效了"与
     * "实现写对了"在只比状态的测试里长得一模一样。
     */
    it('三种写错法各自都还有一场抓得到', () => {
      const em1s = exits.map(({ name }) => ({
        name,
        first: enemyAt(traceOf(name), 1)!.name,
        others: [2, 3]
          .map((slot) => enemyAt(traceOf(name), slot)?.name)
          .filter((n): n is string => n !== undefined),
      }))
      // 写成「三个槽位里有没有」→ 要有一场：第一只不是它，别的槽位是。
      expect(
        em1s.filter((e) => e.first !== '罹年居士' && e.others.includes('罹年居士')).length,
        '没有一场把罹年居士放在第 2/3 槽 —— 把判断写成"三个槽位里有没有"' +
          '与写成"第一只是不是"推出来的结果完全相同。',
      ).toBeGreaterThan(0)
      // 写成 startsWith / includes → 要有一场：第一只以它开头但不等于它。
      expect(
        em1s.filter((e) => e.first !== '罹年居士' && e.first.startsWith('罹年居士')).length,
        '没有一场的第一只怪叫「罹年居士…」而又不是「罹年居士」 —— ' +
          '把 equals 写成 startsWith / includes 推出来的结果完全相同。',
      ).toBeGreaterThan(0)
      // 分支走反 → 要有一场第一只**就是**它，与上面那些对照。
      expect(
        em1s.filter((e) => e.first === '罹年居士').length,
        '没有一场的第一只怪就是「罹年居士」 —— 回地图那条出口一次都走不到。',
      ).toBeGreaterThan(0)
    })
  })
})
