import { HEROES, derive } from '../battle/units'
import type { PartyKey } from '../battle/units'
import { SKILL_NUMBER } from '../battle/skills'
import { DEFAULT_WEAPONS } from './defaultWeapons'

/**
 * 菜单里那三个人的**开局属性**，也就是菜单真值 `heroes[]` 那一列。
 *
 * 三步，顺序逐行照抄原版，而三步全都不能少：
 *
 * 1. **四项基础属性取 static 字段的初值**（`HEROES[key].attributes(初始等级)`
 *    在初始等级上恰好等于那三行初始化式）。`new MenuPanel()` 走的是三个
 *    **空构造函数** —— 它们一行代码都没有，所以带 `BattlePanel` 的那个构造函数
 *    里那套「按等级重算」在这条路上**根本没跑过**。
 * 2. **穿上开局那把武器**（`EquipPanel` 构造函数里的 `addPack()`）：四项属性
 *    各 `+=` 一次武器加成。少这一步，张小凡的敏捷是 10，而真值里是 11。
 * 3. **`refreshValue()`**：七个派生值重算。菜单真值记得到的是 hpMax / mpMax /
 *    defense / skillDefense 四个。
 *
 * `hp` / `mp` 另说 —— 空构造函数不碰它们，static 的 int 停在 0，所以剧本里那个
 * `fullHeal` 才存在（`docs/trace-format.md` §菜单剧本）。**它不是期望值，是开局
 * 状态**：不拉满的话「喝药回血」这条路径要从 0 起算。
 */
export interface MenuHero {
  /** 真值里那一列的名字，与 `MenuDriver.heroesJson` 的 `names[]` 逐字相同。 */
  readonly name: string
  level: number
  physicalPower: number
  agile: number
  strength: number
  /** 原版字段叫 `sprit`（拼写照抄），真值那一列叫 `spirit`。 */
  spirit: number
  hp: number
  hpMax: number
  mp: number
  mpMax: number
  defense: number
  skillDefense: number
  skillNumber: number
}

/**
 * 三个人在真值里的**排列次序与名字**：`MenuDriver.heroes()` 取的是
 * `mp.hero1 / hero2 / hero4`，名字数组是 `zhangxiaofan / luxueqi / yujie`。
 *
 * ⚠️ 名字与队伍键**不是同一套**，而且中间那个正好会骗人：`hero2` 是
 * `LuXueQi`，队伍键是 `lu`，真值里写的是 `luxueqi`；`hero4` 是 `YuJie` / `yu` /
 * `yujie`。按顺序猜或按名字猜都会把后两个对调。
 */
export const MENU_HERO_ORDER: readonly { key: PartyKey; name: string }[] = [
  { key: 'zhang', name: 'zhangxiaofan' },
  { key: 'lu', name: 'luxueqi' },
  { key: 'yu', name: 'yujie' },
]

/**
 * 三个 `static int level` 的**初值**。原版那三个类的字段初始化式，判据在
 * `heroes.test.ts`（从 GBK 源码里现读）。
 *
 * 玉洁是 3 而不是 1 —— 这不是笔误，真值第 0 帧写着 `"level": 3`。
 */
export const MENU_DEFAULT_LEVEL: Readonly<Record<PartyKey, number>> = {
  zhang: 1,
  lu: 1,
  yu: 3,
}

/** 建菜单里那三个人。`fullHeal` 就是剧本 `setup.fullHeal` 那一项。 */
export function createMenuHeroes(fullHeal: boolean): MenuHero[] {
  return MENU_HERO_ORDER.map(({ key, name }) => {
    const level = MENU_DEFAULT_LEVEL[key]
    const base = HEROES[key].attributes(level)
    const weapon = DEFAULT_WEAPONS[key]
    const attrs = {
      physicalPower: base.physicalPower + weapon.addPhysicalPower,
      agile: base.agile + weapon.addAgile,
      strength: base.strength + weapon.addStrength,
      sprit: base.sprit + weapon.addSpirit,
    }
    const d = derive(attrs)
    return {
      name,
      level,
      physicalPower: attrs.physicalPower,
      agile: attrs.agile,
      strength: attrs.strength,
      spirit: attrs.sprit,
      // 空构造函数一个字都不写，static 的 int 停在 0；`fullHeal` 才拉满。
      hp: fullHeal ? d.hpMax : 0,
      hpMax: d.hpMax,
      mp: fullHeal ? d.mpMax : 0,
      mpMax: d.mpMax,
      defense: d.defense,
      skillDefense: d.skillDefense,
      skillNumber: SKILL_NUMBER[key],
    }
  })
}
