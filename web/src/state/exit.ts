import type { SceneScript } from '../data/types'
import type { TilePos } from './types'

/**
 * 一个场景的出口表（`Exit` 段），三列一一对应：走到 `exits[i]` 里的任意一格，
 * 就切到 `nextScene[i]`，落在 `entrance[i]`。
 *
 * 原版是 `ExitEvent` 构造函数收下的那三个 `ArrayList`。这里把坐标从
 * `"14 19"` 这样的字符串解析成 `TilePos`，其余原样 —— 解析放在一处，
 * `checkExit` 就不必在每个 tick 里切一遍字符串（原版真的是每 tick 切一遍）。
 */
export interface ExitTable {
  readonly exits: readonly (readonly TilePos[])[]
  readonly nextScene: readonly string[]
  readonly entrance: readonly TilePos[]
  /**
   * `ScenePanel.step()` 第 4 步那道门：`fightEvent.battle1` 不止一场时，
   * 要 `battle1Over` 才轮到查出口 —— 剧情固定战没打完就出不去。
   *
   * **战斗是另一张票**，今天 `battle1Over` 恒为假，所以这里为真就等于这个
   * 场景的出口全部关着。这是原版在同一时刻的状态（进场没打过），不是省略：
   * 换成"照常放行"，那几个场景就会比原版多一条走得通的路。
   */
  readonly blockedByBattle: boolean
}

/**
 * 从烘焙好的场景脚本取出出口表。**没有 `Exit` 段就是 `null`**，与原版
 * `ScenePanel.step()` 里那道 `if (exitEvent.getExits() != null)` 对应。
 *
 * 三列长度不齐是硬失败：原版在那种数据上会 `IndexOutOfBounds`，而这里如果
 * 悄悄取一个 `undefined`，表现就是"走到门口什么也没发生"——查不出来的那种。
 * 实测 96 个场景里 92 个有出口，三列全部等长，出口格无一重复。
 */
export function exitTableOf(scene: SceneScript): ExitTable | null {
  if (scene.exits === null) return null
  const nextScene = scene.nextScene ?? []
  const entrance = scene.entrance ?? []
  if (nextScene.length !== scene.exits.length || entrance.length !== scene.exits.length) {
    throw new Error(
      `${scene.script} 的出口表长度不齐：exits ${scene.exits.length} 组、` +
        `nextScene ${nextScene.length} 条、entrance ${entrance.length} 条。`,
    )
  }
  return {
    blockedByBattle: scene.battle1 !== null && scene.battle1.length > 1,
    exits: scene.exits.map((group, i) => group.map((tile) => parseTile(tile, scene.script, i))),
    nextScene: [...nextScene],
    entrance: entrance.map((pair, i) => {
      const x = Number(pair[0])
      const y = Number(pair[1])
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        throw new Error(`${scene.script} 的第 ${i} 个入口坐标不是两个整数：${JSON.stringify(pair)}`)
      }
      return { x, y }
    }),
  }
}

/** `"14 19"` → `{x:14, y:19}`。原版是 `exits.get(i)[j].split(" ")`。 */
function parseTile(tile: string, script: string, group: number): TilePos {
  const parts = tile.split(' ')
  const x = Number(parts[0])
  const y = Number(parts[1])
  if (parts.length !== 2 || !Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error(`${script} 的第 ${group} 组出口里有一格不是 "x y"：${JSON.stringify(tile)}`)
  }
  return { x, y }
}
