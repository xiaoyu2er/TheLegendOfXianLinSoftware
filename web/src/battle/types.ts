import type { EnemySpec, HeroSpec, SkillSpec } from './units'
import type { JavaRandom } from '../game/javaRandom'

/**
 * 战斗世界的**形状**。字段名与原版 `src/battle/` 下的字段一一对应，刻意不改名
 * ——这一层的唯一判据是逐字段对上行为真值，中间多一道翻译就多一个错位的地方。
 *
 * 整个模型是**可变**的，和原版一样：`bp.em1` 与 `bp.enemies` 里那一项是同一个
 * 对象，怪物死掉是把 `em1` 置 null 而对象仍在 `slots` 里留着（负血与最后一击的
 * 伤害数字都从那里读）。改成不可变要在每一处重建别名关系，而别名关系正是这里
 * 要复刻的东西。
 */

/** `BattleState`。四个字段就是真值里 `state` 那个对象。 */
export interface BattleState {
  type: number
  roundNum: number
  isUsable: boolean
  isCheck: boolean
  successRate: number
  roleCode: number
}

/** `BeAttackedAnimation` / `DeadAnimation` / `VictoryAnimation` 共用的帧计数器。 */
export interface FrameAnim {
  code: number
  length: number
  isDraw: boolean
  isStop: boolean
}

/** `BeAttackedAnimation` 比上面多一个"播几遍"。 */
export interface BeAttackedAnim extends FrameAnim {
  currentTime: number
  times: number
}

export interface Hero {
  spec: HeroSpec
  roleCode: 1 | 2 | 3
  x: number
  y: number
  showX: number
  showY: number
  level: number
  /** `doAction()` 的计数器，真值里的 `heroes[].frame`。 */
  code: number
  isDraw: boolean
  isStop: boolean
  isDead: boolean
  isAngry: boolean
  angryValue: number
  hp: number
  mp: number
  hpMax: number
  mpMax: number
  physicalPower: number
  sprit: number
  agile: number
  strength: number
  speed: number
  hurt: number
  skillHurt: number
  defense: number
  skillDefense: number
  exp: number
  expToLevelUp: number
  isLevelUp: boolean
  battleState: BattleState
  beAttackedAnimation: BeAttackedAnim
  victoryAnimation: FrameAnim
  deadAnimation: FrameAnim
}

export interface Enemy {
  name: string
  /** 5 / 6 / 7，同时是站位与 `currentBeAttacked` 的编码。 */
  roleCode: 5 | 6 | 7
  spec: EnemySpec
  x: number
  y: number
  /** 出场图的像素尺寸，`EnemySlector` 量的就是它（`Images.get(0)`）。 */
  width: number
  height: number
  code: number
  isDraw: boolean
  isStop: boolean
  isDead: boolean
  speed: number
  hp: number
  hurt: number
  skillHurt: number
  defense: number
  hurtMax: number
  skillHurtMax: number
  defenseMax: number
  battleState: BattleState
  beAttackedAnimation: BeAttackedAnim
  /** `loadAnimation()` 现算出来的那一发 `setSkill(...)`。 */
  skill: SkillSpec
}

/** `HurtValue`：一次伤害就 new 一个，动画播完自己收摊。 */
export interface HurtValue {
  hurt: number
  type: number
  x: number
  y: number
  code: number
  isDraw: boolean
  isStop: boolean
}

/** `ProgressBar`：原版的行动条只有像素位置这一个量。 */
export interface ProgressBar {
  barX: number
  zhangX: number
  yuX: number
  luX: number
  petX: number
  enemy1X: number
  enemy2X: number
  enemy3X: number
  isDraw: boolean
  isStop: boolean
}

/** `SkillAnimation`。`set()` **不重置 `code`** —— 那是原版的行为，照抄。 */
export interface SkillAnimation extends SkillSpec {
  initialX: number
  initialY: number
  code: number
  isDraw: boolean
  isStop: boolean
  isOver: boolean
  /** 还没 `set` 过时是 null，真值里的 `anim.skill` 也是 null。 */
  named: boolean
}

export interface BackgroundAnimation {
  name: string | null
  length: number
  code: number
  isDraw: boolean
  isStop: boolean
  isOver: boolean
}

/** `EnemySlector` 那九个字段。第三槽判高时用的是 `height1` —— xl-1dv.8，照抄。 */
export interface EnemySelector {
  isSlectable: boolean
  x1: number
  y1: number
  width1: number
  height1: number
  x2: number
  y2: number
  width2: number
  height2: number
  x3: number
  y3: number
  width3: number
  height3: number
}

/** `GameButton`：命中框比绘制位置左偏 15、上偏 6（xl-1dv 清单里的一条）。 */
export interface GameButton {
  x: number
  y: number
  width: number
  height: number
  isclicked: boolean
}

export interface Command {
  isDraw: boolean
  attack: GameButton
  skill: GameButton
  defend: GameButton
  thing: GameButton
}

export interface Instruct {
  code: number
  isDraw: boolean
  isStop: boolean
  /** `Instruct.start()` 里那个三路 switch 算出来的落点。 */
  x: number
  y: number
}

export interface Reminder {
  code: number
  isDraw: boolean
  isStop: boolean
  centreX: number
  centreY: number
  dx1: number
  dx2: number
  dy1: number
  dy2: number
}

/** `StartAnimation`：云雾**对开**，左半幅每拍 +30、右半幅每拍 -30。 */
export interface StartAnimation {
  leftX: number
  rightX: number
  isDraw: boolean
  isStop: boolean
}

export interface BattleWorld {
  /** 逻辑拍号，等价于导出器的 `t`；每调一次 `stepBattle` 加一。 */
  tick: number
  /** 一场战斗共用**一条**随机流，取数顺序也是规格（ADR-0004）。 */
  random: JavaRandom
  background: string
  bgm: string | null

  currentRound: number
  currentPattern: number
  currentBeAttacked: number

  heroes: Hero[]
  zxf: Hero | null
  yj: Hero | null
  lxq: Hero | null

  /** 三个槽位，**死掉也留着引用**：负血与最后一击的伤害在这里才看得见。 */
  slots: (Enemy | null)[]
  em1: Enemy | null
  em2: Enemy | null
  em3: Enemy | null
  /** `bp.enemies`：加入顺序是 em2 → em1 → em3，死了就摘掉。 */
  enemies: Enemy[]

  progressBar: ProgressBar
  command: Command
  instruct: Instruct
  reminder: Reminder
  selector: EnemySelector
  skillAnimation: SkillAnimation
  backgroundAnimation: BackgroundAnimation
  startAnimation: StartAnimation
  hurtValues: HurtValue[]

  /** `LaunchAttack.code`：怪物出手前那 5 拍前摇，整个发动器共用一个计数器。 */
  launchCode: number

  skillMenuDrawn: boolean
  drugMenuDrawn: boolean
  victoryDrawn: boolean
  victoryStopped: boolean
  gameOverDrawn: boolean
  gameOverStopped: boolean
  /** 那两段还没实现的收尾各自跑了几拍 —— 见 `step.ts` 的 update 守卫。 */
  victoryUpdates: number
  gameOverUpdates: number
  /** `VictoryReminder.expToGet`：开场时按三只怪的经验合计算死。 */
  expToGet: number

  /** 鼠标当前位置（`BattlePanel.currentX/currentY`）。 */
  currentX: number
  currentY: number
}
