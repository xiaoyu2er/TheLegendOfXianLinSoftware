import { declareFake } from './fake'
import { HEROES, derive, expToLevelUp } from '../battle/units'
import type { PartyKey } from '../battle/units'
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
 * - **只记六样**：等级、经验、血、灵力、死没死、怒气。原版那三个对象上跨场
 *   活着的字段远不止六个（`isGetSkill`、`skillNumber`、装备加成、
 *   `battleState` 里的临时增益…）。少记的那些今天在游戏本体里都还没有来源
 *   ——装备归 M4，学技能归 M3 —— 所以不是"忘了"，是**这一票造不出真的值**。
 * - **四项属性不记**，因为它们由等级唯一决定：三个人的 `levelUp()` 增量与
 *   `attributes(level)` 的斜率逐项相同（units.ts 里那两组常量），所以记了
 *   等级就等于记了属性。哪天有装备加成，这条就不成立了，那时要一起改。
 *
 * 真的那一份要连存档格式一起做，见 xl-6lo.1。
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
 * 多出来的那一个是 `level`：它不在 `HeroCarry` 里，因为 `createBattle` 是从
 * `levels` 那个参数拿等级的（真值回放时剧本自己写等级，与队伍无关）。
 */
export interface PartyMemberState extends HeroCarry {
  level: number
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
 * 一个人的开局状态：属性按等级算，血与灵力**满**（三个构造函数末尾那两句
 * `hp=hpMax; mp=mpMax;`），经验 0，怒气 0。
 */
export function initialMember(key: PartyKey): PartyMemberState {
  const level = DEFAULT_LEVEL[key]
  const d = derive(HEROES[key].attributes(level))
  return { level, exp: 0, hp: d.hpMax, mp: d.mpMax, isDead: false, angryValue: 0 }
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
      exp: h.exp,
      hp: h.hp,
      mp: h.mp,
      isDead: h.isDead,
      angryValue: h.angryValue,
    }
  }
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
