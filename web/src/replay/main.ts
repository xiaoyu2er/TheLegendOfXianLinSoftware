import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { exitsReady, loadedSceneSource, prepareExits, rememberScene } from '../data/loadedScenes'
import { loadScene } from '../data/scenes'
import { DialogueBox } from '../ui/DialogueBox'
import '../index.css'
import { createSceneRenderer } from '../scene/sceneRenderer'
import { battleTextureIds, enemyWalkId } from '../battle/render/assets'
import { createBattleRenderer } from '../battle/render/battleRenderer'
import type { BattleRenderer } from '../battle/render/battleRenderer'
import type { BufferMode } from '../battle/render/bufferPlan'
import { battleDrawList } from '../battle/render/drawList'
import type { DrawOp } from '../battle/render/drawList'
import { createPaintState } from '../battle/render/paint'
import { replayBattle } from '../battle/replay'
import { stepBattleWithPaint } from '../battle/loop'
import type { BattleTrace } from '../battle/trace'
import { menuTextureIds } from '../menu/render/assets'
import { menuDrawList } from '../menu/render/drawList'
import { createMenuRenderer } from '../menu/render/menuRenderer'
import type { MenuRenderer } from '../menu/render/menuRenderer'
import { replayMenuSetup, replayMenuTask } from '../menu/replay'
import { stepMenu } from '../menu/step'
// **类型从 `menu/trace.ts` 取，不在这里手抄一份。** 那个模块转手 `node:fs`，
// 但 `import type` 会被 TypeScript 整个擦掉、一行运行时代码都不产生（战斗那
// 一侧的 `BattleTrace` 走的是同一条路）。手抄一份子集的话，真值加一列时这里
// 不会响 —— 那正是"名单抄两份迟早分家"的类型版。
import type { MenuTrace } from '../menu/trace'
import { shopTextureIds } from '../shop/render/assets'
import { shopDrawList } from '../shop/render/drawList'
import { createShopRenderer } from '../shop/render/shopRenderer'
import type { ShopRenderer } from '../shop/render/shopRenderer'
import { replayShopSetup, shopInputsOfTicks } from '../shop/replay'
import { stepShop } from '../shop/step'
import type { ShopInput } from '../shop/step'
// 同菜单那一条的理由：类型从 `shop/trace.ts` 取，不在这里手抄一份子集。
// 那个模块转手 `node:fs`，而 `import type` 会被整个擦掉。
import type { ShopTrace } from '../shop/trace'
import { activePanel } from '../shop/world'
import { resolveAsset } from '../assets/resolve'
import type { AssetId } from '../assets/ids'
import { pickAssembly } from './drivers'
import type { ImplementedDriver } from './implemented'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { initiate, step } from '../state/step'
import type { InputEvent, World } from '../state/types'
// 同菜单那一条的理由：类型从 `compare/saveFixtures.ts` 取。那个模块转手 `node:fs`
// （它在比对器那一半解原版存档），而 `import type` 会被整个擦掉。
import type { SaveFixture } from '../compare/saveFixtures'
import type { SceneScript } from '../data/types'
import { drugEntries, resetDrugPack } from '../fakes/drugPack'
import { resetParty } from '../fakes/party'
import { getCoins, resetWallet } from '../fakes/wallet'
import { JavaRandom } from '../game/javaRandom'
import { settleSceneRequests } from '../game/sceneLedger'
// 类型而已：`compare/ledger.ts` 是比对器那一半的判据。
import type { LedgerEntry } from '../compare/ledger'
import { applyReadBack, createSession, enterScene } from '../game/session'
import type { Session } from '../game/session'
import { createMemorySaveStore } from '../save/memoryStore'
import { saveLoadDrawList, FIRST_FRAMES } from '../saveload/render/drawList'
import type { SaveLoadDrawOp } from '../saveload/render/drawList'
import { createSaveLoadRenderer } from '../saveload/render/saveLoadRenderer'
import type { SaveLoadRenderer } from '../saveload/render/saveLoadRenderer'
import { startSaveLoadReplay } from '../saveload/replay'
import type { SaveLoadSetup } from '../saveload/replay'
import type { SaveLoadInput } from '../saveload/step'
import { endTextureIds } from '../end/assets'
import { endDrawList } from '../end/render/drawList'
import type { EndDrawOp } from '../end/render/drawList'
import { createEndRenderer } from '../end/render/endRenderer'
import type { EndRenderer } from '../end/render/endRenderer'
import { startEndReplay } from '../end/replay'
import type { EndInput, EndSetup } from '../end/replay'
import { StartPanelView } from '../start/StartPanel'
import type { StartView } from '../start/panelState'
import { startStartReplay } from '../start/replay'
import type { StartInput } from '../start/replay'

/**
 * 取图页：**只在跨端逐帧比对里用**，不进游戏产物（`vite build` 只打
 * `index.html`，这个页面只有 dev server 上有）。
 *
 * 它做的事跟 `src/state/traceReplay.test.ts` 是同一件：照着真值里那一 tick
 * 实际喂给原版的按键回放。区别只在于回放完还要**真的画一帧**，让驱动器截图。
 *
 * 为什么回放的是按键而不是坐标：坐标是结论，按键是输入。喂坐标等于把两端
 * 的分歧提前抹平，比出来的图会一直一致，而游戏是错的。
 *
 * **画一帧包含对话框**（xl-9bd.10）。对话框是真 DOM，不在 Pixi 的画布上，
 * 所以这里也得把那一层叠上去 —— 少了它，跨端比对量到的是"Web 侧整个没画
 * 对话框"，那会把这一票的真实缺口（字体与基线对不到逐像素）盖掉。
 */

interface ReplayTick {
  readonly t: number
  readonly input: readonly InputEvent[]
  /** 这一 tick 走的是哪个脚本（`ScenePanel.fileName`）。出口切换之后一份 trace 横跨几个场景。 */
  readonly scene: string
}

interface ReplayTrace {
  /**
   * 驱动器判别名（xl-1vu.2）。**这一份必须是 `scene`** —— 下面那套装配建的是
   * 场景世界、贴的是场景渲染器。别的驱动器由 `pickAssembly` 挡在门外。
   */
  readonly driver: string
  readonly script: {
    readonly name: string
    /** 预热脚本，可为 null。**回放必须照做**，理由见 `state/trace.ts` 的 `replayWorld`。 */
    readonly warmup: string | null
    readonly scene: string
    readonly tickMs: number
    /** `ScenePanel.isScript`：false 时旁白与主线对话的轮询整个跳过。 */
    readonly isScript: boolean
    /** 读档起手的槽号（xl-i06.10）。起手见 `worldFromSave`。 */
    readonly load?: number
  }
  readonly tickCount: number
  readonly ticks: readonly ReplayTick[]
  /** 比对器在 Node 那一半解好的原版存档（`compare/saveFixtures.ts`）。只有读档剧本带。 */
  readonly fixture?: SaveFixture
}

/**
 * 一套装配：装载一份真值、把世界推到某一步并画出来。
 *
 * 与 `ReplayApi` 同形，但**每个驱动器一套**：场景装的是 Pixi 场景 + 对话框
 * DOM 层，战斗 / 菜单 / 商店各自会装别的。取图页对外只有一个 `__xlReplay`，
 * 进门先按判别名挑一套（见 `./drivers.ts`）。
 */
type Assembly = ReplayApi

export interface ReplayApi {
  /** 装载一份 trace：建世界、建渲染器、把场景贴上去。返回场景名与 tick 数。 */
  load(traceJson: string): Promise<{ scene: string; tickCount: number }>
  /**
   * 把世界推进到第 `t` 个 tick 并画出来。**只能往前**：状态是逐 tick 累积的，
   * 往回跳意味着重放，那是另一件事，不在这里悄悄发生。
   */
  seek(t: number): Promise<{ t: number; timeMs: number; x: number; y: number; ledger?: LedgerEntry }>
}

/**
 * 场景剧本的随机种子（xl-03x.3）。原版那一侧由 `SceneDriver.start()` 最后一句拿
 * `script.seed` 播 `Math.random()`；场景剧本不解析这个字段，`TraceScript` 缺省 0。
 * 两边要是不同一个数，答题加扣的金币就不同，账本对撞（`compare/ledger.ts`）当场红 ——
 * 所以这里写死一个数不会安静地跑偏。
 */
const SCENE_RANDOM_SEED = 0

let renderer: SceneRenderer | null = null
let overlay: Root | null = null
let trace: ReplayTrace | null = null
let world: World | null = null
/**
 * 场景那一侧的 `Math.random()` 替身：一条剧本一个实例，从第一次 `step()` 起取数 ——
 * 原版播种在起手的最后一句，之后第一个被取的随机数就落在第一个 tick 上。
 */
let sceneRandom: JavaRandom | null = null
let next = 0
/** 渲染器手上是哪个场景。世界换了场景，这里要跟着换图。 */
let shown: string | null = null

/**
 * **每套装配一个自己的宿主 div，同一时刻只显示一个。**
 *
 * 为什么需要这一层：两套装配各自建一个 Pixi `Application`，各自往宿主里塞一张
 * canvas。它们都挂在 `#host` 下面，而 `replay.html` 的 CSS 给 `#host canvas`
 * 定死了 1024×640 且 `display:block` —— 于是两张画布**上下摞着**，第二张被推
 * 出视口，截图截到的永远是第一张。
 *
 * 这不是推测，是实测出来的回归：注册战斗装配之后跑一整轮
 * （`tools/compare-frames.sh --self-check`，剧本按字典序，battle-* 排在最前），
 * 五条场景剧本的最差帧从 0.74%–37% 一齐跳到 **99.5%–99.99%**，而
 * `--self-check` 同时报「把主角画偏 8 像素之后，最先变的是 #0，不是注入点」。
 * 那两句话合起来说的是同一件事：截到的根本不是场景那张画布。
 *
 * **自检抓住了它**，而整屏表态的上界（`maxRatio`）也抓住了它 —— 两道都响，
 * 正是 xl-l3o 立那条上界的理由。
 */
function hostFor(kind: ImplementedDriver): HTMLElement {
  const root = document.getElementById('host')
  if (!root) throw new Error('取图页没有 #host')
  const id = `host-${kind}`
  const found = document.getElementById(id)
  if (found) return found
  const el = document.createElement('div')
  el.id = id
  el.style.width = '1024px'
  el.style.height = '640px'
  root.appendChild(el)
  return el
}

/** 只显示这一套装配的画布，其余全藏起来。对话框那一层只有场景用得到。 */
function activate(kind: ImplementedDriver): void {
  const root = document.getElementById('host')
  if (!root) throw new Error('取图页没有 #host')
  for (const child of Array.from(root.children)) {
    ;(child as HTMLElement).style.display = child.id === `host-${kind}` ? 'block' : 'none'
  }
  const overlayHost = document.getElementById('overlay')
  if (overlayHost) overlayHost.style.display = kind === 'scene' ? 'block' : 'none'
}

/** 取一个场景，并放进同步查得到的那张表里（出口切换要同步取，见 data/loadedScenes.ts）。 */
async function take(name: string) {
  const scene = await loadScene(name)
  rememberScene(name, scene)
  return scene
}

const stem = (file: string) => file.replace(/\.txt$/, '')

const sceneAssembly: Assembly = {
  async load(traceJson: string) {
    const parsed = JSON.parse(traceJson) as ReplayTrace
    // 钱、药、队伍是模块单例，而一个页面连着装好几条剧本：上一条读档剧本写进去的钱会画在
    // 下一条的金币 HUD 上。每条剧本起手都回出厂值 —— 状态层判据每份真值各起一个干净的
    // 会话，同一个意思。
    resetParty()
    resetWallet()
    resetDrugPack()
    const sceneName = stem(parsed.script.scene)
    const scene = await take(sceneName)
    renderer ??= await createSceneRenderer(hostFor('scene'))
    activate('scene')
    if (!overlay) {
      const host = document.getElementById('overlay')
      if (!host) throw new Error('取图页没有 #overlay')
      overlay = createRoot(host)
    }
    await renderer.showScene(scene)
    shown = sceneName
    trace = parsed
    // 照剧本头建世界：先 warmup 再进 scene（跟 `state/trace.ts` 的 `replayWorld`
    // 是同一件事，这里不能 import 它 —— 那个模块跑在 node 上）。
    const warm = parsed.script.warmup === null ? null : initiate(null, await take(stem(parsed.script.warmup)))
    world =
      parsed.script.load === undefined
        ? { ...initiate(warm, scene), isScript: parsed.script.isScript }
        : worldFromSave(parsed, warm)
    sceneRandom = new JavaRandom(SCENE_RANDOM_SEED)
    next = 0
    renderer.showWorld(world)
    drawOverlay(world)
    return { scene: sceneName, tickCount: parsed.tickCount }
  },

  async seek(t: number) {
    if (!trace || !world || !renderer) throw new Error('还没 load 就 seek')
    if (t < next - 1) {
      throw new Error(`取图只能往前：当前在第 ${next - 1} tick，要去第 ${t} tick`)
    }
    if (t >= trace.ticks.length) {
      throw new Error(`第 ${t} tick 超出了这份 trace 的 ${trace.ticks.length} 个 tick`)
    }
    for (; next <= t; next++) {
      const tick = trace.ticks[next]!
      // 出口切换是同步的，所以下一个场景要**在踩上去之前**取到手。
      // 这里按世界当前场景的出口预取，不看 trace 说它接下来去哪 —— 从真值里
      // 读"接下来该在哪个场景"，就等于把要比的那件事先喂了进来。
      if (!exitsReady(world)) await prepareExits(world)
      const random = sceneRandom!
      world = step(world, tick.input, trace.script.tickMs, loadedSceneSource, () => random.nextDouble())
      // 会话层记的那两笔账（答题加扣金币、开箱进背包），与真实会话共用同一段
      // （xl-03x.3）。从前这里只推 `step()`，金币 HUD 答完题仍画 10000。一拍一次：
      // 请求只亮一拍，这里逐拍 step，所以每一拍的请求恰好结算一遍。
      settleSceneRequests(world)
    }
    // 世界自己换了场景，画面跟上（原版的 initiation 同步换掉整张地图与全部精灵）。
    const entered = stem(world.scene)
    if (entered !== shown) {
      await renderer.showScene(await take(entered))
      shown = entered
    }
    renderer.showWorld(breakRender(world, t))
    drawOverlay(world)
    await twoFrames()
    return {
      t,
      timeMs: world.timeMs,
      x: world.role.px >> 5,
      y: world.role.py >> 5,
      // 这一帧的账本，比对器拿原版帧清单里同一帧的那一份去撞（`compare/ledger.ts`）。
      ledger: { coins: getCoins(), drugs: drugEntries().map(([name, count]) => ({ name, count })) },
    }
  },
}

/**
 * 读档剧本的起手（xl-i06.12）：原版不 `initiation(scene)`，而是 `Loader.load(N)` 读档
 * 再 `switchTo("scene")`。照剧本头那套 `warmup → scene` 建出来的是**另一个世界**。
 *
 * 走的是产品读档那一路的 `applyReadBack`（`game/session.ts`）—— 不只重建场景，还把
 * 钱、药、三个人落到各自的模块单例上：金币 HUD 画的是 `getCoins()`，只建场景世界的话
 * 那一格会画出厂的钱，与原版画的存档里的钱是两个数（M5 收口时答题剧本那条金币例外
 * 就是那个形状，xl-03x.3 删掉了）。它与状态层判据用的 `replayWorld` 是同一个世界，由
 * `game/loadSession.test.ts` 的等价用例接着。
 *
 * 那一份档读成什么样由比对器在 Node 那一半解好送来（`compare/saveFixtures.ts`）：
 * 没送来就抛 —— 当场抛是「比不了」，照 `scene` 起手画一个错的世界是「比出来一大片差」。
 */
function worldFromSave(parsed: ReplayTrace, warm: World | null): World {
  const f = parsed.fixture
  if (f?.kind !== 'readBack' || f.slot !== parsed.script.load) {
    throw new Error(
      `${parsed.script.name} 是读档剧本（load=${parsed.script.load}），比对器却没送来那一份档的读法` +
        `（收到 ${JSON.stringify(f?.kind ?? null)}）—— 见 compare/saveFixtures.ts`,
    )
  }
  let session: Session = createSession({
    scenes: loadedSceneSource,
    sprite: () => ({ width: 0, height: 0 }),
    random: () => 0,
    saves: createMemorySaveStore([]),
  })
  // 中途读档（load-slot0）：读档之前场景那一侧已经有一局 —— `applyReadBack` 从它身上带
  // `initiate(prev, …)` 本来就带的那几样。开机读档没有上一局，与状态层 `replayWorld` 同。
  if (warm !== null) session = enterScene(session, warm)
  return applyReadBack(session, f.readBack).scene.world
}

/* ===================== 事件驱动的装配（xl-e8w） ===================== */

/**
 * 工厂只用得到的那点真值形状：数步数、按下标取一步。步里装的是什么由各套自己读。
 * 场景那一套不走这里 —— 它逐 tick 推、要预取出口、要叠对话框那一层 DOM。
 */
interface StepTrace {
  readonly tickCount: number
  readonly ticks: readonly unknown[]
}

interface Frame {
  readonly timeMs: number
  readonly x: number
  readonly y: number
}

interface EventDrivenSpec<T extends StepTrace, R, S> {
  readonly kind: ImplementedDriver
  /** 报错时一步叫什么：战斗的一步是一拍（`run()` 循环体一遍），其余几块面板是一次输入事件。 */
  readonly unit: '步' | '拍'
  /** 建这一套的渲染器。**一个页面只建一次**，同一轮里的几条剧本共用。 */
  createRenderer(host: HTMLElement): Promise<R>
  /** 照剧本头起手。`scene` 是报给比对器的那一栏 —— 它只把它打进日志。 */
  setup(trace: T, renderer: R): Promise<{ readonly state: S; readonly scene: string }>
  /** 推第 `i` 步。 */
  step(state: S, tick: T['ticks'][number], i: number): void
  /** 把推到第 `t` 步的世界画出来（`--self-check` 的注入点在这里挪），报位置与时间。 */
  frame(state: S, t: number): Promise<Frame>
}

/**
 * 事件驱动的一套装配：宿主、渲染器、「一条剧本一份」的状态，以及 `seek` 前的三道守卫。
 *
 * 这几样从前每套各抄一份（战斗 / 菜单 / 商店 / 存读档 / 结局 / 标题页六份），近乎逐字
 * 同构，只差变量名前缀与报错里一步叫「步」还是「拍」。**一条剧本的状态整个放在
 * `loaded` 里、换剧本整个换掉**：从前是四五个模块级变量各自清零，漏清一个的样子是
 * 下一条剧本带着上一条的残留跑，而画面未必看得出来。
 */
function createEventDrivenAssembly<T extends StepTrace, R, S>(
  spec: EventDrivenSpec<T, R, S>,
): Assembly {
  let renderer: R | null = null
  let loaded: { readonly trace: T; readonly state: S } | null = null
  let next = 0
  return {
    async load(traceJson: string) {
      const trace = JSON.parse(traceJson) as T
      // 起手半路抛了的话，不许留着上一条剧本的状态让 seek 接着画。
      loaded = null
      renderer ??= await spec.createRenderer(hostFor(spec.kind))
      activate(spec.kind)
      const { state, scene } = await spec.setup(trace, renderer)
      loaded = { trace, state }
      next = 0
      return { scene, tickCount: trace.tickCount }
    },

    async seek(t: number) {
      if (!loaded) throw new Error('还没 load 就 seek')
      const { trace, state } = loaded
      const u = spec.unit
      if (t < next - 1) {
        throw new Error(`取图只能往前：当前在第 ${next - 1} ${u}，要去第 ${t} ${u}`)
      }
      if (t >= trace.ticks.length) {
        throw new Error(`第 ${t} ${u}超出了这份 trace 的 ${trace.ticks.length} ${u}`)
      }
      for (; next <= t; next++) spec.step(state, trace.ticks[next]!, next)
      const frame = await spec.frame(state, t)
      await twoFrames()
      return { t, ...frame }
    },
  }
}

/** 存读档 / 结局 / 标题页的一步恰好是一个输入事件，多一个少一个都是真值接不上。 */
function onlyInput<I>(input: readonly I[], i: number): I {
  if (input.length !== 1) throw new Error(`第 ${i} 步有 ${input.length} 个输入事件，一步应当恰好一个`)
  return input[0]!
}

/**
 * **故意改坏一处渲染**（`--self-check` 的注入点），菜单 / 商店 / 存读档 / 结局共用。
 *
 * 与战斗那一侧（`breakBattleOps`）同一个理由：**整帧一起挪，不挑层**。这几块面板
 * 每一帧的第一条绘制都是满屏 1024×640 的背景图（菜单的 `MENU_BACKGROUND`、商店的
 * `shopback.png`……），挑任何一层往上挪都可能被它盖住，而那不成立的样子正是
 * 「改坏了却没响」。
 */
function shiftOps<O extends { readonly x: number }>(ops: readonly O[], t: number): readonly O[] {
  const b = window.__xlBreak
  if (!b || t < b.fromTick) return ops
  return ops.map((op) => ({ ...op, x: op.x + b.heroDx }))
}

/**
 * 把这一帧要用的贴图载齐，名单没变就不再载。**每一帧都问一次**，不是只在 load 时问一次。
 *
 * 名单是从世界现推的：菜单翻页换背景、选中一瓶药多一颗「使用」按钮、奇术页放起动画要
 * 整条 37 帧；商店换一家店换整套招牌与店主动画、切一类装备换一整栏商品图。只在 `load()`
 * 里载一次的表现是「漏载」只在某几条剧本上炸（`menu-magic` 第 8 步之后、`shop-categories`
 * 一切类就抛，而停在同一页的剧本一点事都没有）。
 *
 * 一条剧本建一个：换剧本就从空名单起。
 */
function textureLoader(load: (ids: readonly AssetId[]) => Promise<void>): (ids: readonly AssetId[]) => Promise<void> {
  let loaded: string | null = null
  return async (ids) => {
    const key = JSON.stringify(ids)
    if (loaded === key) return
    await load(ids)
    loaded = key
  }
}

/* ===================== 存读档面板（xl-i06.12） ===================== */

interface SaveLoadReplayTrace {
  readonly driver: string
  readonly script: { readonly name: string; readonly setup: SaveLoadSetup }
  readonly tickCount: number
  readonly ticks: readonly { readonly t: number; readonly input: readonly SaveLoadInput[] }[]
  readonly fixture?: SaveFixture
}

/**
 * 逐帧比对里这个面板的动画停在**第 0 格**（鼠标、按钮光效、三个人）。
 *
 * 与商店那一条（`SHOP_FROZEN_FRAME`）同一个既成事实：`SaveLoadDriver` 把 Clock 的倍率
 * 设成 1e-9，那条 10 Hz 的 `while(true)` 线程整次导出一次都没醒过（驱动器头注）。
 * 帧号本来就不在状态层里（`saveload/world.ts` 头注），这条流水线守不住它们怎么循环。
 */
const LS_FROZEN_FRAMES = FIRST_FRAMES

const saveloadAssembly = createEventDrivenAssembly({
  kind: 'saveload',
  unit: '步',
  createRenderer: createSaveLoadRenderer,
  async setup(parsed: SaveLoadReplayTrace, renderer: SaveLoadRenderer) {
    const f = parsed.fixture
    if (f?.kind !== 'slots') {
      throw new Error(
        `${parsed.script.name} 是存读档真值，比对器却没送来草稿区那几份档` +
          `（收到 ${JSON.stringify(f?.kind ?? null)}）—— 见 compare/saveFixtures.ts`,
      )
    }
    const { setup } = parsed.script
    const scenes = new Map<string, SceneScript>()
    for (const file of [setup.warmup, setup.scene]) {
      if (file) scenes.set(stem(file), await take(stem(file)))
    }
    const getScene = (name: string): SceneScript => {
      const s = scenes.get(name)
      if (!s) throw new Error(`存读档起手要场景 ${name}，没取到手`)
      return s
    }
    // 起手与逐步推进与状态层判据是同一份（`saveload/replay.ts`）。
    const replay = startSaveLoadReplay(parsed.script.name, setup, f.slots, getScene, parsed.ticks[0]?.input[0])
    return {
      state: {
        renderer,
        replay,
        /**
         * 原版位图此刻停在的那一帧的绘制清单。**不是每一步都重画**：导出器只在当前面板
         * 还是存读档面板时才 `paint`（`SaveLoadDriver.stepUnguarded`），离开的那一步（退出
         * 键回菜单、读档切回场景）位图停在离开前最后一帧。这里照做 —— 离开那一步照状态
         * 重画的话，画的是一块原版此刻根本没在画的面板。
         */
        ops: null as SaveLoadDrawOp[] | null,
        /** 上一次真的载过贴图的那份清单（引用），省掉没变的重载。 */
        drawn: null as SaveLoadDrawOp[] | null,
      },
      scene: parsed.script.name,
    }
  },
  step(s, tick, i) {
    s.replay.step(onlyInput(tick.input, i))
    if (s.replay.current === 'ls') s.ops = saveLoadDrawList(s.replay.world, LS_FROZEN_FRAMES)
  },
  async frame(s, t) {
    const ops = s.ops
    if (ops === null) throw new Error(`到第 ${t} 步为止当前面板一次都不是存读档面板 —— 原版一帧都还没画`)
    if (ops !== s.drawn) {
      await s.renderer.load(ops.flatMap((op) => (op.kind === 'image' ? [op.id] : [])))
      s.drawn = ops
    }
    s.renderer.draw(shiftOps(ops, t))
    // 一步是一次输入事件，没有虚拟时间可言（`SaveLoadDriver` 不推时钟）。同菜单 / 商店。
    return { timeMs: 0, x: s.replay.world.currentX, y: s.replay.world.currentY }
  },
})

/* ===================== 结局（xl-czb.6） ===================== */

interface EndReplayTrace {
  readonly driver: string
  readonly script: { readonly name: string; readonly setup: EndSetup }
  readonly tickCount: number
  readonly ticks: readonly { readonly t: number; readonly input: readonly EndInput[] }[]
}

let endLoaded = false

const endAssembly = createEventDrivenAssembly({
  kind: 'end',
  unit: '步',
  createRenderer: createEndRenderer,
  async setup(parsed: EndReplayTrace, renderer: EndRenderer) {
    // 这个面板的素材一次载齐（二十几张），载过就不再载。标志不挪进 `createRenderer`：
    // 在那里载图一抛，渲染器没赋上值，下一条剧本会在同一个宿主里再建一张画布。
    if (!endLoaded) {
      await renderer.load(endTextureIds())
      endLoaded = true
    }
    // 起手那一块场景面板（`EndDriver.start()` 的 `initiation(setup.scene)`）。
    const want = stem(parsed.script.setup.scene)
    const scene = await take(want)
    // 起手与逐步推进与状态层判据是同一份（`end/replay.ts`）。
    const replay = startEndReplay(parsed.script.name, parsed.script.setup, (name) => {
      if (name !== want) throw new Error(`结局起手只取了场景 ${want}，又要 ${name}`)
      return scene
    })
    return {
      state: {
        renderer,
        replay,
        /**
         * 原版位图此刻停在的那一帧的绘制清单。导出器只在结局还在屏幕上时 `paint`
         * （`EndDriver.step`），被退出键切走的那一步位图停在切走之前最后一帧 —— 这里照做，
         * 同存读档那一条。
         */
        ops: null as EndDrawOp[] | null,
      },
      scene: parsed.script.name,
    }
  },
  step(s, tick, i) {
    s.replay.step(onlyInput(tick.input, i))
    if (s.replay.session.panel === 'end' && s.replay.world !== null) s.ops = endDrawList(s.replay.world)
  },
  async frame(s, t) {
    if (s.ops === null) throw new Error(`到第 ${t} 步为止结局一次都没显示过 —— 原版一帧都还没画`)
    s.renderer.draw(shiftOps(s.ops, t))
    // 一步不全是一拍（还有进来 / 按键 / 叫醒三种），报步号乘 100 ms 会假装它是时间。
    return { timeMs: 0, x: 0, y: 0 }
  },
})

/* ===================== 标题页（xl-whk） ===================== */

interface StartReplayTrace {
  readonly driver: string
  readonly script: { readonly name: string }
  readonly tickCount: number
  readonly ticks: readonly { readonly t: number; readonly input: readonly StartInput[] }[]
}

/**
 * 标题页是**真 DOM**（`start/StartPanel.tsx`），不是画布 —— 所以这一套的「渲染器」是一个
 * React root，把产品的 `StartPanelView` 直接渲染进自己的宿主。另写一个 Pixi 版的话，比出来
 * 的是那一份像不像原版，产品自己画错了照样绿。
 */
interface StartDom {
  readonly host: HTMLElement
  readonly root: Root
}

/**
 * 把这一帧画成 DOM，并**等每一张图解码完**。
 *
 * 画布那几套等两次 rAF 就够，因为纹理在 `load` 里就载齐了；DOM 的 `<img>` 换了 `src` 之后
 * 是异步取、异步解码的，只等 rAF 会截到上一张图或者一个空框 —— 而那看起来像「这一帧画错了」。
 * 解不出来（404、格式坏）就抛，不许截一张缺图的帧。
 *
 * `--self-check` 的注入点：整帧一起挪（外面包一层 `translateX`），理由同商店 / 菜单那几份。
 */
async function drawStart({ host, root }: StartDom, view: StartView, t: number): Promise<void> {
  const b = window.__xlBreak
  const dx = b && t >= b.fromTick ? b.heroDx : 0
  flushSync(() => {
    root.render(
      createElement(
        'div',
        { style: { position: 'absolute', inset: 0, transform: dx === 0 ? undefined : `translateX(${dx}px)` } },
        createElement(StartPanelView, { view }),
      ),
    )
  })
  await Promise.all(
    Array.from(host.querySelectorAll('img')).map((img) =>
      img.decode().catch(() => {
        throw new Error(`标题页素材解不出来：${img.src}`)
      }),
    ),
  )
}

const startAssembly = createEventDrivenAssembly({
  kind: 'start',
  unit: '步',
  async createRenderer(host): Promise<StartDom> {
    host.style.position = 'relative'
    host.style.overflow = 'hidden'
    return { host, root: createRoot(host) }
  },
  async setup(parsed: StartReplayTrace, dom: StartDom) {
    // 起手与逐步推进与状态层判据是同一份（`start/replay.ts`）。
    return { state: { dom, replay: startStartReplay(parsed.script.name) }, scene: parsed.script.name }
  },
  step(s, tick, i) {
    s.replay.step(onlyInput(tick.input, i))
  },
  async frame(s, t) {
    // 只有 tick 步画（原版三个监听器一句 repaint 都没有），输入步之后位图停在上一拍 ——
    // `replay.view` 已经是那一帧。
    const view = s.replay.view
    if (view === null) throw new Error(`到第 ${t} 步为止一拍都还没推 —— 原版一帧都还没画`)
    await drawStart(s.dom, view, t)
    // 一步不全是一拍（还有三种鼠标步），报步号乘 100 ms 会假装它是时间。
    return { timeMs: 0, x: s.replay.state.cursorX, y: s.replay.state.cursorY }
  },
})

/* ===================== 战斗（xl-rh9.9） ===================== */

/**
 * 怪物出场图（`Images.get(0)`）的像素尺寸 —— `EnemySlector` 量的就是它。
 *
 * **从真的图片里量，不从真值里读**：从真值里读框、再拿它去比框，是一条恒真
 * 的检查。这里走的是与状态层测试同一条路，只是那边读 PNG 的 IHDR，这边读
 * 浏览器解出来的纹理（烘出来的 WebP 是无损的，尺寸一致）。
 */
async function enemySpriteSizes(names: readonly string[]): Promise<Map<string, { width: number; height: number }>> {
  const out = new Map<string, { width: number; height: number }>()
  await Promise.all(
    names.map(async (name) => {
      const image = new Image()
      image.src = resolveAsset(enemyWalkId(name, 0))
      await image.decode()
      out.set(name, { width: image.naturalWidth, height: image.naturalHeight })
    }),
  )
  return out
}

/**
 * **故意改坏一处渲染**（`--self-check` 的注入点），战斗版。
 *
 * 与场景那一侧同一个意思：世界状态一个字节都不动，只把画出来的那一帧挪偏
 * `heroDx` 像素。**挪的是这一帧的每一条绘制指令**，不是某一层。
 *
 * 这个范围是**两次实测逼出来的**，每一次都表现为「改坏了却没响」：
 *
 * - 挪**主角**那一层（最初的写法，2026-09-07 xl-rh9.9）：`battle-defeat-start`
 *   与 `battle-defeat-slot2` 报「首个变化帧 无」。不是判据失灵 —— 打输的剧本
 *   里三个人都倒下了（`Hero.isDraw=false`，第 7 层整层不画，画的是第 8 层
 *   死亡动画），末帧还被全灭图整个盖住。挪一层没画出来的东西当然不会变。
 * - 改挪**第 1 层背景图**之后，`battle-menus` 又报（2026-09-07 xl-rh9.12）：
 *
 *       失败  battle-menus 19 帧 · 注入点 #225 · 首个变化帧 #250 · 变了 9/19 帧
 *
 *   同样不是判据失灵：注入点 #225 那一帧正在放技能，**第 2 层背景动画是满屏
 *   的**（`追星破月` 第 27 帧，1024×640），把挪偏的背景图整个盖掉了。
 *
 * 两次的形状是同一个：**"这一层一定看得见"这句话，每接一条新剧本就可能不成立
 * 一次**，而它不成立的样子正是"改坏了却没响"。所以不再挑层 —— 整帧一起挪，
 * 那就没有哪一层能盖住另一层了。自检要断言的两件事（注入点之前逐帧不变、
 * 第一个变化帧正好是注入点）照旧成立，而且不再依赖任何一条剧本的战况。
 *
 * 与 `shiftOps` 分开写，只因为战斗多一种 `rect` 指令，坐标在 `dest` 里。
 */
function breakBattleOps(ops: DrawOp[], t: number): DrawOp[] {
  const b = window.__xlBreak
  if (!b || t < b.fromTick) return ops
  return ops.map((op) =>
    op.kind === 'rect'
      ? { ...op, dest: { ...op.dest, x: op.dest.x + b.heroDx } }
      : { ...op, x: op.x + b.heroDx },
  )
}

const battleAssembly = createEventDrivenAssembly({
  kind: 'battle',
  unit: '拍',
  createRenderer: createBattleRenderer,
  async setup(parsed: BattleTrace, renderer: BattleRenderer) {
    // 先量怪物的图，才建得出世界（`EnemySlector` 的九个字段要它）。
    const names = parsed.script.enemies
      .filter((e): e is string => e !== null)
      .map((e) => e.slice(0, e.lastIndexOf('/')))
    const sizes = await enemySpriteSizes(names)
    const world = replayBattle(parsed, (name) => {
      const size = sizes.get(name)
      // 查不到就抛：静默给一个默认尺寸会让点击范围整个错位，而画面看着正常。
      if (!size) throw new Error(`没量到怪物「${name}」的出场图尺寸`)
      return size
    })
    // 取图页每份剧本一块新面板，缓冲当新建的（xl-pgq）；游戏侧传 'keep'。
    // 比对器验上屏 'keep' 那一支时才在载荷里带 `present`（xl-k9e），见 `compare/presentKeep.ts`。
    // 渲染器在页内跨剧本复用，所以那一轮单独开一个浏览器 —— 前面打过一场，缓冲就不是新的。
    const { present } = parsed as BattleTrace & { readonly present?: BufferMode }
    await renderer.load(battleTextureIds(world), present ?? 'fresh')
    // **这里不画**（xl-84z）：战斗渲染器画在一张不清屏的持久缓冲上，多画这一帧
    // 就等于原版多 paint 了一次 —— 原版第 0 帧的边缘 alpha 实测正好是「背景
    // 只合成过一次」的值。第一次画在 seek(0) 里。
    // `scene` 这一栏对战斗来说是"打的哪一场"，报背景图，方便对着日志看。
    return {
      state: { renderer, world, paint: createPaintState(world), tickMs: parsed.script.tickMs },
      scene: parsed.script.background,
    }
  },
  step(s, tick, i) {
    // **按钮贴图要在 stepBattle 之前推**：原版那三个鼠标监听器跑在循环体
    // 之前，读的是这一拍开头的 `command.isDraw`（见 render/paint.ts）。
    stepBattleWithPaint(s.world, s.paint, tick.input)
    // **每一拍都画**，不只画取样的那一拍（xl-84z）：原版一拍 paint 一次、
    // 缓冲从不清，取样那一帧的边上透着上一拍的残影。
    s.renderer.draw(breakBattleOps(battleDrawList(s.world, s.paint), i), i)
  },
  async frame(s, t) {
    // 战斗的虚拟时间就是拍号乘 tickMs（ADR-0003：固定步长，不跟画面刷新走）。
    return { timeMs: t * s.tickMs, x: s.world.currentX, y: s.world.currentY }
  },
})

/* ===================== 菜单（xl-6lo.14） ===================== */

const menuAssembly = createEventDrivenAssembly({
  kind: 'menu',
  unit: '步',
  createRenderer: createMenuRenderer,
  async setup(parsed: MenuTrace, renderer: MenuRenderer) {
    const world = replayMenuSetup(parsed.script.setup)
    // `task` 照剧本回显的 `setup.scene` 推（xl-03x.10）：给了它，`MenuDriver` 就先
    // `new Reader(scene)`，原版顶栏画的是那一本的 `Task` 段；没给就是「当前任务:无」。
    const task = replayMenuTask(parsed.script.setup)
    const loadFrame = textureLoader((ids) => renderer.load(ids))
    await loadFrame(menuTextureIds(world))
    renderer.draw(menuDrawList(world, task))
    return { state: { renderer, world, task, loadFrame }, scene: parsed.script.name }
  },
  step(s, tick) {
    stepMenu(s.world, tick.input)
  },
  async frame(s, t) {
    await s.loadFrame(menuTextureIds(s.world))
    s.renderer.draw(shiftOps(menuDrawList(s.world, s.task), t))
    // 菜单的一步是一次输入事件，没有虚拟时间可言（`MenuDriver` 不推时钟）。
    // `timeMs` 这一栏只进日志，报步号乘 `MENU_TICK_MS` 会假装它是时间。
    return { timeMs: 0, x: s.world.currentX, y: s.world.currentY }
  },
})

/* ===================== 商店（xl-knp.10） ===================== */

/**
 * 逐帧比对里商店动画停在**第 0 格**。
 *
 * 这不是一个选择，是原版侧的既成事实：`ShopDriver` 把 `Clock` 的倍率设成
 * 1e-9，于是那条 `while(true)` 线程的 `Clock.ms(120)` 变成约 3800 年，它在
 * 整次导出里**一次都没醒过**（`ShopDriver.java` 头注，xl-knp.9 实测）。原版
 * 位图里的鼠标图与四条人物动画因此全是第一格。
 *
 * 后果要说明白：**这条流水线守得住「谁站在哪、画的是哪一张」，守不住这八格
 * 怎么循环**。那一层由 `shop/render/animation.test.ts` 守（xl-knp.9）。喂一个
 * 别的帧号进来，两端立刻对不上 —— 而那会被读成一笔缺口账。
 */
const SHOP_FROZEN_FRAME = 0

const shopAssembly = createEventDrivenAssembly({
  kind: 'shop',
  unit: '步',
  createRenderer: createShopRenderer,
  async setup(parsed: ShopTrace, renderer: ShopRenderer) {
    // 只读剧本回显的 `setup`，一个状态字段都不从真值里读（`shop/replay.ts`）。
    const world = replayShopSetup(parsed.script.setup)
    /**
     * 逐步的输入，**在起手时一次算完**。换店那一步的输入要从剧本的 `open` 指令还原 ——
     * 真值里它是空数组（原版走场景的选择事件，面板收不到鼠标事件）。与 `shopTrace.test.ts`
     * 走的是同一个函数。
     *
     * 放在起手而不是每次 `seek` 现算，有两个理由，第二个才是主要的：算一次是 O(n) 而不是
     * O(n²)；而 `shopInputsOfTicks` 会**两个方向都核**（空输入的那一步必须真是 `open`、
     * 非空的必须不是），放在这里意味着这份真值接不上的话**在取第一帧之前**就抛，而不是
     * 走到某一步中途才炸。
     */
    const inputs: readonly ShopInput[][] = shopInputsOfTicks(parsed.script.steps, parsed.ticks)
    const loadFrame = textureLoader((ids) => renderer.load(ids))
    await loadFrame(shopTextureIds(world))
    renderer.draw(shopDrawList(world, SHOP_FROZEN_FRAME))
    return { state: { renderer, world, inputs, loadFrame }, scene: parsed.script.name }
  },
  step(s, _tick, i) {
    stepShop(s.world, s.inputs[i]!)
  },
  async frame(s, t) {
    await s.loadFrame(shopTextureIds(s.world))
    s.renderer.draw(shiftOps(shopDrawList(s.world, SHOP_FROZEN_FRAME), t))
    // 商店的一步是一次输入事件，没有虚拟时间可言（`ShopDriver` 不推时钟）。
    // 与菜单同一个规矩：`timeMs` 只进日志，报 0 而不是编一个步号乘常数。
    const p = activePanel(s.world)
    return { timeMs: 0, x: p.currentX, y: p.currentY }
  },
})

/**
 * 判别名 → 装配。**名单只有这一份**，`pickAssembly` 报"本页实现了哪些"时
 * 数的就是它 —— 另抄一张名单，加了驱动器却忘了改名单的那天，报出来的话是错的。
 *
 * 键的类型是 `ImplementedDriver`（`./implemented.ts` 那个数组的联合），于是
 * **少一个键或多一个键都是编译错**。比对器跑在 Node 上，装不进这个模块
 * （要 Pixi 与 DOM），它读的是那个数组；两边靠类型钉在一起，不靠人记得同时改。
 */
const ASSEMBLIES: Readonly<Record<ImplementedDriver, Assembly>> = {
  scene: sceneAssembly,
  battle: battleAssembly,
  menu: menuAssembly,
  shop: shopAssembly,
  saveload: saveloadAssembly,
  end: endAssembly,
  start: startAssembly,
}

/** 当前这份真值挑中的那一套。`load` 挑，`seek` 用。 */
let current: Assembly | null = null

/**
 * 取图页对外的那一个入口：**先按真值自报的驱动器挑装配，再交给它**。
 *
 * 挑不出来就抛 —— 页面里抛出的异常会被 `scripts/cdp.ts` 的 `evaluate` 原样
 * 转成 Node 侧的 Error，`scripts/compare.ts` 的 `main().catch` 再把它变成
 * 退出码 2。也就是说"这个驱动器 Web 侧还没实现"走的是**非零退出**那条路，
 * 而不是"这条剧本比出来零差异"那条。
 */
const api: ReplayApi = {
  async load(traceJson: string) {
    const header = JSON.parse(traceJson) as { driver?: unknown; script?: { name?: unknown } }
    const where = typeof header.script?.name === 'string' ? header.script.name : '这份真值'
    current = pickAssembly(header.driver, ASSEMBLIES, where)
    return current.load(traceJson)
  },
  async seek(t: number) {
    if (!current) throw new Error('还没 load 就 seek')
    return current.seek(t)
  },
}

/**
 * 把 DOM 那一层（今天只有对话框）画成这一帧的样子。
 *
 * `flushSync` 是必须的：React 18 起 `root.render` 是异步的，而截图只等两次
 * rAF。不同步刷新的话，对话框会**永远晚一帧**，而画面看起来完全正常 ——
 * 正是 `twoFrames` 那段注释说的那类错。
 */
function drawOverlay(world: World): void {
  if (!overlay) return
  const root = overlay
  flushSync(() => {
    root.render(createElement(DialogueBox, { dialogue: world.dialogue }))
  })
}

/**
 * **故意改坏一处渲染**：从第 `fromTick` 个 tick 起，把主角画到偏 `heroDx` 像素
 * 的地方。世界状态一个字节都不动 —— 坏的只有画出来的那一帧。
 *
 * 这是流水线自检（`--self-check`）用的注入点，不是调试开关：一条"改坏了也不响"
 * 的比对流水线，跟没有是一样的，而这件事只能靠真的改坏一次来证明。默认不注入，
 * 驱动器不设 `__xlBreak` 时下面这个函数是恒等的。
 */
function breakRender(world: World, t: number): World {
  const b = window.__xlBreak
  if (!b || t < b.fromTick) return world
  return { ...world, role: { ...world.role, px: world.role.px + b.heroDx } }
}

/**
 * 等两次 rAF 再让驱动器截图。
 *
 * 一次不够：Pixi 的自动渲染挂在共享 ticker 上，本次 rAF 里改的精灵要到下一次
 * rAF 才被画进绘制缓冲。少等一次的表现是**每一帧都晚一帧**，而画面看起来完全
 * 正常 —— 逐帧比对会整条剧本从头红到尾，谁也想不到是这里。
 */
function twoFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

declare global {
  interface Window {
    __xlReplay?: ReplayApi
    __xlReplayError?: string
    /**
     * 本页**真的**装配得出来的驱动器判别名，从 `ASSEMBLIES` 现数。
     *
     * 比对器进门核一次（`scripts/compare.ts` 的 `assertPageAgrees`）：它自己
     * 读的是 `replay/implemented.ts` 那个数组，而这里报的是运行时那张表。
     * 两者对不上就是名单分家了 —— 硬失败，别让它表现成"悄悄少比了一条剧本"。
     */
    __xlDrivers?: readonly string[]
    /** 故意改坏渲染的注入点，见 `breakRender`。驱动器只在自检时设它。 */
    __xlBreak?: { fromTick: number; heroDx: number }
  }
}

window.__xlReplay = api
window.__xlDrivers = Object.keys(ASSEMBLIES).sort()
// 页面里任何没接住的异常都要变成一个驱动器读得到的字符串。否则失败的样子是
// "驱动器等 __xlReplay 等到超时"，而真正的原因（比如某个资源 404）在控制台里，
// 无头浏览器的控制台没人看得见。
window.addEventListener('error', (e) => {
  window.__xlReplayError = String(e.error ?? e.message)
})
window.addEventListener('unhandledrejection', (e) => {
  window.__xlReplayError = String(e.reason)
})
