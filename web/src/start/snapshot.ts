import type { CountdownTimer, FrameAnimation } from './animation'
import type { StartButtonKey } from './buttons'
import type { StartPanelState } from './panelState'

/**
 * 状态机 → start 真值那一行里**属于面板自己**的那几列（xl-whk）。另外几列（`current` /
 * `card` / `music`）说的是面板**之外**的事，由回放那一侧现算（`start/replay.ts`）。
 *
 * 字段名与 `tools/src/devtools/StartDriver.java` 的快照逐字对应；按钮用**原版的字段名**
 * （`start` / `load` / `about` / `end` / `back`），不是 web 的逻辑名 —— 真值说的是原版。
 */

/**
 * web 逻辑名 → 原版 `StartPanel` 的字段名。只有两处不同：「起」原版叫 `start`，「回」原版叫
 * `back`（web 叫 `goBack`，因为 `back` 已经是背景图，见 `buttons.ts`）。与 GBK 源码的对撞见
 * `startTrace.test.ts`。
 */
export const JAVA_BUTTON_NAME: Readonly<Record<StartButtonKey, string>> = {
  newGame: 'start',
  load: 'load',
  about: 'about',
  end: 'end',
  goBack: 'back',
}

/** 真值里 `buttons` 那一格的键序：原版 `initialButtons()` 的顺序，也就是 `START_BUTTONS` 的顺序。 */
const KEYS: readonly StartButtonKey[] = ['newGame', 'load', 'about', 'end', 'goBack']

export interface AnimSnapshot {
  frame: number
  next: number
  isStop: boolean
  isLoop: boolean
}

const anim = (a: FrameAnimation): AnimSnapshot => ({ frame: a.frame, next: a.next, isStop: a.isStop, isLoop: a.isLoop })

const timer = (t: CountdownTimer) => ({ timeLeft: t.timeLeft, isCompleted: t.isCompleted, isStarted: t.isStarted })

/**
 * `image`：原版按对象同一性对三个构造参数认（normal / hover / pressed）。**悬停与按下是同一个
 * 缓存对象**（`起2.png` 传了两遍，真值里按下之后读出来就是 `hover`），而 web 只有一个 `hover`
 * 布尔 —— 所以这里只可能交出 `normal` / `hover`，真值哪天读出 `pressed` 就是对不上。
 */
export function snapshotStart(s: StartPanelState) {
  const buttons: Record<string, { image: 'normal' | 'hover'; clicked: boolean; glow: AnimSnapshot }> = {}
  KEYS.forEach((key, i) => {
    buttons[JAVA_BUTTON_NAME[key]] = {
      image: s.hover[key] ? 'hover' : 'normal',
      clicked: s.clicked[key],
      glow: anim(s.glow[i]!),
    }
  })
  return {
    onScreen: s.buttons.map((k) => JAVA_BUTTON_NAME[k]),
    buttons,
    mouse: { x: s.cursorX, y: s.cursorY, anim: anim(s.cursor) },
    scroll: anim(s.scroll),
    backScroll: anim(s.backScroll),
    loading: anim(s.loading),
    loading2: anim(s.loading2),
    cloud: { y: s.cloud.y, isChange: s.cloud.isChange },
    aboutTimer: timer(s.aboutTimer),
    loadTimer: timer(s.loadTimer),
    isUnfolded: s.isUnfolded,
    signal: s.signal,
  }
}
