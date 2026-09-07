import type { SkillSpec } from './units'
import type { PartyKey } from './units'

/**
 * 技能菜单那几颗按钮，以及点下去之后原版做的三件事（xl-rh9.11）。
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
 * ## 只有两条是实现了的
 *
 * `damage` 为 `null` 的那几条今天**没有移植**：`step.ts` 走到它们会当场抛并
 * 点名 xl-rh9.14。表本身仍然写全 —— 菜单要按真实的按钮数画出来，而
 * 「这一颗按钮存不存在」与「点下去做什么」是两件事。
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

/** 一次 `attackSkill(baseHurt, offsetHurt, mpUse)`。 */
export interface AttackSkillDamage {
  readonly kind: 'attack'
  readonly baseHurt: number
  readonly offsetHurt: number
  readonly mpUse: number
  /**
   * 打完之后给**每个挨打的怪**挂的状态（`e.battleState.set(...)` +
   * `e.checkState()`），没有就是 null。
   */
  readonly enemyState: { rounds: number; type: number; successRate: number } | null
  /** 打完之后给**自己**挂的状态（`battleState.set(..., roleCode, showX, showY)`）。 */
  readonly selfState: { rounds: number; type: number; successRate: number } | null
}

export interface SkillEntry {
  /** `LaunchAttack` 里那一支的 `skillAttack(mpUse, ...)`。 */
  readonly mpUse: number
  /** `bp.reminder.show(reminderCode)` —— 传的是**下标**，图是 `<下标+1>.png`。 */
  readonly reminderCode: number
  /** `<主角>.skill(skillCode)` 里那一号。 */
  readonly skillCode: number
  /** `backgroundAnimation.set(name, length)`。 */
  readonly background: { name: string; length: number }
  /** `skillAnimation.set(...)` 十二个参数。 */
  readonly animation: SkillSpec
  /** `calDamage` 里那一支。`null` = 还没移植（归 xl-rh9.14）。 */
  readonly damage: AttackSkillDamage | null
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

/** 还没移植的那几条：表写全，`damage` 留 null，走到就抛。 */
const NOT_PORTED = null

/**
 * pattern → 那一招的全部参数。键是 `currentPattern`（2..6），与
 * `SKILL_MENU` 里的 `pattern` 同一个数。
 *
 * **秘术（pattern 7）不在这张表里** —— 它不走 `skillAttack`，是
 * `LaunchAttack` 里另写的一段（全体金钟罩 / 潜能爆发 / 召小精灵），归 xl-rh9.14。
 */
export const SKILLS: Readonly<Record<PartyKey, Readonly<Record<number, SkillEntry>>>> = {
  zhang: {
    2: {
      mpUse: 70,
      reminderCode: 0,
      skillCode: 1,
      background: { name: '横剑摆渡', length: 38 },
      animation: anim('张小凡技能1', 37, 150, 90, 8, 3, 10, 32, 37, 0, 180, -120),
      damage: NOT_PORTED,
    },
    3: {
      mpUse: 120,
      reminderCode: 1,
      skillCode: 2,
      background: { name: '浪里寻花', length: 61 },
      animation: anim('张小凡技能2', 31, 150, 90, 8, 2, 10, 26, 31, 0, 180, -120),
      // `attackSkill(200,60,120)` + 每个挨打的怪 100% 进「体力下降」（type 8）。
      damage: {
        kind: 'attack',
        baseHurt: 200,
        offsetHurt: 60,
        mpUse: 120,
        enemyState: { rounds: 2, type: 8, successRate: 100 },
        selfState: null,
      },
    },
    4: {
      mpUse: 150,
      reminderCode: 2,
      skillCode: 3,
      background: { name: '银鹰掠地', length: 50 },
      animation: anim('张小凡技能3', 31, 150, 90, 8, 2, 7, 28, 31, 0, 180, -120),
      damage: NOT_PORTED,
    },
    5: {
      mpUse: 160,
      reminderCode: 3,
      skillCode: 4,
      background: { name: '龙翔九天', length: 47 },
      animation: anim('张小凡技能4', 44, 150, 90, 8, 4, 10, 39, 44, 0, 180, -120),
      damage: NOT_PORTED,
    },
    6: {
      mpUse: 200,
      reminderCode: 4,
      skillCode: 5,
      background: { name: '神剑傲州', length: 51 },
      animation: anim('张小凡技能5', 42, 150, 90, 8, 4, 10, 37, 42, 0, 180, -120),
      damage: NOT_PORTED,
    },
  },
  yu: {
    2: {
      mpUse: 80,
      reminderCode: 5,
      skillCode: 1,
      background: { name: '伏虎冲天', length: 74 },
      animation: anim('文敏技能1', 28, 120, -80, 8, 6, 9, 22, 28, -150, 0, -260),
      damage: NOT_PORTED,
    },
    3: {
      mpUse: 120,
      reminderCode: 6,
      skillCode: 2,
      background: { name: '追星破月', length: 41 },
      animation: anim('文敏技能2', 32, 120, -80, 8, 3, 10, 26, 32, -150, 0, -260),
      // `attackSkill(250,15,120)` + 自身 100% 进「敏捷提升」（type 1）。
      damage: {
        kind: 'attack',
        baseHurt: 250,
        offsetHurt: 15,
        mpUse: 120,
        enemyState: null,
        selfState: { rounds: 2, type: 1, successRate: 100 },
      },
    },
    4: {
      mpUse: 150,
      reminderCode: 7,
      skillCode: 3,
      background: { name: '苍龙盖天', length: 51 },
      animation: anim('文敏技能3', 28, 120, -80, 8, 4, 9, 23, 28, -150, 0, -260),
      damage: NOT_PORTED,
    },
    5: {
      mpUse: 120,
      reminderCode: 8,
      skillCode: 4,
      background: { name: '妙手回春', length: 23 },
      animation: anim('文敏技能4', 16, 120, -80, 0, 0, 0, 0, 0, 0, 0, 0),
      damage: NOT_PORTED,
    },
    6: {
      mpUse: 200,
      reminderCode: 9,
      skillCode: 5,
      background: { name: '蝶影神灵', length: 41 },
      animation: anim('文敏技能5', 41, 120, -80, 8, 4, 9, 36, 41, -150, 0, -260),
      damage: NOT_PORTED,
    },
  },
  // 陆雪琪那五条一条都没移植（她的技能菜单在 battle-menus 里没被点过）。
  // 表留空 —— 写一份没人核过的十二参数表，抄错了和抄对了长得一模一样。
  lu: {},
}
