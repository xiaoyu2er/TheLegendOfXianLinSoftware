import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoPath } from './repoPath'
import { tsFiles } from './scanRoots'

/**
 * ADR-0001 例外表与代码里「故意不复刻」标记的**双向对撞**（xl-03x.4）。
 *
 * 两边各出一半，谁都不能自己给自己签字：
 *
 * - **登记侧**：`docs/adr/0001-web-duplicates-original-defects.md` 「例外」一节那张表，
 *   每一行第一格是它的键（`` `kebab-key` ``）。**人写、人签**，这个文件一行都不生成它。
 * - **代码侧**：`web/src` 与 `web/scripts` 里每一处 `@exception ADR-0001#<键>` 标记，
 *   现扫出来的（扫描根与 `fakes/registry.test.ts` 共用 `scanRoots.ts`，
 *   少扫一片由 `scanRoots.test.ts` 守）。
 *
 * 两个方向都要红（xl-03x.4 在 7357df5 上实跑，每条 cp 备份、篡改、跑、还原、cmp）：
 *
 * | 篡改 | 哪一条红 | 读数 |
 * |---|---|---|
 * | 代码里多一处 `@exception ADR-0001#no-such-row` | 「每一处标记都指向表里真有的一行」 | 1 红 / 5 绿 |
 * | 删掉 `data/scenes.ts` 里唯一那处 `win32-script-filename` 标记 | 「表里每一行，代码里至少一处标记指向它」 | 1 红 / 5 绿 |
 * | 同一处写成 `@exception ADR-0001 #win32-…`（空格） | 「笔误要响」+「至少一处」 | 2 红 / 4 绿 |
 * | 同一处写成 `@Exception …`（大写） | 同上 | 2 红 / 4 绿 |
 * | 同一处写成 `…#win32-script-filename.bak` | 同上 | 2 红 / 4 绿 |
 * | 标记从 `scenes.ts` 挪进 `loadedScenes.test.ts` | 「不写进测试文件」+「至少一处」 | 2 红 / 4 绿 |
 * | 表中间插一个空行 | 「中间没有空行」 | 1 红 / 5 绿 |
 *
 * 在这个文件出现之前，同样的篡改没有任何判据会红 —— 那正是这张表漏掉一族两个里程碑的样子。
 *
 * ## ⚠️ 它只管以后，管不住历史
 *
 * 这个扫描器**认的是标记，不是措辞**。一处写着「不复刻」却没带标记的注释，它看不见 ——
 * 那正是这张表漏了两个里程碑的原因（关键词 grep 找不到就等于通过，而漏写一个措辞
 * 正是出事的方式）。所以约定是：**以后所有「故意不复刻 / 故意加了原版没有的东西」的
 * 注释都必须带标记**，扫描器从那一刻起管得住。
 *
 * 标记立起来之前已经存在的那些，是 xl-03x.4 **人工找了一遍**补上的（找法与处数写在
 * ADR-0001 例外表下面那一段）。**那一遍找漏了没人知道** —— 这个文件变绿不证明历史
 * 上没有漏登的例外，只证明「带了标记的」与「表里写着的」对得上。
 */

const ADR = 'docs/adr/0001-web-duplicates-original-defects.md'

/** 这个文件自己的文档里写着标记的样子，扫它会把文档当成标记。 */
const SELF = 'web/src/test/adrExceptions.test.ts'

const KEY = '[a-z0-9]+(?:-[a-z0-9]+)*'

/**
 * 两道正则**逐行对数**，数不一样就是笔误：
 *
 * - `LOOSE` 认任何大小写的 `@exception` 起头（`@exceptions`、`@Exception` 都算）；
 * - `STRICT` 只认完整形状，而且键后面不许紧跟 `. - # 字母数字` ——
 *   否则 `#win32-script-filename.bak`、`#a-` 会被截成一个恰好存在的键，安静地通过。
 *
 * 只用一道严格正则的话，写歪了的标记匹配零处，而零处与「这里没有例外」长得一样。
 */
const LOOSE = /@exception/gi
const STRICT = new RegExp(`@exception ADR-0001#(${KEY})(?![\\w.#-])`, 'g')

interface Marker {
  /** 写歪了的标记为 `null`。 */
  readonly key: string | null
  readonly at: string
  readonly inTest: boolean
}

const MARKERS: readonly Marker[] = (() => {
  const found: Marker[] = []
  for (const path of tsFiles({ tests: true })) {
    const rel = relative(repoPath('.'), path)
    if (rel === SELF) continue
    const inTest = /\.test\.tsx?$/.test(rel)
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const at = `${rel}:${i + 1}`
        const strict = [...line.matchAll(STRICT)].map((m) => m[1]!)
        const loose = line.match(LOOSE)?.length ?? 0
        for (const key of strict) found.push({ key, at, inTest })
        for (let n = strict.length; n < loose; n++) found.push({ key: null, at, inTest })
      })
  }
  return found
})()

/** 「例外」一节里的表格行（含表头与分隔行），带行号。 */
function exceptionTableLines(): { readonly line: string; readonly no: number }[] {
  const lines = readFileSync(repoPath(ADR), 'utf8').split('\n')
  const start = lines.findIndex((l) => l.startsWith('## 例外'))
  if (start < 0) throw new Error(`${ADR} 里找不到「## 例外」一节 —— 标题改了？`)
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  const out: { line: string; no: number }[] = []
  for (let i = start + 1; i < (end < 0 ? lines.length : end); i++) {
    if (lines[i]!.startsWith('|')) out.push({ line: lines[i]!, no: i + 1 })
  }
  return out
}

function firstCell(line: string): string {
  return line.split('|')[1]!.trim()
}

const TABLE = exceptionTableLines()

/** 表里的键 → 行号。表头（第一格「标记」）与分隔行不算。 */
const ROWS: ReadonlyMap<string, number> = (() => {
  const rows = new Map<string, number>()
  for (const { line, no } of TABLE) {
    const cell = firstCell(line)
    if (cell === '标记' || /^:?-+:?$/.test(cell)) continue
    const m = new RegExp(`^\`(${KEY})\`$`).exec(cell)
    // 一行没有键就没法被标记指到，于是它永远在「零处标记」那条里红 —— 但红的理由会
    // 被读错。这里先说清楚。
    if (!m) throw new Error(`${ADR}:${no} 这一行第一格不是 \`键\`：${cell}`)
    if (rows.has(m[1]!)) throw new Error(`${ADR}:${no} 键 ${m[1]} 与第 ${rows.get(m[1]!)} 行重复`)
    rows.set(m[1]!, no)
  }
  return rows
})()

describe('ADR-0001 例外表 ⇄ 代码里的 @exception 标记', () => {
  it('两边都真的读出了东西 —— 空转要响', () => {
    // 零行对零处，双向对撞是两条恒真的检查。
    expect(ROWS.size, `${ADR} 的例外表一行都没读出来`).toBeGreaterThan(0)
    expect(MARKERS.length, 'web/src 与 web/scripts 里一处 @exception 都没扫到').toBeGreaterThan(0)
  })

  it('例外表是一整张表：中间没有空行把它断成两截', () => {
    // 断开的后半截没有表头，Markdown 不把它渲染成表格 —— 人读的时候看到的是一堆
    // 竖线，而这个扫描器照样读得出来，于是「机器读得到」与「人读得到」分了家。
    const nos = TABLE.map((t) => t.no)
    expect(nos.at(-1)! - nos[0]! + 1, '例外表中间有空行或别的东西').toBe(nos.length)
  })

  it('每一处标记都写成完整的 `@exception ADR-0001#<键>` —— 笔误要响', () => {
    expect(MARKERS.filter((m) => m.key === null).map((m) => m.at)).toEqual([])
  })

  it('标记只写在实现旁边，不写进测试文件', () => {
    // 取舍住在实现里。测试文件里的一处标记能单独满足下面「至少一处指向它」，
    // 于是实现那边的标记丢了也照样绿。
    expect(MARKERS.filter((m) => m.inTest).map((m) => m.at)).toEqual([])
  })

  it('每一处标记都指向表里真有的一行（代码里多一处而表里没有 → 红）', () => {
    const orphan = MARKERS.filter((m) => m.key !== null && !ROWS.has(m.key)).map((m) => `${m.key} (${m.at})`)
    expect(
      orphan,
      '代码自称有一条例外，而 ADR-0001 的例外表里没有这一行 —— 例外不写下来就等于没有。' +
        '去表里加一行（要人签），或者删掉这处标记。',
    ).toEqual([])
  })

  it('表里每一行，代码里至少一处标记指向它（表里有而代码零处 → 红）', () => {
    const pointed = new Set(MARKERS.filter((m) => !m.inTest).map((m) => m.key))
    const unpointed = [...ROWS].filter(([key]) => !pointed.has(key)).map(([key, no]) => `${key} (${ADR}:${no})`)
    expect(
      unpointed,
      '例外表里写着这一行，代码里却没有一处 @exception 指向它 —— 要么那段偏离已经被' +
        '改回复刻了（那就删掉这一行），要么标记在改代码时被弄丢了（那就补回去）。',
    ).toEqual([])
  })
})
