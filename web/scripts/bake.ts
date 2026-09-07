/**
 * 数据烘焙 CLI：把 `script/` 下的 96 个场景脚本全部烘成 JSON，把它们用到的
 * 地图图片转成 WebP，同时写出一张"逻辑 ID → 实际文件"的映射表。
 *
 *     pnpm bake            # 在 web/ 下运行
 *
 * 产物全部入库（`src/generated/`）：
 *   - CI 与 `pnpm build` 因此不需要 Java、不需要 cwebp、不需要仓库外的原始素材；
 *   - 产物的任何 diff 都是信号，跟 `tools/ground-truth/` 是同一套规矩。
 * 产物是否陈旧分两层判定：场景 JSON 由 `src/data/scenes.test.ts` 现场重烘一遍
 * 比对；资源那一层（WebP / m4a / 映射表）重烘不了（CI 上没有 cwebp 与
 * afconvert），改由**烘焙时写指纹、跑测试时重算比对**——见文件末尾的
 * `writeStamp` 与 `src/assets/bakeStamp.ts`（xl-23y）。
 *
 * **烘之前先校验，校验不过一个字节都不落盘**（`src/assets/checkAssets.ts`）：
 * 数据引用到的每一条资源路径都要 stat 得到，缺一条就非零退出。原版的图片
 * 加载在路径错误时既不抛异常也不返回 null，只给一个宽度 −1 的空壳，
 * 于是 27 帧素材缺了十三年没人发现 —— 把这类失败搬到构建时是唯一的办法。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative as relativePath, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { checkSceneAssets, formatReport, isClean } from '../src/assets/checkAssets'
import { bakerSources, hashFiles } from '../src/assets/bakeStamp'
import {
  BUNDLED_DIR,
  DEFERRED_PUBLIC_DIR,
  DEFERRED_TOP_DIRS,
  IMAGE_ROOT,
  battleAssetId,
  battleProductPath,
  isDeferredBattleAsset,
} from '../src/assets/battleAssets'
import {
  bgmAssetId,
  dialogueAssetId,
  drugPictureAssetId,
  headAssetId,
  mapAssetId,
  narratageBgAssetId,
  npcAssetId,
  roleAssetId,
} from '../src/assets/ids'
import { normalizePath } from '../src/assets/path'
import { listFiles } from '../src/assets/listFiles'
import { scanSceneAssets } from '../src/assets/sceneAssets'
import { DRUGS } from '../src/battle/drugs'
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
  walk: { dir: 'roles/zhangxiaofan', count: 32, firstFile: 0, width: 32, height: 64 },
  run: { dir: 'roles/zhangxiaofanRun', count: 16, firstFile: 1, width: 42, height: 64 },
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
 * 药品菜单那六张介绍图（xl-rh9.12）。原版 `ShopReader.readDrug()` 拼的是
 * `sources/Shop/药品/回复类/<drug.txt 第 4 列>`。
 *
 * **不在 `image/` 下**，所以它不归 `bakeBattleImages` 那趟现扫；张数与文件名
 * 同样不写死 —— 目录里有什么就烘什么，再拿 `DRUGS`（判据在 `drugs.test.ts`，
 * 它自己去读那份 GBK 数据）逐条对账。少一张的表现是"点到那一行没有图"。
 */
const DRUG_PICTURE_DIR = 'sources/Shop/药品/回复类'

/**
 * 要转码哪几首背景音乐，范围**从行为真值里现读**：`tools/traces/out/` 下的
 * 每一份 trace 走到过的每一个场景，它 `Music` 段那首就得烘。
 *
 * 为什么要限范围：96 个场景一共引用 27 首曲子、48 MB 的 128 kbps MP3，
 * 全部转码入库是 20 MB 以上的产物，而剧本走不到的场景今天一首都用不上。
 *
 * 为什么范围不是手写的名单（这里原本写死的是 `['脚本1','宿舍','大地图']`）：
 * 判据与烘焙必须同一个源头。`src/audio/bgmPlayer.test.ts` 的分母就是"真值里
 * 声明过的每一首背景音乐"，剧本一加，那边立刻多一条断言；范围要是另抄一份，
 * 加剧本的人就得记得同时改这里，忘了的表现是"那个场景是哑的"——没人看得出来。
 * 现在两边数的是同一批 trace，忘不了。
 *
 * **场景名与曲名都不写在这里**：场景名从 trace 现扫，曲名从场景自己的
 * `Music` 段现读（见 `bakeBgm`）。
 */
function tracedScenes(): string[] {
  const dir = resolve(REPO, 'tools/traces/out')
  const files = readdirSync(dir).filter((f) => f.endsWith('.trace.json'))
  if (files.length === 0) {
    // 一份 trace 都没有会让下面的集合是空的，而"没有要烘的曲子"与"全烘完了"
    // 在产物上长得一模一样。
    console.error(`${dir} 下一份 trace 都没有 —— 先跑 tools/export-trace.sh`)
    process.exit(1)
  }
  const scenes = new Set<string>()
  for (const f of files) {
    // 真值也是烘焙器的输入：它决定烘哪几首 BGM。不记进指纹的话，改了一条
    // 剧本却不重烘，产物少一首曲子而判据照绿 —— 表现只是"那个场景是哑的"。
    const trace = JSON.parse(readFileSync(useInput(resolve(dir, f)), 'utf8')) as {
      driver: string
      ticks: readonly { scene: string }[]
    }
    // 只有场景真值才有"走到过哪些场景"这回事。战斗真值（xl-1vu.4）的每一步
    // 里没有 `scene` 字段，硬扫会往集合里塞一个 `undefined` —— 那之后烘出来
    // 的产物少一首曲子还是多一首，谁都看不出来。战斗自己那首 BGM 要等 web
    // 侧真有战斗面板了再烘（xl-1vu.7）。
    if (trace.driver !== 'scene') continue
    for (const tick of trace.ticks) scenes.add(stem(tick.scene))
  }
  if (scenes.size === 0) {
    // 全被筛掉了与"一份 trace 都没有"一样致命，而且更隐蔽：文件都在，
    // 只是没有一份是场景真值。
    console.error(`${dir} 下没有一份场景真值（driver === 'scene'）—— 烘不出背景音乐的范围`)
    process.exit(1)
  }
  return [...scenes].sort()
}

const SCENES_OUT = resolve(WEB, 'src/generated/scenes')
const ASSETS_OUT = resolve(WEB, 'src/generated/assets')
const MANIFEST_OUT = resolve(WEB, 'src/generated/assets.json')
const MISSING_OUT = resolve(WEB, 'src/generated/missingAssets.json')
const DEFERRED_BGM_OUT = resolve(WEB, 'src/generated/deferredBgm.json')
const STAMP_OUT = resolve(WEB, 'src/generated/bakeStamp.json')
const DEFERRED_BATTLE_OUT = resolve(WEB, 'src/generated/battleAnimations.json')

/** 原版战斗素材根目录，与按需产物在 `public/` 下的落点。 */
const IMAGES = resolve(REPO, IMAGE_ROOT)
const PUBLIC_OUT = resolve(WEB, 'public')

/** `NPCs/曾书书/9.png` 里 `NPCs/` 那一段。`sceneAssets.ts` 拼的就是这个前缀。 */
const NPC_PREFIX = 'NPCs/'

/**
 * 这一趟烘焙读过的每一个源文件（绝对路径）。烘完写进 `bakeStamp.json`，
 * `src/assets/bakeStamp.test.ts` 拿它判定「入库的产物是不是这批输入烘出来的」。
 *
 * **名单是记录出来的，不是抄出来的**：凡是走 `toWebp` / `toAac` / 下面那个
 * 读脚本的循环的文件都会自己落进来。抄一份名单在别处，加一类素材就得记得
 * 同时改它，忘了的表现是判据悄悄少验一块 —— 而少验和验过了长得一样。
 */
const consumed = new Set<string>()

/** 记一个输入，并把它原样还回去，这样调用处不必多写一行。 */
function useInput(absolute: string): string {
  consumed.add(absolute)
  return absolute
}

function main(): void {
  requireCwebp()
  requireAfconvert()

  // 名单不手抄：script/ 下有什么就烘什么。抄一份名单出来，迟早会跟目录对不上。
  const names = readdirSync(SCRIPTS)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.replace(/\.txt$/, ''))
    .sort()
  const scenes = names.map((name) =>
    bakeScript(readFileSync(useInput(resolve(SCRIPTS, `${name}.txt`))), `${name}.txt`),
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
      // 原版 `Role.drawHero` 的 drawImage 带**源矩形** (0,0)-(width,height)，
      // 素材比它大的那几张是被裁掉的，不是被缩的。仓库里真有两张：
      // roles/zhangxiaofanRun/15.png 与 16.png 是 42×65（其余 14 张 42×64）。
      // 不裁的话渲染层 setSize(42,64) 会把 65 行重采样成 64 行 —— 整个人物
      // 纵向糊掉一点，看起来完全正常，只有逐像素比对量得出来（xl-u39）。
      bytes += toWebp(source, resolve(ASSETS_OUT, relative), sourceRect(source, spec))
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

  // 药品菜单的介绍图（xl-rh9.12）。分母是现扫出来的，对账用的是 `DRUGS`。
  const drugPictures = readdirSync(resolve(REPO, DRUG_PICTURE_DIR)).sort()
  if (drugPictures.length === 0) {
    // "一张都没扫到"与"全烘完了"在产物上长得一样：两边都是零个差异。
    console.error(`${DRUG_PICTURE_DIR} 下一张图都没有 —— 药品介绍图的分母是从这里现扫的`)
    process.exit(1)
  }
  for (const file of drugPictures) {
    const relative = `drugs/${stripExtension(file)}.webp`
    manifest[drugPictureAssetId(file)] = relative
    bytes += toWebp(resolve(REPO, DRUG_PICTURE_DIR, file), resolve(ASSETS_OUT, relative))
  }
  // 对账：`drug.txt` 里点名的那六张，一张都不许烘不出来。目录扫得到而数据
  // 没点名的（今天没有）留着无妨 —— 反过来才是错。
  for (const drug of DRUGS) {
    if (manifest[drugPictureAssetId(drug.picture)] === undefined) {
      missing.push(`药品介绍图 ${DRUG_PICTURE_DIR}/${drug.picture}`)
    }
  }
  console.log(`药品介绍图 ${drugPictures.length} 张 → drugs/*.webp`)

  if (missing.length > 0) {
    console.error(`资源缺失 ${missing.length} 条：`)
    for (const m of missing) console.error(`  ${m}`)
    process.exit(1)
  }

  const battle = bakeBattleImages(scenes, manifest)

  bakeBgm(scenes, manifest)

  writeFileSync(MANIFEST_OUT, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  writeFileSync(MISSING_OUT, `${JSON.stringify(missingIds.sort(), null, 2)}\n`, 'utf8')
  console.log(
    `映射表 ${Object.keys(manifest).length} 条（地图 ${mapCount} 张 + 主角 ${ROLE_SPRITES.walk.count + ROLE_SPRITES.run.count} 帧 + NPC ${npcFrames} 帧 + 头像 ${HEAD_COUNT} 张 + 对话框 ${Object.keys(DIALOGUE_IMAGES).length} 张 + 旁白背景 ${BG_COUNT} 帧 + 战斗常用 ${battle.bundled} 张）→ WebP 共 ${kb(bytes + battle.bundledBytes)}`,
  )

  writeStamp()
}


/**
 * 战斗素材（xl-rh9.2）：把 `image/` 下的**每一个文件**烘成 WebP，并按
 * `battleAssets.ts` 那条边界分开落盘——常用的进 `src/generated/assets/battle/`
 * （随主包的 `?url` glob 走），技能动画与背景动画进 `public/battle-anim/`
 * （Vite 原样拷贝，不产生 JS 模块，运行时按名单动态取）。
 *
 * **分母是现扫出来的**：`image/` 下有什么就烘什么，不写死目录名单、也不写死
 * 数量。原版 `src/battle/` 的 31 个文件用十几种不同的规则拼路径（`小头.png`、
 * `选中.png`、`<技能名>/<帧号>.png`、`技能按钮/<角色>/技能<n>.png`……），
 * 抄一份规则表过来等于把那 8201 行重写一遍，而抄漏一条的表现是"某张图取不到"
 * ——那是 xl-rh9.4 才会撞上的、最难定位的一类错。扫目录没有这个问题：
 * 少一个文件是源素材少了，`git status` 立刻看得见。
 *
 * 顺带把脚本数据里的战斗背景**对账**一遍：`Fight` 段第 0 列的每一条（含那
 * 3 条 Windows 反斜杠路径）都得在刚烘出来的名单里。checkSceneAssets 只保证
 * "源文件在"，这里保证"产物也在、而且 ID 算得出来"——两件事，中间那一步
 * （`battleAssetId` 的规范化）没人验就等于没验。
 */
function bakeBattleImages(
  scenes: readonly SceneScript[],
  manifest: Record<string, string>,
): { bundled: number; bundledBytes: number } {
  // 每次全量重来，与 ASSETS_OUT 同一个理由：留着上一轮的产物会让"删掉一个
  // 素材"表现为"什么都没发生"。
  const publicDeferred = resolve(PUBLIC_OUT, DEFERRED_PUBLIC_DIR)
  rmSync(publicDeferred, { recursive: true, force: true })

  const relatives = listFiles(IMAGES).sort()
  if (relatives.length === 0) {
    // "一个文件都没扫到"与"全烘完了"在产物上长得一模一样：两边都是零个差异。
    console.error(`${IMAGES} 下一个文件都没有 —— 战斗素材的分母是从这里现扫的`)
    process.exit(1)
  }

  const deferredFiles: Record<string, string> = {}
  // 按需产物没有内容指纹（`public/` 下的文件名 Vite 原样保留），所以自己算一个
  // 摘要当版本号。摘要吃的是**产物字节**：cwebp 是确定性的（m4a 那种"每次都
  // 变"的问题只出在 afconvert 身上，见 `bake-m4a-timestamps` 那条 memory），
  // 所以这个版本号只会因为素材真的变了而变。
  const version = createHash('sha256')
  let bundled = 0
  let bundledBytes = 0
  let deferred = 0
  let deferredBytes = 0

  // **两个包共用一张"谁占了哪个产物路径"的表**，用来查撞车。
  //
  // 撞车是真会发生的：源里既有 `.png` 也有 `.jpg`（`背景动画` 那 753 张全是
  // jpg），而产物一律是 `.webp` —— 同一个目录下的 `x.png` 与 `x.jpg` 会写到
  // 同一个 `x.webp` 上，后写的那张**静静盖掉**前一张。今天仓库里一对都没有
  // （实测），所以这条守卫平时不响；但它不响的样子和"撞了却没查"一模一样，
  // 而后者的表现是画面上某一帧换了张图。
  //
  // 判撞车不能只看 `manifest`：按需那一半根本不进 `manifest`，只看它等于对
  // 1770 张里的撞车视而不见。也不再逐条 `Object.entries().find` —— 那是
  // 2000 多次 O(n) 扫描。
  const claimed = new Map<string, string>(Object.entries(manifest).map(([id, p]) => [p, id]))
  const claim = (product: string, id: string): void => {
    const owner = claimed.get(product)
    if (owner !== undefined) {
      console.error(`资产 ${id} 与 ${owner} 都要写到 ${product}`)
      process.exit(1)
    }
    claimed.set(product, id)
  }

  for (const relative of relatives) {
    const id = battleAssetId(`${IMAGE_ROOT}/${relative}`)
    const product = battleProductPath(relative)
    const source = resolve(IMAGES, relative)
    claim(product, id)
    if (isDeferredBattleAsset(relative)) {
      const destination = resolve(publicDeferred, product.slice(DEFERRED_PUBLIC_DIR.length + 1))
      deferredBytes += toWebp(source, destination)
      deferredFiles[id] = product
      version.update(product).update('\0').update(readFileSync(destination))
      deferred++
      continue
    }
    manifest[id] = product
    bundledBytes += toWebp(source, resolve(ASSETS_OUT, product))
    bundled++
  }

  writeFileSync(
    DEFERRED_BATTLE_OUT,
    `${JSON.stringify({ version: version.digest('hex').slice(0, 16), files: deferredFiles }, null, 2)}\n`,
    'utf8',
  )

  // 战斗背景的对账。缺一条就退出：这一列正是那 3 条反斜杠路径的所在地，
  // 而"ID 算错了"的表现是运行时那一场战斗背景全白 —— 跟原版十三年来的
  // 表现一模一样，没人分得出是复刻还是漏烘。
  const unresolved: string[] = []
  for (const scene of scenes) {
    for (const ref of scanSceneAssets(scene).refs) {
      if (ref.kind !== 'battleBackground') continue
      const id = battleAssetId(ref.raw)
      if (manifest[id] === undefined && deferredFiles[id] === undefined) {
        unresolved.push(`${ref.where}: ${ref.raw} → ${id}`)
      }
    }
  }
  if (unresolved.length > 0) {
    console.error(`战斗背景有 ${unresolved.length} 条烘不出产物：`)
    for (const u of unresolved) console.error(`  ${u}`)
    process.exit(1)
  }

  console.log(
    `战斗素材 ${relatives.length} 张 → 常用 ${bundled} 张进 ${BUNDLED_DIR}/（${kb(bundledBytes)}）` +
      `、${DEFERRED_TOP_DIRS.join(' / ')} 共 ${deferred} 张按需加载进 public/${DEFERRED_PUBLIC_DIR}/（${kb(deferredBytes)}）`,
  )
  return { bundled, bundledBytes }
}

/**
 * 写烘焙指纹（xl-23y）。放在 `main` 的最后：**先有产物、后有指纹**，中途
 * 失败退出就不会留下一张说「这批产物是新的」的纸条。
 *
 * 记两样：烘焙器自己的源码闭包（爬 import，不是抄名单），以及这一趟读过的
 * 每一个源文件。判定与用法见 `src/assets/bakeStamp.ts` 的头注。
 */
function writeStamp(): void {
  const baker = hashFiles(REPO, bakerSources(REPO))
  const inputs = hashFiles(
    REPO,
    [...consumed].map((absolute) => relativePath(REPO, absolute).split('\\').join('/')),
  )
  writeFileSync(STAMP_OUT, `${JSON.stringify({ baker, inputs }, null, 2)}\n`, 'utf8')
  console.log(
    `烘焙指纹 → bakeStamp.json（烘焙器源码 ${Object.keys(baker).length} 个文件 + 输入 ${Object.keys(inputs).length} 个文件）`,
  )
}

/**
 * 背景音乐（xl-9bd.12）：把剧本走到过的那几首转成 AAC，其余的落成一份
 * **故意没烘**的名单。
 *
 * 两份名单都是现算的：要烘的是 `tracedScenes()` 那些场景各自的 `Music` 段，
 * 没烘的是其余场景引用到、而它们没引用的那些。所以场景名与曲名一处都不用
 * 手抄，加一条剧本、改一次数据，两份名单一起变。
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

  const traced = tracedScenes()
  const missingScenes = traced.filter((name) => !scenes.some((s) => stem(s.script) === name))
  if (missingScenes.length > 0) {
    console.error(`真值里走到过 script/ 下不存在的场景：${missingScenes.join('、')}`)
    process.exit(1)
  }

  const wanted = [...musicOf(traced)].sort()
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
  useInput(source)
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
function toWebp(source: string, destination: string, crop?: SourceRect): number {
  useInput(source)
  mkdirSync(dirname(destination), { recursive: true })
  const lossless = source.toLowerCase().endsWith('.png')
  const flags = lossless ? ['-lossless'] : ['-q', '80']
  const cropFlags = crop ? ['-crop', '0', '0', String(crop.width), String(crop.height)] : []
  execFileSync('cwebp', ['-quiet', ...cropFlags, ...flags, source, '-o', destination])
  return statSync(destination).size
}

interface SourceRect {
  readonly width: number
  readonly height: number
}

/**
 * 一张主角精灵图要裁到多大：`Role.drawHero` 那个 drawImage 的源矩形。
 * 返回 `undefined` 表示素材恰好就是源矩形，不必裁。
 *
 * 素材比源矩形**小**的那一维一律硬失败，因为烘焙这条路走不出正确答案。
 * 实测过 Java2D 在这种情况下做什么（openjdk 17，headless，2026-09-06）：
 * 一张 42×32 的纯红图按 `drawImage(src, 0,0,42,64, 0,0,42,64, null)` 画到
 * 一块蓝底上，得到**红 1344 / 蓝 1344**，第 0~31 行是红、第 32~63 行还是蓝。
 * 也就是说它**不拉伸**：缩放比按源矩形算（这里 1:1），源矩形里超出图片的
 * 部分干脆不画。
 *
 * 而 Web 侧渲染层是 `setSize(42, 64)` —— 裁一张 42×32 出来再 setSize，会把它
 * 拉满 64 行，正好是原版不做的那件事。要复刻就得把产物**补白**到源矩形大小，
 * cwebp 干不了。今天 48 张里一张这样的都没有（`roleSpriteSize.test.ts` 把
 * "偏大的恰好是 14/15 两帧"也断言了），所以这里只负责在素材换了的那天响，
 * 而不是悄悄烘出一张会被拉伸的图。
 */
function sourceRect(
  source: string,
  spec: { width: number; height: number },
): SourceRect | undefined {
  const { width, height } = pngSize(source)
  if (width < spec.width || height < spec.height) {
    throw new Error(
      `${source} 是 ${width}×${height}，小于原版 drawHero 的源矩形 ` +
        `${spec.width}×${spec.height}。原版在这种情况下是**不画**缺的那部分，` +
        `而 Web 侧 setSize 会把它拉满；要复刻得把产物补白到源矩形大小，` +
        `cwebp 做不到（xl-u39）。`,
    )
  }
  return width === spec.width && height === spec.height
    ? undefined
    : { width: spec.width, height: spec.height }
}

/**
 * 读一张 PNG 的宽高。IHDR 必须是第一个块，宽高就是它头 8 个字节
 * （PNG 规范 §11.2.2），所以读前 24 个字节就够。
 *
 * 头 8 个字节的魔数要核：核了的话，喂进来一个不是 PNG 的文件会抛；不核的话
 * 会安静地返回两个垃圾数字，而"裁到一个垃圾尺寸"看起来跟裁对了一样。
 */
function pngSize(file: string): { width: number; height: number } {
  const head = readFileSync(file).subarray(0, 24)
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (head.length < 24 || !head.subarray(0, 8).equals(magic)) {
    throw new Error(`${file} 不是 PNG，读不出宽高`)
  }
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
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
