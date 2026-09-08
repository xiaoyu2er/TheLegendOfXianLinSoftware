import { useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { SCENE_NAMES, START_SCENE } from '../data/scenes'
import { Stage } from '../stage/Stage'
import { DEFAULT_SCALING_MODE } from '../stage/scaling'
import type { ScalingMode } from '../stage/scaling'
import { useFullscreen } from '../stage/useFullscreen'
import { useSceneRenderer } from '../scene/useSceneRenderer'
import { useBattleRenderer } from '../battle/render/useBattleRenderer'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/constants'
import { useGame } from '../game/useGame'
import { DialogueBox } from '../ui/DialogueBox'
import { devToolsEnabled } from './devTools'

export function App() {
  /**
   * 全屏的目标是这个外层容器，而**不是**舞台本身。
   *
   * 全屏时浏览器只渲染全屏元素的子树：如果只把舞台送进全屏，工具栏会整个消失，
   * 玩家就只剩 Esc 一条退路了。凡是全屏下还要能点的东西，都得在这个容器里面。
   */
  const shellRef = useRef<HTMLDivElement>(null)
  const sceneHostRef = useRef<HTMLDivElement>(null)
  const battleHostRef = useRef<HTMLDivElement>(null)
  const [scalingMode, setScalingMode] = useState<ScalingMode>(DEFAULT_SCALING_MODE)
  const [sceneName, setSceneName] = useState<string>(START_SCENE)
  const fullscreen = useFullscreen(shellRef)
  /**
   * 画面跟着**世界**走，不跟着选择器走（xl-9bd.12）：走到出口是世界自己换的
   * 场景，选择器只决定从哪儿开局。世界还没建好时先照选择器画。
   */
  const [game, setGame] = useState<{ scene: string | null }>({ scene: null })
  const shownScene = game.scene ?? sceneName
  const { status, renderer } = useSceneRenderer(sceneHostRef, shownScene)
  const battleRenderer = useBattleRenderer(battleHostRef)
  // 方向键走动、按住 Ctrl（或 Shift）跑动、空格搭话。世界的推进与画面无关，
  // 见 useGame；对话框是它交出来的那份状态的投影。
  //
  // **渲染器没就绪就不给它**：场景正在换的那几十毫秒里，世界已经在新场景里，
  // 而渲染器手上还是旧地图。这时候推进世界就得往旧渲染器上画，撞它那道
  // NPC 条数的校验。停一拍就是原版 `initiation` 读盘时停的那一拍。
  const view = useGame(status.kind === 'ready' ? renderer : null, sceneName, battleRenderer)
  const dialogue = view.dialogue
  if (view.scene !== game.scene) setGame({ scene: view.scene })
  const inBattle = view.panel === 'battle'

  /**
   * 一次鼠标点击 → 舞台**逻辑坐标**（1024×640）。
   *
   * 画布的位图恒为 1024×640，只有 CSS 尺寸在变（见 `stage/Stage.tsx`），
   * 所以换算就是"按外接矩形的比例缩回去"。用 `getBoundingClientRect` 而不是
   * `offsetX`：后者在有 CSS 缩放时给的是**缩放后**的像素，点得越靠右偏得
   * 越多，而画面看起来完全正常。
   */
  const onStageClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!inBattle) return
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return
    view.click(
      Math.round(((event.clientX - box.left) / box.width) * STAGE_WIDTH),
      Math.round(((event.clientY - box.top) / box.height) * STAGE_HEIGHT),
    )
  }

  return (
    <div className="app-shell" ref={shellRef}>
      <Stage
        scalingMode={scalingMode}
        hostContent={
          <>
            {/* 一个面板一张画布，`hidden` 切换 —— 两张一起显示会上下摞着。 */}
            <div className="stage-panel" ref={sceneHostRef} hidden={inBattle} />
            <div
              className="stage-panel"
              ref={battleHostRef}
              hidden={!inBattle}
              onMouseDown={onStageClick}
              data-testid="battle-host"
            />
          </>
        }
        overlay={
          <>
            {status.kind === 'ready' || inBattle ? null : (
              <p className={`stage-notice stage-notice--${status.kind}`} role="status">
                {status.kind === 'loading' ? `正在载入 ${shownScene}…` : status.message}
              </p>
            )}
            {inBattle && view.battleLoading ? (
              <p className="stage-notice stage-notice--loading" role="status">
                正在载入战斗…
              </p>
            ) : null}
            {dialogue && !inBattle ? <DialogueBox dialogue={dialogue} /> : null}
          </>
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
        <p className="toolbar-hint">
          {inBattle
            ? '战斗中：点「击」再点怪物；技、防、物同理'
            : '方向键走动，按住 Ctrl 或 Shift 跑动，空格搭话／推进对话，回车跳过逐字打印'}
        </p>
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
