import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../../test/repoPath'
import { identityProblems, identityTally } from './issueIdentity'
import type { Identity } from './issueIdentity'
import type { Snapshot } from './playerCoverage'

/**
 * 每张 open 票恰好一个身份标签（xl-03x.19 的判据）。为什么、三种身份各指什么：`issueIdentity.ts` 的头注
 * 与 `docs/adr/0007-what-done-means.md`。
 */

const SNAP: Snapshot = { 'xl-a1': 'open', 'xl-b2': 'closed', 'xl-c3.4': 'open' }
const OK: Identity = { 'xl-a1': ['身份:登记'], 'xl-c3.4': ['身份:没人认领'] }

describe('identityProblems', () => {
  it('每张 open 票恰好一个 → 零问题', () => {
    expect(identityProblems(SNAP, OK)).toEqual([])
  })

  it('少一个（一张 open 票零个身份）→ 红', () => {
    expect(identityProblems(SNAP, { ...OK, 'xl-a1': [] }).join('\n')).toMatch(/xl-a1.*一个身份标签都没有/)
  })

  it('多一个（一张票贴了两个身份）→ 红', () => {
    expect(identityProblems(SNAP, { ...OK, 'xl-a1': ['身份:登记', '身份:下一轮'] }).join('\n')).toMatch(
      /xl-a1.*贴了 2 个身份/,
    )
  })

  it('不认识的身份（笔误）→ 红', () => {
    expect(identityProblems(SNAP, { ...OK, 'xl-a1': ['身份:登记了'] }).join('\n')).toMatch(/xl-a1.*不认识的身份/)
  })

  it('open 票在身份快照里整条缺席 → 红（缺席与「零个」是两种坏法，都要响）', () => {
    const { 'xl-a1': _, ...rest } = OK
    expect(identityProblems(SNAP, rest).join('\n')).toMatch(/xl-a1.*身份快照里没有这张票/)
  })

  it('身份快照里多一张不是 open 的票 → 红（两份快照不是同一次导出）', () => {
    expect(identityProblems(SNAP, { ...OK, 'xl-b2': ['身份:登记'] }).join('\n')).toMatch(/xl-b2.*closed/)
  })

  it('零张 open 票 → 红（恒真的检查不许当通过）', () => {
    expect(identityProblems({ 'xl-b2': 'closed' }, {}).join('\n')).toMatch(/一张 open 票都没有/)
  })
})

describe('tools/issue-snapshot/identity.json', () => {
  const snapshot = JSON.parse(readFileSync(repoPath('tools/issue-snapshot/issues.json'), 'utf8')) as Snapshot
  const identity = JSON.parse(readFileSync(repoPath('tools/issue-snapshot/identity.json'), 'utf8')) as Identity

  it('每张 open 票恰好一个身份标签', () => {
    console.log(`身份读数：${JSON.stringify(identityTally(identity))}`)
    expect(identityProblems(snapshot, identity)).toEqual([])
  })
})
