import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { START_SCENE } from '../data/scenes'
import { LOAD_TICKS, START_TICK_MS } from '../start/layout'
import type { GameView } from '../game/useGame'
import type { Panel } from '../game/session'

/**
 * App 那一侧的接线：**面板是 `start` 的时候画的是开始界面，而「起」这一下
 * 干了该干的两件事**（xl-kaa）。
 *
 * ## 为什么 `useGame` 是假的
 *
 * jsdom 里建不出 Pixi，所以 `useSceneRenderer` 永远停在 `loading` 上，
 * `useGame` 拿到的渲染器是 `null`、那条 pump 一拍都不跑 —— 也就是说
 * **在 jsdom 里没有办法真的打输一场仗走到标题**。硬凑一个"世界推到全灭"
 * 出来只会把这条用例变成另一份 `session.test.ts` 的复制品。
 *
 * 那一段（打输 → `panel === 'start'`）已经有真的判据：`game/session.test.ts`
 * 里那条「打输的两条分支各走各的」，它跑的是真数据。这里补的是它够不着的
 * 那一截 —— **App 收到 `panel === 'start'` 之后做了什么**，而那一截的错法
 * 是"点了没反应"或者"重开之后进错场景"。
 */
const restart = vi.fn()
const panel = { current: 'scene' as Panel }

vi.mock('../game/useGame', () => ({
  useGame: (): GameView => ({
    dialogue: null,
    panel: panel.current,
    battleLoading: false,
    menuLoading: false,
    menuInput: () => {},
    menuTitleAt: () => null,
    shopInput: () => {},
    shopLoading: false,
    click: () => {},
    scene: null,
    restart,
    saveLoad: null,
    saveLoadLoading: false,
    endLoading: false,
    lsInput: () => {},
    openLoad: () => {},
  }),
}))

const { App } = await import('./App')

beforeEach(() => {
  restart.mockClear()
  panel.current = 'scene'
  // 开始界面自己有一条 100 ms 的拍（`start/useStartPanel.ts`），而它数的是
  // `performance.now()` 的差 —— 假时钟必须**连 performance 一起**接管，
  // 不然每次触发都算作"过去了 0 ms"，一拍都不会走。
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('App 与开始界面', () => {
  it('面板是 scene 的时候没有开始界面', () => {
    render(<App />)
    expect(screen.queryByTestId('start-panel')).toBeNull()
  })

  it('面板是 start 的时候画开始界面，两张画布都藏起来', () => {
    panel.current = 'start'
    render(<App />)
    expect(screen.getByTestId('start-panel')).toBeInTheDocument()
    // 场景那张画布也得藏：不藏的话标题图后面透着一张定住的地图。
    expect(screen.getByTestId('battle-host')).toHaveAttribute('hidden')
    expect(screen.getByTestId('scene-host')).toHaveAttribute('hidden')
  })

  it('点「起」：调 restart，而且场景回到脚本1（不是死在哪儿就从哪儿重开）', () => {
    panel.current = 'start'
    render(<App />)
    // 先把开发用的场景选择器拨到别处 —— 也就是"玩家死在大地图上"那种局面。
    const picker = screen.getByRole('combobox', { name: /场景/ })
    fireEvent.change(picker, { target: { value: '大地图' } })
    expect(picker).toHaveValue('大地图')

    fireEvent.click(screen.getByRole('button', { name: '开始新游戏' }))

    // ⚠️ **点下去当场不该有任何反应**（xl-4si）：原版是卷轴展开 10 拍、再等
    // `loadTimer` 30 拍才 `switchTo("scene")`。xl-kaa 那一版是立刻的，这两条
    // 断言就是那处差别在 App 这一侧的判据。
    expect(restart).not.toHaveBeenCalled()
    expect(picker).toHaveValue('大地图')
    act(() => {
      vi.advanceTimersByTime((10 + LOAD_TICKS) * START_TICK_MS)
    })

    // 两件事都得发生。写成一个对象比一次：只做了一件的话一眼看得出是哪一件。
    // —— 漏掉 setSceneName 的表现是"重开之后还在大地图"，而画面正常；
    //    漏掉 restart() 的表现是"队伍还带着上一局的等级"，画面也正常。
    expect({
      restarts: restart.mock.calls.length,
      scene: (picker as HTMLSelectElement).value,
    }).toEqual({ restarts: 1, scene: START_SCENE })
  })

  it('工具栏的提示换成了开始界面那一句', () => {
    panel.current = 'start'
    render(<App />)
    expect(document.querySelector('.toolbar-hint')!.textContent).toContain('重开一局')
  })
})

/**
 * 离开标题再回来，**标题页接着离开时那一份**（xl-6zf）。
 *
 * 原版 `StartPanel` 是 `GameLauncher` 构造函数里 `new` 的一份，从开机活到关机
 * （唯一会重建面板的 `init()` 没人调）。web 这边 `<StartPanel>` 离开标题就卸载，
 * 状态原先在组件自己的 `useRef` 里，回来就是 `createStartPanelState()` 全新一份：
 * 云跳回起点、「承」的悬停图没了。
 *
 * 读数（xl-6zf 现量，`panelState.ts` 走一遍「承」）：走完那一刻与开机那一帧的差别是
 * 云 y（-40 对 360）、「承」悬停、自绘鼠标的位置与帧。**卷轴两边都是 `scroll` 第 0 帧**
 * —— 原版 `drawScroll()` 里那句 `scroll.stopButtonAnimation()`（web 侧 `settleScroll`）把它拨回了第 0 帧，票面
 * 「卷轴停在展开的最后一帧」不成立。所以这里拿云与悬停当判据，不拿卷轴。
 */
describe('离开标题再回来', () => {
  it('从「承」进存读档、再回标题：云与悬停都接着离开时那一份', () => {
    panel.current = 'start'
    const { rerender } = render(<App />)
    const load = () => screen.getByRole('button', { name: '读取存档' })
    const cloudTop = () => (document.querySelector('.start-cloud') as HTMLElement).style.top
    const freshCloud = cloudTop()
    fireEvent.mouseEnter(load())
    fireEvent.click(load())
    act(() => {
      vi.advanceTimersByTime((10 + LOAD_TICKS) * START_TICK_MS)
    })
    // 期望值在离开**之前**记下（事后拿两个被同一次动作同步过的量互比是恒真的）。
    const leftCloud = cloudTop()
    expect(leftCloud).not.toBe(freshCloud)
    expect(load()).toHaveAttribute('data-hover', 'true')

    panel.current = 'ls'
    rerender(<App />)
    expect(screen.queryByTestId('start-panel')).toBeNull()
    panel.current = 'start'
    rerender(<App />)

    expect({ cloud: cloudTop(), hover: load().getAttribute('data-hover') }).toEqual({
      cloud: leftCloud,
      hover: 'true',
    })
  })
})
