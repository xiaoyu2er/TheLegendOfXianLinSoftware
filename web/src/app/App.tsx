import { useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from 'react'
import { SCENE_NAMES, START_SCENE } from '../data/scenes'
import { Stage } from '../stage/Stage'
import { DEFAULT_SCALING_MODE } from '../stage/scaling'
import type { ScalingMode } from '../stage/scaling'
import { useFullscreen } from '../stage/useFullscreen'
import { useSceneRenderer } from '../scene/useSceneRenderer'
import { useBattleRenderer } from '../battle/render/useBattleRenderer'
import { useMenuRenderer } from '../menu/render/useMenuRenderer'
import { useShopRenderer } from '../shop/render/useShopRenderer'
import { useShopPreview } from '../shop/render/useShopPreview'
import { useSaveLoadRenderer } from '../saveload/render/useSaveLoadRenderer'
import { useEndRenderer } from '../end/render/useEndRenderer'
import { SHOP_PREVIEW_CHOICES } from '../shop/preview'
import type { ShopPreviewChoice } from '../shop/preview'
import { wheelRows } from '../menu/scroll'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/constants'
import { useGame } from '../game/useGame'
import type { SaveLoadNotice } from '../game/useGame'
import { StartPanel } from '../start/StartPanel'
import { DialogueBox } from '../ui/DialogueBox'
import { devToolsEnabled } from './devTools'

/**
 * 场景选择器里「标题」那一项的值。空串 = `sceneName` 的 `null`。
 *
 * 导出去，是为了让 `App.test.tsx` 断言的就是这一个值 —— 两边各写一个裸
 * `''`，改掉其中一个，测试照样绿。
 */
export const TITLE_OPTION = ''

/**
 * 存读档面板上的几行字（xl-i06.9）。**画在 overlay 上，不画进 Pixi**：它们原版没有，
 * 是这一层对浏览器存储那几种状态的表态 —— 混进画布就会被当成原版画面去比。
 *
 * @exception ADR-0001#saveload-notices
 *
 * - `loading`：仓库还在从浏览器存储里读。画布这时是空的，**不画三个空槽**；
 * - `failed`：读不上来。这一次存不了也读不了，只留退出键（规格没定，本票裁定）；
 * - `persistError`：快照已经是新的、浏览器存储没写进去 —— 摘要看着存上了，关掉就没了；
 * - `loadRequest`：点中了一个档、要读进的那个场景还在取（xl-i06.10）—— 这几十毫秒里
 *   面板不再收输入，说一声为什么还停在这里。
 */
function SaveLoadNotices({
  notice,
  loading,
}: {
  readonly notice: SaveLoadNotice | null
  readonly loading: boolean
}) {
  if (notice === null) return null
  const lines: { kind: 'loading' | 'error'; text: string }[] = []
  if (notice.status === 'loading') lines.push({ kind: 'loading', text: '正在读取存档…' })
  else if (notice.status === 'failed') {
    lines.push({ kind: 'error', text: `存档读不上来：${notice.error}。这一次存不了档、也读不了档；按 Esc 回去。` })
  } else {
    if (loading) lines.push({ kind: 'loading', text: '正在载入存读档面板…' })
    if (notice.persistError !== null) {
      lines.push({ kind: 'error', text: `上一次存档没能写进浏览器存储：${notice.persistError} —— 关掉页面之后它不会留下。` })
    }
    if (notice.loadRequest !== null) {
      lines.push({
        kind: 'loading',
        text: `正在读入第 ${notice.loadRequest + 1} 个存档…`,
      })
    }
  }
  return (
    <>
      {lines.map((l) => (
        <p key={l.text} className={`stage-notice stage-notice--${l.kind}`} role="status" data-testid="ls-notice">
          {l.text}
        </p>
      ))}
    </>
  )
}

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
  const menuHostRef = useRef<HTMLDivElement>(null)
  const shopHostRef = useRef<HTMLDivElement>(null)
  const lsHostRef = useRef<HTMLDivElement>(null)
  const endHostRef = useRef<HTMLDivElement>(null)
  const [scalingMode, setScalingMode] = useState<ScalingMode>(DEFAULT_SCALING_MODE)
  /** 菜单画布此刻挂的 `title` —— 指针停在禁用的「确认离开」上时是理由（xl-03x.12）。 */
  const [menuTitle, setMenuTitle] = useState<string | null>(null)
  /**
   * **现在该在哪个场景**，`null` = 还没开局、停在标题上（xl-q7f）。
   *
   * 开机是 `null`：原版 `GameLauncher` 构造函数的最后一句是
   * `switchTo("start")`，玩家点「起」才 `initiation("脚本1.txt")`。
   *
   * 开发用的场景选择器改的也是它。**xl-q7f 之前它身兼两职**（"从哪儿开局"
   * 与"现在跳到哪儿"），开机不进场景之后这两件事分了家：选择器只说后者，
   * 「起」才是前者，而且「起」进的恒是 `START_SCENE`。选择器多出来的那个
   * 「标题」项就是 `null`，于是**开机停在标题上这件事，选择器上说得出来**
   * ——不必再靠"值是脚本1、其实在标题上"这种隐含状态。
   *
   * ⚠️ 但它**不是**"选择器上的值恒等于画面上那一屏"。全灭那条路上不成立：
   * 面板是会话自己在内部翻成 `'start'` 的（`game/session.ts` 里读
   * `exitPanel` 那一段），`sceneName` 还停在死掉的那个场景上，于是画面是
   * 标题、选择器上写着「迷宫1」。这一层没打算把它拽回去 —— 那等于让一个
   * 开发用的控件反过来去追世界的状态，而 `atTitle` 读的从来是 `view.panel`，
   * 不是它。
   */
  const [sceneName, setSceneName] = useState<string | null>(null)
  const fullscreen = useFullscreen(shellRef)
  /**
   * 画面跟着**世界**走，不跟着选择器走（xl-9bd.12）：走到出口是世界自己换的
   * 场景，选择器只决定从哪儿开局。世界还没建好时先照选择器画。
   */
  const [game, setGame] = useState<{ scene: string | null }>({ scene: null })
  /**
   * 渲染器画哪个场景。还没开局时它是 `START_SCENE` —— 场景那张画布这时是
   * 藏着的，先把「起」之后要用的那张地图**预热**上（原版也是先把
   * `ScenePanel` 造出来、再 `switchTo("start")`）。不预热的话点完「起」
   * 还要盯一会儿"正在载入 脚本1…"。
   *
   * ⚠️ **它曾经还兼着标题那一屏的曲子，现在不了**（xl-w16）。`useGame` 那条
   * pump 原先起手一句 `if (!renderer) return`，于是主题曲要等这里预热的脚本1
   * 整个载完才响 —— 实测是**零点几秒的哑场**，而被自动播放挡下来时代价更大
   * （第一次手势会被浪费掉）。**读数只有一份，不在这里抄**：数字与理由在
   * `game/useGame.ts` 那条 pump 的注释里，测法在
   * `scripts/measure-title-bgm.md`，判据在 `game/useGameBgm.test.tsx`。
   *
   * 所以这一句现在**只**为预热而存在：改掉它标题照样有声音，只是点完「起」
   * 要多盯一会儿"正在载入 脚本1…"。而"照样有声音"这件事一旦成立，预热就
   * 没有侧证了 —— 所以它自己那条判据在 `app/appPrewarm.test.tsx`。
   */
  const shownScene = game.scene ?? sceneName ?? START_SCENE
  const { status, renderer } = useSceneRenderer(sceneHostRef, shownScene)
  const battleRenderer = useBattleRenderer(battleHostRef)
  const menuRenderer = useMenuRenderer(menuHostRef)
  /**
   * **开发用的商店预览**（xl-knp.6）。
   *
   * ⚠️ 它不是进店的正路：原版进店走的是场景里的选择事件，那条路 xl-yg6.11
   * 接上了（`game/session.ts` 的 `Panel` 里的 `'shop'`，即下面的 `inShop`）。
   * 预览留着，是因为它不必先走到店主旁边就看得到两家店的骨架。
   *
   * 它**不进 `view.panel`**，只是一个盖在最上面的独立面板；选它就等于
   * 把游戏那一半先搁一边 —— 连那张商店画布也归它（见下面 `useGame` 的入参）。
   */
  const shopRenderer = useShopRenderer(shopHostRef)
  const [shopPreview, setShopPreview] = useState<ShopPreviewChoice>('none')
  const shop = useShopPreview(shopRenderer, shopPreview)
  const inShopPreview = shopPreview !== 'none'
  const saveLoadRenderer = useSaveLoadRenderer(lsHostRef)
  const endRenderer = useEndRenderer(endHostRef)
  // 方向键走动、按住 Ctrl（或 Shift）跑动、空格搭话。世界的推进与画面无关，
  // 见 useGame；对话框是它交出来的那份状态的投影。
  //
  // **渲染器没就绪就不给它**：场景正在换的那几十毫秒里，世界已经在新场景里，
  // 而渲染器手上还是旧地图。这时候推进世界就得往旧渲染器上画，撞它那道
  // NPC 条数的校验。停一拍就是原版 `initiation` 读盘时停的那一拍。
  const view = useGame(
    status.kind === 'ready' ? renderer : null,
    sceneName,
    battleRenderer,
    menuRenderer,
    // 预览开着时那张画布归预览：两边往同一个渲染器上画，谁后画谁赢，一帧一换。
    inShopPreview ? null : shopRenderer,
    saveLoadRenderer,
    endRenderer,
  )
  const dialogue = view.dialogue
  if (view.scene !== game.scene) setGame({ scene: view.scene })
  const inBattle = view.panel === 'battle'
  const inMenu = view.panel === 'menu'
  /** 从选择框那两扇门进了店（xl-yg6.11）。商店预览是另一回事，见 `inShopPreview`。 */
  const inShop = view.panel === 'shop'
  /**
   * 标题画面。**两条路走到它**：
   *
   * - 开机（xl-q7f）—— `sceneName` 是 `null`，会话起手就停在这儿，
   *   对应原版 `GameLauncher` 构造函数末尾那句 `switchTo("start")`；
   * - 全灭，而且 `GameOver` 里那只 em1 不是「罹年居士」（见 `game/session.ts`）。
   *
   * 两条路在这一层不分家：画的都是同一屏，「起」做的也都是同一件事。
   */
  const atTitle = view.panel === 'start'
  /** 存读档面板（xl-i06.9）：菜单的「存档 / 提取」或标题的「承」进来。 */
  const inLs = view.panel === 'ls'
  /**
   * 结局（xl-czb.6）：主线最后一段对话里的 `$` 按完进来。**键盘不归它**：原版当前面板
   * 仍是场景，键照旧交给看不见的场景 —— ESC 开菜单、结局被切走，照复刻（`game/session.ts`
   * 的 `keyReceiver`）。
   */
  const inEnd = view.panel === 'end'

  /**
   * 「起」：重开一局。
   *
   * **两句缺一不可**，而它们分管的是两件事：
   *
   * - `setSceneName(START_SCENE)` —— 原版 `StartPanel.startLoadAction()` 的
   *   case 0 是 `switchTo("scene")` 加 `scenePanel.initiation("脚本1.txt")`，
   *   新游戏进的是**脚本1**，不是死之前那个场景，也不是开发用选择器上停着
   *   的那个。这一句照抄原版。
   * - `view.restart()` —— 队伍回出厂状态 + 整个会话重建（见 `useGame`）。
   *   **这一句不是照抄原版，是这张票的决定**，见下。
   *
   * ## ⚠️ 原版点「起」其实**不**重置队伍
   *
   * 会重置的是 `GameLauncher.init()`（三个人与四个面板整个重建），而它是
   * **死代码**：全仓库唯一指向它的调用点是 `src/start/StartPanel.java:336`
   * 那句被注释掉的 `// Game.game.init();`。所以原版全灭回标题、再点「起」，
   * 三个人带着上一局的等级、经验、残血直接进脚本1。
   *
   * **而且死代码还不是全部**：就算把那行注释去掉，队伍也回不到出厂状态 ——
   * 三个人的 `level` / `exp` / `angryValue` 是 `static`，三个构造函数一个都
   * 不赋值，只按**现有等级**重算四项属性、把 hp/mp 填满。原版这条路的上限
   * 是「满血复活、等级经验照旧」，给不出 1 / 3 / 1 级。
   *
   * 这两条都不是读出来的，由 `fakes/originalNewGame.test.ts` 从 GBK 源码里
   * 现读现核 —— 注释与判据长得一样，所以这里只留结论，判据在那边。
   * （顺带：数调用点**不能只 grep `\.init()`** —— 源码里还有一处不带点的
   * `init();`，那是 `Narratage` 自己调自己的同名方法。那份判据两种都数。）
   *
   * @exception ADR-0001#new-game-resets-party
   *
   * ADR-0001 说 web 端复刻原版缺陷，这里是**明写的例外**，已经登进那份 ADR
   * 的「例外」表：xl-kaa 的验收标准第二条要的就是「重开之后队伍回到出厂
   * 状态」。缺陷本身登记在 `xl-lly`。写清楚，是因为下一个照着原版重读这一段
   * 的人，会以为这里抄错了。
   *
   * ## 两条路各自的判据在哪
   *
   * 在脚本1 里死掉再重开时 `setSceneName` 是空操作（值没变），全靠
   * `restart()` 里那个 `generation` 把 effect 顶起来 —— 钉住它的是
   * `game/useGame.test.tsx` 的「重开一局」（同一个场景 restart，主角真的回到
   * 出生格）。从别的场景重开则两句都起作用，钉住它的是
   * `app/appTitle.test.tsx`：那里 `useGame` 是假的，验的是 App 这一侧
   * 「两句都调了」。**两个文件各管一半，谁都不能单独证明这条路是通的。**
   */
  const onNewGame = () => {
    setSceneName(START_SCENE)
    view.restart()
  }

  /**
   * 一次鼠标点击 → 舞台**逻辑坐标**（1024×640）。
   *
   * 画布的位图恒为 1024×640，只有 CSS 尺寸在变（见 `stage/Stage.tsx`），
   * 所以换算就是"按外接矩形的比例缩回去"。用 `getBoundingClientRect` 而不是
   * `offsetX`：后者在有 CSS 缩放时给的是**缩放后**的像素，点得越靠右偏得
   * 越多，而画面看起来完全正常。
   */
  const stagePoint = (event: ReactMouseEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return null
    return {
      x: Math.round(((event.clientX - box.left) / box.width) * STAGE_WIDTH),
      y: Math.round(((event.clientY - box.top) / box.height) * STAGE_HEIGHT),
    }
  }

  const onStageClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!inBattle) return
    const at = stagePoint(event)
    if (at) view.click(at.x, at.y)
  }

  /**
   * 菜单是**纯鼠标**的，三种事件都要送：按下 / 松开 / 移动。
   *
   * 只送按下的话按钮会永远停在「按下」那张贴图上（`isclicked` 也不清），
   * 而列表的选中整个走的是 `mouseMoved` —— 少送移动等于选不中任何东西。
   */
  const onMenuMouse = (e: 'press' | 'release' | 'move') => (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!inMenu) return
    const at = stagePoint(event)
    if (!at) return
    view.menuInput({ e, x: at.x, y: at.y })
    // 画布上没有 `<button disabled title>` 可挂，禁用按钮的理由按坐标问出来、
    // 挂在宿主上 —— 与标题页「结」同一口径（xl-03x.12）。
    setMenuTitle(view.menuTitleAt(at.x, at.y))
  }

  /**
   * 商店与菜单一样是**纯鼠标**的：按下 / 松开 / 移动三种都要送。
   *
   * 同一张画布两个主人：预览开着时送给预览，否则店真的开着（从选择框的门进来的）
   * 就送给游戏。两边都不在就丢掉。
   */
  const onShopMouse =
    (e: 'press' | 'release' | 'move') => (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!inShopPreview && !inShop) return
      const at = stagePoint(event)
      if (!at) return
      if (inShopPreview) shop.input({ e, x: at.x, y: at.y })
      else view.shopInput({ e, x: at.x, y: at.y })
    }

  /**
   * 存读档面板与菜单一样**纯鼠标**（外加退出键，走 `useGame` 的键盘那一路）：
   * 按下 / 松开 / 移动三种都要送 —— 按钮光效走的是 `mouseMoved`。
   */
  const onLsMouse = (e: 'press' | 'release' | 'move') => (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!inLs) return
    const at = stagePoint(event)
    if (!at) return
    // 按住左键移动是 Swing 的 `mouseDragged`（只记坐标、不碰按钮），不是 `mouseMoved`
    // （`isMoveIn` 改光效）。浏览器两种都叫 mousemove，按 `buttons` 分开。
    const kind = e === 'move' && (event.buttons & 1) === 1 ? 'drag' : e
    view.lsInput({ e: kind, x: at.x, y: at.y })
  }

  /**
   * 滚轮 —— 装备页与物品页那两处列表翻页用（xl-6lo.13）。**原版没有这一种
   * 输入**，它只从浏览器进来。
   *
   * 送的是**行数**不是 `deltaY`：那个数的量纲随设备与操作系统变，换算在
   * `menu/scroll.ts` 的 `wheelRows` 里，那里进得了 `pnpm test`。
   */
  const onMenuWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!inMenu || event.deltaY === 0) return
    const at = stagePoint(event)
    if (at) view.menuInput({ e: 'wheel', x: at.x, y: at.y, rows: wheelRows(event.deltaY) })
  }

  return (
    <div className="app-shell" ref={shellRef}>
      <Stage
        scalingMode={scalingMode}
        hostContent={
          <>
            {/* 一个面板一张画布，`hidden` 切换 —— 两张一起显示会上下摞着。 */}
            <div
              className="stage-panel"
              ref={sceneHostRef}
              hidden={inBattle || inMenu || inShop || atTitle || inLs || inEnd || inShopPreview}
              data-testid="scene-host"
            />
            <div
              className="stage-panel"
              ref={battleHostRef}
              hidden={!inBattle || inShopPreview}
              onMouseDown={onStageClick}
              data-testid="battle-host"
            />
            <div
              className="stage-panel"
              ref={menuHostRef}
              hidden={!inMenu || inShopPreview}
              onMouseDown={onMenuMouse('press')}
              onMouseUp={onMenuMouse('release')}
              onMouseMove={onMenuMouse('move')}
              onWheel={onMenuWheel}
              title={inMenu && menuTitle !== null ? menuTitle : undefined}
              data-testid="menu-host"
            />
            <div
              className="stage-panel"
              ref={shopHostRef}
              hidden={!inShopPreview && !inShop}
              onMouseDown={onShopMouse('press')}
              onMouseUp={onShopMouse('release')}
              onMouseMove={onShopMouse('move')}
              data-testid="shop-host"
            />
            <div
              className="stage-panel"
              ref={lsHostRef}
              hidden={!inLs || inShopPreview}
              onMouseDown={onLsMouse('press')}
              onMouseUp={onLsMouse('release')}
              onMouseMove={onLsMouse('move')}
              data-testid="ls-host"
            />
            {/* 结局一个鼠标监听都没有（原版 `EndPanel` 就是这样），键盘走 `useGame`。 */}
            <div
              className="stage-panel"
              ref={endHostRef}
              hidden={!inEnd || inShopPreview}
              data-testid="end-host"
            />
          </>
        }
        overlay={
          <>
            {status.kind === 'ready' || inBattle || inMenu || inShop || atTitle || inLs || inEnd || inShopPreview ? null : (
              <p className={`stage-notice stage-notice--${status.kind}`} role="status">
                {status.kind === 'loading' ? `正在载入 ${shownScene}…` : status.message}
              </p>
            )}
            {atTitle && !inShopPreview ? <StartPanel onNewGame={onNewGame} onLoad={view.openLoad} /> : null}
            {inLs && !inShopPreview ? <SaveLoadNotices notice={view.saveLoad} loading={view.saveLoadLoading} /> : null}
            {(inShopPreview && shop.loading) || (!inShopPreview && inShop && view.shopLoading) ? (
              <p className="stage-notice stage-notice--loading" role="status">
                正在载入商店…
              </p>
            ) : null}
            {inMenu && view.menuLoading ? (
              <p className="stage-notice stage-notice--loading" role="status">
                正在载入菜单…
              </p>
            ) : null}
            {inBattle && view.battleLoading ? (
              <p className="stage-notice stage-notice--loading" role="status">
                正在载入战斗…
              </p>
            ) : null}
            {inEnd && view.endLoading ? (
              <p className="stage-notice stage-notice--loading" role="status">
                正在载入结局…
              </p>
            ) : null}
            {dialogue && !inBattle && !inMenu && !inShop && !inLs && !inEnd && !inShopPreview ? (
              <DialogueBox dialogue={dialogue} />
            ) : null}
          </>
        }
      />
      <div className="toolbar">
        {devToolsEnabled() ? (
          <label className="toolbar-field">
            场景
            {/*
              第一项是「标题」（值为空串 = `sceneName` 的 `null`）：开机停在
              它上面，选它也回得去。它不是装饰 —— 少了它，选择器上的值就说不
              出"现在在标题上"这件事，只能显示成脚本1，而那正是 xl-q7f 之前
              那处"选择器身兼两职"的来源。
            */}
            <select
              value={sceneName ?? TITLE_OPTION}
              onChange={(e) =>
                setSceneName(e.target.value === TITLE_OPTION ? null : e.target.value)
              }
            >
              <option value={TITLE_OPTION}>标题</option>
              {SCENE_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {devToolsEnabled() ? (
          <label className="toolbar-field">
            商店
            <select
              value={shopPreview}
              onChange={(e) => setShopPreview(e.target.value as ShopPreviewChoice)}
            >
              {SHOP_PREVIEW_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className="toolbar-hint">
          {inShopPreview
            ? '商店预览（开发用）：进店的正路是场景里店主旁边的选择框（xl-yg6.11）'
            : inShop
              ? '商店：点商品、加减、买卖；「返回游戏」回到场景'
              : inLs
                ? '存读档：点右边的圆钮存进 / 读出那一格；Esc 回到进来时那一屏'
              : inEnd
                ? '结局：字幕滚完即定格。按键照旧交给背后的场景 —— Esc 会开菜单、把结局切走，原版就是这样'
              : atTitle
            ? '开始界面：点「起」重开一局，点「承」读取存档'
            : inBattle
              ? '战斗中：点「击」再点怪物；技、防、物同理'
              : inMenu
                ? '菜单：点顶栏切页；出去只有天书页的「返回」——按 ESC 出不去，原版就是这样'
                : '方向键走动，按住 Ctrl 或 Shift 跑动，空格搭话／推进对话，回车跳过逐字打印，ESC 开菜单'}
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
