import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 仓库根目录的绝对路径 —— 测试要读 `script/` 与 `tools/ground-truth/`，
 * 它们在 `web/` 外面。
 *
 * 不用 `new URL('…', import.meta.url)`：Vite 会**静态改写**这个写法，把它当成
 * 资源引用去解析，参数是模板字符串时还会退化成对整个目录的 glob，于是
 * `pnpm test` 报的是 `Denied ID …/AGENTS.md?url`。先 `fileURLToPath` 再
 * `resolve` 就只是普通的字符串运算，Vite 不碰。
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/** 仓库根目录下某个路径的绝对路径，如 `repoPath('script/宿舍.txt')`。 */
export function repoPath(...parts: string[]): string {
  return resolve(REPO_ROOT, ...parts)
}
