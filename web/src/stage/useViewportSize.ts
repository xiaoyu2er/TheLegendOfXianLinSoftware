import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { Viewport } from './computeStageScale'

const EMPTY: Viewport = { width: 0, height: 0 }

/**
 * 观察一个元素的 CSS 尺寸。
 *
 * 优先用 ResizeObserver —— 它在**元素**尺寸变化时触发，包括那些不伴随
 * window resize 的情况（全屏切换、侧边栏展开、地址栏收起）。jsdom 与老浏览器
 * 没有它，退回监听 window resize：不如前者灵敏，但不会静默地一直返回 0。
 */
export function useViewportSize(ref: RefObject<HTMLElement | null>): Viewport {
  const [size, setSize] = useState<Viewport>(EMPTY)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const measure = () => {
      const rect = element.getBoundingClientRect()
      setSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      )
    }

    measure()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(element)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [ref])

  return size
}
