import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../compare/png'
import { repoPath } from '../test/repoPath'
import { snapshotBattle } from './snapshot'
import { stepBattle } from './step'
import { replayBattle } from './replay'
import { BATTLE_TRACE_NAMES, readBattleTrace } from './trace'

/**
 * 战斗状态层逐字段对齐行为真值。
 *
 * 这是这一层唯一有分量的判据，也是它存在的理由：写实现和写期望值的是同一个
 * agent、在同一个上下文窗口里，手写期望的测试会绿、而且是错的。这里的期望值
 * 一个都不是手写的 —— 全部来自 `tools/traces/out/battle-min.trace.json`，
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
 */

/** 已经对齐的那几份 —— 每加一份都要在这里显式登记。 */
const IMPLEMENTED: readonly string[] = ['battle-min']

/**
 * 还没对齐的那几份，各自写明归哪张票。
 *
 * 这两张表是**对撞**的：真值目录里冒出一份两边都没有的剧本，下面第一条用例
 * 立刻红。没有这一条的话，新剧本"加了却没人回放"和"全都对上了"长得一样。
 */
const PENDING: Readonly<Record<string, string>> = {
  'battle-em3-box': 'xl-rh9.8（em3 命中框那一场）',
  'battle-defeat-scene': 'xl-rh9.8（打输回地图那条出口）',
  'battle-defeat-start': 'xl-rh9.8（打输回标题那条出口）',
}

/** 怪物出场图（`Images.get(0)`）的像素尺寸。 */
function spriteSize(name: string): { width: number; height: number } {
  const png = decodePng(readFileSync(repoPath('image/怪物', name, '1.png')))
  return { width: png.width, height: png.height }
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
    it(`${name}：${'逐步逐字段'}与真值相等`, () => {
      const trace = readBattleTrace(name)
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

    it(`${name}：末步至少有一格是负血 —— xl-1dv.9 在这一场里看得见`, () => {
      const trace = readBattleTrace(name)
      const world = replayBattle(trace, spriteSize)
      for (const tick of trace.ticks) stepBattle(world, tick.input)
      const hp = snapshotBattle(world).enemies.map((e) => e?.hp ?? null)
      // 正方向：推出来的末帧与真值的末帧相等（上面那条已经逐步比过，这里是
      // 把这条缺陷单拎出来，让它有一个叫得出名字的判据）。
      expect(hp).toEqual(trace.ticks[trace.ticks.length - 1]!.enemies.map((e) => e?.hp ?? null))
      // 反方向：**这一场里真的有负血**。哪天换了种子或改了伤害，负血不再出现，
      // 上面那条会退化成一条恒真的检查，而"夹到 0 了"与"照抄了"长得一样。
      expect(
        hp.filter((v) => v !== null && v < 0).length,
        `${name} 末步一格负血都没有 —— Enemy.hp 不夹到 0 这件事在这一场里观测不到了`,
      ).toBeGreaterThan(0)
    })

    it(`${name}：这一场看不见 xl-1dv.8（三只怪一样高），所以第三槽的框高归 xl-rh9.8 去验`, () => {
      // `EnemySlector` 判第三只怪时用的是 `height1`。这一层照抄了那个写法
      // （见 `snapshot.ts` 的 `boxOf` 与 `step.ts` 的 selector 两处），可
      // **battle-min 的三只怪图片一样高**，写对了和写错了推出来的数完全相同。
      // 把这件事断言出来，免得"那条缺陷已经被这份真值盖住了"被人默认为真。
      const trace = readBattleTrace(name)
      const heights = trace.ticks[0]!.enemies
        .filter((e) => e !== null)
        .map((e) => spriteSize(e.name).height)
      expect(
        new Set(heights).size,
        `${name} 里三只怪的图高不再一样了 —— 那么第三槽的框高在这一份真值里` +
          '已经观测得到，这条"看不见"的登记就该撤掉，改成正面比对。',
      ).toBe(1)
    })

    it(`${name}：虚拟时间与步数自洽`, () => {
      const trace = readBattleTrace(name)
      const world = replayBattle(trace, spriteSize)
      for (const tick of trace.ticks) {
        expect(world.tick).toBe(tick.t)
        expect(tick.vt).toBe(tick.t * trace.script.tickMs)
        stepBattle(world, tick.input)
      }
      expect(world.tick).toBe(trace.tickCount)
    })
  }
})
