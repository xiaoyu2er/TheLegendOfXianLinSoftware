import { useEffect, useRef, useState } from 'react'
import { loadScene } from '../data/scenes'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { advance, createTicker } from '../state/loop'
import type { Ticker } from '../state/loop'
import { TICK_MS, createWorld } from '../state/step'
import type { DialogueState } from '../state/dialogue'
import type { InputEvent, World } from '../state/types'
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
 *
 * ## 为什么要把对话状态交出去
 *
 * 对话框是真 DOM（`ui/DialogueBox.tsx`），要由 React 画，所以它得进 React 的
 * 状态。但**不能每个 tick 都 setState**：那是每秒 100 次重渲染，而其中绝大
 * 多数 tick 里对话根本没开着。所以只在"画出来会不一样"时才 setState，判据是
 * 一个从渲染层真正读到的字段算出来的签名（见 `dialogueSignature`）——
 * 按整个 `DialogueState` 比引用是没用的，`step()` 每 tick 都返回新对象。
 */
export function useGame(renderer: SceneRenderer | null, sceneName: string): DialogueState | null {
  const tickerRef = useRef<Ticker | null>(null)
  const queueRef = useRef<InputEvent[]>([])
  const [dialogue, setDialogue] = useState<DialogueState | null>(null)
  const signatureRef = useRef<string | null>(null)

  // 换场景 = 换一个世界。主角回到脚本里的出生格。
  //
  // 场景 JSON 是按需取的（见 `data/scenes.ts`），所以这里有一段"世界还没建好"
  // 的时间：`tickerRef` 先清空，下面的 pump 认得 `null` 并跳过这一拍。旧世界
  // 必须当场清掉——留着它，切场景的这几十毫秒里主角会在旧地图上继续走。
  useEffect(() => {
    let disposed = false
    tickerRef.current = null
    queueRef.current = []
    signatureRef.current = null
    setDialogue(null)
    void loadScene(sceneName).then((scene) => {
      if (disposed) return
      tickerRef.current = createTicker(createWorld(scene))
    })
    return () => {
      disposed = true
    }
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
      renderer.showWorld(next.world)
      const signature = dialogueSignature(next.world)
      if (signature !== signatureRef.current) {
        signatureRef.current = signature
        setDialogue(next.world.dialogue)
      }
    }
    const id = window.setInterval(pump, TICK_MS)
    return () => window.clearInterval(id)
  }, [renderer])

  return dialogue
}

/**
 * "画出来会不会不一样"的签名。
 *
 * 只包含 `DialogueBox` 真正读到的字段：开没开、什么样式、哪张头像、名字、
 * 三个滑入动画的位置、闪烁帧、以及这一屏的字符网格。整句 `sentence` 也算上
 * ——读屏用的那一行整句读它。
 *
 * **不能只拿 `cursor` 代替字符网格**：翻页会把网格清空而 `cursor` 照涨，
 * 两屏之间会有一帧签名相同、画面却该换的时刻。
 */
function dialogueSignature(world: World): string {
  const d = world.dialogue
  if (!d.speaking && !d.oral) return ''
  return [
    d.type,
    d.headNo,
    d.name,
    d.sentence,
    d.boxX,
    d.boxY,
    d.headX,
    d.nameX,
    d.iconFrame,
    d.printing,
    d.sentenceOver,
    d.pageOver,
    d.text.map((row) => row.map((c) => c ?? ' ').join('')).join('|'),
  ].join('\u0000')
}
