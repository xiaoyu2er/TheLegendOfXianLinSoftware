/**
 * 数据烘焙 CLI：把 `script/` 下的 96 个场景脚本全部烘成 JSON，把它们用到的
 * 地图图片转成 WebP，同时写出一张"逻辑 ID → 实际文件"的映射表。
 *
 *     pnpm bake            # 在 web/ 下运行
 *
 * 产物全部入库（`src/generated/`）：
 *   - CI 与 `pnpm build` 因此不需要 Java、不需要 cwebp、不需要仓库外的原始素材；
 *   - 产物的任何 diff 都是信号，跟 `tools/ground-truth/` 是同一套规矩。
 * 产物是否陈旧由 `src/data/scenes.test.ts` 现场重烘一遍来判定。
 *
 * **烘之前先校验，校验不过一个字节都不落盘**（`src/assets/checkAssets.ts`）：
 * 数据引用到的每一条资源路径都要 stat 得到，缺一条就非零退出。原版的图片
 * 加载在路径错误时既不抛异常也不返回 null，只给一个宽度 −1 的空壳，
 * 于是 27 帧素材缺了十三年没人发现 —— 把这类失败搬到构建时是唯一的办法。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkSceneAssets, formatReport, isClean } from '../src/assets/checkAssets'
import { mapAssetId, roleAssetId } from '../src/assets/ids'
import { normalizePath } from '../src/assets/path'
import { bakeScript } from '../src/data/bakeScript'
import type { SceneScript } from '../src/data/types'

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(WEB, '..')

const SCRIPTS = resolve(REPO, 'script')

/**
 * 主角的行走图与跑步图。张数与文件编号都照抄原版 `scene.Role` 的构造函数：
 * 走 `0..31`（4 个朝向 × 8 帧），跑 `1..16`（4 个朝向 × 4 帧）。
 * **跑步图的文件从 1 开始**，而绘制时的下标从 0 开始，差的这个 1 在这里抹平。
 */
const ROLE_SPRITES = {
  walk: { dir: 'roles/zhangxiaofan', count: 32, firstFile: 0 },
  run: { dir: 'roles/zhangxiaofanRun', count: 16, firstFile: 1 },
} as const

const SCENES_OUT = resolve(WEB, 'src/generated/scenes')
const ASSETS_OUT = resolve(WEB, 'src/generated/assets')
const MANIFEST_OUT = resolve(WEB, 'src/generated/assets.json')

function main(): void {
  requireCwebp()

  // 名单不手抄：script/ 下有什么就烘什么。抄一份名单出来，迟早会跟目录对不上。
  const names = readdirSync(SCRIPTS)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.replace(/\.txt$/, ''))
    .sort()
  const scenes = names.map((name) =>
    bakeScript(readFileSync(resolve(SCRIPTS, `${name}.txt`)), `${name}.txt`),
  )
  console.log(`烘焙 ${scenes.length} 个场景`)

  // 先校验后落盘：校验红了还写出半套产物，下一次构建就分不清"这批是好的"
  // 还是"上次失败留下的"。
  const report = checkSceneAssets(scenes, (path) => existsSync(resolve(REPO, path)))
  if (!isClean(report)) {
    console.error(formatReport(report))
    process.exit(1)
  }
  console.log(formatReport(report))

  // 每次全量重来。留着上一轮的产物会让"删掉一个场景"表现为"什么都没发生"。
  rmSync(SCENES_OUT, { recursive: true, force: true })
  rmSync(ASSETS_OUT, { recursive: true, force: true })
  mkdirSync(SCENES_OUT, { recursive: true })
  for (const scene of scenes) {
    writeFileSync(resolve(SCENES_OUT, `${stem(scene.script)}.json`), stringifyScene(scene), 'utf8')
  }

  // 28 张地图被 96 个场景共用，按逻辑 ID 去重，一张只转一次。
  const manifest: Record<string, string> = {}
  let bytes = 0
  for (const source of mapSources(scenes)) {
    const relative = `maps/${stem(basename(source))}.webp`
    const id = mapAssetId(source)
    if (manifest[id] !== undefined) continue
    manifest[id] = relative
    bytes += toWebp(resolve(REPO, source), resolve(ASSETS_OUT, relative))
  }
  const mapCount = Object.keys(manifest).length
  console.log(`地图 ${mapCount} 张 → WebP`)

  // 主角精灵不在 checkSceneAssets 的覆盖范围内 —— 那一层查的是场景数据引用到的
  // 资源，而这批图的路径是这里按原版 scene.Role 的编号规则算出来的。所以自己
  // 收一份缺失清单，形状跟上面那层保持一致：一次报全，不是撞见第一张就退出。
  const missing: string[] = []
  for (const gait of ['walk', 'run'] as const) {
    const spec = ROLE_SPRITES[gait]
    for (let frame = 0; frame < spec.count; frame++) {
      const source = resolve(REPO, spec.dir, `${frame + spec.firstFile}.png`)
      if (!existsSync(source)) {
        missing.push(`主角${gait === 'walk' ? '行走' : '跑步'}图 ${spec.dir}/${frame + spec.firstFile}.png`)
        continue
      }
      const relative = `roles/${gait}/${frame}.webp`
      manifest[roleAssetId(gait, frame)] = relative
      bytes += toWebp(source, resolve(ASSETS_OUT, relative))
    }
    console.log(`  主角${gait === 'walk' ? '行走' : '跑步'}图 ${spec.count} 帧 → roles/${gait}/*.webp`)
  }

  if (missing.length > 0) {
    console.error(`资源缺失 ${missing.length} 条：`)
    for (const m of missing) console.error(`  ${m}`)
    process.exit(1)
  }

  writeFileSync(MANIFEST_OUT, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(
    `映射表 ${Object.keys(manifest).length} 条（地图 ${mapCount} 张 + 主角 ${ROLE_SPRITES.walk.count + ROLE_SPRITES.run.count} 帧）→ WebP 共 ${kb(bytes)}`,
  )
}

/** 96 个场景引用到的地图源文件（仓库相对路径），按出现顺序去重。 */
function mapSources(scenes: readonly SceneScript[]): string[] {
  const seen = new Set<string>()
  for (const scene of scenes) seen.add(normalizePath(`maps/${scene.mapName}`))
  return [...seen].sort()
}

/**
 * 场景 JSON 的写法：字段一行一个，**最内层的数组压成一行**。
 *
 * `JSON.stringify(x, null, 2)` 会把碰撞网格的每一个 0 和 1 单独占一行，
 * 大地图（100×80）因此从 30 KB 涨到 77 KB，而且 diff 完全没法看。产物是入库
 * 的，diff 要能读 —— 这跟 `tools/ground-truth/` 里那批一行一格的写法是同一个
 * 考虑。
 */
function stringifyScene(value: unknown): string {
  return `${format(value, '')}\n`
}

function format(value: unknown, indent: string): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    // 全是标量的数组压成一行：网格的一行、NPC 的一条、对话的一句。
    if (value.every((v) => v === null || typeof v !== 'object')) {
      return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`
    }
    const inner = indent + '  '
    return `[\n${value.map((v) => inner + format(v, inner)).join(',\n')}\n${indent}]`
  }
  if (value !== null && typeof value === 'object') {
    const inner = indent + '  '
    const entries = Object.entries(value as Record<string, unknown>)
    return `{\n${entries
      .map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`)
      .join(',\n')}\n${indent}}`
  }
  return JSON.stringify(value)
}

/**
 * 转 WebP。**有损源用有损、无损源用无损**：JPG 走 q80，PNG 走无损。
 * JPG 本来就已经有损，再无损编码等于把 JPEG 的块效应一并存下来
 * （大地图.jpg 3200×2560 4.2 MB → q80 2.0 MB，实测）。
 *
 * PNG 走无损的理由原本写的是"这些底图是大片纯色加硬边，转有损反而更大"。
 * 从 2 张扩到 28 张之后，这句话**只对其中大部分成立**，实测（KB）：
 *
 *   宿舍.png      1024×640  无损 47   / q80 159   ← 无损小 3.4 倍
 *   藏经阁3层.png            无损 237  / q80 483   ← 无损小 2 倍
 *   藏经阁1层.png  2048×1280 无损 521  / q80 576   ← 基本打平
 *   大迷宫.png    2865×699  无损 2579 / q80 449   ← **无损大 5.7 倍**
 *
 * 大迷宫不是纯色底图，无损编码在它身上很不划算，它一张就占了全部 28 张
 * 9.5 MB 里的 2.5 MB。这里仍然按源格式走，**不**改成"哪个小选哪个"——
 * 后者会在没人看的情况下把像素图降质。这两张要不要改成有损是 xl-9bd.14，
 * 那需要有人拿眼睛看一眼。
 */
function toWebp(source: string, destination: string): number {
  mkdirSync(dirname(destination), { recursive: true })
  const lossless = source.toLowerCase().endsWith('.png')
  const flags = lossless ? ['-lossless'] : ['-q', '80']
  execFileSync('cwebp', ['-quiet', ...flags, source, '-o', destination])
  return statSync(destination).size
}

function requireCwebp(): void {
  try {
    execFileSync('cwebp', ['-version'], { stdio: 'ignore' })
  } catch {
    console.error('需要 cwebp（brew install webp）。产物已入库，只有重新烘焙时才需要它。')
    process.exit(1)
  }
}

const stem = (fileName: string) => fileName.replace(/\.[^.]+$/, '')
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`

main()
