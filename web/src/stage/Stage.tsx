import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { computeStageScale } from './computeStageScale'
import { STAGE_HEIGHT, STAGE_WIDTH } from './constants'
import { imageRenderingFor } from './scaling'
import type { ScalingMode } from './scaling'
import { useViewportSize } from './useViewportSize'
import { drawPlaceholder } from './drawPlaceholder'

export interface StageProps {
  scalingMode: ScalingMode
  /** 叠在舞台上的 UI（React 画的菜单、对话框等），随舞台一起缩放 */
  overlay?: ReactNode
}

/**
 * 1024×640 的逻辑舞台：在可用空间里等比缩放并居中，余下部分是 letterbox。
 *
 * canvas 的**位图**恒为 1024×640，只有它的 CSS 尺寸在变。整个游戏因此可以
 * 一律用逻辑坐标作画，不必知道自己被放大了多少 —— 这是"不做响应式视野"
 * 这条决策在代码里的落点。
 */
export function Stage({ scalingMode, overlay }: StageProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewport = useViewportSize(boxRef)
  const { scale, cssWidth, cssHeight } = computeStageScale(viewport)

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) drawPlaceholder(ctx)
  }, [])

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
        <canvas
          ref={canvasRef}
          className="stage-canvas"
          width={STAGE_WIDTH}
          height={STAGE_HEIGHT}
          style={{ imageRendering: imageRenderingFor(scalingMode) }}
        />
        {overlay ? <div className="stage-overlay">{overlay}</div> : null}
      </div>
    </div>
  )
}
