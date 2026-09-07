import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 一个目录下的全部文件，相对 `root` 的**正斜杠**路径，递归。
 *
 * **只在 Node 侧用**（烘焙器与测试）：它 import 了 `node:fs`，进不了浏览器包。
 *
 * 抽出来是因为同一个走法原本在三处各写了一遍（`scripts/bake.ts`、
 * `bakeStamp.test.ts`、`battleAssets.test.ts`）。三份实现里只要有一份少走
 * 一层子目录，它那一处的判据就会安静地少验一块 —— 而"少验"和"验过了"
 * 长得一样。
 */
export function listFiles(root: string, prefix = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(resolve(root, prefix))) {
    const relative = prefix === '' ? name : `${prefix}/${name}`
    if (statSync(resolve(root, relative)).isDirectory()) out.push(...listFiles(root, relative))
    else out.push(relative)
  }
  return out
}
