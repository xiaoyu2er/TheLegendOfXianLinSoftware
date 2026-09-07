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

/**
 * `BattleState`。真值里 `state` 那个对象就是它去掉 `isCheck` / `successRate`
 * 的样子（那两个不在真值里：`isCheck` 只在同一拍内做防重入，`successRate`
 * 原版的 `set()` 从来不写它，恒为 0）。
 *
 * `x` / `y` 是 xl-rh9.11 补进真值的：状态图标就画在这两个数上
 * （`BattleState.drawState`），而它们只由 `set(...)` 写一次、此后不动。
 */
export interface BattleState {
  type: number
  roundNum: number
  isUsable: boolean
  isCheck: boolean
  successRate: number
  roleCode: number
  x: number
  y: number
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

/**
 * 技能菜单 / 药品菜单上的一颗按钮。
 *
 * 与 `GameButton` 只差一个 `variant`（`GameButton.buttonImage` 现在贴的是
 * 常态 / 待点 / 按下三张里的哪一张）。**为什么不合并成一个类型**：控制台那
 * 四颗的 `variant` 不在行为真值里，所以它存在渲染那一层的 `PaintState` 里
 * （见 `render/paint.ts` 顶上那段）；菜单这几颗的 `variant` xl-rh9.11 补进了
 * 真值，于是它必须由状态层推出来、并逐字段对上。同一个字段两处维护，迟早
 * 分家，而分家的表现是一颗按钮的高亮对不上 —— 逐帧比对之外看不出来。
 */
export interface MenuButton {
  x: number
  y: number
  width: number
  height: number
  isclicked: boolean
  /** 1 常态 / 2 待点 / 3 按下。 */
  variant: 1 | 2 | 3
}

/**
 * `SkillMenu`（xl-rh9.11）。按钮**三组各建各的**（原版 `zhangButtons` /
 * `wenButtons` / `luButtons`），`buttons` 指向当前回合那一组 —— 与原版
 * `skillButtons` 是同一种别名关系。
 */
export interface SkillMenu {
  isDraw: boolean
  /** `skillButtons` 现在指着谁那一组。构造完就指着张小凡那组（原版最后一句）。 */
  group: 'zhang' | 'yu' | 'lu'
  /** 三组按钮，只有出战的人才有（原版 `if(bp.zxf!=null)`）。 */
  groups: Readonly<Record<'zhang' | 'yu' | 'lu', MenuButton[]>>
  /**
   * 返回按钮。**`checkRound()` 现 new 一颗**，所以点「技」之前它是 null ——
   * 而 `drawSkillMenu` 无条件画它，也就是说菜单画出来时它一定已经有了。
   */
  returnButton: MenuButton | null
  isDrawIntro: boolean
  /** `"张小凡/2"` 这种形状，直接对应 `image/技能说明/<谁>/<n>.png`。 */
  introImage: string | null
  introY: number
}

/** `DrugMenu`（xl-rh9.11）。七颗按钮：六种药 + 返回。 */
export interface DrugMenu {
  isDraw: boolean
  buttons: MenuButton[]
  isDrawIntro: boolean
  /** 介绍的是第几种药（0 基，与 `drugs.ts` 的 `DRUGS` 同序）。 */
  introDrug: number | null
  introY: number
  introText: string | null
  /**
   * `checkHero()` 定下来的「这一回合是谁在用药」，1/2/3；还没定是 0。
   * 不在真值里（原版是个对象引用），但 `checkDrugNumber` 要它。
   */
  currentHero: number
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
  /**
   * 画的是**第几张图**（文件号，`image/提示图/<image>.png`），没显示过是 null。
   *
   * ⚠️ **与 `show(i)` 的入参差一。** `Reminder.loadImage()` 把 `1.png`..`22.png`
   * 依次装进 `images`，而 `show(i)` 取的是 `images.get(i)` —— 所以
   * `show(19)`（药品存货不足）画的是 **20.png**。真值里记的就是这个文件号，
   * 那个 +1 只在 `showReminder()` 里做一次。
   */
  image: number | null
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

/**
 * `GameOver`：全灭图从两侧对开，开满之后再数十下，然后按**第一只怪的名字**
 * 分岔（回地图 / 回标题）。
 *
 * 原版有十六个坐标，这里只留会动的那四个 —— 另外十二个是构造函数里写死、
 * 此后只被 `drawGameOver` 读的常量，改了它们状态层一个字段都不会变。真正
 * 定时的是 `lsx2`：每拍 +8，到 512 才开始数 `code`。
 */
export interface GameOverAnim {
  isDraw: boolean
  isStop: boolean
  code: number
  ldx2: number
  lsx2: number
  rdx1: number
  rsx1: number
}

/** `GameLauncher.switchTo` 切到了哪一块面板。还没切是 null。 */
export type ExitPanel = 'scenePanel' | 'startPanel'

export interface BattleWorld {
  /** 逻辑拍号，等价于导出器的 `t`；每调一次 `stepBattle` 加一。 */
  tick: number
  /**
   * `GameLauncher.switchTo(...)` 把面板切到了哪一块 —— 还没切是 `null`。
   *
   * 打输的两条出口只靠 `GameOver.update()` 里一句字符串比较分岔，而**分岔的
   * 结果本身不在逐字段真值里**（导出器的 `snapshotState` 不取它）。它记在真值
   * 头部的剧本回显里：那条 `awaitExit` 指令的 `panel`，由导出器在原版真的切
   * 面板的那一刻当场核过（`BattleDriver.awaitExit`）。所以这一层把它推出来，
   * 再和剧本里那一行比 —— 两边都不是手写的期望值。
   */
  exitPanel: ExitPanel | null
  /** 一场战斗共用**一条**随机流，取数顺序也是规格（ADR-0004）。 */
  random: JavaRandom
  background: string
  bgm: string | null

  currentRound: number
  currentPattern: number
  currentBeAttacked: number

  /**
   * `bp.heroes`。**会被清空**：两条打输出口的末尾都有一句 `bp.heroes.clear()`，
   * 而循环体里每一处 `for(Hero h: bp.heroes)` 读的就是它。
   */
  heroes: Hero[]
  /**
   * 出战名单，**从头到尾不变**。快照读的是它，不是 `heroes` —— 导出器
   * `BattleDriver` 也是在开场时把名单抄进自己的 `party` 里再逐拍取值的，
   * 所以末步那一次 `heroes.clear()` 在真值里看不见（人还在，血量与 isDraw
   * 都还在变）。拿 `heroes` 当快照源的话，末步会变成一个空数组。
   */
  party: Hero[]
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

  skillMenu: SkillMenu
  drugMenu: DrugMenu
  /**
   * 六种药各自还剩几个（`DrugPack.drugList.get(i).getNumberGOT()`）。
   *
   * 原版是个 **static** 列表，跨战斗、跨面板共用；这一层把它挂在世界上，因为
   * 一份真值就是一场战斗。新开档一个都没有（`ShopReader` 不给 `numberGOT`
   * 赋值，数据文件里也没有那一列），所以它全是 0 —— 而"全是 0"正是
   * `battle-menus` 那条剧本点下去走提示图的前提。
   */
  drugStock: number[]
  victoryDrawn: boolean
  victoryStopped: boolean
  gameOver: GameOverAnim
  /** 胜利那段还没实现的收尾跑了几拍 —— 见 `step.ts` 的 `updateVictoryReminder`。 */
  victoryUpdates: number
  /** `VictoryReminder.expToGet`：开场时按三只怪的经验合计算死。 */
  expToGet: number

  /** 鼠标当前位置（`BattlePanel.currentX/currentY`）。 */
  currentX: number
  currentY: number
}
