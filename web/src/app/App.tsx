import { useRef, useState } from 'react'
import { SCENE_NAMES, START_SCENE } from '../data/scenes'
import { Stage } from '../stage/Stage'
import { DEFAULT_SCALING_MODE } from '../stage/scaling'
import type { ScalingMode } from '../stage/scaling'
import { useFullscreen } from '../stage/useFullscreen'
import { useSceneRenderer } from '../scene/useSceneRenderer'
import { useGame } from '../game/useGame'
import { devToolsEnabled } from './devTools'

export function App() {
  /**
   * 全屏的目标是这个外层容器，而**不是**舞台本身。
   *
   * 全屏时浏览器只渲染全屏元素的子树：如果只把舞台送进全屏，工具栏会整个消失，
   * 玩家就只剩 Esc 一条退路了。凡是全屏下还要能点的东西，都得在这个容器里面。
   */
  const shellRef = useRef<HTMLDivElement>(null)
  const stageHostRef = useRef<HTMLDivElement>(null)
  const [scalingMode, setScalingMode] = useState<ScalingMode>(DEFAULT_SCALING_MODE)
  const [sceneName, setSceneName] = useState<string>(START_SCENE)
  const fullscreen = useFullscreen(shellRef)
  const { status, renderer } = useSceneRenderer(stageHostRef, sceneName)
  // 方向键走动、按住 Ctrl（或 Shift）跑动。世界的推进与画面无关，见 useGame。
  useGame(renderer, sceneName)

  return (
    <div className="app-shell" ref={shellRef}>
      <Stage
        scalingMode={scalingMode}
        hostRef={stageHostRef}
        overlay={
          status.kind === 'ready' ? null : (
            <p className={`stage-notice stage-notice--${status.kind}`} role="status">
              {status.kind === 'loading' ? `正在载入 ${sceneName}…` : status.message}
            </p>
          )
        }
      />
      <div className="toolbar">
        {devToolsEnabled() ? (
          <label className="toolbar-field">
            场景
            <select value={sceneName} onChange={(e) => setSceneName(e.target.value)}>
              {SCENE_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className="toolbar-hint">方向键走动，按住 Ctrl 或 Shift 跑动</p>
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
