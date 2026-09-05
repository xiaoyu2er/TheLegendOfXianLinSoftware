import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'

export interface FullscreenControls {
  /** 浏览器是否支持全屏 API；不支持时按钮应当禁用而不是点了没反应 */
  supported: boolean
  isFullscreen: boolean
  toggle: () => void
}

export function useFullscreen(ref: RefObject<HTMLElement | null>): FullscreenControls {
  const [isFullscreen, setIsFullscreen] = useState(false)

  const supported =
    typeof document !== 'undefined' && Boolean(document.fullscreenEnabled)

  useEffect(() => {
    // 用户按 Esc 退出全屏时不经过我们的按钮，只能靠这个事件同步状态。
    const sync = () => setIsFullscreen(document.fullscreenElement !== null)
    sync()
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const toggle = useCallback(() => {
    const element = ref.current
    if (!element) return
    // requestFullscreen / exitFullscreen 返回的 Promise 在被浏览器拒绝时会
    // reject（例如非用户手势触发）。这里吞掉：全屏失败不该炸掉游戏。
    if (document.fullscreenElement === null) {
      void element.requestFullscreen?.().catch(() => {})
    } else {
      void document.exitFullscreen?.().catch(() => {})
    }
  }, [ref])

  return { supported, isFullscreen, toggle }
}
