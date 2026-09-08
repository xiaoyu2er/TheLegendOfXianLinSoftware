import { afterEach, describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { enemyNamesOf, enemySpriteSize, resetEnemySprites } from './enemySprites'

/**
 * 出场图尺寸的预取。这个模块只有 `useGame` 用得到，而那一层没有测试缝
 * （要真浏览器解图），所以这里验的是**它自己能保证的两件事**：扫得全、
 * 查不到就抛。
 *
 * 两件都是"失败的样子和成功不一样"那类：漏扫一个 battle 段的表现是
 * "打某几场时会抛"，而抛出来的话至少看得见；查不到时悄悄给个默认尺寸的
 * 表现是**点击范围整个错位而画面完全正常** —— 那是查不出来的那种。
 */
describe('怪物出场图尺寸', () => {
  afterEach(() => {
    resetEnemySprites()
  })

  it('三个 battle 段都扫，一个不落', () => {
    // 迷宫1 只有 battle0，脚本38 只有 battle1 —— 只扫其中一段的话，
    // 另一个场景会数出 0 个名字。
    const maze = getScene('迷宫1')
    expect(maze.battle0).not.toBeNull()
    expect(maze.battle1).toBeNull()
    expect([...enemyNamesOf(maze)].sort()).toEqual(['怪物1', '怪物2'])

    const arena = getScene('脚本38')
    expect(arena.battle0).toBeNull()
    expect(arena.battle1).not.toBeNull()
    expect(enemyNamesOf(arena).length).toBeGreaterThan(0)

    // battle2（选择式战斗，归 M4 的 SelectEvent）那一段也要扫到。**大地图
    // 正是只有 battle2 的场景** —— 只扫 battle0/battle1 的话它会数出 0 只怪，
    // 而玩家在大地图上随时可能撞进那种战斗。
    const bigmap = getScene('大地图')
    expect([bigmap.battle0, bigmap.battle1]).toEqual([null, null])
    expect(bigmap.battle2).not.toBeNull()
    expect(enemyNamesOf(bigmap).length).toBeGreaterThan(0)
  })

  it('"null" 那个空槽位不算一只怪', () => {
    const names = enemyNamesOf({
      ...getScene('迷宫1'),
      battle0: [['bg', 'zhang', 'yu', 'lu', '怪物1/5', 'null', 'null']],
    })
    expect(names).toEqual(['怪物1'])
  })

  it('没量过就抛，不给默认尺寸', () => {
    expect(() => enemySpriteSize('怪物1')).toThrow(/还没量过/)
  })
})
