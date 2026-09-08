import { useRef } from 'react'
import type { ReactNode } from 'react'
import { computeStageScale } from './computeStageScale'
import { imageRenderingFor } from './scaling'
import type { ScalingMode } from './scaling'
import { useViewportSize } from './useViewportSize'

export interface StageProps {
  scalingMode: ScalingMode
  /** 叠在舞台上的 UI（React 画的菜单、对话框等），随舞台一起缩放 */
  overlay?: ReactNode
  /**
   * 渲染器的挂载点：**每个面板一个子容器，调用方自己拿 ref**。
   *
   * **舞台自己不建 canvas** —— Pixi 每次挂载都要一张新的：同一张 canvas 上
   * init → destroy → 再 init 会把主线程挂住，而 StrictMode 在开发模式下走的
   * 正是这条路（详见 `scene/sceneRenderer.ts`）。
   *
   * 为什么是"几个子容器"而不是一个宿主 ref（xl-rh9.17）：一个面板一张画布，
   * 而**同一时刻只许显示一张**。两个 Pixi `Application` 各往同一个 div 里塞
   * 一张 canvas，`.stage-canvas` 又是 `width/height: 100%`，两张一起显示就会
   * 上下摞着 —— 取图页那一侧撞过这个（`replay/main.ts` 的 `hostFor`，症状是
   * 截图永远截到第一张）。所以调用方给的是几个各自 100% 的子容器，用
   * `hidden` 切。
   */
  hostContent?: ReactNode
}

/**
 * 1024×640 的逻辑舞台：在可用空间里等比缩放并居中，余下部分是 letterbox。
 *
 * canvas 的**位图**恒为 1024×640（由渲染器按 `constants.ts` 建），只有它的
 * CSS 尺寸在变。整个游戏因此可以一律用逻辑坐标作画，不必知道自己被放大了
 * 多少 —— 这是"不做响应式视野"这条决策在代码里的落点。
 */
export function Stage({ scalingMode, overlay, hostContent }: StageProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const viewport = useViewportSize(boxRef)
  const { scale, cssWidth, cssHeight } = computeStageScale(viewport)

  return (
    <div className="stage-box" ref={boxRef}>
      <div
        className="stage"
        data-testid="stage"
        data-scale={scale}
        style={{
          width: `${cssWidth}px`,
          height: `${cssHeight}px`,
          // overlay 用它把逻辑坐标系缩放到舞台尺寸
          ['--stage-scale' as string]: scale,
        }}
      >
        {/* image-rendering 是可继承属性，写在宿主上，里面那张 canvas 就跟着走，
            不需要等渲染器起来再去设它的 style。 */}
        <div
          className="stage-canvas-host"
          data-testid="stage-canvas-host"
          style={{ imageRendering: imageRenderingFor(scalingMode) }}
        >
          {hostContent}
        </div>
        {overlay ? <div className="stage-overlay">{overlay}</div> : null}
      </div>
    </div>
  )
}
