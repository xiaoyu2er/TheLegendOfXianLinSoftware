/**
 * 资源存在性硬校验 CLI —— 对**入库的烘焙产物**跑一遍，缺一条就非零退出。
 *
 *     pnpm check:assets                    # 查 src/generated/scenes
 *     pnpm check:assets -- --scenes <dir>  # 查别处（测试用）
 *
 * 与 `pnpm bake` 里那一步是同一段逻辑（`src/assets/checkAssets.ts`）：
 * bake 查的是刚烘出来、还没落盘的场景，这里查的是仓库里已经躺着的那 96 份
 * JSON。两个时机都要有 —— 产物是入库的，改数据的人不一定重烘。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkSceneAssets, formatReport, isClean } from '../src/assets/checkAssets'
import type { SceneScript } from '../src/data/types'

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(WEB, '..')

function main(argv: string[]): void {
  const flag = argv.indexOf('--scenes')
  const dir = flag === -1 ? resolve(WEB, 'src/generated/scenes') : resolve(argv[flag + 1] ?? '')

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
  if (files.length === 0) {
    // "一个场景都没扫到"必须是失败，不是通过：找不到目标的检查会安静地全绿。
    console.error(`${dir} 里没有场景 JSON —— 先跑 pnpm bake。`)
    process.exit(1)
  }
  const scenes = files.map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as SceneScript)

  const report = checkSceneAssets(scenes, (path) => existsSync(resolve(REPO, path)))
  const text = formatReport(report)
  if (!isClean(report)) {
    console.error(text)
    process.exit(1)
  }
  console.log(text)
}

main(process.argv.slice(2))
