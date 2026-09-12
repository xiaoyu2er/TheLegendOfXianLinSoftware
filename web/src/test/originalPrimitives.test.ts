import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { javaSource } from './javaSource'
import { repoPath } from './repoPath'

/**
 * 原版「平台原语」逐处台账：**分母现扫、判定人签**，两边对撞（xl-03x.20）。
 *
 * ADR-0001 例外表的历史遗漏，上一轮（xl-03x.4）是用措辞 grep 找的 —— 注释里没用那几个
 * 措辞的偏离它结构性地看不见。这个文件换一个方向：**从原版侧出发**，把「浏览器里没有
 * 对应物」的那一类原语（线程、睡眠、定时器、退出、随机数、音频、文件 IO、异常捕获、
 * 光标、窗口）在 `src/` 里的每一处调用点现扫出来，逐处要求台账
 * `docs/original-primitives.md` 给一个判定：照做 / 已登记（ADR-0001 的哪一行）/
 * 欠账（哪张票）/ 仪器（迁移时加的，不是原版行为）/ 未核（读了没读明白，如实记下）。
 *
 * **两半谁都不能自己给自己签字**（dispatch.md 纪律 3）：
 *
 * - 分母 = 下面 `PRIMITIVES` 那张正则表扫 `src/**\/*.java`。**这张表就是「这一类原语」
 *   的定义**，改它就是改分母 —— 多加一类，新扫出来的每一行都没有判定，当场红；
 * - 判定 = 台账那张表，人写。扫描器只核它引用完整（每行都有归属、每个键都真存在），
 *   **不核判定对不对** —— 「照做」是不是真照做了，是证据那一格指过去的判据的事。
 *
 * ## ⚠️ 它看不见的
 *
 * - **原语清单之外的偏离。** 键位（`KeyEvent.VK_*`）、隐式的 NPE、绘制次序、字形……
 *   都不在这张表里。清单封闭是它比措辞 grep 强的地方，也正是它的边界。
 * - **判定写错了。** 台账写「照做」而其实没照做，这里照样绿。
 */

const LEDGER = 'docs/original-primitives.md'
const ADR = 'docs/adr/0001-web-duplicates-original-defects.md'
const ISSUES = 'tools/issue-snapshot/issues.json'

/**
 * 「浏览器里没有对应物」的原语，按类。**封闭、可现数**：改这张表就是改分母，
 * 台账那边立刻要跟（每一行新命中都得有判定）。
 */
export const PRIMITIVES = {
  线程: /new Thread\b|implements Runnable|synchronized/,
  睡眠: /\b(?:Clock|Thread)\.sleep\(/,
  定时器: /\bnew Timer\b|javax\.swing\.Timer/,
  退出: /System\.exit\(/,
  随机数: /Math\.random\(|new Random\b/,
  音频: /AudioSystem|\bClip\b|SourceDataLine/,
  文件: /\bnew (?:File(?:Reader|Writer|InputStream|OutputStream)?|RandomAccessFile)\(/,
  捕获: /\bcatch\s*\(/,
  光标: /setCursor|createCustomCursor|Toolkit\./,
  窗口: /setVisible|setTitle|setResizable|setDefaultCloseOperation/,
} as const satisfies Record<string, RegExp>

type Kind = keyof typeof PRIMITIVES
const KINDS = Object.keys(PRIMITIVES) as Kind[]

/** 注释行不算调用点：以 `//`、`*`、`/*` 起头的行整行跳过。 */
const COMMENT = /^\s*(?:\/\/|\*|\/\*)/

interface Hit {
  readonly site: string
  readonly kinds: readonly Kind[]
}

function javaFiles(dir: string): string[] {
  return readdirSync(repoPath(dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.java'))
    .map((f) => `${dir}/${f.split('\\').join('/')}`)
    .sort()
}

const FILES = javaFiles('src')

/** `src/x/Y.java:12` → 这一行命中的原语类。 */
const HITS: ReadonlyMap<string, Hit> = (() => {
  const hits = new Map<string, Hit>()
  for (const file of FILES) {
    javaSource(file)
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (COMMENT.test(line)) return
        const kinds = KINDS.filter((k) => PRIMITIVES[k].test(line))
        if (kinds.length > 0) hits.set(`${file}:${i + 1}`, { site: `${file}:${i + 1}`, kinds })
      })
  }
  return hits
})()

/**
 * `未核` 是「读了、没读明白、也没跑」—— 如实写成一种判定，而不是塞进最像的那一格。
 * 它在读数里单独计数，好让「还有几处没人说得清」是一个数得出来的问题。
 */
type Verdict =
  | { readonly kind: '照做' }
  | { readonly kind: '已登记'; readonly key: string }
  | { readonly kind: '欠账'; readonly issue: string }
  | { readonly kind: '仪器' }
  | { readonly kind: '未核' }

interface Row {
  readonly no: number
  readonly sites: readonly string[]
  readonly kinds: readonly string[]
  readonly verdict: Verdict | undefined
  readonly raw: string
}

const SITE_CELL = /^`(src\/[^`:]+\.java):(\d+(?:,\d+)*)`$/
const VERDICT_CELL = /^(照做|仪器|未核|已登记 `ADR-0001#([a-z0-9]+(?:-[a-z0-9]+)*)`|欠账 (xl-[0-9a-z]+(?:\.[0-9]+)*))$/

function parseVerdict(cell: string): Verdict | undefined {
  const m = VERDICT_CELL.exec(cell)
  if (!m) return undefined
  if (m[1] === '照做' || m[1] === '仪器' || m[1] === '未核') return { kind: m[1] }
  if (m[2]) return { kind: '已登记', key: m[2] }
  return { kind: '欠账', issue: m[3]! }
}

/** 台账「## 台账」一节那张表：调用点 · 原语 · 判定 · 证据。 */
const LEDGER_TEXT = readFileSync(repoPath(LEDGER), 'utf8')

const ROWS: readonly Row[] = (() => {
  const lines = LEDGER_TEXT.split('\n')
  const start = lines.findIndex((l) => l.startsWith('## 台账'))
  if (start < 0) throw new Error(`${LEDGER} 里找不到「## 台账」一节 —— 标题改了？`)
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  const rows: Row[] = []
  for (let i = start + 1; i < (end < 0 ? lines.length : end); i++) {
    const line = lines[i]!
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells[0] === '调用点' || /^:?-+:?$/.test(cells[0]!)) continue
    const m = SITE_CELL.exec(cells[0]!)
    if (!m) throw new Error(`${LEDGER}:${i + 1} 第一格不是 \`src/…java:行号[,行号…]\`：${cells[0]}`)
    rows.push({
      no: i + 1,
      sites: m[2]!.split(',').map((n) => `${m[1]}:${n}`),
      kinds: cells[1]!.split('/').map((k) => k.trim()),
      verdict: parseVerdict(cells[2] ?? ''),
      raw: cells[2] ?? '',
    })
  }
  return rows
})()

/** ADR-0001「## 例外」一节里每一行的键。 */
const ADR_KEYS: ReadonlySet<string> = (() => {
  const lines = readFileSync(repoPath(ADR), 'utf8').split('\n')
  const start = lines.findIndex((l) => l.startsWith('## 例外'))
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  const keys = new Set<string>()
  for (const l of lines.slice(start + 1, end < 0 ? undefined : end)) {
    const m = /^\|\s*`([a-z0-9-]+)`\s*\|/.exec(l)
    if (m) keys.add(m[1]!)
  }
  return keys
})()

const SNAPSHOT: Readonly<Record<string, string>> = JSON.parse(readFileSync(repoPath(ISSUES), 'utf8'))

describe('原版平台原语 ⇄ 台账（docs/original-primitives.md）', () => {
  it('两边都真的读出了东西 —— 空转要响', () => {
    // GBK 按 UTF-8 解、目录写错、正则写坏，都是「零命中」，而零命中对零行是一条恒真的对撞。
    expect(FILES.length, 'src/ 下一个 .java 都没扫到').toBeGreaterThan(50)
    expect(HITS.size, 'src/ 里一处原语都没扫到').toBeGreaterThan(0)
    expect(ROWS.length, `${LEDGER} 的台账一行都没读出来`).toBeGreaterThan(0)
    expect(ADR_KEYS.size, `${ADR} 的例外表一个键都没读出来`).toBeGreaterThan(0)
  })

  it('每一类原语在 src/ 里都至少命中一处 —— 死掉的正则要响', () => {
    // 一类零命中，说明那条正则已经匹配不到任何东西，它守着的那一类从分母里悄悄消失了。
    const dead = KINDS.filter((k) => ![...HITS.values()].some((h) => h.kinds.includes(k)))
    expect(dead).toEqual([])
  })

  it('每一处命中都恰好落在台账的一行里（漏登 → 红，重复登 → 红）', () => {
    const owner = new Map<string, number[]>()
    for (const r of ROWS) for (const s of r.sites) owner.set(s, [...(owner.get(s) ?? []), r.no])
    const missing = [...HITS.keys()].filter((s) => !owner.has(s))
    const doubled = [...owner].filter(([, nos]) => nos.length > 1).map(([s, nos]) => `${s} ← 第 ${nos.join(' / ')} 行`)
    expect(missing, '这些调用点在台账里没有判定').toEqual([])
    expect(doubled).toEqual([])
  })

  it('台账里写的每一个行号都真是一处命中（过期的行 → 红）', () => {
    const stale = ROWS.flatMap((r) => r.sites.filter((s) => !HITS.has(s)).map((s) => `${s}（台账第 ${r.no} 行）`))
    expect(stale).toEqual([])
  })

  it('每一行的「原语」一格与那几行实际命中的类一致', () => {
    const wrong = ROWS.filter((r) => {
      const actual = new Set(r.sites.flatMap((s) => HITS.get(s)?.kinds ?? []))
      return [...actual].sort().join('/') !== [...r.kinds].sort().join('/')
    }).map((r) => `第 ${r.no} 行写「${r.kinds.join(' / ')}」`)
    expect(wrong).toEqual([])
  })

  it('每一格判定都是五种写法之一，引用的键与票都真存在', () => {
    const bad = ROWS.flatMap((r) => {
      const v = r.verdict
      if (!v) return [`第 ${r.no} 行判定写法认不出来：${r.raw}`]
      if (v.kind === '已登记' && !ADR_KEYS.has(v.key)) return [`第 ${r.no} 行：ADR-0001 例外表里没有 ${v.key}`]
      if (v.kind === '欠账' && !(v.issue in SNAPSHOT)) return [`第 ${r.no} 行：票据快照里没有 ${v.issue}`]
      return []
    })
    expect(bad).toEqual([])
  })

  it('台账开头那句读数与现数一致', () => {
    const tally = { 照做: 0, 已登记: 0, 欠账: 0, 仪器: 0, 未核: 0 }
    for (const r of ROWS) if (r.verdict) tally[r.verdict.kind] += r.sites.length
    const expected =
      `共 ${HITS.size} 行命中、${ROWS.length} 个单元` +
      `（照做 ${tally.照做} · 已登记 ${tally.已登记} · 欠账 ${tally.欠账} · 仪器 ${tally.仪器} · 未核 ${tally.未核}）`
    expect(LEDGER_TEXT, `台账开头应写：${expected}`).toContain(expected)
  })
})
