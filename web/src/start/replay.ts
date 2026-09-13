import { START_BUTTONS, START_BUTTON_WIRING, startButtonHitBox } from './buttons'
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
 * 差左、上那一列 / 一行 —— `buttons.ts` 头注写了这个差与不补它的理由。
 * 这处偏离已由主干签进 ADR-0001 的例外表（键 `start-button-hitbox-dom`，2026-09-12，
 * xl-whk 评审翻出来的旧账），标记就带在 `buttons.ts` 的头注上。入库剧本的坐标都落在两者一致的内部，真落到那一像素上，状态层判据
 * 会当场对不上。
 *
 * ## 禁用的那颗：悬停不收，按下当场抛
 *
 * 同一个理由（回放的是产品）：「结」在产品里是 `<button disabled>`（`START_BUTTON_WIRING`），
 * React 对它不派发 `mouseenter` / `mousemove`，从别的按钮移过去只剩那一颗的 `mouseleave`
 * —— 等于移到了空处。所以移到禁用的按钮上按 `null` 推，原版 `isMoveIn` 只看坐标、会换图起高亮。
 * 这一差由 `start-hover-end` 那份真值走到，状态层登成例外格（`startTrace.test.ts` 的
 * `EXCEPTED`），逐帧比对登成「结」那一块的缺口（`compare/expected.ts`）。
 * ⚠️ 「React 不派发」是 jsdom 里量的（`StartPanel.test.tsx`），真浏览器没量过。
 *
 * @exception ADR-0001#start-exit-disabled
 *
 * ## 按下 / 松手分两下，落在空处也照送
 *
 * 产品的鼠标按下挂在面板上、松手挂在 window 上（`StartPanel.tsx`，xl-4zo），所以「按在空处」
 * 「在一颗上按、在别处松」都有对应物：落点不在任何一颗按钮上就按 `null` 推。仍然抛的两种：
 * 按 / 松在禁用的「结」上（浏览器对禁用的按钮不派 `mousedown` / `mouseup`，没有对应物 ——
 * ⚠️ 这一句没在真浏览器里量过），和没按下就松手（松手只在面板上按下之后才挂上）。
 * 照猜一个画出来的是另一件事。
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
  /** 按下去还没松开（产品里 window 上的松手挂着）。 */
  let held = false
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
        case 'move': {
          const key = buttonAt(state, input.x, input.y)
          state = hoverStartButton(moveStartCursor(state, input.x, input.y), key !== null && START_BUTTON_WIRING[key].enabled ? key : null)
          break
        }
        case 'press': {
          const key = buttonAt(state, input.x, input.y)
          if (key !== null && !START_BUTTON_WIRING[key].enabled) throw new Error(`${where}：按在了禁用的 ${key} 上 —— 产品里那颗点不下去，没有对应物`)
          state = pressStartButton(moveStartCursor(state, input.x, input.y), key)
          held = true
          break
        }
        case 'release': {
          const key = buttonAt(state, input.x, input.y)
          if (!held) throw new Error(`${where}：没按下就松手 —— 产品的松手只在面板上按下之后才挂上`)
          if (key !== null && !START_BUTTON_WIRING[key].enabled) throw new Error(`${where}：松在了禁用的 ${key} 上 —— 产品里那颗收不到松手，没有对应物`)
          const released = releaseStartButton(moveStartCursor(state, input.x, input.y), key)
          state = released.state
          held = false
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
