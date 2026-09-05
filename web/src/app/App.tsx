import { useRef, useState } from 'react'
import { Stage } from '../stage/Stage'
import { DEFAULT_SCALING_MODE } from '../stage/scaling'
import type { ScalingMode } from '../stage/scaling'
import { useFullscreen } from '../stage/useFullscreen'

export function App() {
  /**
   * 全屏的目标是这个外层容器，而**不是**舞台本身。
   *
   * 全屏时浏览器只渲染全屏元素的子树：如果只把舞台送进全屏，工具栏会整个消失，
   * 玩家就只剩 Esc 一条退路了。凡是全屏下还要能点的东西，都得在这个容器里面。
   */
  const shellRef = useRef<HTMLDivElement>(null)
  const [scalingMode, setScalingMode] = useState<ScalingMode>(DEFAULT_SCALING_MODE)
  const fullscreen = useFullscreen(shellRef)

  return (
    <div className="app-shell" ref={shellRef}>
      <Stage scalingMode={scalingMode} />
      <div className="toolbar">
        <button
          type="button"
          onClick={fullscreen.toggle}
          disabled={!fullscreen.supported}
          title={fullscreen.supported ? undefined : '当前浏览器不支持全屏'}
        >
          {fullscreen.isFullscreen ? '退出全屏' : '全屏'}
        </button>
        <button
          type="button"
          aria-pressed={scalingMode === 'sharp'}
          onClick={() =>
            setScalingMode((mode) => (mode === 'smooth' ? 'sharp' : 'smooth'))
          }
        >
          放大：{scalingMode === 'smooth' ? '平滑' : '锐利'}
        </button>
      </div>
    </div>
  )
}
