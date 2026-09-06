import { TICK_MS, step } from './step'
import type { InputEvent, World } from './types'

/**
 * 定步长推进器：把"过去了多少真实毫秒"换成"跑几个 tick"。
 *
 * 为什么不直接按帧推进：那样游戏速度会跟显示器刷新率绑死，而且标签页切后台
 * 时逐帧回调停摆，回来要么冻住要么补跑几百帧——正是这一票要避免的那件事。
 * 这里时间是入参，`step()` 是纯的，于是"谁在驱动、驱动得快不快"跟世界怎么
 * 演化彻底无关：**同样的总时长、同样的输入，切成几段喂进来结果都一样**
 * （`loop.test.ts` 把这条钉住了，它就是"切后台再切回，行为与全程前台一致"
 * 这条验收标准的可执行形式）。
 */
export interface Ticker {
  readonly world: World
  /** 上次没凑够一个 tick 的余量，攒着，不丢。 */
  readonly carryMs: number
  /** 还没有 tick 可以承载的输入。攒着，不丢——见下面的说明。 */
  readonly pending: readonly InputEvent[]
}

export function createTicker(world: World): Ticker {
  return { world, carryMs: 0, pending: [] }
}

/**
 * 推进 `elapsedMs` 真实毫秒。
 *
 * 输入落在这一批的**第一个** tick 上（原版一个 tick 里就是"输入 → 定时器"）。
 * 如果这一批一个 tick 都跑不满（`elapsedMs` 不到 10 ms，高刷屏上很常见），
 * 输入不能就地丢掉，也不能立刻施加——攒进 `pending`，等下一个 tick。
 * 丢掉的表现是"偶尔按一下没反应"，是最难复现的那种。
 *
 * `elapsedMs` 为负（时钟被调过）按 0 处理：宁可停一帧，不可倒着走。
 */
export function advance(
  ticker: Ticker,
  arriving: readonly InputEvent[],
  elapsedMs: number,
): Ticker {
  const queue = arriving.length === 0 ? ticker.pending : [...ticker.pending, ...arriving]
  const budget = ticker.carryMs + Math.max(0, elapsedMs)
  const ticks = Math.floor(budget / TICK_MS)
  if (ticks === 0) {
    return { world: ticker.world, carryMs: budget, pending: queue }
  }

  let world = ticker.world
  for (let i = 0; i < ticks; i++) {
    world = step(world, i === 0 ? queue : EMPTY, TICK_MS)
  }
  return { world, carryMs: budget - ticks * TICK_MS, pending: [] }
}

const EMPTY: readonly InputEvent[] = []
