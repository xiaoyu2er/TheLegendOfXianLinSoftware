import { createBattle } from './world'
import type { BattleConfig } from './world'
import type { BattleWorld } from './types'
import type { BattleTrace } from './trace'

/**
 * 照真值头部的**剧本回显**把世界建出来。
 *
 * 喂进去的只有"打的是哪一场"——背景、出战名单、等级、三个槽位、种子。
 * **一个状态字段都不从真值里读**：血量、行动条、帧号、菜单开关全部由这一层
 * 自己推出来，然后再逐字段和真值比。喂状态进去等于让真值给自己打分。
 */
export function replayBattle(trace: BattleTrace, sprite: BattleConfig['sprite']): BattleWorld {
  const s = trace.script
  if (s.tickMs !== 100) {
    // 原版 `BattlePanel.run()` 的循环周期就是 `Clock.sleep(100)`，没有别的取值。
    throw new Error(`战斗剧本的 tickMs 只能是 100，实际 ${s.tickMs}`)
  }
  return createBattle({
    background: s.background,
    party: s.party,
    levels: s.level,
    enemies: s.enemies,
    seed: s.seed,
    sprite,
  })
}
