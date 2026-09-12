import { STAGE_HEIGHT, STAGE_WIDTH } from './constants'

export interface Viewport {
  width: number
  height: number
}

export interface StageLayout {
  /** 逻辑像素 → CSS 像素的等比系数 */
  scale: number
  /** 舞台在页面上占据的 CSS 尺寸 */
  cssWidth: number
  cssHeight: number
  /** letterbox 边条厚度（左右各一条 / 上下各一条，二者至少一个为 0） */
  barX: number
  barY: number
}

/**
 * 把 1024×640 等比塞进视口并居中，短边贴边、长边留 letterbox。
 *
 * 原版窗口 `setResizable(false)`、不居中（`setMiddle()` 的唯一调用点被注释掉）；
 * 这里随窗口缩放、居中、可全屏 —— xl-9bd.1 脚手架时定的，理由只写在那个提交里。
 * @exception ADR-0001#stage-scales-to-window
 *
 * 视口小于 1 像素（比如窗口最小化、元素还没测量）时退化为 scale 0，
 * 调用方据此不渲染，而不是拿 NaN 或负数去设 CSS。
 */
export function computeStageScale({ width, height }: Viewport): StageLayout {
  if (!(width > 0) || !(height > 0)) {
    return { scale: 0, cssWidth: 0, cssHeight: 0, barX: 0, barY: 0 }
  }

  const scale = Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT)
  const cssWidth = STAGE_WIDTH * scale
  const cssHeight = STAGE_HEIGHT * scale

  return {
    scale,
    cssWidth,
    cssHeight,
    barX: (width - cssWidth) / 2,
    barY: (height - cssHeight) / 2,
  }
}
