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
import {
  bgmAssetId,
  dialogueAssetId,
  headAssetId,
  mapAssetId,
  narratageBgAssetId,
  npcAssetId,
  roleAssetId,
} from '../src/assets/ids'
import { normalizePath } from '../src/assets/path'
import { scanSceneAssets } from '../src/assets/sceneAssets'
import { bakeScript } from '../src/data/bakeScript'
import type { SceneScript } from '../src/data/types'
import { BG_COUNT, BG_FIRST_FILE } from '../src/state/narratage'

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

/**
 * 对话框的固定素材（xl-9bd.10），照抄 `scene/Dialogue.java` 的构造函数：
 * 它一次性读 91 张头像 + 对话框 + 名字牌 + 两帧等待提示，与场景数据无关，
 * 所以跟主角精灵一样由烘焙器按规则算路径，不走 `scanSceneAssets`。
 *
 * **91 是那个 for 循环的上界**，不是今天数据里用到了多少个头像
 * （实测只用到 72 个）。按源码的上界烘，缺一张就跟主角精灵一样硬失败。
 */
const HEAD_COUNT = 91

/** 逻辑名 → 仓库里的文件。`dialogueAssetId` 的另一半。 */
const DIALOGUE_IMAGES = {
  box: 'dialogue/对话框.png',
  name: 'dialogue/name.png',
  icon0: 'dialogue/36-18.png',
  icon1: 'dialogue/36-19.png',
} as const

/**
 * 旁白的背景动画。张数与文件编号都照抄原版 `scene.Narratage` 的构造函数：
 * `all_magic_21-{2..53}.png`，共 52 张。**两个常量从 `state/narratage.ts`
 * 进口**，不在这里再抄一遍 —— 抄两份，哪天改了一处就是"背景少播几帧"，
 * 画面上跟正常的循环分不开。
 */
const NARRATAGE_BG_DIR = 'backImages/NarratageBackImages'

/**
 * M1 里程碑走到的三个场景（开场脚本 → 宿舍 → 大地图）。**这是一条范围声明，
 * 不是一份"目前只有这几个"的清单**：它决定的只有"哪几首背景音乐现在转码入库"。
 *
 * 为什么要限范围：96 个场景一共引用 27 首曲子、48 MB 的 128 kbps MP3，
 * 全部转码入库是 20 MB 以上的产物，而 M1 之外的场景今天一个都还走不到。
 * 名单本身是可核的 —— 这三个就是 xl-9bd（M1）那张票写的那三个场景。
 *
 * **曲名不写在这里**：从这三个场景自己的 `Music` 段现读（见 `bakeBgm`）。
 * 抄一份曲名清单出来，改了数据就对不上了。
 */
const M1_SCENES = ['脚本1', '宿舍', '大地图']

const SCENES_OUT = resolve(WEB, 'src/generated/scenes')
const ASSETS_OUT = resolve(WEB, 'src/generated/assets')
const MANIFEST_OUT = resolve(WEB, 'src/generated/assets.json')
const MISSING_OUT = resolve(WEB, 'src/generated/missingAssets.json')
const DEFERRED_BGM_OUT = resolve(WEB, 'src/generated/deferredBgm.json')

/** `NPCs/曾书书/9.png` 里 `NPCs/` 那一段。`sceneAssets.ts` 拼的就是这个前缀。 */
const NPC_PREFIX = 'NPCs/'

function main(): void {
  requireCwebp()
  requireAfconvert()

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

  // NPC 精灵。96 个场景引用到的每一帧，按逻辑 ID 去重 —— 同一个 NPC 在十几个
  // 场景里出现是常事。
  //
  // **仓库里确实没有的那些不是失败**：`knownMissing.ts` 记着那批素材从未
  // 交付，上面的硬校验已经替它们表过态了。它们在这里落成一份"故意查不到"的
  // 名单，运行时按名单放行、名单外的一律抛（见 `assets/resolve.ts`）。
  // 换成"查不到就不画"，一个真正的烘焙遗漏就会表现为"某个 NPC 偶尔不见了"。
  const missingIds: string[] = []
  let npcFrames = 0
  const npcSources = new Map<string, string>()
  for (const scene of scenes) {
    for (const ref of scanSceneAssets(scene).refs) {
      if (ref.kind !== 'npc') continue
      const id = npcAssetId(ref.path.slice(NPC_PREFIX.length))
      if (npcSources.has(id)) continue
      npcSources.set(id, ref.path)
    }
  }
  for (const [id, source] of [...npcSources].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!existsSync(resolve(REPO, source))) {
      missingIds.push(id)
      continue
    }
    const relative = `npcs/${stripExtension(source.slice(NPC_PREFIX.length))}.webp`
    // 两个不同的 ID 落到同一个产物上，说明 ID 的拼法把两条数据压成了一条。
    // 那是画错人的成因，而且悄无声息。
    const clash = Object.entries(manifest).find(([, r]) => r === relative)
    if (clash) {
      console.error(`资产 ${id} 与 ${clash[0]} 都要写到 ${relative}`)
      process.exit(1)
    }
    manifest[id] = relative
    bytes += toWebp(resolve(REPO, source), resolve(ASSETS_OUT, relative))
    npcFrames++
  }
  console.log(
    `NPC ${npcFrames} 帧 → npcs/**.webp（仓库里没有、按已知清单放行 ${missingIds.length} 帧）`,
  )

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

  // 对话框与头像（xl-9bd.10）。跟主角精灵同一套：路径由规则算出来，缺了就攒进
  // 上面那份 missing 清单一次报全，而不是撞见第一张就退出。
  for (const [name, source] of Object.entries(DIALOGUE_IMAGES)) {
    const absolute = resolve(REPO, source)
    if (!existsSync(absolute)) {
      missing.push(`对话框素材 ${source}`)
      continue
    }
    const relative = `dialogue/${name}.webp`
    manifest[dialogueAssetId(name as keyof typeof DIALOGUE_IMAGES)] = relative
    bytes += toWebp(absolute, resolve(ASSETS_OUT, relative))
  }
  for (let index = 0; index < HEAD_COUNT; index++) {
    // 下标 → 文件编号差 1，见 `headAssetId`。
    const source = resolve(REPO, 'heads', `heads (${index + 1}).png`)
    if (!existsSync(source)) {
      missing.push(`头像 heads/heads (${index + 1}).png`)
      continue
    }
    const relative = `heads/${index}.webp`
    manifest[headAssetId(index)] = relative
    bytes += toWebp(source, resolve(ASSETS_OUT, relative))
  }
  console.log(
    `对话框素材 ${Object.keys(DIALOGUE_IMAGES).length} 张 + 头像 ${HEAD_COUNT} 张 → dialogue/*.webp、heads/*.webp`,
  )

  // 旁白的背景动画。跟主角精灵一样不在 checkSceneAssets 的覆盖范围内 ——
  // 那一层查的是场景数据引用到的资源，而这 52 张的路径是原版 `Narratage`
  // 的构造函数写死的，脚本里一个字都没提。
  for (let frame = 0; frame < BG_COUNT; frame++) {
    const source = resolve(REPO, NARRATAGE_BG_DIR, `all_magic_21-${frame + BG_FIRST_FILE}.png`)
    if (!existsSync(source)) {
      missing.push(`旁白背景图 ${NARRATAGE_BG_DIR}/all_magic_21-${frame + BG_FIRST_FILE}.png`)
      continue
    }
    const relative = `narratage/${frame}.webp`
    manifest[narratageBgAssetId(frame)] = relative
    bytes += toWebp(source, resolve(ASSETS_OUT, relative))
  }
  console.log(`  旁白背景图 ${BG_COUNT} 帧 → narratage/*.webp`)

  if (missing.length > 0) {
    console.error(`资源缺失 ${missing.length} 条：`)
    for (const m of missing) console.error(`  ${m}`)
    process.exit(1)
  }

  bakeBgm(scenes, manifest)

  writeFileSync(MANIFEST_OUT, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  writeFileSync(MISSING_OUT, `${JSON.stringify(missingIds.sort(), null, 2)}\n`, 'utf8')
  console.log(
    `映射表 ${Object.keys(manifest).length} 条（地图 ${mapCount} 张 + 主角 ${ROLE_SPRITES.walk.count + ROLE_SPRITES.run.count} 帧 + NPC ${npcFrames} 帧 + 头像 ${HEAD_COUNT} 张 + 对话框 ${Object.keys(DIALOGUE_IMAGES).length} 张 + 旁白背景 ${BG_COUNT} 帧）→ WebP 共 ${kb(bytes)}`,
  )
}

/**
 * 背景音乐（xl-9bd.12）：把 M1 用到的那几首转成 AAC，其余的落成一份
 * **故意没烘**的名单。
 *
 * 两份名单都是从场景数据里现读的：要烘的是 `M1_SCENES` 那三个场景各自的
 * `Music` 段，没烘的是其余场景引用到、而这三个没引用的那些。所以曲名一处
 * 都不用手抄，改了数据两份名单一起变。
 *
 * **为什么要留那份"没烘"的名单**：没有它，"这一票暂时不管"和"烘焙漏了一首"
 * 在运行时长得一模一样（都是查不到），而后者的表现只是"这个场景没有音乐"，
 * 没人看得出来。有了它，名单上的静音、名单外的照旧抛
 * （见 `assets/resolve.ts` 的 `resolveBgmOrNull`）。
 */
function bakeBgm(scenes: readonly SceneScript[], manifest: Record<string, string>): void {
  const musicOf = (names: readonly string[]) =>
    new Set(
      scenes
        .filter((s) => names.includes(stem(s.script)))
        .map((s) => s.sceneMusic)
        .filter((m): m is string => m !== null),
    )

  const missingScenes = M1_SCENES.filter((name) => !scenes.some((s) => stem(s.script) === name))
  if (missingScenes.length > 0) {
    console.error(`M1_SCENES 里有 script/ 下不存在的场景：${missingScenes.join('、')}`)
    process.exit(1)
  }

  const wanted = [...musicOf(M1_SCENES)].sort()
  const all = musicOf(scenes.map((s) => stem(s.script)))
  const deferred = [...all].filter((m) => !wanted.includes(m)).sort()

  let bytes = 0
  for (const name of wanted) {
    const source = resolve(REPO, 'sources/BGM', name)
    if (!existsSync(source)) {
      // 到不了这里：checkSceneAssets 已经把每个场景的 sources/BGM/<曲名> 查过一遍。
      console.error(`背景音乐 ${name} 不在 sources/BGM/ 下`)
      process.exit(1)
    }
    const relative = `bgm/${stem(name)}.m4a`
    manifest[bgmAssetId(name)] = relative
    bytes += toAac(source, resolve(ASSETS_OUT, relative))
  }
  writeFileSync(
    DEFERRED_BGM_OUT,
    `${JSON.stringify(deferred.map((name) => bgmAssetId(name)).sort(), null, 2)}\n`,
    'utf8',
  )
  console.log(
    `背景音乐 ${wanted.length} 首 → bgm/*.m4a 共 ${kb(bytes)}` +
      `（M1 之外的 ${deferred.length} 首暂不转码，落在 deferredBgm.json）`,
  )
}

/**
 * 转 AAC。源是 128 kbps 的 MP3（`afinfo` 实测，27 首都是），这里重编码到
 * 96 kbps 的 AAC-LC 装进 `.m4a`：**AAC-in-MP4 是每一个主流浏览器都放得动的
 * 格式**，而 MP3 的解码在移动端 Safari 上要走一次额外的解码路径。
 *
 * 用 `afconvert`（macOS 自带）而不是 ffmpeg：这台机器上没有 ffmpeg，而烘焙
 * 器本来就已经要 `cwebp` 了 —— 产物入库，只有重新烘焙的人才需要这两个工具。
 */
function toAac(source: string, destination: string): number {
  mkdirSync(dirname(destination), { recursive: true })
  // -s 0 = CBR。默认的 VBR 策略会**忽略 -b**，转出来跟源一样大（实测
  // 舒缓.mp3 2.06 MB → 2.04 MB），而且不报错。
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '96000', '-s', '0', source, '-o', destination])
  return statSync(destination).size
}

function requireAfconvert(): void {
  try {
    execFileSync('afconvert', ['-h'], { stdio: 'ignore' })
  } catch (e) {
    // **只认 ENOENT**：`afconvert -h` 打完帮助之后退出码是 2（实测），
    // 照 `requireCwebp` 那样"抓到异常就当没装"，装了也会报没装。
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return
    console.error('需要 afconvert（macOS 自带）。产物已入库，只有重新烘焙时才需要它。')
    process.exit(1)
  }
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
 * 后者会在没人看的情况下把像素图降质。
 *
 * **xl-9bd.14 已经拿眼睛看过了，结论是维持现状，不给任何一张开例外。**
 * 2026-09-06 的实测：
 *
 * - 藏经阁1层 根本不用考虑：q80 576 KB 比无损的 521 KB 还大，又大又有损。
 * - 大迷宫 1:1 看不出差别，10 倍放大很明显：无损的草地是逐像素杂色点阵
 *   （像素画的颗粒），q80 把它抹平成色块；石栏杆与地砖的硬边基本保住。
 *   本项目有「锐利」放大模式（image-rendering: pixelated），它存在的意义
 *   就是保住这些颗粒。
 * - 量化（共 2002635 像素，累计口径）：完全相同 0.16%、差 > 8 的占 22.31%、
 *   差 > 32 的 0.25%，最大单通道差 95。**跨端逐帧比对的容差正是 8**，所以
 *   走 q80 会让这张地图在流水线里永远留下约 22% 的偏离，收敛不到 0。
 * - 省的那 2.1 MB 不在关键路径上：xl-9bd.15 之后产物用 `?url` 引用，
 *   dist/assets 下是一堆独立文件，只有真的走进大迷宫的玩家才下载它一次。
 *   「双份 + 按缩放选」与「渐进加载」两种方案反而会让仓库更大。
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
/** 去掉扩展名，但**保留目录**：`曾书书/9.png` → `曾书书/9`。 */
const stripExtension = (path: string) => path.replace(/\.[^./]+$/, '')
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`

main()
