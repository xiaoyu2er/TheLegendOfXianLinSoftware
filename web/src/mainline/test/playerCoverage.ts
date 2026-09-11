/**
 * **只给判据用**：解析 `docs/player-coverage.md` 那张对照表，对着入库的票据快照撞
 * 引用完整性（xl-03x.2）。为什么只守引用、为什么真值源不是 `.beads/issues.jsonl`，
 * 见 `playerCoverage.test.ts` 的头注。
 *
 * 文档的约定（改约定就要同时改这里）：
 *
 * - 表是**第一张**表头为 `| 玩家能做的事 | … |` 的 markdown 表，五列：
 *   事 · Web 能不能做 · 走主线碰不碰得到 · 欠的那部分归 · 依据。
 * - 第二列以三种判定之一开头：`能` / `**不能**` / `**能，但不对**`。
 * - 文档里**任何地方**出现的票号都要紧跟着写它的状态：`xl-d8u（open）` /
 *   `xl-czb.7（closed）`。open 包括 in_progress / blocked / deferred（快照只分两桶）。
 * - 表前面有一句读数：`共 N 行（能 A · 不能 B · 能但不对 C）`。
 */

export type Status = 'open' | 'closed'
export type Snapshot = Readonly<Record<string, Status>>
export type Verdict = '能' | '不能' | '不对'

export interface Ref {
  readonly id: string
  readonly claimed: Status | undefined
  readonly line: number
}

export interface Row {
  readonly line: number
  readonly cells: readonly string[]
  /** 判定列认不出来时是 `undefined`，由 `problems` 报。 */
  readonly verdict: Verdict | undefined
  /** 「欠的那部分归」那一列里的票号。 */
  readonly owners: readonly Ref[]
}

export interface Coverage {
  readonly rows: readonly Row[]
  readonly refs: readonly Ref[]
  readonly reading: { rows: number; can: number; cannot: number; wrong: number } | undefined
}

const COLUMNS = 5
const HEADER = /^\|\s*玩家能做的事\s*\|/
/**
 * 票号，后面可选地跟一个状态。尾部的负向先行断言让分支 slug（`xl-czb-7`）整个不算
 * 票号，而不是被截成 `xl-czb`。
 */
const REF = /(xl-[0-9a-z]+(?:\.[0-9]+)*)(?![0-9a-z-])(?:（(open|closed)）)?/g
const READING = /共 (\d+) 行（能 (\d+) · 不能 (\d+) · 能但不对 (\d+)）/

function refsIn(text: string, line: number): Ref[] {
  return [...text.matchAll(REF)].map((m) => ({ id: m[1]!, claimed: m[2] as Status | undefined, line }))
}

function verdictOf(cell: string): Verdict | undefined {
  if (cell.startsWith('**不能**')) return '不能'
  if (cell.startsWith('**能，但不对**')) return '不对'
  if (/^能(?![，,])/.test(cell)) return '能'
  return undefined
}

/** `| a | b |` → `['a', 'b']`。表格里不用转义的竖线，所以按 `|` 切就够。 */
const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())

export function parseCoverage(md: string): Coverage {
  const lines = md.split('\n')
  const refs = lines.flatMap((l, i) => refsIn(l, i + 1))
  const rows: Row[] = []
  const start = lines.findIndex((l) => HEADER.test(l))
  if (start >= 0) {
    // 表头之后隔一行分隔线，连续的 `|` 行都算表体。
    for (let i = start + 2; i < lines.length && lines[i]!.trim().startsWith('|'); i++) {
      const cells = cellsOf(lines[i]!)
      rows.push({
        line: i + 1,
        cells,
        verdict: verdictOf(cells[1] ?? ''),
        owners: refsIn(cells[3] ?? '', i + 1),
      })
    }
  }
  const m = md.match(READING)
  const reading = m ? { rows: +m[1]!, can: +m[2]!, cannot: +m[3]!, wrong: +m[4]! } : undefined
  return { rows, refs, reading }
}

/** 列出所有问题；空表示引用完整。每条都点名行号或票号，红了一眼能找到。 */
export function problems(md: string, snapshot: Snapshot): string[] {
  const out: string[] = []
  if (Object.keys(snapshot).length === 0) out.push('票据快照是空的 —— 空快照下任何票号都「不存在」，拒绝判')
  const { rows, refs, reading } = parseCoverage(md)
  if (rows.length === 0) out.push('对照表一行都没读到（找不到表头「| 玩家能做的事 |」，或表是空的）')

  for (const r of refs) {
    const actual = snapshot[r.id]
    if (actual === undefined) out.push(`第 ${r.line} 行：${r.id} 在快照里不存在`)
    else if (r.claimed === undefined) out.push(`第 ${r.line} 行：${r.id} 后面没写状态（应写成 ${r.id}（${actual}））`)
    else if (r.claimed !== actual) out.push(`第 ${r.line} 行：${r.id} 写的是 ${r.claimed}，快照里是 ${actual}`)
  }

  for (const row of rows) {
    const what = `第 ${row.line} 行「${row.cells[0] ?? ''}」`
    if (row.cells.length !== COLUMNS) {
      out.push(`${what}：有 ${row.cells.length} 列，应为 ${COLUMNS} 列`)
      continue
    }
    if (row.verdict === undefined) {
      out.push(`${what}：判定列应以「能」「**不能**」「**能，但不对**」之一开头，读到「${row.cells[1]}」`)
      continue
    }
    if (row.verdict !== '能' && !row.owners.some((o) => snapshot[o.id] === 'open')) {
      out.push(`${what}：判定是「${row.verdict}」，但「欠的那部分归」没有指向任何一张开着的票`)
    }
  }

  const count = (v: Verdict) => rows.filter((r) => r.verdict === v).length
  const actual = { rows: rows.length, can: count('能'), cannot: count('不能'), wrong: count('不对') }
  if (!reading) out.push('没找到读数那句「共 N 行（能 A · 不能 B · 能但不对 C）」')
  else if (JSON.stringify(reading) !== JSON.stringify(actual)) {
    out.push(`读数写的是 ${JSON.stringify(reading)}，表里现数是 ${JSON.stringify(actual)}`)
  }
  return out
}
