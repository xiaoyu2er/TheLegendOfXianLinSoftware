import type { SlotSummary } from '../save/store'
import type { SaveLoadTarget } from './step'
import type { SaveLoadWorld } from './world'

/**
 * 面板世界 → saveload 真值那一行里**属于面板自己**的三组（`mode` / `lastPanel` /
 * `slots`）。另外三组（`current` / `intercept` / `music`）说的是面板**之外**的事
 * —— 当前是哪块面板、这一步拦下了什么跨面板动作、响了什么 —— 由回放那一侧按
 * 状态机交出来的 {@link SaveLoadEffect} 现算（`saveload/test/replayTrace.ts`）。
 *
 * 字段名、层级与 `tools/src/devtools/SaveLoadDriver.snapshotState` 逐字对应。
 */
export function snapshotSaveLoad(w: SaveLoadWorld): {
  mode: string
  lastPanel: string | null
  slots: SlotSummary[]
} {
  return {
    mode: w.mode,
    lastPanel: w.lastPanel,
    slots: w.roles.map((roles, i) => ({
      roles: [roles[0]!, roles[1]!, roles[2]!] as const,
      map: w.maps[i]!,
      task: w.tasks[i]!,
    })),
  }
}

/**
 * `switchTo(name)` → `CardLayout` 的卡片名。真值 `intercept.card` 记的是后者
 * （导出器照抄 `PanelTap` 的约定，记观察到的字符串本身）。与 GBK 源码里
 * `GameLauncher.switchTo` 的每个 `case` 对撞见 `saveloadTrace.test.ts`。
 */
export const CARD_OF: Readonly<Record<SaveLoadTarget, string>> = {
  ls: 'lsPanel',
  scene: 'scenePanel',
  menu: 'menuPanel',
  start: 'startPanel',
}
