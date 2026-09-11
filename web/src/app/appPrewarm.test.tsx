import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { START_SCENE } from '../data/scenes'
import type { GameView } from '../game/useGame'
import type { Panel } from '../game/session'
import type { SceneRendering } from '../scene/useSceneRenderer'

/**
 * **还没开局时，场景渲染器仍然拿到一个真场景名**（`app/App.tsx` 的
 * `shownScene`）—— 也就是"预热脚本1"这个决定本身（xl-w16）。
 *
 * ## 为什么它现在需要一条自己的判据
 *
 * 这条决定原先是被 `game/useGameBgm.test.tsx` **顺带**钉住的：那时候标题
 * 的主题曲要等渲染器就绪才响，所以"标题有声音"这件事反过来证明了这里给的
 * 是一个真场景名。xl-w16 把 pump 与渲染器解耦之后，那条侧证没了 ——
 * `shownScene` 就算改成永远不给场景名，标题照样有声音，**全套测试也照样
 * 全绿**。剩下的那个理由（点完「起」不必盯着"正在载入 脚本1…"）在画面上
 * 只表现为"慢了一下"，没人看得出来。
 *
 * 这一条就是补那个缺口的，来自 xl-w16 的 /code-review 标准轴。
 *
 * ## 为什么是单独一个文件
 *
 * 它要把 `scene/useSceneRenderer` 整个换成假的（真的那个在 jsdom 里建不出
 * Pixi），而 `vi.mock` 是**按文件生效**的 —— 混进 `appTitle.test.tsx` 会把
 * 那边每条用例的渲染器也一起换掉，而那些用例验的不是这件事。同一个理由
 * 见 `game/useGameBgm.test.tsx` 的开头。
 */
const seenSceneNames: string[] = []
const panel = { current: 'start' as Panel }

vi.mock('../game/useGame', () => ({
  useGame: (): GameView => ({
    dialogue: null,
    panel: panel.current,
    battleLoading: false,
    menuLoading: false,
    menuInput: () => {},
    shopInput: () => {},
    shopLoading: false,
    click: () => {},
    scene: null,
    restart: () => {},
    saveLoad: null,
    saveLoadLoading: false,
    endLoading: false,
    lsInput: () => {},
    openLoad: () => {},
  }),
}))

vi.mock('../scene/useSceneRenderer', () => ({
  useSceneRenderer: (_host: unknown, sceneName: string): SceneRendering => {
    seenSceneNames.push(sceneName)
    // 停在 `loading` 上：jsdom 里真的那个也永远走不到 `ready`，而这一条
    // 要验的恰恰是"还没就绪的时候拿的是什么名字"。
    return { status: { kind: 'loading' }, renderer: null }
  },
}))

const { App } = await import('./App')

beforeEach(() => {
  seenSceneNames.length = 0
  panel.current = 'start'
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('还没开局时的场景预热（xl-w16）', () => {
  it('停在标题上，场景渲染器拿到的仍然是脚本1，不是空的', () => {
    render(<App />)
    // 每次渲染都调一次，所以判据是"每一次拿到的都是脚本1"，不是调了几次 ——
    // 写死次数会在 React 多渲染一遍时红，而那跟这条决定无关。
    expect(seenSceneNames.length).toBeGreaterThan(0)
    expect([...new Set(seenSceneNames)]).toEqual([START_SCENE])
  })
})
