import { readTrace, traceNamesOf } from '../state/trace'
import type { BattleInput } from './step'
import type { BattleSnapshot } from './snapshot'

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

/** 战斗剧本里那几行（`docs/trace-format.md` §战斗剧本）。 */
export interface BattleTraceScript {
  readonly name: string
  readonly background: string
  readonly party: readonly ('zhang' | 'yu' | 'lu')[]
  readonly level: Readonly<Partial<Record<'zhang' | 'yu' | 'lu', number>>>
  readonly enemies: readonly (string | null)[]
  readonly seed: number
  readonly tickMs: number
  readonly maxTicks: number
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
  return trace
}
