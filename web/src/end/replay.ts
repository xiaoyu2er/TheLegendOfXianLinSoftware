import type { SceneScript } from '../data/types'
import { resetDrugPack } from '../fakes/drugPack'
import { resetParty } from '../fakes/party'
import { resetWallet } from '../fakes/wallet'
import {
  NO_INPUT,
  advanceSession,
  createSession,
  currentPanelOf,
  enterEnd,
  enterScene,
  keyReceiver,
  openMenu,
} from '../game/session'
import type { CurrentPanel, RunningSession } from '../game/session'
import { createMemorySaveStore } from '../save/memoryStore'
import { createWorld } from '../state/step'
import type { InputEvent } from '../state/types'
import { END_CARD_OF } from './snapshot'
import { END_TICK_MS, loopOnce } from './world'
import type { EndWorld } from './world'

/**
 * end 真值的回放起手与逐步推进（xl-czb.6）。
 *
 * **两处用同一份**：状态层判据（`endTrace.test.ts`，跑在 Node 上）与取图页
 * （`replay/main.ts`，跑在浏览器里）—— 抄一份的话，状态层对齐了而画面那一侧照另一套
 * 起手，比出来的差异是装错了，不是两端不同。所以这个模块不碰 `node:fs`，场景由调用方给。
 *
 * **走的是游戏本体那一份会话**（`game/session.ts`），不是另起一套：真值要验的三样里
 * 有两样（按键落到谁手里、那条线程摘不摘）本来就是会话层的事，绕开它回放，那两列就是
 * 回放件自己给自己签字。
 *
 * 起手照导出器 `EndDriver.start()`：一块场景面板 `initiation(setup.scene)`、菜单（会话
 * 开机就建）、结局面板（会话第一次进结局才建，见 `Session.end`）。当前面板是场景 ——
 * 原版走到 `switchTo("end")` 的那一刻就是这样。
 *
 * 一步四种（`EndScript` 的四条指令，真值 `input` 那一列）：
 *
 * - `enter` —— `switchTo("end")`，会话的 `enterEnd`；
 * - `tick` —— 那条线程睡满一圈：会话推 {@link END_TICK_MS}。场景那一侧也跟着推（原版
 *   场景的线程在结局期间照样在跑），它推的东西不进这份真值；
 * - `key` —— 一次按键，经会话的按键分发（`keyReceiver`）。退出键走 `openMenu`，
 *   与 `game/useGame.ts` 同一条路；
 * - `wake` —— 把线程叫醒一次：不经 sleep 多走一圈循环体（`loopOnce`）。
 */
export interface EndSetup {
  readonly scene: string
}

export type EndInput =
  | { readonly e: 'enter' }
  | { readonly e: 'tick' }
  | { readonly e: 'key'; readonly key: string; readonly to?: string | null }
  | { readonly e: 'wake' }

export interface EndStepResult {
  /** 这一步拦下来的面板切换（卡片名），没切是 `null`。 */
  readonly card: string | null
  /** 这一步原版有没有调 `repaint()`。 */
  readonly repainted: boolean
  /** `key` 步：这一下落到了谁手里（`scene` 或谁都没收到）。别的步没有这一项。 */
  readonly to?: 'scene' | null
  /** 只在 `wake` 步上有值：线程还在不在、`isStop` 之后又被叫醒走了几圈。 */
  readonly loop: { readonly alive: boolean; readonly wakes: number } | null
}

export interface EndReplay {
  readonly session: RunningSession
  /** 原版 `GameLauncher.currentPanel`（真值 `current`）。 */
  readonly current: CurrentPanel
  /** 结局面板世界；进结局之前是 `null`。 */
  readonly world: EndWorld | null
  step(input: EndInput): EndStepResult
}

/** 真值里按键的名字 → 场景那一侧的按键事件。退出键不在这里（它走 `openMenu`）。 */
const SCENE_KEYS: ReadonlySet<string> = new Set(['enter', 'space', 'left', 'right', 'up', 'down'])

const stem = (s: string) => s.replace(/\.txt$/, '')

export function startEndReplay(name: string, setup: EndSetup, getScene: (name: string) => SceneScript): EndReplay {
  resetParty()
  resetWallet()
  resetDrugPack()
  let session: RunningSession = enterScene(
    createSession({
      scenes: (file) => getScene(stem(file)),
      sprite: () => ({ width: 0, height: 0 }),
      random: () => 0,
      saves: createMemorySaveStore([]),
    }),
    createWorld(getScene(stem(setup.scene))),
  )
  let steps = 0
  let wakes = 0
  let endWorld: EndWorld | null = null
  return {
    get session() {
      return session
    },
    get current() {
      return currentPanelOf(session.panel)
    },
    // 进结局那一刻就握住面板世界，不每次从 `session.end` 现取：线程被摘掉（原版不会，
    // 但判据要能看见「会被摘掉」这件事）不等于面板没了 —— 现取的话回放在这里就崩，
    // 「线程死了」读出来是整个测试文件收集失败，而不是 `loop.alive` 那一格红。
    get world() {
      return endWorld
    },
    step(input) {
      const where = `${name} 第 ${steps} 步（${JSON.stringify(input)}）`
      const before = session.panel
      const repaintsBefore = session.end?.repaints ?? 0
      let to: 'scene' | null | undefined
      let loop: EndStepResult['loop'] = null
      switch (input.e) {
        case 'enter':
          if (steps !== 0) throw new Error(`${where}：enter 只许是第一步`)
          session = enterEnd(session)
          endWorld = session.end!.world
          break
        case 'tick':
          session = advanceSession(session, NO_INPUT, END_TICK_MS)
          break
        case 'key': {
          to = keyReceiver(session.panel) === 'scene' ? 'scene' : null
          if (input.key === 'escape') {
            session = openMenu(session)
          } else if (SCENE_KEYS.has(input.key)) {
            const event: InputEvent = { e: 'press', k: input.key, ctrl: false }
            session = advanceSession(session, { ...NO_INPUT, scene: [event] }, 0)
          } else {
            throw new Error(`${where}：不认识的键 ${input.key}`)
          }
          break
        }
        case 'wake': {
          const end = session.end
          if (end !== null) {
            if (!end.world.isStop) throw new Error(`${where}：isStop 之前不许叫醒线程（导出器那边也是硬失败）`)
            loopOnce(end)
            wakes++
          }
          loop = { alive: session.end !== null, wakes }
          break
        }
      }
      let card: string | null = null
      if (session.panel !== before) {
        const c = END_CARD_OF[session.panel]
        if (c === undefined) throw new Error(`${where}：切到了 ${session.panel}，END_CARD_OF 里没有它的卡片名`)
        card = c
      }
      steps++
      return { card, repainted: (session.end?.repaints ?? 0) !== repaintsBefore, loop, ...(to === undefined ? {} : { to }) }
    },
  }
}
