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
import { battleDrawList } from '../battle/render/drawList'
import type { DrawOp } from '../battle/render/drawList'
import { createPaintState } from '../battle/render/paint'
import type { PaintState } from '../battle/render/paint'
import { replayBattle } from '../battle/replay'
import { stepBattleWithPaint } from '../battle/loop'
import type { BattleTrace } from '../battle/trace'
import type { BattleWorld } from '../battle/types'
import { menuTextureIds } from '../menu/render/assets'
import { menuDrawList } from '../menu/render/drawList'
import type { MenuDrawOp } from '../menu/render/drawList'
import { createMenuRenderer } from '../menu/render/menuRenderer'
import type { MenuRenderer } from '../menu/render/menuRenderer'
import { replayMenuSetup } from '../menu/replay'
import { stepMenu } from '../menu/step'
// **类型从 `menu/trace.ts` 取，不在这里手抄一份。** 那个模块转手 `node:fs`，
// 但 `import type` 会被 TypeScript 整个擦掉、一行运行时代码都不产生（战斗那
// 一侧的 `BattleTrace` 走的是同一条路）。手抄一份子集的话，真值加一列时这里
// 不会响 —— 那正是"名单抄两份迟早分家"的类型版。
import type { MenuTrace } from '../menu/trace'
import type { MenuWorld } from '../menu/types'
import { shopTextureIds } from '../shop/render/assets'
import { shopDrawList } from '../shop/render/drawList'
import type { ShopDrawOp } from '../shop/render/drawList'
import { createShopRenderer } from '../shop/render/shopRenderer'
import type { ShopRenderer } from '../shop/render/shopRenderer'
import { replayShopSetup, shopInputsOfTicks } from '../shop/replay'
import { stepShop } from '../shop/step'
import type { ShopInput } from '../shop/step'
// 同菜单那一条的理由：类型从 `shop/trace.ts` 取，不在这里手抄一份子集。
// 那个模块转手 `node:fs`，而 `import type` 会被整个擦掉。
import type { ShopTrace } from '../shop/trace'
import type { ShopWorld } from '../shop/types'
import { activePanel } from '../shop/world'
import { resolveAsset } from '../assets/resolve'
import { pickAssembly } from './drivers'
import type { ImplementedDriver } from './implemented'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { initiate, step } from '../state/step'
import type { InputEvent, World } from '../state/types'
// 同菜单那一条的理由：类型从 `compare/saveFixtures.ts` 取。那个模块转手 `node:fs`
// （它在比对器那一半解原版存档），而 `import type` 会被整个擦掉。
import type { SaveFixture } from '../compare/saveFixtures'
import type { SceneScript } from '../data/types'
import { resetDrugPack } from '../fakes/drugPack'
import { resetParty } from '../fakes/party'
import { resetWallet } from '../fakes/wallet'
import { applyReadBack, createSession, enterScene } from '../game/session'
import type { Session } from '../game/session'
import { createMemorySaveStore } from '../save/memoryStore'
import { saveLoadDrawList, FIRST_FRAMES } from '../saveload/render/drawList'
import type { SaveLoadDrawOp } from '../saveload/render/drawList'
import { createSaveLoadRenderer } from '../saveload/render/saveLoadRenderer'
import type { SaveLoadRenderer } from '../saveload/render/saveLoadRenderer'
import { startSaveLoadReplay } from '../saveload/replay'
import type { SaveLoadReplay, SaveLoadSetup } from '../saveload/replay'
import type { SaveLoadInput } from '../saveload/step'

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
  seek(t: number): Promise<{ t: number; timeMs: number; x: number; y: number }>
}

let renderer: SceneRenderer | null = null
let overlay: Root | null = null
let trace: ReplayTrace | null = null
let world: World | null = null
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
      world = step(world, tick.input, trace.script.tickMs, loadedSceneSource)
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
    return { t, timeMs: world.timeMs, x: world.role.px >> 5, y: world.role.py >> 5 }
  },
}

/**
 * 读档剧本的起手（xl-i06.12）：原版不 `initiation(scene)`，而是 `Loader.load(N)` 读档
 * 再 `switchTo("scene")`。照剧本头那套 `warmup → scene` 建出来的是**另一个世界**。
 *
 * 走的是产品读档那一路的 `applyReadBack`（`game/session.ts`）—— 不只重建场景，还把
 * 钱、药、三个人落到各自的模块单例上：金币 HUD 画的是 `getCoins()`，只建场景世界的话
 * 那一格会画出厂的钱，与原版画的存档里的钱是两个数（M5 收口时 `WALLET_NOT_REPLAYED`
 * 就是那个形状）。它与状态层判据用的 `replayWorld` 是同一个世界，由
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

/* ===================== 存读档面板（xl-i06.12） ===================== */

interface SaveLoadReplayTrace {
  readonly driver: string
  readonly script: { readonly name: string; readonly setup: SaveLoadSetup }
  readonly tickCount: number
  readonly ticks: readonly { readonly t: number; readonly input: readonly SaveLoadInput[] }[]
  readonly fixture?: SaveFixture
}

let lsRenderer: SaveLoadRenderer | null = null
let lsTrace: SaveLoadReplayTrace | null = null
let lsReplay: SaveLoadReplay | null = null
let lsNext = 0
/**
 * 原版位图此刻停在的那一帧的绘制清单。**不是每一步都重画**：导出器只在当前面板还是
 * 存读档面板时才 `paint`（`SaveLoadDriver.stepUnguarded`），离开的那一步（退出键回
 * 菜单、读档切回场景）位图停在离开前最后一帧。这里照做 —— 离开那一步照状态重画的话，
 * 画的是一块原版此刻根本没在画的面板。
 */
let lsOps: SaveLoadDrawOp[] | null = null
/** 上一次真的画出去的那份清单（引用），省掉没变的重画。 */
let lsDrawn: SaveLoadDrawOp[] | null = null

/**
 * 逐帧比对里这个面板的动画停在**第 0 格**（鼠标、按钮光效、三个人）。
 *
 * 与商店那一条（`SHOP_FROZEN_FRAME`）同一个既成事实：`SaveLoadDriver` 把 Clock 的倍率
 * 设成 1e-9，那条 10 Hz 的 `while(true)` 线程整次导出一次都没醒过（驱动器头注）。
 * 帧号本来就不在状态层里（`saveload/world.ts` 头注），这条流水线守不住它们怎么循环。
 */
const LS_FROZEN_FRAMES = FIRST_FRAMES

/** **故意改坏一处渲染**（`--self-check` 的注入点），存读档版。整帧一起挪，理由同商店。 */
function breakSaveLoadOps(ops: SaveLoadDrawOp[], t: number): SaveLoadDrawOp[] {
  const b = window.__xlBreak
  if (!b || t < b.fromTick) return ops
  return ops.map((op) => ({ ...op, x: op.x + b.heroDx }))
}

const saveloadAssembly: Assembly = {
  async load(traceJson: string) {
    const parsed = JSON.parse(traceJson) as SaveLoadReplayTrace
    const f = parsed.fixture
    if (f?.kind !== 'slots') {
      throw new Error(
        `${parsed.script.name} 是存读档真值，比对器却没送来草稿区那几份档` +
          `（收到 ${JSON.stringify(f?.kind ?? null)}）—— 见 compare/saveFixtures.ts`,
      )
    }
    lsRenderer ??= await createSaveLoadRenderer(hostFor('saveload'))
    activate('saveload')
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
    lsReplay = startSaveLoadReplay(parsed.script.name, setup, f.slots, getScene, parsed.ticks[0]?.input[0])
    lsTrace = parsed
    lsNext = 0
    lsOps = null
    lsDrawn = null
    // `scene` 这一栏对这个面板来说没有场景可报，报剧本名 —— 比对器只把它打进日志。
    return { scene: parsed.script.name, tickCount: parsed.tickCount }
  },

  async seek(t: number) {
    const trace = lsTrace
    const replay = lsReplay
    const renderer = lsRenderer
    if (!trace || !replay || !renderer) throw new Error('还没 load 就 seek')
    if (t < lsNext - 1) {
      throw new Error(`取图只能往前：当前在第 ${lsNext - 1} 步，要去第 ${t} 步`)
    }
    if (t >= trace.ticks.length) {
      throw new Error(`第 ${t} 步超出了这份 trace 的 ${trace.ticks.length} 步`)
    }
    for (; lsNext <= t; lsNext++) {
      const input = trace.ticks[lsNext]!.input
      if (input.length !== 1) throw new Error(`第 ${lsNext} 步有 ${input.length} 个输入事件，一步应当恰好一个`)
      replay.step(input[0]!)
      if (replay.current === 'ls') lsOps = saveLoadDrawList(replay.world, LS_FROZEN_FRAMES)
    }
    if (lsOps === null) throw new Error(`到第 ${t} 步为止当前面板一次都不是存读档面板 —— 原版一帧都还没画`)
    if (lsOps !== lsDrawn) {
      await renderer.load(lsOps.flatMap((op) => (op.kind === 'image' ? [op.id] : [])))
      lsDrawn = lsOps
    }
    renderer.draw(breakSaveLoadOps(lsOps, t))
    await twoFrames()
    // 一步是一次输入事件，没有虚拟时间可言（`SaveLoadDriver` 不推时钟）。同菜单 / 商店。
    return { t, timeMs: 0, x: replay.world.currentX, y: replay.world.currentY }
  },
}

/* ===================== 战斗（xl-rh9.9） ===================== */

let battleRenderer: BattleRenderer | null = null
let battleTrace: BattleTrace | null = null
let battleWorld: BattleWorld | null = null
let battlePaint: PaintState | null = null
let battleNext = 0

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

const battleAssembly: Assembly = {
  async load(traceJson: string) {
    const parsed = JSON.parse(traceJson) as BattleTrace
    battleRenderer ??= await createBattleRenderer(hostFor('battle'))
    activate('battle')

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

    await battleRenderer.load(battleTextureIds(world))
    battleWorld = world
    battlePaint = createPaintState(world)
    battleTrace = parsed
    battleNext = 0
    battleRenderer.draw(battleDrawList(world, battlePaint))
    // `scene` 这一栏对战斗来说是"打的哪一场"，报背景图，方便对着日志看。
    return { scene: parsed.script.background, tickCount: parsed.tickCount }
  },

  async seek(t: number) {
    const trace = battleTrace
    const world = battleWorld
    const paint = battlePaint
    const renderer = battleRenderer
    if (!trace || !world || !paint || !renderer) throw new Error('还没 load 就 seek')
    if (t < battleNext - 1) {
      throw new Error(`取图只能往前：当前在第 ${battleNext - 1} 拍，要去第 ${t} 拍`)
    }
    if (t >= trace.ticks.length) {
      throw new Error(`第 ${t} 拍超出了这份 trace 的 ${trace.ticks.length} 拍`)
    }
    for (; battleNext <= t; battleNext++) {
      const tick = trace.ticks[battleNext]!
      // **按钮贴图要在 stepBattle 之前推**：原版那三个鼠标监听器跑在循环体
      // 之前，读的是这一拍开头的 `command.isDraw`（见 render/paint.ts）。
      stepBattleWithPaint(world, paint, tick.input)
    }
    renderer.draw(breakBattleOps(battleDrawList(world, paint), t))
    await twoFrames()
    // 战斗的虚拟时间就是拍号乘 tickMs（ADR-0003：固定步长，不跟画面刷新走）。
    return { t, timeMs: t * trace.script.tickMs, x: world.currentX, y: world.currentY }
  },
}

/* ===================== 菜单（xl-6lo.14） ===================== */

let menuRenderer: MenuRenderer | null = null
let menuTrace: MenuTrace | null = null
let menuWorld: MenuWorld | null = null
let menuNext = 0
/** 上一次真的载过的那份贴图名单（`menuTextureIds` 的 join）。 */
let menuLoaded: string | null = null

/**
 * **故意改坏一处渲染**（`--self-check` 的注入点），菜单版。
 *
 * 与战斗那一侧逐字同构，理由也一样：**整帧一起挪，不挑层**。菜单更需要这一条
 * —— 它每一页的第一条绘制都是**满屏 1024×640 的背景图**（`MENU_BACKGROUND`），
 * 挑任何一层往上挪，都可能被下一页的背景整个盖住，而那不成立的样子正是
 * 「改坏了却没响」。
 */
function breakMenuOps(ops: MenuDrawOp[], t: number): MenuDrawOp[] {
  const b = window.__xlBreak
  if (!b || t < b.fromTick) return ops
  return ops.map((op) => ({ ...op, x: op.x + b.heroDx }))
}

/**
 * 把这一帧要用的贴图载齐。**每一帧都问一次**，不是只在 load 时问一次。
 *
 * `menuTextureIds` 是从世界现推的：翻页换背景、选中一瓶药多一颗「使用」按钮、
 * 奇术页放起动画要整条 37 帧。只在 `load()` 时载一次的话，`menu-magic` 第 8 步
 * 之后那段动画会让 `textureOf` 当场抛 —— 而 `menu-equip` 那种从头到尾停在
 * 第一页的剧本一点事都没有，于是"漏载"会表现成只有某几条剧本坏掉。
 */
async function loadMenuFrame(world: MenuWorld): Promise<void> {
  const ids = menuTextureIds(world)
  const key = ids.join('\u0000')
  if (menuLoaded === key) return
  await menuRenderer!.load(ids)
  menuLoaded = key
}

const menuAssembly: Assembly = {
  async load(traceJson: string) {
    const parsed = JSON.parse(traceJson) as MenuTrace
    menuRenderer ??= await createMenuRenderer(hostFor('menu'))
    activate('menu')
    const world = replayMenuSetup(parsed.script.setup)
    menuWorld = world
    menuTrace = parsed
    menuNext = 0
    menuLoaded = null
    await loadMenuFrame(world)
    menuRenderer.draw(menuDrawList(world))
    // `scene` 这一栏对菜单来说没有场景可报，报剧本名 —— 比对器只把它打进日志。
    return { scene: parsed.script.name, tickCount: parsed.tickCount }
  },

  async seek(t: number) {
    const trace = menuTrace
    const world = menuWorld
    const renderer = menuRenderer
    if (!trace || !world || !renderer) throw new Error('还没 load 就 seek')
    if (t < menuNext - 1) {
      throw new Error(`取图只能往前：当前在第 ${menuNext - 1} 步，要去第 ${t} 步`)
    }
    if (t >= trace.ticks.length) {
      throw new Error(`第 ${t} 步超出了这份 trace 的 ${trace.ticks.length} 步`)
    }
    for (; menuNext <= t; menuNext++) {
      stepMenu(world, trace.ticks[menuNext]!.input)
    }
    await loadMenuFrame(world)
    // `task` 不喂：`MenuDriver` 从来不给 `tools.Reader.task` 赋值，原版画的
    // 就是「当前任务:无」。喂一个别的值进来，顶栏那行字两端立刻对不上。
    renderer.draw(breakMenuOps(menuDrawList(world), t))
    await twoFrames()
    // 菜单的一步是一次输入事件，没有虚拟时间可言（`MenuDriver` 不推时钟）。
    // `timeMs` 这一栏只进日志，报步号乘 `MENU_TICK_MS` 会假装它是时间。
    return { t, timeMs: 0, x: world.currentX, y: world.currentY }
  },
}

/* ===================== 商店（xl-knp.10） ===================== */

let shopRenderer: ShopRenderer | null = null
let shopTrace: ShopTrace | null = null
let shopWorld: ShopWorld | null = null
let shopNext = 0
/** 上一次真的载过的那份贴图名单（`shopTextureIds` 的 `JSON.stringify`）。 */
let shopLoaded: string | null = null
/**
 * 逐步的输入，**在 `load` 里一次算完**。
 *
 * 放在 `load` 而不是每次 `seek` 现算，有两个理由，第二个才是主要的：算一次
 * 是 O(n) 而不是 O(n²)；而 `shopInputsOfTicks` 会**两个方向都核**（空输入的
 * 那一步必须真是 `open`、非空的必须不是），放在 `load` 里意味着这份真值接不
 * 上的话**在取第一帧之前**就抛，而不是走到某一步中途才炸。
 */
let shopInputs: readonly ShopInput[][] = []

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

/**
 * **故意改坏一处渲染**（`--self-check` 的注入点），商店版。
 *
 * 与战斗 / 菜单两侧逐字同构，理由也一样：**整帧一起挪，不挑层**。商店每一帧
 * 的第一条绘制就是满屏 1024×640 的 `shopback.png`，挑任何一层往上挪都可能被
 * 它盖住，而那不成立的样子正是「改坏了却没响」。
 */
function breakShopOps(ops: ShopDrawOp[], t: number): ShopDrawOp[] {
  const b = window.__xlBreak
  if (!b || t < b.fromTick) return ops
  return ops.map((op) => ({ ...op, x: op.x + b.heroDx }))
}

/**
 * 把这一帧要用的贴图载齐。**每一步都问一次**，不是只在 load 时问一次 —— 换一
 * 家店换整套招牌与店主动画，切一类装备换一整栏商品图。只在 `load()` 里载一次
 * 的表现是「漏载」只在某几条剧本上炸（`shop-categories` 一切类就抛，而
 * `shop-trade` 那种停在同一栏的剧本一点事都没有）。
 */
async function loadShopFrame(world: ShopWorld): Promise<void> {
  const ids = shopTextureIds(world)
  const key = JSON.stringify(ids)
  if (shopLoaded === key) return
  await shopRenderer!.load(ids)
  shopLoaded = key
}

const shopAssembly: Assembly = {
  async load(traceJson: string) {
    const parsed = JSON.parse(traceJson) as ShopTrace
    shopRenderer ??= await createShopRenderer(hostFor('shop'))
    activate('shop')
    // 只读剧本回显的 `setup`，一个状态字段都不从真值里读（`shop/replay.ts`）。
    const world = replayShopSetup(parsed.script.setup)
    shopWorld = world
    shopTrace = parsed
    shopNext = 0
    shopLoaded = null
    // 换店那一步的输入要从剧本的 `open` 指令还原 —— 真值里它是空数组（原版走
    // 场景的选择事件，面板收不到鼠标事件）。与 `shopTrace.test.ts` 走的是同一
    // 个函数。
    shopInputs = shopInputsOfTicks(parsed.script.steps, parsed.ticks)
    await loadShopFrame(world)
    shopRenderer.draw(shopDrawList(world, SHOP_FROZEN_FRAME))
    // `scene` 这一栏对商店来说没有场景可报，报剧本名 —— 比对器只把它打进日志。
    return { scene: parsed.script.name, tickCount: parsed.tickCount }
  },

  async seek(t: number) {
    const trace = shopTrace
    const world = shopWorld
    const renderer = shopRenderer
    if (!trace || !world || !renderer) throw new Error('还没 load 就 seek')
    if (t < shopNext - 1) {
      throw new Error(`取图只能往前：当前在第 ${shopNext - 1} 步，要去第 ${t} 步`)
    }
    if (t >= trace.ticks.length) {
      throw new Error(`第 ${t} 步超出了这份 trace 的 ${trace.ticks.length} 步`)
    }
    for (; shopNext <= t; shopNext++) {
      stepShop(world, shopInputs[shopNext]!)
    }
    await loadShopFrame(world)
    renderer.draw(breakShopOps(shopDrawList(world, SHOP_FROZEN_FRAME), t))
    await twoFrames()
    // 商店的一步是一次输入事件，没有虚拟时间可言（`ShopDriver` 不推时钟）。
    // 与菜单同一个规矩：`timeMs` 只进日志，报 0 而不是编一个步号乘常数。
    const p = activePanel(world)
    return { t, timeMs: 0, x: p.currentX, y: p.currentY }
  },
}

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
