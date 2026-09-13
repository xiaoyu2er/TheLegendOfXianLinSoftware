import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GameView } from '../game/useGame'
import type { Panel } from '../game/session'
import type { MenuInput } from '../menu/step'
import type { ShopInput } from '../shop/step'
import type { SaveLoadInput } from '../saveload/step'
import type { BattlePointer } from '../battle/step'

/**
 * App 那一层的 mouse grab（xl-z4f 做了菜单，xl-o9z 收拢到三块宿主）：**松手派给按下时
 * 那块宿主，不看松手落在哪块上、也不看它此刻还显不显示**。
 *
 * 原版对应物是 Swing `LightweightDispatcher` 的 grab。两个方向都有后果：
 *
 * - 存读档面板上按住槽位、按退出键切走，松手落在菜单宿主上 —— 挂在 ls 宿主上的
 *   `onMouseUp` 收不到，槽位的 `isclicked` 粘着，下次进面板一松手就连带存 / 读它；
 * - 菜单上按下「存档」（按下那一拍就 `switchTo("ls")`），松手落在刚露出来的 ls 宿主上
 *   —— 原版这一下归菜单，送给 ls 的话一颗粘着的槽会被多办一遍。
 *
 * `useGame` 是假的，理由同 `appMenu.test.tsx`。
 */
const menuInput = vi.fn<(input: MenuInput) => void>()
const shopInput = vi.fn<(input: ShopInput) => void>()
const lsInput = vi.fn<(input: SaveLoadInput) => void>()
const battleMouse = vi.fn<(input: BattlePointer) => void>()
const panel = { current: 'ls' as Panel }

vi.mock('../game/useGame', () => ({
  useGame: (): GameView => ({
    dialogue: null,
    panel: panel.current,
    battleLoading: false,
    menuLoading: false,
    menuInput,
    menuTitleAt: () => null,
    shopLoading: false,
    shopInput,
    battleMouse,
    scene: null,
    restart: () => {},
    saveLoad: null,
    saveLoadLoading: false,
    endLoading: false,
    lsInput,
    openLoad: () => {},
  }),
}))

const { App } = await import('./App')

beforeEach(() => {
  menuInput.mockClear()
  shopInput.mockClear()
  lsInput.mockClear()
  battleMouse.mockClear()
  panel.current = 'ls'
})
afterEach(cleanup)

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

const HALF = { left: 100, top: 50, width: 512, height: 320 }
const ZERO = { left: 0, top: 0, width: 0, height: 0 }
const CENTER = { clientX: 100 + 256, clientY: 50 + 160 }

describe('App 的 mouse grab', () => {
  it('存读档面板上按下、面板被退出键切走，松手落在菜单宿主上照样送回存读档面板，坐标按按下那一刻换算', () => {
    const { rerender } = render(<App />)
    const lsHost = screen.getByTestId('ls-host')
    stubBox(lsHost, HALF)
    fireEvent.mouseDown(lsHost, CENTER)

    panel.current = 'menu'
    rerender(<App />)
    expect(lsHost, '面板切走了宿主却没藏 —— 下面那条测的就不是跨帧').toHaveAttribute('hidden')
    stubBox(lsHost, ZERO)
    fireEvent.mouseUp(screen.getByTestId('menu-host'), CENTER)

    expect(lsInput.mock.calls.map(([i]) => i)).toEqual([
      { e: 'press', x: 512, y: 320 },
      { e: 'release', x: 512, y: 320 },
    ])
    expect(menuInput, '松手送给了没按下过的菜单').not.toHaveBeenCalled()
  })

  it('菜单上按下「存档」、面板翻到存读档，松手落在存读档宿主上：归菜单，不归存读档面板', () => {
    panel.current = 'menu'
    const { rerender } = render(<App />)
    const menuHost = screen.getByTestId('menu-host')
    stubBox(menuHost, HALF)
    fireEvent.mouseDown(menuHost, CENTER)

    panel.current = 'ls'
    rerender(<App />)
    const lsHost = screen.getByTestId('ls-host')
    expect(lsHost).not.toHaveAttribute('hidden')
    stubBox(lsHost, HALF)
    fireEvent.mouseUp(lsHost, CENTER)

    expect(menuInput.mock.calls.map(([i]) => i.e)).toEqual(['press', 'release'])
    expect(lsInput, '没在存读档面板上按下过，松手却送给了它').not.toHaveBeenCalled()
  })

  for (const [name, host, spy] of [
    ['店', 'shop-host', shopInput],
    ['存读档面板', 'ls-host', lsInput],
  ] as const) {
    it(`${name}：没按下过的松手不送；一次按下只送一次松手`, () => {
      panel.current = name === '店' ? 'shop' : 'ls'
      render(<App />)
      const el = screen.getByTestId(host)
      stubBox(el, { left: 0, top: 0, width: 1024, height: 640 })
      fireEvent.mouseUp(el, { clientX: 10, clientY: 10 })
      expect(spy, '没按下过就送了松手').not.toHaveBeenCalled()

      fireEvent.mouseDown(el, { clientX: 10, clientY: 10 })
      fireEvent.mouseUp(el, { clientX: 10, clientY: 10 })
      fireEvent.mouseUp(el, { clientX: 10, clientY: 10 })
      expect(spy.mock.calls.map(([i]) => i.e)).toEqual(['press', 'release'])
    })
  }

  it('战斗画布（xl-qqw）：移动 / 按下 / 按住移动 / 松手分开送，松手落在画布外也归战斗', () => {
    panel.current = 'battle'
    render(<App />)
    const host = screen.getByTestId('battle-host')
    stubBox(host, { left: 0, top: 0, width: 1024, height: 640 })
    fireEvent.mouseMove(host, { clientX: 10, clientY: 20, buttons: 0 })
    fireEvent.mouseDown(host, { clientX: 514, clientY: 325 })
    // 按住左键移动是 `mouseDragged`：原版那一支不停帧，与 `mouseMoved` 不是一回事。
    fireEvent.mouseMove(host, { clientX: 60, clientY: 60, buttons: 1 })
    // 拖出画布再松手 —— 宿主自己收不到这一下，原版照样派给按下时那个组件。
    fireEvent.mouseUp(window, { clientX: 1100, clientY: 60 })
    expect(battleMouse.mock.calls.map(([i]) => i)).toEqual([
      { e: 'move', x: 10, y: 20 },
      { e: 'press', x: 514, y: 325 },
      { e: 'drag', x: 60, y: 60 },
      { e: 'release', x: 1100, y: 60 },
    ])
  })

  it('战斗画布：按住右键移动也是拖动 —— Swing 的 mouseDragged 不分哪个键', () => {
    panel.current = 'battle'
    render(<App />)
    const host = screen.getByTestId('battle-host')
    stubBox(host, { left: 0, top: 0, width: 1024, height: 640 })
    fireEvent.mouseMove(host, { clientX: 60, clientY: 60, buttons: 2 })
    expect(battleMouse.mock.calls.map(([i]) => i.e)).toEqual(['drag'])
  })

  /**
   * 拖出宿主之后（xl-b28）：Swing 把 MOUSE_DRAGGED 也按 grab 派给按下时那个组件，拖出
   * 组件外照样收，坐标可以在组件外（负数、超过 1024）。宿主自己的 `onMouseMove` 这时
   * 一个都收不到 —— 战斗四颗按钮的贴图会停在出界前那一张，直到松手。
   *
   * 每块宿主拖出去送的是它自己「按住移动」那一种：战斗与存读档是 `drag`，菜单与店
   * 不分移动与拖动（原版两支逐字相同 / 宿主本来就只送 `move`）。
   */
  for (const [name, p, host, spy, kind] of [
    ['战斗画布', 'battle', 'battle-host', battleMouse, 'drag'],
    ['存读档面板', 'ls', 'ls-host', lsInput, 'drag'],
    ['菜单', 'menu', 'menu-host', menuInput, 'move'],
    ['店', 'shop', 'shop-host', shopInput, 'move'],
  ] as const) {
    it(`${name}：按下之后拖出宿主照样收拖动，宿主里的拖动不重送，松手之后画布外的移动不再收`, () => {
      panel.current = p
      render(<App />)
      const el = screen.getByTestId(host)
      stubBox(el, { left: 0, top: 0, width: 1024, height: 640 })
      fireEvent.mouseDown(el, { clientX: 514, clientY: 325 })
      // 宿主里的拖动冒泡到 window 上 —— 只该送一次。
      fireEvent.mouseMove(el, { clientX: 60, clientY: 60, buttons: 1 })
      // 拖出画布：落在宿主外（这里是 document.body），宿主的 onMouseMove 收不到。
      fireEvent.mouseMove(document.body, { clientX: 1100, clientY: -5, buttons: 1 })
      fireEvent.mouseUp(window, { clientX: 1100, clientY: -5 })
      // grab 结束：画布外的移动不归任何人（Swing 的 mouseMoved 只派给指针底下的组件）。
      fireEvent.mouseMove(document.body, { clientX: 1200, clientY: 10, buttons: 0 })
      fireEvent.mouseMove(document.body, { clientX: 1200, clientY: 10, buttons: 1 })
      expect(spy.mock.calls.map(([i]) => i)).toEqual([
        { e: 'press', x: 514, y: 325 },
        { e: kind, x: 60, y: 60 },
        { e: kind, x: 1100, y: -5 },
        { e: 'release', x: 1100, y: -5 },
      ])
    })
  }
})
