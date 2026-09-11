import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { createEndRenderer } from './endRenderer'
import type { EndRenderer } from './endRenderer'

/**
 * 把结局面板渲染器挂进它自己那个宿主（xl-czb.6）。与存读档 / 商店 / 菜单同构 ——
 * 宿主必须与别的画布分开，两个 Pixi `Application` 塞进同一个 div 会上下摞着。
 */
export function useEndRenderer(hostRef: RefObject<HTMLElement | null>): EndRenderer | null {
  const [renderer, setRenderer] = useState<EndRenderer | null>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let created: EndRenderer | null = null
    createEndRenderer(host).then(
      (r) => {
        if (disposed) {
          r.destroy()
          return
        }
        created = r
        setRenderer(r)
      },
      // 起不来不该让整个游戏白屏：场景照样能走，进结局才是黑的。
      (error: unknown) => console.error('结局面板渲染器起不来：', error),
    )
    return () => {
      disposed = true
      created?.destroy()
      setRenderer(null)
    }
  }, [hostRef])
  return renderer
}
