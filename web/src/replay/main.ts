import { getScene } from '../data/scenes'
import { createSceneRenderer } from '../scene/sceneRenderer'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { createWorld, npcTilesOf, step } from '../state/step'
import type { InputEvent, TilePos, World } from '../state/types'

/**
 * 取图页：**只在跨端逐帧比对里用**，不进游戏产物（`vite build` 只打
 * `index.html`，这个页面只有 dev server 上有）。
 *
 * 它做的事跟 `src/state/traceReplay.test.ts` 是同一件：照着真值里那一 tick
 * 实际喂给原版的按键回放。区别只在于回放完还要**真的画一帧**，让驱动器截图。
 *
 * 为什么回放的是按键而不是坐标：坐标是结论，按键是输入。喂坐标等于把两端
 * 的分歧提前抹平，比出来的图会一直一致，而游戏是错的。
 */

interface ReplayTick {
  readonly t: number
  readonly input: readonly InputEvent[]
  readonly npcs: readonly TilePos[]
}

interface ReplayTrace {
  readonly script: { readonly name: string; readonly scene: string; readonly tickMs: number }
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
let trace: ReplayTrace | null = null
let world: World | null = null
let npcs: readonly TilePos[] = []
let next = 0

const api: ReplayApi = {
  async load(traceJson: string) {
    const parsed = JSON.parse(traceJson) as ReplayTrace
    const sceneName = parsed.script.scene.replace(/\.txt$/, '')
    const scene = getScene(sceneName)
    if (!renderer) {
      const host = document.getElementById('host')
      if (!host) throw new Error('取图页没有 #host')
      renderer = await createSceneRenderer(host)
    }
    await renderer.showScene(scene)
    trace = parsed
    world = createWorld(scene)
    npcs = npcTilesOf(scene)
    next = 0
    renderer.showWorld(world)
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
      world = step({ ...world, npcs }, tick.input, trace.script.tickMs)
      // NPC 取**上一 tick** 的快照：导出器按根对象顺序装定时器，role 排在
      // npcs 前面，所以主角判碰撞时看到的是 NPC 上一 tick 末的位置。
      npcs = tick.npcs.map((n) => ({ x: n.x, y: n.y }))
    }
    renderer.showWorld(breakRender(world, t))
    await twoFrames()
    return { t, timeMs: world.timeMs, x: world.role.px >> 5, y: world.role.py >> 5 }
  },
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
