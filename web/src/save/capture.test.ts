import { describe, expect, it } from 'vitest'
import { DRUGS } from '../battle/drugs'
import { getScene } from '../data/scenesEager'
import { initialMember } from '../fakes/party'
import type { PartyMemberState } from '../fakes/party'
import { EQUIP_SLOTS, EQUIPMENT_LISTS } from '../menu/equipment'
import type { EquipSlot } from '../menu/equipment'
import { initiate } from '../state/step'
import { TILE } from '../state/role'
import type { World } from '../state/types'
import { javaSource } from '../test/javaSource'
import { HERO_OF_PARTY, WORN_HEROES, captureSave } from './capture'
import type { CaptureSources } from './capture'
import { HERO_KEYS, parseSave, serializeSave } from './format'

/**
 * 写档装置的逐项判据（xl-i06.9）。第 1 行（队伍 + 地图 + 任务）有真值回声，在
 * `saveload/saveloadTrace.test.ts`；这里守的是**其余九行**，真值看不见它们。
 *
 * ⚠️ 这一组**弱在哪要写明**：每一项都是「原版那一项读的是哪个字段」—— 锚的是
 * 我们对原版源码的阅读（其中表达式与次序从 GBK 源码现读对撞），不是原版的输出。
 * 能从原版输出上锚的只有摘要那三样。
 *
 * 做法：每一项都塞一个**独一无二的值**，再看它落在存档的哪一格。取错一个来源
 * （比如 `x` 取成像素、`hp` 取成 `mp`），那一格就是别人的数。
 */
const scene = getScene('脚本1')

function world(): World {
  const w = initiate(null, scene)
  return {
    ...w,
    isScript: false,
    // 像素 = 格 × 32 + 半格：取成像素或取整方向错了都看得出来。
    role: { ...w.role, px: 17 * TILE + 16, py: 23 * TILE + 16 },
    dialogue: { ...w.dialogue, eventOver: true, groupOrder: 7 },
    currentScript: ['1/2', '甲.txt', '乙.txt'],
    nextScript: ['3/4', '丙.txt', '丁.txt'],
    fight: { ...w.fight, battle1Over: true, countOfBattle1: 5 },
    recorder: [
      { scene: '教室.txt', answered: [true, false] },
      { scene: '食堂.txt', answered: [false] },
    ],
    readerStatics: { mapName: '宿舍.png', task: '某个任务', zhang: true, lu: false, wen: true },
  }
}

function member(key: 'zhang' | 'lu' | 'yu', base: number): PartyMemberState {
  return {
    ...initialMember(key),
    level: base + 1,
    hp: base + 2,
    mp: base + 3,
    angryValue: base + 4,
    isAngry: base % 2 === 0,
    isDead: base % 3 === 0,
    exp: base + 5,
  }
}

function sources(): CaptureSources {
  const owned = Object.fromEntries(
    EQUIP_SLOTS.map((s, k) => [s, EQUIPMENT_LISTS[s].map((_, i) => k * 100 + i)]),
  ) as Record<EquipSlot, number[]>
  return {
    world: world(),
    party: { zhang: member('zhang', 10), lu: member('lu', 20), yu: member('yu', 30) },
    worn: {
      1: { weapon: 'W1', armor: 'A1', helmet: null, shoe: 'S1', glove: null, decoration: 'D1' },
      2: { weapon: 'W2', armor: null, helmet: 'H2', shoe: null, glove: 'G2', decoration: null },
      4: { weapon: null, armor: 'A4', helmet: 'H4', shoe: 'S4', glove: 'G4', decoration: 'D4' },
    },
    owned,
    drugs: DRUGS.map((_, i) => 1000 + i),
    coins: 4321,
  }
}

describe('captureSave：Recorder.save 那十个列表', () => {
  const save = captureSave(sources())

  it('第 1 行：三个开关、SaveAndLoad.mapName、Reader.task 取自 World.readerStatics', () => {
    expect(save.party).toEqual({ zhang: true, lu: false, wen: true })
    expect(save.summary).toEqual({ mapName: '宿舍.png', task: '某个任务' })
  })

  it('第 2–4 行：三个英雄 saveRoleInfo()，逐项取自队伍里对应的那一位', () => {
    const src = sources()
    for (const key of HERO_KEYS) {
      const m = src.party[HERO_OF_PARTY[key]]
      expect(save.heroes[key]).toEqual({
        level: m.level,
        hp: m.hp,
        mp: m.mp,
        angryValue: m.angryValue,
        isAngry: m.isAngry,
        isDead: m.isDead,
        exp: m.exp,
      })
    }
    // 三位的数两两不同，所以「张的档里是陆的数」看得出来。
    expect(new Set(HERO_KEYS.map((k) => save.heroes[k].level)).size).toBe(3)
  })

  it('HERO_OF_PARTY：存档第 2–4 行的次序与 Recorder.save 里三次 saveRoleInfo() 一致', () => {
    const src = javaSource('src/start/Recorder.java').replace(/\s+/g, '')
    const order = [...src.matchAll(/(\w+)Info=GameLauncher\.(\w+)\.saveRoleInfo\(\)/g)].map((m) => m[2])
    expect(order).toEqual([...HERO_KEYS])
  })

  it('第 5 行：saveSceneInfo() 十项；x / y 是格（getX() = x / 32），不是像素', () => {
    expect(save.scene).toEqual({
      isScript: false,
      fileName: scene.script,
      dialogueEventOver: true,
      dialogueOrder: 7,
      x: 17,
      y: 23,
      currentScript: ['1/2', '甲.txt', '乙.txt'],
      nextScript: ['3/4', '丙.txt', '丁.txt'],
      battle1Over: true,
      countOfBattle1: 5,
    })
    const role = javaSource('src/scene/Role.java').replace(/\s+/g, '')
    expect(role).toContain('publicintgetX(){returnx/32;}')
    expect(role).toContain('publicintgetY(){returny/32;}')
  })

  it('nextScript 为 null（原版 new String[3]）落成三个字面量 "null"', () => {
    const s = sources()
    const w = { ...s.world, nextScript: null }
    expect(captureSave({ ...s, world: w }).scene.nextScript).toEqual(['null', 'null', 'null'])
  })

  it('第 6 行：heroEquipPack 的三格 —— equipPack_hero1 / hero2 / hero4', () => {
    const src = sources()
    expect(save.worn).toEqual(WORN_HEROES.map((h) => src.worn[h]))
    const panel = javaSource('src/menu/EquipPanel.java').replace(/\s+/g, '')
    const order = [...panel.matchAll(/heroEquipPack\.add\(equipPack_hero(\d)\)/g)].map((m) => Number(m[1]))
    expect(order).toEqual([...WORN_HEROES])
  })

  it('第 7 行：各药 numberGOT（DRUGS 次序）+ 钱', () => {
    expect(save.drugs).toEqual(DRUGS.map((_, i) => 1000 + i))
    expect(save.coins).toBe(4321)
    expect(() => captureSave({ ...sources(), drugs: [1, 2] })).toThrow(/次序对不上/)
  })

  it('第 8–10 行（原版写了但从不读回）：装备持有量、答题地图、答题记录', () => {
    const src = sources()
    expect(save.neverReadBack.equipmentStock).toEqual(src.owned)
    expect(save.neverReadBack.questionMaps).toEqual(['教室.txt', '食堂.txt'])
    expect(save.neverReadBack.answers).toEqual([[true, false], [false]])
  })

  it('交得出去的就读得回来：serializeSave → parseSave 逐字段相同（形状检查一项都没挡）', () => {
    expect(parseSave(serializeSave(save))).toEqual(save)
  })
})
