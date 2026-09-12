import { readFileSync } from 'node:fs'
import { repoPath } from './repoPath'

export const ADR_0001 = 'docs/adr/0001-web-duplicates-original-defects.md'

/**
 * ADR-0001「## 例外」一节里每一行的键。两份原语台账（`originalPrimitives.test.ts`、
 * `webPrimitives.test.ts`）共用它，只要「键存在」；`adrExceptions.test.ts` 另外核重复键与格式，
 * 那边的解析更严，不走这里。
 */
export function adrExceptionKeys(): ReadonlySet<string> {
  const lines = readFileSync(repoPath(ADR_0001), 'utf8').split('\n')
  const start = lines.findIndex((l) => l.startsWith('## 例外'))
  // 找不到就从第 0 行扫，会把别的表的第一格也读成键 —— 读错了节与读对了长得一样。
  if (start < 0) throw new Error(`${ADR_0001} 里找不到「## 例外」一节 —— 标题改了？`)
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  const keys = new Set<string>()
  for (const l of lines.slice(start + 1, end < 0 ? undefined : end)) {
    const m = /^\|\s*`([a-z0-9]+(?:-[a-z0-9]+)*)`\s*\|/.exec(l)
    if (m) keys.add(m[1]!)
  }
  return keys
}
