import { declareFake } from './fake'
import { HEROES, derive, expToLevelUp } from '../battle/units'
import type { Attributes, PartyKey } from '../battle/units'
import { DEFAULT_WEAPONS, withWeapon } from '../menu/defaultWeapons'
import { MENU_HERO_ORDER } from '../menu/heroes'
import type { MenuHero } from '../menu/heroes'
import type { HeroCarry } from '../battle/world'

/**
 * **假的队伍**（`battle.ZhangXiaoFan` / `YuJie` / `LuXueQi` 那三组静态字段）。
 * 归 xl-6lo.1（M3 菜单 / 存档）。
 *
 * 原版这三个人是 `GameLauncher` 的三个**静态引用**，从开机建出来到关机为止
 * 就那一份对象，字段大半还是 `static`。于是等级、经验、血、灵力、死没死
 * **跨战斗活着** —— `BattlePanel.initial()` 不重置它们，只做一件事：上一场
 * 死过的人复活，血是 0 的回到上限的 10%。
 *
 * 这一层的 `createBattle` 每一场都新建三个满血的人（回放真值时那是对的：
 * 导出器每一份真值都是一个干净 JVM 里的第一场）。要让游戏本体连着打第二场，
 * 就得有个地方把上一场的结果记下来 —— 就是这个模块。
 *
 * ## 这一份假在哪
 *
 * - **不读存档，也不写存档**。原版的 `intialFromInfo()` 从 `save/` 读回全部
 *   字段，`roleInfo` 再写回去；这里的初值是三个类的**静态字段初值**
 *   （张小凡 1 级、文敏 3 级、陆雪琪 1 级），刷新页面就回到开局。
 * - **只记十样**：等级、经验、血、灵力、死没死、怒气，外加四项基础属性。
 *   原版那三个对象上跨场活着的字段还不止这些（`isGetSkill`、`skillNumber`、
 *   `battleState` 里的临时增益…）。少记的那些今天在游戏本体里都还没有来源
 *   ——学技能归 M3，商店归 M4 —— 所以不是"忘了"，是**这一票造不出真的值**。
 * - **穿在身上的是什么记不住**，只记它加出来的属性（xl-6lo.16）。菜单世界
 *   每次开菜单都重建（`session.ts` 的 `Session.menu`），于是装备页那六个槽位
 *   与全局背包活不过一次关菜单。今天到不了：游戏本体里装备的唯一来源是装备
 *   超市（M4，xl-knp），`openMenu` 不喂 `equipment`，六张表的持有量全是 0。
 *   跟踪票 xl-6lo.18。
 *
 * 真的那一份要连存档格式一起做，见 xl-6lo.1。
 *
 * ## 四项属性为什么从"不记"改成了"记"（xl-6lo.16）
 *
 * 原先这里写着「四项属性由等级唯一决定，所以记了等级就等于记了属性」，并且
 * 自己留了一句「哪天有装备加成，这条就不成立了」。**那一天就是菜单做出来
 * 的那天**：`EquipPanel` 的构造函数 `addPack()` 给三个人各穿一把开局武器并把
 * 四项加成 `+=` 上去（`menu/defaultWeapons.ts`），而原版那三个类的属性字段
 * 全是 `static` —— 也就是说**开机建 `MenuPanel` 的那一刻，战斗那边读到的属性
 * 就已经带着武器加成了**（`GameLauncher` 构造函数里
 * `menuPanel=new MenuPanel(zhangXiaoFan,luXueQi,yuJie)` 传的正是那三个对象）。
 *
 * 所以队伍这一份**必须记属性**，而且出厂值就要带上那三把武器：不记的话，
 * 菜单里喝药喝到 1190 点气血的玉洁一进战斗就被 `refreshValue()` 夹回 980 ——
 * 而"夹回去了"和"本来就是 980"在画面上长得一样。
 */
export const FAKE = declareFake('party')

/**
 * 跨战斗活着的那几样。
 *
 * **六个字段里有五个直接就是 `battle/world.ts` 的 `HeroCarry`** ——
 * `createBattle` 的 `carry` 收的就是那个类型，所以这里 `extends` 它而不是
 * 再抄一份：抄一份的话，将来往 `HeroCarry` 里加一样东西，这边不加也编得过，
 * 而表现是"那一样跨不过战斗"，画面上完全正常。
 *
 * 多出来的两样是 `level` 与四项基础属性（`Attributes`）：两者都不在
 * `HeroCarry` 里，因为 `createBattle` 是从 `levels` / `attributes` 两个参数
 * 拿它们的（真值回放时剧本自己写等级，与队伍无关）。
 *
 * ⚠️ **四项属性是"此刻的值"，不是"按等级算出来的值"** —— 它们带着装备加成
 * （出厂就带着开局那三把武器），也带着 `levelUp()` 那四行 `+=` 的结果。拿
 * `HEROES[key].attributes(level)` 去核它是错的，见文件头注。
 */
export interface PartyMemberState extends HeroCarry, Attributes {
  level: number
  /**
   * `isAngry`（xl-i06.9）。原版是英雄实例字段，初值 `false`；战斗里
   * `Enemy` 把它置真、`LaunchAttack` 放完怒气技再置假，**打完不清** —— 所以
   * 战斗外它是上一场收尾时的值，存档第 2–4 行的第 5 项存的就是它。
   *
   * **只记不读**：它不在 `HeroCarry` 里，下一场战斗建人时不从这里取（那是另一回事，
   * 与存档无关）。存档要它，所以从战斗那边记回来。
   */
  isAngry: boolean
}

/**
 * 三个人的**出厂等级**：`ZhangXiaoFan.level=1` / `YuJie.level=3` /
 * `LuXueQi.level=1`（三个类里那三行 `public static int level=`）。
 *
 * 三个数各不相同，而 `createBattle` 对缺等级是**抛**不是给默认值 —— 所以
 * 这张表是游戏本体唯一的等级来源，抄错一个数整场仗的每一个伤害数字都会变。
 */
export const DEFAULT_LEVEL: Readonly<Record<PartyKey, number>> = {
  zhang: 1,
  yu: 3,
  lu: 1,
}

/**
 * 一个人的开局状态，逐句照抄 `GameLauncher` 构造函数里那两行的**先后**：
 *
 * 1. `new ZhangXiaoFan(x,y,battlePanel)` —— 带面板的那个构造函数按等级重算
 *    四项属性、`refreshValue()`，末尾 `hp=hpMax; mp=mpMax;`。**这一步的
 *    上限是没穿武器的上限**。
 * 2. `new MenuPanel(zhangXiaoFan,luXueQi,yuJie)` —— 里头 `new EquipPanel()`
 *    的构造函数调 `addPack()`，四项属性各 `+=` 一次武器加成，再
 *    `refreshValue()`。而 `refreshValue()` **只往下夹、不往上补**
 *    （`if(hp>=hpMax) hp=hpMax`）。
 *
 * 次序是有观测后果的，不是排版：玉洁那把鸳鸯刀 `+3` 体力，于是她的 `hpMax`
 * 是 1190 而 `hp` 停在 980 —— **开局就不是满血**（三级、体力 14 → 17）。
 * 倒过来做（先穿武器再 `hp=hpMax`）会得到 1190，一个完全合法、完全错误的数。
 * 三个人开局都有一样够不着上限：张小凡是灵力（300 / 330），陆雪琪也是
 * （360 / 420）。这三对数是 2026-09-09 现算的读数，不是规格 —— 改了武器表
 * 或等级公式它们就变了，判据在 `party.test.ts`（那里不写数，只写关系）。
 */
export function initialMember(key: PartyKey): PartyMemberState {
  const level = DEFAULT_LEVEL[key]
  const base = HEROES[key].attributes(level)
  // 第 1 步：血与灵力**满**，满的是穿武器之前的上限。
  const before = derive(base)
  const member: PartyMemberState = {
    level,
    ...withWeapon(base, DEFAULT_WEAPONS[key]),
    exp: 0,
    hp: before.hpMax,
    mp: before.mpMax,
    isDead: false,
    angryValue: 0,
    isAngry: false,
  }
  // 第 2 步末尾那句 `refreshValue()` 的两句夹上限。**这三把开局武器**的四个
  // 加成都非负，上限只涨不跌，所以在这个函数里它是空操作 —— 照抄是因为
  // "今天是空操作"不是"可以不写"。
  //
  // ⚠️ 别把这句读成"原版没有减属性的装备"：`equipment.ts` 的武器表里就有一件
  // 御衡镇日刀（`addSpirit: -10`、`user: 4` 玉洁穿得上），穿上它 `mpMax` 会掉，
  // 那两句当场就有观测后果 —— 只不过那条路走的是装备页的 `refreshMenuHero`，
  // 不是这里。（本注释原先断言"原版六张表里没有"，是错的，/code-review 标准轴
  // 现读表抓到的。）
  const after = derive(member)
  if (member.hp >= after.hpMax) member.hp = after.hpMax
  if (member.mp >= after.mpMax) member.mp = after.mpMax
  return member
}

/**
 * 从一个带四项属性的东西上把那四项挑出来。
 *
 * 有它是因为 `Attributes` 这个类型已经存在，而"逐字段展开"在这一片曾经抄了
 * 五份（/code-review 标准轴的 Data Clumps）——抄一份的表现是将来 `Attributes`
 * 多一项时那一份静默不跟，而少的那一项跨不过战斗 / 菜单，画面上完全正常。
 */
export function attributesOf(a: Attributes): Attributes {
  return {
    physicalPower: a.physicalPower,
    agile: a.agile,
    strength: a.strength,
    sprit: a.sprit,
  }
}

/** 原版那三个静态引用的位置：模块级单例。 */
let party: Record<PartyKey, PartyMemberState> = fresh()

function fresh(): Record<PartyKey, PartyMemberState> {
  return { zhang: initialMember('zhang'), yu: initialMember('yu'), lu: initialMember('lu') }
}

/** 队伍此刻的状态。**返回的是活的对象** —— 与原版的静态字段同一个语义。 */
export function getParty(): Readonly<Record<PartyKey, PartyMemberState>> {
  return party
}

/** 三个人现在各是几级。`createBattle` 的 `levels` 要它。 */
export function partyLevels(): Readonly<Record<PartyKey, number>> {
  return { zhang: party.zhang.level, yu: party.yu.level, lu: party.lu.level }
}

/**
 * 一场打完，把出战那几个人的结果记回去。
 *
 * 只记**出战的人**：没出战的那一位原版的静态字段一个字都没被动过。
 */
export function rememberParty(
  heroes: readonly ({ spec: { key: PartyKey } } & PartyMemberState)[],
): void {
  for (const h of heroes) {
    party[h.spec.key] = {
      level: h.level,
      // 四项属性也要记：`levelUp()` 加的是**当前值**（`levelUpDelta` 那四行
      // `+=`），不是按新等级重算。只记等级的话，一个穿着武器升了级的人下一场
      // 会退回"按等级算出来的裸属性"—— 而那个数完全合法。
      ...attributesOf(h),
      exp: h.exp,
      hp: h.hp,
      mp: h.mp,
      isDead: h.isDead,
      angryValue: h.angryValue,
      isAngry: h.isAngry,
    }
  }
}

/**
 * 关菜单（其实是**每一拍**）把菜单里那三个人记回队伍 —— xl-6lo.16。
 *
 * 原版没有这一步，因为它根本不需要：`MenuPanel` 的 `hero1/hero2/hero4` 就是
 * `GameLauncher` 的那三个对象，而它们的数据字段几乎全是 `static`。喝药那句
 * `DrugPanel.addValue()` 改的就是战斗与场景读的同一份东西。这一层的菜单世界
 * 是另建的一份（`session.ts` 的 `Session.menu`），于是那件"本来就发生了"的事
 * 变成了显式的一次搬运。
 *
 * **记五样**：四项基础属性与等级，加上血与灵力。派生值（hpMax / mpMax /
 * defense / skillDefense）**不记** —— 它们由四项属性唯一决定（`derive`），
 * 记一份等于让同一个事实有两个出处，而两个出处对不上的时候没人会响。
 *
 * 经验 / 死没死 / 怒气不记：菜单里没有任何一条路改得动它们（改得动的话这里
 * 会漏，而漏了的样子是"关菜单之后那一样退回去了"）。
 */
export function rememberMenuParty(heroes: readonly MenuHero[]): void {
  if (heroes.length !== MENU_HERO_ORDER.length) {
    // 菜单那三个人是按 `MENU_HERO_ORDER` 建的，这里按同一个次序读回去。
    // 长度对不上就说明两边分了家，而分了家的表现是"记到了别人身上"。
    throw new Error(
      `菜单里应当恰好 ${MENU_HERO_ORDER.length} 个人，实际 ${heroes.length} 个`,
    )
  }
  MENU_HERO_ORDER.forEach(({ key, name }, i) => {
    const h = heroes[i]!
    if (h.name !== name) {
      throw new Error(`菜单第 ${i} 个人应当是 ${name}，实际 ${h.name}`)
    }
    const m = party[key]
    m.level = h.level
    m.physicalPower = h.physicalPower
    m.agile = h.agile
    m.strength = h.strength
    // ⚠️ 原版那个字段拼的是 `sprit`，菜单真值那一列叫 `spirit`（`heroes.ts`）。
    //
    // /code-review 的标准轴提过「把 `MenuHero.spirit` 统一成 `sprit`，这个转接
    // 点就没了」。**实测不成立，所以没改**：`tools/traces/out/menu-equip.trace.json`
    // 里 `"spirit"` 出现 101 次、`"sprit"` 0 次 —— 真值那一列就叫 `spirit`，
    // 而 `snapshotMenu` 必须按那个名字出。改了名，转接点只是从这里挪进
    // `snapshot.ts`，也就是挪进逐字段比真值的那条路上 —— 那比放在这里更糟。
    m.sprit = h.spirit
    m.hp = h.hp
    m.mp = h.mp
  })
}

/**
 * 还差多少经验升级 —— `expToLevelUp(level) - exp`，与 `victoryInformation`
 * 读的是同一条公式。**只给判据与菜单用**：战斗世界自己会算。
 */
export function expToNextLevel(key: PartyKey): number {
  return Math.max(0, expToLevelUp(party[key].level) - party[key].exp)
}

/**
 * 回到开局。原版没有这个方法（它的队伍是进程级静态字段），这里要它是因为
 * 测试之间不能互相污染 —— "上一条用例打剩的半血"与"这一场真的挨了打"
 * 长得一样。
 */
export function resetParty(): void {
  party = fresh()
}
