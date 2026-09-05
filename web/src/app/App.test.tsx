import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from './App'

/**
 * jsdom 根本没有 `document.fullscreenEnabled` / `fullscreenElement` 这两个属性
 * （不是值为 false —— 是不存在，`vi.spyOn` 会直接抛 "does not exist"），
 * 所以只能自己定义上去，并在每个用例后撤掉。
 */
function stubFullscreen(props: {
  enabled?: boolean
  element?: Element | null
}): () => void {
  const keys: string[] = []
  const define = (key: string, value: unknown) => {
    Object.defineProperty(document, key, { value, configurable: true })
    keys.push(key)
  }
  if (props.enabled !== undefined) define('fullscreenEnabled', props.enabled)
  if (props.element !== undefined) define('fullscreenElement', props.element)
  return () => {
    for (const key of keys) {
      delete (document as unknown as Record<string, unknown>)[key]
    }
  }
}

const restores: Array<() => void> = []
afterEach(() => {
  cleanup()
  while (restores.length) restores.pop()!()
  vi.restoreAllMocks()
})

describe('App', () => {
  it('默认用平滑放大，点一下切到锐利，再点切回来', () => {
    render(<App />)
    const canvas = document.querySelector('canvas')
    expect(canvas).not.toBeNull()

    expect(canvas!.style.imageRendering).toBe('auto')
    const button = screen.getByRole('button', { name: /放大/ })
    expect(button.textContent).toContain('平滑')

    fireEvent.click(button)
    expect(canvas!.style.imageRendering).toBe('pixelated')
    expect(button.textContent).toContain('锐利')

    fireEvent.click(button)
    expect(canvas!.style.imageRendering).toBe('auto')
  })

  it('canvas 位图恒为 1024×640', () => {
    render(<App />)
    const canvas = document.querySelector('canvas')!
    expect(canvas.width).toBe(1024)
    expect(canvas.height).toBe(640)
  })

  it('点全屏调用 requestFullscreen，进入后再点调用 exitFullscreen', () => {
    const requestFullscreen = vi.fn(() => Promise.resolve())
    const exitFullscreen = vi.fn(() => Promise.resolve())
    restores.push(stubFullscreen({ enabled: true, element: null }))
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      value: requestFullscreen,
      configurable: true,
    })
    Object.defineProperty(document, 'exitFullscreen', {
      value: exitFullscreen,
      configurable: true,
    })
    restores.push(() => {
      delete (Element.prototype as unknown as Record<string, unknown>)
        .requestFullscreen
      delete (document as unknown as Record<string, unknown>).exitFullscreen
    })

    render(<App />)
    const button = screen.getByRole('button', { name: /全屏/ })
    expect(button).not.toBeDisabled()

    fireEvent.click(button)
    expect(requestFullscreen).toHaveBeenCalledTimes(1)

    // 浏览器进入全屏后会置 fullscreenElement 并派发 fullscreenchange
    const host = document.querySelector('.app-shell') as HTMLElement
    restores.push(stubFullscreen({ element: host }))
    fireEvent(document, new Event('fullscreenchange'))
    expect(button.textContent).toContain('退出全屏')

    fireEvent.click(button)
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
  })

  it('工具栏在全屏目标元素内部——否则全屏后按钮消失，只能按 Esc 退出', () => {
    render(<App />)
    const shell = document.querySelector('.app-shell')!
    const toolbar = document.querySelector('.toolbar')!
    expect(shell.contains(toolbar)).toBe(true)
  })

  it('浏览器不支持全屏时按钮禁用', () => {
    restores.push(stubFullscreen({ enabled: false }))
    render(<App />)
    expect(screen.getByRole('button', { name: /全屏/ })).toBeDisabled()
  })
})
