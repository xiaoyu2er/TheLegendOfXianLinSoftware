import { HEROES, derive } from '../battle/units'
import type { Attributes, PartyKey } from '../battle/units'
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

/**
 * 队伍此刻的等级、四项基础属性与血 / 灵力。游戏本体开菜单时喂它 —— 对应
 * `GameLauncher.switchTo("menu")` 里那三句 `refreshValue()`：**打开的那一刻
 * 看到的是最新属性**，而不是上一场战斗之前的旧数据。
 *
 * ⚠️ **四项属性也要喂**（xl-6lo.16）。原版那三个对象的属性字段是 `static`，
 * 菜单与战斗读的是同一份；这一层的队伍从 xl-6lo.16 起也记着它们（带装备加成，
 * 见 `fakes/party.ts`）。少喂的话，上一次开菜单穿的装备、上一场战斗升的级
 * 全都要按等级重算一遍 —— 而重算出来的是一个完全合法的裸属性。
 *
 * 回放真值时**不喂**（真值那几份跑的是一个干净 JVM 里的第一次开菜单），
 * 所以这一项是可选的，缺席时这个函数一个字节都不变。
 */
export interface LiveParty extends Readonly<Attributes> {
  readonly level: number
  readonly hp: number
  readonly mp: number
}

/** 建菜单里那三个人。`fullHeal` 就是剧本 `setup.fullHeal` 那一项。 */
export function createMenuHeroes(
  fullHeal: boolean,
  live?: Readonly<Partial<Record<PartyKey, LiveParty>>>,
): MenuHero[] {
  return MENU_HERO_ORDER.map(({ key, name }) => {
    const now = live?.[key]
    const level = now?.level ?? MENU_DEFAULT_LEVEL[key]
    const base = HEROES[key].attributes(level)
    const weapon = DEFAULT_WEAPONS[key]
    // 喂了实时队伍就**照单全收**，不再走上面那三步：队伍那一份记的就是"此刻
    // 的四项属性"，武器加成已经算在里头了（`fakes/party.ts` 的 `initialMember`
    // 抄的正是这三步）。在它上面再加一次武器，等于开一次菜单加一把刀。
    const attrs: Attributes = now
      ? {
          physicalPower: now.physicalPower,
          agile: now.agile,
          strength: now.strength,
          sprit: now.sprit,
        }
      : {
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
      // 游戏本体喂了实时队伍时用它的血 —— `refreshValue()` 只把超过上限的
      // 夹回去（`if(hp>=hpMax) hp=hpMax`），不往上补。
      hp: now ? Math.min(now.hp, d.hpMax) : fullHeal ? d.hpMax : 0,
      hpMax: d.hpMax,
      mp: now ? Math.min(now.mp, d.mpMax) : fullHeal ? d.mpMax : 0,
      mpMax: d.mpMax,
      defense: d.defense,
      skillDefense: d.skillDefense,
      skillNumber: SKILL_NUMBER[key],
    }
  })
}

/**
 * `Hero.refreshValue()`，只留菜单真值记得到的那四个派生值。
 *
 * 与 `battle/units.ts` 的 `refreshValue` 是同一套算式，但**不能直接复用它**：
 * 那一份要求对象上有 `sprit` 与全部七个派生值（`hurt` / `skillHurt` / `speed`），
 * 而 `MenuHero` 只有四个、且那一项拼的是 `spirit`。硬凑出三个没人核的字段，
 * 等于在状态层里放一份"看起来有人在核"的假数据。
 *
 * ⚠️ 那两句夹回上限**是有观测后果的**：`menu-equip` 第 8 步弃用月苗刀，精气
 * 11→10、`mpMax` 330→300，而 `mp` 那时正是 330 —— 真值里它被夹成了 300，
 * 而第 13 步换回武器时 `mpMax` 回到 330，`mp` **不会**跟着回去（只夹不补）。
 */
export function refreshMenuHero(h: MenuHero): void {
  const d = derive({
    physicalPower: h.physicalPower,
    agile: h.agile,
    strength: h.strength,
    sprit: h.spirit,
  })
  h.hpMax = d.hpMax
  h.mpMax = d.mpMax
  h.defense = d.defense
  h.skillDefense = d.skillDefense
  if (h.hp >= h.hpMax) h.hp = h.hpMax
  if (h.mp >= h.mpMax) h.mp = h.mpMax
}
