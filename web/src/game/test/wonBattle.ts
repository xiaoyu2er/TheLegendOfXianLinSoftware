import { createBattle } from '../../battle/world'
import { checkEnemyDead } from '../../battle/step'
import type { BattleWorld } from '../../battle/types'
import { EQUIP_SLOTS, EQUIPMENT_LISTS } from '../../menu/equipment'
import type { EquipSlot } from '../../menu/equipment'

/**
 * 一场**已经打赢**的架：槽位打空，再跑 `Check.checkEnemyDead()` —— 与 `victory.test.ts`
 * 的 `win` 同一条路。之后不喂输入，结算自己会走完、回场景。
 *
 * `loot` 是这一场会掉的装备，从怪的 `thing` 那一列现读（`名字/2`），不手写。
 */
export function wonBattle(
  enemies: readonly (string | null)[],
  sprite: (name: string) => { width: number; height: number },
): { world: BattleWorld; loot: Map<string, number> } {
  const world = createBattle({
    background: 'image/背景图/伏魔山树林.png',
    party: ['zhang', 'yu', 'lu'],
    levels: { zhang: 20, yu: 20, lu: 20 },
    enemies,
    seed: 20260912,
    sprite,
  })
  const loot = new Map<string, number>()
  for (const e of world.enemies) {
    const [name, kind] = e.spec.thing.split('/')
    if (kind === '2') loot.set(name!, (loot.get(name!) ?? 0) + 1)
  }
  for (const e of world.slots) if (e !== null) e.hp = 0
  checkEnemyDead(world)
  return { world, loot }
}

/** 这件装备在六张表里的哪一张。**恰好一张**，不是就抛 —— 对不上的名字不许悄悄当成 0。 */
export function slotOf(name: string): EquipSlot {
  const hits = EQUIP_SLOTS.filter((s) => EQUIPMENT_LISTS[s].some((e) => e.name === name))
  if (hits.length !== 1) throw new Error(`「${name}」在六张装备表里出现了 ${hits.length} 次`)
  return hits[0]!
}
