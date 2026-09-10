import type { SceneScript } from '../data/types'
import { resetDrugPack } from '../fakes/drugPack'
import { resetParty } from '../fakes/party'
import { resetWallet } from '../fakes/wallet'
import { captureSession, createSession, enterScene } from '../game/session'
import type { RunningSession } from '../game/session'
import type { SaveFile } from '../save/format'
import { createMemorySaveStore } from '../save/memoryStore'
import type { SaveStore } from '../save/store'
import { initiate } from '../state/step'
import type { World } from '../state/types'
import { applySaveLoadInput } from './step'
import type { SaveLoadEffect, SaveLoadInput, SaveLoadTarget } from './step'
import { createSaveLoadWorld } from './world'
import type { SaveLoadWorld } from './world'

/**
 * saveload 真值的回放起手与逐步推进（xl-i06.12 从 `test/replayTrace.ts` 抽出来）。
 *
 * **两处用同一份**：状态层判据（`saveloadTrace.test.ts`，跑在 Node 上）与取图页
 * （`replay/main.ts`，跑在浏览器里）。抽出来是因为取图页也要照它起手 —— 抄一份的话，
 * 状态层对齐了而画面那一侧照另一套起手，比出来的差异是装错了，不是两端不同。
 *
 * 所以这个模块**不碰 `node:fs`**：场景由调用方给（`getScene`），草稿区那几份档也由
 * 调用方给（`slots`）—— 测试侧按原版写档装置的写法现读样例（`test/replayTrace.ts` 的
 * `draftSlots`），取图页收的是比对器在 Node 那一半用同一个函数解好的
 * （`compare/saveFixtures.ts`）。
 *
 * 起手照导出器 `SaveLoadDriver.start()` 的那几件事：
 *
 * 1. 仓库 = 草稿区：`slots`（空槽是 `null`）；
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

const stem = (s: string) => s.replace(/\.txt$/, '')

/** 照剧本头立起一个已开局的会话（存档时要从它身上取数）。 */
export function setupSession(
  setup: SaveLoadSetup,
  store: SaveStore,
  getScene: (name: string) => SceneScript,
): RunningSession {
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

/** 一趟回放：面板世界、仓库、此刻的当前面板，外加推一步。 */
export interface SaveLoadReplay {
  readonly world: SaveLoadWorld
  readonly store: SaveStore
  /**
   * 此刻原版的当前面板（`GameLauncher.currentPanel`）。起手是第一条 `enter` 的 `from`
   * （导出器照它摆当前面板）；之后只要一步里 `switchTo` 过就换成那一处。
   *
   * 取图页要它：导出器**只在当前面板还是这块时才画**（`SaveLoadDriver.stepUnguarded`），
   * 离开的那一步位图停在离开前最后一帧。
   */
  readonly current: SaveLoadTarget
  /** 推一个输入事件。一步切了不止一次面板是硬失败 —— 导出器那边也是。 */
  step(input: SaveLoadInput): SaveLoadEffect
}

export function startSaveLoadReplay(
  name: string,
  setup: SaveLoadSetup,
  slots: readonly (SaveFile | null)[],
  getScene: (name: string) => SceneScript,
  first: SaveLoadInput | undefined,
): SaveLoadReplay {
  if (!first || first.e !== 'enter') throw new Error(`${name} 第 0 步不是 enter`)
  const store = createMemorySaveStore(slots)
  const session = setupSession(setup, store, getScene)
  const world = createSaveLoadWorld(store)
  let current: SaveLoadTarget = first.from
  let steps = 0
  return {
    world,
    store,
    get current() {
      return current
    },
    step(input) {
      const fx = applySaveLoadInput(world, input, { store, capture: () => captureSession(session) })
      if (fx.switches.length > 1) {
        throw new Error(`${name} 第 ${steps} 步切了 ${fx.switches.length} 次面板，导出器那边这是硬失败`)
      }
      const to = fx.switches[0]
      if (to !== undefined) current = to
      steps++
      return fx
    },
  }
}
