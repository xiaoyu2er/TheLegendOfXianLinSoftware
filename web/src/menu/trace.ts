import { readTrace, traceNamesOf } from '../state/trace'
import type { MenuInput } from './step'
import type { MenuConfig } from './world'
import { createMenuWorld } from './world'
import type { MenuWorld } from './types'

/**
 * 菜单行为真值的读取器。**跑在 Node 上**（它转手的是 `state/trace.ts` 的
 * `node:fs`），不进浏览器包 —— 与 `battle/trace.ts` 同一个规矩。
 *
 * 这里**不给每一组列声明形状**：这一票只对齐其中几组，给全部九组写上类型会
 * 让"读取器认得它"看起来像"有人在核它"，而 `readTrace` 一路是
 * `as unknown as` 断言过来的，TypeScript 什么都没核（`battle/trace.ts` 那条
 * 已经吃过这个亏）。真正的判据是 `menuTrace.test.ts` 里逐组的 `toEqual`。
 */
export interface MenuTraceTick {
  readonly t: number
  readonly ip: number
  readonly input: readonly MenuInput[]
  /** 其余各列（`panel` / `hero` / `heroes` / `equip` / …）按名字取。 */
  readonly [column: string]: unknown
}

export interface MenuTraceScript {
  readonly name: string
  readonly description: string
  readonly setup: MenuConfig & {
    readonly equipment?: readonly { readonly name: string; readonly count: number }[]
    readonly drugs?: readonly { readonly name: string; readonly count: number }[]
  }
  readonly maxSteps: number
  readonly steps: readonly { readonly op: string }[]
}

export interface MenuTrace {
  readonly driver: 'menu'
  readonly script: MenuTraceScript
  readonly tickCount: number
  readonly ticks: readonly MenuTraceTick[]
}

/** `driver=menu` 的那几份真值，**从磁盘现数**；一份都没有时 `traceNamesOf` 抛。 */
export const MENU_TRACE_NAMES: readonly string[] = traceNamesOf('menu')

export function readMenuTrace(name: string): MenuTrace {
  const trace = readTrace(name) as unknown as MenuTrace
  if (trace.driver !== 'menu') {
    throw new Error(`${name} 的 driver 是 ${trace.driver}，不是 menu`)
  }
  if (trace.ticks.length !== trace.tickCount) {
    throw new Error(`${name} 说有 ${trace.tickCount} 步，实际 ${trace.ticks.length} 步`)
  }
  if (trace.ticks.length === 0) throw new Error(`${name} 一步都没有`)
  return trace
}

/**
 * 照剧本头把菜单世界建出来。**只读 `setup`，一个状态字段都不从真值里读。**
 *
 * `setup.drugs` 铺的是药品存货，物品页（xl-6lo.10）读它 —— 而它是不是铺对了
 * 由真值 `drug.list` 那一列逐步守着。`setup.equipment` 仍然不读：装备那半边
 * 归 xl-6lo.9，现在把它塞进世界里等于先建一份没人核的状态。
 */
export function replayMenu(trace: MenuTrace): MenuWorld {
  return createMenuWorld({
    party: trace.script.setup.party,
    fullHeal: trace.script.setup.fullHeal,
    drugs: trace.script.setup.drugs,
  })
}
