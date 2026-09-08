import type { SkillSpec } from './units'
import type { PartyKey } from './units'

/**
 * 技能菜单那几颗按钮，以及点下去之后原版做的三件事（xl-rh9.11 / xl-rh9.14）。
 *
 * 一条技能路径在原版里散在**三个文件**里，这里把三处并成一张表：
 *
 * 1. `SkillMenu.checkReleased` —— 点第 k 颗按钮走 `afterClicked(pattern,
 *    isSlectable, currentBeAttacked)`：选哪种目标、开不开怪物选择器；
 * 2. `LaunchAttack.checkZhang/checkWen/checkLu` —— 那个 pattern 对应
 *    `skillAttack(mpUse, reminderCode, skillCode, hero)`：耗多少灵力、
 *    弹哪一张提示图、放第几号动画；
 * 3. `<主角>.skill(i)` —— 那一号动画的 `backgroundAnimation.set` 与
 *    `skillAnimation.set` 十二个参数。
 *
 * 并成一张表是有代价的：三处的下标不是同一个。**按钮 k（0 基）→ pattern k+2
 * → skillCode k+1**，三个数一路差一。原版就是这么写的，所以这里每一条都把
 * 三个数一起写出来，而不是在某处 `+1`：一个藏在算式里的 +1 抄错了，表现是
 * 「放了隔壁那一招的动画」，画面上完全正常。
 *
 * ## 伤害那一段不在这张表里（xl-rh9.14）
 *
 * 上面三处里只有 1 和 2 是**形状统一**的，第三处（`<主角>.calDamage()` 那个
 * `switch(currentPattern)`）不是：张小凡五条全是 `attackSkill(...)`，文敏的
 * 技能4「妙手回春」一发伤害都不打（给全员回血并复活），陆雪琪的技能1 只挂状态、
 * 技能2 直接改行动条、技能5 每只怪现掷一个状态类型。把这五种形状硬塞进一张表，
 * 就得为原版没有的东西发明一套字段，而**发明出来的字段抄错了和抄对了长得一样**。
 * 所以那一段在 `step.ts` 里按人逐句转写（`zhangCalDamage` / `yuCalDamage` /
 * `luCalDamage`），与原版三个 `calDamage()` 一一对照着读。
 *
 * 这张表留下的是三处里形状统一的那部分：耗多少灵力、弹哪一张提示图、
 * 放第几号动画、背景动画叫什么。
 */

/** `afterClicked(...)` 那三个数。 */
export interface SkillMenuEntry {
  /** `bp.currentPattern`。按钮 k（0 基）恒为 k+2。 */
  readonly pattern: number
  /** 要不要打开怪物选择器。 */
  readonly selectable: boolean
  /** 不用选目标时直接写死的 `bp.currentBeAttacked`（8 = 全体、4 = 我方全体）。 */
  readonly beAttacked: number
}

export interface SkillEntry {
  /**
   * `LaunchAttack.skillAttack(mpUse, …)` 的第一个入参 —— **够不够**用它判。
   *
   * 真正**扣**灵力的是另一处（`attackSkill(baseHurt, offsetHurt, mpUse)` 的第三
   * 个入参，转写在 `step.ts` 的三个 `calDamage` 里）。原版把「判够不够」与
   * 「扣多少」写在两个方法的两个入参上，这一层也就不把它们合成一个字段：
   * 陆雪琪的技能2 两处都是 `(int)(LuXueQi.mpMax*0.6)`，哪天有一处改了，
   * 合成一个的版本推出来的灵力仍然"很正常"。`skills.test.ts` 有一条正面比它们。
   *
   * **可以是个函数**：陆雪琪的技能2 判的不是常数，而是她灵力上限的六成
   * （`(int)(LuXueQi.mpMax*0.6)`，随等级走）。抄成常数的表现是等级一变就错，
   * 而那一场看上去完全正常。
   */
  readonly mpUse: number | ((mpMax: number) => number)
  /** `bp.reminder.show(reminderCode)` —— 传的是**下标**，图是 `<下标+1>.png`。 */
  readonly reminderCode: number
  /** `<主角>.skill(skillCode)` 里那一号。 */
  readonly skillCode: number
  /** `backgroundAnimation.set(name, length)`。 */
  readonly background: { name: string; length: number }
  /** `skillAnimation.set(...)` 十二个参数。 */
  readonly animation: SkillSpec
}

/** `skillAttack` 判够不够时算出来的那个数。 */
export function skillMpUse(entry: SkillEntry, mpMax: number): number {
  return typeof entry.mpUse === 'function' ? entry.mpUse(mpMax) : entry.mpUse
}

/**
 * 每个人的技能菜单上有几颗按钮。
 *
 * 就是 `ZhangXiaoFan.skillNumber` 等三个 **static 字段的初值**。导出器只写
 * `ZhangXiaoFan.level = n` 再 new 一个出来，构造函数一个字都不碰 skillNumber
 * ——**等级再高，菜单上仍然是这几颗**。改 skillNumber 的只有两处：`levelUp()`
 * （战斗胜利结算里，归 xl-rh9.5）与 `intialFromInfo()`（读档，战斗面板走不到）。
 *
 * 判据在 `skills.test.ts`：它打开 GBK 的原版源码把那三个初值解出来再对。
 */
export const SKILL_NUMBER: Readonly<Record<PartyKey, number>> = { zhang: 2, yu: 3, lu: 2 }

/** `image/技能说明/<这个名字>/<n>.png`，也是真值里 `menus.skill.introImage` 的前半。 */
export const SKILL_INTRO_DIR: Readonly<Record<PartyKey, string>> = {
  zhang: '张小凡',
  yu: '文敏',
  lu: '陆雪琪',
}

function entry(
  pattern: number,
  selectable: boolean,
  beAttacked: number,
): SkillMenuEntry {
  return { pattern, selectable, beAttacked }
}

/**
 * `SkillMenu.checkReleased` 里三段 `if(bp.currentRound==k)`，逐颗照抄。
 *
 * ⚠️ 原版对第 3/4/5 颗都套着 `if(<主角>.skillNumber>=n)` —— 也就是说
 * **按钮存在与否由 skillNumber 定，而这张表写的是满级五颗**。菜单实际画几颗、
 * 点得到哪几颗，由 `SKILL_NUMBER` 说了算。
 */
export const SKILL_MENU: Readonly<Record<PartyKey, readonly SkillMenuEntry[]>> = {
  zhang: [
    entry(2, true, 0),
    entry(3, true, 0),
    entry(4, true, 0),
    entry(5, false, 8),
    entry(6, false, 8),
  ],
  yu: [
    entry(2, true, 0),
    entry(3, true, 0),
    entry(4, false, 8),
    entry(5, false, 4),
    entry(6, true, 0),
  ],
  lu: [
    entry(2, false, 8),
    entry(3, false, 8),
    entry(4, false, 8),
    entry(5, true, 0),
    entry(6, false, 8),
  ],
}

function anim(
  name: string,
  length: number,
  x: number,
  y: number,
  beAttackedCode: number,
  beAttackedTimes: number,
  runCode: number,
  attackCode: number,
  withdrawCode: number,
  offsetTo1: number,
  offsetTo2: number,
  offsetTo3: number,
): SkillSpec {
  return {
    name,
    length,
    x,
    y,
    beAttackedCode,
    beAttackedTimes,
    runCode,
    attackCode,
    withdrawCode,
    offsetTo1,
    offsetTo2,
    offsetTo3,
  }
}

/**
 * pattern → 那一招的全部参数。键是 `currentPattern`（2..6），与
 * `SKILL_MENU` 里的 `pattern` 同一个数。
 *
 * **秘术（pattern 7）不在这张表里** —— 它不走 `skillAttack`，是
 * `LaunchAttack` 里另写的一段（全体金钟罩 / 潜能爆发 / 召小精灵），逐句转写在
 * `step.ts` 的 `heroMishu` 里。
 */
export const SKILLS: Readonly<Record<PartyKey, Readonly<Record<number, SkillEntry>>>> = {
  zhang: {
    2: {
      mpUse: 70,
      reminderCode: 0,
      skillCode: 1,
      background: { name: '横剑摆渡', length: 38 },
      animation: anim('张小凡技能1', 37, 150, 90, 8, 3, 10, 32, 37, 0, 180, -120),
    },
    3: {
      mpUse: 120,
      reminderCode: 1,
      skillCode: 2,
      background: { name: '浪里寻花', length: 61 },
      animation: anim('张小凡技能2', 31, 150, 90, 8, 2, 10, 26, 31, 0, 180, -120),
    },
    4: {
      mpUse: 150,
      reminderCode: 2,
      skillCode: 3,
      background: { name: '银鹰掠地', length: 50 },
      animation: anim('张小凡技能3', 31, 150, 90, 8, 2, 7, 28, 31, 0, 180, -120),
    },
    5: {
      mpUse: 160,
      reminderCode: 3,
      skillCode: 4,
      background: { name: '龙翔九天', length: 47 },
      animation: anim('张小凡技能4', 44, 150, 90, 8, 4, 10, 39, 44, 0, 180, -120),
    },
    6: {
      mpUse: 200,
      reminderCode: 4,
      skillCode: 5,
      background: { name: '神剑傲州', length: 51 },
      animation: anim('张小凡技能5', 42, 150, 90, 8, 4, 10, 37, 42, 0, 180, -120),
    },
  },
  yu: {
    2: {
      mpUse: 80,
      reminderCode: 5,
      skillCode: 1,
      background: { name: '伏虎冲天', length: 74 },
      animation: anim('文敏技能1', 28, 120, -80, 8, 6, 9, 22, 28, -150, 0, -260),
    },
    3: {
      mpUse: 120,
      reminderCode: 6,
      skillCode: 2,
      background: { name: '追星破月', length: 41 },
      animation: anim('文敏技能2', 32, 120, -80, 8, 3, 10, 26, 32, -150, 0, -260),
    },
    4: {
      mpUse: 150,
      reminderCode: 7,
      skillCode: 3,
      background: { name: '苍龙盖天', length: 51 },
      animation: anim('文敏技能3', 28, 120, -80, 8, 4, 9, 23, 28, -150, 0, -260),
    },
    5: {
      mpUse: 120,
      reminderCode: 8,
      skillCode: 4,
      background: { name: '妙手回春', length: 23 },
      animation: anim('文敏技能4', 16, 120, -80, 0, 0, 0, 0, 0, 0, 0, 0),
    },
    6: {
      mpUse: 200,
      reminderCode: 9,
      skillCode: 5,
      background: { name: '蝶影神灵', length: 41 },
      animation: anim('文敏技能5', 41, 120, -80, 8, 4, 9, 36, 41, -150, 0, -260),
    },
  },
  // 陆雪琪那五条由 `battle-lu-skills` 盖住（xl-rh9.14）。**技能2 的 mpUse 是个
  // 函数** —— 原版写的是 `skillAttack((int)(LuXueQi.mpMax*0.6), 11, 2, bp.lxq)`，
  // 全表唯一一条不是字面量的耗蓝。抄成常数在某一个等级上完全正确。
  lu: {
    2: {
      mpUse: 80,
      reminderCode: 10,
      skillCode: 1,
      background: { name: '灵凤吐珠', length: 30 },
      animation: anim('陆雪琪技能1', 17, 120, 135, 0, 0, 0, 0, 0, 0, 0, 0),
    },
    3: {
      // `(int)(LuXueQi.mpMax*0.6)`：Java 的 double→int 是向零截尾。
      mpUse: (mpMax) => Math.trunc(mpMax * 0.6),
      reminderCode: 11,
      skillCode: 2,
      background: { name: '踏月无痕', length: 68 },
      animation: anim('陆雪琪技能2', 23, 120, 135, 0, 0, 0, 0, 0, 0, 0, 0),
    },
    4: {
      mpUse: 150,
      reminderCode: 12,
      skillCode: 3,
      background: { name: '星火乾坤圈', length: 38 },
      animation: anim('陆雪琪技能3', 21, 120, 135, 8, 1, 0, 0, 0, 0, 0, 0),
    },
    5: {
      mpUse: 160,
      reminderCode: 13,
      skillCode: 4,
      background: { name: '亟电崩离', length: 30 },
      animation: anim('陆雪琪技能4', 29, 120, 135, 8, 2, 9, 18, 29, 90, 210, -20),
    },
    6: {
      mpUse: 200,
      reminderCode: 14,
      skillCode: 5,
      background: { name: '劈风追月', length: 90 },
      animation: anim('陆雪琪技能5', 29, 120, 135, 8, 11, 9, 22, 29, 90, 210, -20),
    },
  },
}

/**
 * 三个人的秘术动画（xl-rh9.14 抄的，xl-rh9.18 从 `step.ts` 搬到这里 ——
 * 渲染那一头也要按它推图，而 `render/assets.ts` 不该去 import 状态机）。
 *
 * 秘术走「防」按钮（pattern 7），**不在 `SKILLS` / `SKILL_MENU` 里**：它不走
 * `skillAttack`，逐句转写在 `step.ts` 的 `heroMishu`。也因此它**没有背景动画**。
 *
 * `skillAnimation.set(名字, 帧数, x, y, 后面八个全是 0)` ——
 * 后八个是 0 意味着：不触发被击动画、不位移。
 */
export const MISHU_ANIM: Readonly<Record<PartyKey, SkillSpec>> = {
  zhang: mishuAnim('张小凡秘术', 18, 560, 190),
  yu: mishuAnim('文敏秘术', 10, 650, 100),
  lu: mishuAnim('陆雪琪秘术', 8, 620, 300),
}

function mishuAnim(name: string, length: number, x: number, y: number): SkillSpec {
  return {
    name,
    length,
    x,
    y,
    beAttackedCode: 0,
    beAttackedTimes: 0,
    runCode: 0,
    attackCode: 0,
    withdrawCode: 0,
    offsetTo1: 0,
    offsetTo2: 0,
    offsetTo3: 0,
  }
}
