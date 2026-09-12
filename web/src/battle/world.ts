import { normalizePath } from '../assets/path'
import { JavaRandom } from '../game/javaRandom'
import { victoryInformation } from './victory'
import {
  ENEMY_SLOT_POS,
  HEROES,
  battleBgm,
  derive,
  enemySpec,
  expToLevelUp,
  refreshValue,
} from './units'
import type { Attributes, PartyKey } from './units'
import { DRUGS } from './drugs'
import {
  MENU_BUTTON_H,
  MENU_BUTTON_W,
  MENU_BUTTON_X,
  menuButtonY,
} from './menuLayout'
import { SKILL_NUMBER } from './skills'
import type {
  BattleState,
  BattleWorld,
  BeAttackedAnim,
  DrugMenu,
  Enemy,
  FrameAnim,
  GameButton,
  Hero,
  MenuButton,
  SkillMenu,
} from './types'

/**
 * 建一场战斗。参数就是**战斗剧本**里那几行（`docs/trace-format.md` §战斗剧本），
 * 一个字段都不从行为真值里读状态 —— 读的只有"打的是哪一场"。
 */
export interface BattleConfig {
  /** `Fight` 那一行的第一列，正斜杠形式。决定背景图与 BGM。 */
  background: string
  party: readonly PartyKey[]
  levels: Readonly<Partial<Record<PartyKey, number>>>
  /**
   * **此刻的四项基础属性**，压过按等级算出来的那一份（xl-6lo.16）。
   *
   * 原版没有这个参数，因为它根本不需要：那三个类的属性字段全是 `static`，
   * 开机建 `MenuPanel` 时 `EquipPanel.addPack()` 就把开局武器的加成 `+=`
   * 了上去，战斗面板读到的一直是那一份。这一层每场新建人物，于是那件事
   * 变成了显式的一次搬运 —— 与 `carry` 同一个理由、同一个形状。
   *
   * **剧本不喂它**（每一份行为真值都是一个干净 JVM 里的第一场，那时属性就是
   * `attributes(level)`），所以不传时这个函数一个字节都不变。游戏本体从
   * `fakes/party.ts` 喂。
   */
  attributes?: Readonly<Partial<Record<PartyKey, Attributes>>> | undefined
  /** 三个槽位写满，空槽位是 null，写法是 `名字/编号`（编号 5/6/7）。 */
  enemies: readonly (string | null)[]
  seed: number
  /**
   * 怪物出场图（`Images.get(0)`）的像素尺寸。
   *
   * **必须由外面喂**：`EnemySlector` 量的是真的图片，而这一层不碰素材。
   * 测试从 `image/怪物/<名字>/1.png` 的 IHDR 里读，渲染层（xl-rh9.9）从烘出来
   * 的纹理读 —— 两边读的都不是行为真值。
   */
  sprite: (name: string) => { width: number; height: number }
  /**
   * 技能菜单上有几颗按钮（`ZhangXiaoFan.skillNumber` 等三个 static 字段）。
   * 游戏本体从队伍现读（`session.ts` 的 `configFor`，xl-03x.17）；回放真值时
   * **剧本没写就用原版那三个字段的初值**（`SKILL_NUMBER`，2 / 3 / 2）——
   * 导出器也是这么做的：它只写 `level = n`，构造函数一个字都不碰 skillNumber。
   *
   * **别按剧本里的等级现推**：格数不是等级的函数（升级时 +1、读档只抬不压，
   * `skills.ts`），而导出器那个干净 JVM 里它就是初值。推一个出来会让 `battle-menus`
   * 的菜单从 2 颗变成 4 颗 —— 而多出来的那两颗一颗都点不到，看上去完全正常。
   */
  skillNumbers?: Readonly<Partial<Record<PartyKey, number>>> | undefined
  /**
   * 六种药此刻各有几件，按 `DRUGS` 的次序（`DrugPack.drugList`，xl-byy）。
   *
   * 原版没有这个参数：药品菜单读的就是那一份 static。这一层每场新建世界，于是
   * 变成一次显式的搬运 —— 游戏本体从 `fakes/drugPack.ts` 现读（`configFor`），
   * 打完由会话写回；回放真值从剧本的 `drugs` 回显来。**不传就是六种全 0**，
   * 也就是一个干净进程的样子，老真值一个字节都不变。
   */
  drugStock?: readonly number[] | undefined
  /**
   * **上一场留下的那几样**（xl-rh9.17）。不给就是"这是开机以来的第一场"，
   * 也就是每一份行为真值的处境 —— 所以**不传它时这个函数一个字节都不变**。
   *
   * 原版没有这个参数，因为它根本不需要：`GameLauncher.zhangXiaoFan` 那三个
   * 对象从开机活到关机，`BattlePanel.initial()` 只在末尾做一次"死过的人
   * 复活、血是 0 的回到 10%"。这一层每场新建对象，于是那件事变成了显式的
   * 一次搬运，见 `applyCarry`。
   */
  carry?: Readonly<Partial<Record<PartyKey, HeroCarry>>> | undefined
}

/**
 * 跨战斗活着的那几样。
 *
 * **这是唯一一份清单**：`fakes/party.ts` 的 `PartyMemberState` 直接
 * `extends` 它，只多一个 `level` 与四项基础属性（那两样各有自己的入口参数，
 * `levels` 与 `attributes`）。往这里加一样东西，那边跟着有。
 */
export interface HeroCarry {
  exp: number
  hp: number
  mp: number
  isDead: boolean
  angryValue: number
}

/**
 * 把上一场的结果搬到刚建好的这个人身上，然后跑 `BattlePanel.initial()`
 * 末尾那个复活循环。
 *
 * 顺序要紧：先搬血再 `refreshValue()`（它会把 hp/mp 夹回上限 —— 升过级的人
 * 上限涨了，夹不住；而没升级的人正好等于原值），最后才判复活。倒过来做的话
 * 一个"上一场满血打赢"的人会被 10% 那一句改掉，而画面上只是"回合开始血少了
 * 一大截"。
 */
function applyCarry(h: Hero, c: HeroCarry): void {
  h.exp = c.exp
  h.hp = c.hp
  h.mp = c.mp
  h.angryValue = c.angryValue
  refreshValue(h)
  // `for(Hero hero:heroes){ if(hero.wheatherDead()){ hero.setDead(false);
  //   if(hero.getHp()==0) hero.setHp((int)(hero.getHpMax()*0.1)); } }`
  if (c.isDead) {
    h.isDead = false
    if (h.hp === 0) h.hp = Math.trunc(h.hpMax * REVIVE_HP_RATIO)
  }
}

/**
 * 这一场药品菜单读的存货（`BattleConfig.drugStock`）。**长度必须等于 `DRUGS`**：
 * 原版是同一张 `DrugPack.drugList`，短一截的话菜单画到那一行当场越界（绘制层
 * 那一处也抛），这里在建世界时就拦下，不等到点「物」。
 */
function initialDrugStock(stock: readonly number[] | undefined): number[] {
  if (stock === undefined) return DRUGS.map(() => 0)
  if (stock.length !== DRUGS.length) {
    throw new Error(`药品存货有 ${stock.length} 条，而药品有 ${DRUGS.length} 种（DrugPack.drugList）`)
  }
  return [...stock]
}

/** `(int)(hero.getHpMax()*0.1)` —— 上一场死掉的人这一场从这里起。 */
export const REVIVE_HP_RATIO = 0.1

function state(): BattleState {
  return {
    type: 0,
    roundNum: 0,
    isUsable: false,
    isCheck: false,
    successRate: 0,
    roleCode: 0,
    x: 0,
    y: 0,
  }
}

/** 第 `index` 颗菜单按钮（几何见 `menuLayout.ts`）。 */
function menuButton(index: number): MenuButton {
  return {
    x: MENU_BUTTON_X,
    y: menuButtonY(index),
    width: MENU_BUTTON_W,
    height: MENU_BUTTON_H,
    isclicked: false,
    // `GameButton` 的构造函数：`buttonImage=normalImage`。
    variant: 1,
  }
}

/**
 * `SkillMenu` 的构造函数。三组按钮**只给出战的人建**（`if(bp.zxf!=null)`），
 * 缺席的那一组是空列表 —— 而最后一句 `skillButtons=zhangButtons` 是无条件的，
 * 所以张小凡没出战时它一开始指着一个空列表。照抄。
 */
function makeSkillMenu(
  present: Readonly<Record<'zhang' | 'yu' | 'lu', boolean>>,
  counts: Readonly<Partial<Record<PartyKey, number | undefined>>>,
): SkillMenu {
  const group = (key: 'zhang' | 'yu' | 'lu'): MenuButton[] => {
    if (!present[key]) return []
    // 出战的人身上一定带着格数（`makeHero`）。缺了是接线错，抛 —— 在这里补一个缺省值，
    // 等于让格数又多一个落点（xl-03x.17 那条「不要留着两个落点」）。
    const n = counts[key]
    if (n === undefined) throw new Error(`${key} 出战了却没有技能格数`)
    return Array.from({ length: n }, (_, i) => menuButton(i))
  }
  return {
    isDraw: false,
    group: 'zhang',
    groups: { zhang: group('zhang'), yu: group('yu'), lu: group('lu') },
    // `checkRound()` 才 new 得出来 —— 点「技」之前它是 null。
    returnButton: null,
    isDrawIntro: false,
    introImage: null,
    introY: 0,
  }
}

/** `DrugMenu` 的构造函数：六种药 + 一颗返回，共七颗。 */
function makeDrugMenu(): DrugMenu {
  return {
    isDraw: false,
    buttons: Array.from({ length: DRUGS.length + 1 }, (_, i) => menuButton(i)),
    isDrawIntro: false,
    introDrug: null,
    // 原版 `introX=220` 是常量（画的时候用），`introY` 的初值是字段初值 0。
    introY: 0,
    introText: null,
    currentHero: 0,
  }
}

function anim(length: number): FrameAnim {
  return { code: 0, length, isDraw: false, isStop: true }
}

function beAttacked(length: number): BeAttackedAnim {
  return { ...anim(length), currentTime: 1, times: 0 }
}

function button(x: number, y: number): GameButton {
  return { x, y, width: 58, height: 62, isclicked: false }
}

function makeHero(key: PartyKey, level: number, skillNumber: number, override?: Attributes): Hero {
  const spec = HEROES[key]
  // 喂了就用喂的那一份（`BattleConfig.attributes`）—— 队伍此刻的属性带着装备
  // 加成与历次 `levelUp()`，按等级重算会把它们抹掉。
  const attributes = override ?? spec.attributes(level)
  const derived = derive(attributes)
  return {
    spec,
    roleCode: spec.roleCode,
    x: spec.x,
    y: spec.y,
    showX: spec.showX(spec.x, spec.y),
    showY: spec.showY(spec.x, spec.y),
    level,
    code: 0,
    isDraw: true,
    isStop: false,
    isDead: false,
    isAngry: false,
    angryValue: 0,
    hp: derived.hpMax,
    mp: derived.mpMax,
    ...attributes,
    ...derived,
    exp: 0,
    expToLevelUp: expToLevelUp(level),
    isLevelUp: false,
    skillNumber,
    battleState: state(),
    beAttackedAnimation: beAttacked(spec.beAttackedFrames),
    victoryAnimation: anim(spec.victoryFrames),
    deadAnimation: anim(spec.deadFrames),
  }
}

/**
 * 建一只怪。`Enemy.loadAnimation` 里那三个偏移量是**用我方的 showY 现算**的，
 * 罹年居士那一行的速度还要读 `ZhangXiaoFan.speed` —— 所以怪物必须在我方之后
 * 建。原版靠静态字段实现的这个先后，这里靠传参。
 *
 * `zhangSpeed` 传的是**函数**而不是数：张小凡缺席时原版读到的是上一场留下的
 * 静态字段，这一层没有那个东西，于是只在真的要用到时才抛（今天只有罹年居士
 * 那一行会用到）。传数就得在每一场都先编一个值出来，而编出来的值和真的一样。
 */
function makeEnemy(
  spec_: string,
  slotIndex: number,
  heroShowY: Readonly<Record<PartyKey, number>>,
  zhangSpeed: () => number,
  sprite: BattleConfig['sprite'],
): Enemy {
  const slash = spec_.lastIndexOf('/')
  if (slash < 0) throw new Error(`怪物写法应当是 名字/编号，实际 ${spec_}`)
  const name = spec_.slice(0, slash)
  const roleCode = Number(spec_.slice(slash + 1)) as 5 | 6 | 7
  if (roleCode !== 5 + slotIndex) {
    throw new Error(
      `第 ${slotIndex + 1} 个怪物的编号应当是 ${5 + slotIndex}（原版 Enemy.initial 按它定站位），实际 ${spec_}`,
    )
  }
  const spec = enemySpec(name)
  const { x, y } = ENEMY_SLOT_POS[roleCode]
  const size = sprite(name)
  const speed = typeof spec.speed === 'function' ? spec.speed(zhangSpeed()) : spec.speed
  return {
    name,
    roleCode,
    spec,
    x,
    y,
    width: size.width,
    height: size.height,
    code: 0,
    isDraw: true,
    isStop: false,
    isDead: false,
    speed,
    hp: spec.hp,
    hurt: spec.hurt,
    skillHurt: spec.skillHurt,
    defense: spec.defense,
    hurtMax: spec.hurt,
    skillHurtMax: spec.skillHurt,
    defenseMax: spec.defense,
    battleState: state(),
    beAttackedAnimation: beAttacked(spec.beAttackedFrames),
    skill: {
      name: spec.skill.name,
      length: spec.skill.length,
      x: x + spec.skill.offsetX,
      y: y + spec.skill.offsetY,
      beAttackedCode: spec.skill.beAttackedCode,
      beAttackedTimes: spec.skill.beAttackedTimes,
      runCode: spec.skill.runCode,
      attackCode: spec.skill.attackCode,
      withdrawCode: spec.skill.withdrawCode,
      offsetTo1: y - heroShowY.zhang + spec.skill.toZhang,
      offsetTo2: y - heroShowY.yu + spec.skill.toYu,
      offsetTo3: y - heroShowY.lu + spec.skill.toLu,
    },
  }
}

export function createBattle(config: BattleConfig): BattleWorld {
  // `BattlePanel.initial()` 的**第一句**：`s = Reader.normalizePath(s)`。
  // `script/` 里有 3 行 Fight 数据写的是反斜杠（迷宫1 与剧情1，是烘焙管线
  // 路径规范化的测试夹具，CLAUDE.md 明写不许"修"）。不规范化的表现是
  // 背景图查不到、BGM 也查不到 —— 而查不到在这一层是**静悄悄的 null**。
  const background = normalizePath(config.background)
  if (config.enemies.length !== 3) {
    throw new Error(`怪物槽位一律三个（空的写 null），实际 ${config.enemies.length} 个`)
  }

  const build = (key: PartyKey): Hero | null => {
    if (!config.party.includes(key)) return null
    const level = config.levels[key]
    if (level === undefined) {
      // 原版三个人的默认等级各不相同，而这份真值里每一个伤害数字都是从等级算
      // 出来的。默认一个值等于悄悄换一场仗打。
      throw new Error(`剧本没给 ${key} 的等级 —— 等级没有默认值（见 docs/trace-format.md）`)
    }
    const hero = makeHero(key, level, config.skillNumbers?.[key] ?? SKILL_NUMBER[key], config.attributes?.[key])
    const carry = config.carry?.[key]
    if (carry !== undefined) applyCarry(hero, carry)
    return hero
  }
  const zxf = build('zhang')
  const yj = build('yu')
  const lxq = build('lu')
  const heroes = [zxf, yj, lxq].filter((h): h is Hero => h !== null)

  // showY 的三个值即便某人没出战也要有：`Enemy.loadAnimation` 读的是静态字段，
  // 原版那三个静态字段在上一场战斗里就已经被写过了。缺席时用出场坐标算出来的
  // 那个值——与原版"从没打过仗"时的初值一致（都是 0 之外的写死坐标）。
  const showY = {
    zhang: zxf?.showY ?? HEROES.zhang.showY(HEROES.zhang.x, HEROES.zhang.y),
    yu: yj?.showY ?? HEROES.yu.showY(HEROES.yu.x, HEROES.yu.y),
    lu: lxq?.showY ?? HEROES.lu.showY(HEROES.lu.x, HEROES.lu.y),
  }

  // 只有罹年居士那一行读得到它，所以张小凡缺席时不是当场抛，而是**用到才抛**。
  const zhangSpeed = () => {
    if (zxf === null) {
      throw new Error(
        '这一场的怪物速度要读张小凡的 speed（原版 `ZhangXiaoFan.speed+6`，' +
          '读的是静态字段），可剧本里张小凡没有出战 —— 原版这时读到的是上一场' +
          '留下的值，这一层没有那个东西，不猜。',
      )
    }
    return zxf.speed
  }

  const slots = config.enemies.map((spec, i) =>
    spec === null ? null : makeEnemy(spec, i, showY, zhangSpeed, config.sprite),
  )
  const [em1, em2, em3] = slots
  // 加入顺序照抄 `BattlePanel.initial`：em2 先进去（解决遮掩），然后 em1、em3。
  const enemies = [em2, em1, em3].filter((e): e is Enemy => e != null)

  const barX = 300
  return {
    tick: 0,
    music: [],
    exitPanel: null,
    random: new JavaRandom(config.seed),
    background,
    bgm: battleBgm(background),
    currentRound: 0,
    currentPattern: 0,
    currentBeAttacked: 0,
    heroes,
    // 同一批对象的另一份引用：`heroes` 会被打输出口清空，`party` 不会。
    party: [...heroes],
    zxf,
    yj,
    lxq,
    slots,
    em1: em1 ?? null,
    em2: em2 ?? null,
    em3: em3 ?? null,
    enemies,
    progressBar: {
      barX,
      zhangX: barX,
      yuX: barX,
      luX: barX,
      petX: barX,
      enemy1X: barX,
      enemy2X: barX,
      enemy3X: barX,
      isDraw: true,
      isStop: false,
    },
    command: {
      isDraw: false,
      attack: button(500, 300),
      skill: button(500, 300 - 62),
      defend: button(500 - 58, 300 + 40),
      thing: button(500 + 58, 300 + 40),
    },
    instruct: { code: 0, isDraw: false, isStop: true, x: 0, y: 0 },
    // `new Reminder(this, 500, 120)`，八个坐标都从这两个中心出发。
    reminder: {
      // `currentImage` 的字段初值是 null —— 一次 `show()` 都没有过。
      image: null,
      code: 0,
      isDraw: false,
      isStop: true,
      centreX: 500,
      centreY: 120,
      dx1: 500,
      dx2: 500,
      dy1: 120,
      dy2: 120,
    },
    selector: {
      isSlectable: false,
      x1: em1?.x ?? 0,
      y1: em1?.y ?? 0,
      width1: em1?.width ?? 0,
      height1: em1?.height ?? 0,
      x2: em2?.x ?? 0,
      y2: em2?.y ?? 0,
      width2: em2?.width ?? 0,
      height2: em2?.height ?? 0,
      x3: em3?.x ?? 0,
      y3: em3?.y ?? 0,
      width3: em3?.width ?? 0,
      height3: em3?.height ?? 0,
    },
    skillAnimation: {
      named: false,
      name: '',
      length: 0,
      x: 0,
      y: 0,
      initialX: 0,
      initialY: 0,
      beAttackedCode: 0,
      beAttackedTimes: 0,
      runCode: 0,
      attackCode: 0,
      withdrawCode: 0,
      offsetTo1: 0,
      offsetTo2: 0,
      offsetTo3: 0,
      code: 0,
      isDraw: false,
      isStop: true,
      isOver: false,
    },
    backgroundAnimation: { name: null, length: 0, code: 0, isDraw: false, isStop: true, isOver: false },
    startAnimation: { leftX: 0, rightX: 0, isDraw: true, isStop: false },
    hurtValues: [],
    launchCode: 0,
    // `bp.pet=null;`（`BattlePanel.initial`）—— 陆雪琪的秘术才 new 得出来。
    pet: null,
    // 按钮数从建好的人身上取，不再从 config 另算一遍 —— 同一个数两处各算各的缺省，
    // 哪天两边的缺省分了家，菜单与人就对不上（xl-03x.17）。
    skillMenu: makeSkillMenu(
      { zhang: zxf !== null, yu: yj !== null, lu: lxq !== null },
      { zhang: zxf?.skillNumber, yu: yj?.skillNumber, lu: lxq?.skillNumber },
    ),
    drugMenu: makeDrugMenu(),
    drugStock: initialDrugStock(config.drugStock),
    lootEquipment: [],
    // `new VictoryReminder(this)` —— 构造函数里就把 getInformation() 跑完了。
    victoryReminder: victoryInformation({ zhang: zxf, yu: yj, lu: lxq }, enemies),
    // `GameOver` 构造函数里那四个会动的坐标（另外十二个只被 paint 读）。
    gameOver: { isDraw: false, isStop: true, code: 0, ldx2: 0, lsx2: 0, rdx1: 1024, rsx1: 512 },
    sceneSignal: false,
    currentX: 0,
    currentY: 0,
  }
}
