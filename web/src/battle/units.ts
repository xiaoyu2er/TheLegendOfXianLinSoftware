/**
 * 战斗单位的**出厂数据**：三个我方角色的属性公式，以及怪物那张表。
 *
 * 全部照抄 `src/battle/` 下的原版：我方在 `ZhangXiaoFan/YuJie/LuXueQi` 的
 * 构造函数与 `refreshValue()` 里，怪物在 `Enemy.initial()` 那个按名字分的 switch 里（**25** 个 case，解源码数出来的）。
 *
 * ## 怪物表为什么不是 25 行
 *
 * 这张表**按名字查，查不到就抛**。入库的只有**跑得到行为真值**的那几只 ——
 * 抄一行没有判据的数据，抄错了和抄对了长得一样。原版那个 switch 有 25 个
 * case，这里今天是 7 行：`battle-min` 的两只（怪物1 / 怪物2）、
 * `battle-em3-box` 的三只（武林高手2 / 商塔弟子 / 商塔护法）、
 * 两场打输的两只（罹年居士 / 罹年居士分身）。**这个数字不写进任何断言** ——
 * 它随真值一起长，写死了就要在别人加真值时冲突。其余各行随它们各自的行为真值
 * 一起补。查不到时的表现是**当场抛并点名**，不是"用一份默认值悄悄打下去"。
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

export function derive(a: Attributes): Derived {
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

/**
 * `refreshValue()` 整个方法：七个派生值重算，**再把 hp / mp 夹回上限**。
 *
 * 那两句 `if(hp>=hpMax){hp=hpMax;}` 在今天这两个调用点上都观测不到（建人物与
 * 升级之后紧接着就是 `hp=hpMax`），照抄是因为读档那条路
 * （`intialFromInfo`，归 M3）也调它，而那里的 hp 是从存档读来的。
 */
export function refreshValue(u: Attributes & Derived & { hp: number; mp: number }): void {
  Object.assign(u, derive(u))
  if (u.hp >= u.hpMax) u.hp = u.hpMax
  if (u.mp >= u.mpMax) u.mp = u.mpMax
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
  /**
   * `Enemy.initial` 里那一行 `this.speed=…`。
   *
   * 25 行里 24 行是常量，**罹年居士那一行不是** —— 原版写的是
   * `ZhangXiaoFan.speed+6`，读的是张小凡那个 `public static int speed`，也就是
   * 「比张小凡快 6」。抄成常量的话它跟等级一起漂：`battle-defeat-scene` 的
   * 张小凡是 20 级（agile 48 → speed 24），真值记的正是 30。
   */
  speed: number | ((zhangSpeed: number) => number)
  hurt: number
  /**
   * `this.skillHurt=…`。25 行里 23 行写的是 `skillHurt=hurt`，另外两行
   * （罹年居士 9999 / 罹年居士分身 600）写的是字面量而值恰好等于 `hurt` ——
   * 也就是说这张表里它**从来没有**与 `hurt` 分开过（这句是解源码数出来的，
   * 见 `units.test.ts`）。仍然分成两个字段，因为「恰好相等」与「就是同一个
   * 数」在原版里不是同一件事。
   *
   * ⚠️ **这一列今天没有真值判据**：整个状态层还没有人读 `skillHurt`
   * （怪物出技能那条伤害路归 xl-rh9.9），所以五份真值里抄错了和抄对了推出来
   * 的数完全相同 —— 实测把罹年居士分身的 600 改成 590，逐字段比对全绿。
   * 守着它的是 `units.test.ts` 里那条「解源码数遍所有 case，一行都没分开过」。
   */
  skillHurt: number
  defense: number
  hp: number
  exp: number
  money: number
  /**
   * `Enemy.thing`：打赢之后掉的那一样东西，写法是 `名字/类型`，
   * 类型 `1` 是药品（进背包）、`2` 是装备（进装备包）。
   * `VictoryReminder.update()` 就是照这个字符串分发的。
   *
   * ⚠️ **这一列今天没有行为真值判据**：五份 driver=battle 的真值都停在结算
   * 之前，`thing` 抄错了和抄对了推出来的每一个字段都相同。守着它的是
   * `units.test.ts` 里那条「逐行对回 `Enemy.initial()` 的源码」。
   */
  thing: string
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

/**
 * 怪物出厂表。**导出**是给 `units.test.ts` 用的：那条对回原版源码的判据拿
 * 这张表当分母（表里有几行就核几行），而不是拿源码当分母 —— 源码有 25 个
 * case，这里只抄了跑得到真值的那几只。
 */
export const ENEMIES: Readonly<Record<string, EnemySpec>> = {
  怪物1: {
    length: 4,
    beAttackedFrames: 6,
    speed: 11,
    hurt: 250,
    // 原版这一行写的是 `skillHurt=hurt`。
    skillHurt: 250,
    defense: 60,
    hp: 250,
    exp: 200,
    money: 1000,
    thing: '金创药/1',
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
    skillHurt: 260,
    defense: 60,
    hp: 300,
    exp: 200,
    money: 1200,
    thing: '姜黄粉/1',
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
  // 以下三只由 `battle-em3-box` 盖住（脚本20 第 3 行的 Fight 数据）。
  武林高手2: {
    length: 5,
    beAttackedFrames: 6,
    speed: 12,
    hurt: 440,
    skillHurt: 440,
    defense: 130,
    hp: 500,
    exp: 500,
    money: 3800,
    thing: '神农药方/1',
    // 原版没给它写 skillNum，用的是字段初值 1。
    skillNum: 1,
    beAttackedOffsetX: -20,
    beAttackedOffsetY: 0,
    skill: {
      name: '怪物/武林高手2攻击',
      length: 26,
      offsetX: -10,
      offsetY: -170,
      beAttackedCode: 17,
      beAttackedTimes: 1,
      runCode: 9,
      attackCode: 20,
      withdrawCode: 26,
      toZhang: 40,
      toYu: 50,
      toLu: 0,
    },
  },
  商塔弟子: {
    length: 9,
    beAttackedFrames: 6,
    speed: 13,
    hurt: 450,
    skillHurt: 450,
    defense: 220,
    hp: 460,
    exp: 330,
    money: 1200,
    thing: '还魄丹/1',
    skillNum: 1,
    beAttackedOffsetX: -10,
    beAttackedOffsetY: 0,
    skill: {
      name: '怪物/商塔弟子攻击',
      length: 29,
      offsetX: -10,
      offsetY: -170,
      beAttackedCode: 7,
      beAttackedTimes: 3,
      runCode: 8,
      attackCode: 20,
      withdrawCode: 29,
      toZhang: 30,
      toYu: 30,
      toLu: 0,
    },
  },
  商塔护法: {
    length: 4,
    beAttackedFrames: 6,
    speed: 14,
    hurt: 450,
    skillHurt: 450,
    defense: 150,
    hp: 520,
    exp: 360,
    money: 1200,
    thing: '还灵丹/1',
    skillNum: 1,
    beAttackedOffsetX: -30,
    beAttackedOffsetY: 0,
    skill: {
      name: '怪物/商塔护法攻击',
      length: 28,
      offsetX: -10,
      offsetY: -170,
      beAttackedCode: 7,
      beAttackedTimes: 3,
      runCode: 8,
      attackCode: 17,
      withdrawCode: 28,
      toZhang: 0,
      toYu: 30,
      toLu: 0,
    },
  },
  // 以下两只由两场打输的真值盖住。名字**只差三个字**，而 `GameOver.update()`
  // 分岔靠的正是这个字符串：写成 startsWith / includes 就会把「罹年居士分身」
  // 也认成「罹年居士」（见 `step.ts` 的 exit 判定与 `battle-defeat-start`）。
  罹年居士: {
    length: 6,
    beAttackedFrames: 6,
    // 原版：`this.speed=ZhangXiaoFan.speed+6;` —— 全表唯一一行不是常量的速度。
    speed: (zhangSpeed) => zhangSpeed + 6,
    hurt: 9999,
    skillHurt: 9999,
    defense: 9999,
    hp: 9999,
    exp: 9999,
    money: 9999,
    thing: '御衡镇日刀/2',
    skillNum: 2,
    beAttackedOffsetX: -60,
    beAttackedOffsetY: 0,
    skill: {
      name: '怪物/罹年居士攻击',
      length: 10,
      offsetX: -20,
      offsetY: -130,
      beAttackedCode: 4,
      beAttackedTimes: 1,
      runCode: 4,
      attackCode: 7,
      withdrawCode: 10,
      toZhang: 0,
      toYu: 20,
      toLu: 0,
    },
  },
  罹年居士分身: {
    length: 6,
    beAttackedFrames: 6,
    speed: 18,
    hurt: 600,
    // 原版这一行写的是字面量 600，不是 `skillHurt=hurt`（值相同）。
    skillHurt: 600,
    defense: 190,
    hp: 2000,
    exp: 2000,
    money: 3000,
    thing: '神农药方/1',
    skillNum: 2,
    beAttackedOffsetX: -60,
    beAttackedOffsetY: 0,
    skill: {
      name: '怪物/罹年居士分身攻击',
      length: 10,
      offsetX: -20,
      offsetY: -130,
      beAttackedCode: 4,
      beAttackedTimes: 1,
      runCode: 4,
      attackCode: 7,
      withdrawCode: 10,
      toZhang: 0,
      toYu: 20,
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

/**
 * `BattlePanel.initial` 里那个背景图 → BGM 的 switch，**十二行全抄**。
 * 认不出的背景一首都不播（原版那个 switch 没有 default）。
 *
 * 为什么这里不像怪物表那样「只抄有真值盖得住的那几行」：这十二行有一条
 * **分母固定的判据** —— `units.test.ts` 现从 `src/battle/BattlePanel.java`
 * （GBK）里把那个 switch 解出来逐行对。怪物表没有这种东西可对（那些数字散在
 * 一个 25 路 switch 的字段赋值里，解它的那个解析器本身就会成为新的错处），
 * 所以它只抄跑得到真值的那几只。**唯一的例外是 `skillHurt`**：那一列没有
 * 任何真值读得到，于是 `units.test.ts` 用一个只认两个字段赋值的窄解析器把它
 * 对回源码 —— 窄到解不出来就当场抛，而不是解出 0 行然后恒真地通过。
 */
export const BGM_BY_BACKGROUND: Readonly<Record<string, string>> = {
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
