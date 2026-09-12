import { readFileSync, readdirSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../../test/repoPath'
import { tsFiles } from '../../test/scanRoots'
import { parseCoverage, parseExceptions, problems } from './playerCoverage'
import type { Context, Snapshot } from './playerCoverage'

/**
 * 「玩家走得通哪一段」对照表（`docs/player-coverage.md`）的引用完整性判据（xl-03x.2）。
 *
 * **只守引用，不守内容。** 表里每一行「能不能做」是人现查着写的，这里一个字都不核 ——
 * 核内容就得自动扫，而自动扫出来的表等于让被守的东西自己签字。这里核的只有三件：
 * 引的票号在库里真的存在；写在票号后面的状态与库里一致；写着「不能 / 不对」的行
 * 至少指向一张还开着的票（欠账不能归给一张已经关掉的票）。外加表头那句读数与表的
 * 实际行数对得上。
 *
 * **真值源是入库的快照 `tools/issue-snapshot/issues.json`，不是 `.beads/issues.jsonl`。**
 * 后者是 bd 的被动导出，实测过期（读数见 `docs/player-coverage.md`「快照不是」那一条），
 * 拿它撞会静默地对着一份旧名单点头。快照由 `tools/export-issues.sh`
 * 从活库导出，「重导后差异为空」守它是不是活库现在的样子。
 */

const SNAP: Snapshot = { 'xl-a1': 'open', 'xl-b2': 'closed', 'xl-c3.4': 'open' }

const ADR = [
  '## 例外',
  '',
  '| 标记 | 原版行为 | web 端做的 | 为什么 | 判据 |',
  '|---|---|---|---|---|',
  '| `signed-row` | 退出进程 | 禁用 | 浏览器没有 | a.test.ts |',
  '| `draft-row` | **（待签 · xl-x）**睡一秒 | 不睡 | 竞态补丁 | 暂无 |',
  '',
  '## 下一节',
].join('\n')

const CTX: Context = {
  exceptions: parseExceptions(ADR),
  tests: new Set(['walk.test.ts', 'bg.test.tsx']),
  scripts: new Set(['dorm-walk']),
}

const doc = (rows: string[], reading = `共 ${rows.length} 行`) =>
  [
    '# 对照表',
    '',
    `现数：${reading}。`,
    '',
    '| 玩家能做的事 | Web 能不能做 | 走主线碰不碰得到 | 欠的那部分归 | 依据（现查） |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')

const good = [
  '| 走路 | 能 | 链上 | — | 剧本 `dorm-walk`，见 xl-b2（closed） |',
  '| 拖滚动条 | **不能**：滑块拖不动 | 随时 | xl-a1（open） | 读代码 |',
  '| 旁白背景 | **能，但不对**：取整 | 链上 | xl-c3.4（open） | 实跑 |',
]

describe('parseCoverage', () => {
  it('读出行、判定与票号引用', () => {
    const p = parseCoverage(doc(good, '共 3 行（能 1 · 不能 1 · 能但不对 1）'))
    expect(p.rows.map((r) => r.verdict)).toEqual(['能', '不能', '不对'])
    expect(p.refs.map((r) => [r.id, r.claimed])).toEqual([
      ['xl-b2', 'closed'],
      ['xl-a1', 'open'],
      ['xl-c3.4', 'open'],
    ])
  })

  it('分支 slug（xl-czb-7）不当票号', () => {
    expect(parseCoverage(doc(['| a | 能 | 链上 | — | 分支 xl-czb-7 |'])).refs).toEqual([])
  })
})

describe('problems', () => {
  const ok = doc(good, '共 3 行（能 1 · 不能 1 · 能但不对 1）')

  it('好的表零问题', () => {
    expect(problems(ok, SNAP, CTX)).toEqual([])
  })

  it('票号不存在 → 红', () => {
    expect(problems(ok.replace('xl-a1（open）', 'xl-zz9（open）'), SNAP, CTX).join('\n')).toMatch(/xl-zz9.*不存在/)
  })

  it('写的状态与快照不符 → 红', () => {
    expect(problems(ok.replace('xl-b2（closed）', 'xl-b2（open）'), SNAP, CTX).join('\n')).toMatch(/xl-b2.*open.*closed/)
  })

  it('票号后面没写状态 → 红', () => {
    expect(problems(ok.replace('xl-b2（closed）', 'xl-b2'), SNAP, CTX).join('\n')).toMatch(/xl-b2.*没写状态/)
  })

  it('「不能」行只指向关掉的票 → 红', () => {
    const bad = ok.replace('| xl-a1（open） | 读代码 |', '| xl-b2（closed） | 读代码 |')
    expect(problems(bad, SNAP, CTX).join('\n')).toMatch(/拖滚动条.*没有指向任何一张开着的票/)
  })

  it('「不对」行不指向任何票 → 红', () => {
    expect(problems(ok.replace('| xl-c3.4（open） | 实跑 |', '| — | 实跑 |'), SNAP, CTX).join('\n')).toMatch(
      /旁白背景.*没有指向任何一张开着的票/,
    )
  })

  it('判定列不是三种之一 → 红', () => {
    expect(problems(ok.replace('| 能 | 链上 | — |', '| 大概能 | 链上 | — |'), SNAP, CTX).join('\n')).toMatch(/走路.*判定/)
  })

  it('表头读数与实际行数不符 → 红', () => {
    expect(problems(ok.replace('共 3 行', '共 4 行'), SNAP, CTX).join('\n')).toMatch(/读数/)
    expect(problems(ok.replace('不能 1', '不能 2'), SNAP, CTX).join('\n')).toMatch(/读数/)
  })

  it('没有读数那句 → 红', () => {
    expect(problems(ok.replace(/现数：.*/, ''), SNAP, CTX).join('\n')).toMatch(/读数/)
  })

  it('一行都没读到 → 红（「找不到东西」不许当通过）', () => {
    expect(problems(doc([], '共 0 行（能 0 · 不能 0 · 能但不对 0）'), SNAP, CTX).join('\n')).toMatch(/一行都没读到/)
  })

  it('一列不齐的行 → 红', () => {
    expect(problems(ok.replace('| 走路 | 能 | 链上 | — |', '| 走路 | 能 | 链上 |'), SNAP, CTX).join('\n')).toMatch(/走路.*列/)
  })

  it('同表头的表出现两张 → 红（第二张不许被静默跳过）', () => {
    const twice = `${ok}\n| 玩家能做的事 | Web 能不能做 | 走主线碰不碰得到 | 欠的那部分归 | 依据（现查） |\n|---|---|---|---|---|\n| 偷偷加的 | **不能** | 随时 | — | — |\n`
    expect(problems(twice, SNAP, CTX).join('\n')).toMatch(/出现了 2 次/)
  })

  it('快照是空的 → 红', () => {
    expect(problems(ok, {}, CTX).join('\n')).toMatch(/快照是空的/)
  })

  // ── 完工判据第 1 条（xl-03x.19）：每一行要么「能」，要么有签过字的例外，要么指向一张开着的票并写明欠什么 ──

  it('「不能 / 不对」没写明欠的是什么（判定后面没有「：……」）→ 红', () => {
    expect(problems(ok.replace('**不能**：滑块拖不动', '**不能**'), SNAP, CTX).join('\n')).toMatch(
      /拖滚动条.*没写明欠的是什么/,
    )
    expect(problems(ok.replace('**能，但不对**：取整', '**能，但不对**：'), SNAP, CTX).join('\n')).toMatch(
      /旁白背景.*没写明欠的是什么/,
    )
  })

  it('「不能」行靠一行签过字的例外认领 → 通过', () => {
    const exc = ok.replace('| xl-a1（open） | 读代码 |', '| `ADR-0001#signed-row` | 读代码 |')
    expect(problems(exc, SNAP, CTX)).toEqual([])
  })

  it('「不能」行指向的例外还是待签 → 红（没签字的登记不算登记）', () => {
    const exc = ok.replace('| xl-a1（open） | 读代码 |', '| `ADR-0001#draft-row` | 读代码 |')
    expect(problems(exc, SNAP, CTX).join('\n')).toMatch(/拖滚动条.*没有指向任何一张开着的票.*也没有签过字的例外/)
  })

  it('文档里引的例外键在 ADR-0001 的表里不存在 → 红', () => {
    const exc = ok.replace('见 xl-b2（closed）', '见 `ADR-0001#no-such-row`')
    expect(problems(exc, SNAP, CTX).join('\n')).toMatch(/ADR-0001#no-such-row.*不存在/)
  })

  // ── 完工判据第 3 条（xl-03x.19）：判「能」的行要引到一条会红的判据 —— 这里核得到的只是「引了一份存在的测试或剧本」 ──

  it('「能」行的依据引了一份存在的测试文件 → 通过', () => {
    expect(problems(ok.replace('剧本 `dorm-walk`', '实跑 `walk.test.ts` 3/3'), SNAP, CTX)).toEqual([])
    expect(problems(ok.replace('剧本 `dorm-walk`', '`web/src/x/bg.test.tsx`'), SNAP, CTX)).toEqual([])
  })

  it('「能」行的依据只有源码行号 / 读代码，没引测试也没引剧本 → 红', () => {
    expect(problems(ok.replace('剧本 `dorm-walk`', '`ScenePanel.java:187`'), SNAP, CTX).join('\n')).toMatch(
      /走路.*判「能」.*没引到任何一份存在的测试或剧本/,
    )
  })

  it('引的测试文件在磁盘上不存在 → 红（哪一行都一样）', () => {
    expect(problems(ok.replace('| 读代码 |', '| `gone.test.ts` |'), SNAP, CTX).join('\n')).toMatch(
      /gone\.test\.ts.*不存在/,
    )
  })
})

describe('parseExceptions', () => {
  it('读出键与签没签；待签的那一行认得出来', () => {
    expect([...parseExceptions(ADR)]).toEqual([
      ['signed-row', { signed: true }],
      ['draft-row', { signed: false }],
    ])
  })

  it('找不到「## 例外」一节 → 当场抛（读零行与「一行都没签」长得一样）', () => {
    expect(() => parseExceptions('# 别的')).toThrow(/例外/)
  })
})

/** 真实的上下文：ADR-0001 例外表、`web/` 下全部测试文件名、磁盘上的剧本名 —— 都现读，分母不手写。 */
function realContext(): Context {
  const tests = new Set(
    tsFiles({ tests: true })
      .map((p) => basename(p))
      .filter((n) => /\.test\.tsx?$/.test(n)),
  )
  const scripts = new Set(
    readdirSync(repoPath('tools/traces/scripts'))
      .filter((n) => n.endsWith('.json'))
      .map((n) => n.slice(0, -'.json'.length)),
  )
  // 空集会让「引了一份存在的测试」对每一行都不成立 —— 那会红，但红的理由会被读错。
  if (tests.size === 0 || scripts.size === 0) throw new Error(`测试文件 ${tests.size} 个 / 剧本 ${scripts.size} 份：扫描根错了`)
  const exceptions = parseExceptions(readFileSync(repoPath('docs/adr/0001-web-duplicates-original-defects.md'), 'utf8'))
  return { exceptions, tests, scripts }
}

describe('docs/player-coverage.md', () => {
  it('引用完整：票号与例外键都存在、状态对得上、「不能 / 不对」写明欠什么且有人认领、「能」引了判据、读数对得上', () => {
    const md = readFileSync(repoPath('docs/player-coverage.md'), 'utf8')
    const snapshot = JSON.parse(readFileSync(repoPath('tools/issue-snapshot/issues.json'), 'utf8')) as Snapshot
    expect(problems(md, snapshot, realContext())).toEqual([])
  })
})
