import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GameView } from '../game/useGame'
import type { ShopInput } from '../shop/step'

/**
 * App 那一侧的**商店预览**接线（xl-knp.6）。
 *
 * ⚠️ 预览不是进店的正路（正路是选择框的门，xl-yg6.11，见文件末尾那一组），但它是"两个店的骨架画得出来"
 * 这句话在浏览器里唯一的落点，所以它自己也要有判据。
 *
 * 这一截的错法都长得像"手感不对"而不是"报错了"：
 *
 * - 商店那张画布藏着 → 选了店却一片黑，而选择器上写着「药店」；
 * - 只送 `press` 不送 `release` → 按钮永远停在「按下」那张贴图上；
 * - 不送 `move` → 图标框一行都选不中（那整个走 `mouseMoved`）；
 * - 选了店却没把场景那张藏起来 → 两张画布上下摞着。
 *
 * `useGame` 与预览 hook 都是假的，理由与 `appMenu.test.tsx` 同：jsdom 里
 * 建不出 Pixi，`useShopRenderer` 永远是 `null`，真的 hook 一条 op 都画不出来。
 */
const shopInput = vi.fn<(input: ShopInput) => void>()
const loading = { current: false }
/** 游戏那一侧（从选择框的门真进店，xl-yg6.11）：面板、店里的鼠标、载入中。 */
const game = {
  panel: 'scene' as GameView['panel'],
  shopLoading: false,
  shopInput: vi.fn<(input: ShopInput) => void>(),
}

vi.mock('../game/useGame', () => ({
  useGame: (): GameView => ({
    dialogue: null,
    panel: game.panel,
    battleLoading: false,
    menuLoading: false,
    menuInput: () => {},
    shopInput: game.shopInput,
    shopLoading: game.shopLoading,
    click: () => {},
    scene: null,
    restart: () => {},
  }),
}))

vi.mock('../shop/render/useShopPreview', () => ({
  useShopPreview: () => ({ loading: loading.current, input: shopInput }),
}))

const { App } = await import('./App')

beforeEach(() => {
  shopInput.mockClear()
  loading.current = false
  game.panel = 'scene'
  game.shopLoading = false
  game.shopInput.mockClear()
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

/** 开发用选择器上选一家店。 */
function choose(label: string): HTMLElement {
  const select = screen.getByLabelText('商店')
  fireEvent.change(select, { target: { value: label } })
  return select
}

describe('App 与商店预览', () => {
  it('默认「不看」：商店那张画布藏着，场景那张露着', () => {
    render(<App />)
    expect(screen.getByTestId('shop-host')).toHaveAttribute('hidden')
    expect(screen.getByTestId('scene-host')).not.toHaveAttribute('hidden')
  })

  it('选了药店：商店那张露出来，别的三张全藏起来', () => {
    render(<App />)
    choose('drug')
    expect(screen.getByTestId('shop-host')).not.toHaveAttribute('hidden')
    for (const id of ['scene-host', 'battle-host', 'menu-host']) {
      expect(screen.getByTestId(id), id).toHaveAttribute('hidden')
    }
  })

  it('两家店都选得到', () => {
    render(<App />)
    choose('equipment')
    expect(screen.getByTestId('shop-host')).not.toHaveAttribute('hidden')
    choose('none')
    expect(screen.getByTestId('shop-host')).toHaveAttribute('hidden')
  })

  it('按下 / 松开 / 移动**三种都送**，坐标换算回 1024×640', () => {
    render(<App />)
    choose('drug')
    const host = screen.getByTestId('shop-host')
    stubBox(host, { left: 100, top: 50, width: 512, height: 320 })

    fireEvent.mouseDown(host, { clientX: 100 + 256, clientY: 50 + 160 })
    fireEvent.mouseUp(host, { clientX: 100 + 256, clientY: 50 + 160 })
    fireEvent.mouseMove(host, { clientX: 100 + 128, clientY: 50 + 80 })

    expect(shopInput.mock.calls.map(([i]) => i)).toEqual([
      { e: 'press', x: 512, y: 320 },
      { e: 'release', x: 512, y: 320 },
      { e: 'move', x: 256, y: 160 },
    ])
  })

  it('没选店的时候一条都不送', () => {
    render(<App />)
    const host = screen.getByTestId('shop-host')
    stubBox(host, { left: 0, top: 0, width: 1024, height: 640 })
    fireEvent.mouseDown(host, { clientX: 10, clientY: 10 })
    expect(shopInput).not.toHaveBeenCalled()
  })

  it('正在载素材时有一句提示 —— 空白与"载不出来"分不开', () => {
    loading.current = true
    render(<App />)
    choose('drug')
    expect(screen.getByRole('status')).toHaveTextContent('正在载入商店…')
  })
})

/**
 * **进店的正路**（xl-yg6.11）：场景里选择框选「是」，会话把面板翻成 `shop`。
 * 这一截的错法与预览同型 —— 画布藏着、鼠标没送进去、送错了主人 —— 都长得像
 * "进了店却点不动"，而状态层那边的判据全绿。
 */
describe('App 与从门里进的店', () => {
  it('会话翻到 shop：商店那张露出来，场景那张藏起来，对话框也不画', () => {
    game.panel = 'shop'
    render(<App />)
    expect(screen.getByTestId('shop-host')).not.toHaveAttribute('hidden')
    for (const id of ['scene-host', 'battle-host', 'menu-host']) {
      expect(screen.getByTestId(id), id).toHaveAttribute('hidden')
    }
  })

  it('鼠标三种都送给**游戏**，不送给预览', () => {
    game.panel = 'shop'
    render(<App />)
    const host = screen.getByTestId('shop-host')
    stubBox(host, { left: 0, top: 0, width: 1024, height: 640 })
    fireEvent.mouseDown(host, { clientX: 880, clientY: 30 })
    fireEvent.mouseUp(host, { clientX: 880, clientY: 30 })
    fireEvent.mouseMove(host, { clientX: 600, clientY: 190 })
    expect(game.shopInput.mock.calls.map(([i]) => i)).toEqual([
      { e: 'press', x: 880, y: 30 },
      { e: 'release', x: 880, y: 30 },
      { e: 'move', x: 600, y: 190 },
    ])
    expect(shopInput).not.toHaveBeenCalled()
  })

  it('不在店里时一条都不送给游戏', () => {
    render(<App />)
    const host = screen.getByTestId('shop-host')
    stubBox(host, { left: 0, top: 0, width: 1024, height: 640 })
    fireEvent.mouseDown(host, { clientX: 10, clientY: 10 })
    expect(game.shopInput).not.toHaveBeenCalled()
  })

  it('游戏那一侧的店在载素材时也有那句提示', () => {
    game.panel = 'shop'
    game.shopLoading = true
    render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('正在载入商店…')
  })
})
