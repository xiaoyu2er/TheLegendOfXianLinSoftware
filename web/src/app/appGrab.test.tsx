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
    // 右键先在画布上按下 —— 没有这一下，拖动的目标是 null，一个都不派（xl-5ee）。
    fireEvent.mouseDown(host, { clientX: 50, clientY: 50, button: 2, buttons: 2 })
    fireEvent.mouseMove(host, { clientX: 60, clientY: 60, buttons: 2 })
    expect(battleMouse.mock.calls.map(([i]) => i.e)).toEqual(['press', 'drag'])
  })

  /**
   * 拖出宿主之后（xl-b28）：Swing 把 MOUSE_DRAGGED 也按 grab 派给按下时那个组件，拖出
   * 组件外照样收，坐标可以在组件外（负数、超过 1024）。宿主自己的 `onMouseMove` 这时
   * 一个都收不到 —— 战斗四颗按钮的贴图会停在出界前那一张，直到松手。
   *
   * 每块宿主拖出去送的是它自己「按住移动」那一种：战斗、存读档与店是 `drag`，菜单不分
   * 移动与拖动（原版 `MenuPanel` 两支逐字相同）。
   */
  for (const [name, p, host, spy, kind] of [
    ['战斗画布', 'battle', 'battle-host', battleMouse, 'drag'],
    ['存读档面板', 'ls', 'ls-host', lsInput, 'drag'],
    ['菜单', 'menu', 'menu-host', menuInput, 'move'],
    ['店', 'shop', 'shop-host', shopInput, 'drag'],
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

  /**
   * 店与存读档面板：Swing 的 `mouseDragged` 不分哪个键（xl-bwl）。原版这两块的拖动只记
   * 坐标，不跑 `isMoveIn` —— 送成 `move` 的话，右键拖过按钮会点亮光效、店里会换掉悬停
   * 贴图与店主台词。
   */
  for (const [name, p, host, spy] of [
    ['店', 'shop', 'shop-host', shopInput],
    ['存读档面板', 'ls', 'ls-host', lsInput],
  ] as const) {
    it(`${name}：按住任一键移动都是拖动，宿主里宿主外一样`, () => {
      panel.current = p
      render(<App />)
      const el = screen.getByTestId(host)
      stubBox(el, { left: 0, top: 0, width: 1024, height: 640 })
      fireEvent.mouseMove(el, { clientX: 10, clientY: 10, buttons: 0 })
      fireEvent.mouseDown(el, { clientX: 20, clientY: 20, button: 2, buttons: 2 })
      fireEvent.mouseMove(el, { clientX: 30, clientY: 30, buttons: 2 })
      fireEvent.mouseMove(document.body, { clientX: 1100, clientY: 30, buttons: 2 })
      fireEvent.mouseMove(el, { clientX: 40, clientY: 40, buttons: 4 })
      fireEvent.mouseUp(window, { clientX: 40, clientY: 40 })
      expect(spy.mock.calls.map(([i]) => i)).toEqual([
        { e: 'move', x: 10, y: 10 },
        { e: 'press', x: 20, y: 20 },
        { e: 'drag', x: 30, y: 30 },
        { e: 'drag', x: 1100, y: 30 },
        { e: 'drag', x: 40, y: 40 },
        { e: 'release', x: 40, y: 40 },
      ])
    })
  }

  /**
   * 菜单上按下「存档」，按下那一拍就翻到存读档面板（xl-bwl）。按住拖到刚露出来的存读档
   * 宿主上：Swing grab 下这些拖动归菜单，存读档面板一个都收不到。
   *
   * 这里只验 App 这一层把它们送给了菜单那一路。菜单此刻藏着，`useGame.routeByGrab` 会照当前
   * 面板把它们丢掉 —— 那是登记过的有意差异（藏着的面板收不到拖动），不在这条判据里。
   */
  it('菜单上按下、翻到存读档之后在存读档宿主上拖：拖动归菜单，存读档面板一条都不收', () => {
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
    fireEvent.mouseMove(lsHost, { ...CENTER, buttons: 1 })
    fireEvent.mouseUp(lsHost, CENTER)

    expect(lsInput, '拖动落在了没按下过的存读档面板上').not.toHaveBeenCalled()
    expect(menuInput.mock.calls.map(([i]) => i)).toEqual([
      { e: 'press', x: 512, y: 320 },
      { e: 'move', x: 512, y: 320 },
      { e: 'release', x: 512, y: 320 },
    ])
  })

  /**
   * 在浏览器窗口外松手，window 收不到 mouseup（xl-bwl）。原版那一下照样到（操作系统替窗口
   * 握着 grab）。这一层看不见松手本身，只看得见它的后果：**grab 还挂着，指针却没有键按着了**
   * —— 回到页面的头一下移动（`buttons` 为 0），或者没按着别的键的一次新按下。见到就当场
   * 补上那一下松手，坐标取见到它的那一刻。
   */
  it('窗口外松了手：回来头一下没按键的移动补上松手，之后别处的拖动与松手不再归它', () => {
    panel.current = 'ls'
    render(<App />)
    const el = screen.getByTestId('ls-host')
    stubBox(el, { left: 0, top: 0, width: 1024, height: 640 })
    fireEvent.mouseDown(el, { clientX: 20, clientY: 20 })
    fireEvent.mouseMove(document.body, { clientX: 1100, clientY: 30, buttons: 1 })
    // 松手发生在窗口外，这里一个事件都没有。指针回到页面上：
    fireEvent.mouseMove(el, { clientX: 50, clientY: 60, buttons: 0 })
    // 之后在工具栏上按下、拖、松开 —— 与存读档面板无关。
    fireEvent.mouseDown(document.body, { clientX: 1100, clientY: 700 })
    fireEvent.mouseMove(document.body, { clientX: 1150, clientY: 700, buttons: 1 })
    fireEvent.mouseUp(document.body, { clientX: 1150, clientY: 700 })
    expect(lsInput.mock.calls.map(([i]) => i)).toEqual([
      { e: 'press', x: 20, y: 20 },
      { e: 'drag', x: 1100, y: 30 },
      { e: 'release', x: 50, y: 60 },
      { e: 'move', x: 50, y: 60 },
    ])
  })

  it('窗口外松了手、回来直接按下：先补上一次的松手，再送这一下按下', () => {
    panel.current = 'battle'
    render(<App />)
    const el = screen.getByTestId('battle-host')
    stubBox(el, { left: 0, top: 0, width: 1024, height: 640 })
    fireEvent.mouseDown(el, { clientX: 20, clientY: 20, button: 0, buttons: 1 })
    fireEvent.mouseDown(el, { clientX: 70, clientY: 80, button: 0, buttons: 1 })
    fireEvent.mouseUp(window, { clientX: 70, clientY: 80 })
    expect(battleMouse.mock.calls.map(([i]) => i)).toEqual([
      { e: 'press', x: 20, y: 20 },
      { e: 'release', x: 70, y: 80 },
      { e: 'press', x: 70, y: 80 },
      { e: 'release', x: 70, y: 80 },
    ])
  })

  /**
   * 和弦（xl-4xi）：Swing 的 `LightweightDispatcher.isMouseGrab` 看的是「这一下之前有没有键
   * 按着」（JDK 17 `java/awt/Container.java`）。所以按住左键再按右键，第二次按下归 grab；
   * 先松开的那一下也归 grab、**grab 不解除**；另一只键还按着时拖出宿主照样收；最后一次
   * 松手才解除。
   */
  it('和弦：先松开一只键 grab 不解除 —— 还按着的那只拖出宿主照样收，两次松手都送', () => {
    panel.current = 'battle'
    render(<App />)
    const el = screen.getByTestId('battle-host')
    stubBox(el, { left: 0, top: 0, width: 1024, height: 640 })
    fireEvent.mouseDown(el, { clientX: 20, clientY: 20, button: 0, buttons: 1 })
    fireEvent.mouseDown(el, { clientX: 30, clientY: 30, button: 2, buttons: 3 })
    fireEvent.mouseUp(window, { clientX: 40, clientY: 40, button: 0, buttons: 2 })
    fireEvent.mouseMove(document.body, { clientX: 1100, clientY: 50, buttons: 2 })
    fireEvent.mouseUp(window, { clientX: 1100, clientY: 60, button: 2, buttons: 0 })
    // grab 解除之后：画布外的拖动不再归它。
    fireEvent.mouseMove(document.body, { clientX: 1200, clientY: 70, buttons: 1 })
    expect(battleMouse.mock.calls.map(([i]) => i)).toEqual([
      { e: 'press', x: 20, y: 20 },
      { e: 'press', x: 30, y: 30 },
      { e: 'release', x: 40, y: 40 },
      { e: 'drag', x: 1100, y: 50 },
      { e: 'release', x: 1100, y: 60 },
    ])
  })

  it('和弦里的第二次按下落在别的宿主上：归按下时那块，那块宿主一条都不收，也不把 grab 换走', () => {
    panel.current = 'menu'
    const { rerender } = render(<App />)
    const menuHost = screen.getByTestId('menu-host')
    stubBox(menuHost, HALF)
    fireEvent.mouseDown(menuHost, { ...CENTER, button: 0, buttons: 1 })

    panel.current = 'ls'
    rerender(<App />)
    const lsHost = screen.getByTestId('ls-host')
    expect(lsHost).not.toHaveAttribute('hidden')
    stubBox(lsHost, HALF)
    fireEvent.mouseDown(lsHost, { ...CENTER, button: 2, buttons: 3 })
    fireEvent.mouseUp(lsHost, { ...CENTER, button: 2, buttons: 1 })
    fireEvent.mouseUp(lsHost, { ...CENTER, button: 0, buttons: 0 })

    expect(lsInput, '和弦里的按下 / 松手落在了没按下过的存读档面板上').not.toHaveBeenCalled()
    expect(menuInput.mock.calls.map(([i]) => i.e)).toEqual(['press', 'press', 'release', 'release'])
  })

  it('和弦一只键在窗口外松开、另一只回来松开：最后那一下补齐两次松手，下一次按下另起 grab', () => {
    panel.current = 'battle'
    render(<App />)
    const el = screen.getByTestId('battle-host')
    stubBox(el, { left: 0, top: 0, width: 1024, height: 640 })
    fireEvent.mouseDown(el, { clientX: 20, clientY: 20, button: 0, buttons: 1 })
    fireEvent.mouseDown(el, { clientX: 20, clientY: 20, button: 2, buttons: 3 })
    // 左键在窗口外松开，这里一个事件都没有；右键回到页面上松开。
    fireEvent.mouseUp(window, { clientX: 50, clientY: 60, button: 2, buttons: 0 })
    fireEvent.mouseDown(el, { clientX: 70, clientY: 80, button: 0, buttons: 1 })
    fireEvent.mouseUp(window, { clientX: 70, clientY: 80, button: 0, buttons: 0 })
    expect(battleMouse.mock.calls.map(([i]) => i.e)).toEqual(['press', 'press', 'release', 'release', 'press', 'release'])
  })

  /**
   * grab 开始之前就按着的键（xl-2yh）：右键先按在舞台外、再在宿主上按左键。Swing 的
   * `isMouseGrab` 对这一下左键按下为真（右键在它之前就按着），于是 `mouseEventTarget` 不重设，
   * 目标还是右键按下那一刻的落点 —— 舞台外（原版是窗口外）或不收鼠标的面板，都是 null。
   * 这一下按下、两次松手，一个面板都收不到；全松开之后的下一次按下照常起 grab。
   */
  for (const [name, p, host, spy] of [
    ['战斗画布', 'battle', 'battle-host', battleMouse],
    ['存读档面板', 'ls', 'ls-host', lsInput],
    ['菜单', 'menu', 'menu-host', menuInput],
    ['店', 'shop', 'shop-host', shopInput],
  ] as const) {
    it(`${name}：舞台外先按着右键再在宿主上按左键 —— 这一下按下与两次松手都不送，全松开后照常`, () => {
      panel.current = p
      render(<App />)
      const el = screen.getByTestId(host)
      stubBox(el, { left: 0, top: 0, width: 1024, height: 640 })
      fireEvent.mouseDown(document.body, { clientX: 1100, clientY: 20, button: 2, buttons: 2 })
      fireEvent.mouseDown(el, { clientX: 20, clientY: 20, button: 0, buttons: 3 })
      fireEvent.mouseUp(window, { clientX: 30, clientY: 30, button: 2, buttons: 1 })
      fireEvent.mouseUp(window, { clientX: 40, clientY: 40, button: 0, buttons: 0 })
      // 全松开了：下一下是一次普通的点击。
      fireEvent.mouseDown(el, { clientX: 70, clientY: 80, button: 0, buttons: 1 })
      fireEvent.mouseUp(window, { clientX: 70, clientY: 80, button: 0, buttons: 0 })
      expect(spy.mock.calls.map(([i]) => i)).toEqual([
        { e: 'press', x: 70, y: 80 },
        { e: 'release', x: 70, y: 80 },
      ])
    })
  }

  /**
   * 另一条落空的路：右键按在场景上（原版 `ScenePanel` 没挂鼠标监听，那一下按下
   * `isMouseGrab` 为假、目标重设为 null），按着右键开菜单、在菜单上按左键 —— 这一下
   * `isMouseGrab` 为真，目标还是 null，菜单一条都收不到。
   */
  it('场景上先按着右键、翻到菜单再按左键：菜单一条都不收', () => {
    panel.current = 'scene'
    const { rerender } = render(<App />)
    fireEvent.mouseDown(screen.getByTestId('scene-host'), { ...CENTER, button: 2, buttons: 2 })
    panel.current = 'menu'
    rerender(<App />)
    const menuHost = screen.getByTestId('menu-host')
    expect(menuHost).not.toHaveAttribute('hidden')
    stubBox(menuHost, HALF)
    fireEvent.mouseDown(menuHost, { ...CENTER, button: 0, buttons: 3 })
    fireEvent.mouseUp(window, { ...CENTER, button: 0, buttons: 2 })
    fireEvent.mouseUp(window, { ...CENTER, button: 2, buttons: 0 })
    expect(menuInput, '右键按在场景上，左键那一下却送给了菜单').not.toHaveBeenCalled()
  })

  /**
   * 没有 grab 时按着键移到宿主上（xl-5ee）。JDK 17 `Container.java` 的
   * `LightweightDispatcher.processMouseEvent`：MOUSE_DRAGGED 的 `isMouseGrab` 恒为真（不异或
   * 本键，按着键就是真），于是它**从不重设** `mouseEventTarget`，只派给更早那一下定下的目标。
   * 键按在舞台外（原版窗口外）或不收鼠标的面板上，那个目标是 null —— `met != null` 那一整块
   * 不进，一个 `mouseDragged` 都不派。全松开之后的移动是 MOUSE_MOVED，照常重设、照常送。
   */
  for (const [name, p, host, spy] of [
    ['战斗画布', 'battle', 'battle-host', battleMouse],
    ['存读档面板', 'ls', 'ls-host', lsInput],
    ['菜单', 'menu', 'menu-host', menuInput],
    ['店', 'shop', 'shop-host', shopInput],
  ] as const) {
    it(`${name}：舞台外按着键移到宿主上 —— 拖动一个都不送，松开之后的移动照常`, () => {
      panel.current = p
      render(<App />)
      const el = screen.getByTestId(host)
      stubBox(el, { left: 0, top: 0, width: 1024, height: 640 })
      fireEvent.mouseDown(document.body, { clientX: 1100, clientY: 20, button: 0, buttons: 1 })
      fireEvent.mouseMove(el, { clientX: 20, clientY: 20, buttons: 1 })
      fireEvent.mouseMove(el, { clientX: 30, clientY: 30, buttons: 3 })
      fireEvent.mouseUp(window, { clientX: 30, clientY: 30, button: 0, buttons: 0 })
      fireEvent.mouseMove(el, { clientX: 40, clientY: 50, buttons: 0 })
      expect(spy.mock.calls.map(([i]) => i)).toEqual([{ e: 'move', x: 40, y: 50 }])
    })
  }

  it('场景上按着右键、翻到菜单再移动：菜单一条拖动都不收', () => {
    panel.current = 'scene'
    const { rerender } = render(<App />)
    fireEvent.mouseDown(screen.getByTestId('scene-host'), { ...CENTER, button: 2, buttons: 2 })
    panel.current = 'menu'
    rerender(<App />)
    const menuHost = screen.getByTestId('menu-host')
    expect(menuHost).not.toHaveAttribute('hidden')
    stubBox(menuHost, HALF)
    fireEvent.mouseMove(menuHost, { ...CENTER, buttons: 2 })
    expect(menuInput, '右键按在场景上，按着它的移动却送给了菜单').not.toHaveBeenCalled()
    // 正面对照：同一块宿主、同一处坐标，松开之后的移动照常送 —— 上面那句不是因为宿主收不到。
    fireEvent.mouseUp(window, { ...CENTER, button: 2, buttons: 0 })
    fireEvent.mouseMove(menuHost, { ...CENTER, buttons: 0 })
    expect(menuInput.mock.calls.map(([i]) => i)).toEqual([{ e: 'move', x: 512, y: 320 }])
  })

  it('和弦两只键都在窗口外松开：回来头一下没按键的移动补上两次松手', () => {
    panel.current = 'ls'
    render(<App />)
    const el = screen.getByTestId('ls-host')
    stubBox(el, { left: 0, top: 0, width: 1024, height: 640 })
    fireEvent.mouseDown(el, { clientX: 20, clientY: 20, button: 0, buttons: 1 })
    fireEvent.mouseDown(el, { clientX: 20, clientY: 20, button: 2, buttons: 3 })
    fireEvent.mouseMove(el, { clientX: 50, clientY: 60, buttons: 0 })
    expect(lsInput.mock.calls.map(([i]) => i.e)).toEqual(['press', 'press', 'release', 'release', 'move'])
  })
})

/**
 * grab 期间在**舞台外**按下的第二个键（xl-df1，标题页那一份是 xl-bg3）。
 *
 * 原版这四块是同一个 `JFrame` 里 `CardLayout` 的四块面板，而 `CardLayout.layoutContainer`
 * 把当前那块 `setBounds` 到 `parent.width/height` 减边距（JDK 17；这里 hgap/vgap 与内容面板
 * 的 insets 都是 0）—— **当前面板就是整个内容面板**。所以「宿主外」在原版里分两半，而这一层
 * 原先把它们当成了一回事：
 *
 * - **舞台里、宿主外**（overlay 上的提示字、露出来的另一块宿主）：仍是同一块内容面板。
 *   grab 期间 `LightweightDispatcher.processMouseEvent` 的 `isMouseGrab` 为真、`mouseEventTarget`
 *   不重设，按下与松手都派给 grab 的主人 —— 照送，这一半原先就是对的；
 * - **舞台外**（letterbox、工具条、页面别处）＝ 原版的窗口外：那一下按在别的窗口上、归那个
 *   窗口，Java 侧**一条都没有**。按下与它的松手都不该送，而原先两下都送了。
 *
 * 读数：xl-bg3 在 macOS 24.6.0 + openjdk 17 上量的三轮（CGEvent 按 HID tap 合成整段序列，
 * 「窗口外」是另一个 app 的空白窗口，复跑 `tools/mouse-dispatch-probe.sh`）——「窗口外按下的
 * 第二个键，按下与松手 Java 一条都收不到」，同一轮里拖回窗口内再按右键读到
 * `PRESSED btn=3 src=start.StartPanel`，所以那个「零」不是探针瞎了。⚠️ 那是在**标题页**上量的，
 * 这四块宿主**没有各自复量过**：「事件到不到得了这个窗口」由操作系统按窗口定、与当前显示哪一块
 * 面板无关 —— 这一句是推理，不是读数。
 *
 * 起 grab 那只键不受影响：`isMouseGrab` 把本键异或**回去**，读的是按下之前的状态，最后一只键
 * 松开时它仍为真、目标不重设（实测两种松手顺序下它都是 `src=start.StartPanel`）。
 */
describe('App 的 mouse grab：舞台外按下的第二个键（xl-df1）', () => {
  const FULL = { left: 0, top: 0, width: 1024, height: 640 }
  /** 舞台里、宿主外的一处落点（overlay 盖着的地方）；舞台外的那一处在 x=1100，舞台宽 1024。 */
  const IN_STAGE_OFF_HOST = { clientX: 500, clientY: 300 }
  const OUTSIDE_STAGE = { clientX: 1100, clientY: 20 }
  const HOSTS = [
    ['战斗画布', 'battle', 'battle-host', battleMouse],
    ['存读档面板', 'ls', 'ls-host', lsInput],
    ['菜单', 'menu', 'menu-host', menuInput],
    ['店', 'shop', 'shop-host', shopInput],
  ] as const

  const startGrab = (p: Panel, host: string) => {
    panel.current = p
    render(<App />)
    const el = screen.getByTestId(host)
    stubBox(el, FULL)
    fireEvent.mouseDown(el, { clientX: 20, clientY: 20, button: 0, buttons: 1 })
    return el
  }

  for (const [name, p, host, spy] of HOSTS) {
    it(`${name}：舞台外按下右键 —— 按下与它的松手都不送，起 grab 那只键的松手照送（先松舞台外那只）`, () => {
      startGrab(p, host)
      fireEvent.mouseDown(document.body, { ...OUTSIDE_STAGE, button: 2, buttons: 3 })
      fireEvent.mouseUp(window, { clientX: 1200, clientY: 30, button: 2, buttons: 1 })
      fireEvent.mouseUp(window, { clientX: 40, clientY: 40, button: 0, buttons: 0 })
      expect(spy.mock.calls.map(([i]) => i)).toEqual([
        { e: 'press', x: 20, y: 20 },
        { e: 'release', x: 40, y: 40 },
      ])
    })

    it(`${name}：先松起 grab 那只键、再松舞台外那只 —— 后者一下都不送，grab 照样解除`, () => {
      const el = startGrab(p, host)
      fireEvent.mouseDown(document.body, { ...OUTSIDE_STAGE, button: 2, buttons: 3 })
      fireEvent.mouseUp(window, { clientX: 50, clientY: 60, button: 0, buttons: 2 })
      fireEvent.mouseUp(window, { clientX: 70, clientY: 80, button: 2, buttons: 0 })
      // grab 解除了：宿主外的拖动不再归它（没解除的话这一下会是一条 drag / move）。
      fireEvent.mouseMove(document.body, { clientX: 1100, clientY: 90, buttons: 1 })
      expect(spy.mock.calls.map(([i]) => i)).toEqual([
        { e: 'press', x: 20, y: 20 },
        { e: 'release', x: 50, y: 60 },
      ])
      expect(el).not.toHaveAttribute('hidden')
    })

    it(`${name}：舞台外那只键的松手丢在窗口外 —— 回来头一下没按键的移动不补它`, () => {
      startGrab(p, host)
      fireEvent.mouseDown(document.body, { ...OUTSIDE_STAGE, button: 2, buttons: 3 })
      fireEvent.mouseUp(window, { clientX: 50, clientY: 60, button: 0, buttons: 2 })
      // 右键在窗口外松开，这里一个事件都没有；回来头一下没按键的移动。
      fireEvent.mouseMove(document.body, { clientX: 200, clientY: 210, buttons: 0 })
      expect(spy.mock.calls.map(([i]) => i.e)).toEqual(['press', 'release'])
    })

    it(`${name}：对照 —— 第二个键按在舞台里、宿主外，按下与松手都照送`, () => {
      startGrab(p, host)
      fireEvent.mouseDown(document.body, { ...IN_STAGE_OFF_HOST, button: 2, buttons: 3 })
      fireEvent.mouseUp(window, { clientX: 600, clientY: 400, button: 2, buttons: 1 })
      fireEvent.mouseUp(window, { clientX: 30, clientY: 30, button: 0, buttons: 0 })
      expect(spy.mock.calls.map(([i]) => i)).toEqual([
        { e: 'press', x: 20, y: 20 },
        { e: 'press', x: 500, y: 300 },
        { e: 'release', x: 600, y: 400 },
        { e: 'release', x: 30, y: 30 },
      ])
    })

    it(`${name}：对照 —— 舞台里按下的第二个键，松手丢在窗口外，回来头一下移动补得上`, () => {
      startGrab(p, host)
      fireEvent.mouseDown(document.body, { ...IN_STAGE_OFF_HOST, button: 2, buttons: 3 })
      fireEvent.mouseUp(window, { clientX: 50, clientY: 60, button: 0, buttons: 2 })
      fireEvent.mouseMove(document.body, { clientX: 200, clientY: 210, buttons: 0 })
      expect(spy.mock.calls.map(([i]) => i.e)).toEqual(['press', 'press', 'release', 'release'])
    })
  }

  /**
   * 边界：舞台的右下角**不含**外接矩形那一线（`clientX < box.right`）。挨着的两下，
   * 一下在里一下在外 —— 上面那几条用的 x=500 与 x=1100 离边界都很远，只有这一条能说
   * 「界划在哪儿」。
   */
  it('边界：x=1023 算舞台里、x=1024 算舞台外', () => {
    startGrab('battle', 'battle-host')
    fireEvent.mouseDown(document.body, { clientX: 1023, clientY: 300, button: 2, buttons: 3 })
    fireEvent.mouseUp(window, { clientX: 1023, clientY: 300, button: 2, buttons: 1 })
    fireEvent.mouseDown(document.body, { clientX: 1024, clientY: 300, button: 1, buttons: 5 })
    fireEvent.mouseUp(window, { clientX: 1024, clientY: 300, button: 1, buttons: 1 })
    fireEvent.mouseUp(window, { clientX: 10, clientY: 10, button: 0, buttons: 0 })
    expect(battleMouse.mock.calls.map(([i]) => i)).toEqual([
      { e: 'press', x: 20, y: 20 },
      { e: 'press', x: 1023, y: 300 },
      { e: 'release', x: 1023, y: 300 },
      { e: 'release', x: 10, y: 10 },
    ])
  })

  /**
   * 舞台外按下的那一下**不占 `useGame.routeByGrab` 的计数**：那一层按「送了几次按下就等
   * 几次松手」数（`grab.held`），这里多送一次按下、少送一次松手，它的 grab 就永远解除不了。
   * 判据是下一次干净的点击照样送得出来 —— 上面那一层还卡着的话，这一下会被当成和弦。
   */
  it('舞台外按下的那一下不入按下 / 松手的账：下一次干净的点击照常', () => {
    const el = startGrab('battle', 'battle-host')
    fireEvent.mouseDown(document.body, { ...OUTSIDE_STAGE, button: 2, buttons: 3 })
    fireEvent.mouseUp(window, { clientX: 1200, clientY: 30, button: 2, buttons: 1 })
    fireEvent.mouseUp(window, { clientX: 40, clientY: 40, button: 0, buttons: 0 })
    battleMouse.mockClear()
    fireEvent.mouseDown(el, { clientX: 70, clientY: 80, button: 0, buttons: 1 })
    fireEvent.mouseUp(window, { clientX: 70, clientY: 80, button: 0, buttons: 0 })
    expect(battleMouse.mock.calls.map(([i]) => i)).toEqual([
      { e: 'press', x: 70, y: 80 },
      { e: 'release', x: 70, y: 80 },
    ])
  })
})
