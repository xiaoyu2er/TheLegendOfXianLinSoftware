import { useEffect, useRef, useState } from 'react'
import { ANIMATION_INTERVAL_MS } from '../layout'
import { PREVIEW_CONFIG, previewFrame } from '../preview'
import type { ShopPreviewChoice } from '../preview'
import { stepShop } from '../step'
import type { ShopInput } from '../step'
import { createShopWorld } from '../world'
import type { ShopWorld } from '../types'
import { shopTextureIds } from './assets'
import { shopDrawList } from './drawList'
import type { ShopRenderer } from './shopRenderer'

/**
 * 把**开发用的商店预览**接到渲染器上（xl-knp.6）。
 *
 * ⚠️ 这不是进店的正路 —— 见 `shop/preview.ts` 的头注（正路归 xl-yg6.2）。
 *
 * 这个 hook 整个泡在 React 与 Pixi 里，进不了 `pnpm test`，所以它**不做决定**：
 * 帧号怎么数在 `preview.ts`、画什么在 `render/drawList.ts`、载入名单在
 * `render/assets.ts`，三处都是纯的、都有判据。这里只剩"起个计时器、把清单
 * 交给渲染器"。
 */
export interface ShopPreview {
  /** 正在载纹理。载完之前不画 —— 画了会撞渲染器那句"没有载入它"。 */
  readonly loading: boolean
  /** 送一次鼠标事件进去。`none` 时是空操作。 */
  readonly input: (input: ShopInput) => void
}

export function useShopPreview(
  renderer: ShopRenderer | null,
  choice: ShopPreviewChoice,
): ShopPreview {
  const worldRef = useRef<ShopWorld | null>(null)
  const [loading, setLoading] = useState(false)
  /** 换店 / 换渲染器都要重来一遍，用它把上一轮的异步结果作废。 */
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    const mine = generation.current
    if (!renderer || choice === 'none') {
      worldRef.current = null
      setLoading(false)
      return
    }
    const world = createShopWorld(PREVIEW_CONFIG)
    world.active = choice
    worldRef.current = world
    setLoading(true)
    let timer: ReturnType<typeof setInterval> | null = null
    const started = Date.now()
    renderer.load(shopTextureIds(world)).then(
      () => {
        if (generation.current !== mine) return
        setLoading(false)
        const paint = () => {
          const w = worldRef.current
          if (generation.current !== mine || !w) return
          renderer.draw(shopDrawList(w, previewFrame(Date.now() - started)))
        }
        paint()
        timer = setInterval(paint, ANIMATION_INTERVAL_MS)
      },
      (error: unknown) => {
        if (generation.current !== mine) return
        setLoading(false)
        // 预览起不来不该让整个游戏白屏 —— 与 `useShopRenderer` 同一个规矩。
        console.error('商店预览载不出素材：', error)
      },
    )
    return () => {
      generation.current += 1
      if (timer !== null) clearInterval(timer)
    }
  }, [renderer, choice])

  return {
    loading,
    input: (input: ShopInput) => {
      const w = worldRef.current
      if (!w || !renderer) return
      stepShop(w, [input])
      // 切分类会换掉整批按钮，新那一栏的商品图也得先载上。
      renderer.load(shopTextureIds(w)).then(
        () => {
          if (worldRef.current === w) renderer.draw(shopDrawList(w, previewFrame(0)))
        },
        (error: unknown) => console.error('商店预览载不出素材：', error),
      )
    },
  }
}
