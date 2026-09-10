import { readFileSync, readdirSync } from 'node:fs'
import { javaSource } from '../../test/javaSource'
import { repoPath } from '../../test/repoPath'
import { EQUIPMENT_LISTS, type EquipSlot } from '../../menu/equipment'
import {
  HERO_KEYS,
  SAVE_VERSION,
  parseSave,
  serializeSave,
  type HeroKey,
  type HeroRecord,
  type SaveFile,
  type SceneRecord,
  type ScriptTriple,
  type WornRecord,
} from '../format'

/**
 * **只给判据用**的原版存档解析器（xl-i06.7）。不进产品包 —— 它用 `node:fs` 读盘，
 * 形状同 `test/javaSource.ts`。
 *
 * 两种读法，各管一件事：
 *
 * 1. {@link loaderLine}：原版读取器 `start.Loader.loadLine` 的**实际**读法。
 *    `BufferedReader.readLine` 逐行读、`line.split("A")`、按行号取。那几行号是
 *    源码现读的（{@link loaderRequestedLines}）。它与数据层真值
 *    `tools/ground-truth/存档/存档N.json` 逐字段对齐。**不是作者打算的读法**：
 *    写 9 行、读 10 行（xl-1dv.19），装备店那行混着答题地图名、第 10 行永远为空 ——
 *    照读。
 * 2. {@link fromRecorderText} / {@link toRecorderText}：原版写档装置
 *    `start.Recorder.writeInfo` 的**写**法，反过来解析成我们的 {@link SaveFile}、
 *    再按原样写回去。写回来与样例逐字符相同，就说明 `SaveFile` 装得下原版存的
 *    **每一个**字段 —— 少一组，写不回来。哪几个列表挤在哪一行是从源码现读的
 *    （{@link recorderLayout}），列表之内字段怎么排是下面几份手写登记，由
 *    `originalSave.test.ts` 与源码对撞。
 */

/** 数据层真值目录，相对仓库根。 */
export const SAVE_TRUTH_DIR = 'tools/ground-truth/存档'

/** 真值目录里的 `存档N.txt`，按名字排序。分母，现扫。 */
export function sampleNames(): string[] {
  return readdirSync(repoPath(SAVE_TRUTH_DIR))
    .filter((n) => /^存档\d+\.txt$/.test(n))
    .sort()
}

/** 一份样例存档，按 GBK 解码。它是游戏**数据文件**，不是 Java 源码，所以不走 `javaSource`。 */
export function readSample(name: string): string {
  return new TextDecoder('gbk').decode(readFileSync(repoPath(SAVE_TRUTH_DIR, name)))
}

/** 对应的数据层真值（Java 侧 `SaveTruth` 调原版 `Loader.loadLine` 导出）。 */
export interface SaveTruthJson {
  file: string
  slot: number
  physicalLines: number
  reads: { line: number; readBy: string[]; fields: string[] }[]
}

export function readTruth(name: string): SaveTruthJson {
  return JSON.parse(
    readFileSync(repoPath(SAVE_TRUTH_DIR, name.replace(/\.txt$/, '.json')), 'utf8'),
  ) as SaveTruthJson
}

// ---------------------------------------------------------------- Java 语义

/**
 * `BufferedReader.readLine` 的切行：`\r\n` / `\r` / `\n` 都算行尾，最后一个行尾
 * 之后不再多一行空行。
 */
export function javaReadLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Java `String.split(sep)`（limit 0）的**完整**语义：一处都没匹配到时原样返回
 * `[s]` —— 于是 `"".split("A")` 是 `[""]`，一项；匹配到了就丢掉末尾所有空串 ——
 * 于是 `"A".split("A")` 是零项。
 *
 * ⚠️ `data/javaSplit.ts` 只抄了后一半：它把 `""` 切成**零项**。场景脚本里碰不到
 * 这个差别，而存档碰得到 —— 空的答题记录那一行，原版读出来是「1 项空串」
 * （数据层真值里就是这样，xl-1dv.19 的读数）。那个文件被烘焙指纹守着，这里另写
 * 一份，不去动它。
 */
export function javaSplitExact(s: string, sep: string): string[] {
  if (!s.includes(sep)) return [s]
  const parts = s.split(sep)
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  return parts
}

/** 原版的字段分隔符。与 `Loader.java` 里那句 `line.split("A")` 对撞见测试。 */
export const SEPARATOR = 'A'

// ---------------------------------------------------------------- 读法 1：原版读取器

/** `Loader` 里每一个 `loadLine(textcode, N)` 的 N，去重升序。源码现读。 */
export function loaderRequestedLines(): number[] {
  const src = javaSource('src/start/Loader.java')
  const lines = [...src.matchAll(/loadLine\(\s*textcode\s*,\s*(\d+)\s*\)/g)].map((m) => Number(m[1]))
  if (lines.length === 0) throw new Error('Loader.java 里一次 loadLine(textcode, N) 都没认出来 —— 不是「一行都不读」')
  return [...new Set(lines)].sort((a, b) => a - b)
}

/**
 * `Loader.loadLine(slot, lineNo)`：第 lineNo 行（从 1 数）按 `A` 切开；那一行
 * 不存在就是零项。
 */
export function loaderLine(text: string, lineNo: number): string[] {
  const line = javaReadLines(text)[lineNo - 1]
  return line === undefined ? [] : javaSplitExact(line, SEPARATOR)
}

// ---------------------------------------------------------------- 读法 2：原版写档装置

/** 原版在内存里攒的那十个列表（`Recorder` 的字段名）。 */
export type RecorderList =
  | 'roleAndMapInfo'
  | 'zhangXiaoFanInfo'
  | 'luXueQiInfo'
  | 'yuJieInfo'
  | 'sceneInfo'
  | 'menuInfo'
  | 'shopInfo'
  | 'equipmentShopInfo'
  | 'questionInfo'
  | 'answerInfo'

/**
 * `Recorder.writeInfo` 的物理布局：每一行由哪几个列表依次写成。源码现读 ——
 * `for(String word:X)` 与 `writer.newLine()` 按出现次序排开。
 */
export function recorderLayout(): string[][] {
  const src = javaSource('src/start/Recorder.java')
  const from = src.indexOf('void writeInfo')
  const to = src.indexOf('writer.close()', from)
  if (from < 0 || to < 0) throw new Error('Recorder.java 里找不到 writeInfo 的界标')
  const lines: string[][] = []
  let current: string[] = []
  for (const m of src.slice(from, to).matchAll(/for\s*\(\s*String\s+word\s*:\s*(\w+)\s*\)|writer\.newLine\(\)/g)) {
    if (m[1] !== undefined) {
      current.push(m[1])
    } else {
      lines.push(current)
      current = []
    }
  }
  if (current.length > 0) lines.push(current)
  if (lines.length === 0) throw new Error('writeInfo 里一个列表都没认出来')
  return lines
}

/**
 * **手写登记**：`NeverReadBack` 的每个键对应原版哪个列表。与
 * {@link derivedNeverReadBack}（源码现推）对撞见测试。
 */
export const NEVER_READ_BACK_SOURCE = {
  equipmentStock: 'equipmentShopInfo',
  questionMaps: 'questionInfo',
  answers: 'answerInfo',
} as const satisfies Record<keyof SaveFile['neverReadBack'], RecorderList>

/**
 * 原版「写了但从不读回游戏状态」的列表，**从源码现推**：
 *
 * - `Loader.load()` 里由 `loadLine` 读进来、之后在 `load()` 里再没被用过的变量
 *   （答题那两组：读进来就搁着）；
 * - 被用了、但交给的回填方法一次都不碰全局 `EquipmentPack` 的那一组（装备店的
 *   `initialEquipmentShopInfo` 只写面板自建的表，xl-1dv.32）。
 *
 * 另核一条旁证：`loadQuestion` / `loadAnswer` 全仓零调用点（xl-1dv.20）。
 */
export function derivedNeverReadBack(): string[] {
  const loader = javaSource('src/start/Loader.java')
  const recorder = javaSource('src/start/Recorder.java')
  const from = loader.indexOf('public void load(int textcode)')
  const to = loader.indexOf('public ArrayList<String> getTextInfo', from)
  if (from < 0 || to < 0) throw new Error('Loader.java 里找不到 load() 的界标')
  const body = loader.slice(from, to)
  const assigned = [...body.matchAll(/(\w+)\s*=\s*loadLine\(/g)].map((m) => m[1]!)
  if (assigned.length === 0) throw new Error('load() 里一个 loadLine 赋值都没认出来')
  const never: string[] = []
  for (const v of assigned) {
    const uses = [...body.matchAll(new RegExp(`\\b${v}\\b`, 'g'))].length
    if (uses === 1) {
      never.push(v)
      continue
    }
    const loadWith = new RegExp(`\\.(\\w+)\\(\\s*${v}\\s*\\)`).exec(body)?.[1]
    if (loadWith === undefined) throw new Error(`${v} 用了但认不出交给了谁`)
    const saveWith = new RegExp(`\\b${v}\\s*=[^;]*?\\.(\\w+)\\(\\)\\s*;`).exec(recorder)?.[1]
    if (saveWith === undefined) throw new Error(`Recorder.save 里认不出 ${v} 是哪个方法存的`)
    // 存的一侧读了哪些全局类，读的一侧的回填方法得一个不落地碰到；少一个，就是写进了别处。
    const readGlobals = globalsIn(methodBody(saveWith))
    const loadBody = methodBody(loadWith)
    if (readGlobals.some((g) => !loadBody.includes(`${g}.`))) never.push(v)
  }
  return never.sort()
}

/** 首字母大写、后面跟 `.` 的标识符 —— 即引用的类（静态字段所在），去掉 JDK 那几个。 */
function globalsIn(body: string): string[] {
  const jdk = new Set(['Integer', 'String', 'Boolean', 'Math'])
  return [...new Set([...body.matchAll(/\b([A-Z]\w*)\./g)].map((m) => m[1]!))].filter((g) => !jdk.has(g))
}

/**
 * 方法体：从签名到与签名同缩进的那个 `}`（`ShopPanel` 的方法缩进两格，不能按一格找）。
 * 在存 / 读两侧方法所在的那几个文件里找。
 */
function methodBody(name: string): string {
  const sig = new RegExp(`(void|ArrayList<String>)\\s+${name}\\s*\\(`)
  const src = LOAD_TARGET_FILES.map((f) => javaSource(f)).find((s) => sig.test(s))
  if (src === undefined) throw new Error(`找不到方法 ${name} 的定义`)
  const start = src.search(sig)
  const lineStart = src.lastIndexOf('\n', start) + 1
  const indent = /^[\t ]*/.exec(src.slice(lineStart))![0]
  const end = src.indexOf(`\n${indent}}`, start)
  if (end < 0) throw new Error(`${name} 的方法体没有收尾`)
  return src.slice(start, end)
}

/** 存 / 读两侧方法所在的文件（`Recorder.save` 与 `Loader.load` 交出去的那几个）。 */
const LOAD_TARGET_FILES = [
  'src/battle/ZhangXiaoFan.java',
  'src/battle/LuXueQi.java',
  'src/battle/YuJie.java',
  'src/scene/SaveAndLoad.java',
  'src/menu/EquipPanel.java',
  'src/shop/ShopPanel.java',
  'src/shop/EquipmentShopPanel.java',
]

// 下面几份次序是**手写登记**，各自由 originalSave.test.ts 与源码对撞。

/** `Recorder.save` 里 `roleAndMapInfo.add(...)` 那五项。 */
export const ROLE_AND_MAP_EXPRS = [
  'SaveAndLoad.zhang',
  'SaveAndLoad.lu',
  'SaveAndLoad.wen',
  'SaveAndLoad.mapName',
  'Reader.task',
] as const

/** 三个英雄 `saveRoleInfo()` 里 `roleInfo.add(...)` 的次序。 */
export const HERO_FIELDS: readonly (keyof HeroRecord)[] = ['level', 'hp', 'mp', 'angryValue', 'isAngry', 'isDead', 'exp']

/** `SaveAndLoad.saveSceneInfo()` 里 `sceneInfo.add(...)` 的次序，连原版表达式（去空白、去 `+""`）。 */
export const SCENE_FIELDS: readonly (readonly [keyof SceneRecord, string])[] = [
  ['isScript', 'scene.isScript'],
  ['fileName', 'scene.fileName'],
  ['dialogueEventOver', 'scene.dialogueEvent.dialogueEventOver'],
  ['dialogueOrder', 'scene.dialogueEvent.getDialogueOrder()'],
  ['x', 'scene.role.getX()'],
  ['y', 'scene.role.getY()'],
  ['currentScript', 'scene.currentScript[0]+" "+scene.currentScript[1]+" "+scene.currentScript[2]'],
  ['nextScript', 'scene.nextScript[0]+" "+scene.nextScript[1]+" "+scene.nextScript[2]'],
  ['battle1Over', 'scene.fightEvent.battle1Over'],
  ['countOfBattle1', 'scene.fightEvent.countOfBattle1'],
]

/** `EquipPanel.saveEquipInfo()` 每个英雄六格的次序。 */
export const WORN_ORDER: readonly EquipSlot[] = ['weapon', 'armor', 'helmet', 'shoe', 'glove', 'decoration']

/** `EquipmentShopPanel.saveEquipmentShopInfo()` 遍历 `EquipmentPack` 六张表的次序。 */
export const STOCK_ORDER: readonly EquipSlot[] = ['helmet', 'armor', 'weapon', 'glove', 'shoe', 'decoration']

/** 装备总件数 = 装备店那一段的宽度。 */
export const EQUIPMENT_TOTAL = STOCK_ORDER.reduce((n, s) => n + EQUIPMENT_LISTS[s].length, 0)

// 字段值的严格编解码：这是按写法解析，对不上就抛，不猜。

function int(s: string, what: string): number {
  if (!/^-?\d+$/.test(s)) throw new Error(`${what}：${JSON.stringify(s)} 不是整数`)
  return Number(s)
}

function bool(s: string, what: string): boolean {
  if (s === 'true') return true
  if (s === 'false') return false
  throw new Error(`${what}：${JSON.stringify(s)} 不是 true/false`)
}

function triple(s: string, what: string): ScriptTriple {
  const t = s.split(' ')
  if (t.length !== 3) throw new Error(`${what}：${JSON.stringify(s)} 不是空格分隔的三段`)
  return [t[0]!, t[1]!, t[2]!]
}

/** 可变的草稿：按列表逐个填。 */
interface Draft {
  party?: SaveFile['party']
  summary?: SaveFile['summary']
  heroes: Partial<Record<HeroKey, HeroRecord>>
  scene?: SceneRecord
  worn?: SaveFile['worn']
  drugs?: number[]
  coins?: number
  neverReadBack: { -readonly [K in keyof SaveFile['neverReadBack']]?: SaveFile['neverReadBack'][K] }
}

interface Codec {
  /** 固定宽度；null = 吃掉这一行剩下的全部（一行里至多一个）。 */
  width: number | null
  encode(s: SaveFile): string[]
  decode(f: string[], d: Draft): void
}

export function encodeHero(h: HeroRecord): string[] {
  return HERO_FIELDS.map((k) => String(h[k]))
}

function heroCodec(key: HeroKey): Codec {
  return {
    width: HERO_FIELDS.length,
    encode: (s) => encodeHero(s.heroes[key]),
    decode: (f, d) => {
      const h: Record<string, number | boolean> = {}
      HERO_FIELDS.forEach((k, i) => {
        h[k] = k === 'isAngry' || k === 'isDead' ? bool(f[i]!, `${key}.${k}`) : int(f[i]!, `${key}.${k}`)
      })
      d.heroes[key] = h as unknown as HeroRecord
    },
  }
}

export function encodeScene(sc: SceneRecord): string[] {
  return SCENE_FIELDS.map(([k]) => {
    const v = sc[k]
    return Array.isArray(v) ? v.join(' ') : String(v)
  })
}

const SCENE_BOOLS = new Set<keyof SceneRecord>(['isScript', 'dialogueEventOver', 'battle1Over'])
const SCENE_INTS = new Set<keyof SceneRecord>(['dialogueOrder', 'x', 'y', 'countOfBattle1'])

export function encodeWorn(worn: SaveFile['worn']): string[] {
  return worn.flatMap((w) => WORN_ORDER.map((s) => w[s] ?? 'null'))
}

export function encodeShop(drugs: readonly number[], coins: number): string[] {
  return [...drugs.map(String), String(coins)]
}

/** 原版十个列表 → 我们的格式。键集合与 {@link recorderLayout} 对撞见测试。 */
export const CODECS: Readonly<Record<RecorderList, Codec>> = {
  roleAndMapInfo: {
    width: ROLE_AND_MAP_EXPRS.length,
    encode: (s) => [
      String(s.party.zhang),
      String(s.party.lu),
      String(s.party.wen),
      s.summary.mapName,
      s.summary.task ?? 'null',
    ],
    decode: (f, d) => {
      d.party = { zhang: bool(f[0]!, 'zhang'), lu: bool(f[1]!, 'lu'), wen: bool(f[2]!, 'wen') }
      // Recorder 写 `Reader.task` 的初值 null 时落成字面量 "null"；反过来也只能这么认。
      d.summary = { mapName: f[3]!, task: f[4] === 'null' ? null : f[4]! }
    },
  },
  zhangXiaoFanInfo: heroCodec('zhangXiaoFan'),
  luXueQiInfo: heroCodec('luXueQi'),
  yuJieInfo: heroCodec('yuJie'),
  sceneInfo: {
    width: SCENE_FIELDS.length,
    encode: (s) => encodeScene(s.scene),
    decode: (f, d) => {
      const sc: Record<string, unknown> = {}
      SCENE_FIELDS.forEach(([k], i) => {
        const v = f[i]!
        sc[k] = SCENE_BOOLS.has(k) ? bool(v, k) : SCENE_INTS.has(k) ? int(v, k) : k.endsWith('Script') ? triple(v, k) : v
      })
      d.scene = sc as unknown as SceneRecord
    },
  },
  menuInfo: {
    width: 3 * WORN_ORDER.length,
    encode: (s) => encodeWorn(s.worn),
    decode: (f, d) => {
      const hero = (i: number): WornRecord =>
        Object.fromEntries(
          WORN_ORDER.map((s, k) => {
            const v = f[i * WORN_ORDER.length + k]!
            return [s, v === 'null' ? null : v]
          }),
        ) as WornRecord
      d.worn = [hero(0), hero(1), hero(2)]
    },
  },
  shopInfo: {
    width: null,
    encode: (s) => encodeShop(s.drugs, s.coins),
    decode: (f, d) => {
      if (f.length === 0) throw new Error('shopInfo 一项都没有，连钱都没有')
      d.drugs = f.slice(0, -1).map((v, i) => int(v, `drugs[${i}]`))
      d.coins = int(f[f.length - 1]!, 'coins')
    },
  },
  equipmentShopInfo: {
    width: EQUIPMENT_TOTAL,
    encode: (s) => STOCK_ORDER.flatMap((slot) => s.neverReadBack.equipmentStock[slot].map(String)),
    decode: (f, d) => {
      let at = 0
      const stock = {} as Record<EquipSlot, number[]>
      for (const slot of STOCK_ORDER) {
        const n = EQUIPMENT_LISTS[slot].length
        stock[slot] = f.slice(at, at + n).map((v, i) => int(v, `equipmentStock.${slot}[${i}]`))
        at += n
      }
      d.neverReadBack.equipmentStock = stock
    },
  },
  questionInfo: {
    width: null,
    encode: (s) => [...s.neverReadBack.questionMaps],
    decode: (f, d) => {
      d.neverReadBack.questionMaps = f
    },
  },
  answerInfo: {
    width: null,
    // SaveAndLoad.saveAnswer：每张地图一项，每题 `true ` / `false `（带尾空格）拼起来。
    encode: (s) => s.neverReadBack.answers.map((a) => a.map((b) => `${b} `).join('')),
    decode: (f, d) => {
      const answers = f.map((s, i) => {
        if (s !== '' && !s.endsWith(' ')) throw new Error(`answers[${i}]：${JSON.stringify(s)} 没有尾空格`)
        return s === '' ? [] : s.slice(0, -1).split(' ').map((t) => bool(t, `answers[${i}]`))
      })
      d.neverReadBack.answers = answers
    },
  },
}

/** 按**写**法切一行：每个字段后面都跟一个 `A`，所以末尾恰好一个空串，去掉它。 */
function writtenFields(line: string): string[] {
  const parts = line.split(SEPARATOR)
  if (parts.pop() !== '') throw new Error(`这一行不以 ${SEPARATOR} 结尾：${JSON.stringify(line)}`)
  return parts
}

/** 样例文本 → {@link SaveFile}，按原版写档装置的布局。行数、宽度对不上都抛。 */
export function fromRecorderText(text: string): SaveFile {
  const layout = recorderLayout()
  const lines = javaReadLines(text)
  if (lines.length !== layout.length) {
    throw new Error(`写档装置写 ${layout.length} 行，这份档有 ${lines.length} 行`)
  }
  const d: Draft = { heroes: {}, neverReadBack: {} }
  layout.forEach((lists, li) => {
    const fields = writtenFields(lines[li]!)
    const codecs = lists.map((l) => codecOf(l))
    const fixed = codecs.reduce((n, c) => n + (c.width ?? 0), 0)
    const rest = codecs.filter((c) => c.width === null).length
    if (rest > 1) throw new Error(`第 ${li + 1} 行有两个不定宽的列表：${lists.join(', ')}`)
    if (rest === 0 ? fields.length !== fixed : fields.length < fixed) {
      throw new Error(`第 ${li + 1} 行（${lists.join(' + ')}）有 ${fields.length} 项，定宽部分要 ${fixed} 项`)
    }
    let at = 0
    for (const c of codecs) {
      const n = c.width ?? fields.length - fixed
      c.decode(fields.slice(at, at + n), d)
      at += n
    }
  })
  for (const k of HERO_KEYS) if (!d.heroes[k]) throw new Error(`没解出 ${k}`)
  // 出口过一遍产品侧的形状检查：哪一组没解出来，这里就抛，不靠别的测试间接兜。
  return parseSave(serializeSave({ version: SAVE_VERSION, ...d } as unknown as SaveFile))
}

/** {@link SaveFile} → 原版写档装置会写出的文本。行尾由调用方给（原版跟平台走）。 */
export function toRecorderText(save: SaveFile, eol: string): string {
  return recorderLayout()
    .map((lists) => lists.flatMap((l) => codecOf(l).encode(save)).map((f) => f + SEPARATOR).join('') + eol)
    .join('')
}

function codecOf(list: string): Codec {
  const c = (CODECS as Record<string, Codec | undefined>)[list]
  if (!c) throw new Error(`写档装置写了一个没人认领的列表：${list}`)
  return c
}
