import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { START_SCENE } from '../data/scenes'
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
    click: () => {},
    scene: null,
    restart,
  }),
}))

const { App } = await import('./App')

beforeEach(() => {
  restart.mockClear()
  panel.current = 'scene'
})
afterEach(cleanup)

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
    const sceneHost = document.querySelectorAll('.stage-panel')[0]!
    expect(sceneHost).toHaveAttribute('hidden')
  })

  it('点「起」：调 restart，而且场景回到脚本1（不是死在哪儿就从哪儿重开）', () => {
    panel.current = 'start'
    render(<App />)
    // 先把开发用的场景选择器拨到别处 —— 也就是"玩家死在大地图上"那种局面。
    const picker = screen.getByRole('combobox', { name: /场景/ })
    fireEvent.change(picker, { target: { value: '大地图' } })
    expect(picker).toHaveValue('大地图')

    fireEvent.click(screen.getByRole('button', { name: '开始新游戏' }))

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
