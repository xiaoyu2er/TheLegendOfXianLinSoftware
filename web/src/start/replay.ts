import { START_BUTTONS, startButtonHitBox } from './buttons'
import type { StartButtonKey } from './buttons'
import {
  createStartPanelState,
  hoverStartButton,
  moveStartCursor,
  pressStartButton,
  releaseStartButton,
  tickStartPanel,
} from './panelState'
import type { StartEffect, StartPanelState, StartView } from './panelState'

/**
 * start 真值的回放起手与逐步推进（xl-whk）。
 *
 * **两处用同一份**：状态层判据（`startTrace.test.ts`，跑在 Node 上）与取图页
 * （`replay/main.ts`，跑在浏览器里）—— 抄一份的话，状态层对齐了而画面那一侧照另一套推，
 * 比出来的差异是装错了，不是两端不同。
 *
 * 推的是游戏本体那一份状态机（`panelState.ts`），与 `useStartPanel.ts` 调的是同一组函数。
 *
 * 一步四种（`StartScript` 的四条指令，真值 `input` 那一列）：
 *
 * - `tick` —— 一拍：`tickStartPanel`，更新段 + 绘制段；
 * - `move` —— `moveStartCursor` + `hoverStartButton`（原版 `mouseMoved`：记坐标、每颗按钮
 *   `isMoveIn`）；
 * - `press` / `release` —— 原版 `mousePressed` / `mouseReleased`。坐标也记下（原版两个监听器
 *   第一件事就是 `currentX = e.getX()`）。
 *
 * ## 坐标 → 哪颗按钮：照 DOM 的盒子判，不照原版的开区间
 *
 * 产品里命中判定归 DOM（`buttons.ts` 头注：按钮元素占的就是 `startButtonHitBox` 那个
 * 50×50 的盒子，含左、上两条边），这里回放的是**产品**，所以照 DOM 盒子的半开区间
 * `[x, x+w) × [y, y+h)` 判，只认此刻在屏幕上的那几颗（`state.buttons`）。与原版的开区间
 * 差左、上那一列 / 一行 —— `buttons.ts` 头注写了这个差与不补它的理由，⚠️ **但它没有
 * `@exception ADR-0001#…` 标记、ADR-0001 的例外表里也没有这一行**（xl-whk 评审查出的旧账，
 * 登不登记归主干裁定）。入库剧本的坐标都落在两者一致的内部，真落到那一像素上，状态层判据
 * 会当场对不上。
 *
 * ## 两种产品里走不到的输入：当场抛
 *
 * 产品的点击是 DOM 按钮上的 `click`（按下 + 松开合成一次，`useStartPanel.ts`），所以
 * 「按在空处」与「在一颗上按、到另一颗上松」都没有对应物。回放遇到就抛 —— 照猜一个
 * 画出来的是另一件事。
 */

export type StartInput =
  | { readonly e: 'tick' }
  | { readonly e: 'move' | 'press' | 'release'; readonly x: number; readonly y: number }

/** 状态机推出来的动作 → 原版 `CardLayout` 的卡片名与切过去之后的 `currentPanel`。 */
const SWITCH_OF: Readonly<Record<Exclude<StartEffect, 'exit'>, { card: string; current: string }>> = {
  newGame: { card: 'scenePanel', current: 'scene' },
  loadPanel: { card: 'lsPanel', current: 'ls' },
}

export interface StartStepResult {
  /** 这一步拦下来的面板切换（卡片名），没切是 `null`。 */
  readonly card: string | null
}

export interface StartReplay {
  readonly state: StartPanelState
  /** 原版 `GameLauncher.currentPanel`（真值 `current`）。 */
  readonly current: string
  /**
   * 原版位图此刻停在的那一帧。**只有 tick 步画**（原版三个监听器一句 `repaint()` 都没有），
   * 输入步之后位图停在上一拍；第一拍之前是 `null`（原版一帧都还没画过）。
   */
  readonly view: StartView | null
  step(input: StartInput): StartStepResult
}

/** 这个坐标此刻落在哪颗按钮的 DOM 盒子里；一颗都不在是 `null`。 */
export function buttonAt(state: StartPanelState, x: number, y: number): StartButtonKey | null {
  for (const key of state.buttons) {
    const spec = START_BUTTONS.find((b) => b.key === key)!
    const box = startButtonHitBox(spec)
    if (x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) return key
  }
  return null
}

export function startStartReplay(name: string): StartReplay {
  let state = createStartPanelState()
  let current = 'start'
  let view: StartView | null = null
  /** 按下去还没松开的那一颗。 */
  let pressed: StartButtonKey | null = null
  let steps = 0
  return {
    get state() {
      return state
    },
    get current() {
      return current
    },
    get view() {
      return view
    },
    step(input) {
      const where = `${name} 第 ${steps} 步（${JSON.stringify(input)}）`
      if (current !== 'start') throw new Error(`${where}：标题页已经切走了（当前 ${current}），后面的步读不出它`)
      let card: string | null = null
      switch (input.e) {
        case 'tick': {
          const tick = tickStartPanel(state)
          state = tick.state
          view = tick.view
          if (tick.effect === 'exit') throw new Error(`${where}：推出了 exit —— 原版那句 System.exit(0) 在松手时就走了，不经过一拍`)
          if (tick.effect !== null) {
            card = SWITCH_OF[tick.effect].card
            current = SWITCH_OF[tick.effect].current
          }
          break
        }
        case 'move':
          state = hoverStartButton(moveStartCursor(state, input.x, input.y), buttonAt(state, input.x, input.y))
          break
        case 'press': {
          const key = buttonAt(state, input.x, input.y)
          if (key === null) throw new Error(`${where}：按在了空处 —— 产品的点击只落在按钮上，没有对应物`)
          state = pressStartButton(moveStartCursor(state, input.x, input.y), key)
          pressed = key
          break
        }
        case 'release': {
          const key = buttonAt(state, input.x, input.y)
          if (key === null || key !== pressed) {
            throw new Error(`${where}：在 ${pressed} 上按下、在 ${key} 上松开 —— 产品的点击是同一颗上的按下 + 松开`)
          }
          const released = releaseStartButton(moveStartCursor(state, input.x, input.y), key)
          state = released.state
          pressed = null
          // 「结」在原版是松手当场 System.exit(0)。产品里那颗是禁用的（`START_BUTTON_WIRING`）。
          if (released.effect !== null) throw new Error(`${where}：松手推出了 ${released.effect}，回放接不住`)
          break
        }
      }
      steps++
      return { card }
    },
  }
}
