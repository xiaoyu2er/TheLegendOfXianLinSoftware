import type { TreasureBoxState } from '../state/treasure'
import { isFullWidth } from './narratageLayout'
import type { Cell } from './narratageLayout'
import type { SceneViewport } from './viewport'

/**
 * 「得到物品」提示框与宝箱的摆位（xl-yg6.10）。**每一个数都照抄
 * `src/scene/EquipmentEvent.java` 的 `drawPresentation` 与
 * `src/scene/TreasureBox.java` 的 `paintBox`**，由 `presentLayout.test.ts`
 * 从 GBK 源码现读核对。
 *
 * 真值不记这些：状态层记的是 `x`（提示框滑到哪）与 `boxes[].empty`，它们落到
 * 画布上哪个像素是这一层的事。
 */

/** `g.drawImage(提示框.png, x_presentImage, 288, scene)`：框的上边。 */
export const PRESENT_Y = 288
/** `g.drawString(bufferedText, x_presentImage + 20, 320)`：正文相对框左边的偏移。 */
export const PRESENT_TEXT_DX = 20
/** 同一句：正文的**基线**。 */
export const PRESENT_BASELINE = 320
/** `new Font("宋体", Font.BOLD, 30)`。宋体两端都退到默认字体，见 `src/textFont.ts`。 */
export const PRESENT_FONT_SIZE = 30
/** `g.setColor(Color.red)`。 */
export const PRESENT_COLOR = '#ff0000'

/**
 * 正文铺成的字符格，`x` 相对正文起点（`x_presentImage + 20`）。
 *
 * 规则与旁白、选择框同一条（`narratageLayout.ts` 的 `layoutLine`）：全角字按
 * 字号整格步进、半角字按浏览器量出来的宽度。那条规则是在 20 号字上量出来的；
 * **30 号字上 Java2D 给全角字的步进是不是也恰好等于字号，没有单独量过** ——
 * 这里是按同一个 `FontMetrics` 的道理推的，逐帧比对的最差帧会替它说话。
 */
export function presentCells(text: string, measure: (char: string) => number): Cell[] {
  const cells: Cell[] = []
  let x = 0
  for (const char of text) {
    cells.push({ char, x })
    x += isFullWidth(char) ? PRESENT_FONT_SIZE : measure(char)
  }
  return cells
}

/** 一个格子是地图上的 32 px（`scene.Map.CS`）。 */
const TILE = 32
/** `firstTileX * 8`：`OtherEvent` 的镜头单位（与 `npcLayerOffset` 同一个量）。 */
const MAP_UNIT = 8

/**
 * `TreasureBox.paintBox`：`x * 32 - firstTileX * 8`、`y * 32 - firstTileY * 8`，
 * 开过画 `emptyBox`、没开画 `fullBox`。**画在画布坐标上**，不经过主角那个
 * `offsetX/offsetY` —— 与 NPC 同一个量（见 `viewport.ts` 的 `npcLayerOffset`）。
 */
export function boxPlacement(
  box: TreasureBoxState,
  viewport: SceneViewport,
): { readonly x: number; readonly y: number; readonly image: 'fullBox' | 'emptyBox' } {
  return {
    x: box.x * TILE - viewport.firstTileX * MAP_UNIT,
    y: box.y * TILE - viewport.firstTileY * MAP_UNIT,
    image: box.empty ? 'emptyBox' : 'fullBox',
  }
}
