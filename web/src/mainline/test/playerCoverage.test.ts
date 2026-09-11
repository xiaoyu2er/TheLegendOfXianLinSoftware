import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../../test/repoPath'
import { parseCoverage, problems } from './playerCoverage'
import type { Snapshot } from './playerCoverage'

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
 * 后者是 bd 的被动导出，实测过期（2026-09-11：它 125 条、open 25；活库 251 条、
 * 非 closed 84），拿它撞会静默地对着一份旧名单点头。快照由 `tools/export-issues.sh`
 * 从活库导出，「重导后差异为空」守它是不是活库现在的样子。
 */

const SNAP: Snapshot = { 'xl-a1': 'open', 'xl-b2': 'closed', 'xl-c3.4': 'open' }

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
  '| 走路 | 能 | 链上 | — | dorm-walk，见 xl-b2（closed） |',
  '| 拖滚动条 | **不能** | 随时 | xl-a1（open） | 读代码 |',
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
    expect(problems(ok, SNAP)).toEqual([])
  })

  it('票号不存在 → 红', () => {
    expect(problems(ok.replace('xl-a1（open）', 'xl-zz9（open）'), SNAP).join('\n')).toMatch(/xl-zz9.*不存在/)
  })

  it('写的状态与快照不符 → 红', () => {
    expect(problems(ok.replace('xl-b2（closed）', 'xl-b2（open）'), SNAP).join('\n')).toMatch(/xl-b2.*open.*closed/)
  })

  it('票号后面没写状态 → 红', () => {
    expect(problems(ok.replace('xl-b2（closed）', 'xl-b2'), SNAP).join('\n')).toMatch(/xl-b2.*没写状态/)
  })

  it('「不能」行只指向关掉的票 → 红', () => {
    const bad = ok.replace('| xl-a1（open） | 读代码 |', '| xl-b2（closed） | 读代码 |')
    expect(problems(bad, SNAP).join('\n')).toMatch(/拖滚动条.*没有指向任何一张开着的票/)
  })

  it('「不对」行不指向任何票 → 红', () => {
    expect(problems(ok.replace('| xl-c3.4（open） | 实跑 |', '| — | 实跑 |'), SNAP).join('\n')).toMatch(
      /旁白背景.*没有指向任何一张开着的票/,
    )
  })

  it('判定列不是三种之一 → 红', () => {
    expect(problems(ok.replace('| 能 | 链上 | — |', '| 大概能 | 链上 | — |'), SNAP).join('\n')).toMatch(/走路.*判定/)
  })

  it('表头读数与实际行数不符 → 红', () => {
    expect(problems(ok.replace('共 3 行', '共 4 行'), SNAP).join('\n')).toMatch(/读数/)
    expect(problems(ok.replace('不能 1', '不能 2'), SNAP).join('\n')).toMatch(/读数/)
  })

  it('没有读数那句 → 红', () => {
    expect(problems(ok.replace(/现数：.*/, ''), SNAP).join('\n')).toMatch(/读数/)
  })

  it('一行都没读到 → 红（「找不到东西」不许当通过）', () => {
    expect(problems(doc([], '共 0 行（能 0 · 不能 0 · 能但不对 0）'), SNAP).join('\n')).toMatch(/一行都没读到/)
  })

  it('一列不齐的行 → 红', () => {
    expect(problems(ok.replace('| 走路 | 能 | 链上 | — |', '| 走路 | 能 | 链上 |'), SNAP).join('\n')).toMatch(/走路.*列/)
  })

  it('快照是空的 → 红', () => {
    expect(problems(ok, {}).join('\n')).toMatch(/快照是空的/)
  })
})

describe('docs/player-coverage.md', () => {
  it('引用完整：票号都存在、状态对得上、「不能 / 不对」都有开着的票认领、读数对得上', () => {
    const md = readFileSync(repoPath('docs/player-coverage.md'), 'utf8')
    const snapshot = JSON.parse(readFileSync(repoPath('tools/issue-snapshot/issues.json'), 'utf8')) as Snapshot
    expect(problems(md, snapshot)).toEqual([])
  })
})
