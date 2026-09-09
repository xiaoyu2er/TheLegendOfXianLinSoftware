import type { AssetId } from '../assets/ids'
import { normalizePath } from '../assets/path'
import { EQUIP_SLOTS, SLOT_FILE } from '../menu/equipment'

/**
 * 商店素材的**打包边界与登记**（xl-knp.5）。
 *
 * `sources/Shop/` 下的东西不是一批，是四批，而其中两批**早就烘过了** ——
 * 这一点是先查 `bakeStamp.json` 的 `inputs` 查出来的，不是推的
 * （2026-09-09，本枝烘焙前的那一份指纹）：
 *
 *     sources/Shop 下已在指纹里的输入          65 个
 *       装备/武器 23、装备/饰品 12、装备/手 6、装备/头 6、
 *       装备/盔甲 6、装备/脚 6                 ← xl-234 的 bakeEquipPictures
 *       药品/回复类 6                          ← xl-rh9.12 的药品介绍图
 *     磁盘上一共                              188 个
 *     差集                                    123 个
 *       其中 装备 下的 30 个 .bmp              ← xl-234 登记为不烘，不是漏
 *       7 个 .txt                              ← 数据，不是素材
 *       **本票要烘的 86 个**
 *
 * 所以这个模块**不重复烘任何一张**：`装备/` 与 `药品/回复类/` 整个由
 * `SHOP_ASSETS_OWNED_ELSEWHERE` 让给原主，`.txt` 归数据那一层，剩下的 86 张
 * 才是这里的分母 —— 而这三条边界每一条都由 `reconcileShopAssets` 两头核过，
 * 不是靠这段注释。
 *
 * ## 边界画在哪：原版自己回答了「打开商店那一刻要不要全在手上」
 *
 * 票面的判据是那一句。它在这里有一个**逐字的**答案，因为原版根本不是开店时
 * 才加载 —— `main/GameLauncher.java:61-62` 在游戏启动时就把两个面板都构造了：
 *
 *     shopPanel=new ShopPanel();
 *     equipmentShopPanel=new EquipmentShopPanel();
 *
 * 而两个构造函数里 `Reader.readImage(...)` 与 `new ShopAnimation(...)` 一次
 * 读完自己要的每一张。也就是说：**凡是有代码引用的，开店那一刻全都在手上；
 * 凡是没有代码引用的，任何一刻都不在手上。** 边界就画在这条缝上，两边都不是
 * 我挑的。
 *
 * 这条缝的另一半好处是它**不放水**：产物→源那一半判据要求「每一份进主包的
 * 产物都有代码在用」，而进主包的那批按定义全都有 —— 不必给整个 `商店人物/`
 * 开例外（xl-1dv.17 点名要避免的那件事）。
 *
 * ⚠️ **它有一个 `menuAssets.ts` 那条边界没有的性质，得说清楚**：那边「骨架 /
 * 内容」两包都是活的，运行时按需去取内容那半；这里第二包**没有运行时**，
 * 因为按定义没有任何代码会去取它。所以它不落在 `public/`（落进去就是 dist
 * 里一坨永远不会被下载的字节），落在 `src/generated/shop-unreferenced/`：
 * 入库、可检视、不进 `assets.json`、不进 `resolve.ts` 那条 glob、不进 dist。
 *
 * ## 量出来的体积
 *
 * 见 `scripts/bake.ts` 里 `bakeShopAssets` 的头注 —— 数字写在真正落盘的那一处，
 * 抄两份迟早分家。
 */

/** 原版商店素材根目录，仓库相对。 */
export const SHOP_ROOT = 'sources/Shop'

/** 逻辑 ID 的前缀。`sources/Shop/按钮组件/钱.png` → `shop:按钮组件/钱.png`。 */
const ID_PREFIX = 'shop:'

/** 进主包的商店素材在 `src/generated/assets/` 下的目录名。 */
export const SHOP_BUNDLED_DIR = 'shop'

/**
 * 没有代码引用、照烘但**不进主包**的那批，落在哪（相对 `web/`）。
 *
 * 不在 `src/generated/assets/` 下面，两个理由各自都够：那个目录被
 * `resolve.ts` 的 eager glob 整个吃进主包；而 `bakeStamp.test.ts` 那条
 * 「映射表与产物目录互相盖满」要求那里的每一个文件都有映射 —— 这批按定义
 * 一条映射都不该有。
 */
export const SHOP_UNREFERENCED_OUT = 'src/generated/shop-unreferenced'

/**
 * 原版路径 → 逻辑 ID。入参是**相对 `SHOP_ROOT` 的路径**（`按钮组件/钱.png`），
 * 正反斜杠都认。
 *
 * **扩展名与目录层都留在 ID 里**，与 `menuAssetId` 同一个规矩：原版取图时
 * 整条路径写死在拼接里，去掉任何一段，ID 就不再是那条路径的函数了。
 */
export function shopAssetId(relative: string): AssetId {
  return `${ID_PREFIX}${normalizePath(relative)}`
}

/** 一个商店素材的**产物相对路径**（相对 `src/generated/assets/`）。 */
export function shopProductPath(relative: string): string {
  return `${SHOP_BUNDLED_DIR}/${normalizePath(relative).replace(/\.[^./]+$/, '.webp')}`
}

/** `sources/Shop/` 下由别的票烘的那几摊。 */
export interface ShopAssetsOwnedElsewhere {
  /** 相对 `SHOP_ROOT` 的**目录前缀**，带结尾斜杠。 */
  readonly prefix: string
  /** 烘它的那张票。 */
  readonly issue: string
  /** 烘它的那一趟叫什么。 */
  readonly by: string
}

/**
 * **登记**（不是分母）：`sources/Shop/` 下这两摊早就有主了，这里一张都不重烘。
 *
 * 对撞它的是 `shopAssets.test.ts` 里那条「指纹里 `sources/Shop` 的每一条输入
 * 要么落在这两个前缀下、要么是本票烘的」—— 那一头的分母是 `bakeStamp.json`，
 * 与这份手写名单彼此独立。少写一条的表现是那一摊被烘两遍（产物路径撞车，
 * 烘焙器当场硬失败）；多写一条的表现是那一摊谁都不烘，而那要靠对撞才看得见。
 */
export const SHOP_ASSETS_OWNED_ELSEWHERE: readonly ShopAssetsOwnedElsewhere[] = [
  { prefix: '装备/', issue: 'xl-234', by: 'bakeEquipPictures' },
  { prefix: '药品/回复类/', issue: 'xl-rh9.12', by: '药品介绍图那一趟' },
]

/** 一张没有任何代码引用的商店素材。 */
export interface UnreferencedShopAsset {
  /** 相对 `SHOP_ROOT` 的路径，**逐字**。 */
  readonly path: string
  /** 追这条的 bd issue。 */
  readonly issue: string
  /** 为什么它在这儿。 */
  readonly why: string
}

/**
 * **没有任何代码引用的商店素材，逐字写死**（dispatch.md 纪律 3 意义上的
 * 「登记」，不是「分母」——分母是 `SHOP_ROOT` 现扫的那 188 个文件）。
 *
 * 两族，各有一张登记票：
 *
 * - `商店人物/宋大仁/` 8 帧（**xl-1dv.17**）—— `商店人物/` 下六个角色目录，
 *   两个面板一共构造 8 个 `ShopAnimation`、用到其中 5 个，宋大仁 不在其中。
 * - `按钮组件/` 5 张（**xl-1dv.18**）—— 24 张里逐字引用了 19 张。`增强1/2`
 *   与 `恢复1/2` 的形状跟 `武器1/2` 那六对一模一样（常态图 + 按下图），
 *   也就是装备超市那一排本来打算有八类、实际只做了六类；`消息.png` 是一块
 *   谁都没画的提示条。
 *
 * ⚠️ **xl-1dv.18 是本票现扫出来的，而 xl-1dv.17 只查了 `商店人物/`。**
 * 转抄那张票的「无代码引用的商店素材 = 宋大仁 那 8 张」会漏掉 5 张，而漏掉的
 * 表现是烘焙器报「5 张没登记」—— 还好它会响。dispatch.md 那条「转抄别人
 * 枚举出来的『一共 N 处』要自己再数一遍」。
 *
 * **两头都要红**（与 `KNOWN_MISSING_EQUIP_PICTURES` 同一个规矩）：有人给其中
 * 一张接上引用而不来销账 → `reconcileShopAssets` 第 4 条；磁盘上多出一张谁都
 * 没引用的而不来登记 → 第 5 条。两条都在 `shopAssets.test.ts` 里真造过。
 */
export const UNREFERENCED_SHOP_ASSETS: readonly UnreferencedShopAsset[] = [
  // xl-1dv.17 —— 唯一的读取点是 `ShopAnimation.java:24`，而它的角色名来自两个
  // 面板里写死的那八行 `new ShopAnimation("…")`，宋大仁 不在其中。
  // ⚠️ 「宋大仁」三个字在 `src/` 里搜得到 3 处，全是战斗侧的注释
  // （`BattlePanel.java:108/111`、`VictoryReminder.java:33`），与这个素材目录
  // 无关 —— 判据是那条路径没被拼出来，不是 grep 的计数为 0。
  {
    path: '商店人物/宋大仁/宋大仁 (1).png',
    issue: 'xl-1dv.17',
    why: '两个面板都没有构造 new ShopAnimation("宋大仁", …)',
  },
  {
    path: '商店人物/宋大仁/宋大仁 (2).png',
    issue: 'xl-1dv.17',
    why: '两个面板都没有构造 new ShopAnimation("宋大仁", …)',
  },
  {
    path: '商店人物/宋大仁/宋大仁 (3).png',
    issue: 'xl-1dv.17',
    why: '两个面板都没有构造 new ShopAnimation("宋大仁", …)',
  },
  {
    path: '商店人物/宋大仁/宋大仁 (4).png',
    issue: 'xl-1dv.17',
    why: '两个面板都没有构造 new ShopAnimation("宋大仁", …)',
  },
  {
    path: '商店人物/宋大仁/宋大仁 (5).png',
    issue: 'xl-1dv.17',
    why: '两个面板都没有构造 new ShopAnimation("宋大仁", …)',
  },
  {
    path: '商店人物/宋大仁/宋大仁 (6).png',
    issue: 'xl-1dv.17',
    why: '两个面板都没有构造 new ShopAnimation("宋大仁", …)',
  },
  {
    path: '商店人物/宋大仁/宋大仁 (7).png',
    issue: 'xl-1dv.17',
    why: '两个面板都没有构造 new ShopAnimation("宋大仁", …)',
  },
  {
    path: '商店人物/宋大仁/宋大仁 (8).png',
    issue: 'xl-1dv.17',
    why: '两个面板都没有构造 new ShopAnimation("宋大仁", …)',
  },
  // xl-1dv.18 —— 装备超市那一排按钮只做了六类，这两对是没做的第七、第八类。
  { path: '按钮组件/增强1.png', issue: 'xl-1dv.18', why: '装备超市那一排按钮的第七类，没做' },
  { path: '按钮组件/增强2.png', issue: 'xl-1dv.18', why: '装备超市那一排按钮的第七类，按下态，没做' },
  { path: '按钮组件/恢复1.png', issue: 'xl-1dv.18', why: '装备超市那一排按钮的第八类，没做' },
  { path: '按钮组件/恢复2.png', issue: 'xl-1dv.18', why: '装备超市那一排按钮的第八类，按下态，没做' },
  { path: '按钮组件/消息.png', issue: 'xl-1dv.18', why: '一块提示条，两个面板都没画' },
]

/**
 * 药品表的文件名，逐字照 `ShopReader.readDrug()` 里那句
 * `new File("sources/Shop/drug.txt")`。六张装备表的名字不写在这里 ——
 * 它们是 `SLOT_FILE` 那六个值（同一个 `s` 既拼 `<s>.txt` 也拼 `装备/<s>/`），
 * 抄第二份的表现是「某一类的表悄悄没人认」。
 */
const DRUG_LIST_FILE = 'drug.txt'

/** 数据文件（不是素材）：原版 `ShopReader` 读的那几张表。 */
export function shopDataFiles(): string[] {
  return [DRUG_LIST_FILE, ...EQUIP_SLOTS.map((slot) => `${SLOT_FILE[slot]}.txt`)].sort()
}

/** 这个文件归谁：本票烘的那批、数据表、还是别的票的。 */
export function shopAssetOwner(relative: string): 'baked' | 'data' | ShopAssetsOwnedElsewhere {
  const owner = SHOP_ASSETS_OWNED_ELSEWHERE.find((o) => relative.startsWith(o.prefix))
  if (owner !== undefined) return owner
  if (relative.toLowerCase().endsWith('.txt')) return 'data'
  return 'baked'
}

/** 这张图在那份「没有任何代码引用」的逐字登记上。 */
export function isUnreferencedShopAsset(
  relative: string,
  unreferenced: readonly UnreferencedShopAsset[] = UNREFERENCED_SHOP_ASSETS,
): boolean {
  return unreferenced.some((u) => u.path === relative)
}

/**
 * 商店素材的**全部对账**，摊成一串问题字符串（空 = 全过）。
 *
 * 纯函数：磁盘清单与「代码引用到了哪些」都从外面注进来，所以
 * `shopAssets.test.ts` 能喂它假的目录状态与假的引用集合，把每一种失败**都真
 * 造出来看一眼**。只在真仓库上跑一遍全绿，跟「这几条根本没写对」长得一模一样。
 *
 * `referenced` 那一半的分母是**原版 Java 源码**（`scanShopReferences`，扫
 * `src/` 下每一个 `.java`），与这份手写登记彼此独立 —— 这就是「双向盖满」里
 * 「产物→源」那一半的出处，也是「有人接上引用时那条登记要红」的机制。
 *
 * 六条：
 *
 * 1. 磁盘上的 `.txt` 与原版 `ShopReader` 读的那几张表对不上（多一张 / 少一张）；
 * 2. 代码点名了一条路径，而磁盘上没有那个文件；
 * 3. 登记里的一条，磁盘上没有那个文件（多半是抄错了字，或者素材被删了）；
 * 4. 登记里的一条**现在有代码引用了**（接上了却没来销账）；
 * 5. 磁盘上一张既没有代码引用、也没有登记的（多半是新素材进来了）；
 * 6. `SHOP_ASSETS_OWNED_ELSEWHERE` 里的某个前缀在磁盘上一个文件都没有
 *    （那一摊搬走了，而「让给原主」会变成一句空话）。
 *
 * `unreferenced` 有默认值，只为让第 3、4 条**造得出失败**；生产侧一个调用方
 * 都不传它。
 */
export function reconcileShopAssets(
  files: readonly string[],
  referenced: readonly string[],
  unreferenced: readonly UnreferencedShopAsset[] = UNREFERENCED_SHOP_ASSETS,
): string[] {
  const problems: string[] = []
  const onDisk = new Set(files)
  const referencedSet = new Set(referenced)

  // 1. 数据表
  const dataOnDisk = files.filter((f) => shopAssetOwner(f) === 'data').sort()
  const dataWanted = shopDataFiles()
  if (dataOnDisk.join(' ') !== dataWanted.join(' ')) {
    problems.push(
      `${SHOP_ROOT} 下的数据表是 ${dataOnDisk.join(' / ') || '（空）'}，` +
        `而原版 ShopReader 读的是 ${dataWanted.join(' / ')}`,
    )
  }

  // 2. 代码点名了却不在磁盘上
  for (const r of [...referencedSet].sort()) {
    if (!onDisk.has(r)) {
      problems.push(`原版代码点名了 ${SHOP_ROOT}/${r}，而磁盘上没有这个文件`)
    }
  }

  // 3./4. 登记那两头
  for (const u of unreferenced) {
    if (!onDisk.has(u.path)) {
      problems.push(
        `无引用登记里的 ${SHOP_ROOT}/${u.path}（${u.issue}）磁盘上没有 —— ` +
          `多半是抄错了字，或者素材被删了却没来销账`,
      )
      continue
    }
    if (referencedSet.has(u.path)) {
      problems.push(
        `无引用登记过期：${SHOP_ROOT}/${u.path}（${u.issue}）现在有代码引用了，` +
          `请从 shopAssets.ts 的 UNREFERENCED_SHOP_ASSETS 删掉`,
      )
    }
  }

  // 5. 磁盘上既没引用也没登记
  for (const f of files) {
    if (shopAssetOwner(f) !== 'baked') continue
    if (referencedSet.has(f) || isUnreferencedShopAsset(f, unreferenced)) continue
    problems.push(
      `${SHOP_ROOT}/${f} 没有任何代码引用，也不在 shopAssets.ts 的 ` +
        `UNREFERENCED_SHOP_ASSETS 里 —— 要么接上引用，要么登记它并开一张缺陷票`,
    )
  }

  // 6. 让给别人的那几摊还在不在
  for (const o of SHOP_ASSETS_OWNED_ELSEWHERE) {
    if (!files.some((f) => f.startsWith(o.prefix))) {
      problems.push(
        `${SHOP_ROOT}/${o.prefix} 下一个文件都没有，而它登记着由 ${o.by}（${o.issue}）烘 —— ` +
          `那一摊搬走了的话，这条登记要跟着改`,
      )
    }
  }

  return problems
}
