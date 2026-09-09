import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { createMenuRenderer } from './menuRenderer'
import type { MenuRenderer } from './menuRenderer'

/**
 * 把菜单渲染器挂进它自己那个宿主。与 `battle/render/useBattleRenderer.ts`
 * 同构 —— **宿主必须与场景 / 战斗那两张分开**：两个 Pixi `Application` 塞进
 * 同一个 div 会让两张 canvas 上下摞着。
 */
export function useMenuRenderer(hostRef: RefObject<HTMLElement | null>): MenuRenderer | null {
  const [renderer, setRenderer] = useState<MenuRenderer | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let created: MenuRenderer | null = null
    createMenuRenderer(host).then(
      (r) => {
        if (disposed) {
          r.destroy()
          return
        }
        created = r
        setRenderer(r)
      },
      // 菜单渲染器起不来不该让整个游戏白屏：场景照样能走，按 ESC 才是黑的。
      (error: unknown) => {
        console.error('菜单渲染器起不来：', error)
      },
    )
    return () => {
      disposed = true
      created?.destroy()
      setRenderer(null)
    }
  }, [hostRef])

  return renderer
}
