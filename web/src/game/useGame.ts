import { useEffect, useRef, useState } from 'react'
import { createBgmPlayer } from '../audio/bgmPlayer'
import { createSfxPlayer } from '../audio/sfxPlayer'
import { battleTextureIds } from '../battle/render/assets'
import type { BattleRenderer } from '../battle/render/battleRenderer'
import { battleDrawList } from '../battle/render/drawList'
import type { BattleInput } from '../battle/step'
import type { BattleWorld } from '../battle/types'
import { exitsReady, loadedSceneSource, prepareExits, rememberScene } from '../data/loadedScenes'
import { resetParty } from '../fakes/party'
import { createBrowserSaveStore, indexedDbBackend } from '../save/browserStore'
import { loadScene } from '../data/scenes'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { TICK_MS, createWorld } from '../state/step'
import type { DialogueState } from '../state/dialogue'
import type { InputEvent, World } from '../state/types'
import { battleClick } from './battleInput'
import { enemyNamesOf, enemySpriteSize, prepareEnemySprites, spritesReady } from './enemySprites'
import { toInputEvent } from './keyboard'
import {
  advanceSession,
  createSession,
  bgmFromStart,
  currentBgm,
  enterScene,
  isRunning,
  loadGame,
  loadTargetOf,
  menuWorldOf,
  openMenu,
  playSfx,
} from './session'
import { menuDrawList } from '../menu/render/drawList'
import { menuTaskOf } from './menuTask'
import { menuTextureIds } from '../menu/render/assets'
import type { MenuRenderer } from '../menu/render/menuRenderer'
import { menuDisabledReasonAt } from '../menu/step'
import type { MenuInput } from '../menu/step'
import { previewFrame } from '../shop/preview'
import { shopTextureIds } from '../shop/render/assets'
import { shopDrawList } from '../shop/render/drawList'
import type { ShopRenderer } from '../shop/render/shopRenderer'
import type { ShopInput } from '../shop/step'
import { NO_INPUT, carryIntoNewGame, endWorldOf, enterSaveLoad, keyReceiver, saveLoadViewOf, shopWorldOf } from './session'
import type { Panel, Session, SessionDeps } from './session'
import { saveLoadDrawList, saveLoadTextureIds } from '../saveload/render/drawList'
import type { SaveLoadRenderer } from '../saveload/render/saveLoadRenderer'
import type { SaveLoadInput } from '../saveload/step'
import { SAVE_SLOT_COUNT } from '../save/store'
import { endTextureIds } from '../end/assets'
import { endDrawList } from '../end/render/drawList'
import type { EndRenderer } from '../end/render/endRenderer'

/**
 * 存读档面板上那几行提示要的东西（xl-i06.9）—— `saveLoadViewOf` 的一个只含文字的
 * 投影，好让 React 只在它变了的时候重渲染。
 */
export type SaveLoadNotice =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly error: string }
  | { readonly status: 'ready'; readonly persistError: string | null; readonly loadRequest: number | null }

/**
 * 把状态层接到键盘与渲染器上。**这里没有一行游戏逻辑**——它只做三件事：
 * 收键、按真实流逝的时间推进、把结果交给渲染器画。
 *
 * ## 为什么是 setInterval 而不是 requestAnimationFrame
 *
 * rAF 在标签页不可见时**完全不触发**。用它驱动状态推进，切后台游戏就冻住，
 * 切回来要么继续冻着、要么一口气补跑几百帧——原版把状态推进挂在绘制上，
 * 到了浏览器里就是这个形态，这一票的规格里点名要避开它。
 *
 * `setInterval` 在后台会被节流到 ~1 秒一次，但**它照样触发**，而流逝的时间是
 * 从 `performance.now()` 现算的，所以每次醒来补的是那 ~1 秒（约 100 个 tick，
 * 都是纯函数，成本可以忽略），而不是攒够几分钟再一次性爆发。前台后台跑出来
 * 的世界完全一样，这条由 `state/loop.test.ts` 钉住。
 *
 * 画面另说：Pixi 有自己的渲染循环，后台不可见时它自然不画。这正是"状态推进
 * 与渲染解耦"的意义——不画不等于不动。
 *
 * ## 为什么要把对话状态交出去
 *
 * 对话框是真 DOM（`ui/DialogueBox.tsx`），要由 React 画，所以它得进 React 的
 * 状态。但**不能每个 tick 都 setState**：那是每秒 100 次重渲染，而其中绝大
 * 多数 tick 里对话根本没开着。所以只在"画出来会不一样"时才 setState，判据是
 * 一个从渲染层真正读到的字段算出来的签名（见 `dialogueSignature`）——
 * 按整个 `DialogueState` 比引用是没用的，`step()` 每 tick 都返回新对象。
 */
export interface GameView {
  /** 对话框那一层的状态，`null` = 此刻没有对话。 */
  readonly dialogue: DialogueState | null
  /** 现在显示的是哪个面板（xl-rh9.17）。 */
  readonly panel: Panel
  /** 战斗贴图还在载入 —— 这几十毫秒里战斗那张画布是空的。 */
  readonly battleLoading: boolean
  /** 菜单贴图还在载入 —— 另外三页的整屏背景走按需加载，翻页时会有这几十毫秒。 */
  readonly menuLoading: boolean
  /**
   * 舞台**逻辑坐标**里的一次点击。战斗面板才用得到；别的面板收下就丢掉。
   *
   * 换算（客户端坐标 → 1024×640）由调用方做：只有它知道画布被缩放了多少
   * （见 `stage/Stage.tsx`）。这一层收的一律是逻辑坐标，与真值里的坐标同一
   * 套 —— 中间多一次换算，就多一处"点得中点不中"说不清的地方。
   */
  readonly click: (x: number, y: number) => void
  /**
   * 菜单里的一次鼠标事件（舞台**逻辑坐标**）。菜单没开着时收下就丢掉。
   *
   * 与 `click` 分开是因为菜单要的是**三种事件**（按下 / 松开 / 移动），
   * 而战斗那一侧只认按下 —— 合成一个入口就得在这一层猜"这一下算哪种"。
   */
  readonly menuInput: (input: MenuInput) => void
  /**
   * 菜单画布上这个坐标（舞台**逻辑坐标**）该挂的 `title`，`null` = 不挂。今天只有
   * 天书页那颗禁用的「确认离开」有（xl-03x.12）；菜单没开着一律 `null`。
   */
  readonly menuTitleAt: (x: number, y: number) => string | null
  /** 商店贴图还在载入 —— 进门那一下、以及装备店换一栏商品时各有这几十毫秒。 */
  readonly shopLoading: boolean
  /**
   * 店里的一次鼠标事件（舞台**逻辑坐标**）。店没开着时收下就丢掉（xl-yg6.11）。
   * 与菜单同一个理由：按下 / 松开 / 移动三种都要送。
   */
  readonly shopInput: (input: ShopInput) => void
  /**
   * 世界此刻在哪个场景（注册表名，如 `大地图`）。
   *
   * **场景归世界管，不归调用方管**（xl-9bd.12）：走到出口是世界自己换的场景，
   * 画面只能跟着它走。调用方给的那个 `sceneName` 只说"**现在该在哪儿**"
   * （`null` = 还没开局，停在标题上；开发用的场景选择器改的也是它）。
   * 还没开局、或者世界还没建好时，这里是 `null`。
   */
  readonly scene: string | null
  /**
   * **重开一局** —— 原版 `GameLauncher.init()`（xl-kaa）。
   *
   * 它做两件事，缺一件都会表现为"重开了，但上一局的什么东西还在"：
   *
   * 1. **队伍回出厂状态**（`fakes/party.ts` 的 `resetParty`）。原版那三个人是
   *    进程级静态引用，`init()` 里 `new ZhangXiaoFan(...)` 三句把它们整个
   *    换掉；这一层的对应物就是那个模块级单例。不做的话新一局开局就带着上
   *    一局的等级、经验和残血 —— 而画面上完全正常。
   *
   *    ⚠️ **原版实际上没走这条路**：`init()` 是死代码，唯一指向它的调用点
   *    被注释掉了（`src/start/StartPanel.java:336`）；而且即便没被注释掉，
   *    它也只到"满血复活、等级经验照旧"—— 那三个类的 `level` / `exp` 是
   *    `static`，构造函数一个都不赋。重置是这张票的验收标准要的，不是照抄；
   *    原版那个缺陷登记在 `xl-lly`，判据在 `fakes/originalNewGame.test.ts`，
   *    取舍写在 `app/App.tsx` 的 `onNewGame` 与 ADR-0001 的「例外」表里。
   * 2. **世界重建**。`init()` 还 `new` 了战斗 / 菜单 / 商店三个面板，这一层
   *    对应的是把整个会话（场景 ticker + 战斗 ticker）丢掉重来，也就是下面
   *    那个 `generation` 一涨、建会话的 effect 重跑一遍。
   *
   * **进哪个场景由调用方决定**：原版「起」按钮走的是
   * `scenePanel.initiation("脚本1.txt")`，也就是 `data/scenes.ts` 的
   * `START_SCENE`，而这个钩子的场景来自 `sceneName` 这个入参（开发用的场景
   * 选择器也在改它）。`app/App.tsx` 那边一起改，`app/appTitle.test.tsx` 里
   * 有一条用例钉着"从别的场景死了之后重开，进的是脚本1"。
   *
   * **开机那一次不走这里**：开机的 `sceneName` 就是 `null`，会话起手就停在
   * 标题上（xl-q7f），没有"先建一局再退回标题"这回事。
   */
  readonly restart: () => void
  /** 存读档面板开着时那几行提示；面板没开着是 `null`（xl-i06.9）。 */
  readonly saveLoad: SaveLoadNotice | null
  /** 存读档面板贴图还在载入。 */
  readonly saveLoadLoading: boolean
  /** 结局面板贴图还在载入（进结局那一下，二十几张一次载齐）。 */
  readonly endLoading: boolean
  /** 存读档面板上的一次鼠标事件（舞台逻辑坐标）。面板没开着就丢掉。 */
  readonly lsInput: (input: SaveLoadInput) => void
  /** 标题上的「承」：下一拍进存读档面板（读模式，从标题进来）。 */
  readonly openLoad: () => void
}

/**
 * 会话跟外界打交道的那三样。全是模块级的东西，所以这份可以是常量 ——
 * 每次建会话现造一份的话，"deps 换没换"就成了一个没人看得见的变量。
 */
const SESSION_DEPS: SessionDeps = {
  scenes: loadedSceneSource,
  sprite: enemySpriteSize,
  // 原版 `FightEvent.startBattle0` 与 `calDamage` 用的就是它。
  random: Math.random,
  // 存档仓库**开机就建**、当场开始从 IndexedDB 往快照里读：首次进存读档面板
  // 之前它必须已经就绪，越早起读越好。读的过程在状态机之外（`save/store.ts`）。
  saves: createBrowserSaveStore(indexedDbBackend()),
}

export function useGame(
  renderer: SceneRenderer | null,
  /** 现在该在哪个场景。`null` = 还没开局，停在标题上（xl-q7f）。 */
  sceneName: string | null,
  battleRenderer: BattleRenderer | null = null,
  menuRenderer: MenuRenderer | null = null,
  shopRenderer: ShopRenderer | null = null,
  saveLoadRenderer: SaveLoadRenderer | null = null,
  endRenderer: EndRenderer | null = null,
): GameView {
  const [endLoading, setEndLoading] = useState(false)
  /** 存读档面板上的输入，攒到下一拍（xl-i06.9）。 */
  const lsInputRef = useRef<SaveLoadInput[]>([])
  /** 标题上点了「承」：下一拍进面板。 */
  const openLoadRef = useRef(false)
  const [saveLoad, setSaveLoad] = useState<SaveLoadNotice | null>(null)
  const saveLoadSigRef = useRef<string>('null')
  const [saveLoadLoading, setSaveLoadLoading] = useState(false)
  const loadedLsRef = useRef<string | null>(null)
  const lsLoadingRef = useRef(false)
  /** 进面板那一刻（帧号从它数起）；按钮光效各自从开始发光那一刻数。 */
  const lsSinceRef = useRef<number | null>(null)
  const glowSinceRef = useRef<(number | null)[]>(Array.from({ length: SAVE_SLOT_COUNT }, () => null))
  const sessionRef = useRef<Session | null>(null)
  const queueRef = useRef<InputEvent[]>([])
  /** 战斗那一侧这一拍收到的输入：鼠标点击，外加调试外挂键 J。 */
  const battleInputsRef = useRef<BattleInput[]>([])
  /** 菜单里的鼠标事件，攒到下一拍。**没有键盘那一种。** */
  const menuInputRef = useRef<MenuInput[]>([])
  /**
   * 鼠标在菜单上按下、还没松开（xl-z4f）—— 「按下时那个面板」。松手照它派，
   * 不照当前面板：见 `menuInput`。
   */
  const menuGrabRef = useRef(false)
  /** 店里的鼠标事件，攒到下一拍（xl-yg6.11）。 */
  const shopInputRef = useRef<ShopInput[]>([])
  const [shopLoading, setShopLoading] = useState(false)
  /** 已经载过贴图的那一份商店名单（按内容比）。装备店换一栏就要重载商品图。 */
  const loadedShopRef = useRef<string | null>(null)
  const shopLoadingRef = useRef(false)
  /**
   * 这一次进店是什么时候（`performance.now()`）。`null` = 店没开着。
   * 鼠标图与四条人物动画的帧号从它数起 —— 原版那条动画线程是面板建好就在跑的，
   * 帧号本来就不对应任何状态，从进门那一刻数只是让它从第 0 格起。
   * @exception ADR-0001#panel-threads-run-while-hidden
   */
  const shopSinceRef = useRef<number | null>(null)
  /** 按 ESC 那一下：下一拍开菜单。原版 `ScenePanel.keyPressed` 的那句。 */
  const openMenuRef = useRef(false)
  const [dialogue, setDialogue] = useState<DialogueState | null>(null)
  const [scene, setScene] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>('start')
  const [battleLoading, setBattleLoading] = useState(false)
  const [menuLoading, setMenuLoading] = useState(false)
  /** 第几局。`restart()` 让它涨一，建会话的 effect 就整个重来。 */
  const [generation, setGeneration] = useState(0)
  const signatureRef = useRef<string | null>(null)
  const sceneRef = useRef<string | null>(null)
  const panelRef = useRef<Panel>('start')
  /** 已经载过贴图的那个战斗世界（按引用比）。换一场就要重载。 */
  const loadedBattleRef = useRef<BattleWorld | null>(null)
  const battleLoadingRef = useRef(false)
  /** 已经载过贴图的那一份菜单名单（按内容比）。翻页要重载当前页的背景。 */
  const loadedMenuRef = useRef<string | null>(null)
  const menuLoadingRef = useRef(false)

  // 换场景 = 换一个世界。主角回到脚本里的出生格。**`sceneName` 是 `null` 就
  // 一个世界都不建**（xl-q7f）：开机、以及开发用选择器拨回「标题」那一项，
  // 走的都是这条 —— 会话停在起手态上，标题那一屏归 `app/App.tsx` 画。
  //
  // 场景 JSON 是按需取的（见 `data/scenes.ts`），所以这里有一段"世界还没建好"
  // 的时间：会话先换成起手态，下面的 pump 认得它并跳过这一拍。旧世界必须当场
  // 清掉——留着它，切场景的这几十毫秒里主角会在旧地图上继续走。
  useEffect(() => {
    let disposed = false
    // 会话**当场就有**，只是还没开局（`scene: null`，见 `session.ts`）：
    // 有它才有"标题这一屏该放主题曲"这句话可说，pump 也才有东西可读。
    //
    // 「起」带进新局的那两样（xl-i06.11）：原版里是 static 的装备库存与答题记录，从上一局的
    // 会话里取出来再建新的。开机那一次上一局是 `null`，什么都不带。
    const carry = carryIntoNewGame(sessionRef.current)
    sessionRef.current = createSession(SESSION_DEPS, carry)
    queueRef.current = []
    battleInputsRef.current = []
    menuInputRef.current = []
    menuGrabRef.current = false
    openMenuRef.current = false
    signatureRef.current = null
    sceneRef.current = null
    loadedBattleRef.current = null
    battleLoadingRef.current = false
    setDialogue(null)
    setScene(null)
    setBattleLoading(false)
    loadedMenuRef.current = null
    menuLoadingRef.current = false
    setMenuLoading(false)
    shopInputRef.current = []
    loadedShopRef.current = null
    shopLoadingRef.current = false
    shopSinceRef.current = null
    setShopLoading(false)
    lsInputRef.current = []
    openLoadRef.current = false
    // 载入那几十毫秒里显示的是**场景**（"正在载入 X…"），不是标题。
    //
    // **这一点跟原版是一致的**，而 xl-w16 的票面写反了（它说"原版是
    // `initiation(...)` 返回之后才 `switchTo("scene")`"）。照 GBK 源码现读
    // （`src/start/StartPanel.java` 的 `startLoadAction()` case 0）：
    //
    //     GameLauncher.switchTo("scene");          ← 先换面板
    //     …
    //     GameLauncher.scenePanel.initiation("脚本1.txt");   ← 后读盘
    //
    // 换面板在前、读盘在后，顺序与这里一模一样。而且原版在换面板**之前**
    // 还要等 `loadTimer` 走完（`if (loadTimer.stop())`，30 拍，见
    // `start/layout.ts` 的 `LOAD_TICKS`），那段载入动画是画在标题那一屏上的
    // —— 这一层也复刻了（`start/panelState.ts`）。
    //
    // 真正的残差只有一条，而且不在这个顺序上：原版 `initiation` 是**同步**
    // 读本地文件，几毫秒就回来，那一屏"正在载入"快到看不见；这里的场景 JSON
    // 与贴图是 `fetch` 来的，所以那句提示看得见一下。要抹掉它只能预取，而
    // 预取正是 `app/App.tsx` 里 `shownScene` 那一句在做的事。
    //
    // ⚠️ 顺带记一条被推翻的理由：这里原先写的是"翻回标题会把 `StartPanel`
    // 整个重挂一次，卷轴缩回去再展开一遍"。那句站不住 —— 点「起」这条路上
    // 面板本来就停在 `'start'`，让它继续停着并不会重挂任何东西。真正的理由
    // 是上面那条：原版就是先换面板。
    const startingPanel: Panel = sceneName === null ? 'start' : 'scene'
    panelRef.current = startingPanel
    setPanel(startingPanel)
    if (sceneName !== null) {
      void loadScene(sceneName).then(async (loaded) => {
        if (disposed) return
        rememberScene(sceneName, loaded)
        const world = createWorld(loaded, true, carry.recorder)
        // 先把这个场景出口的目标取到手，走到门口才切得动（见 data/loadedScenes.ts）。
        await prepareExits(world)
        // 怪物的出场图也要先量 —— `createBattle` 是同步的，见 `enemySprites.ts`。
        await prepareEnemySprites(enemyNamesOf(loaded))
        const idle = sessionRef.current
        if (disposed || idle === null) return
        sessionRef.current = enterScene(idle, world)
        sceneRef.current = sceneName
        setScene(sceneName)
      })
    }
    return () => {
      disposed = true
    }
    // `generation` 在 deps 里：`restart()` 之后即便场景名没变（在脚本1 里死掉
    // 再重开就是这样），这个 effect 也得重跑一遍。只依赖 `sceneName` 的话
    // 那一路"点了没反应"，而从别的场景重开却是好的 —— 两种表现分得开，
    // 所以钉住它的用例（`useGame.test.tsx` 的「重开一局」）是**在同一个场景
    // 里** restart 的：`app/appTitle.test.tsx` 那条先把选择器拨到大地图，
    // 走的是 `sceneName` 变了那条路，`generation` 在那里观测不到。
  }, [sceneName, generation])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // ESC 开菜单 —— 原版 `ScenePanel.keyPressed` 里那句
      // `if (keyCode == VK_ESCAPE) switchTo("menu")`。**只有场景那一屏认它**，
      // 而这一句就是那件事的全部：`openMenu` 自己会挡住别的面板。
      //
      // ⚠️ 菜单开着的时候按 ESC **出不去** —— 那是原版的死代码，是复刻不是
      // 缺陷（`menu/step.ts` 的 `menuWantsScene`）。别"顺手修好"它。
      if (event.type === 'keydown' && event.key === 'Escape') {
        event.preventDefault()
        // 存读档面板开着时 ESC 归它（`GameLauncher.keyPressed` 只转给当前面板：
        // `if(currentPanel==lsPanel) lsPanel.keyPressed(keyCode)`）。结局期间当前面板
        // 仍是场景（`keyReceiver`），于是 ESC 照样开菜单、把结局切走（xl-czb.6）。
        const to = keyReceiver(panelRef.current)
        if (to === 'ls') lsInputRef.current.push({ e: 'key', key: 'escape' })
        else if (to === 'scene') openMenuRef.current = true
        return
      }
      // 战斗里的调试外挂键 J（xl-03x.14）：`GameLauncher.keyPressed` 在当前面板是
      // 战斗时把键码转给 `BattlePanel.keyPressed`，那里只认 `VK_J`。认物理键位
      // （`code`）而不只认字符：中文输入法开着时 `key` 是 `Process`。
      if (event.type === 'keydown' && (event.code === 'KeyJ' || event.key.toLowerCase() === 'j')) {
        if (keyReceiver(panelRef.current) === 'battle') {
          event.preventDefault()
          battleInputsRef.current.push({ e: 'key', key: 'j' })
          return
        }
      }
      const input = toInputEvent({
        type: event.type === 'keydown' ? 'keydown' : 'keyup',
        key: event.key,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
      })
      if (!input) return
      // 方向键默认会滚动页面。认下来的键就得拦住，否则一边走一边页面在动。
      event.preventDefault()
      queueRef.current.push(input)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])

  // 背景音乐：世界声明该放哪首，播放器只负责让实际输出等于它
  // （见 `audio/bgmPlayer.ts`）。它跟渲染器一样是个订阅者，不参与任何决定。
  const bgmRef = useRef<ReturnType<typeof createBgmPlayer> | null>(null)
  useEffect(() => {
    const player = createBgmPlayer()
    bgmRef.current = player
    return () => {
      bgmRef.current = null
      player.destroy()
    }
  }, [])

  // 音效（xl-03x.7）：与背景音乐是**两个播放器**（原版 `background` 与 `music` 两个
  // 实例），但喂法不同 —— 不是「同步当前值」，是每一拍把这一拍推出来的那几声交过去
  // （`session.ts` 的 `Session.sfx` / `playSfx`，判据的边界写在那里）。设定页的
  // 「特殊音效 开 / 关」也是 `playSfx` 每拍拨上去的（xl-03x.8）。
  const sfxRef = useRef<ReturnType<typeof createSfxPlayer> | null>(null)
  useEffect(() => {
    const player = createSfxPlayer()
    sfxRef.current = player
    return () => {
      sfxRef.current = null
      player.destroy()
    }
  }, [])

  /**
   * 这条 pump **不等渲染器**（xl-w16）。
   *
   * 它原先起手是一句 `if (!renderer) return`，而那一句同时兼着两件事：
   *
   * 1. 「切场景那几十毫秒里别往旧渲染器上推世界」——真的需要，见下面那道
   *    `if (!renderer)`，位置挪了，语义一个字没变；
   * 2. 「还没开局时也别跑」——**这一半是白搭的**，而且有代价：标题那一屏的
   *    主题曲是 pump 里 `bgm.sync(currentBgm(session))` 放上去的，于是它要
   *    等脚本1 的地图与 JSON 全部载完、`status.kind` 变成 `ready`，标题才
   *    出声。原版 `GameLauncher.switchTo("start")` 是当场 `readBGM`。
   *
   * **哑多久实测过**（2026-09-08，这台 mac，`pnpm build` 的产物 + `pnpm
   * preview`，Chrome 152，逐次开一个隔离的浏览器上下文＝冷缓存）。两个读数
   * 都在页面自己的 `performance.now()` 上取：标题背景图 `.start-back` 的
   * `load`，与那唯一一个 `Audio` 对象被赋 `src` 的那一刻（`src` 的 setter
   * 是从 `HTMLMediaElement.prototype` 上劫的，源码一个字没改）。
   *
   *     改之前 · 冷缓存  418 / 518 / 322 / 258 ms
   *     改之前 · 热缓存  264 / 296 ms
   *     改之后 · 冷缓存   −8 / −10 / −11 ms
   *     改之后 · 热缓存    9 /   9 ms
   *
   * 也就是从 **0.26–0.52 秒的哑场**变成**十来毫秒以内**。冷缓存那组改后是
   * 负的（曲子的请求比标题背景图画出来还早），热缓存那组是正的十毫秒 ——
   * 差别不在音频那一侧，而在背景图：热缓存下它 54 ms 就画出来了，冷缓存下
   * 要 90–160 ms。**两组都是四个读数对三个 / 两个对两个，前后同一套测法、
   * 同一台机器**；冷缓存那组的离散度不小（258–518 ms），别把其中任何一个
   * 单独当常数引用。
   *
   * ⚠️ 改之前那组数是**没有自动播放门槛时**的：
   * 那次跑的 Chrome 由 devtools 起，`play()` 直接 resolve、`currentTime`
   * 在走。真实浏览器上第一次访问会被自动播放策略挡下来，此时哑多久由用户
   * 什么时候给出第一次手势决定，跟这个数无关。
   *
   * 而**被挡下来那条路才是真正该修的理由**，它比 0.5 秒难看得多：
   * `bgmPlayer` 只有在 `play()` 被拒之后才 `arm()` 一个手势监听器
   * （见 `audio/bgmPlayer.ts`）。pump 起得晚，这半秒里用户按下的那一次
   * ——很可能正是点在「起」上的那一下——落在监听器装上之前，**整个被浪费
   * 掉**，主题曲要等下一次手势才响。pump 不等渲染器之后，会话一建出来
   * 下一拍（`TICK_MS` = 10ms）就 `sync`，第一次手势就接得住。
   *
   * 代价是这条 interval 现在从挂载起就一直在跑。没开局时它每拍只做两件事：
   * 读一个 ref、调一次 `sync`（同值是空操作，见 `bgmPlayer.sync`）。
   */
  useEffect(() => {
    let last = performance.now()
    /** 结局那二十几张载齐没有 / 正在载。跟着渲染器走：渲染器一换，effect 重建，这两个也重置。 */
    let endLoaded = false
    let endLoadingNow = false
    /** 一个场景要量哪几只怪 —— 按场景名记一份，不必每拍重扫脚本。 */
    const nameCache = new Map<string, readonly string[]>()
    const enemyNamesFor = (file: string): readonly string[] => {
      const cached = nameCache.get(file)
      if (cached) return cached
      const scene = loadedSceneSource(file)
      // 场景还没进过那张表就先当作"没有怪要量"：世界本身就是从那张表建的，
      // 所以这个分支只在走出门的那一瞬间出现，下一拍就有了。
      const names = scene === undefined ? EMPTY_NAMES : enemyNamesOf(scene)
      if (scene !== undefined) nameCache.set(file, names)
      return names
    }
    const pump = () => {
      let session = sessionRef.current
      if (!session) return
      const now = performance.now()
      // 标题上点了「承」（xl-i06.9）：`setLastPanel("start")` + `changeStateTo(LOAD)` +
      // `switchTo("ls")`。只有停在标题上时才算 —— 那颗按钮只画在标题上。
      if (openLoadRef.current) {
        openLoadRef.current = false
        if (session.panel === 'start') session = sessionRef.current = enterSaveLoad(session, 'load', 'start')
      }
      // 读档（xl-i06.10）：面板那一下只记了槽号。重建是同步的、场景 JSON 是按需取的，
      // 所以先把要读进的那个场景取到手，取到的那一拍才 `loadGame`（见 `Session.loadRequest`）。
      // 取的这几十毫秒里面板上写着「正在读入」，面板不再收输入。
      const target = loadTargetOf(session)
      if (target !== null) {
        const name = target.replace(/\.txt$/, '')
        if (loadedSceneSource(target) === undefined) {
          void loadScene(name)
            .then((loaded) => rememberScene(name, loaded))
            .catch((e: unknown) => {
              // 取不到就把这一次读档撤掉，面板重新收输入（退出键回得去）。不撤的话每一拍都重取、
              // 面板停在「正在读入」又不收输入 —— 一个没有出口的状态（/code-review Spec 轴）。
              console.error(`读档要进的场景 ${name} 取不到，这一次读档撤销：`, e)
              const now = sessionRef.current
              if (now !== null && now.loadRequest !== null) sessionRef.current = { ...now, loadRequest: null }
            })
        } else {
          session = sessionRef.current = loadGame(session)
          // 画面跟着世界走：场景名一变，`app/App.tsx` 就换那一张地图的渲染器。
          sceneRef.current = name
          setScene(name)
          signatureRef.current = null
          setDialogue(null)
          last = now
        }
      }
      // 还没开局（xl-q7f）：原版这时 `ScenePanel` 那条线程根本没起来，一拍
      // 都不推。曲子照放 —— 标题那一屏放主题曲，也是会话说了算。
      //
      // 唯一的例外是从标题「承」进来的存读档面板：它收自己的鼠标与退出键，
      // 与场景那条线程无关（`advanceSession` 起手先推它，然后照样原样交回）。
      if (!isRunning(session)) {
        last = now
        const before = session
        if (session.panel === 'ls') {
          const saveload = lsInputRef.current
          lsInputRef.current = []
          const next = advanceSession(session, { ...NO_INPUT, saveload }, 0)
          sessionRef.current = next
          if (sfxRef.current) playSfx(sfxRef.current, next)
          syncPanel(next)
          drawSaveLoad(next, now)
          session = next
        }
        // 同一首也从头放的那两拍（回标题 xl-6zf、场景消费 SCENE_SIGNAL xl-4io），见
        // `bgmFromStart`。没开局时只到得了前一种：存读档面板 Esc 回标题。
        bgmRef.current?.sync(currentBgm(session), bgmFromStart(before, session))
        return
      }
      // **从这里往下都要渲染器**：场景正在换的那几十毫秒里，世界已经在新场景
      // 里，而渲染器手上还是旧地图。这时候推进世界就得往旧渲染器上画，撞它
      // 那道 NPC 条数的校验。停一拍就是原版 `initiation` 读盘时停的那一拍。
      //
      // 这一句原先写在 effect 的第一行（`if (!renderer) return`）。挪到这里
      // 是 xl-w16 的改动：**拦的东西一个没少**（世界照样不推进），少拦的只有
      // 「还没开局」那一路，而那一路本来就一行渲染都没有。
      //
      // **这里不需要 `last = now`**，跟上面那道 `isRunning` 的门不一样。
      // `renderer` 在这个 effect 的 deps 里，所以在**一个闭包的整个生命里
      // 它是个常量**：这道门要么每一拍都拦、要么一拍都不拦，`last` 在被拦
      // 的那种闭包里从头到尾没人读。渲染器一到，effect 整个重建，
      // `let last = performance.now()` 自己就重置了。
      //
      // 这条是篡改验证追出来的：把 `last = now` 删掉，测试全绿 —— 那不是
      // 判据失灵，是它本来就是死代码（xl-w16）。
      if (!renderer) return
      // 邻居还没取到手就先停一拍：出口切换是同步的，切不动只能是抛
      // （见 `state/step.ts` 的 `SceneSource`）。这里停的是几十毫秒，
      // 原版在 `initiation` 里读盘时停的也是这个。
      if (!exitsReady(session.scene.world)) {
        void prepareExits(session.scene.world)
        last = now
        return
      }
      // 怪物的出场图同理：`createBattle` 是同步的，量不到就只能抛。走出门
      // 进了新场景之后要重量一批，所以这道门每一拍都在。
      const names = enemyNamesFor(session.scene.world.scene)
      if (!spritesReady(names)) {
        void prepareEnemySprites(names)
        last = now
        return
      }
      const elapsed = now - last
      last = now
      const input = {
        scene: queueRef.current,
        battle: battleInputsRef.current,
        menu: menuInputRef.current,
        shop: shopInputRef.current,
        saveload: lsInputRef.current,
      }
      queueRef.current = []
      battleInputsRef.current = []
      menuInputRef.current = []
      shopInputRef.current = []
      lsInputRef.current = []
      // 按 ESC 开菜单。**在推进之前**：晚一拍开的话那一拍的方向键还会被场景
      // 收走，表现为"按了 ESC 主角又多走一步"。
      const opening = openMenuRef.current
      openMenuRef.current = false
      const next = advanceSession(opening ? openMenu(session) : session, input, elapsed)
      sessionRef.current = next
      // 回标题（xl-6zf）与场景消费 SCENE_SIGNAL（xl-4io）那两拍同一首也从头放。
      bgmRef.current?.sync(currentBgm(next), bgmFromStart(session, next))
      if (sfxRef.current) playSfx(sfxRef.current, next)
      syncPanel(next)
      drawBattle(next)
      drawMenu(next)
      drawShop(next, now)
      drawSaveLoad(next, now)
      drawEnd(next)
      // 战斗面板显示的时候场景那张画布看不见，画它是白费；而**世界照样在推**
      // （原版那条线程没停），所以这里跳的只有绘制。
      if (next.panel !== 'scene') return
      const entered = next.scene.world.scene.replace(/\.txt$/, '')
      if (entered !== sceneRef.current) {
        // 走出门了。**这一帧不画**：渲染器手上还是上一个场景的地图与精灵，
        // 硬画会撞上它那道"这一帧有 13 个 NPC，而渲染器建了 2 个精灵"的校验。
        sceneRef.current = entered
        setScene(entered)
        return
      }
      renderer.showWorld(next.scene.world)
      const signature = dialogueSignature(next.scene.world)
      if (signature !== signatureRef.current) {
        signatureRef.current = signature
        setDialogue(next.scene.world.dialogue)
      }
    }

    /**
     * 战斗那张画布。**贴图要先载齐才画得动**（`BattleRenderer.load` 的合同），
     * 而战斗世界是同步建出来的，所以有几十毫秒的空窗。空窗里不画 ——
     * 画一半贴图的那一帧看起来像"素材掉了"，而它其实只是还没到。
     */
    function drawBattle(next: Session): void {
      if (!battleRenderer || next.panel !== 'battle' || next.battle === null) return
      const world = next.battle.world
      if (loadedBattleRef.current !== world) {
        loadedBattleRef.current = world
        battleLoadingRef.current = true
        setBattleLoading(true)
        void battleRenderer.load(battleTextureIds(world)).then(() => {
          if (loadedBattleRef.current !== world) return
          battleLoadingRef.current = false
          setBattleLoading(false)
        })
        return
      }
      if (battleLoadingRef.current) return
      // 带拍号：同一拍每个 rAF 都会调到这里，渲染器按拍号只合成一次（xl-84z）。
      // ⚠️ 一个 rAF 推了不止一拍时（掉帧到 10 fps 以下）中间那几拍这里补不上 ——
      // 那几拍的世界已经被推过去了，半透明的边上会少几层残影。
      battleRenderer.draw(battleDrawList(world, next.battle.paint), world.tick)
    }

    /**
     * 菜单那张画布。与战斗那半同构：贴图要先载齐才画得动，空窗里不画。
     *
     * **按世界的引用比**，不按面板名：每次开菜单都新建一份世界
     * （`session.openMenu`），所以换一次菜单就要重载一次当前页的背景 ——
     * 另外三页的背景走按需加载，翻到哪一页才取哪一张。
     */
    function drawMenu(next: Session): void {
      if (!menuRenderer || next.panel !== 'menu') return
      const world = next.menu.world
      const wanted = menuTextureIds(world).join('\u0000')
      if (loadedMenuRef.current !== wanted) {
        loadedMenuRef.current = wanted
        menuLoadingRef.current = true
        setMenuLoading(true)
        void menuRenderer.load(menuTextureIds(world)).then(() => {
          if (loadedMenuRef.current !== wanted) return
          menuLoadingRef.current = false
          setMenuLoading(false)
        })
        return
      }
      if (menuLoadingRef.current) return
      menuRenderer.draw(menuDrawList(world, menuTaskOf(next.scene)))
    }

    /**
     * 商店那张画布（xl-yg6.11）。与菜单同构：贴图按**内容**比，装备店换一栏
     * 商品图就换一批，要重载；空窗里不画。
     *
     * **每一拍都画**，不像菜单那样只在世界变了才有得画：那条动画线程
     * （鼠标图 + 四条人物动画，120 ms 一格）不碰状态，帧号从进门那一刻现数
     * （`shop/preview.ts` 的 `previewFrame` —— 名字是预览那时起的，数法就是
     * 原版那个"先赋值后睡"的循环，进店的正路与预览共用这一份）。
     */
    function drawShop(next: Session, now: number): void {
      const world = shopWorldOf(next)
      if (world === null) {
        shopSinceRef.current = null
        return
      }
      if (shopSinceRef.current === null) shopSinceRef.current = now
      if (!shopRenderer) return
      const wanted = shopTextureIds(world).join('\u0000')
      if (loadedShopRef.current !== wanted) {
        loadedShopRef.current = wanted
        shopLoadingRef.current = true
        setShopLoading(true)
        void shopRenderer.load(shopTextureIds(world)).then(() => {
          if (loadedShopRef.current !== wanted) return
          shopLoadingRef.current = false
          setShopLoading(false)
        })
        return
      }
      if (shopLoadingRef.current) return
      shopRenderer.draw(shopDrawList(world, previewFrame(now - shopSinceRef.current)))
    }

    /**
     * 结局那张画布（xl-czb.6）。素材一共二十几张，**进结局那一下一次载齐**；空窗里不画。
     * 每拍都照世界画一次：定格之后世界不再变，画出来的也就是同一张（原版不再 repaint，
     * 缓冲图停在最后一帧 —— 两者画面上一样）。
     */
    function drawEnd(next: Session): void {
      const world = endWorldOf(next)
      if (!endRenderer || world === null) return
      if (!endLoaded) {
        if (endLoadingNow) return
        endLoadingNow = true
        setEndLoading(true)
        void endRenderer.load(endTextureIds()).then(() => {
          endLoaded = true
          endLoadingNow = false
          setEndLoading(false)
        })
        return
      }
      endRenderer.draw(endDrawList(world))
    }

    function syncPanel(next: Session): void {
      if (next.panel !== panelRef.current) {
        panelRef.current = next.panel
        setPanel(next.panel)
      }
    }

    /**
     * 存读档面板那张画布（xl-i06.9）。与商店同构：贴图按内容比、空窗里不画、每拍都画
     * （那条动画线程只推帧号，帧号从进面板那一刻现数，100 ms 一格）。
     *
     * **没就绪就把画布清空**，不画槽 —— 「还没读上来」画成三个空槽是一句谎话
     * （`save/store.ts` 的就绪标志）；那几行字归 `app/App.tsx` 的提示。
     */
    function drawSaveLoad(next: Session, now: number): void {
      const view = saveLoadViewOf(next)
      syncSaveLoadNotice(view)
      if (view === null) {
        lsSinceRef.current = null
        return
      }
      if (lsSinceRef.current === null) lsSinceRef.current = now
      if (!saveLoadRenderer) return
      if (view.status !== 'ready') {
        saveLoadRenderer.draw([])
        return
      }
      const world = view.world
      const wanted = saveLoadTextureIds(world).join(' ')
      if (loadedLsRef.current !== wanted) {
        loadedLsRef.current = wanted
        lsLoadingRef.current = true
        setSaveLoadLoading(true)
        void saveLoadRenderer.load(saveLoadTextureIds(world)).then(() => {
          if (loadedLsRef.current !== wanted) return
          lsLoadingRef.current = false
          setSaveLoadLoading(false)
        })
        return
      }
      if (lsLoadingRef.current) return
      const tick = (since: number) => Math.floor((now - since) / 100)
      const glow = world.buttons.map((b, i) => {
        if (!b.glowing) glowSinceRef.current[i] = null
        else if (glowSinceRef.current[i] === null) glowSinceRef.current[i] = now
        const since = glowSinceRef.current[i]
        return since === null || since === undefined ? 0 : tick(since)
      })
      const t = tick(lsSinceRef.current)
      saveLoadRenderer.draw(saveLoadDrawList(world, { cursor: t, roles: t, glow }))
    }

    /** 那几行提示只在内容变了的时候交给 React。 */
    function syncSaveLoadNotice(view: ReturnType<typeof saveLoadViewOf>): void {
      const notice: SaveLoadNotice | null =
        view === null
          ? null
          : view.status === 'loading'
            ? { status: 'loading' }
            : view.status === 'failed'
              ? { status: 'failed', error: view.error?.message ?? '原因不明' }
              : { status: 'ready', persistError: view.persistError?.message ?? null, loadRequest: view.loadRequest }
      const sig = JSON.stringify(notice)
      if (sig === saveLoadSigRef.current) return
      saveLoadSigRef.current = sig
      setSaveLoad(notice)
    }

    const id = window.setInterval(pump, TICK_MS)
    return () => window.clearInterval(id)
  }, [renderer, battleRenderer, menuRenderer, shopRenderer, saveLoadRenderer, endRenderer])

  /** 存读档面板上的一次鼠标事件。面板没开着就丢掉。 */
  const lsInput = (input: SaveLoadInput): void => {
    if (sessionRef.current?.panel !== 'ls') return
    lsInputRef.current.push(input)
  }

  const openLoad = (): void => {
    openLoadRef.current = true
  }

  const click = (x: number, y: number): void => {
    const world = sessionRef.current?.battle?.world
    if (!world || sessionRef.current?.panel !== 'battle') return
    battleInputsRef.current.push(battleClick(world, x, y))
  }

  /**
   * 菜单里的一次鼠标事件（舞台**逻辑坐标**）。
   *
   * 三种都要送：`press` / `release` / `move`。只送 `press` 的话按钮永远停在
   * 「按下」那一张贴图上（`isclicked` 也不清），而那看起来像"点了一下就卡住"。
   */
  const menuInput = (input: MenuInput): void => {
    // 松手按 **grab** 派：在菜单上按下过，松手就归菜单，不看它此刻还显不显示
    // （xl-z4f）。按下「返回」那一拍菜单就关了，松手落在下一拍 —— 按当前面板
    // 过滤的话它整个丢掉，「返回」的 `isclicked` 永远粘着。原版是 Swing 的
    // `LightweightDispatcher` 握着按下时那个组件（`session.ts` 里有读数）。
    if (input.e === 'release' && menuGrabRef.current) {
      menuGrabRef.current = false
      menuInputRef.current.push(input)
      return
    }
    if (sessionRef.current?.panel !== 'menu') return
    if (input.e === 'press') menuGrabRef.current = true
    menuInputRef.current.push(input)
  }

  /** 菜单画布上这个坐标该挂的 `title`。读的是此刻的菜单世界，见 `GameView.menuTitleAt`。 */
  const menuTitleAt = (x: number, y: number): string | null => {
    const session = sessionRef.current
    const world = session === null ? null : menuWorldOf(session)
    return world === null ? null : menuDisabledReasonAt(world, x, y)
  }

  /** 店里的一次鼠标事件（舞台**逻辑坐标**）。店没开着就丢掉。 */
  const shopInput = (input: ShopInput): void => {
    if (sessionRef.current?.panel !== 'shop') return
    shopInputRef.current.push(input)
  }

  const restart = (): void => {
    resetParty()
    setGeneration((n) => n + 1)
  }

  return {
    dialogue,
    scene,
    panel,
    battleLoading,
    menuLoading,
    shopLoading,
    click,
    menuInput,
    menuTitleAt,
    shopInput,
    restart,
    saveLoad,
    saveLoadLoading,
    endLoading,
    lsInput,
    openLoad,
  }
}

/**
 * "画出来会不会不一样"的签名。
 *
 * 只包含 `DialogueBox` 真正读到的字段：开没开、什么样式、哪张头像、名字、
 * 三个滑入动画的位置、闪烁帧、以及这一屏的字符网格。整句 `sentence` 也算上
 * ——读屏用的那一行整句读它。
 *
 * **不能只拿 `cursor` 代替字符网格**：翻页会把网格清空而 `cursor` 照涨，
 * 两屏之间会有一帧签名相同、画面却该换的时刻。
 */
function dialogueSignature(world: World): string {
  const d = world.dialogue
  if (!d.speaking && !d.oral) return ''
  return [
    d.type,
    d.headNo,
    d.name,
    d.sentence,
    d.boxX,
    d.boxY,
    d.headX,
    d.nameX,
    d.iconFrame,
    d.printing,
    d.sentenceOver,
    d.pageOver,
    d.text.map((row) => row.map((c) => c ?? ' ').join('')).join('|'),
  ].join('\u0000')
}

/** 空名单的常量，省得每拍新建一个数组。 */
const EMPTY_NAMES: readonly string[] = []
