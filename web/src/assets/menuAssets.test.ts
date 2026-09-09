import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { javaSource } from '../test/javaSource'
import manifest from '../generated/assets.json'
import deferred from '../generated/menuContent.json'
import { listFiles } from './listFiles'
import { resetDeferredMenuCache, resolveDeferredMenuAsset } from './deferredMenu'
import {
  MENU_BUNDLED_DIR,
  MENU_DEFERRED_PUBLIC_DIR,
  MENU_ROOT,
  MENU_SKELETON_TOP_DIRS,
  deferredMenuUrl,
  isDeferredMenuAsset,
  menuAssetId,
  menuProductPath,
} from './menuAssets'
import type { DeferredMenuManifest } from './menuAssets'

/**
 * 菜单素材的烘焙与打包边界（xl-6lo.4）。
 *
 * 这一档的每一条**分母都是现扫出来的**：`sources/菜单/` 下有几个文件、其中几个
 * 落在骨架那三个目录里，都由目录本身回答。写死一个当天数出来的数字，素材换一批
 * 就会红成一片，而"红成一片"和"真的少烘了"分不开。
 *
 * 判据的形状统一是**双向**：源素材要有产物，产物要有源素材。只查一个方向的话，
 * "烘焙器扫不到任何文件"与"全烘完了"长得一模一样 —— 两边都是零个差异。
 *
 * 边界本身另有一条判据：`MENU_SKELETON_TOP_DIRS` 是一份**手签的登记**，而它
 * 记的那件事（哪几个目录是每一页都要画的）在原版 `menu/FatherPanel.paint()`
 * 里有独立答案。两者对撞，见「边界与原版的共用绘制对得上」那一条。
 */

const DEFERRED = deferred as DeferredMenuManifest
const MENUS = repoPath(MENU_ROOT)
const BUNDLED_ROOT = repoPath('web/src/generated/assets')
const PUBLIC_ROOT = repoPath('web/public')

const scans = new Map<string, string[]>()
function scan(root: string): string[] {
  let cached = scans.get(root)
  if (cached === undefined) {
    cached = listFiles(root).sort()
    scans.set(root, cached)
  }
  return cached
}

/** `sources/菜单/` 下的全部文件，相对它的正斜杠路径。这一档全部分母的源头。 */
function menuFiles(): string[] {
  return scan(MENUS)
}

/** 主包映射表里属于菜单的那些条目。 */
function bundledEntries(): [string, string][] {
  return Object.entries(manifest as Record<string, string>).filter(([id]) => id.startsWith('menu:'))
}

describe('菜单素材烘焙', () => {
  it('sources/菜单 下的每一个文件都有产物，且产物都有源素材', () => {
    const sources = menuFiles()
    // 扫不到东西时下面每一条都恒真。分母先自己响一次。
    expect(sources.length).toBeGreaterThan(0)

    const bundled = new Map(bundledEntries())
    const both = new Map([...bundled, ...Object.entries(DEFERRED.files)])
    // 同一个 ID 不许两边都有：那意味着一张图既进主包又按需，运行时取到哪一份
    // 全看调用方，而两份不一致时画面上看不出来。
    expect(both.size).toBe(bundled.size + Object.keys(DEFERRED.files).length)

    // 正向：每个源文件都有一条映射，且 ID 与产物路径都按规则算得出来。
    const missing: string[] = []
    for (const relative of sources) {
      const id = menuAssetId(`${MENU_ROOT}/${relative}`)
      const product = both.get(id)
      if (product !== menuProductPath(relative)) missing.push(`${relative} → ${id}: ${product}`)
    }
    expect(missing).toEqual([])

    // 反向：映射表里不许有 `sources/菜单/` 下没有的 ID。
    const known = new Set(sources.map((r) => menuAssetId(`${MENU_ROOT}/${r}`)))
    expect([...both.keys()].filter((id) => !known.has(id)).sort()).toEqual([])
  })

  it('两个包的产物文件与各自的名单互相盖满', () => {
    // 烘焙器中途失败会留下半套产物加一张旧名单，那时取图的表现是"某张图偶尔
    // 不见了"。
    const onDiskBundled = new Set(
      scan(resolve(BUNDLED_ROOT, MENU_BUNDLED_DIR)).map((p) => `${MENU_BUNDLED_DIR}/${p}`),
    )
    const mappedBundled = new Set(bundledEntries().map(([, p]) => p))
    expect(mappedBundled.size).toBeGreaterThan(0)
    expect([...mappedBundled].filter((p) => !onDiskBundled.has(p)).sort()).toEqual([])
    expect([...onDiskBundled].filter((p) => !mappedBundled.has(p)).sort()).toEqual([])

    const onDiskDeferred = new Set(
      scan(resolve(PUBLIC_ROOT, MENU_DEFERRED_PUBLIC_DIR)).map(
        (p) => `${MENU_DEFERRED_PUBLIC_DIR}/${p}`,
      ),
    )
    const mappedDeferred = new Set(Object.values(DEFERRED.files))
    expect(mappedDeferred.size).toBeGreaterThan(0)
    expect([...mappedDeferred].filter((p) => !onDiskDeferred.has(p)).sort()).toEqual([])
    expect([...onDiskDeferred].filter((p) => !mappedDeferred.has(p)).sort()).toEqual([])
  })
})

describe('打包边界', () => {
  it('进主包的正是声明的那几个目录，一张不多一张不少', () => {
    const sources = menuFiles()
    const expectedDeferred = sources.filter((r) => isDeferredMenuAsset(r))
    const expectedBundled = sources.filter((r) => !isDeferredMenuAsset(r))
    // 两边都得非空：全切出去或一张都不切，下面的比对照样能过。
    expect(expectedDeferred.length).toBeGreaterThan(0)
    expect(expectedBundled.length).toBeGreaterThan(0)
    expect(expectedDeferred.length + expectedBundled.length).toBe(sources.length)

    expect(Object.keys(DEFERRED.files)).toHaveLength(expectedDeferred.length)
    expect(bundledEntries()).toHaveLength(expectedBundled.length)

    // 顶层目录的名单从**产物**现推，而不是把 MENU_SKELETON_TOP_DIRS 抄回来比
    // 自己 —— 那样这条就是恒真的。
    const topDirsOf = (paths: Iterable<string>): string[] =>
      [...new Set([...paths].map((p) => p.split('/')[0] as string))].sort()
    expect(topDirsOf(bundledEntries().map(([, p]) => p.slice(MENU_BUNDLED_DIR.length + 1)))).toEqual(
      [...MENU_SKELETON_TOP_DIRS].sort(),
    )
    // 按需那一半的顶层目录必须与骨架**不相交**，且合起来正好盖住源目录 ——
    // 只查骨架那一半的话，某个目录两边都出现是查不出来的。
    const deferredTops = topDirsOf(
      Object.values(DEFERRED.files).map((p) => p.slice(MENU_DEFERRED_PUBLIC_DIR.length + 1)),
    )
    expect(deferredTops.filter((d) => MENU_SKELETON_TOP_DIRS.includes(d))).toEqual([])
    expect([...deferredTops, ...MENU_SKELETON_TOP_DIRS].sort()).toEqual(
      topDirsOf(menuFiles()).sort(),
    )
  })

  it('边界与原版的共用绘制对得上', () => {
    // `MENU_SKELETON_TOP_DIRS` 是一份**手签的登记**（dispatch.md 纪律 3）：
    // "哪几个目录是每一页都要画的"要人去读源码才答得出，按目录名或按体积自动推
    // 等于让被守的东西自己签字。这一条给它一个**独立的**答案来对撞 ——
    // 从原版 `FatherPanel.paint()` 现读。
    const father = javaSource('src/menu/FatherPanel.java')
    // 三行共用绘制。写死界标，且先断言它们真的在 —— GBK 读成 UTF-8 时正则是
    // 零匹配，而零匹配的逐行对比恒真。
    const shared: Record<string, string> = {
      'menuPanel.command.drawCommand': 'src/menu/Command.java',
      'scoll.drawScoll': 'src/menu/Scoll.java',
      'mouse.drawMouse': 'src/menu/Mouse.java',
    }
    for (const call of Object.keys(shared)) expect(father, call).toContain(`${call}(`)
    // 各页自己的那两行也得在：少了它们，"共用"就不是一个有内容的概念了。
    for (const own of ['drawSpecialImage', 'drawThisPanel']) {
      expect(father, own).toContain(`${own}(bufferedGraphics)`)
    }

    // 那三个类各自吃 `sources/菜单/` 下哪几个顶层目录。
    const tops = new Set<string>()
    let literals = 0
    for (const file of Object.values(shared)) {
      for (const m of javaSource(file).matchAll(/sources\/菜单\/([^/"]+)\//g)) {
        tops.add(m[1] as string)
        literals++
      }
    }
    // 一条都没匹配到时下面那句 `toEqual` 会红，但红在"空数组 vs 三个"上，
    // 读起来像边界写错了。分母先自己响一次。
    expect(literals).toBeGreaterThan(0)
    expect([...tops].sort()).toEqual([...MENU_SKELETON_TOP_DIRS].sort())
  })

  it('按需素材一张都没进主包的产物目录', () => {
    // 进错目录的表现是"主包大了一圈"，除了看构建日志没有任何东西会响。
    const inBundled = scan(resolve(BUNDLED_ROOT, MENU_BUNDLED_DIR)).filter((p) =>
      isDeferredMenuAsset(p),
    )
    expect(inBundled).toEqual([])
  })

  it('主包不静态引用按需名单', () => {
    // `deferredMenu.ts` 里那句 import 必须是动态的，否则 146 条名单直接进主包
    // —— 二进制没进去，体积照样涨，而构建不会有任何提示。
    const offenders: string[] = []
    for (const file of scan(repoPath('web/src'))) {
      if (!/\.tsx?$/.test(file) || file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
      const source = readFileSync(resolve(repoPath('web/src'), file), 'utf8')
      if (/^import[^\n]*menuContent\.json/m.test(source)) offenders.push(`web/src/${file}`)
    }
    expect(offenders).toEqual([])
    // 反面：动态 import 得真的在那儿。上面那条在文件被整个删掉时也是绿的。
    expect(readFileSync(repoPath('web/src/assets/deferredMenu.ts'), 'utf8')).toMatch(
      /import\('\.\.\/generated\/menuContent\.json'\)/,
    )
  })

  it('两个包合起来没有两张图落到同一个产物路径上', () => {
    // `menuProductPath` 把扩展名一律换成 `.webp`，所以同一个目录下的 `x.png`
    // 与 `x.jpg` 会写到同一个 `x.webp` 上，**后写的静静盖掉前一张**。今天
    // 189 张全是 PNG，一对都没有，所以烘焙器里那条守卫平时不响 —— 而"不响"
    // 和"撞了却没查"长得一样。
    const sources = menuFiles()
    expect(sources.length).toBeGreaterThan(0)
    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const relative of sources) {
      const product = menuProductPath(relative)
      const owner = seen.get(product)
      if (owner !== undefined) clashes.push(`${owner} 与 ${relative} 都写到 ${product}`)
      else seen.set(product, relative)
    }
    expect(clashes).toEqual([])
  })

  it('版本号跟着产物走，URL 拼出来是可以直接取的', () => {
    expect(DEFERRED.version).toMatch(/^[0-9a-f]{16}$/)
    const [id, product] = Object.entries(DEFERRED.files)[0] as [string, string]
    const url = deferredMenuUrl('./', product, DEFERRED.version)
    expect(url).toBe(`./${encodeURI(product)}?v=${DEFERRED.version}`)
    // 中文路径必须是编码过的：没编码的 URL 在部分环境下取不到，而取不到的
    // 表现是"这一页是空的"。
    expect(url).not.toContain(product)
    expect(decodeURI(url.slice(2).split('?')[0] as string)).toBe(product)
    expect(existsSync(resolve(PUBLIC_ROOT, product))).toBe(true)
    expect(id.startsWith('menu:')).toBe(true)
  })
})

describe('运行时取图', () => {
  beforeEach(() => {
    // 名单缓存的是 Promise，跨用例留着会让"第二次调用其实没重新加载"藏起来。
    resetDeferredMenuCache()
  })

  it('按需素材查得出 URL，且指向真有产物的那个文件', async () => {
    const [id, product] = Object.entries(DEFERRED.files)[0] as [string, string]
    const url = await resolveDeferredMenuAsset(id)
    expect(url).toContain(encodeURI(product))
    expect(url).toContain(`?v=${DEFERRED.version}`)
    expect(existsSync(resolve(PUBLIC_ROOT, product))).toBe(true)
  })

  it('名单外的 ID 是抛，不是静静返回一个取不到的 URL', async () => {
    // "查不到就不画"会让一次真正的烘焙遗漏表现成"那一页少了一颗按钮"。
    await expect(resolveDeferredMenuAsset('menu:天书/不存在的按钮1.png')).rejects.toThrow(
      /按需菜单素材名单里没有/,
    )
    // 骨架那批**不在**这张名单里，问它也得是抛 —— 两个入口各管一半，
    // "两边都能查到"会让边界在运行时形同虚设。
    const [bundledId] = bundledEntries()[0] as [string, string]
    await expect(resolveDeferredMenuAsset(bundledId)).rejects.toThrow(/按需菜单素材名单里没有/)
  })

  it('名单只加载一次，两次调用拿到同一份', async () => {
    const [id] = Object.entries(DEFERRED.files)[0] as [string, string]
    expect(await resolveDeferredMenuAsset(id)).toBe(await resolveDeferredMenuAsset(id))
  })
})

describe('路径规范化', () => {
  it('原版源码里写的每一条菜单路径都算得出 ID，且都有产物', () => {
    // 分母从原版 `src/menu/` 现扫：烘焙那一侧扫的是目录，这一条扫的是**代码
    // 里写的路径**。两边各自都可能对，而"目录里有的都烘了"并不蕴含"代码要的
    // 都烘到了"—— 那正是 xl-1dv.3 / xl-1dv.2 那一族缺陷的形状。
    const both = new Map([...bundledEntries(), ...Object.entries(DEFERRED.files)])
    const referenced = new Set<string>()
    for (const file of listFiles(repoPath('src/menu')).filter((f) => f.endsWith('.java'))) {
      for (const m of javaSource(`src/menu/${file}`).matchAll(/"(sources\/菜单\/[^"]+\.png)"/g)) {
        referenced.add(m[1] as string)
      }
    }
    // 零匹配（GBK 读成 UTF-8、或者源码挪走了）与"每一条都对得上"长得一样。
    expect(referenced.size).toBeGreaterThan(0)
    const unresolved = [...referenced].filter((p) => both.get(menuAssetId(p)) === undefined).sort()
    // ⚠️ `FuncPanel.java:31` 的 `sources/菜单/主人公4人2.png` **本来就取不到**：
    // 那个文件躺在 `天书/` 下。原版走 `new ImageIcon(...)`，取不到既不抛也不
    // 返回 null，于是十三年没人发现（xl-1dv 那一族的又一例，已另立票 xl-a7m）。
    // 这里把它**逐字**登记下来 —— 换成"允许有缺口"，明天真漏烘一张就混进来了。
    expect(unresolved).toEqual(['sources/菜单/主人公4人2.png'])
  })

  it('前缀不是 sources/菜单/ 的路径是抛，不是猜一个 ID 出来', () => {
    // 猜出来的 ID 要么查不到（还好），要么恰好撞上别的素材 —— 画错图，
    // 而且悄无声息。
    expect(() => menuAssetId('image/按钮图/击1.png')).toThrowError(/要以 sources\/菜单\/ 开头/)
    expect(menuAssetId('sources\\菜单\\天书\\存档1.png')).toBe('menu:天书/存档1.png')
  })

  it('只放行顶层目录逐字相等的那些，不是前缀匹配', () => {
    expect(isDeferredMenuAsset('天书/存档1.png')).toBe(true)
    expect(isDeferredMenuAsset('菜单/标题栏.png')).toBe(false)
    // 将来真出现一个 `菜单说明/` 目录，前缀匹配会把它一起放进主包。
    expect(isDeferredMenuAsset('菜单说明/x.png')).toBe(true)
    expect(menuProductPath('装备/装备4.png')).toBe(`${MENU_DEFERRED_PUBLIC_DIR}/装备/装备4.webp`)
    expect(menuProductPath('鼠标图/1.png')).toBe(`${MENU_BUNDLED_DIR}/鼠标图/1.webp`)
  })
})
