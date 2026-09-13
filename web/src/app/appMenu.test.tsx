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
const menuTitleAt = vi.fn<(x: number, y: number) => string | null>(() => null)
const panel = { current: 'menu' as Panel }

vi.mock('../game/useGame', () => ({
  useGame: (): GameView => ({
    dialogue: null,
    panel: panel.current,
    battleLoading: false,
    menuLoading: false,
    menuInput,
    menuTitleAt,
    shopLoading: false,
    shopInput: () => {},
    battleMouse: () => {},
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
  menuTitleAt.mockReset()
  menuTitleAt.mockImplementation(() => null)
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

  /**
   * 跨帧的那一下松手（xl-z4f）。按下「返回」那一拍菜单就关了，菜单宿主被 `hidden`
   * 掉，松手于是落在**场景宿主**上 —— 挂在菜单宿主上的 `onMouseUp` 根本收不到，
   * 而且藏起来的元素外接矩形全是 0，拿它换算坐标只会得到 null。
   *
   * 原版按**按下时**那个组件派发松手（Swing 的 grab）。这里的对应物：按下时把
   * 松手挂到 window 上，坐标按按下那一刻的外接矩形换算。
   */
  it('按下之后菜单关了，松手落在场景宿主上也照样送给菜单，坐标按按下那一刻换算', () => {
    const { rerender } = render(<App />)
    const menuHost = screen.getByTestId('menu-host')
    stubBox(menuHost, { left: 100, top: 50, width: 512, height: 320 })
    fireEvent.mouseDown(menuHost, { clientX: 100 + 256, clientY: 50 + 160 })

    panel.current = 'scene'
    rerender(<App />)
    expect(menuHost, '菜单关了宿主却没藏 —— 下面那条测的就不是跨帧').toHaveAttribute('hidden')
    // 藏起来的元素在浏览器里外接矩形全是 0。
    stubBox(menuHost, { left: 0, top: 0, width: 0, height: 0 })
    fireEvent.mouseUp(screen.getByTestId('scene-host'), { clientX: 100 + 256, clientY: 50 + 160 })

    expect(menuInput.mock.calls.map(([i]) => i)).toEqual([
      { e: 'press', x: 512, y: 320 },
      { e: 'release', x: 512, y: 320 },
    ])
  })

  it('那一下松手只送一次；没在菜单上按下过的松手不送（grab 属于按下的那个）', () => {
    render(<App />)
    const host = screen.getByTestId('menu-host')
    stubBox(host, { left: 0, top: 0, width: 1024, height: 640 })
    fireEvent.mouseUp(host, { clientX: 10, clientY: 10 })
    expect(menuInput, '没按下过就送了松手').not.toHaveBeenCalled()

    fireEvent.mouseDown(host, { clientX: 10, clientY: 10 })
    fireEvent.mouseUp(host, { clientX: 10, clientY: 10 })
    fireEvent.mouseUp(host, { clientX: 10, clientY: 10 })
    expect(menuInput.mock.calls.map(([i]) => i.e)).toEqual(['press', 'release'])
  })

  it('面板不是 menu 的时候一条都不送', () => {
    panel.current = 'scene'
    render(<App />)
    const host = screen.getByTestId('menu-host')
    stubBox(host, { left: 0, top: 0, width: 1024, height: 640 })
    fireEvent.mouseDown(host, { clientX: 10, clientY: 10 })
    expect(menuInput).not.toHaveBeenCalled()
  })

  /**
   * 天书页「确认离开」是禁用的（xl-03x.12），画布上没有 `<button disabled title>`
   * 可挂，理由就挂在画布宿主的 `title` 上 —— 与标题页「结」同一口径。
   * 哪个坐标上有理由归 `menuTitleAt`（真的那个在 `menu/step.ts`，有自己的判据），
   * 这里只验 App 把它问了、挂上了、移开摘掉了。
   */
  it('悬停在禁用的按钮上，画布挂上理由的 title；移开就摘掉', () => {
    menuTitleAt.mockImplementation((x, y) => (x === 512 && y === 320 ? '理由' : null))
    render(<App />)
    const host = screen.getByTestId('menu-host')
    stubBox(host, { left: 100, top: 50, width: 512, height: 320 })
    expect(host, '还没悬停就有 title').not.toHaveAttribute('title')

    fireEvent.mouseMove(host, { clientX: 100 + 256, clientY: 50 + 160 })
    expect(menuTitleAt).toHaveBeenLastCalledWith(512, 320)
    expect(host).toHaveAttribute('title', '理由')

    fireEvent.mouseMove(host, { clientX: 100 + 128, clientY: 50 + 80 })
    expect(host, '移开了 title 还挂着').not.toHaveAttribute('title')
  })
})
