import { useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { computeStageScale } from './computeStageScale'
import { imageRenderingFor } from './scaling'
import type { ScalingMode } from './scaling'
import { useViewportSize } from './useViewportSize'

export interface StageProps {
  scalingMode: ScalingMode
  /**
   * 渲染器的挂载点。**舞台自己不建 canvas** —— Pixi 每次挂载都要一张新的：
   * 同一张 canvas 上 init → destroy → 再 init 会把主线程挂住，而 StrictMode
   * 在开发模式下走的正是这条路（详见 `scene/sceneRenderer.ts`）。
   */
  hostRef?: RefObject<HTMLDivElement | null>
  /** 叠在舞台上的 UI（React 画的菜单、对话框等），随舞台一起缩放 */
  overlay?: ReactNode
}

/**
 * 1024×640 的逻辑舞台：在可用空间里等比缩放并居中，余下部分是 letterbox。
 *
 * canvas 的**位图**恒为 1024×640（由渲染器按 `constants.ts` 建），只有它的
 * CSS 尺寸在变。整个游戏因此可以一律用逻辑坐标作画，不必知道自己被放大了
 * 多少 —— 这是"不做响应式视野"这条决策在代码里的落点。
 */
export function Stage({ scalingMode, hostRef, overlay }: StageProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const fallbackRef = useRef<HTMLDivElement>(null)
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
          ref={hostRef ?? fallbackRef}
          style={{ imageRendering: imageRenderingFor(scalingMode) }}
        />
        {overlay ? <div className="stage-overlay">{overlay}</div> : null}
      </div>
    </div>
  )
}
