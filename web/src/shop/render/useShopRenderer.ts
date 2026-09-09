import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { createShopRenderer } from './shopRenderer'
import type { ShopRenderer } from './shopRenderer'

/**
 * 把商店渲染器挂进它自己那个宿主。与 `menu/render/useMenuRenderer.ts` 同构 ——
 * **宿主必须与场景 / 战斗 / 菜单那三张分开**：两个 Pixi `Application` 塞进
 * 同一个 div 会让两张 canvas 上下摞着。
 */
export function useShopRenderer(hostRef: RefObject<HTMLElement | null>): ShopRenderer | null {
  const [renderer, setRenderer] = useState<ShopRenderer | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let created: ShopRenderer | null = null
    createShopRenderer(host).then(
      (r) => {
        if (disposed) {
          r.destroy()
          return
        }
        created = r
        setRenderer(r)
      },
      // 商店渲染器起不来不该让整个游戏白屏：场景照样能走，进店才是黑的。
      (error: unknown) => {
        console.error('商店渲染器起不来：', error)
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
