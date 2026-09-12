import { useCallback, useEffect, useRef, useState } from 'react'
import type { StartButtonKey } from './buttons'
import { START_TICK_MS } from './layout'
import {
  createStartPanelState,
  hoverStartButton,
  moveStartCursor,
  pressStartButton,
  releaseStartButton,
  startView,
  tickStartPanel,
} from './panelState'
import type { StartEffect, StartPanelState, StartView } from './panelState'

/**
 * 把 `panelState.ts` 那个状态机接到 React 上（xl-4si）。**这里没有一行原版
 * 逻辑** —— 它只做三件事：按真实流逝的时间推进、把输入喂进去、把算出来的
 * 那一帧交给组件画。
 *
 * ## 为什么是 `setInterval` 加余量，而不是 `setInterval` 数拍
 *
 * 跟 `state/loop.ts` 同一个理由，也同一套写法：标签页切到后台时
 * `setInterval` 会被节流到 ~1 秒一次，**按次数数拍就会把时间数丢**（切出去
 * 十秒回来，云只飘了十拍而不是一百拍）。所以这里数的是
 * `performance.now()` 的差，一次醒来补几拍就补几拍。
 *
 * `requestAnimationFrame` 更不行：它在后台**完全不触发**，切出去再回来
 * 画面会从冻住的地方接着走。
 *
 * ## 一批里出了动作就当场收手
 *
 * 补拍的那一批里一旦有一拍推出了 `newGame`，后面的拍不该再跑 —— 原版那一拍
 * 是 `switchTo("scene")`，面板当场就换走了。接着跑等于在一个已经不在屏幕上的
 * 面板上继续推进，而那在画面上完全看不出来。
 *
 * ## 离开标题就停、回来接着那一份
 *
 * 原版的 `StartPanel` 是 `GameLauncher` 构造函数里 `new` 的**一份**，从开机活到关机
 * （唯一会重建面板的 `init()` 没人调）。所以状态**不放在这个钩子里**：调用方给一个
 * `keep`，组件卸载了它还在，回来接着用（xl-6zf，`App.tsx` 就是这么给的）。不给就是
 * 钩子自己的一份，随组件生灭 —— 单独挂 `<StartPanel>` 的测试走的是这一路。
 *
 * 活着不等于在走：原版 `startAnimationThread()` 那条线程**不管标题显不显示**都在跑，
 * 云一路往下飘。这里的计时器随组件卸载，离开的那段时间一拍都不推 —— 回来时云停在离开
 * 那一刻的坐标上，不是原版那个飘过了的坐标。与菜单那几条线程同一个取舍（xl-03x.20
 * 现扫 `new Thread` 补登）。
 * @exception ADR-0001#panel-threads-run-while-hidden
 */
export interface StartPanelHandle {
  /** 这一拍该画什么。 */
  readonly view: StartView
  /** 鼠标进了哪颗按钮（`null` = 一颗都不在）。命中判定归 DOM，见 `buttons.ts`。 */
  readonly hover: (key: StartButtonKey | null) => void
  /** 按一颗按钮：原版的 press + release 合成一次，见 `StartPanel.tsx`。 */
  readonly click: (key: StartButtonKey) => void
  /** 自绘鼠标画在哪儿（舞台逻辑坐标）。 */
  readonly moveCursor: (x: number, y: number) => void
}

/** 标题状态的存放处。组件卸载了它还在，见上面「离开标题就停、回来接着那一份」。 */
export interface StartPanelKeep {
  current: StartPanelState | null
}

export function useStartPanel(
  onEffect: (effect: StartEffect) => void,
  keep?: StartPanelKeep,
): StartPanelHandle {
  const ownRef = useRef<StartPanelState | null>(null)
  const stateRef = keep ?? ownRef
  if (stateRef.current === null) stateRef.current = createStartPanelState()
  const [view, setView] = useState<StartView>(() => startView(stateRef.current!))

  // 回调存在 ref 里：把它放进下面那个 effect 的依赖里，父组件每渲染一次就
  // 重建一次计时器，而重建会丢掉攒着的余量 —— 表现是"云偶尔顿一下"。
  const effectRef = useRef(onEffect)
  effectRef.current = onEffect

  /** 施加一次输入。**不推进时间**，所以视图用不推进的那个 `startView`。 */
  const input = useCallback((change: (state: StartPanelState) => StartPanelState) => {
    const next = change(stateRef.current!)
    stateRef.current = next
    setView(startView(next))
  }, [])

  const hover = useCallback(
    (key: StartButtonKey | null) => input((state) => hoverStartButton(state, key)),
    [input],
  )

  const moveCursor = useCallback(
    (x: number, y: number) => input((state) => moveStartCursor(state, x, y)),
    [input],
  )

  /**
   * 一次点击 = 原版的 `mousePressed` 加 `mouseReleased`。
   *
   * 分不开：DOM 的 `click` 事件是两者之后才来的一个事件，而键盘按回车根本
   * 没有前两个。拆成 `onMouseDown` / `onMouseUp` 的话，用键盘走到这颗按钮
   * 上按回车就什么都不会发生 —— 而"按钮点得动"与"只有鼠标点得动"在截图上
   * 一模一样。
   */
  const click = useCallback((key: StartButtonKey) => {
    const pressed = pressStartButton(stateRef.current!, key)
    const released = releaseStartButton(pressed, key)
    stateRef.current = released.state
    setView(startView(released.state))
    if (released.effect !== null) effectRef.current(released.effect)
  }, [])

  useEffect(() => {
    let last = performance.now()
    let carry = 0
    const id = setInterval(() => {
      const now = performance.now()
      const budget = carry + Math.max(0, now - last)
      last = now
      const ticks = Math.floor(budget / START_TICK_MS)
      carry = budget - ticks * START_TICK_MS
      if (ticks === 0) return
      let state = stateRef.current!
      let painted: StartView | null = null
      let effect: StartEffect | null = null
      for (let i = 0; i < ticks; i++) {
        const tick = tickStartPanel(state)
        state = tick.state
        painted = tick.view
        if (tick.effect !== null) {
          effect = tick.effect
          break
        }
      }
      stateRef.current = state
      if (painted !== null) setView(painted)
      if (effect !== null) effectRef.current(effect)
    }, START_TICK_MS)
    return () => clearInterval(id)
  }, [])

  return { view, hover, click, moveCursor }
}
