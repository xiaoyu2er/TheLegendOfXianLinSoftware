import READER_STATICS from '../generated/readerStatics.json'
import type { ReaderStatics } from './bakeScript'

/**
 * 每个脚本的 `Role` / `Task` 两段（xl-i06.9），`pnpm bake` 产出。原版读它们进
 * 静态字段 —— 见 `bakeScript.ts` 的 `ReaderStatics`，以及 `World.readerStatics`
 * 那条「没有这一段就留着上一个场景的值」。
 *
 * 一共九十几条短字符串，随主包走，不按场景按需取：`initiate` 是同步的。
 */
const TABLE = READER_STATICS as unknown as Readonly<Record<string, ReaderStatics>>

/** 按脚本文件名（`脚本1.txt`）取。**没烘过是抛**，不当成「两段都没有」。 */
export function readerStaticsFor(script: string): ReaderStatics {
  const hit = TABLE[script]
  if (!hit) {
    throw new Error(`readerStatics.json 里没有 ${script}（共 ${Object.keys(TABLE).length} 条）—— 重跑 pnpm bake`)
  }
  return hit
}

/** 烘过的脚本名，给判据对撞分母用。 */
export const READER_STATICS_SCRIPTS: readonly string[] = Object.keys(TABLE).sort()
