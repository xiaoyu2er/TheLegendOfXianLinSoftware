import { TILE } from '../state/role'

/**
 * 地图图片尺寸与碰撞网格对不对得上 —— 渲染器 `showScene` 在贴图之前问这一句
 * （xl-i06.12 追出来的，从渲染器里抽出来是为了让它进得了 `pnpm test`）。
 *
 * 原版 `Map.drawMap` 的源矩形直接用**世界像素**：`(firstTileX*8, firstTileY*8) -
 * (lastTileX*8-8, lastTileY*8-8)`，而 `lastTileX/Y` 被视口夹在网格之内
 * （`viewport.ts` 的 `computeViewport`）。于是三种处境：
 *
 * - **正好是 瓦片数 × 32** —— 照画；
 * - **比网格大**（`大迷宫.png` 2865×699，网格 2848×672）—— 照画：源矩形取不到网格
 *   之外，多出来的像素原版也从来不画，画法与相等时逐像素相同（load-slot2 逐帧比对
 *   硬比区逐像素相等为证）；
 * - **比网格小**（20 个场景，差 1–2 像素）—— 硬失败。源矩形会越出图片，原版此时
 *   走的是 Java2D 的另一种画法（⚠️ 未验证，见 xl-i06.14），照相等那一种画会在右 /
 *   下边缘画错，而那种错在画面上表现为「边上有一两列怪怪的」，不查是查不出来的。
 *
 * 从前这里只有「必须正好相等」一条，于是 22 个场景一并被拒 —— 其中两个本来画得对。
 */
export function checkMapSize(
  script: string,
  mapName: string,
  image: { readonly width: number; readonly height: number },
  col: number,
  row: number,
): void {
  const width = col * TILE
  const height = row * TILE
  if (image.width < width || image.height < height) {
    throw new Error(
      `${script} 的地图 ${mapName} 是 ${image.width}×${image.height}，` +
        `但碰撞网格是 ${col}×${row} 瓦片，应至少为 ${width}×${height}。` +
        `图比网格小时原版的画法还没复刻 —— 归 xl-i06.14`,
    )
  }
}
