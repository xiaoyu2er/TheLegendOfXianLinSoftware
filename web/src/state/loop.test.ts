import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenes'
import { advance, createTicker } from './loop'
import { createWorld } from './step'
import type { InputEvent } from './types'

/**
 * 标签页切后台再切回，行为要与全程前台一致。
 *
 * 那句验收标准的可执行形式就是下面这条不变量：**同样的总时长、同样的输入，
 * 分成几段喂进来，世界一模一样**。切后台无非是"某一段特别长"，切回来无非是
 * "后面几段特别短"。
 *
 * 这条不变量为真，是因为 `step()` 是纯的、时间是入参；一旦谁把推进偷偷挂回
 * 逐帧回调（或者加个"最多补跑 N 帧"的上限），它立刻就红。
 */
describe('定步长推进器', () => {
  const scene = getScene('宿舍')
  const walkRight: InputEvent[] = [{ e: 'press', k: 'right', ctrl: false }]

  function run(chunks: readonly number[], input: readonly InputEvent[]) {
    let ticker = createTicker(createWorld(scene))
    let first = true
    for (const ms of chunks) {
      ticker = advance(ticker, first ? input : [], ms)
      first = false
    }
    return ticker
  }

  it('一口气推进 5 秒，与 500 个 10 ms 的 tick 完全一致', () => {
    expect(run([5000], walkRight).world).toEqual(run(Array(500).fill(10), walkRight).world)
  })

  it('60 Hz 的不规则帧长与一次大补跑一致（切后台就是这个形状）', () => {
    // 16.7 ms 的帧长凑不满整数个 tick，余量必须攒着；攒漏了这里就会差几格。
    const frames: number[] = []
    for (let ms = 0; ms < 5000; ms += 16.7) frames.push(16.7)
    const total = frames.reduce((a, b) => a + b, 0)
    // 前台跑一半 → 切后台 → 切回来一次补齐，总时长与全程前台相同。
    const half = Math.floor(frames.length / 2)
    const backgrounded = [
      ...frames.slice(0, half),
      frames.slice(half).reduce((a, b) => a + b, 0),
    ]
    expect(backgrounded.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 6)
    expect(run(backgrounded, walkRight).world).toEqual(run(frames, walkRight).world)
  })

  it('这份剧本确实让主角动了——否则上面两条比的是两个静止的世界', () => {
    const moved = run([5000], walkRight).world.role
    expect(moved.px).not.toBe(createWorld(scene).role.px)
  })

  it('不满一个 tick 的那一帧里按的键不会丢', () => {
    let ticker = advance(createTicker(createWorld(scene)), walkRight, 4)
    expect(ticker.world.role.walk.running).toBe(false)
    expect(ticker.pending).toHaveLength(1)
    ticker = advance(ticker, [], 6)
    expect(ticker.world.role.walk.running).toBe(true)
    expect(ticker.pending).toHaveLength(0)
  })

  it('时间倒流按 0 处理，不倒着推进', () => {
    const start = createTicker(createWorld(scene))
    expect(advance(start, [], -1000)).toEqual(start)
  })
})
