/**
 * 战斗单位的**出厂数据**：三个我方角色的属性公式，以及怪物那张表。
 *
 * 全部照抄 `src/battle/` 下的原版：我方在 `ZhangXiaoFan/YuJie/LuXueQi` 的
 * 构造函数与 `refreshValue()` 里，怪物在 `Enemy.initial()` 那个 26 路 switch 里。
 *
 * ## 怪物表为什么只有两行
 *
 * 这张表**按名字查，查不到就抛**。今天入库的只有 `battle-min` 那一场用到的两
 * 只 —— 抄一行没有判据的数据，抄错了和抄对了长得一样，而这张票的判据只盖得住
 * 这两只。其余各行随它们各自的行为真值一起补（`battle-em3-box` 与两场打输归
 * xl-rh9.8）。查不到时的表现是**当场抛并点名**，不是"用一份默认值悄悄打下去"。
 */

/** `refreshValue()`：七个派生值全从四项基础属性算出来。 */
export interface Derived {
  hpMax: number
  mpMax: number
  hurt: number
  skillHurt: number
  speed: number
  defense: number
  skillDefense: number
}

export interface Attributes {
  physicalPower: number
  sprit: number
  agile: number
  strength: number
}

export function refreshValue(a: Attributes): Derived {
  return {
    hpMax: a.physicalPower * 70,
    mpMax: a.sprit * 30,
    hurt: a.strength * 10,
    skillHurt: a.sprit * 8,
    // 原版写的是 `(int)agile/2` —— 先整除再转，负数不会出现，向零截尾即可。
    speed: Math.trunc(a.agile / 2),
    defense: a.physicalPower * 5,
    skillDefense: a.physicalPower * 2 + a.sprit * 3,
  }
}

/** `expToLevelUp=(int)(500*Math.pow(1.4,level))`。 */
export function expToLevelUp(level: number): number {
  return Math.trunc(500 * Math.pow(1.4, level))
}

/** 剧本里的三个键，对应原版 `GameLauncher` 里写死的三行出场坐标。 */
export type PartyKey = 'zhang' | 'yu' | 'lu'

/** 一次技能动画的十二个参数，与原版 `SkillAnimation.set(...)` 逐位对应。 */
export interface SkillSpec {
  name: string
  length: number
  x: number
  y: number
  beAttackedCode: number
  beAttackedTimes: number
  runCode: number
  attackCode: number
  withdrawCode: number
  offsetTo1: number
  offsetTo2: number
  offsetTo3: number
}

export interface HeroSpec {
  key: PartyKey
  /** `roleCode`：1 张小凡 / 2 文敏 / 3 陆雪琪。也是 `currentBeAttacked` 的编码。 */
  roleCode: 1 | 2 | 3
  x: number
  y: number
  /** `showX/showY`：伤害数字与被击动画画在哪。 */
  showX: (x: number, y: number) => number
  showY: (x: number, y: number) => number
  /** `doAction()` 里那个上界：走图帧数。三个人各不相同（4 / 8 / 6）。 */
  frames: number
  /** `getImage()` 之外，`loadAnimation()` 里三条动画的长度。 */
  beAttackedFrames: number
  victoryFrames: number
  deadFrames: number
  attributes: (level: number) => Attributes
  /** `levelUp()` 里那四行 `+=`。与上面那条公式的斜率相同，但**分开写**：
   *  原版加的是当前值（可能被战斗状态改过），不是按等级重算。 */
  levelUpDelta: Attributes
  /** 普通攻击那一发 `skillAnimation.set(...)`，坐标是写死的常量。 */
  attack: SkillSpec
}

export const HEROES: Readonly<Record<PartyKey, HeroSpec>> = {
  zhang: {
    key: 'zhang',
    roleCode: 1,
    x: 560,
    y: 160,
    showX: (x) => x + 155,
    showY: (_x, y) => y + 90,
    frames: 4,
    beAttackedFrames: 2,
    victoryFrames: 12,
    deadFrames: 4,
    attributes: (level) => ({
      physicalPower: 10 + (level - 1) * 2,
      sprit: 10 + (level - 1) * 2,
      agile: 10 + (level - 1) * 2,
      strength: 10 + (level - 1) * 2,
    }),
    levelUpDelta: { physicalPower: 2, sprit: 2, agile: 2, strength: 2 },
    attack: {
      name: '张小凡攻击',
      length: 25,
      x: 150,
      y: 90,
      beAttackedCode: 8,
      beAttackedTimes: 1,
      runCode: 10,
      attackCode: 20,
      withdrawCode: 25,
      offsetTo1: 0,
      offsetTo2: 180,
      offsetTo3: -120,
    },
  },
  yu: {
    key: 'yu',
    roleCode: 2,
    x: 750,
    y: 150,
    showX: (x) => x + 50,
    showY: (_x, y) => y,
    frames: 8,
    beAttackedFrames: 2,
    victoryFrames: 12,
    deadFrames: 4,
    attributes: (level) => ({
      physicalPower: 14 + (level - 3) * 2,
      sprit: 12 + (level - 3) * 1,
      agile: 17 + (level - 3) * 2,
      strength: 18 + (level - 3) * 3,
    }),
    levelUpDelta: { physicalPower: 2, sprit: 1, agile: 2, strength: 3 },
    attack: {
      name: '文敏攻击',
      length: 21,
      x: 120,
      y: -80,
      beAttackedCode: 8,
      beAttackedTimes: 1,
      runCode: 8,
      attackCode: 15,
      withdrawCode: 21,
      offsetTo1: -150,
      offsetTo2: 0,
      offsetTo3: -260,
    },
  },
  lu: {
    key: 'lu',
    roleCode: 3,
    x: 800,
    y: 330,
    showX: (x) => x,
    showY: (_x, y) => y,
    frames: 6,
    beAttackedFrames: 2,
    victoryFrames: 8,
    deadFrames: 4,
    attributes: (level) => ({
      physicalPower: 10 + (level - 1) * 1,
      sprit: 12 + (level - 1) * 3,
      agile: 14 + (level - 1) * 3,
      strength: 8 + (level - 1) * 1,
    }),
    levelUpDelta: { physicalPower: 1, sprit: 3, agile: 3, strength: 1 },
    attack: {
      name: '陆雪琪攻击',
      length: 24,
      x: 120,
      y: 135,
      beAttackedCode: 8,
      beAttackedTimes: 1,
      runCode: 7,
      attackCode: 13,
      withdrawCode: 24,
      offsetTo1: 90,
      offsetTo2: 210,
      offsetTo3: -20,
    },
  },
}

/** 槽位编号 → 出场坐标（`Enemy.initial` 的第一个 switch：5 中 / 6 上 / 7 下）。 */
export const ENEMY_SLOT_POS: Readonly<Record<5 | 6 | 7, { x: number; y: number }>> = {
  5: { x: 100, y: 220 },
  6: { x: 60, y: 90 },
  7: { x: 60, y: 330 },
}

export interface EnemySpec {
  /** 走图帧数（`Enemy.length`），`doAction()` 的上界。 */
  length: number
  beAttackedFrames: number
  speed: number
  hurt: number
  defense: number
  hp: number
  exp: number
  money: number
  /** `Enemy.skillNum`：`EnemyAI.skillToUse` 掷的就是它。原版默认 1。 */
  skillNum: number
  /** `beAttackedX/Y` 相对出场坐标的偏移。 */
  beAttackedOffsetX: number
  beAttackedOffsetY: number
  /** `loadAnimation()` 里那一发 `setSkill(...)`。偏移三项要用我方的 showY 现算。 */
  skill: {
    name: string
    length: number
    offsetX: number
    offsetY: number
    beAttackedCode: number
    beAttackedTimes: number
    runCode: number
    attackCode: number
    withdrawCode: number
    /** `offsetTo{1,2,3} = y - <某人的 showY> + 常数`，这里只带常数那一项。 */
    toZhang: number
    toYu: number
    toLu: number
  }
}

const ENEMIES: Readonly<Record<string, EnemySpec>> = {
  怪物1: {
    length: 4,
    beAttackedFrames: 6,
    speed: 11,
    hurt: 250,
    defense: 60,
    hp: 250,
    exp: 200,
    money: 1000,
    skillNum: 2,
    beAttackedOffsetX: 0,
    beAttackedOffsetY: 0,
    skill: {
      name: '怪物/怪物1攻击',
      length: 16,
      offsetX: -50,
      offsetY: -235,
      beAttackedCode: 6,
      beAttackedTimes: 1,
      runCode: 6,
      attackCode: 10,
      withdrawCode: 16,
      toZhang: 0,
      toYu: 0,
      toLu: -30,
    },
  },
  怪物2: {
    length: 4,
    beAttackedFrames: 6,
    speed: 10,
    hurt: 260,
    defense: 60,
    hp: 300,
    exp: 200,
    money: 1200,
    // 原版没给它写 skillNum，用的是字段初值 1。
    skillNum: 1,
    beAttackedOffsetX: -125,
    beAttackedOffsetY: 0,
    skill: {
      name: '怪物/怪物2攻击',
      length: 16,
      offsetX: -50,
      offsetY: -200,
      beAttackedCode: 6,
      beAttackedTimes: 1,
      runCode: 6,
      attackCode: 10,
      withdrawCode: 16,
      toZhang: 20,
      toYu: 30,
      toLu: 0,
    },
  },
}

/**
 * 按名字取怪物出厂数据。**查不到当场抛**：这张表只有拿得到行为真值的那几行，
 * 而"补一行没人核的数"与"没补"在测试里长得一样。
 */
export function enemySpec(name: string): EnemySpec {
  const spec = ENEMIES[name]
  if (!spec) {
    throw new Error(
      `怪物「${name}」还没有出厂数据。web 侧只抄了有行为真值盖得住的那几只（现有 ` +
        `${Object.keys(ENEMIES).join(' / ')}）—— 补一行没有判据的数据，抄错了和抄对了长得一样。` +
        `连同它那一场的真值一起补。`,
    )
  }
  return spec
}

/** `BattlePanel.initial` 里那个背景图 → BGM 的 switch。认不出的背景不播 BGM。 */
const BGM_BY_BACKGROUND: Readonly<Record<string, string>> = {
  'image/背景图/伏魔山树林.png': 'B6.mp3',
  'image/背景图/校园小道.png': 'B6.mp3',
  'image/背景图/大活迷宫.png': '仗剑.mp3',
  'image/背景图/藏宝阁外.png': '浣花洗剑.mp3',
  'image/背景图/仙二迷宫.png': '会心一击.mp3',
  'image/背景图/仙二教学楼.png': '浣花洗剑·变奏.mp3',
  'image/背景图/藏经阁一层.png': '文学谷第一战.mp3',
  'image/背景图/藏经阁三层.png': '临危恃勇.mp3',
  'image/背景图/商塔迷宫.png': '镜影命缘.mp3',
  'image/背景图/商塔顶层.png': '紧急.mp3',
  'image/背景图/校园内部.png': 'C45.mp3',
  'image/背景图/比武场.png': '肆涌暗云.mp3',
}

/**
 * 背景图路径 → 这一场的 BGM。**认不出返回 null**，与原版一致：那个 switch
 * 没有 default，落不进任何一 case 就一首都不播。
 */
export function battleBgm(background: string): string | null {
  return BGM_BY_BACKGROUND[background] ?? null
}
