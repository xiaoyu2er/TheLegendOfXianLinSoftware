import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '../generated/assets.json'
import stamp from '../generated/bakeStamp.json'
import type { BakeStamp } from '../assets/bakeStamp'
import { listFiles } from '../assets/listFiles'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import {
  SHOP_ASSETS_OWNED_ELSEWHERE,
  SHOP_ROOT,
  SHOP_UNREFERENCED_OUT,
  UNREFERENCED_SHOP_ASSETS,
  isUnreferencedShopAsset,
  reconcileShopAssets,
  shopAssetId,
  shopAssetOwner,
  shopDataFiles,
  shopProductPath,
} from './shopAssets'
import type { UnreferencedShopAsset } from './shopAssets'
import { scanShopReferences } from './shopReferences'

/**
 * 商店素材那一层的判据（xl-knp.5）。
 *
 * 三段，性质不同，别混起来读：
 *
 * 1. **真仓库现扫**——分母全部从磁盘/指纹/映射表来，一处不写死条数；
 * 2. **`reconcileShopAssets` 的六种失败各造一次**——纯函数喂假清单。只在真
 *    仓库上跑一遍全绿，与「这几条根本没写对」长得一模一样；
 * 3. **`scanShopReferences` 本身**——它是「产物→源」那一半的分母，扫岔了的
 *    表现是一片红或者一片绿，两种都像别的毛病。
 */

const STAMP = stamp as BakeStamp
const MAP = manifest as Record<string, string>

/** 磁盘上 `sources/Shop/` 的全部文件，相对根，正斜杠。 */
const files = listFiles(repoPath(SHOP_ROOT)).sort()
/** 原版 Java 源码里点名的那批。 */
const referenced = scanShopReferences(repoPath())
/** 本票要烘的那批（`装备/`、`药品/回复类/`、数据表都不算）。 */
const baked = files.filter((f) => shopAssetOwner(f) === 'baked')

describe('商店素材：真仓库现扫', () => {
  it('扫描器真的扫到了东西 —— 空转要响', () => {
    // 「一条都没扫到」会让下面每一条差集都恒真：空集与空集的差还是空。
    expect(files.length).toBeGreaterThan(0)
    expect(baked.length).toBeGreaterThan(0)
    expect(referenced.length).toBeGreaterThan(0)
    // 中文路径扫得出来，也就等于「源码是按 GBK 解的」—— 按 UTF-8 解这几条
    // 会碎成乱码，正则一条都匹配不上，而零匹配与「确实没有引用」长得一样。
    expect(referenced).toContain('按钮组件/钱.png')
    expect(referenced).toContain('商店人物/店主/店主 (1).png')
  })

  it('原版源码确实是 GBK —— 按 UTF-8 解会碎，那正是零匹配的成因', () => {
    // 这一条解释上面那两条 `toContain` 为什么是判据而不是装饰：同一份字节按
    // UTF-8 读，那条路径整个匹配不上，而**零匹配与「确实没有引用」长得一模
    // 一样**。`scanShopReferences` 因此在一条字面量都没扫到时是抛。
    expect(javaSource('src/shop/ShopPanel.java')).toContain('sources/Shop/按钮组件/钱.png')
    const utf8 = new TextDecoder('utf-8').decode(readFileSync(repoPath('src/shop/ShopPanel.java')))
    expect(utf8).not.toContain('sources/Shop/按钮组件/钱.png')
  })

  it('六条对账在真仓库上全过', () => {
    expect(reconcileShopAssets(files, referenced)).toEqual([])
  })

  it('本票那批 = 有代码引用的 ∪ 无引用登记，两边都非空且不相交', () => {
    const withRef = baked.filter((f) => referenced.includes(f))
    const registered = baked.filter((f) => isUnreferencedShopAsset(f))
    // 打包边界的两边都得有东西：全在一边的话，「边界生效了」与「边界没生效」
    // 在产物上分不开。
    expect(withRef.length).toBeGreaterThan(0)
    expect(registered.length).toBeGreaterThan(0)
    expect(withRef.filter((f) => registered.includes(f))).toEqual([])
    expect(withRef.length + registered.length).toBe(baked.length)
  })

  it('映射表里 shop: 那批，恰好是有代码引用的那批（产物→源双向盖满）', () => {
    const mapped = Object.keys(MAP)
      .filter((id) => id.startsWith('shop:'))
      .sort()
    const wanted = baked
      .filter((f) => referenced.includes(f))
      .map((f) => shopAssetId(f))
      .sort()
    expect(wanted.length).toBeGreaterThan(0)
    expect(mapped).toEqual(wanted)
    // 产物路径那一头也要对得上：映射表指到别处去了，取图的表现是「查不到」，
    // 而那时谁都不知道该找烘焙器还是找映射表。
    for (const f of baked.filter((x) => referenced.includes(x))) {
      expect(MAP[shopAssetId(f)]).toBe(shopProductPath(f))
    }
  })

  it('无引用的那 13 张：一条映射都没有，产物落在不进主包的那个目录里', () => {
    for (const u of UNREFERENCED_SHOP_ASSETS) {
      expect(MAP[shopAssetId(u.path)], `${u.path} 不该进映射表`).toBeUndefined()
    }
    // 产物那一头：目录里有什么就是什么，与登记逐条对撞。少烘一张的表现是
    // 「源→产物」那半边缺一格，而那一格从映射表上是看不见的（它本来就不在）。
    const products = listFiles(repoPath('web', SHOP_UNREFERENCED_OUT)).sort()
    const wanted = UNREFERENCED_SHOP_ASSETS.map((u) =>
      u.path.replace(/\.[^./]+$/, '.webp'),
    ).sort()
    expect(products).toEqual(wanted)
  })

  it('登记里每一条都签了票号与理由', () => {
    for (const u of UNREFERENCED_SHOP_ASSETS) {
      expect(u.issue, `${u.path} 没有票号`).toMatch(/^xl-/)
      expect(u.why.length, `${u.path} 的理由是空的 —— 手签就要签得出理由`).toBeGreaterThan(3)
    }
  })

  it('指纹里 sources/Shop 的每一条输入都有主：不是别人烘的，就是本票烘的', () => {
    // 这一条对撞的是 `SHOP_ASSETS_OWNED_ELSEWHERE` 那份手签登记：分母是
    // `bakeStamp.json`（烘焙器现场记的），与那份名单彼此独立。少签一条的表现
    // 是那一摊被烘两遍（产物路径撞车，烘焙器当场硬失败）；多签一条的表现是
    // 那一摊谁都不烘 —— 后者只有这里看得见。
    const inputs = Object.keys(STAMP.inputs)
      .filter((p) => p.startsWith(`${SHOP_ROOT}/`))
      .map((p) => p.slice(SHOP_ROOT.length + 1))
    expect(inputs.length).toBeGreaterThan(0)
    const homeless = inputs.filter((f) => {
      const owner = shopAssetOwner(f)
      if (owner !== 'baked') return false
      return !referenced.includes(f) && !isUnreferencedShopAsset(f)
    })
    expect(homeless).toEqual([])
    // 让给别人的那两摊，指纹里确实各有东西 —— 一条都没有的话「让给原主」
    // 就是一句空话，而空话与「原主烘得好好的」长得一样。
    for (const o of SHOP_ASSETS_OWNED_ELSEWHERE) {
      expect(inputs.some((f) => f.startsWith(o.prefix)), `${o.prefix} 在指纹里一条都没有`).toBe(
        true,
      )
    }
  })

  it('两个商店面板的源码在指纹里 —— 接上引用必然要求重烘', () => {
    // 「有人给宋大仁接上引用」的第一道红就在这里：`ShopPanel.java` 是烘焙器
    // 读过的输入，改了它不重烘，`bakeStamp.test.ts` 那条「输入还是烘焙时那
    // 一份」立刻红。第二道是 `reconcileShopAssets` 第 4 条（下面真造了一次）。
    for (const f of ['src/shop/ShopPanel.java', 'src/shop/EquipmentShopPanel.java']) {
      expect(Object.keys(STAMP.inputs), `${f} 不在烘焙指纹里`).toContain(f)
    }
  })

  it('数据表就是原版 ShopReader 读的那几张', () => {
    expect(files.filter((f) => shopAssetOwner(f) === 'data').sort()).toEqual(shopDataFiles())
  })
})

/**
 * 六种失败各造一次。喂的是**假清单**，所以每一条都真的红过一次 —— 只在真
 * 仓库上跑一遍全绿，跟「这几条根本没写对」长得一模一样。
 */
describe('reconcileShopAssets 的每一种失败都造得出来', () => {
  /** 一份最小的、自洽的假磁盘：数据表齐、两摊让给别人的各有一个文件、本票两张。 */
  const okFiles = [
    ...shopDataFiles(),
    '装备/武器/剑.png',
    '药品/回复类/药.png',
    '按钮组件/用得上.png',
    '按钮组件/没人用.png',
  ]
  const okRefs = ['按钮组件/用得上.png']
  const okRegistry: UnreferencedShopAsset[] = [
    { path: '按钮组件/没人用.png', issue: 'xl-test', why: '假的' },
  ]

  it('先证明这份夹具本身是干净的 —— 不然下面每一条都分不出红在哪', () => {
    expect(reconcileShopAssets(okFiles, okRefs, okRegistry)).toEqual([])
  })

  it('1. 数据表多一张 / 少一张', () => {
    const problems = reconcileShopAssets(
      okFiles.filter((f) => f !== 'drug.txt'),
      okRefs,
      okRegistry,
    )
    expect(problems.join('\n')).toContain('数据表')
  })

  it('2. 代码点名了一条路径，磁盘上却没有那个文件', () => {
    const problems = reconcileShopAssets(okFiles, [...okRefs, '按钮组件/幽灵.png'], okRegistry)
    expect(problems.join('\n')).toContain('原版代码点名了 sources/Shop/按钮组件/幽灵.png')
  })

  it('3. 登记里的一条，磁盘上没有', () => {
    const problems = reconcileShopAssets(okFiles, okRefs, [
      ...okRegistry,
      { path: '按钮组件/抄错字.png', issue: 'xl-test', why: '假的' },
    ])
    expect(problems.join('\n')).toContain('无引用登记里的 sources/Shop/按钮组件/抄错字.png')
  })

  it('4. 登记里的一条现在有代码引用了 —— 接上了却没来销账', () => {
    // 这就是票面要的那条：有人给它接上引用，登记要红。
    const problems = reconcileShopAssets(okFiles, [...okRefs, '按钮组件/没人用.png'], okRegistry)
    expect(problems.join('\n')).toContain('无引用登记过期：sources/Shop/按钮组件/没人用.png')
  })

  it('5. 磁盘上一张既没引用也没登记的', () => {
    const problems = reconcileShopAssets([...okFiles, '按钮组件/新来的.png'], okRefs, okRegistry)
    expect(problems.join('\n')).toContain(
      'sources/Shop/按钮组件/新来的.png 没有任何代码引用，也不在',
    )
  })

  it('6. 让给别人的那一摊在磁盘上一个文件都没有', () => {
    const problems = reconcileShopAssets(
      okFiles.filter((f) => !f.startsWith('装备/')),
      okRefs,
      okRegistry,
    )
    expect(problems.join('\n')).toContain('sources/Shop/装备/ 下一个文件都没有')
  })
})

/**
 * 扫描器本身。它是「产物→源」那一半的分母，而这一半的全部意义在于**不由手写**
 * ——所以它扫岔了没人拦得住，只能自己造几棵假源码树看。
 */
describe('scanShopReferences', () => {
  /** 在临时目录里造一棵 `src/` 树。`.java` 的内容里只用 ASCII 路径。 */
  function fakeRepo(sources: Record<string, string>): string {
    const dir = mkdtempSync(resolve(tmpdir(), 'shop-refs-'))
    for (const [name, text] of Object.entries(sources)) {
      const file = resolve(dir, 'src', name)
      mkdirSync(resolve(file, '..'), { recursive: true })
      writeFileSync(file, text, 'utf8')
    }
    return dir
  }

  it('逐字字面量算引用，没有扩展名的前缀不算', () => {
    const dir = fakeRepo({
      'shop/A.java': [
        'String a = "sources/Shop/back.png";',
        'String p = "sources/Shop/btn/";', // 拼接用的前缀，不是文件
        'String q = "sources/Shop/";',
      ].join('\n'),
    })
    expect(scanShopReferences(dir)).toEqual(['back.png'])
  })

  it('ShopAnimation 的角色名与帧数一起展开成那几条路径', () => {
    const dir = fakeRepo({
      'shop/A.java': [
        'String a = "sources/Shop/back.png";',
        'ani.add(new ShopAnimation("Boss", 364, 515, 3, this));',
      ].join('\n'),
    })
    expect(scanShopReferences(dir)).toEqual([
      'back.png',
      '商店人物/Boss/Boss (1).png',
      '商店人物/Boss/Boss (2).png',
      '商店人物/Boss/Boss (3).png',
    ])
  })

  it('帧数变了，展开出来的条数跟着变 —— 那个实参不是装饰', () => {
    const one = fakeRepo({
      'shop/A.java': 'String a = "sources/Shop/back.png";\nnew ShopAnimation("Boss",0,0,1,this);',
    })
    const two = fakeRepo({
      'shop/A.java': 'String a = "sources/Shop/back.png";\nnew ShopAnimation("Boss",0,0,2,this);',
    })
    expect(scanShopReferences(one)).toHaveLength(2)
    expect(scanShopReferences(two)).toHaveLength(3)
  })

  it('多加一个 ShopAnimation，登记当场过期 —— 「接上引用要红」的完整链条', () => {
    // 把「有人给一个无引用的角色接上引用」这件事从头到尾走一遍：源码多一行，
    // 扫描器多几条，`reconcileShopAssets` 第 4 条红。
    const before = fakeRepo({
      'shop/A.java': 'String a = "sources/Shop/back.png";',
    })
    const after = fakeRepo({
      'shop/A.java':
        'String a = "sources/Shop/back.png";\nnew ShopAnimation("Boss", 0, 0, 1, this);',
    })
    const disk = [...shopDataFiles(), '装备/剑.png', '药品/回复类/药.png', 'back.png', '商店人物/Boss/Boss (1).png']
    const registry: UnreferencedShopAsset[] = [
      { path: '商店人物/Boss/Boss (1).png', issue: 'xl-test', why: '两个面板都没构造它' },
    ]
    expect(reconcileShopAssets(disk, scanShopReferences(before), registry)).toEqual([])
    expect(reconcileShopAssets(disk, scanShopReferences(after), registry).join('\n')).toContain(
      '无引用登记过期：sources/Shop/商店人物/Boss/Boss (1).png',
    )
  })

  it('一个 .java 都没有是抛，不是返回空集', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'shop-refs-'))
    mkdirSync(resolve(dir, 'src'), { recursive: true })
    expect(() => scanShopReferences(dir)).toThrowError(/一个 \.java 都没有/)
  })

  it('有 .java 却一条字面量都没有是抛 —— 那多半是解码错了', () => {
    // 零匹配与「确实没有引用」长得一模一样，而后者会让每一张图都被报成
    // 「没登记」—— 一片红，看起来像素材出了问题。
    const dir = fakeRepo({ 'shop/A.java': 'class A {}' })
    expect(() => scanShopReferences(dir)).toThrowError(/一条 "sources\/Shop\/…" 字面量都没有/)
  })

  it('onRead 拿到的是每一个源文件的绝对路径 —— 烘焙器靠它记指纹', () => {
    const dir = fakeRepo({
      'shop/A.java': 'String a = "sources/Shop/back.png";',
      'battle/B.java': 'class B {}',
    })
    const seen: string[] = []
    scanShopReferences(dir, (p) => {
      seen.push(p)
      return p
    })
    // 分母是 `src/` 下每一个 `.java`，不是 `src/shop/` —— 缩到 shop 包等于
    // 先假设「只有它读商店素材」，而那正是要验的事。
    expect(seen.sort()).toEqual([resolve(dir, 'src/battle/B.java'), resolve(dir, 'src/shop/A.java')])
  })
})
