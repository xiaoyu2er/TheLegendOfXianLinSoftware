/**
 * 数据烘焙 CLI：把 M1 需要的场景脚本烘焙成 JSON，并把它们的地图图片转码成
 * WebP，同时写出一张"逻辑 ID → 实际文件"的映射表。
 *
 *     pnpm bake            # 在 web/ 下运行
 *
 * 产物全部入库（`src/generated/`）：
 *   - CI 与 `pnpm build` 因此不需要 Java、不需要 cwebp、不需要仓库外的原始素材；
 *   - 产物的任何 diff 都是信号，跟 `tools/ground-truth/` 是同一套规矩。
 * 产物是否陈旧由 `src/data/scenes.test.ts` 现场重烘一遍来判定。
 *
 * M1 只要宿舍与大地图两个场景（xl-9bd.3）。扩到 96 个并对每条资源路径做
 * 存在性硬校验是 xl-9bd.4 / xl-9bd.5。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bakeScript } from '../src/data/bakeScript'
import { mapAssetId, roleAssetId } from '../src/assets/ids'

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(WEB, '..')

/** M1 可玩链路：宿舍 →（出口）→ 大地图。 */
const SCENES = ['宿舍', '大地图']

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

  // 每次全量重来。留着上一轮的产物会让"删掉一个场景"表现为"什么都没发生"。
  rmSync(SCENES_OUT, { recursive: true, force: true })
  rmSync(ASSETS_OUT, { recursive: true, force: true })
  mkdirSync(SCENES_OUT, { recursive: true })

  const manifest: Record<string, string> = {}
  const missing: string[] = []

  for (const name of SCENES) {
    const scriptFile = resolve(REPO, 'script', `${name}.txt`)
    const scene = bakeScript(readFileSync(scriptFile), `${name}.txt`)
    writeFileSync(resolve(SCENES_OUT, `${name}.json`), stringifyScene(scene), 'utf8')

    const source = resolve(REPO, 'maps', scene.mapName)
    if (!existsSync(source)) {
      // 一次收齐再报，不是撞见第一条就退出 —— 缺 5 张图要跑 5 次才知道，
      // 那种报错方式本身就是个坑。
      missing.push(`${name}.txt 的地图 maps/${scene.mapName}`)
      continue
    }
    const relative = `maps/${stem(scene.mapName)}.webp`
    manifest[mapAssetId(scene.mapName)] = relative
    const bytes = toWebp(source, resolve(ASSETS_OUT, relative))
    console.log(
      `  ${name}.txt  地图 ${scene.mapName} ${kb(statSync(source).size)} → ${relative} ${kb(bytes)}`,
    )
  }

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
      toWebp(source, resolve(ASSETS_OUT, relative))
    }
    console.log(`  主角${gait === 'walk' ? '行走' : '跑步'}图 ${spec.count} 帧 → roles/${gait}/*.webp`)
  }

  if (missing.length > 0) {
    console.error(`资源缺失 ${missing.length} 条：`)
    for (const m of missing) console.error(`  ${m}`)
    process.exit(1)
  }

  writeFileSync(MANIFEST_OUT, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`烘焙 ${SCENES.length} 个场景与 ${ROLE_SPRITES.walk.count + ROLE_SPRITES.run.count} 帧主角图，映射表 ${Object.keys(manifest).length} 条`)
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
 * 转 WebP。**有损源用有损、无损源用无损**：
 *
 *   宿舍.png  1024×640 RGBA  136 KB → 无损 47 KB / 有损 q80 159 KB（实测）
 *   大地图.jpg 3200×2560     4.2 MB → 有损 q80 2.0 MB（实测）
 *
 * PNG 转有损反而更大，因为这些底图是大片纯色加硬边；而 JPG 本来就已经有损，
 * 再无损编码等于把 JPEG 的块效应一并存下来。
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
const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`

main()
