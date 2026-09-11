import type { Panel } from '../game/session'
import type { EndWorld } from './world'

/**
 * 面板世界 → end 真值那一行里**属于面板自己**的六列（`wordY` / `blankY` / `code` /
 * `picture` / `isDraw` / `isStop`）。另外几列（`current` / `card` / `repainted` / `loop` /
 * `music`）说的是面板**之外**的事，由回放那一侧现算（`end/replay.ts`）。
 *
 * 字段名与 `tools/src/devtools/EndDriver.java` 的快照逐字对应。两条横坐标不记（构造之后
 * 没人写），图片像素不记（素材归数据层）。
 */
export function snapshotEnd(w: EndWorld): {
  wordY: number
  blankY: number
  code: number
  picture: number | null
  isDraw: boolean
  isStop: boolean
} {
  return { wordY: w.wordY, blankY: w.blankY, code: w.code, picture: w.picture, isDraw: w.isDraw, isStop: w.isStop }
}

/**
 * 面板 → `CardLayout` 的卡片名。真值 `card` 记的是后者（导出器照抄 `PanelTap` 的约定）。
 * 只列结局这一条路上切得到的三块；与 GBK 源码 `GameLauncher.switchTo` 的对撞见
 * `endTrace.test.ts`。
 */
export const END_CARD_OF: Readonly<Partial<Record<Panel, string>>> = {
  end: 'endPanel',
  scene: 'scenePanel',
  menu: 'menuPanel',
}
