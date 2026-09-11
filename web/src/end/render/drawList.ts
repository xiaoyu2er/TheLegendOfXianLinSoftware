import type { AssetId } from '../../assets/ids'
import { endImageId, endPictureId } from '../assets'
import type { EndWorld } from '../world'

/**
 * **原版 `EndPanel.paint()`，摊成一份有序的绘制清单**（xl-czb.6）。
 *
 * 纯函数：世界 → 一串「把哪张图贴在哪」。不碰 Pixi、不碰 DOM，次序与坐标由
 * `drawList.test.ts` 从 GBK 源码现读对撞。真实像素归跨端逐帧比对（`compare/expected.ts`
 * 的 `end-credits`）。
 *
 *     if (isDraw) {
 *       drawImage(back, 0, 0)               ← 黑色背景.png，1024×640
 *       drawImage(currentImage, 0, 0)       ← 过场画；null 时 drawImage 什么都不画
 *       drawImage(word, wordX, wordY)       ← 字幕，wordX = 0
 *       drawImage(blank, blankX, blankY)    ← 侧栏，blankX = 700
 *     }
 *
 * **`isDraw` 为假时原版一笔都不画**，缓冲图停在上一次画完的样子。这里交出空清单，由
 * 调用方决定「不画」是什么意思：进了结局之后 `isDraw` 就再没有人复位（`world.ts`），所以
 * 显示着结局的时候这一支走不到。
 */
export interface EndDrawOp {
  readonly id: AssetId
  readonly x: number
  readonly y: number
}

/** 构造函数里那两条横坐标，构造之后没人写。与 GBK 源码对撞见 `drawList.test.ts`。 */
export const END_LAYOUT = { wordX: 0, blankX: 700 } as const

export function endDrawList(w: EndWorld): EndDrawOp[] {
  if (!w.isDraw) return []
  const ops: EndDrawOp[] = [{ id: endImageId('back'), x: 0, y: 0 }]
  if (w.picture !== null) ops.push({ id: endPictureId(w.picture), x: 0, y: 0 })
  ops.push({ id: endImageId('word'), x: END_LAYOUT.wordX, y: w.wordY })
  ops.push({ id: endImageId('blank'), x: END_LAYOUT.blankX, y: w.blankY })
  return ops
}
