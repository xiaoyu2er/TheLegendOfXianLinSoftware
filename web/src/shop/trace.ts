import { readTrace, traceNamesOf } from '../state/trace'
import { replayShopSetup, shopInputsOfTicks } from './replay'
import type { ShopScriptStep } from './replay'
import type { ShopInput } from './step'
import type { ShopConfig } from './world'
import type { ShopWorld } from './types'

/**
 * 商店行为真值的读取器。**跑在 Node 上**（它转手的是 `state/trace.ts` 的
 * `node:fs`），不进浏览器包 —— 与 `menu/trace.ts` / `battle/trace.ts` 同一个规矩。
 *
 * 这里**不给每一组列声明形状**：给十组都写上类型会让"读取器认得它"看起来像
 * "有人在核它"，而 `readTrace` 一路是 `as unknown as` 断言过来的，TypeScript
 * 什么都没核。真正的判据是 `shopTrace.test.ts` 里逐组的 `toEqual`。
 */
export interface ShopTraceTick {
  readonly t: number
  readonly ip: number
  readonly input: readonly ShopInput[]
  /** 其余各列（`shop` / `coins` / `list` / …）按名字取。 */
  readonly [column: string]: unknown
}

export interface ShopTraceScript {
  readonly name: string
  readonly description: string
  readonly setup: ShopConfig
  readonly maxSteps: number
  readonly steps: readonly ShopScriptStep[]
}

export interface ShopTrace {
  readonly driver: 'shop'
  readonly script: ShopTraceScript
  readonly tickCount: number
  readonly ticks: readonly ShopTraceTick[]
}

/** `driver=shop` 的那几份真值，**从磁盘现数**；一份都没有时 `traceNamesOf` 抛。 */
export const SHOP_TRACE_NAMES: readonly string[] = traceNamesOf('shop')

export function readShopTrace(name: string): ShopTrace {
  const trace = readTrace(name) as unknown as ShopTrace
  if (trace.driver !== 'shop') {
    throw new Error(`${name} 的 driver 是 ${trace.driver}，不是 shop`)
  }
  if (trace.ticks.length !== trace.tickCount) {
    throw new Error(`${name} 说有 ${trace.tickCount} 步，实际 ${trace.ticks.length} 步`)
  }
  if (trace.ticks.length === 0) throw new Error(`${name} 一步都没有`)
  return trace
}

/** 照剧本头把商店世界建出来。**只读 `setup`。** */
export function replayShop(trace: ShopTrace): ShopWorld {
  return replayShopSetup(trace.script.setup)
}

/** 逐步的输入，见 `replay.ts` 的 `shopInputsOfTicks`。 */
export function shopInputsOf(trace: ShopTrace): ShopInput[][] {
  return shopInputsOfTicks(trace.script.steps, trace.ticks)
}
