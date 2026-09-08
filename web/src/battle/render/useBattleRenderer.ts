import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { createBattleRenderer } from './battleRenderer'
import type { BattleRenderer } from './battleRenderer'

/**
 * 把战斗渲染器挂进它自己那个宿主（xl-rh9.17）。
 *
 * 与 `scene/useSceneRenderer.ts` 同构，少一半：战斗渲染器没有"换场景"那一步
 * （每一场的贴图由 `useGame` 在起战斗那一拍 `load()`），所以这里只管建与拆。
 *
 * **宿主必须与场景那张分开**。两个 Pixi `Application` 塞进同一个 div 会让
 * 两张 canvas 上下摞着，取图页那一侧实测过（`replay/main.ts` 的 `hostFor`）。
 */
export function useBattleRenderer(hostRef: RefObject<HTMLElement | null>): BattleRenderer | null {
  const [renderer, setRenderer] = useState<BattleRenderer | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let created: BattleRenderer | null = null
    createBattleRenderer(host).then(
      (r) => {
        if (disposed) {
          r.destroy()
          return
        }
        created = r
        setRenderer(r)
      },
      // 战斗渲染器起不来不该让整个游戏白屏：场景照样能走，进了战斗才是黑的。
      // 消息进控制台 —— 这一层没有显示错误的地方（舞台那条提示归场景那一侧）。
      (error: unknown) => {
        console.error('战斗渲染器起不来：', error)
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
