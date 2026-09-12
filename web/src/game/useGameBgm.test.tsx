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
 * `bgm.sync(currentBgm(...))`。也就是说"会话说该放主题曲"与"标题这一屏有
 * 声音"之间还隔着一层，而少了这一层的表现是**一屏哑的标题**——画面完全正常。
 *
 * xl-w16 之后这里还多管一件事：pump **不再等渲染器**。下面第二条用例给的
 * 渲染器就是 `null`，验的正是"标题不靠地图载完也出声"。
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

  /**
   * **渲染器还没就绪也照放**（xl-w16）—— 这条是那次改动的判据本身。
   *
   * 改动前 pump 起手一句 `if (!renderer) return`，于是标题的主题曲要等
   * `app/App.tsx` 预热的脚本1 整个载完才响，实测是**零点几秒的哑场**。
   *
   * **具体几个毫秒不在这里抄一遍**：读数只有一份，在 `useGame.ts` 那条
   * pump 的注释里，测法在 `scripts/measure-title-bgm.md`。抄成三份的后果是
   * 重测一次要改三处，而漏改的那一处看起来仍然像量过的数。
   *
   * 用 `null` 当渲染器，验的正是"不靠渲染器也出声"。**它跟上面那条不是
   * 一回事**：上面那条给的是真渲染器，两条一起才把"靠不靠渲染器"分得开。
   */
  it('渲染器还没就绪也照放主题曲 —— 标题不该哑等地图载完', () => {
    renderHook(() => useGame(null, null))
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(sync.mock.calls.length).toBeGreaterThan(0)
    expect([...new Set(sync.mock.calls.map((c) => c[0]))]).toEqual([TITLE_BGM])
  })
})

/**
 * 存读档面板按 Esc 回标题，**主题曲从头放**（xl-6zf）。
 *
 * 标题 →「承」→ 存读档 → 标题，`currentBgm` 一路都是主题曲（进存读档面板那一支
 * `switchTo("ls")` 不碰曲子，原版也一路放着），所以光看「该放哪首」这件事从来没变过。
 * 变的是原版回标题那一句 `readBGM("主题曲.mp3")` —— `MusicPlayer.play` 不看同名，
 * 停掉重开。这里要验的就是 pump 在翻回标题的那一拍把「从头放」交给了播放器。
 */
describe('从存读档面板回标题的背景音乐', () => {
  it('Esc 回标题那一拍要求从头放，而且只在那一拍', () => {
    const { result } = renderHook(() => useGame(null, null))
    act(() => {
      vi.advanceTimersByTime(100)
    })
    act(() => {
      result.current.openLoad()
      vi.advanceTimersByTime(100)
    })
    expect(result.current.panel).toBe('ls')
    // 进存读档面板之前与之时一次都没要求过从头放 —— 不然下面那条就分不出来。
    expect(sync.mock.calls.filter((c) => c[1] === true)).toEqual([])
    act(() => {
      result.current.lsInput({ e: 'key', key: 'escape' })
      vi.advanceTimersByTime(100)
    })
    expect(result.current.panel).toBe('start')
    expect(sync.mock.calls.filter((c) => c[1] === true)).toEqual([[TITLE_BGM, true]])
  })
})
