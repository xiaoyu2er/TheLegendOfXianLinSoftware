import { useEffect, useRef } from 'react'
import { getScene } from '../data/scenes'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { advance, createTicker } from '../state/loop'
import type { Ticker } from '../state/loop'
import { TICK_MS, createWorld } from '../state/step'
import type { InputEvent } from '../state/types'
import { toInputEvent } from './keyboard'

/**
 * 把状态层接到键盘与渲染器上。**这里没有一行游戏逻辑**——它只做三件事：
 * 收键、按真实流逝的时间推进、把结果交给渲染器画。
 *
 * ## 为什么是 setInterval 而不是 requestAnimationFrame
 *
 * rAF 在标签页不可见时**完全不触发**。用它驱动状态推进，切后台游戏就冻住，
 * 切回来要么继续冻着、要么一口气补跑几百帧——原版把状态推进挂在绘制上，
 * 到了浏览器里就是这个形态，这一票的规格里点名要避开它。
 *
 * `setInterval` 在后台会被节流到 ~1 秒一次，但**它照样触发**，而流逝的时间是
 * 从 `performance.now()` 现算的，所以每次醒来补的是那 ~1 秒（约 100 个 tick，
 * 都是纯函数，成本可以忽略），而不是攒够几分钟再一次性爆发。前台后台跑出来
 * 的世界完全一样，这条由 `state/loop.test.ts` 钉住。
 *
 * 画面另说：Pixi 有自己的渲染循环，后台不可见时它自然不画。这正是"状态推进
 * 与渲染解耦"的意义——不画不等于不动。
 */
export function useGame(renderer: SceneRenderer | null, sceneName: string): void {
  const tickerRef = useRef<Ticker | null>(null)
  const queueRef = useRef<InputEvent[]>([])

  // 换场景 = 换一个世界。主角回到脚本里的出生格。
  useEffect(() => {
    tickerRef.current = createTicker(createWorld(getScene(sceneName)))
    queueRef.current = []
  }, [sceneName])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const input = toInputEvent({
        type: event.type === 'keydown' ? 'keydown' : 'keyup',
        key: event.key,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
      })
      if (!input) return
      // 方向键默认会滚动页面。认下来的键就得拦住，否则一边走一边页面在动。
      event.preventDefault()
      queueRef.current.push(input)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])

  useEffect(() => {
    if (!renderer) return
    let last = performance.now()
    const pump = () => {
      const ticker = tickerRef.current
      if (!ticker) return
      const now = performance.now()
      const elapsed = now - last
      last = now
      const input = queueRef.current
      queueRef.current = []
      const next = advance(ticker, input, elapsed)
      tickerRef.current = next
      renderer.showRole(next.world.role)
    }
    const id = window.setInterval(pump, TICK_MS)
    return () => window.clearInterval(id)
  }, [renderer])
}
