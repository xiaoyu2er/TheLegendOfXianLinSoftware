import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadScene } from '../data/scenes'
import { getScene } from '../data/scenesEager'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { roleTileX } from '../state/role'
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
    const rendered = renderHook(() => useGame(renderer, scene))
    await act(async () => {
      await loadScene(scene)
    })
    return rendered
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
    expect(result.current?.speaking).toBe(true)
    expect(result.current?.sentence).toBe(sentences[0]![2])
    expect(result.current?.sentenceOver).toBe(true)

    // 空格推进到下一句。键名与 trace 里逐字一致（见 keyboard.ts）。
    press(' ')
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current?.sentence).toBe(sentences[1]![2])
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
