import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { repoPath } from './repoPath'

/**
 * 扫源码的那几个判据共用的扫描根：`fakes/registry.test.ts`（假货登记册，ADR-0005）与
 * `test/adrExceptions.test.ts`（例外表标记，ADR-0001）。
 *
 * **这张表就是那些判据的分母**，一个目录漏在外头，落在那儿的东西就会因为「扫不到」而
 * 通过 —— 而 CONTEXT.md §响亮失败 说的正是这个：「找不到东西」不许成为通过条件。
 *
 * 取的是 `web/tsconfig.json` 的 `include` 里那两个真的装 TypeScript 的目录
 * （`vite.config.ts` 是单文件，不是目录）。`scanRoots.test.ts` 核每个根都真的存在且真的
 * 扫出了东西，还会拿 tsconfig 对撞 —— include 里冒出新目录时它红，而不是安静地少扫一片。
 * 两个扫描器从这里取同一份，所以那一条对两边都成立。
 */
export const SCAN_ROOTS = ['web/src', 'web/scripts'] as const

/** 扫描根底下所有 TypeScript 源码（绝对路径）；`tests` 决定带不带 `*.test.ts(x)`。 */
export function tsFiles(opts: { readonly tests: boolean }): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      if (!opts.tests && /\.test\.tsx?$/.test(entry.name)) continue
      out.push(path)
    }
  }
  for (const root of SCAN_ROOTS) walk(repoPath(root))
  return out
}
