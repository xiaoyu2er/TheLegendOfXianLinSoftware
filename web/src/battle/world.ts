import { JavaRandom } from '../game/javaRandom'
import { ENEMY_SLOT_POS, HEROES, battleBgm, derive, enemySpec, expToLevelUp } from './units'
import type { PartyKey } from './units'
import type {
  BattleState,
  BattleWorld,
  BeAttackedAnim,
  Enemy,
  FrameAnim,
  GameButton,
  Hero,
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
}

function state(): BattleState {
  return { type: 0, roundNum: 0, isUsable: false, isCheck: false, successRate: 0, roleCode: 0 }
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

function makeHero(key: PartyKey, level: number): Hero {
  const spec = HEROES[key]
  const attributes = spec.attributes(level)
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
    return makeHero(key, level)
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
    exitPanel: null,
    random: new JavaRandom(config.seed),
    background: config.background,
    bgm: battleBgm(config.background),
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
    skillMenuDrawn: false,
    drugMenuDrawn: false,
    victoryDrawn: false,
    victoryStopped: true,
    // `GameOver` 构造函数里那四个会动的坐标（另外十二个只被 paint 读）。
    gameOver: { isDraw: false, isStop: true, code: 0, ldx2: 0, lsx2: 0, rdx1: 1024, rsx1: 512 },
    victoryUpdates: 0,
    // `VictoryReminder.getInformation()` 在 `initial()` 里就把它算死了。
    expToGet: enemies.reduce((sum, e) => sum + e.spec.exp, 0),
    currentX: 0,
    currentY: 0,
  }
}
