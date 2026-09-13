import { describe, expect, it } from 'vitest'
import { DRUGS } from '../battle/drugs'
import { EQUIPMENT_LISTS } from '../menu/equipment'
import type { SceneRecord } from '../save/format'
import {
  HERO_FIELDS,
  LOAD_PARSERS,
  NEVER_READ_BACK_SOURCE,
  SCENE_FIELDS,
  STOCK_ORDER,
  WORN_ORDER,
  javaEqualsTrue,
  javaParseBoolean,
  javaParseInt,
  readTruth,
} from '../save/test/originalSave'
import type { LoadParser, SaveTruthJson } from '../save/test/originalSave'
import { SCENE_TRACE_NAMES, readTrace } from './trace'

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
 * 为什么非要这一条：`traceReplay.test.ts` 逐 tick 对齐这几份真值，对的是**web 的**
 * `worldAfterLoad(loaderReadBack(存档N.txt))`；`format.test.ts` / `originalSave.test.ts`
 * 把 `loaderReadBack` 钉在数据层真值上。两份真值之间的相等因此只是**经由 web 实现传递地**
 * 成立 —— 导出端与回放端同错一处（比如同样把两个英雄的行对调），那条链照样全绿。
 * 这里直接拿真值对真值。
 *
 * 解法（`parseInt` / `parseBoolean` / 手写 `equals("true")`）不在这里重写，用的是
 * `LOAD_PARSERS` —— 那份登记与 GBK 源码的对撞在 `loaderReadBack.test.ts`。
 *
 * 起点 = **原版读档之后的状态**，不是存档里写着的状态（xl-s9w 定的语义，见
 * `docs/trace-format.md` 的 `load` 一行）。两者不等的地方在下面逐条登记。
 */

/** 读档专属列（`SceneDriver.appendLoadColumns`），外加每拍都记的三项。`TraceTick` 不给它们类型，这里只取用到的。 */
interface LoadTick {
  scene: string
  isScript: boolean
  role: { x: number; y: number }
  progress: Record<string, unknown>
  partyFlags: Record<string, boolean>
  heroes: Record<string, Record<string, unknown>>
  worn: Record<string, string | null>[]
  drugs: number[]
  coins: number
  stock: Record<string, number[]>
}

/** 场景真值按「剧本头有没有 load」分两堆。两堆都是磁盘现扫（分母）。 */
const SCENE_TRACES = SCENE_TRACE_NAMES.map((n) => readTrace(n))
const LOAD_TRACES = SCENE_TRACES.filter((t) => t.script.load !== undefined).map((t) => ({
  name: t.script.name,
  slot: t.script.load!,
}))
const PLAIN_TRACE = SCENE_TRACES.find((t) => t.script.load === undefined)

function tick0(name: string): LoadTick {
  const t = readTrace(name).ticks[0]
  if (t === undefined) throw new Error(`${name} 一拍都没有`)
  return t as unknown as LoadTick
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

const parsed = (fields: readonly string[], parsers: readonly LoadParser[]) => {
  expect(fields).toHaveLength(parsers.length)
  return parsers.map((p, i) => parse(p, fields[i]!))
}

/** 三个英雄：数据层真值的 `readBy` ↔ trace `heroes` / `partyFlags` 的键。次序即 `roleAndMapInfo` 前三项。 */
const HEROES = [
  { info: 'zhangXiaoFanInfo', hero: 'zhang', flag: 'zhang' },
  { info: 'luXueQiInfo', hero: 'lu', flag: 'lu' },
  { info: 'yuJieInfo', hero: 'yu', flag: 'wen' },
] as const

/** `SCENE_FIELDS` 每一项在 trace 里的落点。键由 `SceneRecord` 定，少一项或多一项 tsc 就报。 */
const SCENE_COLUMN: Readonly<Record<keyof SceneRecord, (t: LoadTick) => unknown>> = {
  isScript: (t) => t.isScript,
  fileName: (t) => t.scene,
  dialogueEventOver: (t) => t.progress.dialogueEventOver,
  dialogueOrder: (t) => t.progress.dialogueOrder,
  x: (t) => t.role.x,
  y: (t) => t.role.y,
  currentScript: (t) => t.progress.currentScript,
  nextScript: (t) => t.progress.nextScript,
  battle1Over: (t) => t.progress.battle1Over,
  countOfBattle1: (t) => t.progress.countOfBattle1,
}

/**
 * **登记**：trace 读档专属列里**不从存档来**的那些。四项属性是读档之后按等级重算、再叠
 * 装备加成出来的，`skillNumber` 是 `intialFromInfo` 按等级抬的 static —— 存档里都没有
 * 对应项，所以不对撞。
 */
const DERIVED_HERO_COLUMNS = ['physicalPower', 'sprit', 'agile', 'strength'] as const
const DERIVED_COLUMNS = ['skillNumber'] as const

/**
 * `getTextInfo()` 那一行：前三项是队伍旗标，**后两项**（存读档面板摘要用的地图图名与任务）
 * 场景真值不记。
 */
const TEXT_INFO_UNRECORDED = 2

/**
 * 存档里「写了但从不读回游戏状态」的那几行，用的是 `originalSave.ts` 从源码现推、与之对撞
 * 过的那份登记，这里不另记一份：装备库存（xl-1dv.32，读档之后 `stock` 恒 0 —— 下面有一条
 * 专门的判据），答题两组（读进来就搁着）。
 */
const NEVER_READ_BACK_LINES: readonly string[] = Object.values(NEVER_READ_BACK_SOURCE)

describe('从存档起步的剧本：起点状态 ↔ 数据层真值（xl-s9w）', () => {
  it('至少有一条剧本从存档起步、至少有一条不是（空名单会让下面一条断言都不跑还全绿）', () => {
    expect(LOAD_TRACES.length).toBeGreaterThan(0)
    expect(PLAIN_TRACE).toBeDefined()
  })

  describe.each(LOAD_TRACES)('$name（存档$slot）', ({ name, slot }) => {
    const truth = readTruth(`存档${slot}.txt`)
    const t = tick0(name)

    it('trace 这一侧每一列都有着落：读档专属列（与普通场景真值的差集，现算）要么对撞、要么登记成派生', () => {
      const plain = new Set(Object.keys(readTrace(PLAIN_TRACE!.script.name).ticks[0]!))
      const loadOnly = Object.keys(t).filter((k) => !plain.has(k))
      expect(loadOnly.sort()).toEqual(
        ['progress', 'partyFlags', 'heroes', 'worn', 'drugs', 'coins', 'stock', ...DERIVED_COLUMNS].sort(),
      )
      expect(Object.keys(t.progress).sort()).toEqual(
        SCENE_FIELDS.map(([k]) => k)
          .filter((k) => !['isScript', 'fileName', 'x', 'y'].includes(k))
          .sort(),
      )
      expect(Object.keys(t.heroes).sort()).toEqual(HEROES.map((h) => h.hero).sort())
      expect(Object.keys(t.partyFlags).sort()).toEqual(HEROES.map((h) => h.flag).sort())
      for (const h of HEROES) {
        expect(Object.keys(t.heroes[h.hero] ?? {}).sort()).toEqual([...HERO_FIELDS, ...DERIVED_HERO_COLUMNS].sort())
      }
    })

    it('存档这一侧每一行都有着落：要么对撞、要么在「从不读回」登记里', () => {
      const covered = new Set([
        'getTextInfo()',
        'sceneInfo',
        'menuInfo',
        'shopInfo',
        ...HEROES.map((h) => h.info),
        ...NEVER_READ_BACK_LINES,
      ])
      // 按行判：第 1 行同时被 getTextInfo() 与 isNull() 读，有一个读取者有着落，这一行就有着落。
      const loose = truth.reads.filter((r) => !r.readBy.some((b) => covered.has(b)))
      expect(loose.map((r) => r.line)).toEqual([])
    })

    it('剧本头的 scene / isScript 与存档 sceneInfo 一致', () => {
      const scene = parsed(lineOf(truth, 'sceneInfo'), LOAD_PARSERS.scene)
      const head = readTrace(name).script
      const at = (k: keyof SceneRecord) => scene[SCENE_FIELDS.findIndex(([f]) => f === k)]
      expect([head.isScript, head.scene]).toEqual([at('isScript'), at('fileName')])
    })

    it('队伍旗标 ← getTextInfo() 前三项', () => {
      const f = lineOf(truth, 'getTextInfo()')
      expect(f).toHaveLength(LOAD_PARSERS.party.length + TEXT_INFO_UNRECORDED)
      const party = parsed(f.slice(0, LOAD_PARSERS.party.length), LOAD_PARSERS.party)
      expect(HEROES.map((h) => t.partyFlags[h.flag])).toEqual(party)
    })

    it('三个英雄的七项 ← 各自那一行', () => {
      for (const h of HEROES) {
        const v = parsed(lineOf(truth, h.info), LOAD_PARSERS.hero)
        expect(HERO_FIELDS.map((c) => t.heroes[h.hero]?.[c]), h.info).toEqual(v)
      }
    })

    it('场景十项（场景名、isScript、对话进度、格子坐标、剧情三元组、战斗计数）← sceneInfo', () => {
      const v = parsed(lineOf(truth, 'sceneInfo'), LOAD_PARSERS.scene)
      expect(SCENE_FIELDS.map(([k]) => SCENE_COLUMN[k](t))).toEqual(v)
    })

    it('身上的装备 ← menuInfo（每人六格，"null" 即空格）', () => {
      const f = lineOf(truth, 'menuInfo')
      expect(f).toHaveLength(HEROES.length * WORN_ORDER.length)
      const want = HEROES.map((_, i) =>
        Object.fromEntries(
          WORN_ORDER.map((s, j) => {
            const v = f[i * WORN_ORDER.length + j]
            return [s, v === 'null' ? null : v]
          }),
        ),
      )
      expect(t.worn).toEqual(want)
    })

    it('药与钱 ← shopInfo（前 DRUGS.length 项是各药件数，下一项是钱）', () => {
      const f = lineOf(truth, 'shopInfo')
      expect(f).toHaveLength(DRUGS.length + 1)
      expect(t.drugs).toEqual(f.slice(0, DRUGS.length).map(javaParseInt))
      expect(t.coins).toBe(javaParseInt(f[DRUGS.length]!))
    })

    it('装备库存读不回来：不管存档写着什么，起点的 stock 六张表齐全、每一格都是 0（xl-1dv.32）', () => {
      // 先核形状：stock 是 {} 或表是空的话，「每一格都是 0」恒真。
      expect(Object.keys(t.stock).sort()).toEqual([...STOCK_ORDER].sort())
      for (const s of STOCK_ORDER) expect(t.stock[s], s).toHaveLength(EQUIPMENT_LISTS[s].length)
      expect(Object.values(t.stock).flat().every((n) => n === 0)).toBe(true)
    })
  })

  it('「读不回来」那一条这一批样本观测得到：至少一份存档的库存有非零项', () => {
    // 否则上面那条「全 0」对存档里本来就全 0 的样本是恒真的 —— 读回来与读不回来长得一样。
    const nonzero = LOAD_TRACES.filter(({ slot }) =>
      lineOf(readTruth(`存档${slot}.txt`), NEVER_READ_BACK_SOURCE.equipmentStock).some((s) => /^[1-9]\d*$/.test(s)),
    )
    expect(nonzero.map((x) => x.name)).not.toEqual([])
  })
})
