import { readFileSync } from 'node:fs'
import type { SceneScript } from '../../data/types'
import { fromRecorderText, readSample, sampleNames } from '../../save/test/originalSave'
import type { SaveFile } from '../../save/format'
import { SAVE_SLOT_COUNT } from '../../save/store'
import type { SaveStore } from '../../save/store'
import { traceNamesOf } from '../../state/trace'
import { repoPath } from '../../test/repoPath'
import { startSaveLoadReplay } from '../replay'
import type { SaveLoadSetup } from '../replay'
import { CARD_OF, snapshotSaveLoad } from '../snapshot'
import type { SaveLoadInput } from '../step'
import type { SaveLoadWorld } from '../world'

export type { SaveLoadSetup } from '../replay'

/**
 * saveload 真值的读取与回放（xl-i06.9）。**只给判据用**，跑在 Node 上。
 *
 * 回放**只读剧本头**（`script.setup`）与每一步的 `input`，一个状态字段都不从真值里
 * 取。起手与逐步推进在 `../replay.ts`（取图页用的是同一份，xl-i06.12）；这里只多做
 * Node 才做得了的两件事：从磁盘读真值，以及按原版写档装置的写法现读草稿区那几份档
 * （{@link draftSlots}）。
 */
export interface SaveLoadTraceTick {
  readonly t: number
  readonly ip: number
  readonly input: readonly SaveLoadInput[]
  readonly [column: string]: unknown
}

export interface SaveLoadTrace {
  readonly driver: 'saveload'
  readonly script: { readonly name: string; readonly setup: SaveLoadSetup }
  readonly tickCount: number
  readonly ticks: readonly SaveLoadTraceTick[]
}

/** `driver=saveload` 的那几份真值，从磁盘现数。 */
export const SAVELOAD_TRACE_NAMES: readonly string[] = traceNamesOf('saveload')

export function readSaveLoadTrace(name: string): SaveLoadTrace {
  const trace = JSON.parse(readFileSync(repoPath('tools/traces/out', `${name}.trace.json`), 'utf8')) as SaveLoadTrace
  if (trace.driver !== 'saveload') throw new Error(`${name} 的 driver 是 ${trace.driver}，不是 saveload`)
  if (trace.ticks.length !== trace.tickCount || trace.ticks.length === 0) {
    throw new Error(`${name} 说有 ${trace.tickCount} 步，实际 ${trace.ticks.length} 步`)
  }
  return trace
}

/** 草稿区：`存档N.txt` → 第 N 槽，`emptySlots` 删掉。 */
export function draftSlots(emptySlots: readonly number[]): (SaveFile | null)[] {
  const names = sampleNames()
  return Array.from({ length: SAVE_SLOT_COUNT }, (_, i) => {
    if (emptySlots.includes(i)) return null
    const name = `存档${i}.txt`
    if (!names.includes(name)) throw new Error(`真值目录里没有 ${name}（现有：${names.join('、')}）`)
    return fromRecorderText(readSample(name))
  })
}

/**
 * 烘焙好的场景 JSON，用 node fs 现读。不走 `data/scenesEager.ts`：那个模块的导入方
 * 被 `sceneLoading.test.ts` 钉着只许是测试文件与 `scripts/`，而这里是测试辅助件。
 */
function getScene(name: string): SceneScript {
  return JSON.parse(readFileSync(repoPath('web/src/generated/scenes', `${name}.json`), 'utf8')) as SceneScript
}

/** 回放出来的一行：真值里除 `t` / `ip` / `input` 之外的每一列。 */
export type ReplayedRow = Record<string, unknown>

/** 逐步回放。一步恰好一个输入事件，多一个少一个都是硬失败。 */
export function replaySaveLoad(trace: SaveLoadTrace): { rows: ReplayedRow[]; world: SaveLoadWorld; store: SaveStore } {
  const replay = startSaveLoadReplay(
    trace.script.name,
    trace.script.setup,
    draftSlots(trace.script.setup.emptySlots),
    getScene,
    trace.ticks[0]!.input[0],
  )
  const rows = trace.ticks.map((tick) => {
    if (tick.input.length !== 1) throw new Error(`第 ${tick.t} 步有 ${tick.input.length} 个输入事件，一步应当恰好一个`)
    const fx = replay.step(tick.input[0]!)
    const to = fx.switches[0]
    return {
      // 这个面板一声都不出：`LoadAndSavePanel.java` 里没有任何 `MusicReader` 调用
      // （`saveloadTrace.test.ts` 现读核对）。
      music: [],
      current: replay.current,
      ...snapshotSaveLoad(replay.world),
      intercept: { card: to === undefined ? null : CARD_OF[to], sceneLoopStart: fx.sceneLoopStart },
    }
  })
  return { rows, world: replay.world, store: replay.store }
}
