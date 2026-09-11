import type { AssetId } from '../assets/ids'
import { END_PICTURE_COUNT } from './world'

/**
 * 结局面板的素材（xl-czb.6）。原版 `start.EndPanel` 里写死的路径：
 *
 *     Reader.readImage("sources/End/黑色背景.png")     ← back
 *     Reader.readImage("sources/End/结束字幕.png")     ← word
 *     Reader.readImage("sources/End/结束侧栏.png")     ← blank
 *     Reader.readImage("sources/End/" + code + ".jpg") ← 过场画，code 取 1..25
 *
 * **几张是现数的**：烘焙器扫 `sources/End/` 整个目录，每一个文件都必须落在这四类
 * 里的一类、每一类要的文件都必须在盘上 —— 两个方向各缺一个都硬失败
 * （`scripts/bake.ts` 的结局那一段）。这里的三条路径与张数由 `assets.test.ts` 从 GBK
 * 源码现读对撞。
 *
 * ⚠️ **24.jpg 也烘**，哪怕它从来没被画出来过（`world.ts` 的 `updateEnd`）：原版每一轮
 * 照样读它，缺了它 `Reader.readImage` 会报缺图。烘不烘由「原版读不读」定，不由
 * 「画不画得出来」定。
 */
export const END_IMAGES = {
  back: 'sources/End/黑色背景.png',
  word: 'sources/End/结束字幕.png',
  blank: 'sources/End/结束侧栏.png',
} as const

export type EndImageName = keyof typeof END_IMAGES

/** 过场画所在目录，与 `update()` 里拼路径用的前缀逐字相同（去掉末尾的 `/`）。 */
export const END_PICTURE_DIR = 'sources/End'

export function endImageId(name: EndImageName): AssetId {
  return `end:${name}`
}

/** 第 n 张过场画（`sources/End/<n>.jpg`），n 取 1..{@link END_PICTURE_COUNT}。 */
export function endPictureId(n: number): AssetId {
  if (!Number.isInteger(n) || n < 1 || n > END_PICTURE_COUNT) {
    throw new RangeError(`结局过场画只有 1..${END_PICTURE_COUNT} 张，要第 ${n} 张`)
  }
  return `end:picture:${n}`
}

export function endPictureSource(n: number): string {
  return `${END_PICTURE_DIR}/${n}.jpg`
}

/** 这个面板所有素材的逻辑 ID —— 渲染器一次载齐（总共二十几张，不必按需）。 */
export function endTextureIds(): AssetId[] {
  const ids: AssetId[] = (Object.keys(END_IMAGES) as EndImageName[]).map(endImageId)
  for (let n = 1; n <= END_PICTURE_COUNT; n++) ids.push(endPictureId(n))
  return ids
}
