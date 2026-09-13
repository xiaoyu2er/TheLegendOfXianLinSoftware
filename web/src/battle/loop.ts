import { advancePaintState, applyPaintInput, createPaintState } from './render/paint'
import type { PaintState } from './render/paint'
import { BattleThreadDied, applyBattleInput, stepBattle } from './step'
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
 * ## 谁在调它
 *
 * 游戏本体：会话层（`game/session.ts`）进战斗时 `createBattleTicker`、每拍
 * `advanceBattle`，而会话层由 `game/useGame.ts` 那条 `setInterval` 驱动 —— 正是上面
 * 说的那条路。（这一段原先写着「今天还没有生产调用方」，战斗接进会话层之后过期了，
 * xl-03x.19 收口时改。）
 *
 * 取图页（`replay/main.ts`）不经过这里，走的是「照 `trace.ticks` 逐拍推」。所以
 * 上面那条不变量验的是这个推进器本身，**不是**「真在浏览器里切一次标签页」——
 * 后者没有判据。
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
  /**
   * **这一次** `advanceBattle` 跑过的每一拍请求的音效，依次相接（xl-b36）。
   * `world.music` 每拍清空，一次推进常常跑好几拍（或者零拍），所以会话层要的
   * 「这一次推进出了哪几声」只能在这里逐拍收，不能事后读世界。
   */
  readonly sfx: readonly string[]
  /**
   * 战斗线程死于哪一发异常（xl-9go），没死是 `null`。死了之后这一场**一拍都不再推**，
   * 世界与画面都停在抛出来的那一刻（原版那条线程已经退出了 `run()`）。
   * ⚠️ 输入也不收 —— 这一半**不是**原版：原版的键鼠监听在事件线程上照样改状态
   * （按 J 出胜利音效、涨经验）。没做、不是故意不复刻，见 xl-jkt。
   * 面板不切 —— 原版没人 `switchTo`，会话层读到的 `exitPanel` 一直是 `null`。
   */
  readonly died: BattleThreadDied | null
}

const NO_SFX: readonly string[] = []

export function createBattleTicker(world: BattleWorld, timeScale = 1): BattleTicker {
  if (!(timeScale > 0)) throw new Error(`时间倍率必须为正，收到 ${timeScale}`)
  return { world, paint: createPaintState(world), carryMs: 0, pending: [], timeScale, sfx: NO_SFX, died: null }
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
  if (ticker.died !== null) return { ...ticker, pending: [], sfx: NO_SFX }
  const queue = arriving.length === 0 ? ticker.pending : [...ticker.pending, ...arriving]
  const budget = ticker.carryMs + Math.max(0, elapsedMs) * ticker.timeScale
  const ticks = Math.floor(budget / BATTLE_TICK_MS)
  if (ticks === 0) {
    return { ...ticker, carryMs: budget, pending: queue, sfx: NO_SFX }
  }
  const heard: string[] = []
  for (let i = 0; i < ticks; i++) {
    try {
      stepBattleWithPaint(ticker.world, ticker.paint, i === 0 ? queue : EMPTY)
    } catch (e) {
      // 只接原版真会死线程的那一类（见 `BattleThreadDied`）。死在这一拍：之前几拍照常算、
      // 这一拍抛出来之前改掉的字段照留（原版也是），之后的拍不再推。
      if (!(e instanceof BattleThreadDied)) throw e
      // 这一拍抛出来之前已经出的声照样算（输入里、循环体前半段）。
      heard.push(...ticker.world.music)
      return { ...ticker, carryMs: 0, pending: [], sfx: heard, died: e }
    }
    heard.push(...ticker.world.music)
  }
  return { ...ticker, carryMs: budget - ticks * BATTLE_TICK_MS, pending: [], sfx: heard }
}

const EMPTY: readonly BattleInput[] = []

/**
 * **一拍：输入 → 循环体 → 只有画面看得见的那点更新**（xl-rh9.18）。
 *
 * 每一处"回放一份战斗真值"的代码都要按这个顺序跑，所以收成一个函数 ——
 * 顺序写错了不会报错，只会让某一帧少亮一块，而那种错在单元判据里看不见
 * （按钮贴图一个字段都不在行为真值里）。
 *
 * ## 一拍里有两条输入时，两边必须交替
 *
 * ⚠️ 这里原先是**先把这一拍的输入全喂给 `applyPaintInput`，再整批喂给
 * `stepBattle`**。一拍只有一条输入时两种写法一样；有两条时不一样，而
 * `xl-rh9.14` 那批剧本正好有（`battle-mishu-yu` 第 655 拍：点「击」+ 点怪物）。
 *
 * 原版的两条输入是**两个事件**：第一条的 `mouseReleased` 在处理器里就把
 * `command.isDraw` 置假了，第二条进来时三个 `if(command.isDraw)` 全部跳过，
 * 于是「击」按钮保着上一次的待点贴图。批处理的写法让第二条也读到了**这一拍
 * 开头**的 `isDraw`（还是真），它落在四颗按钮之外，把「击」刷回了常态。
 *
 * 表现：此后每一帧「击」按钮那 58×62 一块都不对（实测 2512 个像素），
 * 而三条剧本的尾巴上全是这一块 —— 逐帧比对之外没有任何东西看得见它。
 */
export function stepBattleWithPaint(
  world: BattleWorld,
  paint: PaintState,
  inputs: readonly BattleInput[] = EMPTY,
): void {
  // 一拍的开头：音效从这里清（xl-b36），输入里出的声算进这一拍。
  world.music.length = 0
  for (const input of inputs) {
    // 顺序照抄原版：事件处理器先跑（读这一条**之前**的 `command.isDraw`），
    // 跑完它自己就可能把 `isDraw` 改掉，下一条读到的是改过的。
    applyPaintInput(world, paint, input)
    applyBattleInput(world, input)
  }
  // 输入已经在上面喂完了，这里不再传；也不再清音效（上面已经清过）。
  stepBattle(world, EMPTY, false)
  advancePaintState(world, paint)
}
