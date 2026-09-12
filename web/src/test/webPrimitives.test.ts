import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ARROWS, KEYS } from '../game/keyboard'
import { adrExceptionKeys } from './adrExceptionKeys'
import { javaSource } from './javaSource'
import { repoPath } from './repoPath'

/**
 * web 侧「浏览器平台 API」逐处台账：**分母现扫、判定人签**，两边对撞（xl-03x.22）。
 *
 * `originalPrimitives.test.ts`（xl-03x.20）从原版侧出发，结构性地只看得见「原版做了、
 * web 做法不同」。这个文件是同一道缝的另一个方向：**从 web 侧出发**，把 `web/src`
 * 生产代码里浏览器平台 API 的每一处调用点现扫出来，逐处要求台账
 * `docs/web-primitives.md` 给一个判定：对应（指到原版哪一行）/ 已登记（ADR-0001 的哪一行）/
 * 工程（加载、诊断、开发工具，玩家看不见）/ 未核。找得到的「web 多做了一件原版根本没有的事」
 * 就落在这里 —— 它既不是对应物，也不是工程，那就只剩「已登记」一条路。
 *
 * 顺带一张**键位表**（原语清单原先没有键位）：原版 `KeyEvent.VK_*` 与修饰键现扫一边，
 * web 认的键现读一边，两边都得在台账的「## 键位」一节里恰好落一行。
 *
 * 两半谁都不能自己给自己签字（dispatch.md 纪律 3）：
 *
 * - 分母 = `PRIMITIVES` 那张正则表扫 `web/src`（跳过 `*.test.*`、`test/` 目录与 `generated/`），
 *   键位的两边见 `ORIGINAL_KEYS` / `WEB_KEYS`。**改这些正则就是改分母**；
 * - 判定 = 台账那两张表，人写。扫描器只核引用完整（每处都有归属、行号真是命中、
 *   引的原版行真存在、键与票真存在），**不核判定对不对**。
 *
 * ## ⚠️ 它看不见的
 *
 * - **不经过任何浏览器 API 的加法。** 纯状态层里多出来的一条分支（例如「回车跳过逐字打印」的
 *   那一半在 `state/dialogue.ts`）不调任何平台 API —— 这里只看得见它挂在键盘上的那一头。
 *   一段只改画面的 CSS（颜色、布局、`pointer-events`）也不在这张表里；
 * - **正则之外的写法。** 键位表只认 `keyboard.ts` 的两张映射表、`event.key` / `event.code`
 *   与一个字面量的比较、`event` / `raw` 上的修饰键 —— 换一个变量名去读 `.key`，键位表看不见，
 *   只能靠站点那张表里「键盘」「事件」两类兜住那个监听器本身；
 * - **判定写错了。** 台账写「对应」而其实多做了一件事，这里照样绿。
 */

const LEDGER = 'docs/web-primitives.md'
const ISSUES = 'tools/issue-snapshot/issues.json'

interface Primitive {
  readonly re: RegExp
  /** 只扫这几种文件。 */
  readonly ext: RegExp
  /**
   * 样例：`re` 按顶层 `|` 拆开的**每一支**，都得被一行扫到的代码或这里的一句样例命中
   * （「每一支都有见证」那条用例）。只要求整条正则命中一句样例是不够的 —— xl-03x.22 实测：
   * 把「生命周期」的 `navigator\.` 那一支写坏，样例 `beforeunload` 走的是另一支，照样绿。
   */
  readonly samples: readonly string[]
  /** 今天 web/src 里一处都不该有的那几类（有了也不红，只是从此每一处都要判定）。 */
  readonly absent?: true
}

const TS = /\.tsx?$/
const TSX = /\.tsx$/
const CSS = /\.css$/

/**
 * web 侧的浏览器平台 API，按类。**封闭、可现数**：改这张表就是改分母。
 *
 * `全局` 那一条排除了 `window.from` / `window.to`：菜单渲染里有个局部变量就叫 `window`
 * （滚动窗口），它不是浏览器全局。
 */
const PRIMITIVES = {
  事件: { re: /\baddEventListener\(|(?<![\w$])on[A-Z][A-Za-z]*=\{/, ext: TS, samples: [] },
  键盘: { re: /\bKeyboardEvent\b|'key(?:down|up|press)'/, ext: TS, samples: ["'keypress'"] },
  指针: { re: /'(?:pointer|touch)(?:down|up|move|start|end)'|\bon(?:Pointer|Touch)[A-Z]/, ext: TS, samples: ["'pointerup'", 'onPointerDown={f}'] },
  定时: {
    re: /\b(?:setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\(/,
    ext: TS,
    samples: ['setTimeout(f)', 'requestIdleCallback(f)'],
  },
  时钟: { re: /\bperformance\.now\(|\bDate\.now\(|\bnew Date\(/, ext: TS, samples: ['new Date()'] },
  存储: { re: /\b(?:localStorage|sessionStorage|indexedDB)\b|\bcaches\./, ext: TS, samples: ['localStorage', 'caches.open'] },
  地址: {
    // `location` 只认它的那几个成员：`state/dialogue.ts` 里有个局部变量就叫 `location`（一对坐标串）。
    re: /\bfetch\(|\bXMLHttpRequest\b|\bWebSocket\b|\blocation\.(?:href|search|hash|pathname|reload|assign|replace)\b|\bhistory\.(?:push|replace)State\b/,
    ext: TS,
    samples: ['fetch(u)', 'new XMLHttpRequest()', 'new WebSocket(u)', 'history.pushState'],
  },
  全屏: { re: /\b(?:request|exit)Fullscreen\b|\bfullscreen(?:Element|Enabled|change)\b/, ext: TS, samples: [] },
  视口: { re: /\bResizeObserver\b|\bmatchMedia\(|\bdevicePixelRatio\b|'resize'/, ext: TS, samples: ['matchMedia(q)', 'devicePixelRatio'] },
  全局: { re: /(?<![\w$.])(?:document|globalThis)\.|(?<![\w$.])window\.(?!from\b|to\b)/, ext: TS, samples: [] },
  音频: { re: /\bnew Audio\(|\bAudioContext\b/, ext: TS, samples: ['new AudioContext()'] },
  图片: { re: /\bnew Image\(/, ext: TS, samples: [] },
  元素: { re: /(?<![\w$.])<[a-z][a-z0-9]*(?=[\s>/])/, ext: TSX, samples: [] },
  无障碍: {
    re: /(?<![\w$-])(?:aria-[a-z]+|role|title|tabIndex|alt)=|\bautoFocus\b|\.focus\(\)/,
    ext: TSX,
    samples: ['autoFocus', 'el.focus()'],
  },
  伪类: { re: /:(?:hover|focus(?:-visible|-within)?|active)\b/, ext: CSS, samples: [] },
  生命周期: {
    re: /\bnavigator\.|\bNotification\b|\b(?:beforeunload|visibilitychange|pagehide|contextmenu)\b|\bonContextMenu\b|\brequestPointerLock\b|\bgetGamepads\b/,
    ext: TS,
    samples: ['navigator.clipboard', 'new Notification(t)', "'beforeunload'", 'onContextMenu={f}', 'el.requestPointerLock()', 'navigator.getGamepads()'],
    absent: true,
  },
} as const satisfies Record<string, Primitive>

type Kind = keyof typeof PRIMITIVES
const KINDS = Object.keys(PRIMITIVES) as Kind[]

/**
 * 注释行不算调用点：TS 里以 `//`、`*`、`/*`、`{/*` 起头的行整行跳过；
 * CSS 把 `/* … *\/` 块整块抹掉（保留换行，行号不动）—— CSS 的注释常常跨行而续行不带 `*`。
 * TS 不做块抹除：`'**\/*.json'` 这种 glob 串会被当成注释开头，一路吞到下一个 `*\/`，
 * 而吞掉的命中与「没有命中」长得一样。
 */
const TS_COMMENT = /^\s*(?:\/\/|\*|\/\*|\{\/\*)/

function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

function webFiles(dir: string): string[] {
  return readdirSync(repoPath(dir), { recursive: true, encoding: 'utf8' })
    .map((f) => f.split('\\').join('/'))
    .filter((f) => /\.(?:tsx?|css)$/.test(f))
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .filter((f) => !/(?:^|\/)(?:test|generated)\//.test(f))
    .map((f) => `${dir}/${f}`)
    .sort()
}

const FILES = webFiles('web/src')

interface Hit {
  readonly kinds: readonly Kind[]
}

/**
 * `HITS`：`web/src/x/y.ts:12` → 这一行命中的类。
 * `HIT_LINES`：每一类命中的那几行原文，给「每一支都有见证」用。
 */
const { HITS, HIT_LINES } = (() => {
  const hits = new Map<string, Hit>()
  const hitLines = new Map<Kind, string[]>()
  for (const file of FILES) {
    const raw = readFileSync(repoPath(file), 'utf8')
    const isCss = CSS.test(file)
    ;(isCss ? stripCssComments(raw) : raw).split('\n').forEach((line, i) => {
      if (!isCss && TS_COMMENT.test(line)) return
      const kinds = KINDS.filter((k) => PRIMITIVES[k].ext.test(file) && PRIMITIVES[k].re.test(line))
      if (kinds.length > 0) hits.set(`${file}:${i + 1}`, { kinds })
      for (const k of kinds) hitLines.set(k, [...(hitLines.get(k) ?? []), line])
    })
  }
  return { HITS: hits as ReadonlyMap<string, Hit>, HIT_LINES: hitLines as ReadonlyMap<Kind, readonly string[]> }
})()

/**
 * 把一条正则按**顶层** `|` 拆成几支（括号里、字符类里的 `|` 不拆），每支带上原来的 flags。
 * 拆坏了会让某一支编译失败或永远不命中 —— 两种都在「每一支都有见证」里红，不会安静地过。
 */
function branches(re: RegExp): RegExp[] {
  const src = re.source
  const parts: string[] = []
  let depth = 0
  let inClass = false
  let start = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '\\') {
      i++
      continue
    }
    if (inClass) {
      if (c === ']') inClass = false
      continue
    }
    if (c === '[') inClass = true
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === '|' && depth === 0) {
      parts.push(src.slice(start, i))
      start = i + 1
    }
  }
  parts.push(src.slice(start))
  return parts.map((p) => new RegExp(p, re.flags))
}

// ——— 键位的两边 ———

/** 原版：每一处 `KeyEvent.VK_*` 与修饰键读取。 */
const ORIGINAL_KEY_RE = /\bKeyEvent\.(VK_[A-Z0-9_]+)|\b(is(?:Control|Shift|Alt|Meta|AltGraph)Down)\(\)/g
/** web：与 `event.key` / `event.code` 比较的字面量（`toLowerCase()` 之后比的也算）。 */
const WEB_KEY_LITERAL_RE = /\bevent\.(?:key|code)(?:\.toLowerCase\(\))?\s*===\s*'([^']*)'/g
/** web：读了哪几个修饰键。 */
const WEB_MODIFIER_RE = /\b(?:event|raw)\.(ctrlKey|shiftKey|altKey|metaKey)\b/g

const JAVA_FILES = readdirSync(repoPath('src'), { recursive: true, encoding: 'utf8' })
  .map((f) => `src/${f.split('\\').join('/')}`)
  .filter((f) => f.endsWith('.java'))
  .sort()

const JAVA_LINES: ReadonlyMap<string, readonly string[]> = new Map(
  JAVA_FILES.map((f) => [f, javaSource(f).split(/\r?\n/)] as const),
)

/** 原版每个键 → 它出现的每一处 `src/…java:行`。 */
const ORIGINAL_KEY_SITES: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const out = new Map<string, Set<string>>()
  for (const f of JAVA_FILES) {
    JAVA_LINES.get(f)!.forEach((line, i) => {
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return
      for (const m of line.matchAll(ORIGINAL_KEY_RE)) {
        const k = m[1] ?? m[2]!
        out.set(k, (out.get(k) ?? new Set()).add(`${f}:${i + 1}`))
      }
    })
  }
  return out
})()

function scanAll(sources: Iterable<readonly [string, string]>, re: RegExp, skip: RegExp): Set<string> {
  const out = new Set<string>()
  for (const [, text] of sources) {
    for (const line of text.split(/\r?\n/)) {
      if (skip.test(line)) continue
      for (const m of line.matchAll(re)) out.add(m[1] ?? m[2]!)
    }
  }
  return out
}

const ORIGINAL_KEYS = scanAll(
  JAVA_FILES.map((f) => [f, JAVA_LINES.get(f)!.join('\n')] as const),
  ORIGINAL_KEY_RE,
  /^\s*(?:\/\/|\*|\/\*)/,
)

const WEB_TS = FILES.filter((f) => TS.test(f)).map((f) => [f, readFileSync(repoPath(f), 'utf8')] as const)
const WEB_KEY_SOURCES = {
  映射表: new Set([...Object.keys(ARROWS), ...Object.keys(KEYS)]),
  字面量: scanAll(WEB_TS, WEB_KEY_LITERAL_RE, TS_COMMENT),
  修饰键: scanAll(WEB_TS, WEB_MODIFIER_RE, TS_COMMENT),
}
const WEB_KEYS = new Set(Object.values(WEB_KEY_SOURCES).flatMap((s) => [...s]))

// ——— 台账 ———

type Verdict =
  | { readonly kind: '对应'; readonly site: string }
  | { readonly kind: '照做' }
  | { readonly kind: '已登记'; readonly key: string }
  | { readonly kind: '欠账'; readonly issue: string }
  | { readonly kind: '工程' }
  | { readonly kind: '未核' }

const KEY = '[a-z0-9]+(?:-[a-z0-9]+)*'
const VERDICT_CELL = new RegExp(
  '^(?:对应 `(src/[^`:]+\\.java:\\d+)`|(照做|工程|未核)|已登记 `ADR-0001#(' +
    KEY +
    ')`|欠账 (xl-[0-9a-z]+(?:\\.[0-9]+)*))$',
)

function parseVerdict(cell: string): Verdict | undefined {
  const m = VERDICT_CELL.exec(cell)
  if (!m) return undefined
  if (m[1]) return { kind: '对应', site: m[1] }
  if (m[2]) return { kind: m[2] as '照做' | '工程' | '未核' }
  if (m[3]) return { kind: '已登记', key: m[3] }
  return { kind: '欠账', issue: m[4]! }
}

const LEDGER_TEXT = readFileSync(repoPath(LEDGER), 'utf8')

/** 台账里 `## <title>` 那一节的表格行（去掉表头与分隔行），每行拆成格。 */
function tableRows(title: string): { readonly no: number; readonly cells: readonly string[] }[] {
  const lines = LEDGER_TEXT.split('\n')
  const start = lines.findIndex((l) => l.trim() === `## ${title}`)
  if (start < 0) throw new Error(`${LEDGER} 里找不到「## ${title}」一节 —— 标题改了？`)
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  const rows: { no: number; cells: string[] }[] = []
  let header = true
  for (let i = start + 1; i < (end < 0 ? lines.length : end); i++) {
    const line = lines[i]!
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (header) {
      header = false
      continue
    }
    if (/^:?-+:?$/.test(cells[0]!)) continue
    rows.push({ no: i + 1, cells })
  }
  return rows
}

interface SiteRow {
  readonly no: number
  readonly sites: readonly string[]
  readonly kinds: readonly string[]
  readonly verdict: Verdict | undefined
  readonly raw: string
}

const SITE_CELL = /^`(web\/src\/[^`:]+\.(?:tsx?|css)):(\d+(?:,\d+)*)`$/

const SITE_ROWS: readonly SiteRow[] = tableRows('台账').map(({ no, cells }) => {
  const m = SITE_CELL.exec(cells[0]!)
  if (!m) throw new Error(`${LEDGER}:${no} 第一格不是 \`web/src/…:行号[,行号…]\`：${cells[0]}`)
  return {
    no,
    sites: m[2]!.split(',').map((n) => `${m[1]}:${n}`),
    kinds: cells[1]!.split('/').map((k) => k.trim()),
    verdict: parseVerdict(cells[2] ?? ''),
    raw: cells[2] ?? '',
  }
})

interface KeyRow {
  readonly no: number
  readonly original: string | null
  /** 「原版调用点」那一格展开成 `src/…java:行`。 */
  readonly originalSites: readonly string[]
  readonly web: readonly string[]
  readonly verdict: Verdict | undefined
  readonly raw: string
}

/**
 * 原版那一格：`` `VK_X` `` 或 `—`；原版调用点：`` `src/…java:行,行` `` 用 ` · ` 隔开，或 `—`；
 * web 那一格：逗号分隔的 JSON 字符串（`" "` 才写得出空格键），或 `—`。
 */
const KEY_ROWS: readonly KeyRow[] = tableRows('键位').map(({ no, cells }) => {
  const o = cells[0]!
  const om = /^`([A-Za-z0-9_]+)`$/.exec(o)
  if (!om && o !== '—') throw new Error(`${LEDGER}:${no} 原版那一格认不出来：${o}`)
  const sc = cells[1]!
  const originalSites =
    sc === '—'
      ? []
      : sc.split(/\s*·\s*/).flatMap((part) => {
          const m = /^`(src\/[^`:]+\.java):(\d+(?:,\d+)*)`$/.exec(part)
          if (!m) throw new Error(`${LEDGER}:${no} 原版调用点那一格认不出来：${part}`)
          return m[2]!.split(',').map((n) => `${m[1]}:${n}`)
        })
  const w = cells[2]!
  const web =
    w === '—'
      ? []
      : w.split(/\s*,\s*/).map((s) => {
          if (!/^"(?:[^"\\]|\\.)*"$/.test(s)) throw new Error(`${LEDGER}:${no} web 那一格认不出来：${s}`)
          return JSON.parse(s) as string
        })
  return { no, original: om ? om[1]! : null, originalSites, web, verdict: parseVerdict(cells[3] ?? ''), raw: cells[3] ?? '' }
})

const ADR_KEYS = adrExceptionKeys()

const SNAPSHOT: Readonly<Record<string, string>> = JSON.parse(readFileSync(repoPath(ISSUES), 'utf8'))

/** 判定引用的东西真存在：ADR 的键、票、原版那一行（文件在、行在、不是空行）。 */
function badReference(v: Verdict | undefined, raw: string, no: number, allowed: readonly Verdict['kind'][]): string[] {
  if (!v) return [`第 ${no} 行判定写法认不出来：${raw}`]
  if (!allowed.includes(v.kind)) return [`第 ${no} 行：这张表不收「${v.kind}」`]
  if (v.kind === '已登记' && !ADR_KEYS.has(v.key)) return [`第 ${no} 行：ADR-0001 例外表里没有 ${v.key}`]
  if (v.kind === '欠账' && !(v.issue in SNAPSHOT)) return [`第 ${no} 行：票据快照里没有 ${v.issue}`]
  if (v.kind === '对应') {
    const [file, n] = v.site.split(':') as [string, string]
    const line = JAVA_LINES.get(file)?.[Number(n) - 1]
    if (line === undefined || line.trim() === '') return [`第 ${no} 行：${v.site} 不是原版里的一行代码`]
  }
  return []
}

describe('web 侧浏览器平台 API ⇄ 台账（docs/web-primitives.md）', () => {
  it('两边都真的读出了东西 —— 空转要响', () => {
    expect(FILES.length, 'web/src 下一个生产文件都没扫到').toBeGreaterThan(100)
    // 两个界标：扫描根或过滤条件写错时，它们最先掉出去。
    for (const anchor of ['web/src/app/App.tsx', 'web/src/index.css', 'web/src/game/useGame.ts'])
      expect(FILES, `${anchor} 不在扫描范围里`).toContain(anchor)
    expect(HITS.size, 'web/src 里一处浏览器 API 都没扫到').toBeGreaterThan(0)
    expect(SITE_ROWS.length, `${LEDGER} 的台账一行都没读出来`).toBeGreaterThan(0)
    expect(KEY_ROWS.length, `${LEDGER} 的键位表一行都没读出来`).toBeGreaterThan(0)
    expect(JAVA_FILES.length, 'src/ 下一个 .java 都没扫到').toBeGreaterThan(50)
    expect(ADR_KEYS.size).toBeGreaterThan(0)
  })

  it('每一类的正则都还活着：每一支都有见证（代码或样例），非 absent 的类在 web/src 里至少命中一处', () => {
    const unwitnessed = KINDS.flatMap((k) => {
      const p: Primitive = PRIMITIVES[k]
      const lines = HIT_LINES.get(k) ?? []
      return branches(p.re)
        .filter((b) => !lines.some((l) => b.test(l)) && !p.samples.some((s) => b.test(s)))
        .map((b) => `${k}: ${b.source}`)
    })
    const deadInCode = KINDS.filter(
      (k) => !('absent' in PRIMITIVES[k]) && ![...HITS.values()].some((h) => h.kinds.includes(k)),
    )
    expect(unwitnessed, '没有一行代码、也没有一句样例命中的分支 —— 它死了也没人知道').toEqual([])
    expect(deadInCode, '在 web/src 里零命中的类 —— 正则死了，或者该标 absent').toEqual([])
  })

  it('每一处命中都恰好落在台账的一行里（漏登 → 红，重复登 → 红）', () => {
    const owner = new Map<string, number[]>()
    for (const r of SITE_ROWS) for (const s of r.sites) owner.set(s, [...(owner.get(s) ?? []), r.no])
    const missing = [...HITS].filter(([s]) => !owner.has(s)).map(([s, h]) => `${s} [${h.kinds.join(' / ')}]`)
    const doubled = [...owner].filter(([, nos]) => nos.length > 1).map(([s, nos]) => `${s} ← 第 ${nos.join(' / ')} 行`)
    expect(missing, '这些调用点在台账里没有判定').toEqual([])
    expect(doubled).toEqual([])
  })

  it('台账里写的每一个行号都真是一处命中（过期的行 → 红）', () => {
    const stale = SITE_ROWS.flatMap((r) => r.sites.filter((s) => !HITS.has(s)).map((s) => `${s}（台账第 ${r.no} 行）`))
    expect(stale).toEqual([])
  })

  it('每一行的「类」一格与那几行实际命中的类一致', () => {
    const wrong = SITE_ROWS.flatMap((r) => {
      const actual = [...new Set(r.sites.flatMap((s) => HITS.get(s)?.kinds ?? []))].sort()
      return actual.join('/') === [...r.kinds].sort().join('/')
        ? []
        : [`第 ${r.no} 行写「${r.kinds.join(' / ')}」，实际「${actual.join(' / ')}」`]
    })
    expect(wrong).toEqual([])
  })

  it('台账每一格判定都是四种写法之一，引用的原版行、键与票都真存在', () => {
    const bad = SITE_ROWS.flatMap((r) => badReference(r.verdict, r.raw, r.no, ['对应', '已登记', '工程', '未核']))
    expect(bad).toEqual([])
  })

  it('台账开头那句读数与现数一致', () => {
    const tally = { 对应: 0, 已登记: 0, 工程: 0, 未核: 0 }
    for (const r of SITE_ROWS) if (r.verdict && r.verdict.kind in tally) tally[r.verdict.kind as keyof typeof tally] += r.sites.length
    const expected =
      `共 ${HITS.size} 行命中、${SITE_ROWS.length} 个单元` +
      `（对应 ${tally.对应} · 已登记 ${tally.已登记} · 工程 ${tally.工程} · 未核 ${tally.未核}）`
    expect(LEDGER_TEXT, `台账开头应写：${expected}`).toContain(expected)
  })
})

describe('键位：原版 KeyEvent.VK_* ⇄ web 认的键 ⇄ 台账「## 键位」', () => {
  it('两边都真的读出了东西，三路 web 来源各自至少一个 —— 死正则要响', () => {
    expect(ORIGINAL_KEYS.size, 'src/ 里一个 VK_* 都没扫到').toBeGreaterThan(0)
    for (const [name, set] of Object.entries(WEB_KEY_SOURCES)) expect(set.size, `web 的「${name}」一个键都没读出来`).toBeGreaterThan(0)
  })

  it('原版每一个键恰好落在一行，每一行的原版键都真在原版里', () => {
    const count = new Map<string, number[]>()
    for (const r of KEY_ROWS) if (r.original) count.set(r.original, [...(count.get(r.original) ?? []), r.no])
    expect([...ORIGINAL_KEYS].filter((k) => !count.has(k)), '原版认、台账没写的键').toEqual([])
    expect([...count].filter(([, n]) => n.length > 1).map(([k, n]) => `${k} ← 第 ${n.join(' / ')} 行`)).toEqual([])
    expect([...count.keys()].filter((k) => !ORIGINAL_KEYS.has(k)), '台账写了、原版里没有的键').toEqual([])
  })

  it('每一行的「原版调用点」与那个键在原版里现扫出来的每一处逐一相等（少列、多列、行号过期 → 红）', () => {
    const wrong = KEY_ROWS.flatMap((r) => {
      const want = r.original ? [...(ORIGINAL_KEY_SITES.get(r.original) ?? [])].sort() : []
      const got = [...r.originalSites].sort()
      return want.join(' ') === got.join(' ')
        ? []
        : [`第 ${r.no} 行 ${r.original ?? '—'}：少列 ${want.filter((s) => !got.includes(s)).join(' ') || '无'}；多列 ${got.filter((s) => !want.includes(s)).join(' ') || '无'}`]
    })
    expect(wrong).toEqual([])
  })

  it('web 认的每一个键恰好落在一行，每一行的 web 键都真被认', () => {
    const count = new Map<string, number[]>()
    for (const r of KEY_ROWS) for (const k of r.web) count.set(k, [...(count.get(k) ?? []), r.no])
    expect([...WEB_KEYS].filter((k) => !count.has(k)).map((k) => JSON.stringify(k)), 'web 认、台账没写的键').toEqual([])
    expect([...count].filter(([, n]) => n.length > 1).map(([k, n]) => `${JSON.stringify(k)} ← 第 ${n.join(' / ')} 行`)).toEqual([])
    expect([...count.keys()].filter((k) => !WEB_KEYS.has(k)).map((k) => JSON.stringify(k)), '台账写了、web 不认的键').toEqual([])
  })

  it('每一行至少一边有键；判定引用完整', () => {
    const empty = KEY_ROWS.filter((r) => r.original === null && r.web.length === 0).map((r) => `第 ${r.no} 行两边都是 —`)
    const bad = KEY_ROWS.flatMap((r) => badReference(r.verdict, r.raw, r.no, ['照做', '已登记', '欠账', '工程', '未核']))
    expect([...empty, ...bad]).toEqual([])
  })

  it('一边空着的行不许判「照做」—— 原版有而 web 没接、web 有而原版没有，都不是照做', () => {
    const wrong = KEY_ROWS.filter((r) => r.verdict?.kind === '照做' && (r.original === null || r.web.length === 0)).map(
      (r) => `第 ${r.no} 行`,
    )
    expect(wrong).toEqual([])
  })
})
