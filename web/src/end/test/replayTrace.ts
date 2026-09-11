import { readFileSync } from 'node:fs'
import type { SceneScript } from '../../data/types'
import { traceNamesOf } from '../../state/trace'
import { repoPath } from '../../test/repoPath'
import { endDrawList } from '../render/drawList'
import type { EndDrawOp } from '../render/drawList'
import { startEndReplay } from '../replay'
import type { EndInput, EndReplay, EndSetup } from '../replay'
import { snapshotEnd } from '../snapshot'

/**
 * end 真值的读取与回放（xl-czb.6）。**只给判据用**，跑在 Node 上。
 *
 * 回放**只读剧本头**（`script.setup`）与每一步的 `input`，一个状态字段都不从真值里取。
 * 起手与逐步推进在 `../replay.ts`（取图页用的是同一份）；这里只多做 Node 才做得了的
 * 事：从磁盘读真值与烘好的场景。
 *
 * ⚠️ `input` 里 `key` 步的 `to` 是导出器**观察到的**（按键落到了谁手里），不是剧本给的
 * 输入 —— 回放不读它，只把自己算出来的那个交出去，由判据拿去对。
 */
export interface EndTraceTick {
  readonly t: number
  readonly ip: number
  readonly input: readonly EndInput[]
  readonly [column: string]: unknown
}

export interface EndTrace {
  readonly driver: 'end'
  readonly script: { readonly name: string; readonly setup: EndSetup }
  readonly tickCount: number
  readonly ticks: readonly EndTraceTick[]
}

/** `driver=end` 的那几份真值，从磁盘现数。 */
export const END_TRACE_NAMES: readonly string[] = traceNamesOf('end')

export function readEndTrace(name: string): EndTrace {
  const trace = JSON.parse(readFileSync(repoPath('tools/traces/out', `${name}.trace.json`), 'utf8')) as EndTrace
  if (trace.driver !== 'end') throw new Error(`${name} 的 driver 是 ${trace.driver}，不是 end`)
  if (trace.ticks.length !== trace.tickCount || trace.ticks.length === 0) {
    throw new Error(`${name} 说有 ${trace.tickCount} 步，实际 ${trace.ticks.length} 步`)
  }
  return trace
}

/** 烘焙好的场景 JSON，用 node fs 现读（理由同 `saveload/test/replayTrace.ts`）。 */
function getScene(name: string): SceneScript {
  return JSON.parse(readFileSync(repoPath('web/src/generated/scenes', `${name}.json`), 'utf8')) as SceneScript
}

/** 回放出来的一行：真值里除 `t` / `ip` / `input` 之外的每一列。 */
export type ReplayedRow = Record<string, unknown>

export interface ReplayedEnd {
  readonly rows: ReplayedRow[]
  /** 每一步回放算出来的「按键落到谁手里」（非 key 步是 `undefined`）。 */
  readonly to: ('scene' | null | undefined)[]
  /** 每一步之后原版位图上那一帧的绘制清单：结局还显示着就重画，切走之后停在最后一帧。 */
  readonly frames: EndDrawOp[][]
  readonly replay: EndReplay
}

/** 逐步回放。一步恰好一个输入事件，多一个少一个都是硬失败。 */
export function replayEnd(trace: EndTrace): ReplayedEnd {
  const replay = startEndReplay(trace.script.name, trace.script.setup, getScene)
  const to: ('scene' | null | undefined)[] = []
  const frames: EndDrawOp[][] = []
  let shown: EndDrawOp[] = []
  const rows = trace.ticks.map((tick) => {
    if (tick.input.length !== 1) throw new Error(`第 ${tick.t} 步有 ${tick.input.length} 个输入事件，一步应当恰好一个`)
    const r = replay.step(tick.input[0]!)
    to.push(r.to)
    const world = replay.world
    if (world === null) throw new Error(`第 ${tick.t} 步之后还没有结局面板世界`)
    // 导出器只在结局还在屏幕上时 paint（`EndDriver.step`）。
    if (replay.session.panel === 'end') shown = endDrawList(world)
    frames.push(shown)
    return {
      // 结局面板一声都不出：`EndPanel.java` 里没有任何 `MusicReader` 调用
      // （`endTrace.test.ts` 现读核对）。
      music: [],
      current: replay.current,
      card: r.card,
      ...snapshotEnd(world),
      repainted: r.repainted,
      loop: r.loop,
    }
  })
  return { rows, to, frames, replay }
}
