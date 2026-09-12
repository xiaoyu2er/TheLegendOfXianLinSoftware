import { readTrace, traceNamesOf } from '../state/trace'
import type { BattleInput } from './step'
import type { BattleSnapshot } from './snapshot'
import type { ExitPanel } from './types'

/**
 * 战斗行为真值的读取器。**跑在 Node 上**（它转手的是 `state/trace.ts` 的
 * `node:fs`），不进浏览器包。
 *
 * 形状是 `BattleSnapshot` **加上**几个不属于状态的列（`t` / `vt` / `ip` /
 * `input`）—— 也就是说：真值里除了那四列，每一列都要有人对上，少对一列就是
 * 少了一条判据。
 *
 * ⚠️ 这个 `extends` **不是判据**：读取器拿到的是 `JSON.parse` 的结果，一路
 * `as unknown as` 断言过来的，TypeScript 在这里什么都没核。真正把「真值多出
 * 一个字段而这边没跟上」钉住的是 `battleTrace.test.ts` 里那句逐步的
 * `toEqual` —— 期望值多一个键、或者嵌套里多一个键，深比对就红。写 `extends`
 * 只是让两边的字段名摆在一起好读。
 */
export interface BattleTraceTick extends BattleSnapshot {
  readonly t: number
  readonly vt: number
  readonly ip: number
  readonly input: readonly BattleInput[]
}

/**
 * 剧本里的一条指令（`docs/trace-format.md` §战斗剧本的 steps）。
 *
 * 只声明用得到的那两项：`op` 与 `awaitExit` 的 `panel`。**这不是"其余字段
 * 不存在"** —— `budget` / `until` / `max` 那些是给导出器用的，回放这一层
 * 一个都不读。
 */
export interface BattleTraceStep {
  readonly op: string
  /**
   * 只有 `op === 'awaitExit'` 才有：原版当场切到的那一块面板。
   *
   * 类型就是 `ExitPanel` —— 面板名只该有**一处**定义，写成 `string` 的话
   * 测试里那句 `expect(world.exitPanel).toBe(panel)` 会退化成两个字符串比大小，
   * 而剧本里写错一个面板名与写对了长得一样。真值里出现别的名字时，
   * `readBattleTrace` 当场拦下（见下面的 `assertExitPanel`）。
   */
  readonly panel?: ExitPanel
}

/** 战斗剧本里那几行（`docs/trace-format.md` §战斗剧本）。 */
export interface BattleTraceScript {
  readonly name: string
  readonly background: string
  readonly party: readonly ('zhang' | 'yu' | 'lu')[]
  readonly level: Readonly<Partial<Record<'zhang' | 'yu' | 'lu', number>>>
  /**
   * 技能菜单上有几颗按钮（xl-rh9.14）。**剧本整个不写时这一项不回显**，
   * 于是老真值逐字节不变 —— 所以这里是可选的，缺席就是「用原版初值」。
   */
  readonly skillNumber?: Readonly<Partial<Record<'zhang' | 'yu' | 'lu', number>>>
  /**
   * 开打前背包里的药，名字 → 件数（xl-byy，`DrugPack.addDrug`）。与 `skillNumber`
   * 同一个规矩：**剧本整个不写时不回显**，缺席就是「六种药全是 0」。
   */
  readonly drugs?: Readonly<Record<string, number>>
  readonly enemies: readonly (string | null)[]
  readonly seed: number
  readonly tickMs: number
  readonly maxTicks: number
  readonly steps: readonly BattleTraceStep[]
}

export interface BattleTrace {
  readonly driver: 'battle'
  readonly script: BattleTraceScript
  readonly tickCount: number
  readonly ticks: readonly BattleTraceTick[]
}

/** `driver=battle` 的那几份真值，**从磁盘现数**；一份都没有时 `traceNamesOf` 抛。 */
export const BATTLE_TRACE_NAMES: readonly string[] = traceNamesOf('battle')

export function readBattleTrace(name: string): BattleTrace {
  const trace = readTrace(name) as unknown as BattleTrace
  if (trace.driver !== 'battle') {
    throw new Error(`${name} 的 driver 是 ${trace.driver}，不是 battle`)
  }
  if (trace.ticks.length !== trace.tickCount) {
    throw new Error(`${name} 说有 ${trace.tickCount} 步，实际 ${trace.ticks.length} 步`)
  }
  if (trace.ticks.length === 0) throw new Error(`${name} 一步都没有`)
  // `panel` 的类型是断言来的（整份真值都是 `as unknown as`），所以在这里核一次。
  // 不核的话，剧本里写了个不存在的面板名会一路当成合法值传到断言里。
  for (const step of trace.script.steps) {
    if (step.op !== 'awaitExit') continue
    if (step.panel !== 'scenePanel' && step.panel !== 'startPanel') {
      throw new Error(
        `${name} 的 awaitExit 要的面板是 ${String(step.panel)} —— ` +
          '战斗只有 scenePanel / startPanel 两条出口（GameLauncher.switchTo）。',
      )
    }
  }
  return trace
}
