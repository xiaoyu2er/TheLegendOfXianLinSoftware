import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BgmPlayer } from '../audio/bgmPlayer'
import { TITLE_BGM } from '../start/assets'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { useGame } from './useGame'

/**
 * 标题那一屏**真的把主题曲放上去**（xl-q7f）。
 *
 * 单独一个文件，是因为它要把 `audio/bgmPlayer` 整个换成假的，而
 * `vi.mock` 是按文件生效的 —— 混进 `useGame.test.tsx` 会把那边每条用例的
 * 音频层也一起换掉，而那些用例验的不是音频。
 *
 * ## 为什么这条值得单独存在
 *
 * `session.test.ts` 已经验过 `currentBgm` 在起手态上返回主题曲，但那**只是
 * 一句声明**：真正把它放出来的是 `useGame` 那条 pump 里的
 * `bgm.sync(currentBgm(...))`，而 pump 有一道 `if (!renderer) return`。
 * 也就是说"会话说该放主题曲"与"标题这一屏有声音"之间还隔着一层，而少了
 * 这一层的表现是**一屏哑的标题**——画面完全正常。
 *
 * 顺带钉住 `app/App.tsx` 里那个决定：还没开局时它仍然给
 * `useSceneRenderer` 一个真场景名（预热脚本1），渲染器才就绪得了，pump 才
 * 起得来。那条注释因此不是读出来的，是这里跑出来的。
 */
const sync = vi.fn()
vi.mock('../audio/bgmPlayer', () => ({
  createBgmPlayer: (): BgmPlayer => ({
    sync,
    playing: () => null,
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
  sync.mockClear()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('还没开局时的背景音乐', () => {
  it('停在标题上就放主题曲，而且是每一拍都在声明它', () => {
    renderHook(() => useGame(renderer, null))
    act(() => {
      vi.advanceTimersByTime(100)
    })
    // 拍数不写死：判据是"调过它，而且每一次都是主题曲"，不是调了几次。
    expect(sync.mock.calls.length).toBeGreaterThan(0)
    expect([...new Set(sync.mock.calls.map((c) => c[0]))]).toEqual([TITLE_BGM])
  })

  it('渲染器还没就绪就一次都不调 —— 这正是 App 要预热一个场景的理由', () => {
    renderHook(() => useGame(null, null))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(sync).not.toHaveBeenCalled()
  })
})
