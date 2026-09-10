import { describe, expect, it } from 'vitest'
import { HEROES, derive } from '../battle/units'
import type { PartyKey } from '../battle/units'
import { initialMember } from '../fakes/party'
import type { PartyMemberState } from '../fakes/party'
import { EQUIPMENT_LISTS } from '../menu/equipment'
import { javaSource } from '../test/javaSource'
import { HERO_KEYS } from './format'
import type { HeroRecord, ReadBack, WornRecord } from './format'
import { INITIAL_EQUIP_ORDER, WORN_NULL_CHECK, heroesFromSave } from './load'

/**
 * 读档的三个英雄那一半（xl-i06.10）：`intialFromInfo` ×3 + `initialEquipInfo`。
 *
 * 逐 tick 对齐真值的那一半在 `state/traceReplay.test.ts`（`heroes` / `worn` 两列，
 * 三份 `load-slot*`）。那三份样例档里**没人穿鞋与饰品**，于是 `initialEquipInfo`
 * 那两处写死的判空下标真值一次都没走到 —— 这里回到 GBK 源码上取（dispatch.md
 * §「真值盖不到那个分支」的第二条出路）。
 */

const BEFORE = (): Record<PartyKey, PartyMemberState> => ({
  zhang: initialMember('zhang'),
  lu: initialMember('lu'),
  yu: initialMember('yu'),
})

const hero = (over: Partial<HeroRecord> = {}): HeroRecord => ({
  level: 1,
  hp: 1,
  mp: 1,
  angryValue: 0,
  isAngry: false,
  isDead: false,
  exp: 0,
  ...over,
})
const bare = (): WornRecord => ({ weapon: null, armor: null, helmet: null, shoe: null, glove: null, decoration: null })
const rb = (
  worn: [WornRecord, WornRecord, WornRecord] = [bare(), bare(), bare()],
  heroes: Partial<Record<(typeof HERO_KEYS)[number], HeroRecord>> = {},
): Pick<ReadBack, 'heroes' | 'worn'> => ({
  heroes: { zhangXiaoFan: hero(), luXueQi: hero(), yuJie: hero(), ...heroes },
  worn,
})

const firstOf = (slot: keyof WornRecord) => EQUIPMENT_LISTS[slot][0]!

describe('intialFromInfo：等级决定四项属性，其余七项照存档', () => {
  it('四项属性按等级重算（不是存档里的），血、灵力、怒气、死没死、经验照抄', () => {
    const r = rb(undefined, { luXueQi: hero({ level: 7, hp: 5, mp: 6, angryValue: 9, isAngry: true, isDead: true, exp: 42 }) })
    const lu = heroesFromSave(r, BEFORE()).party.lu
    expect(lu).toMatchObject({ level: 7, ...HEROES.lu.attributes(7), hp: 5, mp: 6, angryValue: 9, isAngry: true, isDead: true, exp: 42 })
  })

  it('读档之前穿着的装备加成不留下来：开局那三把武器的加成被按等级重算抹掉', () => {
    const before = BEFORE()
    // 前提：出厂的张小凡带着月苗刀的加成，比按等级算的多。
    expect(before.zhang.strength).toBeGreaterThan(HEROES.zhang.attributes(1).strength)
    expect(heroesFromSave(rb(), before).party.zhang.strength).toBe(HEROES.zhang.attributes(1).strength)
  })

  it('三个类 intialFromInfo 里那四行公式与 HEROES.attributes 逐项相同（GBK 源码现读）', () => {
    const files: Record<PartyKey, string> = {
      zhang: 'src/battle/ZhangXiaoFan.java',
      lu: 'src/battle/LuXueQi.java',
      yu: 'src/battle/YuJie.java',
    }
    for (const key of Object.keys(files) as PartyKey[]) {
      const src = javaSource(files[key]).replace(/\r/g, '')
      const body = src.slice(src.indexOf('void intialFromInfo()'))
      const formula = (field: string) => {
        const m = new RegExp(`\\b${field}=(\\d+)\\+\\(level-(\\d+)\\)\\*(\\d+);`).exec(body)
        if (!m) throw new Error(`${files[key]} 的 intialFromInfo 里认不出 ${field} 那一行`)
        return (level: number) => Number(m[1]) + (level - Number(m[2])) * Number(m[3])
      }
      for (const level of [1, 3, 8, 11]) {
        expect(HEROES[key].attributes(level), `${key} 第 ${level} 级`).toEqual({
          physicalPower: formula('physicalPower')(level),
          sprit: formula('sprit')(level),
          agile: formula('agile')(level),
          strength: formula('strength')(level),
        })
      }
    }
  })
})

describe('initialEquipInfo：按名字在六张表里找，找到就穿上并叠加成', () => {
  it('穿上的四项加成叠在按等级重算的属性上', () => {
    const weapon = EQUIPMENT_LISTS.weapon.find((e) => e.addStrength > 0)!
    const worn: [WornRecord, WornRecord, WornRecord] = [{ ...bare(), weapon: weapon.name }, bare(), bare()]
    const out = heroesFromSave(rb(worn), BEFORE())
    expect(out.packs[1].weapon).toBe(weapon.name)
    expect(out.party.zhang.strength).toBe(HEROES.zhang.attributes(1).strength + weapon.addStrength)
  })

  it('不认识的名字：那一格是空的，一点加成都没有', () => {
    const worn: [WornRecord, WornRecord, WornRecord] = [{ ...bare(), weapon: '没有这把刀' }, bare(), bare()]
    const out = heroesFromSave(rb(worn), BEFORE())
    expect(out.packs[1].weapon).toBeNull()
    expect(out.party.zhang).toMatchObject(HEROES.zhang.attributes(1))
  })

  it('不核「谁能用」：只有陆雪琪能用的环，读档照样穿在张小凡身上', () => {
    const ring = EQUIPMENT_LISTS.weapon.find((e) => e.user === 2)!
    const worn: [WornRecord, WornRecord, WornRecord] = [{ ...bare(), weapon: ring.name }, bare(), bare()]
    expect(heroesFromSave(rb(worn), BEFORE()).packs[1].weapon).toBe(ring.name)
  })

  it('末尾三句 refreshValue()：血与灵力夹回**穿上装备之后**的上限', () => {
    // 御衡镇日刀 addSpirit 为负：穿上之后 mpMax 掉下来，存档里的灵力要被夹住。
    const blade = EQUIPMENT_LISTS.weapon.find((e) => e.addSpirit < 0)!
    const level = 3
    const bareMax = derive(HEROES.yu.attributes(level)).mpMax
    const worn: [WornRecord, WornRecord, WornRecord] = [bare(), bare(), { ...bare(), weapon: blade.name }]
    const out = heroesFromSave(rb(worn, { yuJie: hero({ level, mp: bareMax, hp: 99999 }) }), BEFORE())
    const d = derive(out.party.yu)
    expect(d.mpMax).toBeLessThan(bareMax)
    expect(out.party.yu.mp).toBe(d.mpMax)
    expect(out.party.yu.hp).toBe(d.hpMax)
  })
})

describe('initialEquipInfo 的两处判空下标写死了（鞋 get(3)、饰品 get(5)）', () => {
  it('判空下标从 GBK 源码现读，与 WORN_NULL_CHECK 对撞；六格的次序同样现读', () => {
    const src = javaSource('src/menu/EquipPanel.java').replace(/\r/g, '')
    const body = src.slice(src.indexOf('public void initialEquipInfo'), src.indexOf('hero1.refreshValue();', src.indexOf('public void initialEquipInfo')))
    const checks = [...body.matchAll(/if\(equipInfo\.get\((\d+)(\+i\*6)?\)\.equals\("null"\)\)\{\s*ep\.(\w+)=null;/g)]
    expect(checks.map((m) => m[3])).toEqual([...INITIAL_EQUIP_ORDER])
    const derived = Object.fromEntries(
      checks.map((m, k) => [m[3], m[2] === undefined ? Number(m[1]) : Number(m[1]) === k ? 'own' : `?${m[1]}`]),
    )
    expect(derived).toEqual(WORN_NULL_CHECK)
  })

  it('张小凡没穿鞋，陆雪琪的鞋就读不回来；张小凡穿了，陆雪琪的才回得来', () => {
    const shoe = firstOf('shoe')
    const luShoe = (zhangShoe: string | null) =>
      heroesFromSave(rb([{ ...bare(), shoe: zhangShoe }, { ...bare(), shoe: shoe.name }, bare()]), BEFORE()).packs[2].shoe
    expect(luShoe(null)).toBeNull()
    expect(luShoe(shoe.name)).toBe(shoe.name)
  })

  it('饰品同一个样子', () => {
    const deco = firstOf('decoration')
    const yuDeco = (zhangDeco: string | null) =>
      heroesFromSave(rb([{ ...bare(), decoration: zhangDeco }, bare(), { ...bare(), decoration: deco.name }]), BEFORE()).packs[4].decoration
    expect(yuDeco(null)).toBeNull()
    expect(yuDeco(deco.name)).toBe(deco.name)
  })

  it('别的四格是各判各的：张小凡没戴头盔，不连累陆雪琪', () => {
    const helmet = firstOf('helmet')
    const out = heroesFromSave(rb([bare(), { ...bare(), helmet: helmet.name }, bare()]), BEFORE())
    expect(out.packs[2].helmet).toBe(helmet.name)
  })
})
