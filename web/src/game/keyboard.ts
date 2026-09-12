import { isArrowKey } from '../state/types'
import type { InputEvent } from '../state/types'

/**
 * 浏览器键盘事件 → 状态层的输入事件。
 *
 * 纯函数，入参是 `KeyboardEvent` 里用得到的那几个字段：这样它能在没有 DOM
 * 的地方测，也不会顺手把 `preventDefault` 之类的副作用混进来。
 */
export interface RawKey {
  readonly type: 'keydown' | 'keyup'
  /** `KeyboardEvent.key`，如 `ArrowLeft`。 */
  readonly key: string
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
}

export const ARROWS: Readonly<Record<string, string>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

/**
 * 方向键之外认下来的键。
 *
 * `space` 是原版的：搭话、推进对话、翻页都走它（`ScenePanel.keyPressed` 里
 * `KeyEvent.VK_SPACE` 那几条分支），trace 里也是这个名字，所以状态层收到的
 * 键名与真值逐字一致。
 *
 * `enter` 是原版的（`SelectEvent.keyPressed` 的 `VK_ENTER`，trace 里也是这个
 * 名字）。**跳过逐字打印**那个加出来的功能也搭在它上面，而**不是**搭在空格上：
 * 真值里的空格永远只在整句打完或整屏打满之后才按下，往空格上加一条"打印中
 * 就跳过"的分支，逐 tick 比对一次都踩不到，那条分支会成为状态层唯一没有真值
 * 管着的行为，而它改的恰恰是别人都在对齐的那个游标。详见 `state/dialogue.ts`
 * 的 `skipPrinting`。
 */
export const KEYS: Readonly<Record<string, string>> = {
  ' ': 'space',
  Spacebar: 'space',
  // 回车有两个身份，**分辨它们的是选择框开没开着**（`state/step.ts` 的
  // `applyInput`）：开着时它是原版的确认键（`SelectEvent.keyPressed` 的
  // `VK_ENTER`，真值里就叫 `enter`）；没开着时它是那个加出来的"跳过逐字打印"。
  // 所以这里发的键名一律是 `enter` —— 发两个名字的话，"这一下该给谁"就得在
  // 键盘层判一次选择框状态，而键盘层看不见世界。
  Enter: 'enter',
}

/**
 * 跑步键。
 *
 * 原版用的是控制键（`ScenePanel.keyPressed` 的 `isControl`）。**在 macOS 上
 * Ctrl+←/→ 是系统级的切换桌面**，事件根本到不了页面，只认 Ctrl 就等于在 Mac
 * 上跑不起来。所以这里 Shift 也算——多认一个键不改变任何游戏逻辑，
 * 状态层收到的仍然只是 `ctrl: true`。
 *
 * @exception ADR-0001#shift-also-runs
 */
function isRunModifier(raw: RawKey): boolean {
  return raw.ctrlKey || raw.shiftKey
}

/** 认不出来的键返回 `null`——调用方据此决定要不要 `preventDefault`。 */
export function toInputEvent(raw: RawKey): InputEvent | null {
  const arrow = ARROWS[raw.key]
  if (arrow !== undefined && isArrowKey(arrow)) {
    return raw.type === 'keydown'
      ? { e: 'press', k: arrow, ctrl: isRunModifier(raw) }
      : { e: 'release', k: arrow }
  }
  const key = KEYS[raw.key]
  if (key === undefined) return null
  // 松开非方向键状态层一概不理（`ScenePanel.keyReleased` 的 switch 里只有四个
  // 方向键），但仍然认下来 —— 调用方要靠返回值决定 preventDefault，
  // 不认就会让空格把页面滚下去。
  return raw.type === 'keydown' ? { e: 'press', k: key, ctrl: isRunModifier(raw) } : { e: 'release', k: key }
}
