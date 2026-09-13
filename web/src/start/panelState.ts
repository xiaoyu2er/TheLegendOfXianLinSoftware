import {
  createCountdown,
  createFrameAnimation,
  resetCountdown,
  startAnimation,
  startCountdown,
  stopButtonAnimation,
  stopScrollAnimation,
  updateCloud,
  updateCountdown,
  updateImage,
} from './animation'
import type { CloudDrift, CountdownTimer, FrameAnimation } from './animation'
import { START_SEQUENCES } from './assets'
import { INITIAL_START_BUTTONS, START_BUTTONS } from './buttons'
import type { StartButtonKey } from './buttons'
import {
  ABOUT_REVEAL_BASE,
  ABOUT_REVEAL_STEP,
  ABOUT_TICKS,
  ABOUT_WIDTH,
  CLOUD_START_Y,
  LOAD_TICKS,
} from './layout'

/**
 * `start.StartPanel` 那一屏的状态机（xl-4si）—— **一拍推完，不画一个像素**。
 *
 * 渲染在 `StartPanel.tsx`，驱动在 `useStartPanel.ts`。分开的理由跟场景那条线
 * 一样（`docs/MIGRATION-PLAN.md` §4）：动画的判据要是"第几帧、播没播完一
 * 循环"，就必须有一个不含画布的地方能被断言。这也正是这张票验收标准第二条
 * 要的东西 —— 截图对不出"少了云"。
 *
 * ## ⚠️ 原版的 `paint()` **改状态**，所以这里的一拍分两段
 *
 * 战斗面板那边量过：`BattlePanel.paint()` 对状态机零副作用（见 bd memory
 * `battle-paint-no-side-effect`）。**开始界面反过来**：整个过场都长在
 * `paint()` 里 ——
 *
 *     paint() → drawScroll() → 卷轴播完一循环 → isUnfolded = true
 *                            → startButtonAction()  （开载入动画、起 30 拍的表）
 *                            → startLoadAction()    （表到点了就换面板）
 *
 * 所以 `tickStartPanel()` 是「更新段 + 绘制段」两段，两段**都会改状态**。
 * 把过场挪进更新段会差一拍，而差一拍在画面上完全看不出来。
 *
 * 还有一处更细的：原版 `paint()` 里画载入动画与「回」按钮那几行，是排在
 * `drawScroll()` **之后**的，读到的是**过场之后**的状态；而云、四颗按钮、
 * 卷轴自己那几行排在它**之前**。于是「卷轴播完那一拍，载入动画当拍就出现」
 * 与「换面板那一拍，载入动画当拍就消失」都是原版的行为。下面 `composeView`
 * 收两个状态，就是为了这件事。
 */

/**
 * `BUTTON_SIGNAL`：0 起、1 承、2 转、3 回，−1 是「回」收完之后的复位值。
 *
 * ⚠️ **原版的初值是 0，不是 −1** —— Java 的 `int BUTTON_SIGNAL;` 默认 0，
 * 而 0 正是「起」。没有后果（`startButtonAction` 只在卷轴播完时才读它，
 * 而开机时卷轴没在播），但改成 −1 就不是复刻了。
 */
export type StartSignal = -1 | 0 | 1 | 2 | 3

export interface StartPanelState {
  /** 此刻在屏幕上的按钮，原版那个 `ArrayList<StartButton> buttons`。 */
  readonly buttons: readonly StartButtonKey[]
  /** 每颗按钮画的是不是「悬停」那张图 —— 原版 `buttonImage != normalImage`。 */
  readonly hover: Readonly<Record<StartButtonKey, boolean>>
  /** 原版 `StartButton.isclicked`：按下去了、还没松手。 */
  readonly clicked: Readonly<Record<StartButtonKey, boolean>>
  /** 每颗按钮身边那圈 4 帧高亮，与 `START_BUTTONS` 同序（原版 `buttonAnimations`）。 */
  readonly glow: readonly FrameAnimation[]
  /** 自绘鼠标的 8 帧。 */
  readonly cursor: FrameAnimation
  readonly cursorX: number
  readonly cursorY: number
  readonly scroll: FrameAnimation
  readonly backScroll: FrameAnimation
  readonly cloud: CloudDrift
  readonly loading: FrameAnimation
  readonly loading2: FrameAnimation
  readonly aboutTimer: CountdownTimer
  readonly loadTimer: CountdownTimer
  readonly isUnfolded: boolean
  readonly signal: StartSignal
}

/**
 * 一拍推出来的**外部动作**。状态机自己不知道换面板是什么意思。
 *
 * - `newGame` —— 原版 `switchTo("scene")` + `scenePanel.initiation("脚本1.txt")`。
 * - `loadPanel` —— 原版 `switchTo("ls")`，读档面板。**今天走不到**：「承」在
 *   `StartPanel.tsx` 里是禁用的（存档归 M6 / xl-i06.1）。
 * - `exit` —— 原版「结」那句 `System.exit(0)`。**今天也走不到**，同上，
 *   浏览器里没有对应物（见 `StartPanel.tsx` 的 `START_ACTIONS`）。
 *
 * 两条走不到的路仍然照原版实现，因为**状态机是可以直接驱动的**：
 * `panelState.test.ts` 里就是按下去再松手把它们跑出来的。留个 `throw` 或者
 * 干脆不写，等于让"这条路复刻对没对"永远没人能问。
 */
export type StartEffect = 'newGame' | 'loadPanel' | 'exit'

const KEYS = START_BUTTONS.map((b) => b.key)

function allFalse(): Record<StartButtonKey, boolean> {
  const record = {} as Record<StartButtonKey, boolean>
  for (const key of KEYS) record[key] = false
  return record
}

export function createStartPanelState(): StartPanelState {
  return {
    buttons: INITIAL_START_BUTTONS,
    hover: allFalse(),
    clicked: allFalse(),
    glow: KEYS.map(() => createFrameAnimation(START_SEQUENCES.buttonGlow.count)),
    cursor: createFrameAnimation(START_SEQUENCES.cursor.count),
    cursorX: 0,
    cursorY: 0,
    scroll: createFrameAnimation(START_SEQUENCES.scroll.count),
    backScroll: createFrameAnimation(START_SEQUENCES.backScroll.count),
    cloud: { y: CLOUD_START_Y, isChange: false },
    loading: createFrameAnimation(START_SEQUENCES.loading.count),
    loading2: createFrameAnimation(START_SEQUENCES.loading2.count),
    aboutTimer: createCountdown(),
    loadTimer: createCountdown(),
    isUnfolded: false,
    // 原版 `int BUTTON_SIGNAL;` 的默认值，见 `StartSignal` 的头注。
    signal: 0,
  }
}

const indexOfKey = (key: StartButtonKey): number => KEYS.indexOf(key)

function withGlow(
  state: StartPanelState,
  key: StartButtonKey,
  change: (a: FrameAnimation) => FrameAnimation,
): readonly FrameAnimation[] {
  const at = indexOfKey(key)
  return state.glow.map((a, i) => (i === at ? change(a) : a))
}

/* ————————————————— 输入 ————————————————— */

/**
 * 鼠标移到某颗按钮上（`key`），或者一颗都没有（`null`）—— 原版
 * `mouseMoved` 里那圈 `button.isMoveIn(x, y)`。
 *
 * **命中判定不在这里**：它归 DOM，按钮元素占的就是那个往左上挪了 (15, 6) 的
 * 命中框（理由与那一个像素的代价见 `buttons.ts`）。这里只收"进了哪一颗"。
 * 自己再算一遍坐标，就是留下第二套判定 —— 而两套判定不一致的表现是"按钮
 * 有时候点得着有时候点不着"。
 *
 * 原版那圈循环会把**其余每一颗**都按"没进"处理，所以进一颗等于出所有别的。
 */
export function hoverStartButton(
  state: StartPanelState,
  key: StartButtonKey | null,
): StartPanelState {
  const hover = { ...state.hover }
  let glow = state.glow
  for (const active of state.buttons) {
    const inside = active === key
    hover[active] = inside
    const at = indexOfKey(active)
    glow = glow.map((a, i) =>
      i === at ? (inside ? startAnimation(a) : stopButtonAnimation(a)) : a,
    )
  }
  // 什么都没变就原样返回。**这不是优化，是必需的**：原版 `mouseMoved` 每动
  // 一个像素就重跑一遍，而 web 端 `onMouseMove` 也是 —— 每次都造新对象的话
  // 就是每个鼠标事件一次重渲染。判据是"逐个字段都没变"，不是"key 没变"：
  // 按下之后 key 没变而高亮该续播，那一次必须真的返回新状态。
  const same =
    state.buttons.every((k) => hover[k] === state.hover[k]) &&
    glow.every((a, i) => a === state.glow[i])
  return same ? state : { ...state, hover, glow }
}

/**
 * 原版 `mousePressed`：按住的那颗换成按下图、`isclicked = true`、**高亮停掉**。
 *
 * `key` 为 `null` 是按在空处：那圈 `isPressedButton` 对每一颗都走框外那支，只把图换回常态，
 * 一个 `isclicked` 都不碰（xl-4zo）。
 */
export function pressStartButton(state: StartPanelState, key: StartButtonKey | null): StartPanelState {
  const hover = { ...state.hover }
  const clicked = { ...state.clicked }
  for (const active of state.buttons) hover[active] = active === key
  if (key === null) return { ...state, hover }
  clicked[key] = true
  return { ...state, hover, clicked, glow: withGlow(state, key, stopButtonAnimation) }
}

/**
 * 原版 `mouseReleased`：**先** `setButton()`（读的是 `isclicked`），**再**那圈
 * `isRelesedButton` 把 `isclicked` 清掉。顺序反过来就什么都不会发生。
 *
 * ⚠️ 那圈循环走的是 `setButton()` **之后**的列表。点「回」时 `setButton()` 先
 * `buttons.remove(back)`，于是「回」的 `isclicked` 没人清，**一直留着真**（xl-whk 的
 * start-about 真值第 37 步起读得到）。后果是下一次展开「关于我们」时，点任何一颗按钮
 * 松手都会走 `setButton()` 那句 `back.isIsclicked()` —— 当场收起。照抄。
 *
 * `key` 为 `null` 是松在空处（xl-4zo）。`setButton()` 不看坐标，所以在按钮上按下、拖出框
 * 松手**照样触发**；而框外那支 `isRelesedButton` 只换图、不清 `isclicked`，于是那一颗的
 * `isclicked` 从此留着真 —— 下一次在哪儿松手（哪怕按下、松开都在空处）都会再触发一次。
 * `start-drag-out` 那份真值走到了这两件事。照抄。
 */
export function releaseStartButton(
  state: StartPanelState,
  key: StartButtonKey | null,
): { readonly state: StartPanelState; readonly effect: StartEffect | null } {
  const acted = setButton(state)
  const hover = { ...acted.state.hover }
  const clicked = { ...acted.state.clicked }
  for (const active of acted.state.buttons) hover[active] = active === key
  if (key !== null && acted.state.buttons.includes(key)) clicked[key] = false
  return { state: { ...acted.state, hover, clicked }, effect: acted.effect }
}

/** 自绘鼠标画在哪儿。原版每个鼠标事件都在更新 `currentX` / `currentY`。 */
export function moveStartCursor(state: StartPanelState, x: number, y: number): StartPanelState {
  return state.cursorX === x && state.cursorY === y ? state : { ...state, cursorX: x, cursorY: y }
}

/** 原版 `setButton()`，逐句照抄（连"四个 if 并列、不是 else if"也照抄）。 */
function setButton(state: StartPanelState): {
  readonly state: StartPanelState
  readonly effect: StartEffect | null
} {
  let next = state
  if (!state.isUnfolded) {
    if (state.clicked.newGame) next = { ...next, scroll: startAnimation(next.scroll), signal: 0 }
    if (state.clicked.load) next = { ...next, scroll: startAnimation(next.scroll), signal: 1 }
    if (state.clicked.about) {
      next = {
        ...next,
        scroll: startAnimation(next.scroll),
        aboutTimer: startCountdown(next.aboutTimer, ABOUT_TICKS),
        signal: 2,
      }
    }
    // 原版这里是 `System.exit(0)`：**立刻**退，不走卷轴过场。
    if (state.clicked.end) return { state: next, effect: 'exit' }
    return { state: next, effect: null }
  }
  if (state.clicked.goBack) {
    next = {
      ...next,
      buttons: next.buttons.filter((k) => k !== 'goBack'),
      aboutTimer: startCountdown(next.aboutTimer, ABOUT_TICKS),
      backScroll: startAnimation(next.backScroll),
      signal: 3,
    }
  }
  return { state: next, effect: null }
}

/* ————————————————— 一拍 ————————————————— */

/** 原版那条 100 ms 线程的循环体，`repaint()` 之前的部分。 */
function updatePhase(state: StartPanelState): StartPanelState {
  return {
    ...state,
    // 原版每一拍都先 `mouse.startMouseAnimation()` 再 `updateImage()` ——
    // 鼠标那 8 帧因此**永远在转**，从来不停。
    cursor: updateImage(startAnimation(state.cursor)),
    glow: state.glow.map(updateImage),
    scroll: updateImage(state.scroll),
    backScroll: updateImage(state.backScroll),
    cloud: updateCloud(state.cloud),
    loading: updateImage(state.loading),
    loading2: updateImage(state.loading2),
    aboutTimer: updateCountdown(state.aboutTimer),
    loadTimer: updateCountdown(state.loadTimer),
  }
}

/** 原版 `startButtonAction()`：卷轴刚展开完的那一拍做什么。 */
function startButtonAction(state: StartPanelState): StartPanelState {
  switch (state.signal) {
    case 0:
    case 1:
      return {
        ...state,
        loading: startAnimation(state.loading),
        loading2: startAnimation(state.loading2),
        loadTimer: startCountdown(state.loadTimer, LOAD_TICKS),
      }
    case 2:
      return { ...state, buttons: [...state.buttons, 'goBack'] }
    default:
      return state
  }
}

/**
 * 原版 `startLoadAction()`：卷轴已经展开着，表到点了就换面板。
 *
 * ⚠️ 它**不复位 `signal`**（原版也不），所以换过去之后 signal 还是 0 / 1。
 */
function startLoadAction(state: StartPanelState): {
  readonly state: StartPanelState
  readonly effect: StartEffect | null
} {
  if (state.signal !== 0 && state.signal !== 1) return { state, effect: null }
  if (!state.loadTimer.isCompleted) return { state, effect: null }
  return {
    state: {
      ...state,
      loading: stopButtonAnimation(state.loading),
      loading2: stopButtonAnimation(state.loading2),
      loadTimer: resetCountdown(),
      isUnfolded: false,
    },
    effect: state.signal === 0 ? 'newGame' : 'loadPanel',
  }
}

/** 卷轴收尾时那两句连着调的 stop。净效果：停下 + 回第 0 帧 + 清 `isLoop`。 */
const settleScroll = (a: FrameAnimation): FrameAnimation =>
  stopButtonAnimation(stopScrollAnimation(a))

/** 原版 `drawScroll()` 里那些**改状态**的部分。 */
function paintTransitions(state: StartPanelState): {
  readonly state: StartPanelState
  readonly effect: StartEffect | null
} {
  if (!state.isUnfolded) {
    if (!state.scroll.isLoop) return { state, effect: null }
    return {
      state: startButtonAction({
        ...state,
        scroll: settleScroll(state.scroll),
        isUnfolded: true,
      }),
      effect: null,
    }
  }
  // 原版这里 `startLoadAction()` 排在 `if (backScroll.isLoop())` **之前**。
  const after = startLoadAction(state)
  let next = after.state
  if (next.backScroll.isLoop) {
    next = {
      ...next,
      backScroll: settleScroll(next.backScroll),
      isUnfolded: false,
      signal: -1,
    }
  }
  return { state: next, effect: after.effect }
}

/* ————————————————— 视图 ————————————————— */

export interface StartButtonView {
  readonly key: StartButtonKey
  /** 画常态图还是悬停图。 */
  readonly hover: boolean
  /** 身边那圈高亮此刻是第几帧。**永远有一帧**：原版 `drawButton` 无条件画它。 */
  readonly glowFrame: number
}

/** 卷轴那一层：展开中画 `卷轴`，展开完画 `反向卷轴`（两者都画在同一个位置）。 */
export interface StartScrollView {
  readonly sequence: 'scroll' | 'backScroll'
  readonly frame: number
}

export interface StartView {
  readonly cloudY: number
  /** 屏幕上那几颗按钮，**不含「回」**（原版把它排在卷轴后面单独画）。 */
  readonly buttons: readonly StartButtonView[]
  readonly scroll: StartScrollView
  /**
   * 「关于我们」露出来多宽（左对齐，不缩放）。`null` = 这一拍不画它，
   * `ABOUT_WIDTH` = 整幅（原版 `drawImage(img, 0, 0, this)` 那一支）。
   */
  readonly aboutWidth: number | null
  /** 载入动画此刻第几帧，`null` = 停着（原版 `if (isStop != true)`）。 */
  readonly loadingFrame: number | null
  readonly loading2Frame: number | null
  /** 「回」按钮，`null` = 此刻不在屏幕上。 */
  readonly goBack: StartButtonView | null
  readonly cursorFrame: number
  readonly cursorX: number
  readonly cursorY: number
}

function buttonView(state: StartPanelState, key: StartButtonKey): StartButtonView {
  return {
    key,
    hover: state.hover[key],
    glowFrame: state.glow[indexOfKey(key)]!.frame,
  }
}

/**
 * 「关于我们」这一拍露多宽。三支全部照抄 `drawScroll()`：
 *
 *     !isUnfolded && signal == 2  →  100 * (9 - aboutTimer.timeLeft)   逐段揭开
 *      isUnfolded && signal == 3  →  100 * aboutTimer.timeLeft         逐段收回
 *      isUnfolded && signal == 2  →  整幅
 */
function aboutWidth(state: StartPanelState): number | null {
  if (!state.isUnfolded) {
    return state.signal === 2
      ? ABOUT_REVEAL_STEP * (ABOUT_REVEAL_BASE - state.aboutTimer.timeLeft)
      : null
  }
  if (state.signal === 3) return ABOUT_REVEAL_STEP * state.aboutTimer.timeLeft
  return state.signal === 2 ? ABOUT_WIDTH : null
}

/**
 * 把两个状态拼成一帧画面。
 *
 * `before` 是过场**之前**的状态（云、四颗按钮、卷轴与关于我们读它），
 * `after` 是过场**之后**的（载入动画与「回」按钮读它）—— 原版 `paint()` 里
 * 这几行就分居 `drawScroll()` 两侧，见本文件头注。
 */
function composeView(
  before: StartPanelState,
  after: StartPanelState,
  scroll: StartScrollView,
): StartView {
  return {
    cloudY: before.cloud.y,
    buttons: before.buttons
      .filter((key) => key !== 'goBack')
      .map((key) => buttonView(before, key)),
    scroll,
    aboutWidth: aboutWidth(before),
    loadingFrame: after.loading.isStop ? null : after.loading.frame,
    loading2Frame: after.loading2.isStop ? null : after.loading2.frame,
    goBack: after.buttons.includes('goBack') ? buttonView(after, 'goBack') : null,
    cursorFrame: after.cursor.frame,
    cursorX: after.cursorX,
    cursorY: after.cursorY,
  }
}

function scrollView(state: StartPanelState): StartScrollView {
  return state.isUnfolded
    ? { sequence: 'backScroll', frame: state.backScroll.frame }
    : { sequence: 'scroll', frame: state.scroll.frame }
}

/**
 * **不推进**、只看这一拍该画什么 —— 挂载之后、第一拍之前的那一帧用它。
 *
 * 原版没有这个时刻（Swing 一构造完就 `repaint()` 一次，而那次 `paint()` 是
 * 会改状态的）。这里刻意不改：开机那一帧不该因为"被画了一次"就往前走。
 * 两者差不出东西来，因为开机时 `scroll.isLoop` 与 `backScroll.isLoop` 都是
 * `false`，`drawScroll()` 那两支一支都不会触发 —— 这条由
 * `panelState.test.ts` 现跑一遍钉住，不是推出来的。
 */
export function startView(state: StartPanelState): StartView {
  return composeView(state, state, scrollView(state))
}

export interface StartTick {
  readonly state: StartPanelState
  readonly view: StartView
  readonly effect: StartEffect | null
}

/** 一拍：更新段 + 绘制段。两段都会改状态，见本文件头注。 */
export function tickStartPanel(state: StartPanelState): StartTick {
  const updated = updatePhase(state)
  // 卷轴与「关于我们」的宽度都在过场**之前**算 —— 原版 `drawScroll()` 里
  // 那两句 drawImage 排在 `if (scroll.isLoop())` 上面。
  const scroll = scrollView(updated)
  const { state: next, effect } = paintTransitions(updated)
  return { state: next, view: composeView(updated, next, scroll), effect }
}
