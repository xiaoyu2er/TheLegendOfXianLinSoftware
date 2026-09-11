import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GameView } from '../game/useGame'
import type { Panel } from '../game/session'
import type { MenuInput } from '../menu/step'

/**
 * App 那一侧的菜单接线：**面板是 `menu` 的时候画的是菜单那张画布，而画布上
 * 的三种鼠标事件都送得出去。**
 *
 * ## 为什么 `useGame` 是假的
 *
 * 与 `appTitle.test.tsx` 同一个理由：jsdom 里建不出 Pixi，`useMenuRenderer`
 * 永远是 `null`，那条 pump 也推不动。这里补的是 `game/useGame.test.tsx` 与
 * `game/menuSession.test.ts` 都够不着的那一截 —— **App 收到 `panel === 'menu'`
 * 之后做了什么**。
 *
 * 这一截的错法很具体，而且都长得像"手感不对"而不是"报错了"：
 *
 * - 只送 `press` 不送 `release` → 按钮永远停在「按下」那张贴图上；
 * - 不送 `move` → 装备页与物品页的列表**一项都选不中**（选中整个走
 *   `mouseMoved`）；
 * - 菜单那张画布藏着 → 一片黑，而世界照样在推。
 */
const menuInput = vi.fn<(input: MenuInput) => void>()
const panel = { current: 'menu' as Panel }

vi.mock('../game/useGame', () => ({
  useGame: (): GameView => ({
    dialogue: null,
    panel: panel.current,
    battleLoading: false,
    menuLoading: false,
    menuInput,
    shopLoading: false,
    shopInput: () => {},
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

const { App } = await import('./App')

beforeEach(() => {
  menuInput.mockClear()
  panel.current = 'menu'
})
afterEach(cleanup)

/** 让 `getBoundingClientRect` 给一个真的矩形 —— jsdom 里它默认全是 0。 */
function stubBox(el: Element, box: { left: number; top: number; width: number; height: number }) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    ...box,
    right: box.left + box.width,
    bottom: box.top + box.height,
    x: box.left,
    y: box.top,
    toJSON: () => ({}),
  } as DOMRect)
}

describe('App 与菜单', () => {
  it('面板是 menu 的时候，菜单那张画布露出来，场景那张藏起来', () => {
    render(<App />)
    expect(screen.getByTestId('menu-host')).not.toHaveAttribute('hidden')
    expect(screen.getByTestId('scene-host')).toHaveAttribute('hidden')
    expect(screen.getByTestId('battle-host')).toHaveAttribute('hidden')
  })

  it('面板不是 menu 的时候，菜单那张画布藏着', () => {
    panel.current = 'scene'
    render(<App />)
    expect(screen.getByTestId('menu-host')).toHaveAttribute('hidden')
    expect(screen.getByTestId('scene-host')).not.toHaveAttribute('hidden')
  })

  it('按下 / 松开 / 移动**三种都送**，坐标换算回 1024×640', () => {
    render(<App />)
    const host = screen.getByTestId('menu-host')
    // 画布的位图恒为 1024×640，CSS 尺寸是它的一半 —— 换算要按外接矩形缩回去。
    stubBox(host, { left: 100, top: 50, width: 512, height: 320 })

    fireEvent.mouseDown(host, { clientX: 100 + 256, clientY: 50 + 160 })
    fireEvent.mouseUp(host, { clientX: 100 + 256, clientY: 50 + 160 })
    fireEvent.mouseMove(host, { clientX: 100 + 128, clientY: 50 + 80 })

    expect(menuInput.mock.calls.map(([i]) => i)).toEqual([
      { e: 'press', x: 512, y: 320 },
      { e: 'release', x: 512, y: 320 },
      { e: 'move', x: 256, y: 160 },
    ])
  })

  it('面板不是 menu 的时候一条都不送', () => {
    panel.current = 'scene'
    render(<App />)
    const host = screen.getByTestId('menu-host')
    stubBox(host, { left: 0, top: 0, width: 1024, height: 640 })
    fireEvent.mouseDown(host, { clientX: 10, clientY: 10 })
    expect(menuInput).not.toHaveBeenCalled()
  })
})
