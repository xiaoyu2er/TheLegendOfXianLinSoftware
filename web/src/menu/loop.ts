import { stepMenu } from './step'
import type { MenuInput } from './step'
import type { MenuWorld } from './types'

/**
 * 菜单的定步长推进器：把"过去了多少真实毫秒"换成"推几次循环体"。
 *
 * **步长是 100 ms** —— `FatherPanel.run()` 里那句 `Clock.sleep(100)`，与战斗
 * 那条同源（ADR-0003）。
 *
 * ## 为什么菜单**必须**有这条循环，不能做成纯事件驱动
 *
 * 菜单里可断言的状态变化确实全由鼠标事件同步引起，但原版那四条 run 线程
 * **不管哪一页正显示着都在跑**：鼠标图标八张图循环换、奇术页那段技能动画一帧
 * 一帧往前推。`menu-equip` 的**第 0 帧**就写着一条动画在跑
 * （`magic.animation = {hero:4, skill:5, code:1, length:41}`）—— 玉洁那条技能
 * 动画在菜单一打开就在放。做成"没输入就不动"的话，菜单是死的，而画面上只
 * 表现为"游标不闪了"。
 *
 * ## 输入与脉冲**不是同一种一步**
 *
 * `stepMenu` 一步 = 一次输入事件，或者一次循环体（`{e:'tick'}`）。真值把两者
 * 摆在同一列里，这里也照办：到达的输入各推一步，然后按流逝的时间补脉冲。
 *
 * 与 `battle/loop.ts` / `state/loop.ts` 是**有意重复**的第三份，理由同那两处
 * （要参数化的东西比省下来的多）。合并要单开一张票、串行做。
 */

/** 菜单的一拍。原版就这一个取值。 */
export const MENU_TICK_MS = 100

export interface MenuTicker {
  readonly world: MenuWorld
  /** 上次没凑够一拍的余量，攒着，不丢。 */
  readonly carryMs: number
  /** 时间加速倍率，`tools.Clock.factor` 的对应物。 */
  readonly timeScale: number
}

export function createMenuTicker(world: MenuWorld, timeScale = 1): MenuTicker {
  if (!(timeScale > 0)) throw new Error(`时间倍率必须为正，收到 ${timeScale}`)
  return { world, carryMs: 0, timeScale }
}

/**
 * 推进 `elapsedMs` 真实毫秒。
 *
 * **输入先派发，再补脉冲**：原版的鼠标事件是 Swing 线程同步送进来的，与那四条
 * run 线程互不等待，一次点击立刻生效、不等下一拍。攒到脉冲上再发的话，点击
 * 会有最多 100 ms 的延迟，而那看起来只是"手感有点黏"。
 *
 * `elapsedMs` 为负（时钟被调过）按 0 处理：宁可停一拍，不可倒着走。
 *
 * 世界是**就地改**的，返回的 `world` 与传进来的是同一个对象。
 */
export function advanceMenu(
  ticker: MenuTicker,
  arriving: readonly MenuInput[],
  elapsedMs: number,
): MenuTicker {
  for (const input of arriving) stepMenu(ticker.world, [input])
  const budget = ticker.carryMs + Math.max(0, elapsedMs) * ticker.timeScale
  const ticks = Math.floor(budget / MENU_TICK_MS)
  for (let i = 0; i < ticks; i++) stepMenu(ticker.world, TICK_PULSE)
  return { ...ticker, carryMs: budget - ticks * MENU_TICK_MS }
}

const TICK_PULSE: readonly MenuInput[] = [{ e: 'tick' }]
