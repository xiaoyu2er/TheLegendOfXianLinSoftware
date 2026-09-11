import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from './repoPath'
import { SCAN_ROOTS, tsFiles } from './scanRoots'

describe('源码扫描根（假货登记册与例外表标记共用）', () => {
  it('每个扫描根都真的存在，而且都扫出了源码 —— 少扫一片要响', () => {
    for (const root of SCAN_ROOTS) {
      const files = tsFiles({ tests: false }).filter((p) => p.startsWith(repoPath(root) + '/'))
      expect(files.length, `扫描根 ${root} 一个 .ts 都没扫到 —— 路径写错了？`).toBeGreaterThan(0)
    }
  })

  it('扫描根与 tsconfig 的 include 对得上 —— include 里冒出新目录要响', () => {
    const tsconfig = JSON.parse(readFileSync(repoPath('web/tsconfig.json'), 'utf8')) as {
      include: string[]
    }
    const dirs = tsconfig.include.filter((entry) => !entry.endsWith('.ts'))
    expect(
      dirs.map((d) => `web/${d}`).sort(),
      'tsconfig 的 include 里有目录不在 SCAN_ROOTS 里 —— 落在那儿的东西扫不到，' +
        '而扫不到与「没有」长得一样。',
    ).toEqual([...SCAN_ROOTS].sort())
  })
})
