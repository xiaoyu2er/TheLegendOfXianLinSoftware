import { readFileSync } from 'node:fs'
import { traceNamesOf } from '../../state/trace'
import { repoPath } from '../../test/repoPath'
import type { StartView } from '../panelState'
import { startStartReplay } from '../replay'
import type { StartInput, StartReplay } from '../replay'
import { snapshotStart } from '../snapshot'

/**
 * start 真值的读取与回放（xl-whk）。**只给判据用**，跑在 Node 上。
 *
 * 回放**只读每一步的 `input`**，一个状态字段都不从真值里取。起手与逐步推进在
 * `../replay.ts`（取图页用的是同一份）；这里只多做 Node 才做得了的事：从磁盘读真值。
 */
export interface StartTraceTick {
  readonly t: number
  readonly ip: number
  readonly input: readonly StartInput[]
  readonly [column: string]: unknown
}

export interface StartTrace {
  readonly driver: 'start'
  readonly script: { readonly name: string }
  readonly tickCount: number
  readonly ticks: readonly StartTraceTick[]
}

/** `driver=start` 的那几份真值，从磁盘现数。 */
export const START_TRACE_NAMES: readonly string[] = traceNamesOf('start')

export function readStartTrace(name: string): StartTrace {
  const trace = JSON.parse(readFileSync(repoPath('tools/traces/out', `${name}.trace.json`), 'utf8')) as StartTrace
  if (trace.driver !== 'start') throw new Error(`${name} 的 driver 是 ${trace.driver}，不是 start`)
  if (trace.ticks.length !== trace.tickCount || trace.ticks.length === 0) {
    throw new Error(`${name} 说有 ${trace.tickCount} 步，实际 ${trace.ticks.length} 步`)
  }
  return trace
}

/** 回放出来的一行：真值里除 `t` / `ip` / `input` 之外的每一列。 */
export type ReplayedRow = Record<string, unknown>

export interface ReplayedStart {
  readonly rows: ReplayedRow[]
  /** 每一步之后原版位图上那一帧：只有 tick 步画，输入步停在上一拍。 */
  readonly views: (StartView | null)[]
  readonly replay: StartReplay
}

/** 逐步回放。一步恰好一个输入事件，多一个少一个都是硬失败。 */
export function replayStart(trace: StartTrace): ReplayedStart {
  const replay = startStartReplay(trace.script.name)
  const views: (StartView | null)[] = []
  const rows = trace.ticks.map((tick) => {
    if (tick.input.length !== 1) throw new Error(`第 ${tick.t} 步有 ${tick.input.length} 个输入事件，一步应当恰好一个`)
    const r = replay.step(tick.input[0]!)
    views.push(replay.view)
    return {
      // 标题页一声都不出：`StartPanel.java` 里没有任何 `MusicReader` 调用（`startTrace.test.ts`
      // 现读核对）；标题曲是 `switchTo("start")` 放的，导出器不走那一支。
      music: [],
      current: replay.current,
      card: r.card,
      ...snapshotStart(replay.state),
    }
  })
  return { rows, views, replay }
}
