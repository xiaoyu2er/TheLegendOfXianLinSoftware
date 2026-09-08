import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { exitTableOf } from './exit'
import {
  BATTLE0_ROWS_THRESHOLD,
  BATTLE0_STEPS_BIG,
  BATTLE0_STEPS_SMALL,
  NEXT_SCRIPT_ENEMIES,
  advancesScript,
  createFight,
  startBattle1,
  toFightDraft,
} from './fight'
import { createWorld, step } from './step'
import { sceneSourceOf } from './trace'
import { TILE } from './role'
import type { World } from './types'

/**
 * `FightEvent` 那三个方法，以及它开关的那道出口门。
 *
 * ## ⚠️ 凭什么算过
 *
 * 五份 `driver=scene` 的真值走的是 `宿舍` / `大地图` / `脚本1` —— 三个都没有
 * `battle0`、没有 `battle1`、正文里一个 `@` 都没有。所以这个文件里的每一条
 * 都是**照着 `src/scene/FightEvent.java` 与 `ScenePanel.step()` 第 4 步抄的**，
 * 由下面这些用例钉住，不是从 trace 里读出来的。
 *
 * 每一条的分母都从**烘焙产物现数**（`tools/ground-truth` 的同一批数据），
 * 不写死"目前有 4 个场景有 battle0"这种会随并行分支漂的数。
 */
describe('FightEvent', () => {
  const scenes = sceneSourceOf(getScene)

  it('count_battle0 由行数定：>20 行是 50，否则 30', () => {
    // 分母现数：有 battle0 的场景全部扫一遍，两档各至少有一个样本 ——
    // 否则这条门槛就有一半没被看见过。
    const withBattle0 = ['脚本6', '脚本10', '脚本20', '迷宫1']
      .map((name) => getScene(name))
      .filter((s) => s.battle0 !== null)
    expect(withBattle0.length).toBeGreaterThan(0)
    const buckets = new Set<number>()
    for (const scene of withBattle0) {
      const f = createFight(scene)
      const expected =
        scene.mapSet.length > BATTLE0_ROWS_THRESHOLD ? BATTLE0_STEPS_BIG : BATTLE0_STEPS_SMALL
      expect(f.stepsToBattle, `${scene.script} 的门槛`).toBe(expected)
      buckets.add(f.stepsToBattle)
    }
    // 脚本20 是 21 行（走 50 格），其余三个是 20 行（走 30 格）—— 两档都有样本。
    expect([...buckets].sort((a, b) => a - b)).toEqual([BATTLE0_STEPS_SMALL, BATTLE0_STEPS_BIG])
  })

  it('没有 battle0 的场景，门槛留在 0（原版那个字段从没被赋过值）', () => {
    const scene = getScene('宿舍')
    expect(scene.battle0).toBeNull()
    expect(createFight(scene).stepsToBattle).toBe(0)
  })

  it('x / y 的初值是 0，不是主角的出生格', () => {
    const scene = getScene('迷宫1')
    const f = createFight(scene)
    expect([f.x, f.y]).toEqual([0, 0])
    // 出生格不是 (0,0)，所以这条区分得开 —— 两者相同的话它就是恒真的。
    expect([scene.roleX, scene.roleY]).not.toEqual([0, 0])
  })

  it('startBattle1：一场一场往下打，最后一场打完才 battle1Over', () => {
    const scene = getScene('脚本38')
    // 分母从数据现读：脚本38 是这批里少见的**三场**剧情固定战。
    const rows = scene.battle1!
    expect(rows.length).toBeGreaterThan(1)
    const f = toFightDraft(createFight(scene))
    const got: (readonly string[] | null)[] = []
    const over: boolean[] = []
    for (let i = 0; i < rows.length + 1; i++) {
      got.push(startBattle1(f))
      over.push(f.battle1Over)
    }
    // 前 N 次各打各的，第 N+1 次什么都不打；battle1Over 恰好在最后一场打完
    // 那一次翻真（原版那两句不在同一个 if 里）。
    expect(got).toEqual([...rows, null])
    expect(over).toEqual([...rows.map((_, i) => i === rows.length - 1), true])
  })

  it('advancesScript 只看一号位，而且是整列逐字比', () => {
    expect(NEXT_SCRIPT_ENEMIES).toContain('李洵/5')
    expect(advancesScript(['bg', 'zhang', 'yu', 'lu', '李洵/5', 'null', 'null'])).toBe(true)
    // 同名但编号不是 5 的不算 —— 改成"只比名字"这条会红。
    expect(advancesScript(['bg', 'zhang', 'yu', 'lu', '李洵/6', 'null', 'null'])).toBe(false)
    // 名字出现在别的槽位也不算。
    expect(advancesScript(['bg', 'zhang', 'yu', 'lu', '怪物1/5', '李洵/6', 'null'])).toBe(false)
  })

  describe('出口那道门：battle1 不止一场时要打完才出得去', () => {
    /**
     * 把主角摆到某个出口格上。**这是布置初始条件，不是写期望值** ——
     * 走过去要在迷宫里寻路，而寻路的失败（走不到）与门关着长得一样。
     */
    function standingOnExit(world: World, tile: { x: number; y: number }): World {
      return { ...world, role: { ...world.role, px: tile.x * TILE, py: tile.y * TILE } }
    }

    it('脚本38（三场）：没打完出不去，battle1Over 之后同一格就出得去', () => {
      const scene = getScene('脚本38')
      const table = exitTableOf(scene)!
      expect(table.needsBattle1Over).toBe(true)
      const tile = table.exits[0]![0]!
      const world = createWorld(scene)

      const closed = step(standingOnExit(world, tile), [], 10, scenes)
      expect(closed.scene, '剧情固定战没打完，这个出口该是关着的').toBe(scene.script)

      const opened = step(
        standingOnExit({ ...world, fight: { ...world.fight, battle1Over: true } }, tile),
        [],
        10,
        scenes,
      )
      expect(opened.scene, '打完了就该出得去').not.toBe(scene.script)
      expect(opened.scene).toBe(table.nextScene[0])
    })

    it('battle1 只有一场（或没有）的场景，这道门根本不存在', () => {
      // 宿舍没有 battle1；脚本22 只有一场 —— `size() > 1` 那道门都不成立。
      expect(exitTableOf(getScene('宿舍'))!.needsBattle1Over).toBe(false)
      expect(getScene('脚本22').battle1).toHaveLength(1)
    })
  })
})
