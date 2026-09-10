import type { AssetId } from '../assets/ids'

/**
 * 存读档面板的素材（xl-i06.9）。原版 `start.LoadAndSavePanel` 里写死的路径：
 *
 *     Reader.readImage("sources/载入/按钮/存档.png" | "读取.png")   ← 背景（按模式）
 *     Reader.readImage("sources/载入/底板.png")                     ← 每个槽的底板
 *     Reader.readImage("sources/载入/按钮/空白.png")                ← 三颗按钮三态同一张
 *     new StartAnimation(n, "载入动画" | "张小凡" | "陆雪琪" | "文敏" | "鼠标", …)
 *
 * `StartAnimation` 的帧是 `"sources/StartPanel/" + s + "/" + (i+1) + ".png"`，与
 * 开始界面同一个套路。「鼠标」那一段开始界面已经烘过（`start:cursor:*`），这里不
 * 再烘一份，直接用那几个 ID。
 *
 * 帧数写在这里（烘焙器要知道烘几帧），`assets.test.ts` 从 GBK 源码现读
 * `new StartAnimation(n, "目录"` 对撞。
 */
export const LS_IMAGES = {
  saveBackground: 'sources/载入/按钮/存档.png',
  loadBackground: 'sources/载入/按钮/读取.png',
  board: 'sources/载入/底板.png',
  blank: 'sources/载入/按钮/空白.png',
} as const

export type LsImageName = keyof typeof LS_IMAGES

export const LS_SEQUENCES = {
  buttonGlow: { dir: '载入动画', count: 4 },
  zhang: { dir: '张小凡', count: 8 },
  lu: { dir: '陆雪琪', count: 8 },
  wen: { dir: '文敏', count: 8 },
} as const

export type LsSequenceName = keyof typeof LS_SEQUENCES

export function lsImageId(name: LsImageName): AssetId {
  return `ls:${name}`
}

export function lsFrameId(name: LsSequenceName, frame: number): AssetId {
  const { count } = LS_SEQUENCES[name]
  if (!Number.isInteger(frame) || frame < 0 || frame >= count) {
    throw new RangeError(`存读档面板的 ${name} 只有 ${count} 帧，要第 ${frame} 帧`)
  }
  return `ls:${name}:${frame}`
}
