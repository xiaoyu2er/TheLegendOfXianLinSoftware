/**
 * **只给判据用**：解析 `docs/player-coverage.md` 那张对照表，对着入库的票据快照撞
 * 引用完整性（xl-03x.2）。为什么只守引用、为什么真值源不是 `.beads/issues.jsonl`，
 * 见 `playerCoverage.test.ts` 的头注。
 *
 * 文档的约定（改约定就要同时改这里）：
 *
 * - 表是**第一张**表头为 `| 玩家能做的事 | … |` 的 markdown 表，五列：
 *   事 · Web 能不能做 · 走主线碰不碰得到 · 欠的那部分归 · 依据。
 * - 第二列以三种判定之一开头：`能` / `**不能**：……` / `**能，但不对**：……`；后两种冒号后面写明欠的是什么。
 * - 文档里**任何地方**出现的票号都要紧跟着写它的状态：`xl-d8u（open）` /
 *   `xl-czb.7（closed）`。open 包括 in_progress / blocked / deferred（快照只分两桶）。
 * - 「不能 / 不对」的行，第四列指向一张开着的票，或一行**签过字**的 ADR-0001 例外
 *   `ADR-0001#<键>`（表里那一行标着「待签」就不算）。文档里任何地方写的例外键都要真有。
 * - 判「能」的行，第五列（依据）至少引到一份存在的测试文件（`*.test.ts(x)`，按文件名比）
 *   或一份存在的剧本（反引号里的剧本名）。文档里任何地方写的测试文件名都要真有。
 * - 表前面有一句读数：`共 N 行（能 A · 不能 B · 能但不对 C）`。
 *
 * 后三条是 M8 收口（xl-03x.19）为完工判据第 1、3 条加的，判断写在 `docs/adr/0007-what-done-means.md`。
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
  readonly reading: Tally | undefined
  /** 表头 `| 玩家能做的事 |` 出现了几次。只认第一张，所以多于一张要报 —— 否则第二张整张被静默跳过。 */
  readonly tables: number
}

/** ADR-0001 例外表的一行。**标着「待签」的不算签过** —— 完工判据第 1 条认的是签过字的登记。 */
export interface Exception {
  readonly signed: boolean
}

/**
 * 判据要对着撞的另外三样东西，都由调用方从磁盘现读（`playerCoverage.test.ts` 的 `realContext`）：
 * 这个模块本身不碰文件系统，所以每一条规则都能拿假上下文单测。
 */
export interface Context {
  /** ADR-0001 例外表：键 → 签没签。 */
  readonly exceptions: ReadonlyMap<string, Exception>
  /** `web/` 下全部测试文件的文件名（`walk.test.ts`，不带目录）。 */
  readonly tests: ReadonlySet<string>
  /** `tools/traces/scripts/` 下的剧本名（不带 `.json`）。 */
  readonly scripts: ReadonlySet<string>
}

export interface Tally {
  readonly rows: number
  readonly can: number
  readonly cannot: number
  readonly wrong: number
}

const COLUMNS = 5
const HEADER = /^\|\s*玩家能做的事\s*\|/
/**
 * 票号，后面可选地跟一个状态。尾部的负向先行断言让分支 slug（`xl-czb-7`）整个不算
 * 票号，而不是被截成 `xl-czb`。
 */
const REF = /(xl-[0-9a-z]+(?:\.[0-9]+)*)(?![0-9a-z-])(?:（(open|closed)）)?/g
const READING = /共 (\d+) 行（能 (\d+) · 不能 (\d+) · 能但不对 (\d+)）/
/** 例外键的引用。尾部断言与 `adrExceptions.test.ts` 的 `STRICT` 同一个理由：`#a-b.bak` 不许被截成 `#a-b`。 */
const EXC = /ADR-0001#([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w.#-])/g
/**
 * 测试文件的引用，带不带反引号都认。只写文件名的按文件名比；**带了目录的按路径比**（路径的尾巴要
 * 对得上），否则目录写错而别处恰好有同名文件也会过。尾部断言让 `x.test.ts-old` 不被截成 `x.test.ts`。
 */
const TEST = /[\w./-]*\.test\.tsx?(?![\w.-])/g
/** 判据自己的测试文件不算任何一行的依据 —— 引它按构造成立。 */
const SELF = /(?:^|\/)(?:playerCoverage|issueIdentity)\.test\.ts$/
const BACKTICKED = /`([^`]+)`/g
/** 「不能 / 不对」判定后面必须跟一句欠的是什么：`**不能**：……`。 */
const OWED = /^\*\*(?:不能|能，但不对)\*\*[：:]\s*\S/

/** 从 ADR-0001 读「例外」一节那张表。表的约定与 `web/src/test/adrExceptions.test.ts` 相同。 */
export function parseExceptions(adr: string): Map<string, Exception> {
  const lines = adr.split('\n')
  const start = lines.findIndex((l) => l.startsWith('## 例外'))
  if (start < 0) throw new Error('ADR-0001 里找不到「## 例外」一节 —— 标题改了？')
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  const out = new Map<string, Exception>()
  for (const line of lines.slice(start + 1, end < 0 ? undefined : end)) {
    // 键的形状与扫描器的 `KEY` 同一条（`adrExceptions.test.ts`）：两处分叉的话，同一行在一边是键、在另一边不是。
    const m = /^\|\s*`([a-z0-9]+(?:-[a-z0-9]+)*)`\s*\|/.exec(line)
    if (m) out.set(m[1]!, { signed: !line.includes('待签') })
  }
  // 读出零行时，每个例外引用都「不存在」—— 会红，但红的理由会被读错。
  if (out.size === 0) throw new Error('ADR-0001「## 例外」一节一行都没读出来')
  return out
}

const exceptionsIn = (text: string): string[] => [...text.matchAll(EXC)].map((m) => m[1]!)
const testsIn = (text: string): string[] => [...text.matchAll(TEST)].map((m) => m[0])
/** `ctx.tests` 是仓库相对路径。 */
const testExists = (ctx: Context, ref: string): boolean =>
  [...ctx.tests].some((p) => (ref.includes('/') ? p === ref || p.endsWith(`/${ref}`) : p.split('/').pop() === ref))
const backticked = (text: string): string[] => [...text.matchAll(BACKTICKED)].map((m) => m[1]!.trim())

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
  const headers = lines.flatMap((l, i) => (HEADER.test(l) ? [i] : []))
  const start = headers[0] ?? -1
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
  return { rows, refs, reading, tables: headers.length }
}

/** 列出所有问题；空表示引用完整。每条都点名行号或票号，红了一眼能找到。 */
export function problems(md: string, snapshot: Snapshot, ctx: Context): string[] {
  const out: string[] = []
  if (Object.keys(snapshot).length === 0) out.push('票据快照是空的 —— 空快照下任何票号都「不存在」，拒绝判')
  const { rows, refs, reading, tables } = parseCoverage(md)
  if (tables > 1) out.push(`表头「| 玩家能做的事 |」出现了 ${tables} 次，判据只认第一张 —— 合成一张表`)
  if (rows.length === 0) out.push('对照表一行都没读到（找不到表头「| 玩家能做的事 |」，或表是空的）')

  for (const r of refs) {
    const actual = snapshot[r.id]
    if (actual === undefined) out.push(`第 ${r.line} 行：${r.id} 在快照里不存在`)
    else if (r.claimed === undefined) out.push(`第 ${r.line} 行：${r.id} 后面没写状态（应写成 ${r.id}（${actual}））`)
    else if (r.claimed !== actual) out.push(`第 ${r.line} 行：${r.id} 写的是 ${r.claimed}，快照里是 ${actual}`)
  }

  // 例外键与测试文件名也是引用：文档里任何地方写了，就必须真有。
  md.split('\n').forEach((text, i) => {
    for (const key of exceptionsIn(text)) {
      if (!ctx.exceptions.has(key)) out.push(`第 ${i + 1} 行：ADR-0001#${key} 在 ADR-0001 的例外表里不存在`)
    }
    for (const name of testsIn(text)) {
      if (!testExists(ctx, name)) out.push(`第 ${i + 1} 行：${name} 在 web/ 的测试文件里不存在`)
    }
  })

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
    if (row.verdict === '能') {
      // 完工判据第 3 条能核到的那一半：引了一份**存在**的测试或剧本。它会不会真的红，这里核不到。
      const evidence = row.cells[4]!
      const cited =
        testsIn(evidence).some((n) => !SELF.test(n) && testExists(ctx, n)) ||
        backticked(evidence).some((t) => ctx.scripts.has(t))
      if (!cited) out.push(`${what}：判「能」，但依据列没引到任何一份存在的测试或剧本`)
      continue
    }
    // 完工判据第 1 条（xl-03x.1 评论里改写过的那一版）：要么签过字的例外，要么开着的票 + 写明欠什么。
    if (!OWED.test(row.cells[1]!)) {
      out.push(`${what}：判定是「${row.verdict}」，但没写明欠的是什么（判定后面应写「：……」）`)
    }
    const ticket = row.owners.some((o) => snapshot[o.id] === 'open')
    const signed = exceptionsIn(row.cells[3]!).some((k) => ctx.exceptions.get(k)?.signed === true)
    if (!ticket && !signed) {
      out.push(
        `${what}：判定是「${row.verdict}」，但「欠的那部分归」没有指向任何一张开着的票，也没有签过字的例外（ADR-0001#键）`,
      )
    }
  }

  const count = (v: Verdict) => rows.filter((r) => r.verdict === v).length
  const actual: Tally = { rows: rows.length, can: count('能'), cannot: count('不能'), wrong: count('不对') }
  const keys = ['rows', 'can', 'cannot', 'wrong'] as const
  if (!reading) out.push('没找到读数那句「共 N 行（能 A · 不能 B · 能但不对 C）」')
  else if (keys.some((k) => reading[k] !== actual[k])) {
    out.push(`读数写的是 ${JSON.stringify(reading)}，表里现数是 ${JSON.stringify(actual)}`)
  }
  return out
}
