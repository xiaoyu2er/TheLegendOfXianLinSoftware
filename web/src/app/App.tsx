import { useEffect, useRef, useState } from 'react'
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
import type { StartPanelState } from '../start/panelState'
import { DialogueBox } from '../ui/DialogueBox'
import { devToolsEnabled } from './devTools'

/**
 * 场景选择器里「标题」那一项的值。空串 = `sceneName` 的 `null`。
 *
 * 导出去，是为了让 `App.test.tsx` 断言的就是这一个值 —— 两边各写一个裸
 * `''`，改掉其中一个，测试照样绿。
 */
export const TITLE_OPTION = ''

/** `MouseEvent.button`（哪个键）→ 它在 `MouseEvent.buttons` 位掩码里的那一位。中键与右键是反着的。 */
const BUTTON_BITS: readonly number[] = [1, 4, 2, 8, 16]

/**
 * 这一下按的是哪只键，换成它在 `buttons` 里的那一位。
 *
 * 表上没有的键（第 6 只往后，`buttons` 规范只定到第 5 只）按 `1 << button` 兜底，**不能按 0**：
 * 位图靠「按下与松手拿到同一位」认人，给 0 等于这只键的按下记不进位图，而宿主已经把那一下送出去了 ——
 * `useGame.routeByGrab` 的计数于是永远回不到 0，grab 再也解不开。`1 << button` 从第 6 只起是
 * 32 / 64 /…，与表里那五个（1/4/2/8/16）不撞。
 */
const bitOf = (event: { readonly button: number }): number => BUTTON_BITS[event.button] ?? 1 << event.button

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
  /**
   * 标题页的状态（xl-6zf）。放在这一层而不在 `<StartPanel>` 里：离开标题它就卸载，
   * 而原版那块 `StartPanel` 从开机活到关机 —— 「承」进存读档再 Esc 回来，云、悬停、
   * 自绘鼠标都接着离开时那一份。重开一局也**不**清它：原版「起」不重建面板。
   */
  const titleStateRef = useRef<StartPanelState | null>(null)
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
  const stagePoint = (event: ReactMouseEvent<HTMLDivElement>): { x: number; y: number } | null =>
    stagePointIn(event.currentTarget.getBoundingClientRect(), event)

  /**
   * 这一下落在**舞台**里没有 —— 舞台就是原版那个窗口（`GameLauncher` 的内容面板，
   * `CardLayout` 把当前那块面板铺满它，JDK 17 `CardLayout.layoutContainer` 逐个
   * `setBounds` 到 `parent.width/height` 减边距，而这里边距与 hgap/vgap 都是 0）。
   *
   * 所以**「宿主外」不等于「窗口外」**：舞台里、宿主外（overlay 上的提示字、露出来的
   * 另一块宿主）在原版仍是同一块内容面板，grab 期间的按下照派给 grab 的主人；舞台外
   * （letterbox、工具条、页面别处）才是原版的窗口外。
   *
   * 按外接矩形算，不看落在哪个元素上：舞台上叠着 overlay，按元素判会把提示字算成宿主外的另一块地方。
   *
   * ⚠️ 传进来的是**宿主**按下那一刻的矩形，不是舞台自己的。今天两者逐像素相等 —— `.stage-panel`
   * 与 `.stage-canvas-host` 都是 `width/height: 100%`，一路铺到 `.stage`。**那条 CSS 链是这个函数
   * 名副其实的前提，它自己不守，判据在 `app/appGrab.test.tsx` 的「宿主的矩形就是舞台的矩形」那一段**：
   * 宿主哪天缩小一圈，这里就悄悄退回「宿主外」，而所有测试照绿（测试一律把宿主 stub 成整个舞台）。
   *
   * ⚠️ 「舞台外 ＝ 原版的窗口外」是**建模选择**，不是从 JDK 推出来的：原版 `pack()` 之后压根没有
   * letterbox 与工具条这两块地方，web 独有的区域算在窗口的哪一侧得有人裁。这一层沿用既有口径
   * （`isMouseGrab` 的注释里那句「按在舞台外（原版是窗口外）」，xl-2yh / xl-m9q）。
   */
  const insideStage = (
    hostBox: DOMRect,
    event: { readonly clientX: number; readonly clientY: number },
  ): boolean =>
    event.clientX >= hostBox.left &&
    event.clientX < hostBox.right &&
    event.clientY >= hostBox.top &&
    event.clientY < hostBox.bottom

  /** 客户端坐标 → 舞台逻辑坐标，按给定的外接矩形换算。矩形是空的（藏着）就 `null`。 */
  const stagePointIn = (
    box: DOMRect,
    event: { readonly clientX: number; readonly clientY: number },
  ): { x: number; y: number } | null => {
    if (box.width === 0 || box.height === 0) return null
    return {
      x: Math.round(((event.clientX - box.left) / box.width) * STAGE_WIDTH),
      y: Math.round(((event.clientY - box.top) / box.height) * STAGE_HEIGHT),
    }
  }

  /**
   * 战斗画布与存读档面板同形（xl-qqw）：按下 / 移动 / 松开分开送，按住任一键移动是
   * `mouseDragged` —— 原版那一支少一句 `enemySlector.checkMoveIn`，拖过怪物不停帧。
   * 松手走 `grabRelease`：在「击」上按下、拖出画布再松手，原版照样触发（按钮的
   * `isclicked` 按下就挂上了，框外松手不清它）。
   */
  const onBattleMouse = (type: 'press' | 'move') => (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!inBattle || grabbedElsewhere(event)) return
    const box = event.currentTarget.getBoundingClientRect()
    const at = stagePointIn(box, event)
    if (!at) return
    const kind = type === 'move' && event.buttons !== 0 ? 'drag' : type
    view.battleMouse({ e: kind, x: at.x, y: at.y })
    if (type === 'press') {
      const host = event.currentTarget
      grabRelease(host, box, bitOf(event), {
        release: (p) => view.battleMouse({ e: 'release', ...p }),
        drag: (p) => view.battleMouse({ e: 'drag', ...p }),
        press: (p) => view.battleMouse({ e: 'press', ...p }),
      })
    }
  }

  /**
   * 菜单是**纯鼠标**的，三种事件都要送：按下 / 松开 / 移动。
   *
   * 只送按下的话按钮会永远停在「按下」那张贴图上（`isclicked` 也不清），
   * 而列表的选中整个走的是 `mouseMoved` —— 少送移动等于选不中任何东西。
   */
  const onMenuMouse = (e: 'press' | 'move') => (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!inMenu || grabbedElsewhere(event)) return
    const box = event.currentTarget.getBoundingClientRect()
    const at = stagePointIn(box, event)
    if (!at) return
    view.menuInput({ e, x: at.x, y: at.y })
    // 画布上没有 `<button disabled title>` 可挂，禁用按钮的理由按坐标问出来、
    // 挂在宿主上 —— 与标题页「结」同一口径（xl-03x.12）。
    setMenuTitle(view.menuTitleAt(at.x, at.y))
    if (e === 'press') {
      const host = event.currentTarget
      grabRelease(host, box, bitOf(event), {
        release: (p) => view.menuInput({ e: 'release', ...p }),
        // 菜单那一支没有单独的 drag：原版 `mouseDragged` 与 `mouseMoved` 两段逐字相同。
        drag: (p) => view.menuInput({ e: 'move', ...p }),
        press: (p) => view.menuInput({ e: 'press', ...p }),
      })
    }
  }

  /**
   * 松手**不挂在宿主上**，而是按下那一刻挂到 window 上 —— 菜单、店、存读档三块宿主
   * 共用这一个（xl-z4f 做了菜单，xl-o9z 收拢）。
   *
   * 按下「返回」那一拍菜单就关了、按着槽位按退出键存读档面板就切走了：宿主被 `hidden`
   * 掉，松手于是落在别的宿主上 —— 宿主自己的 `onMouseUp` 收不到它，而藏着的元素外接
   * 矩形全是 0，拿它换算只会得到 null。所以坐标按**按下那一刻**的矩形算（舞台在这一下
   * 里不会动），送给**按下时那一块**的主人（`send` 在按下时就定了）。反过来，菜单上
   * 按下「存档」那一拍存读档宿主就露出来了，松手落在它上面也不归它。
   *
   * 原版的对应物是 Swing 的 mouse grab。这一层只管 DOM 那一截（事件落在谁身上、坐标
   * 怎么换算）；**松手归哪个面板**由 `useGame` 的 `grabRef` 定 —— 按下被它丢掉（面板
   * 对不上）的话，松手也一并丢掉。
   *
   * 拖动 Swing 也按 grab 派，拖出组件外照样收（xl-b28）：按下到松手之间 window 上同时
   * 挂着 `mousemove`，**落在宿主外的**才由它送 `drag`（落在宿主里的宿主自己的
   * `onMouseMove` 已经送了，冒泡上来的不重送）。面板已经切走的话 `useGame` 照当前面板
   * 丢掉它 —— 藏着的面板收不到拖动，那处差异登记在 `useGame.routeByGrab`。反过来，grab
   * 握在别的宿主上时，指针底下那块宿主自己的 `onMouseMove` 不收（{@link grabbedElsewhere}）：
   * 菜单上按下「存档」、翻到存读档再拖，这些拖动归菜单（xl-bwl）。
   *
   * 在浏览器窗口外松手，window 收不到 mouseup，原版却照样收到松手（操作系统替窗口握着
   * grab）。这一层只看得见后果：grab 还挂着，指针上却没有键了 —— 回到页面的头一下移动
   * `buttons` 为 0，或者一次除自己之外没按着别的键的新按下。见到就当场补上那一下松手
   * （xl-bwl），两个监听挂在捕获阶段，赶在宿主自己收这一下之前。⚠️ 补的坐标是见到它的
   * 那一刻，不是真正松手的地方（窗口外，这一层无从得知）—— 残余差异，如实记下。
   *
   * grab 期间在**舞台外**按下的第二个键，按下与松手原版一下都收不到：那一下按在别的窗口上、
   * 归那个窗口，Java 侧一条事件都没有（xl-bg3 在 macOS 上量的是标题页，同一个 JFrame、
   * 同一条操作系统的路，读数与当前显示哪一块 `CardLayout` 面板无关 —— ⚠️ **这四块宿主没有
   * 各自复量过**，见 `takenRef` 那段）。所以按下要按 {@link insideStage} 挡掉，松手要按
   * 「这个 grab 收下过按下的那几只键」那张位图挡掉。拖动不挡：同一轮实测越界 `DRAGGED`
   * 一路 `src=start.StartPanel`，按着键拖出窗口操作系统照样送进来（xl-40m / xl-bg3）。
   */
  const grabRef = useRef<{ readonly host: Element; readonly end: () => void } | null>(null)
  const grabRelease = (
    host: Element,
    box: DOMRect,
    /** 起这个 grab 的那只键在 `buttons` 里的那一位。 */
    ownBit: number,
    /** 这块宿主的三条出口，按下那一刻就定了（归哪个面板在 `useGame.routeByGrab` 定）。 */
    to: {
      readonly release: (at: { x: number; y: number }) => void
      readonly drag: (at: { x: number; y: number }) => void
      readonly press: (at: { x: number; y: number }) => void
    },
  ) => {
    // 和弦（xl-4xi）：grab 挂着时又按下一个键，Swing 的 `isMouseGrab` 看的是「这一下之前
    // 有没有键按着」—— 有，于是这一下按下也归 grab、grab 照旧。落在同一块宿主上时宿主自己
    // 已经送了这一下，这里只是不另起一个 grab；落在别处的由下面的 `onPress` 送。
    if (grabRef.current !== null) return
    /**
     * 这个 grab **收下过按下**的那几只键（位图，与 `BUTTON_BITS` 同一张表；起 grab 那只键
     * `own` 一开始就在里面）。只有它们的松手才送 `release` —— 舞台外按下的第二个键不在里面，
     * 原版那一下按在别的窗口上，按下与松手 Java 一条都收不到，而浏览器照样把两下都派给 window。
     *
     * 位图而不是计数（标题页那一份 `StartPanel.tsx` 的 `takenRef` 同一个理由，xl-bg3）：要
     * 认出「这一只松手该不该送」，光知道还欠几次不够。`useGame.routeByGrab` 那半仍然按次数数，
     * 两边靠「送几次按下就送几次松手」对上 —— 挡掉的按下这里一次都不送，它的松手也就不欠。
     *
     * ⚠️ 读数取自 xl-bg3 在标题页上的 macOS 实测（三轮逐字一致），**这四块宿主没有各自复量过**：
     * 它们在原版里是同一个 `JFrame` 里 `CardLayout` 的几块面板，「事件到不到得了这个窗口」由
     * 操作系统按窗口定，与当前显示哪一块无关 —— 这一句是推理，不是读数。
     */
    let taken = ownBit
    const at = (event: MouseEvent) => stagePointIn(box, event)
    const sendOneRelease = (event: MouseEvent) => {
      const p = at(event)
      if (p) to.release(p)
    }
    /**
     * 所有键都松开了：解除 grab，位图里还欠几只键的松手就补几次（别的键可能是在窗口外松开的）。
     * 位图空着就一次都不补 —— 欠着的那几只若是舞台外按下的，原版压根没有这一下。
     */
    const endWithReleases = (event: MouseEvent) => {
      let owed = 0
      for (let bits = taken; bits !== 0; bits >>= 1) owed += bits & 1
      endGrab()
      for (let n = owed; n > 0; n--) sendOneRelease(event)
    }
    // 每一次松手都派给 grab；要等**所有键都松开**（`buttons` 为 0）grab 才解除（xl-4xi）。
    const onRelease = (event: MouseEvent) => {
      if (event.buttons === 0) return endWithReleases(event)
      const bit = bitOf(event)
      // 这只键的按下这个 grab 没收下（舞台外按下的第二个键）：它的松手也不收。
      if ((taken & bit) === 0) return
      taken &= ~bit
      sendOneRelease(event)
    }
    /**
     * 拖动一条都不挡：xl-40m / xl-bg3 同一轮实测，按着键拖出窗口操作系统照样送进来，越界
     * `DRAGGED` 一路 `src=start.StartPanel`、x 到 1254（舞台宽 1024）。
     *
     * ⚠️ **那一轮量的是「起 grab 那只键按着」拖出去**。起 grab 那只键已经松开、只剩被挡掉的那只
     * （舞台外按下的）还按着时的拖动，**没有量过**，这里照送 —— 登记为未量，不是读数。
     */
    const onDrag = (event: MouseEvent) => {
      if (event.buttons === 0) return endWithReleases(event)
      if (event.target instanceof Node && host.contains(event.target)) return
      const p = at(event)
      if (p) to.drag(p)
    }
    // 除这一下自己之外没按着别的键：上一次的松手丢在窗口外了。按着别的键就是和弦。
    const onPress = (event: MouseEvent) => {
      if (!isMouseGrab(event)) return endWithReleases(event)
      // 舞台外（原版是窗口外）按下的第二个键：原版一下都收不到，这里也一下都不收（xl-bg3）。
      if (!insideStage(box, event)) return
      taken |= bitOf(event)
      if (event.target instanceof Node && host.contains(event.target)) return
      const p = at(event)
      if (p) to.press(p)
    }
    const endGrab = () => {
      window.removeEventListener('mouseup', onRelease)
      window.removeEventListener('mousemove', onDrag, true)
      window.removeEventListener('mousedown', onPress, true)
      grabRef.current = null
    }
    grabRef.current = { host, end: endGrab }
    window.addEventListener('mouseup', onRelease)
    window.addEventListener('mousemove', onDrag, true)
    window.addEventListener('mousedown', onPress, true)
  }
  useEffect(() => () => grabRef.current?.end(), [])
  /** grab 握在另一块宿主上（移动归那边的 `onDrag`），或舞台外按着的键把 grab 定在了空处（{@link isMouseGrab}，按下与拖动都算）：这块宿主不收。 */
  const grabbedElsewhere = (event: ReactMouseEvent<HTMLDivElement>): boolean =>
    grabRef.current === null ? isMouseGrab(event) : grabRef.current.host !== event.currentTarget

  /**
   * 商店与菜单一样是**纯鼠标**的：按下 / 松开 / 移动三种都要送。
   *
   * 同一张画布两个主人：预览开着时送给预览，否则店真的开着（从选择框的门进来的）
   * 就送给游戏。两边都不在就丢掉。
   */
  const onShopMouse = (e: 'press' | 'move') => (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((!inShopPreview && !inShop) || grabbedElsewhere(event)) return
    const box = event.currentTarget.getBoundingClientRect()
    const at = stagePointIn(box, event)
    if (!at) return
    // 松手的主人在按下时就定了：按下时是预览，松手也归预览（见 `grabRelease`）。
    const send = inShopPreview ? shop.input : view.shopInput
    // 按住任一键移动是 `mouseDragged`：两家店那一支只记坐标，不跑 `isMoveIn`（xl-bwl）。
    send({ e: e === 'move' && event.buttons !== 0 ? 'drag' : e, x: at.x, y: at.y })
    if (e === 'press') {
      grabRelease(event.currentTarget, box, bitOf(event), {
        release: (p) => send({ e: 'release', ...p }),
        drag: (p) => send({ e: 'drag', ...p }),
        press: (p) => send({ e: 'press', ...p }),
      })
    }
  }

  /**
   * 存读档面板与菜单一样**纯鼠标**（外加退出键，走 `useGame` 的键盘那一路）：
   * 按下 / 松开 / 移动三种都要送 —— 按钮光效走的是 `mouseMoved`。
   */
  const onLsMouse = (e: 'press' | 'move') => (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!inLs || grabbedElsewhere(event)) return
    const box = event.currentTarget.getBoundingClientRect()
    const at = stagePointIn(box, event)
    if (!at) return
    // 按住任一键移动是 Swing 的 `mouseDragged`（只记坐标、不碰按钮），不是 `mouseMoved`
    // （`isMoveIn` 改光效）。浏览器两种都叫 mousemove，按 `buttons` 分开 —— Swing 不分哪个
    // 键，右键拖动也是拖动（xl-bwl）。
    const kind = e === 'move' && event.buttons !== 0 ? 'drag' : e
    view.lsInput({ e: kind, x: at.x, y: at.y })
    if (e === 'press') {
      const host = event.currentTarget
      grabRelease(host, box, bitOf(event), {
        release: (p) => view.lsInput({ e: 'release', ...p }),
        drag: (p) => view.lsInput({ e: 'drag', ...p }),
        press: (p) => view.lsInput({ e: 'press', ...p }),
      })
    }
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
              onMouseDown={onBattleMouse('press')}
              onMouseMove={onBattleMouse('move')}
              data-testid="battle-host"
            />
            <div
              className="stage-panel"
              ref={menuHostRef}
              hidden={!inMenu || inShopPreview}
              onMouseDown={onMenuMouse('press')}
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
              onMouseMove={onShopMouse('move')}
              data-testid="shop-host"
            />
            <div
              className="stage-panel"
              ref={lsHostRef}
              hidden={!inLs || inShopPreview}
              onMouseDown={onLsMouse('press')}
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
            {/* @exception ADR-0001#loading-notices —— 原版同步读盘，没有「载入中」这一种状态。 */}
            {status.kind === 'ready' || inBattle || inMenu || inShop || atTitle || inLs || inEnd || inShopPreview ? null : (
              <p className={`stage-notice stage-notice--${status.kind}`} role="status">
                {status.kind === 'loading' ? `正在载入 ${shownScene}…` : status.message}
              </p>
            )}
            {atTitle && !inShopPreview ? (
              <StartPanel onNewGame={onNewGame} onLoad={view.openLoad} keep={titleStateRef} />
            ) : null}
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
      {/* @exception ADR-0001#toolbar-under-stage —— 原版窗口里只有画面：提示字与放大方式都是这一层加的。 */}
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

/**
 * 这一下事件**之前**有没有键按着 —— Swing `LightweightDispatcher.isMouseGrab` 原样（JDK 17
 * `java/awt/Container.java`：只有 PRESSED / RELEASED 才 `modifiers ^= getMaskForButton(e.getButton())`，
 * 再看 `BUTTONS_DOWN_MASK`）。按下看的是**别的**键；移动不扣本键，按着任一键就为真。这里只接
 * 按下与移动两种（松手不经过它），按下用「去掉本键」而不是异或：jsdom 里不带 `buttons` 的按下
 * 是 0，异或会把它读成「之前按着」。
 *
 * 为真时 `processMouseEvent` **不重设** `mouseEventTarget`，按下、松手与拖动都派给更早那一下
 * 定下的目标（MOUSE_DRAGGED 在按着键时恒为真，所以拖动**从不**重设目标）。几种用法：
 *
 * - grab 挂着（`grabRelease` 的 `onPress`）：和弦，这一下也归 grab（xl-4xi）；
 * - grab 没挂着（`grabbedElsewhere`）：目标是**最后一个不在 grab 里的事件**重设的，这一下
 *   按下自己不查落点。更早那只键按在不收鼠标的面板上（场景、结尾，原版没挂鼠标监听）：重设
 *   它的是那一下按下，`MouseEventTargetFilter` 不收这两块，落空成 null。按在舞台外（原版是
 *   窗口外）：Swing 看不见那一下，重设它的是指针无键离开窗口的那一下 MOUSE_EXITED，界外
 *   `getMouseEventTargetImpl` 返回 null。目标是 null：这一下按下不送、不起 grab，它与别的键
 *   的松手也就一个都不送，直到全松开（xl-2yh）。macOS 实测（xl-zs6；CGEvent 合成的序列，窗口外那一下按在
 *   另一个 app 的窗口上；复跑 `tools/mouse-dispatch-probe.sh`，xl-sij）：那只键**在**回窗口后的
 *   `getModifiersEx` 里（`mex=0x1400`），而它的松手到不了窗口。
 * - grab 没挂着、按着键移到宿主上（`grabbedElsewhere`）：同一个 null 目标，`met != null` 那一块
 *   不进，一个 `mouseDragged` 都不派，直到全松开、下一下 MOUSE_MOVED 重设目标（xl-5ee）。
 *   macOS 实测（xl-zs6；量的是「左键按在另一个 app 的窗口上、按着拖进来」这一种，CGEvent 合成）：Swing 连
 *   DRAGGED 本身都收不到 —— 与「收得到但目标是 null」同果，都不派。⚠️ xl-zs6 的关票理由里那句
 *   「只来一个 ENTERED」按字面复核对不上：那一轮还跟着几行 MOVED 与一行 EXITED，xl-sij 重跑时条数
 *   又不同（系统会合并移动事件）。成立的是「按下 / 松手与 DRAGGED 一个都没有」；原版的
 *   `MouseAdapter` 本来就没接 ENTERED。复跑 `tools/mouse-dispatch-probe.sh`（xl-sij）。
 */
function isMouseGrab(event: { readonly type: string; readonly button: number; readonly buttons: number }): boolean {
  const own = event.type === 'mousedown' ? bitOf(event) : 0
  return (event.buttons & ~own) !== 0
}
