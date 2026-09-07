import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import manifest from '../generated/assets.json'
import deferred from '../generated/battleAnimations.json'
import { bakeScript } from '../data/bakeScript'
import { scanSceneAssets } from './sceneAssets'
import {
  BUNDLED_DIR,
  DEFERRED_PUBLIC_DIR,
  DEFERRED_TOP_DIRS,
  IMAGE_ROOT,
  battleAssetId,
  battleProductPath,
  deferredBattleUrl,
  isDeferredBattleAsset,
} from './battleAssets'
import type { DeferredBattleManifest } from './battleAssets'

/**
 * 战斗素材的烘焙与打包边界（xl-rh9.2）。
 *
 * 这一档的每一条**分母都是现扫出来的**：`image/` 下有几个文件、其中几个落在
 * 按需加载的那两个目录里，都由目录本身回答。写死一个当天数出来的数字，
 * 素材换一批就会红成一片，而"红成一片"和"真的少烘了"分不开。
 *
 * 判据的形状统一是**双向**：源素材要有产物，产物要有源素材。只查一个方向的
 * 话，"烘焙器扫不到任何文件"与"全烘完了"长得一模一样——两边都是零个差异。
 */

const DEFERRED = deferred as DeferredBattleManifest
const IMAGES = repoPath(IMAGE_ROOT)
const BUNDLED_ROOT = repoPath('web/src/generated/assets')
const PUBLIC_ROOT = repoPath('web/public')

/**
 * 目录扫描的结果缓存。`image/` 下 2000 多个文件，这一档有六条用例要用到它；
 * 每条各扫一遍会让整套测试多出好几秒的磁盘 I/O，而这套测试有用例是卡着
 * 5 秒超时线的。
 */
const scans = new Map<string, string[]>()
function scan(root: string): string[] {
  let cached = scans.get(root)
  if (cached === undefined) {
    cached = listFiles(root).sort()
    scans.set(root, cached)
  }
  return cached
}

/** `image/` 下的全部文件，相对 `image/` 的正斜杠路径。这一档全部分母的源头。 */
function imageFiles(): string[] {
  return scan(IMAGES)
}

describe('战斗素材烘焙', () => {
  it('image/ 下的每一个文件都有产物，且产物都有源素材', () => {
    const sources = imageFiles()
    // 扫不到东西时下面每一条都恒真。分母先自己响一次。
    expect(sources.length).toBeGreaterThan(0)

    const bundled = new Map(
      Object.entries(manifest as Record<string, string>).filter(([id]) => id.startsWith('battle:')),
    )
    const both = new Map([...bundled, ...Object.entries(DEFERRED.files)])
    // 同一个 ID 不许两边都有：那意味着一张图既进主包又按需，运行时取到哪一份
    // 全看调用方，而两份不一致时画面上看不出来。
    expect(both.size).toBe(bundled.size + Object.keys(DEFERRED.files).length)

    // 正向：每个源文件都有一条映射，且 ID 与产物路径都按规则算得出来。
    const missing: string[] = []
    for (const relative of sources) {
      const id = battleAssetId(`${IMAGE_ROOT}/${relative}`)
      const product = both.get(id)
      if (product !== battleProductPath(relative)) missing.push(`${relative} → ${id}: ${product}`)
    }
    expect(missing).toEqual([])

    // 反向：映射表里不许有 `image/` 下没有的 ID。
    const known = new Set(sources.map((r) => battleAssetId(`${IMAGE_ROOT}/${r}`)))
    expect([...both.keys()].filter((id) => !known.has(id)).sort()).toEqual([])
  })

  it('两个包的产物文件与各自的名单互相盖满', () => {
    // 与 `bakeStamp.test.ts` 里那条同一个理由：烘焙器中途失败会留下半套产物
    // 加一张旧名单，那时取图的表现是"某张图偶尔不见了"。
    const onDiskBundled = new Set(scan(resolve(BUNDLED_ROOT, BUNDLED_DIR)).map((p) => `${BUNDLED_DIR}/${p}`))
    const mappedBundled = new Set(
      Object.entries(manifest as Record<string, string>)
        .filter(([id]) => id.startsWith('battle:'))
        .map(([, p]) => p),
    )
    expect(mappedBundled.size).toBeGreaterThan(0)
    expect([...mappedBundled].filter((p) => !onDiskBundled.has(p)).sort()).toEqual([])
    expect([...onDiskBundled].filter((p) => !mappedBundled.has(p)).sort()).toEqual([])

    const onDiskDeferred = new Set(
      scan(resolve(PUBLIC_ROOT, DEFERRED_PUBLIC_DIR)).map((p) => `${DEFERRED_PUBLIC_DIR}/${p}`),
    )
    const mappedDeferred = new Set(Object.values(DEFERRED.files))
    expect(mappedDeferred.size).toBeGreaterThan(0)
    expect([...mappedDeferred].filter((p) => !onDiskDeferred.has(p)).sort()).toEqual([])
    expect([...onDiskDeferred].filter((p) => !mappedDeferred.has(p)).sort()).toEqual([])
  })
})

describe('打包边界', () => {
  it('按需加载的正是声明的那两个目录，一张不多一张不少', () => {
    const sources = imageFiles()
    const expectedDeferred = sources.filter((r) => isDeferredBattleAsset(r))
    const expectedBundled = sources.filter((r) => !isDeferredBattleAsset(r))
    // 两边都得非空：全切出去或一张都不切，下面的比对照样能过。
    expect(expectedDeferred.length).toBeGreaterThan(0)
    expect(expectedBundled.length).toBeGreaterThan(0)
    expect(expectedDeferred.length + expectedBundled.length).toBe(sources.length)

    expect(Object.keys(DEFERRED.files)).toHaveLength(expectedDeferred.length)
    expect(
      Object.keys(manifest as Record<string, string>).filter((id) => id.startsWith('battle:')),
    ).toHaveLength(expectedBundled.length)

    // 顶层目录的名单也从数据现推，而不是把 DEFERRED_TOP_DIRS 抄回来比自己：
    // 那样这条就是恒真的。
    const topDirsOf = (paths: Iterable<string>) =>
      [...new Set([...paths].map((p) => p.split('/')[0]))].sort()
    expect(topDirsOf(Object.values(DEFERRED.files).map((p) => p.slice(DEFERRED_PUBLIC_DIR.length + 1)))).toEqual(
      [...DEFERRED_TOP_DIRS].sort(),
    )
  })

  it('按需素材一张都没进主包的产物目录', () => {
    // 进错目录的表现是"主包大了一圈"，除了看构建日志没有任何东西会响。
    const inBundled = scan(resolve(BUNDLED_ROOT, BUNDLED_DIR)).filter((p) =>
      DEFERRED_TOP_DIRS.includes(p.split('/')[0] ?? ''),
    )
    expect(inBundled).toEqual([])
  })

  it('主包不静态引用按需名单', () => {
    // `deferredBattle.ts` 里那句 import 必须是动态的，否则 1770 条名单直接进
    // 主包 —— 二进制没进去，体积照样涨，而构建不会有任何提示。
    const offenders: string[] = []
    for (const file of scan(repoPath('web/src'))) {
      if (!/\.tsx?$/.test(file) || file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
      const source = readFileSync(resolve(repoPath('web/src'), file), 'utf8')
      // 静态 import：`import … from '…battleAnimations.json'`，行首起。
      if (/^import[^\n]*battleAnimations\.json/m.test(source)) offenders.push(`web/src/${file}`)
    }
    expect(offenders).toEqual([])
    // 反面：动态 import 得真的在那儿。上面那条在文件被整个删掉时也是绿的。
    expect(readFileSync(repoPath('web/src/assets/deferredBattle.ts'), 'utf8')).toMatch(
      /import\('\.\.\/generated\/battleAnimations\.json'\)/,
    )
  })

  it('版本号跟着产物走，URL 拼出来是可以直接取的', () => {
    expect(DEFERRED.version).toMatch(/^[0-9a-f]{16}$/)
    const [id, product] = Object.entries(DEFERRED.files)[0] as [string, string]
    const url = deferredBattleUrl('./', product, DEFERRED.version)
    expect(url).toBe(`./${encodeURI(product)}?v=${DEFERRED.version}`)
    // 中文路径必须是编码过的：没编码的 URL 在部分环境下取不到，而取不到的
    // 表现是"这个技能没有动画"。
    expect(url).not.toContain(product)
    expect(decodeURI(url.slice(2).split('?')[0] as string)).toBe(product)
    expect(existsSync(resolve(PUBLIC_ROOT, product))).toBe(true)
    expect(id.startsWith('battle:')).toBe(true)
  })
})

describe('路径规范化', () => {
  it('数据里那几条 Windows 反斜杠的战斗背景都烘得出产物', () => {
    // 分母从 `script/` 现扫：今天是 3 条（`剧情1` 1 条、`迷宫1` 2 条），
    // 写死 3 的话哪天数据多一条这里不会响。
    const backslashRefs: { raw: string; where: string }[] = []
    for (const file of readdirSync(repoPath('script')).filter((f) => f.endsWith('.txt'))) {
      const scene = bakeScript(readFileSync(repoPath('script', file)), file)
      for (const ref of scanSceneAssets(scene).refs) {
        if (ref.kind === 'battleBackground' && ref.raw.includes('\\')) backslashRefs.push(ref)
      }
    }
    // 夹具没了这条就恒真 —— 那正是 `path.ts` 头注说"不要去修好数据"的原因。
    expect(backslashRefs.length).toBeGreaterThan(0)

    const bundled = manifest as Record<string, string>
    for (const ref of backslashRefs) {
      const id = battleAssetId(ref.raw)
      expect(id, `${ref.where}: ${ref.raw}`).not.toContain('\\')
      expect(bundled[id], `${ref.where}: ${ref.raw} → ${id}`).toBeDefined()
    }
  })

  it('全部战斗背景（含中文路径）都在主包的映射表里', () => {
    const bundled = manifest as Record<string, string>
    const unresolved: string[] = []
    let total = 0
    for (const file of readdirSync(repoPath('script')).filter((f) => f.endsWith('.txt'))) {
      const scene = bakeScript(readFileSync(repoPath('script', file)), file)
      for (const ref of scanSceneAssets(scene).refs) {
        if (ref.kind !== 'battleBackground') continue
        total++
        if (bundled[battleAssetId(ref.raw)] === undefined) unresolved.push(`${ref.where}: ${ref.raw}`)
      }
    }
    expect(total).toBeGreaterThan(0)
    expect(unresolved).toEqual([])
  })

  it('前缀不是 image/ 的路径是抛，不是猜一个 ID 出来', () => {
    // 猜出来的 ID 要么查不到（还好），要么恰好撞上别的素材 —— 画错图，
    // 而且悄无声息。
    expect(() => battleAssetId('maps/宿舍.png')).toThrowError(/要以 image\/ 开头/)
    expect(battleAssetId('image\\背景图\\伏魔山树林.png')).toBe('battle:背景图/伏魔山树林.png')
  })

  it('只切顶层目录逐字相等的那些，不是前缀匹配', () => {
    expect(isDeferredBattleAsset('技能动画/张小凡攻击/1.png')).toBe(true)
    // 将来真出现一个 `技能动画说明/` 目录，前缀匹配会把它一起切出去。
    expect(isDeferredBattleAsset('技能动画说明/x.png')).toBe(false)
    expect(isDeferredBattleAsset('技能说明/张小凡/1.png')).toBe(false)
    expect(battleProductPath('背景动画/龙翔九天/3.jpg')).toBe(`${DEFERRED_PUBLIC_DIR}/背景动画/龙翔九天/3.webp`)
    expect(battleProductPath('按钮图/击1.png')).toBe(`${BUNDLED_DIR}/按钮图/击1.webp`)
  })
})

/** 目录下的全部文件，相对 `root` 的正斜杠路径。 */
function listFiles(root: string, prefix = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(resolve(root, prefix))) {
    const relative = prefix === '' ? name : `${prefix}/${name}`
    if (statSync(resolve(root, relative)).isDirectory()) out.push(...listFiles(root, relative))
    else out.push(relative)
  }
  return out
}
