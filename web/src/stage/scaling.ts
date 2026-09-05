/**
 * 放大方式。`smooth` 是默认值 —— 原版素材是手绘位图而非像素画，
 * 双线性放大比最近邻更接近它在 CRT / LCD 上原本的样子。
 * `sharp` 留给偏好硬边的玩家。
 */
export type ScalingMode = 'smooth' | 'sharp'

export const DEFAULT_SCALING_MODE: ScalingMode = 'smooth'

/** 映射到 CSS `image-rendering`，浏览器据此选择放大插值。 */
export function imageRenderingFor(mode: ScalingMode): 'auto' | 'pixelated' {
  return mode === 'sharp' ? 'pixelated' : 'auto'
}
