import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { roleTileX } from '../state/role'
import type { RoleState } from '../state/types'
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
    showRole: (role: RoleState) => {
      seen.push(role)
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

  function press(key: string, init: KeyboardEventInit = {}) {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }))
    })
  }

  it('按下右方向键，主角往右走；渲染器每次拿到的都是新的世界状态', () => {
    renderHook(() => useGame(renderer, '宿舍'))
    press('ArrowRight')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    const last = seen.at(-1)
    expect(last).toBeDefined()
    expect(last!.dir).toBe('right')
    expect(roleTileX(last!)).toBeGreaterThan(12)
  })

  it('按住 Shift 是跑（macOS 上 Ctrl+方向键被系统吃掉，见 keyboard.ts）', () => {
    renderHook(() => useGame(renderer, '宿舍'))
    press('ArrowRight', { shiftKey: true })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(seen.at(-1)!.running).toBe(true)
  })

  it('没有按键就不动', () => {
    renderHook(() => useGame(renderer, '宿舍'))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(seen.at(-1)!.px).toBe(12 * 32)
  })

  it('卸载之后不再推进，也不再收键', () => {
    const { unmount } = renderHook(() => useGame(renderer, '宿舍'))
    unmount()
    press('ArrowRight')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(seen).toHaveLength(0)
  })
})
