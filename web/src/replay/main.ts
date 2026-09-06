import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { exitsReady, loadedSceneSource, prepareExits, rememberScene } from '../data/loadedScenes'
import { loadScene } from '../data/scenes'
import { DialogueBox } from '../ui/DialogueBox'
import '../index.css'
import { createSceneRenderer } from '../scene/sceneRenderer'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { initiate, step } from '../state/step'
import type { InputEvent, World } from '../state/types'

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
  readonly script: {
    readonly name: string
    /** 预热脚本，可为 null。**回放必须照做**，理由见 `state/trace.ts` 的 `replayWorld`。 */
    readonly warmup: string | null
    readonly scene: string
    readonly tickMs: number
    /** `ScenePanel.isScript`：false 时旁白与主线对话的轮询整个跳过。 */
    readonly isScript: boolean
  }
  readonly tickCount: number
  readonly ticks: readonly ReplayTick[]
}

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

/** 取一个场景，并放进同步查得到的那张表里（出口切换要同步取，见 data/loadedScenes.ts）。 */
async function take(name: string) {
  const scene = await loadScene(name)
  rememberScene(name, scene)
  return scene
}

const stem = (file: string) => file.replace(/\.txt$/, '')

const api: ReplayApi = {
  async load(traceJson: string) {
    const parsed = JSON.parse(traceJson) as ReplayTrace
    const sceneName = stem(parsed.script.scene)
    const scene = await take(sceneName)
    if (!renderer) {
      const host = document.getElementById('host')
      if (!host) throw new Error('取图页没有 #host')
      renderer = await createSceneRenderer(host)
    }
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
    world = { ...initiate(warm, scene), isScript: parsed.script.isScript }
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
    /** 故意改坏渲染的注入点，见 `breakRender`。驱动器只在自检时设它。 */
    __xlBreak?: { fromTick: number; heroDx: number }
  }
}

window.__xlReplay = api
// 页面里任何没接住的异常都要变成一个驱动器读得到的字符串。否则失败的样子是
// "驱动器等 __xlReplay 等到超时"，而真正的原因（比如某个资源 404）在控制台里，
// 无头浏览器的控制台没人看得见。
window.addEventListener('error', (e) => {
  window.__xlReplayError = String(e.error ?? e.message)
})
window.addEventListener('unhandledrejection', (e) => {
  window.__xlReplayError = String(e.reason)
})
