import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DRUGS } from '../battle/drugs'
import {
  LOAD_PARSERS,
  WORN_ORDER,
  javaEqualsTrue,
  javaParseBoolean,
  javaParseInt,
  readTruth,
} from '../save/test/originalSave'
import type { LoadParser, SaveTruthJson } from '../save/test/originalSave'
import { repoPath } from '../test/repoPath'
import { TRACE_NAMES, readTrace } from './trace'

/**
 * 从存档起步的剧本（xl-s9w）：它的**起点状态**与数据层真值逐字段对撞。
 *
 * 两边都是原版跑出来的，一个 web 函数都不经过：
 *
 * - 行为层 `tools/traces/out/<剧本>.trace.json` 第 0 拍 —— `SceneDriver` 走原版
 *   `Loader.load(N)` 之后记下的；
 * - 数据层 `tools/ground-truth/存档/存档N.json`（xl-i06.5）—— `SaveTruth` 调原版
 *   `Loader.loadLine` 读出来的每一行每一项。
 *
 * 为什么非要这一条：`traceReplay.test.ts` 已经逐 tick 对齐了这几份真值，但它对的是
 * **web 的** `worldAfterLoad(loaderReadBack(存档N.txt))`。两份真值之间的相等只是经由
 * web 实现**传递地**成立 —— 回放端与导出端同错一处（比如同样把两个英雄的行对调），
 * 那条链照样全绿。这里直接拿真值对真值。
 *
 * 解法（`parseInt` / `parseBoolean` / 手写 `equals("true")`）不在这里重写，用的是
 * `LOAD_PARSERS` —— 那份登记与 GBK 源码的对撞在 `loaderReadBack.test.ts`。
 *
 * 起点 = **原版读档之后的状态**，不是存档里写着的状态（xl-s9w 定的语义，见
 * `docs/trace-format.md` 的 `load` 一行）。两者不相等的地方在下面逐条登记。
 */

/** 读档专属列（`SceneDriver.appendLoadColumns`），外加每拍都记的三项。trace.ts 不给它们类型，这里只取用到的。 */
interface LoadTick {
  scene: string
  isScript: boolean
  role: { x: number; y: number }
  progress: Record<string, unknown>
  partyFlags: Record<string, boolean>
  heroes: Record<string, Record<string, unknown>>
  skillNumber: Record<string, number>
  worn: Record<string, string | null>[]
  drugs: number[]
  coins: number
  stock: Record<string, number[]>
}

/** 从存档起步的剧本，磁盘现扫（分母）。 */
const LOAD_TRACES = TRACE_NAMES.map((n) => readTrace(n))
  .filter((t) => t.driver === 'scene' && t.script.load !== undefined)
  .map((t) => ({ name: t.script.name, slot: t.script.load! }))

function tick0(name: string): LoadTick {
  const raw = JSON.parse(readFileSync(repoPath('tools/traces/out', `${name}.trace.json`), 'utf8')) as {
    ticks: LoadTick[]
  }
  const t = raw.ticks[0]
  if (t === undefined) throw new Error(`${name} 一拍都没有`)
  return t
}

/** 数据层真值里某个 `readBy` 读到的那一行。 */
function lineOf(truth: SaveTruthJson, readBy: string): string[] {
  const r = truth.reads.filter((x) => x.readBy.includes(readBy))
  if (r.length !== 1) throw new Error(`${truth.file} 里 readBy=${readBy} 的行有 ${r.length} 条，应当恰好 1 条`)
  return r[0]!.fields
}

function parse(p: LoadParser, s: string): unknown {
  switch (p) {
    case 'parseInt':
      return javaParseInt(s)
    case 'parseBoolean':
      return javaParseBoolean(s)
    case 'equalsTrue':
      return javaEqualsTrue(s)
    case 'raw':
      return s
    case 'split':
      return s.split(' ')
  }
}

const parsedLine = (fields: string[], parsers: readonly LoadParser[]) => {
  expect(fields.length).toBeGreaterThanOrEqual(parsers.length)
  return parsers.map((p, i) => parse(p, fields[i]!))
}

/** 三个英雄：数据层真值的 `readBy` ↔ trace `heroes` / `partyFlags` 的键。次序即 `roleAndMapInfo` 前三项。 */
const HEROES = [
  { info: 'zhangXiaoFanInfo', hero: 'zhang', flag: 'zhang' },
  { info: 'luXueQiInfo', hero: 'lu', flag: 'lu' },
  { info: 'yuJieInfo', hero: 'yu', flag: 'wen' },
] as const

/** `LOAD_PARSERS.hero` 的下标 → trace `heroes.*` 的列名，即 `HERO_FIELDS` 的次序。 */
const HERO_COLUMNS = ['level', 'hp', 'mp', 'angryValue', 'isAngry', 'isDead', 'exp'] as const
/** `LOAD_PARSERS.scene` 的下标 → trace 里的落点。 */
const SCENE_COLUMNS: readonly ((t: LoadTick) => unknown)[] = [
  (t) => t.isScript,
  (t) => t.scene,
  (t) => t.progress.dialogueEventOver,
  (t) => t.progress.dialogueOrder,
  (t) => t.role.x,
  (t) => t.role.y,
  (t) => t.progress.currentScript,
  (t) => t.progress.nextScript,
  (t) => t.progress.battle1Over,
  (t) => t.progress.countOfBattle1,
]

/**
 * **登记**：trace 读档专属列里**不从存档来**的列。它们是读档之后按等级重算、再叠装备
 * 加成出来的（`intialFromInfo`），存档里没有对应的项，所以不对撞。
 */
const DERIVED_HERO_COLUMNS = ['physicalPower', 'sprit', 'agile', 'strength'] as const
const DERIVED_COLUMNS = ['skillNumber'] as const

/**
 * **登记**：存档里有、起点状态**不等于**存档写着的那几项 —— 「原版读档之后的状态」与
 * 「存档里写着的状态」不相等的地方，逐条。
 */
const NOT_READ_BACK = {
  /** 装备库存：读档写进装备店面板自己另建的表，`EquipmentPack` 一格都没写到（xl-1dv.32）。trace 的 `stock` 恒 0。 */
  equipmentShopInfo: 'stock',
} as const

/**
 * **登记**：存档里有、但场景真值根本不记的项（不是读不回来，是这一侧看不见）。
 * `getTextInfo()` 那一行第 3、4 项是存读档面板摘要用的地图图名与任务，
 * 答题两行归答题那一侧（xl-1dv.19 那一族）。
 */
const NOT_RECORDED = {
  'getTextInfo()': [3, 4],
  questionInfo: 'all',
  answerInfo: 'all',
} as const

describe('从存档起步的剧本：起点状态 ↔ 数据层真值（xl-s9w）', () => {
  it('至少有一条剧本从存档起步（分母现扫；空名单会让下面一条断言都不跑还全绿）', () => {
    expect(LOAD_TRACES.length).toBeGreaterThan(0)
  })

  it('两侧的列都有着落：trace 读档列要么对撞、要么登记成派生；存档每一行要么对撞、要么登记', () => {
    const t = tick0(LOAD_TRACES[0]!.name)
    for (const h of HEROES) {
      expect(Object.keys(t.heroes[h.hero] ?? {}).sort()).toEqual([...HERO_COLUMNS, ...DERIVED_HERO_COLUMNS].sort())
    }
    expect(Object.keys(t.heroes).sort()).toEqual(HEROES.map((h) => h.hero).sort())
    expect(Object.keys(t.partyFlags).sort()).toEqual(HEROES.map((h) => h.flag).sort())
    expect(LOAD_PARSERS.hero).toHaveLength(HERO_COLUMNS.length)
    expect(LOAD_PARSERS.scene).toHaveLength(SCENE_COLUMNS.length)
    expect(Object.keys(t.progress).sort()).toEqual(
      ['dialogueEventOver', 'dialogueOrder', 'currentScript', 'nextScript', 'battle1Over', 'countOfBattle1'].sort(),
    )
    for (const k of DERIVED_COLUMNS) expect(t).toHaveProperty(k)

    const covered = new Set([
      'getTextInfo()',
      'sceneInfo',
      'menuInfo',
      'shopInfo',
      ...HEROES.map((h) => h.info),
      ...Object.keys(NOT_READ_BACK),
      ...Object.keys(NOT_RECORDED),
    ])
    // 按行判：第 1 行同时被 getTextInfo() 与 isNull() 读，有一个读取者有着落，这一行就有着落。
    for (const { slot } of LOAD_TRACES) {
      const loose = readTruth(`存档${slot}.txt`).reads.filter((r) => !r.readBy.some((b) => covered.has(b)))
      expect(loose.map((r) => r.line), `存档${slot} 里没着落的行`).toEqual([])
    }
  })

  describe.each(LOAD_TRACES)('$name（存档$slot）', ({ name, slot }) => {
    const truth = readTruth(`存档${slot}.txt`)
    const t = tick0(name)

    it('剧本头的 scene / isScript 与存档第 5 行一致', () => {
      const scene = parsedLine(lineOf(truth, 'sceneInfo'), LOAD_PARSERS.scene)
      const head = readTrace(name).script
      expect([head.isScript, head.scene]).toEqual([scene[0], scene[1]])
    })

    it('队伍旗标 ← getTextInfo() 前三项', () => {
      const party = parsedLine(lineOf(truth, 'getTextInfo()'), LOAD_PARSERS.party)
      expect(HEROES.map((h) => t.partyFlags[h.flag])).toEqual(party)
    })

    it('三个英雄的七项 ← 各自那一行', () => {
      for (const h of HEROES) {
        const v = parsedLine(lineOf(truth, h.info), LOAD_PARSERS.hero)
        expect(HERO_COLUMNS.map((c) => t.heroes[h.hero]?.[c]), h.info).toEqual(v)
      }
    })

    it('场景十项（场景名、isScript、对话进度、格子坐标、剧情三元组、战斗计数）← sceneInfo', () => {
      const v = parsedLine(lineOf(truth, 'sceneInfo'), LOAD_PARSERS.scene)
      expect(SCENE_COLUMNS.map((f) => f(t))).toEqual(v)
    })

    it('身上的装备 ← menuInfo（每人六格，"null" 即空格）', () => {
      const f = lineOf(truth, 'menuInfo')
      expect(f).toHaveLength(HEROES.length * WORN_ORDER.length)
      const want = HEROES.map((_, i) =>
        Object.fromEntries(WORN_ORDER.map((s, j) => [s, f[i * WORN_ORDER.length + j] === 'null' ? null : f[i * WORN_ORDER.length + j]])),
      )
      expect(t.worn).toEqual(want)
    })

    it('药与钱 ← shopInfo（前 DRUGS.length 项是各药件数，下一项是钱）', () => {
      const f = lineOf(truth, 'shopInfo')
      expect(f).toHaveLength(DRUGS.length + 1)
      expect(t.drugs).toEqual(f.slice(0, DRUGS.length).map(javaParseInt))
      expect(t.coins).toBe(javaParseInt(f[DRUGS.length]!))
    })

    it('装备库存读不回来：不管存档写着什么，起点的 stock 全 0（xl-1dv.32，登记在 NOT_READ_BACK）', () => {
      expect(Object.values(t[NOT_READ_BACK.equipmentShopInfo]).flat().every((n) => n === 0)).toBe(true)
    })
  })

  it('「读不回来」那一条这一批样本观测得到：至少一份存档的库存有非零项', () => {
    // 否则上面那条「全 0」对存档里本来就全 0 的样本是恒真的 —— 读回来与读不回来长得一样。
    const nonzero = LOAD_TRACES.filter(({ slot }) =>
      lineOf(readTruth(`存档${slot}.txt`), 'equipmentShopInfo').some((s) => /^[1-9]\d*$/.test(s)),
    )
    expect(nonzero.map((x) => x.name)).not.toEqual([])
  })
})
