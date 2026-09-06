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

const ARROWS: Readonly<Record<string, string>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

/**
 * 跑步键。
 *
 * 原版用的是控制键（`ScenePanel.keyPressed` 的 `isControl`）。**在 macOS 上
 * Ctrl+←/→ 是系统级的切换桌面**，事件根本到不了页面，只认 Ctrl 就等于在 Mac
 * 上跑不起来。所以这里 Shift 也算——多认一个键不改变任何游戏逻辑，
 * 状态层收到的仍然只是 `ctrl: true`。
 */
function isRunModifier(raw: RawKey): boolean {
  return raw.ctrlKey || raw.shiftKey
}

/** 认不出来的键返回 `null`——调用方据此决定要不要 `preventDefault`。 */
export function toInputEvent(raw: RawKey): InputEvent | null {
  const k = ARROWS[raw.key]
  if (k === undefined || !isArrowKey(k)) return null
  return raw.type === 'keydown' ? { e: 'press', k, ctrl: isRunModifier(raw) } : { e: 'release', k }
}
