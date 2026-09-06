import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { loadScene } from '../data/scenes'
import { createSceneRenderer } from './sceneRenderer'
import type { SceneRenderer } from './sceneRenderer'

export type SceneStatus =
  | { kind: 'loading' }
  | { kind: 'ready' }
  /** 渲染器起不来或者场景画不出来。消息是给人看的，直接显示在舞台上。 */
  | { kind: 'failed'; message: string }

/**
 * 把 Pixi 渲染器挂进舞台，并在场景切换时换图。
 *
 * `hostRef` 是一个空容器，canvas 由渲染器自己建、自己摘（理由见
 * `sceneRenderer.ts`：canvas 复用会挂住主线程）。
 *
 * init 是异步的，而 React 19 的 StrictMode 会把 effect 跑两遍：不管
 * `disposed` 就会留下一个孤儿 Application 继续画，表现为开发模式下画面
 * 闪烁而生产模式正常 —— 最难查的那类差异。
 */
/**
 * 渲染器就绪之后，调用方（`useGame`）要拿它来画主角，所以这里除了状态还要把
 * 渲染器本身交出去。场景还没画完时 `renderer` 为 `null`。
 */
export interface SceneRendering {
  readonly status: SceneStatus
  readonly renderer: SceneRenderer | null
}

export function useSceneRenderer(
  hostRef: RefObject<HTMLElement | null>,
  sceneName: string,
): SceneRendering {
  const [renderer, setRenderer] = useState<SceneRenderer | null>(null)
  const [status, setStatus] = useState<SceneStatus>({ kind: 'loading' })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let created: SceneRenderer | null = null

    createSceneRenderer(host).then(
      (r) => {
        if (disposed) {
          r.destroy()
          return
        }
        created = r
        setRenderer(r)
      },
      (error: unknown) => {
        if (!disposed) setStatus({ kind: 'failed', message: describe(error) })
      },
    )

    return () => {
      disposed = true
      created?.destroy()
      setRenderer(null)
    }
  }, [hostRef])

  useEffect(() => {
    if (!renderer) return
    let disposed = false
    setStatus({ kind: 'loading' })
    // 取场景本身也是异步的（按需加载，见 `data/scenes.ts`）：它和贴图一样
    // 属于"载入"，失败也一样要显示在舞台上，所以接在同一条链上。
    loadScene(sceneName)
      .then((scene) => renderer.showScene(scene))
      .then(
        () => {
          if (!disposed) setStatus({ kind: 'ready' })
        },
        (error: unknown) => {
          if (!disposed) setStatus({ kind: 'failed', message: describe(error) })
        },
      )
    return () => {
      disposed = true
    }
  }, [renderer, sceneName])

  return { status, renderer }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
