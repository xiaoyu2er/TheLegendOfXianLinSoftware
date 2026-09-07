import { advancePaintState, applyPaintInput, createPaintState } from './render/paint'
import type { PaintState } from './render/paint'
import { stepBattle } from './step'
import type { BattleInput } from './step'
import type { BattleWorld } from './types'

/**
 * 战斗的定步长推进器：把"过去了多少真实毫秒"换成"跑几拍"。
 *
 * 与场景那一侧（`state/loop.ts`）是同一套东西，只是步长不同 —— 战斗是
 * **100 ms 一拍**，原版 `BattlePanel.run()` 里那句 `Clock.sleep(100)`，
 * 行为真值把它钉死了（`tickMs` 只能是 100，见 ADR-0003）。
 *
 * ## 「切到别的标签页再切回来，战斗不补跑」
 *
 * 这条验收标准的可执行形式是一条**不变量**，不是一句描述：
 *
 * > 同样的总时长、同样的输入，**切成几段喂进来结果都一样**。
 *
 * 判据在 `loop.test.ts`。它同时挡住两种写法：
 *
 * - 用 `requestAnimationFrame` 驱动 —— 标签页不可见时它**完全不触发**，
 *   切回来那一下 `now - last` 是几十秒，于是一口气补跑几百拍。这条不变量
 *   本身对"一次大补跑"是成立的（分段与不分段等价），所以真正挡住它的是
 *   **驱动器的选择**：与 `game/useGame.ts` 一样用 `setInterval`。后台会被
 *   节流到 ~1 秒一次，但**它照样触发**，于是每次醒来补的是那 ~1 秒（约 10 拍），
 *   而不是攒够几分钟再一次性爆发。
 * - 给推进加一个"最多补跑 N 拍"的上限 —— 那会让后台跑的世界与前台不同，
 *   这条不变量立刻红。
 *
 * ## ⚠️ 这一层今天**还没有生产调用方**
 *
 * 取图页（`replay/main.ts`）走的是「照 `trace.ticks` 逐拍推」，不经过这里；
 * 游戏本体（`game/useGame.ts`）今天只跑场景，战斗还没接进去（要等结算与
 * 回地图，xl-rh9.5）。也就是说**判据成立，被判的对象还没接上** —— 上面那条
 * 不变量验的是这个推进器，不是"真在游戏里切一次标签页"。
 *
 * 记在这里而不是删掉它：战斗的一拍是 100 ms 而场景是 10 ms，接进去那天需要的
 * 正是这一份；而"接进去之后才发现推进器是错的"比现在多一个没人调的模块贵得多。
 * 接线那张票要做的是把它接到 `setInterval` 那条路上（后台会被节流到 ~1 秒一次
 * 但**照样触发**，所以每次醒来补的是那 ~1 秒、约 10 拍，而不是攒够几分钟一次
 * 性爆发）。
 *
 * ## 与 `state/loop.ts` 是**有意重复**的两份
 *
 * `advanceBattle` 与那边的 `advance` 逐行同构。没有抽成一个泛型推进器，是因为
 * 两者要参数化的东西有四样（步长、世界是不是就地改、输入类型、要不要顺带推
 * `PaintState`），抽完之后调用方读到的是一串类型参数而不是"这一拍怎么走"。
 * 场景那一份是 M1 的交付物、有自己的判据；这一份跟着战斗走。**合并要单开一张
 * 票、串行做**（`docs/agents/dispatch.md` 纪律 2 对并行热点的规矩）。
 *
 * ## 为什么把 `PaintState` 也算进来
 *
 * 因为它里面有**自由跑的相位**（游标图的轮播、怒气槽的轮播）和**带惯性的量**
 * （血条每拍走 1 px）。只推世界不推它，切后台再切回来血条会跟血量对不上，
 * 而那看起来只是"血条动画有点怪"。这一层把两者绑在一起推，不变量因此同时
 * 盖住它们。
 */

/** 战斗的一拍。原版就这一个取值。 */
export const BATTLE_TICK_MS = 100

export interface BattleTicker {
  readonly world: BattleWorld
  readonly paint: PaintState
  /** 上次没凑够一拍的余量，攒着，不丢。 */
  readonly carryMs: number
  /** 还没有拍可以承载的输入。攒着，不丢 —— 丢掉的表现是"偶尔点一下没反应"。 */
  readonly pending: readonly BattleInput[]
  /** 时间加速倍率，`tools.Clock.factor` 的对应物。乘在**真实流逝的毫秒**上。 */
  readonly timeScale: number
}

export function createBattleTicker(world: BattleWorld, timeScale = 1): BattleTicker {
  if (!(timeScale > 0)) throw new Error(`时间倍率必须为正，收到 ${timeScale}`)
  return { world, paint: createPaintState(world), carryMs: 0, pending: [], timeScale }
}

/**
 * 推进 `elapsedMs` 真实毫秒。
 *
 * 输入落在这一批的**第一拍**上 —— 原版一拍里就是"鼠标事件 → 循环体"，而
 * `applyPaintInput` 要在 `stepBattle` **之前**跑（按钮贴图读的是这一拍开头的
 * `command.isDraw`，见 `render/paint.ts`）。
 *
 * `elapsedMs` 为负（时钟被调过）按 0 处理：宁可停一拍，不可倒着走。
 *
 * **世界是就地改的**（`stepBattle` 的规矩，见 `types.ts`），所以返回的
 * `world` 与传进来的是同一个对象；变的只有 `carryMs` / `pending`。
 */
export function advanceBattle(
  ticker: BattleTicker,
  arriving: readonly BattleInput[],
  elapsedMs: number,
): BattleTicker {
  const queue = arriving.length === 0 ? ticker.pending : [...ticker.pending, ...arriving]
  const budget = ticker.carryMs + Math.max(0, elapsedMs) * ticker.timeScale
  const ticks = Math.floor(budget / BATTLE_TICK_MS)
  if (ticks === 0) {
    return { ...ticker, carryMs: budget, pending: queue }
  }
  for (let i = 0; i < ticks; i++) {
    const inputs = i === 0 ? queue : EMPTY
    for (const input of inputs) applyPaintInput(ticker.world, ticker.paint, input)
    stepBattle(ticker.world, inputs)
    advancePaintState(ticker.world, ticker.paint)
  }
  return { ...ticker, carryMs: budget - ticks * BATTLE_TICK_MS, pending: [] }
}

const EMPTY: readonly BattleInput[] = []
