import { HEROES, derive } from '../battle/units'
import { skillNumberAfterLoad } from '../battle/skills'
import type { PartyKey } from '../battle/units'
import type { PartyMemberState } from '../fakes/party'
import type { EquipPackState } from '../menu/equipPanel'
import { EQUIPMENT_LISTS } from '../menu/equipment'
import type { EquipSlot } from '../menu/equipment'
import type { ScollHero } from '../menu/types'
import { HERO_OF_PARTY, WORN_HEROES } from './capture'
import { HERO_KEYS } from './format'
import type { ReadBack } from './format'

/**
 * 读档的三个英雄那一半（xl-i06.10）：`Loader.load` 里先后三步 ——
 *
 * 1. `zhangXiaoFan / luXueQi / yuJie.loadRoleInfo(...)` → `intialFromInfo()`：等级
 *    `parseInt`、**四项属性按等级重算**（公式与 `HEROES.attributes` 同一组，判据见测试）、
 *    `refreshValue()`、然后血 / 灵力 / 怒气 / 经验 `parseInt`，怒没怒 / 死没死
 *    `Boolean.parseBoolean`。那句 `refreshValue()` 夹的是**旧**血量、紧接着就被存档里的
 *    覆盖，所以这里不写它；
 * 2. `menuPanel.equipPanel.initialEquipInfo(menuInfo)`：三个人各六格，按名字在
 *    `EquipmentPack` 六张表里找，找到就穿上、四项属性 `+=` 加成；末尾三句
 *    `refreshValue()` 把血与灵力夹回**穿上之后**的上限。
 *
 * **纯函数**：读档之前的三个人由调用方交进来（`before`），落到队伍单例上是会话层的事
 * （`fakes/party.ts` 的 `setParty`）。技能格数（`skillNumber`，`intialFromInfo` 按等级
 * 抬那三个 static）落在队伍上（xl-03x.17），规则见 `battle/skills.ts` 的 `skillNumberAfterLoad`。
 *
 * ## 照抄的两处原版毛病
 *
 * - **鞋与饰品的判空下标写死了**：别的四格判 `equipInfo.get(k+i*6).equals("null")`，
 *   这两格写的是 `get(3)` / `get(5)` —— 永远看张小凡那一格。于是张小凡没穿鞋，另两个人
 *   身上的鞋读档之后一律是空的（{@link WORN_NULL_CHECK}，判据从 GBK 源码现读）；
 * - **不核「谁能用」**：装备页穿的时候判 `Equipment.user`，读档不判。
 */

/** `initialEquipInfo` 里六格的先后（`ep.weapon` … `ep.decoration`）。与源码对撞见测试。 */
export const INITIAL_EQUIP_ORDER: readonly EquipSlot[] = ['weapon', 'armor', 'helmet', 'shoe', 'glove', 'decoration']

/**
 * 每一格判空时读 `equipInfo` 的哪一项。`'own'` = 自己那一格（`k + i*6`）；数字 = 写死的
 * 那个下标（三个人都看它）。**手写登记**，与 GBK 源码现读的对撞见测试。
 */
export const WORN_NULL_CHECK: Readonly<Record<EquipSlot, 'own' | number>> = {
  weapon: 'own',
  armor: 'own',
  helmet: 'own',
  shoe: 3,
  glove: 'own',
  decoration: 5,
}

export interface LoadedHeroes {
  readonly party: Record<PartyKey, PartyMemberState>
  /** 菜单装备页三格（`heroEquipPack` = `equipPack_hero1 / 2 / 4`）。 */
  readonly packs: Record<ScollHero, EquipPackState>
}

export function heroesFromSave(
  rb: Pick<ReadBack, 'heroes' | 'worn'>,
  before: Readonly<Record<PartyKey, PartyMemberState>>,
): LoadedHeroes {
  const party = {} as Record<PartyKey, PartyMemberState>
  for (const key of HERO_KEYS) {
    const pk = HERO_OF_PARTY[key]
    const r = rb.heroes[key]
    party[pk] = {
      ...before[pk],
      level: r.level,
      ...HEROES[pk].attributes(r.level),
      hp: r.hp,
      mp: r.mp,
      angryValue: r.angryValue,
      isAngry: r.isAngry,
      isDead: r.isDead,
      exp: r.exp,
      // `intialFromInfo()` 开头那三句并列的 if：按存档里的等级只抬不压，起点是**读档前**
      // 那一份（xl-03x.17）。
      skillNumber: skillNumberAfterLoad(r.level, before[pk].skillNumber),
    }
  }

  // `equipInfo` 那一行是三个人各六格摊平的 18 项；`get(n)` 就是这个。
  const flat = (n: number): string | null => rb.worn[Math.floor(n / 6)]![INITIAL_EQUIP_ORDER[n % 6]!]
  const packs = {} as Record<ScollHero, EquipPackState>
  // `hero.get(i)` / `heroEquipPack.get(i)`：两张表都按 h1、h2、h4 排，与存档三英雄同序。
  HERO_KEYS.forEach((key, i) => {
    const m = party[HERO_OF_PARTY[key]]
    const pack = { weapon: null, armor: null, helmet: null, shoe: null, glove: null, decoration: null } as EquipPackState
    INITIAL_EQUIP_ORDER.forEach((slot, k) => {
      const check = WORN_NULL_CHECK[slot]
      if (flat(check === 'own' ? k + i * 6 : check) === null) return
      // `for(Equipment equip: list) if(name.equals(equip.getName())){ …; break; }` —— 取第一个同名的。
      const spec = EQUIPMENT_LISTS[slot].find((e) => e.name === flat(k + i * 6))
      if (spec === undefined) return
      pack[slot] = spec.name
      m.agile += spec.addAgile
      m.sprit += spec.addSpirit
      m.strength += spec.addStrength
      m.physicalPower += spec.addPhysicalPower
    })
    packs[WORN_HEROES[i]!] = pack
  })

  // `hero1.refreshValue(); hero2.refreshValue(); hero4.refreshValue();`
  for (const m of Object.values(party)) {
    const d = derive(m)
    if (m.hp >= d.hpMax) m.hp = d.hpMax
    if (m.mp >= d.mpMax) m.mp = d.mpMax
  }
  return { party, packs }
}
