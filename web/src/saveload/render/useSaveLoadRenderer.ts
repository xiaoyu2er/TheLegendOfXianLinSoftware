import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { createSaveLoadRenderer } from './saveLoadRenderer'
import type { SaveLoadRenderer } from './saveLoadRenderer'

/**
 * 把存读档面板渲染器挂进它自己那个宿主（xl-i06.9）。与商店 / 菜单同构 ——
 * 宿主必须与别的画布分开，两个 Pixi `Application` 塞进同一个 div 会上下摞着。
 */
export function useSaveLoadRenderer(hostRef: RefObject<HTMLElement | null>): SaveLoadRenderer | null {
  const [renderer, setRenderer] = useState<SaveLoadRenderer | null>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let created: SaveLoadRenderer | null = null
    createSaveLoadRenderer(host).then(
      (r) => {
        if (disposed) {
          r.destroy()
          return
        }
        created = r
        setRenderer(r)
      },
      // 起不来不该让整个游戏白屏：场景照样能走，进存读档面板才是黑的。
      (error: unknown) => console.error('存读档面板渲染器起不来：', error),
    )
    return () => {
      disposed = true
      created?.destroy()
      setRenderer(null)
    }
  }, [hostRef])
  return renderer
}
