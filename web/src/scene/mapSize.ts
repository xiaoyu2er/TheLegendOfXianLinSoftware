import { TILE } from '../state/role'
import { MAP_UNIT } from './viewport'

/**
 * 地图图片尺寸与碰撞网格对不对得上 —— 渲染器 `showScene` 在贴图之前问这一句
 * （xl-i06.12 追出来的，从渲染器里抽出来是为了让它进得了 `pnpm test`）。
 *
 * 原版 `Map.drawMap` 的源矩形直接用**世界像素**：`(firstTileX*8, firstTileY*8) -
 * (lastTileX*8-8, lastTileY*8-8)`，而 `lastTileX/Y` 被视口夹在 `col*4 / row*4` 之内
 * （`viewport.ts` 的 `computeViewport`）。所以源矩形最远只到 **网格 − 8**：
 * 32×20 的静止地图是 `(0,0)-(1016,632)`。图只要盖得住这一块，原版就一个越界的
 * 像素都不取。三种处境：
 *
 * - **正好是 瓦片数 × 32** —— 照画；
 * - **比网格大**（`大迷宫.png` 2865×699，网格 2848×672）—— 照画：多出来的像素原版
 *   从来不取（load-slot2 逐帧比对硬比区逐像素相等为证）；
 * - **比网格小、但盖得住源矩形**（差 1–2 像素的那一批，xl-i06.14）—— 也照画。
 *   **这是量出来的，不是推的**（xl-czb.3，2026-09-10，openjdk 17）：用原版的
 *   `Reader.readImage` 读那 6 张短图，照 `drawMap` 那条 `drawImage` 画进一块先填满
 *   哨兵色的 1024×640 ARGB 缓冲，哨兵残留 **0**、逐像素等于
 *   `floor((i + 0.5) × 源 / 目标)` 最近邻公式、取到的最大源列/行 1015/631 —— 缺的那
 *   一两列一行根本不在源矩形里。跨端逐帧比对的 `mapshort-*` 三条剧本是它的判据。
 * - **比源矩形还小** —— 硬失败。这时源矩形真的越出图片，而原版此时的画法**不一样**：
 *   同一个探针把源矩形改成 `(0,0)-(1024,640)` 故意越界，1022×640 那张留下 1280 个
 *   哨兵像素（x ≥ 1022 两整列没画），1023×639 那张留下 1663 个、而且最左一个在
 *   x=0 —— 不是简单地少画一条边。那条路今天没有场景走得到，没有复刻；拉伸、补边、
 *   夹取都会画出「看起来对」的画面，所以宁可抛。
 */
export function checkMapSize(
  script: string,
  mapName: string,
  image: { readonly width: number; readonly height: number },
  col: number,
  row: number,
): void {
  const width = col * TILE - MAP_UNIT
  const height = row * TILE - MAP_UNIT
  if (image.width < width || image.height < height) {
    throw new Error(
      `${script} 的地图 ${mapName} 是 ${image.width}×${image.height}，` +
        `但碰撞网格是 ${col}×${row} 瓦片，原版的源矩形最远取到 ${width}×${height}。` +
        `源矩形越出图片时原版的画法没有复刻 —— 见 xl-czb.3`,
    )
  }
}
