import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareExits } from '../data/loadedScenes'
import { loadScene } from '../data/scenes'
import { readTrace } from '../state/trace'
import { getScene } from '../data/scenesEager'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { roleTileX } from '../state/role'
import { createWorld } from '../state/step'
import type { RoleState, World } from '../state/types'
import { useGame } from './useGame'

/**
 * 接线的测试：键盘 → 定步长推进 → 渲染器。**渲染器是个假的**——这里要验的是
 * 线接对了没有，不是 Pixi 画得对不对（那一层没有测试缝，是 spec 的明确决策）。
 *
 * 值得单独测的理由：状态层再纯，只要按键没送进去、或者推进没跑起来，
 * 表现都是"按方向键没反应"，而两层各自的测试都还是绿的。
 */
describe('useGame 接线', () => {
  let seen: RoleState[] = []
  const renderer = {
    showScene: async () => {},
    showWorld: (world: World) => {
      seen.push(world.role)
    },
    destroy: () => {},
  } satisfies SceneRenderer

  beforeEach(() => {
    seen = []
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * 挂上钩子，并等场景 JSON 到位——它是按需取的（见 `data/scenes.ts`），
   * 世界要等它回来才建得出来。不等就推时间，推的是一个还没有世界的 ticker：
   * 表现是"渲染器一帧都没收到"，看上去像接线断了。
   */
  async function mount(scene = '宿舍') {
    // 出口的目标也要先取到手：世界要等它们到齐才开始推进
    // （见 `data/loadedScenes.ts`）。这里先取一遍，钩子里那一遍就是缓存命中，
    // 一个微任务就过去了 —— 不然假定时器下要等一次真的 I/O，谁也说不准几拍。
    await prepareExits(createWorld(await loadScene(scene)))
    const rendered = renderHook(() => useGame(renderer, scene))
    await act(async () => {
      await loadScene(scene)
    })
    return rendered
  }

  /** trace 里的按键事件 → 页面上的 KeyboardEvent。`toInputEvent` 那张表的反向。 */
  function dispatch(input: { e: string; k: string; ctrl?: boolean }) {
    const key =
      input.k === 'space'
        ? ' '
        : `Arrow${input.k.charAt(0).toUpperCase()}${input.k.slice(1)}`
    window.dispatchEvent(
      new KeyboardEvent(input.e === 'press' ? 'keydown' : 'keyup', {
        key,
        ctrlKey: input.ctrl === true,
      }),
    )
  }

  function press(key: string, init: KeyboardEventInit = {}) {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }))
    })
  }

  it('按下右方向键，主角往右走；渲染器每次拿到的都是新的世界状态', async () => {
    await mount()
    press('ArrowRight')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    const last = seen.at(-1)
    expect(last).toBeDefined()
    expect(last!.dir).toBe('right')
    expect(roleTileX(last!)).toBeGreaterThan(12)
  })

  it('按住 Shift 是跑（macOS 上 Ctrl+方向键被系统吃掉，见 keyboard.ts）', async () => {
    await mount()
    press('ArrowRight', { shiftKey: true })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(seen.at(-1)!.running).toBe(true)
  })

  it('没有按键就不动', async () => {
    await mount()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(seen.at(-1)!.px).toBe(12 * 32)
  })

  /**
   * 对话状态要真的走到 React 手里 —— 对话框是真 DOM，接不上的表现是"游戏在
   * 动、对话框永远不出现"，而状态层与组件各自的测试都还是绿的。
   *
   * 用 `脚本4`：它的 `Dialogue` 段触发码是 `-1`，也就是**进场自动播**
   * （`DialogueEvent.checkAutoDialogue`），不用先把主角走到谁跟前。
   */
  it('自动对话会走到 React 手里，空格能把它推下去', async () => {
    const scene = getScene('脚本4')
    const sentences = scene.dialogue![0]!
    const { result } = await mount('脚本4')

    // 弹出动画 + 逐字打印。多给一点时间，判据是"这一句打完了"而不是某个 tick 数。
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.dialogue?.speaking).toBe(true)
    expect(result.current.dialogue?.sentence).toBe(sentences[0]![2])
    expect(result.current.dialogue?.sentenceOver).toBe(true)

    // 空格推进到下一句。键名与 trace 里逐字一致（见 keyboard.ts）。
    press(' ')
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.dialogue?.sentence).toBe(sentences[1]![2])
  })

  /**
   * 出口切换的接线（xl-9bd.12）：**世界换了场景，调用方要能知道**。
   *
   * 画面是跟着 `useGame` 报出来的这个场景走的（见 `app/App.tsx`），接不上的
   * 表现是"走出门之后人在新场景里跑，画面还是旧地图"——而状态层与渲染器
   * 各自的测试都还是绿的。
   *
   * 按键不是手编的：照着真值 `dorm-exit` 里那一 tick 实际喂给原版的事件回放
   * （`docs/trace-format.md`）。一 tick 一次 `setInterval`，10 ms 一拍，与
   * `advance` 的步长严丝合缝。换场景发生在第几 tick 也来自真值，不写死。
   */
  it('走到出口，报出来的场景跟着真值换掉', async () => {
    const trace = readTrace('dorm-exit')
    const switchAt = trace.ticks.findIndex((tick) => tick.scene !== trace.ticks[0]!.scene)
    expect(switchAt).toBeGreaterThan(0)

    const { result } = await mount(trace.script.scene.replace(/\.txt$/, ''))
    expect(result.current.scene).toBe('宿舍')

    for (const tick of trace.ticks.slice(0, switchAt + 1)) {
      act(() => {
        for (const input of tick.input) dispatch(input)
        vi.advanceTimersByTime(10)
      })
    }
    expect(result.current.scene).toBe(trace.ticks[switchAt]!.scene.replace(/\.txt$/, ''))
  })

  it('卸载之后不再推进，也不再收键', async () => {
    const { unmount } = await mount()
    unmount()
    press('ArrowRight')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(seen).toHaveLength(0)
  })
})
