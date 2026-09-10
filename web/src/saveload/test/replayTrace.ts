import { readFileSync } from 'node:fs'
import { getScene } from '../../data/scenesEager'
import { resetDrugPack } from '../../fakes/drugPack'
import { resetParty } from '../../fakes/party'
import { resetWallet } from '../../fakes/wallet'
import { captureSession, createSession, enterScene } from '../../game/session'
import type { RunningSession } from '../../game/session'
import { fromRecorderText, readSample, sampleNames } from '../../save/test/originalSave'
import { createMemorySaveStore } from '../../save/memoryStore'
import type { SaveFile } from '../../save/format'
import { SAVE_SLOT_COUNT } from '../../save/store'
import type { SaveStore } from '../../save/store'
import { initiate } from '../../state/step'
import { traceNamesOf } from '../../state/trace'
import type { World } from '../../state/types'
import { repoPath } from '../../test/repoPath'
import { CARD_OF, snapshotSaveLoad } from '../snapshot'
import { applySaveLoadInput } from '../step'
import type { SaveLoadInput, SaveLoadTarget } from '../step'
import { createSaveLoadWorld } from '../world'
import type { SaveLoadWorld } from '../world'

/**
 * saveload 真值的读取与回放（xl-i06.9）。**只给判据用**，跑在 Node 上。
 *
 * 回放**只读剧本头**（`script.setup`）与每一步的 `input`，一个状态字段都不从真值里
 * 取。起手照导出器 `SaveLoadDriver.start()` 的那几件事：
 *
 * 1. 仓库 = 草稿区：入库样例 `存档N.txt` 按原版写档装置的写法解析（测试侧解析器，
 *    xl-i06.7），`setup.emptySlots` 那几个槽删掉；
 * 2. 场景 = `initiation(warmup?)` 再 `initiation(scene)`，之后 `SaveAndLoad.zhang/lu/wen`
 *    被剧本的 `party` 覆盖（导出器写死这三个静态字段，**在** initiation 之后）；
 * 3. 其余（三个人、装备、药、钱）是一个干净进程的样子 —— 快照里看不见它们，但
 *    存档时 `captureSession` 要读，读的就是那份出厂值。
 */
export interface SaveLoadSetup {
  readonly scene: string
  readonly warmup?: string
  readonly party: readonly string[]
  readonly emptySlots: readonly number[]
}

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

const stem = (s: string) => s.replace(/\.txt$/, '')

/** 照剧本头立起一个已开局的会话（存档时要从它身上取数）。 */
export function setupSession(setup: SaveLoadSetup, store: SaveStore): RunningSession {
  resetParty()
  resetWallet()
  resetDrugPack()
  let world: World | null = null
  if (setup.warmup) world = initiate(world, getScene(stem(setup.warmup)))
  world = initiate(world, getScene(stem(setup.scene)))
  world = {
    ...world,
    readerStatics: {
      ...world.readerStatics,
      zhang: setup.party.includes('zhang'),
      lu: setup.party.includes('lu'),
      wen: setup.party.includes('wen'),
    },
  }
  const session = createSession({
    scenes: (file) => getScene(stem(file)),
    sprite: () => ({ width: 0, height: 0 }),
    random: () => 0,
    saves: store,
  })
  return enterScene(session, world)
}

/** 回放出来的一行：真值里除 `t` / `ip` / `input` 之外的每一列。 */
export type ReplayedRow = Record<string, unknown>

/**
 * 逐步回放。`current` 起手是第一条 `enter` 的 `from`（导出器照它摆当前面板）；
 * 之后只要这一步 `switchTo` 过就换成最后那一处。
 */
export function replaySaveLoad(trace: SaveLoadTrace): { rows: ReplayedRow[]; world: SaveLoadWorld; store: SaveStore } {
  const store = createMemorySaveStore(draftSlots(trace.script.setup.emptySlots))
  const session = setupSession(trace.script.setup, store)
  const world = createSaveLoadWorld(store)
  const first = trace.ticks[0]!.input[0]
  if (!first || first.e !== 'enter') throw new Error(`${trace.script.name} 第 0 步不是 enter`)
  let current: SaveLoadTarget = first.from
  const rows = trace.ticks.map((tick) => {
    if (tick.input.length !== 1) throw new Error(`第 ${tick.t} 步有 ${tick.input.length} 个输入事件，一步应当恰好一个`)
    const fx = applySaveLoadInput(world, tick.input[0]!, { store, capture: () => captureSession(session) })
    if (fx.switches.length > 1) throw new Error(`第 ${tick.t} 步切了 ${fx.switches.length} 次面板，导出器那边这是硬失败`)
    const to = fx.switches[0]
    if (to !== undefined) current = to
    return {
      // 这个面板一声都不出：`LoadAndSavePanel.java` 里没有任何 `MusicReader` 调用
      // （`saveloadTrace.test.ts` 现读核对）。
      music: [],
      current,
      ...snapshotSaveLoad(world),
      intercept: { card: to === undefined ? null : CARD_OF[to], sceneLoopStart: fx.sceneLoopStart },
    }
  })
  return { rows, world, store }
}
