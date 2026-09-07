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

/**
 * `Pet` —— 陆雪琪的秘术召出来的小精灵（xl-rh9.14）。
 *
 * 它是**整场战斗里唯一会中途诞生的单位**：`bp.pet` 一开始是 null，
 * `LaunchAttack.checkLu` 的 pattern 7 那一支里 `new Pet(bp)`。在此之前
 * `ProgressBar.updateProgress` 的 `if(bp.pet!=null){petX+=…}` 与
 * `currentRound==4` 那一支都恒不执行。
 *
 * **它一个字段都不在行为真值里**（导出器的 `snapshotState` 没取它）。看得见的
 * 是它的后果：`bar.pet` 会开始爬、`round` 会出现 4、`anim.skill` 会变成
 * 「小精灵攻击」、怪物身上会多出一笔伤害数字。所以这里只留推得出后果的那几个
 * 字段，`y`（`update()` 里上下浮动的那个）留着是给渲染那一层用的。
 */
export interface Pet {
  x: number
  y: number
  /** `(int)((ZhangXiaoFan.speed+LuXueQi.speed+YuJie.speed)/3)`，召出来那一刻算死。 */
  speed: number
  /** `(int)((ZhangXiaoFan.hurt+LuXueQi.hurt+YuJie.hurt)/3)`。 */
  power: number
  isDraw: boolean
  isStop: boolean
  code: number
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
   *
   * **不在真值里**（原版是个 `Hero` 引用，导出器取不出可断言的形状），也就是说
   * 它写错了今天观测不到 —— 唯一读它的是「真的用药」那一路，而那一路今天
   * 一次都走不到（存货恒为 0，归 xl-rh9.14）。等那一路做出来，它会由回血/回蓝
   * 落在谁身上暴露出来。
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

/**
 * `VictoryReminder` —— 打赢之后的结算。字段名照抄原版（`thing_dx1` 这类下划线
 * 名字改成小驼峰，别的一个不改），逐句实现在 `victory.ts`。
 *
 * ⚠️ **这一整块没有行为真值覆盖**：五份 driver=battle 的真值里，`battle-min`
 * 的末步正是「胜利」第一次出现的那一刻，三份打输的走的是 `GameOver`。所以
 * 这里每一个字段抄错了和抄对了推出来的真值都相同 —— 它的判据在
 * `victory.test.ts`（常量对回原版源码 + 两条路端到端 + 发奖那一拍），
 * 理由与做法写在 `victory.ts` 的头注释里。
 */
export interface VictoryReminderState {
  isDraw: boolean
  /** 原版**从来不把它置回 true** —— 切了面板之后这个 update 还在跑。 */
  isStop: boolean
  /** 卷轴：`dy2` 与 `sy2` 每拍 +20，`sy2` 到 480 就是拉满。 */
  dy2: number
  sy2: number
  /** 物品框那八个坐标，`thingSx1` 每拍 -4，从 60 数到 0。 */
  thingDx1: number
  thingDy1: number
  thingDx2: number
  thingDy2: number
  thingSx1: number
  thingSy1: number
  thingSx2: number
  thingSy2: number
  /** 卷轴拉满之后才开始数。15 查升级、25 翻页、35–54 属性滚动、55 收尾。 */
  timeCode: number
  /** 这一场能拿多少经验 / 钱 / 掉落物，`getInformation()` 在开场就算死了。 */
  expToGet: number
  moneyToGet: number
  /** 每只怪一项，写法 `名字/类型`，顺序就是 `bp.enemies` 的顺序。 */
  things: string[]
  /**
   * 原版那个裸的 `ArrayList<Integer>`，15 项：0–2 是三个人「还差多少经验
   * 升级」，3–6 / 7–10 / 11–14 是三个人的四项属性。下标常量见
   * `victory.ts` 的 `SHOW_EXP_INDEX` / `SHOW_ATTR_START`。
   *
   * **缺席角色的那几项是 `null`**：原版读的是静态字段（没出战也有值），
   * 这一层没有那份数据，而原版从头到尾没有读过它们。
   */
  showNums: (number | null)[]
  firstIsDraw: boolean
  secondIsDraw: boolean
  levelUpIsDraw: boolean
  getThingIsDraw: boolean
  firstString: boolean
  secondString: boolean
  thirdString: boolean
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
  /** `bp.pet`。陆雪琪的秘术召出来之前恒为 null（xl-rh9.14）。 */
  pet: Pet | null

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
  /** 打赢之后那一整段结算（`VictoryReminder`）—— 见 `victory.ts`。
   *  xl-rh9.5 用它整个取代了早先的 `victoryDrawn` / `victoryStopped`，
   *  对应关系是 `isDraw` / `isStop`。 */
  victoryReminder: VictoryReminderState
  gameOver: GameOverAnim
  /**
   * `GameLauncher.SCENE_SIGNAL`。切回场景那一刻置 1，场景面板下一拍读到它就
   * 把该场景的 BGM 重新放上再清零（`ScenePanel.step()`）。两条回地图的路
   * ——打赢结算完、剧情必败战——都会置它。
   *
   * 「回到地图上原来的位置」不需要这一层做任何事：主角的 x/y 一直在场景面板
   * 手里，战斗从没碰过。
   */
  sceneSignal: boolean

  /** 鼠标当前位置（`BattlePanel.currentX/currentY`）。 */
  currentX: number
  currentY: number
}
