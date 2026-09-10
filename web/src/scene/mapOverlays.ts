import { mapOverlayAssetId } from '../assets/ids'
import type { AssetId } from '../assets/ids'
import { MAP_UNIT } from './viewport'
import type { SceneViewport } from './viewport'

/**
 * `OtherEvent.addMap` 那一层（xl-yg6.12 / xl-yg6.14）：`ScenePanel.paint()` 里画在
 * 主角与 NPC **之后**、对话框 / 选择框 / 提示框**之前**。两样东西：
 *
 * 1. 右下角的金币 HUD —— `money.png` 贴在 (925,615)，再用 `正楷` BOLD 16 白字在
 *    (940,630) 写 `Money.getCoins()`。每个场景都画。
 * 2. 大地图上的十张**遮掩图**（建筑的屋檐与门匾），主角走到下面时压在他身上。
 *    原版判的是 `getMapSet().length == 80`（碰撞网格 80 行，只有 大地图 / 大地图夜），
 *    地图名恰好是 `大地图夜.jpg` 时换带「夜」的那一套。
 *
 * 遮掩图的坐标是世界像素，画的时候减的是 `firstTile*8` —— 与 NPC 同一个量，
 * 不是主角那个 `offset`（见 `viewport.ts` 的 `npcLayerOffset`）。
 */

/** 金币图标的左上角。 */
export const COIN_ICON = { x: 925, y: 615 } as const
/** 金币数：左边缘与**基线**（`drawString` 给的是基线）。`正楷` 两端都没有，字形归 xl-9bd.17。 */
export const COIN_TEXT = { x: 940, baseline: 630, fontSize: 16, color: '#ffffff' } as const

/** 原版判「这是大地图」的那个数：`scene.getMapSet().length`，即碰撞网格的行数。 */
export const OVERLAY_MAP_ROWS = 80

/**
 * 十张遮掩图，次序照抄 `addMap` 里的十句 `drawImage`（后画的压在先画的上面）。
 * `jiaoxuelou1` 出现两次（仙一、仙二用同一张图），所以文件只有九个。
 */
const OVERLAYS: readonly { readonly file: string; readonly x: number; readonly y: number }[] = [
  { file: 'tiyuguan2', x: 918, y: 906 }, // 体育馆大门
  { file: 'tiyuguan1', x: 930, y: 780 }, // 体育馆正门
  { file: 'tiyuguan3', x: 1420, y: 394 }, // 体育馆后门
  { file: 'dahuo', x: 2028, y: 556 }, // 大活大门
  { file: 'tushuguan', x: 2590, y: 430 }, // 图书馆正门
  { file: 'jiaoxuelou1', x: 2016, y: 1476 }, // 仙一
  { file: 'jiaoxuelou1', x: 2016, y: 1124 }, // 仙二
  { file: 'yifulou', x: 2336, y: 2018 }, // 逸夫楼
  { file: 'shiyanlou1', x: 894, y: 1698 }, // 实验楼左
  { file: 'shiyanlou2', x: 1404, y: 1700 }, // 实验楼右
]

/** 金币图标的文件名（`maps/` 下，不带扩展名）。 */
export const COIN_ICON_FILE = 'money'

/**
 * 这一层要烘的全部文件（`maps/` 下，不带扩展名）：九个遮掩图各一张白天一张夜，
 * 加金币图标。烘焙器从这里取名单，与渲染器共用同一份 —— 两份名单迟早对不上。
 */
export const OVERLAY_FILES: readonly string[] = [
  ...[...new Set(OVERLAYS.map((o) => o.file))].flatMap((file) => [file, `${file}夜`]),
  COIN_ICON_FILE,
]

export interface OverlayPlacement {
  readonly asset: AssetId
  readonly x: number
  readonly y: number
}

/** 这一帧要贴的遮掩图与位置，次序即绘制次序。不是大地图就是空的。 */
export function overlayPlacements(
  mapName: string,
  rows: number,
  viewport: SceneViewport,
): OverlayPlacement[] {
  if (rows !== OVERLAY_MAP_ROWS) return []
  const night = mapName === '大地图夜.jpg' ? '夜' : ''
  return OVERLAYS.map((o) => ({
    asset: mapOverlayAssetId(`${o.file}${night}`),
    x: o.x - viewport.firstTileX * MAP_UNIT,
    y: o.y - viewport.firstTileY * MAP_UNIT,
  }))
}
