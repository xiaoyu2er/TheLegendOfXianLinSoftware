import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SfxPlayer } from '../audio/sfxPlayer'
import { prepareExits } from '../data/loadedScenes'
import { loadScene } from '../data/scenes'
import { resetParty } from '../fakes/party'
import { readMenuTrace } from '../menu/trace'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { TICK_MS, createWorld } from '../state/step'
import { useGame } from './useGame'

/**
 * `useGame` 那条 pump **真的把会话推出来的音效交给了播放器**（xl-03x.7）。
 *
 * 单独一个文件，理由同 `useGameBgm.test.tsx`：要把 `audio/sfxPlayer` 整个换成假的，
 * `vi.mock` 按文件生效。
 *
 * 逐剧本逐步的对撞在 `sfxWiring.test.ts`，它从 `advanceSession` 一路验到 `playSfx`。
 * 这里补的是它看不见的最后一截：pump 到底调没调、是不是每一拍都调的是**这一拍
 * 推出来的**那一份。漏调的表现是一个哑的菜单，而会话层与播放器各自的测试都还是绿的。
 *
 * ⚠️ 与那边同一句：证的是「交给了播放器、参数对」，证不了玩家真的听到了。
 */
const play = vi.fn<(names: readonly string[]) => void>()
vi.mock('../audio/sfxPlayer', () => ({
  createSfxPlayer: (): SfxPlayer => ({
    play,
    playing: () => null,
    setEnabled: () => {},
    enabled: () => true,
    blocked: () => false,
    destroy: () => {},
  }),
}))

const renderer = {
  showScene: async () => {},
  showWorld: () => {},
  destroy: () => {},
} satisfies SceneRenderer

beforeEach(() => {
  play.mockClear()
  resetParty()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

async function mount(scene = '宿舍') {
  await prepareExits(createWorld(await loadScene(scene)))
  const rendered = renderHook(() => useGame(renderer, scene))
  await act(async () => {
    await loadScene(scene)
  })
  return rendered
}

/**
 * 真值里第一次「按下顶栏的一颗页签就出声」的那一步：坐标与那一声都从
 * `menu-func` 真值里取，不手写。
 */
function tabPressFromTruth(): { x: number; y: number; music: string[] } {
  const trace = readMenuTrace('menu-func')
  for (const tick of trace.ticks) {
    const [e] = tick.input
    const music = tick['music'] as string[]
    if (tick.input.length === 1 && e?.e === 'press' && e.target?.startsWith('tab:') && music.length > 0) {
      return { x: e.x, y: e.y, music }
    }
  }
  throw new Error('menu-func 里没有一次按下页签就出声的步')
}

/** 交给播放器的全部名单，按先后摊平。`play([])` 是「这一拍没出声」，摊平后不占位。 */
function handed(): string[] {
  return play.mock.calls.flatMap(([names]) => [...names])
}

describe('useGame 的音效接线', () => {
  it('菜单里按下一颗页签：那一声交给播放器**恰好一次**，之后的空拍一声都不再交', async () => {
    const { result } = await mount()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      vi.advanceTimersByTime(TICK_MS)
    })
    expect(result.current.panel).toBe('menu')
    expect(handed(), '开菜单那一下原版不出声').toEqual([])

    const tab = tabPressFromTruth()
    act(() => {
      result.current.menuInput({ e: 'press', x: tab.x, y: tab.y })
      // 半秒：五个菜单脉冲、五十个 pump。读当前值的写法会在脉冲清掉它之前的
      // 每一个空拍上再交一遍。
      vi.advanceTimersByTime(500)
    })
    // 调过 play（不只是「交出去的摊平后对得上」—— 一次都没调也会是 []）。
    expect(play).toHaveBeenCalled()
    expect(handed()).toEqual(tab.music)

    act(() => {
      result.current.menuInput({ e: 'release', x: tab.x, y: tab.y })
      vi.advanceTimersByTime(500)
    })
    expect(handed(), '松开那一下原版不出声（菜单在按下时出声）').toEqual(tab.music)
  })
})
