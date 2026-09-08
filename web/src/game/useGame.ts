import { useEffect, useRef, useState } from 'react'
import { createBgmPlayer } from '../audio/bgmPlayer'
import { battleTextureIds } from '../battle/render/assets'
import type { BattleRenderer } from '../battle/render/battleRenderer'
import { battleDrawList } from '../battle/render/drawList'
import type { BattleInput } from '../battle/step'
import type { BattleWorld } from '../battle/types'
import { exitsReady, loadedSceneSource, prepareExits, rememberScene } from '../data/loadedScenes'
import { resetParty } from '../fakes/party'
import { loadScene } from '../data/scenes'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { TICK_MS, createWorld } from '../state/step'
import type { DialogueState } from '../state/dialogue'
import type { InputEvent, World } from '../state/types'
import { battleClick } from './battleInput'
import { enemyNamesOf, enemySpriteSize, prepareEnemySprites, spritesReady } from './enemySprites'
import { toInputEvent } from './keyboard'
import { advanceSession, createSession, currentBgm, enterScene, isRunning } from './session'
import type { Panel, Session, SessionDeps } from './session'

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
  /**
   * 舞台**逻辑坐标**里的一次点击。战斗面板才用得到；别的面板收下就丢掉。
   *
   * 换算（客户端坐标 → 1024×640）由调用方做：只有它知道画布被缩放了多少
   * （见 `stage/Stage.tsx`）。这一层收的一律是逻辑坐标，与真值里的坐标同一
   * 套 —— 中间多一次换算，就多一处"点得中点不中"说不清的地方。
   */
  readonly click: (x: number, y: number) => void
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
}

export function useGame(
  renderer: SceneRenderer | null,
  /** 现在该在哪个场景。`null` = 还没开局，停在标题上（xl-q7f）。 */
  sceneName: string | null,
  battleRenderer: BattleRenderer | null = null,
): GameView {
  const sessionRef = useRef<Session | null>(null)
  const queueRef = useRef<InputEvent[]>([])
  const clicksRef = useRef<BattleInput[]>([])
  const [dialogue, setDialogue] = useState<DialogueState | null>(null)
  const [scene, setScene] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>('start')
  const [battleLoading, setBattleLoading] = useState(false)
  /** 第几局。`restart()` 让它涨一，建会话的 effect 就整个重来。 */
  const [generation, setGeneration] = useState(0)
  const signatureRef = useRef<string | null>(null)
  const sceneRef = useRef<string | null>(null)
  const panelRef = useRef<Panel>('start')
  /** 已经载过贴图的那个战斗世界（按引用比）。换一场就要重载。 */
  const loadedBattleRef = useRef<BattleWorld | null>(null)
  const battleLoadingRef = useRef(false)

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
    sessionRef.current = createSession(SESSION_DEPS)
    queueRef.current = []
    clicksRef.current = []
    signatureRef.current = null
    sceneRef.current = null
    loadedBattleRef.current = null
    battleLoadingRef.current = false
    setDialogue(null)
    setScene(null)
    setBattleLoading(false)
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
        const world = createWorld(loaded)
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
   *     冷缓存  418 / 518 / 322 / 258 ms
   *     热缓存  264 / 296 ms
   *
   * 也就是 **0.26–0.52 秒的哑场**。⚠️ 这组数是**没有自动播放门槛时**的：
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
      const session = sessionRef.current
      if (!session) return
      const now = performance.now()
      // 还没开局（xl-q7f）：原版这时 `ScenePanel` 那条线程根本没起来，一拍
      // 都不推。曲子照放 —— 标题那一屏放主题曲，也是会话说了算。
      if (!isRunning(session)) {
        last = now
        bgmRef.current?.sync(currentBgm(session))
        return
      }
      // **从这里往下都要渲染器**：场景正在换的那几十毫秒里，世界已经在新场景
      // 里，而渲染器手上还是旧地图。这时候推进世界就得往旧渲染器上画，撞它
      // 那道 NPC 条数的校验。停一拍就是原版 `initiation` 读盘时停的那一拍。
      //
      // 这一句原先写在 effect 的第一行（`if (!renderer) return`）。挪到这里
      // 是 xl-w16 的改动：**拦的东西一个没少**（世界照样不推进），少拦的只有
      // 「还没开局」那一路，而那一路本来就一行渲染都没有。
      if (!renderer) {
        last = now
        return
      }
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
      const input = { scene: queueRef.current, battle: clicksRef.current }
      queueRef.current = []
      clicksRef.current = []
      const next = advanceSession(session, input, elapsed)
      sessionRef.current = next
      bgmRef.current?.sync(currentBgm(next))
      if (next.panel !== panelRef.current) {
        panelRef.current = next.panel
        setPanel(next.panel)
      }
      drawBattle(next)
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
      battleRenderer.draw(battleDrawList(world, next.battle.paint))
    }

    const id = window.setInterval(pump, TICK_MS)
    return () => window.clearInterval(id)
  }, [renderer, battleRenderer])

  const click = (x: number, y: number): void => {
    const world = sessionRef.current?.battle?.world
    if (!world || sessionRef.current?.panel !== 'battle') return
    clicksRef.current.push(battleClick(world, x, y))
  }

  const restart = (): void => {
    resetParty()
    setGeneration((n) => n + 1)
  }

  return { dialogue, scene, panel, battleLoading, click, restart }
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
