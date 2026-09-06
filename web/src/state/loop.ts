import { TICK_MS, step } from './step'
import type { SceneSource } from './step'
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
  /**
   * 时间加速倍率。`2` 表示一秒真实时间推进两秒游戏时间，`1` 是恒等。
   *
   * 它是 Java 侧 `tools.Clock.factor` 的对应物：原版把 30 处时间常数收拢进
   * `Clock`，Web 侧因为"时间是 `step()` 的入参"根本不需要收拢——**乘在真实
   * 流逝的毫秒上就够了**，这是状态推进与渲染解耦白拿的第二个好处
   * （见 `docs/MIGRATION-PLAN.md` §4）。
   *
   * 加速只改"真实毫秒 → 虚拟毫秒"这一步的换算，不改 tick 步长：世界仍然是
   * 一个 10 ms 一个 tick 地走的，所以**加速后跑出来的世界与 1× 跑同样长的
   * 游戏时间逐字段相同**。把步长乘上倍率就不是这样了——那会跳过定时器的
   * 触发时刻，主角走的距离对不上真值（`step.ts` 里 `TICK_MS` 那段说过为什么）。
   */
  readonly timeScale: number
}

export function createTicker(world: World, timeScale = 1): Ticker {
  if (!(timeScale > 0)) throw new Error(`时间倍率必须为正，收到 ${timeScale}`)
  return { world, carryMs: 0, pending: [], timeScale }
}

/** 换一个倍率，世界与攒着的余量/输入都不动。 */
export function withTimeScale(ticker: Ticker, timeScale: number): Ticker {
  if (!(timeScale > 0)) throw new Error(`时间倍率必须为正，收到 ${timeScale}`)
  return { ...ticker, timeScale }
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
 *
 * `scenes` 原样递给 `step()`：走到出口要换场景，而换场景的数据只能同步取
 * （见 `state/step.ts` 的 `SceneSource`）。不传就等于"这一局不会走出门"，
 * 真踩到出口时 `step()` 会抛。
 */
export function advance(
  ticker: Ticker,
  arriving: readonly InputEvent[],
  elapsedMs: number,
  scenes?: SceneSource,
): Ticker {
  const queue = arriving.length === 0 ? ticker.pending : [...ticker.pending, ...arriving]
  const budget = ticker.carryMs + Math.max(0, elapsedMs) * ticker.timeScale
  const ticks = Math.floor(budget / TICK_MS)
  if (ticks === 0) {
    return { ...ticker, carryMs: budget, pending: queue }
  }

  let world = ticker.world
  for (let i = 0; i < ticks; i++) {
    world = step(world, i === 0 ? queue : EMPTY, TICK_MS, scenes)
  }
  return { ...ticker, world, carryMs: budget - ticks * TICK_MS, pending: [] }
}

const EMPTY: readonly InputEvent[] = []
