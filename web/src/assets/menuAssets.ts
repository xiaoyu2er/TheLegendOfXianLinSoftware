import type { AssetId } from './ids'
import { normalizePath } from './path'

/**
 * 菜单素材的**打包边界**（xl-6lo.4）：哪些进主包、哪些按需加载，以及两边各自
 * 的产物落在哪。形状照抄 `battleAssets.ts`，**数字一个都没照抄** —— 票面明写
 * 「那批的读数不许照抄」，下面每一个字节数都是这一趟自己量的。
 *
 * ## 边界画在哪，为什么
 *
 * 判据是票面那一句：**「打开菜单的那一刻要不要全在手上」**。它有两个从句，
 * 而原版都逐字回答了。
 *
 * **第一，每一页都要画的。** `menu/FatherPanel.paint()` 是四个页面**共用**的
 * 绘制入口：
 *
 *     bufferedGraphics.drawImage(backgroundImage, 0, 0, this);  // 各页自己的整屏背景
 *     drawSpecialImage(bufferedGraphics);                       // 各页自己的
 *     menuPanel.command.drawCommand(bufferedGraphics);          // sources/菜单/菜单/
 *     scoll.drawScoll(bufferedGraphics);                        // sources/菜单/scoll/
 *     drawThisPanel(bufferedGraphics);                          // 各页自己的
 *     mouse.drawMouse(bufferedGraphics);                        // sources/菜单/鼠标图/
 *
 * 也就是 `菜单`（标题栏 + 四颗页签的三态）、`scoll`（卷轴 / 英雄 / 等级）、
 * `鼠标图` 这三个。
 *
 * **第二，第一帧要画的那一页。** `MenuPanel` 的两个构造器末尾都是
 * `currentPanel=thingPanel`，而 `thingPanel=new DrugPanel(...)`，`DrugPanel` 的
 * 背景是 `sources/菜单/物品/物品3.png`（`DrugPanel.java:82`）。上面那段
 * `paint()` 里**背景是第一句**：它不在手上，菜单打开的第一帧就不是原版那一帧
 * —— 而 M3 的验收正是 menu 那两条真值的逐帧比对，第 0 帧首当其冲。所以
 * `物品` 那 4 张也进主包。
 *
 * 合起来：骨架 = 共用的三个目录 + 首页那一个，47 张；其余（`天书` / `装备` /
 * `奇术`）142 张按需。
 *
 * ⚠️ **票面预写的分组是「骨架 = 菜单 / 天书 / 鼠标图 / scoll」，实测把它推翻了，
 * 而推翻它的正是票面自己那句判据。** `天书/天书.png` 是 `FuncPanel` 的整屏背景
 * （1024×640），压缩后 **672,000 B** —— 它跟 `装备4.png` 是同一种东西，只服务
 * 四页里的一页，而那一页不是打开时看到的那一页。照票面切，骨架里 46% 的字节
 * 服务一个未必会被翻到的页面，而唯一必然要立刻画的那张背景反倒不在手上。
 *
 * ⚠️ **这条边界是两个从句，不是一个，而这一点是 `/code-review` 的 Spec 轴逼
 * 出来的。** 初版只做了从句一（骨架 = 那三个共用目录），却在这段注释里用从句二
 * 去否掉 `天书` —— 拿一把尺子量别人、不量自己。评审原话：「By the comment's own
 * reasoning the one background guaranteed to be needed at open is not in hand」。
 *
 * ## 量出来的体积（cwebp 1.6.0，189 张全是 PNG 走 `-lossless`）
 *
 *   目录        张数   源字节      产物字节    压缩率
 *   菜单          13    100,970      58,402     57.8%
 *   scoll         22    632,817     473,598     74.8%
 *   鼠标图         8      6,990       3,066     43.9%
 *   物品           4  1,586,319     719,452     45.4%
 *   ——— 骨架 47 张，合计 1,254,518 B（1.20 MiB）———
 *   天书          50  1,936,420     924,136     47.7%
 *   装备          28  6,494,859   3,051,006     47.0%
 *   奇术          64  1,915,814     999,132     52.2%
 *   ——— 内容 142 张，合计 4,974,274 B（4.74 MiB）———
 *   总计         189 12,674,189   6,228,792     49.1%
 *
 * ⚠️ 上表是 xl-6lo.4 那一趟的读数。xl-9a6 之后 `装备/` 里有两张走别名、不出
 * 产物（见 `MENU_ASSET_ALIASES`），那一行的产物字节少了 1,456,534 B。
 *
 * **压缩率与战斗那批不是一回事**：战斗那批 753 张背景动画是 JPG 走有损 q95，
 * 这里 189 张全是 PNG，`toWebp` 的 `-lossless` 分支，所以「49.1%」是无损重编码
 * 的读数，跟 xl-rh9.2 的任何一个百分比都不可比。
 *
 * 骨架里 57% 的字节是 `物品/物品3.png` 那一张整屏背景（719,452 B）。它贵，
 * 但它是第一帧必画的那一张 —— 见上面的从句二。
 *
 * ## 主包净涨多少
 *
 * 二进制两边都不进 JS —— 进主包的那批走 `resolve.ts` 那条 `?url` 的 **eager**
 * glob，进去的是**路径字符串**，外加 `assets.json` 里多出来的那几条映射。
 * 所以「主包净涨」量的是 `dist/assets/index-*.js`：
 *
 *   构型                       index-*.js   对基线      gzip       对基线
 *   基线（菜单一张都不烘）       801.36 kB      —      215.32 kB      —
 *   189 张全进主包               825.80 kB  +24.44 kB  219.54 kB  +4.22 kB
 *   **骨架 47 张进主包**         809.07 kB  **+7.71 kB** 216.57 kB **+1.25 kB**
 *
 * 三行都是同一台机器上跑 `pnpm build` 读出来的（2026-09-08）。第二行的量法是把
 * `public/menu-content/` 下的产物**原样拷进** `src/generated/assets/menu/` 再
 * build ——`resolve.ts` 那条 glob 认的是目录不是名单，所以这一拷就等价于「边界
 * 画成 189 张全进主包」；量完删掉，`find … | wc -l` 从 189 回到 47。
 *
 * 也就是说这条边界买到的是 **16.73 kB**（gzip 2.97 kB）主包，外加 4.74 MiB
 * 不必在打开菜单前拿到手的下载量。
 *
 * ⚠️ **这几个数不能拿来跟 xl-rh9.2 的「主包只涨 126 KB」比大小。** 那个 126 KB
 * 是 635 张进主包的读数，分母差一个数量级，而且它量的是它自己那一趟的前后差，
 * 基线跟今天这条不是同一个。同一个口径下菜单这批的答案就是上表。
 *
 * ⚠️ 上表第三行今天还**不含**按需名单那个 chunk：`deferredMenu.ts` 眼下没有
 * 任何调用方，整个模块被 tree-shake 掉了，`menuContent.json` 一个字节都没进
 * `dist/`。菜单面板真接上去之后这一格会多一个 chunk（战斗那边对应的是
 * `battleAnimations-*.js`，172.96 kB / gzip 10.93 kB），**而它是不是仍然不进
 * 主包**，由 `menuAssets.test.ts` 那条「主包不静态引用按需名单」守着。
 */

/** 原版菜单素材根目录，仓库相对。 */
export const MENU_ROOT = 'sources/菜单'

/** 逻辑 ID 的前缀。`sources/菜单/天书/存档1.png` → `menu:天书/存档1.png`。 */
const ID_PREFIX = 'menu:'

/**
 * **打开菜单那一刻就要画**的那几个顶层目录 —— 也就是进主包的那批：三个共用
 * 目录，加上首页（`物品`）自己那一个。两个从句各自的出处见文件头注。
 *
 * 名单是手写的（dispatch.md 纪律 3 意义上的「登记」，不是「分母」）：它记的
 * 那件事要人去读 `FatherPanel.paint()` 与 `MenuPanel` 的构造器才答得出，按体积
 * 或按目录名自动推等于让被守的东西自己签字。
 *
 * 分母那一半在 `menuAssets.test.ts` 里，从 `sources/菜单/` 现扫；而这份登记
 * 由那边「边界与原版的第一帧对得上」那条**从 Java 源码另算一遍**来对撞。
 */
export const MENU_SKELETON_TOP_DIRS: readonly string[] = ['菜单', 'scoll', '鼠标图', '物品']

/** 按需素材在 `public/` 下的目录名，也是它在 `dist/` 里的目录名。 */
export const MENU_DEFERRED_PUBLIC_DIR = 'menu-content'

/** 进主包的菜单素材在 `src/generated/assets/` 下的目录名。 */
export const MENU_BUNDLED_DIR = 'menu'

/**
 * 原版路径 → 逻辑 ID。入参是**以 `sources/菜单/` 开头的仓库相对路径**，
 * 正斜杠反斜杠都认 —— 跟 `battleAssetId` 同一个规矩，理由也同一个。
 *
 * **扩展名留在 ID 里**：原版取图时扩展名写死在拼接里（`Mouse` 拼
 * `"sources/菜单/鼠标图/"+i+".png"`），去掉它，ID 就不再是原版那条路径的函数了。
 *
 * **前缀对不上一律抛**，不猜：猜出来的 ID 要么查不到（还好），要么恰好撞上
 * 别的素材 —— 画错图，而且悄无声息。
 */
export function menuAssetId(menuPath: string): AssetId {
  return `${ID_PREFIX}${menuRelativePath(menuPath)}`
}

/** 同上，但返回**相对 `sources/菜单/` 的路径**（正斜杠）。 */
function menuRelativePath(menuPath: string): string {
  const normalized = normalizePath(menuPath)
  const prefix = `${MENU_ROOT}/`
  if (!normalized.startsWith(prefix)) {
    throw new Error(`菜单素材路径要以 ${prefix} 开头，收到的是 ${JSON.stringify(menuPath)}`)
  }
  return normalized.slice(prefix.length)
}

/**
 * 这个素材走按需加载吗？入参是**相对 `sources/菜单/` 的路径**。
 *
 * 名单记的是**进主包**的那几个目录，判的是**不在名单里**——跟战斗那边正好
 * 反过来，因为这里「共用」是少数、「各页自己的」是多数。取反的好处是
 * 明天多进来一个页面目录，它默认走按需，而不是默认挤进主包。
 *
 * 判第一段目录名**逐字相等**，不是 `startsWith`：后者会让将来一个叫
 * `菜单说明` 的目录悄悄跟着进主包。
 */
export function isDeferredMenuAsset(relative: string): boolean {
  const top = relative.split('/')[0]
  return top === undefined || !MENU_SKELETON_TOP_DIRS.includes(top)
}

/**
 * **同一张图躺在两处：谁指向谁（xl-9a6）。** 键与值都是相对 `sources/菜单/`
 * 的路径；键（别名）不出自己的产物，映射表里它的 ID 直接指向值那一张的产物。
 *
 * `装备/` 下这两张 1024×640 整屏背景是 `天书/`、`奇术/` 那两页背景的副本
 * （2026-09-09 实测 md5 相同，烘出来的 WebP 也逐字节相同），而原版
 * `src/menu/` 一处都不引用它们。分别烘就是 `public/menu-content/` 里白放
 * 1,456,534 B 的重复字节，入库产物同样多这么多。源素材**不删**：原版是冻结的
 * 规格（CLAUDE.md），看起来像脏数据的东西可能正是判据的夹具。
 *
 * ⚠️ `装备/物品.png` 看起来是同一种东西，但它**不是**任何一张的副本（与首页
 * 背景 `物品/物品3.png` 的 md5 不同），所以不在这里 —— 它照常烘一套产物。
 *
 * 这是一份**登记**，不是分母（dispatch.md 纪律 3）：按 md5 自动推「哪两张
 * 一样」等于让被守的东西自己签字，而且明天两张碰巧相同的小图标会被悄悄合并。
 * 形状照抄开始界面的 `START_SEQUENCE_ALIASES`（xl-l6h），重量同样在烘焙器那条
 * **落盘前的恒等判据**上：两边的源各做一次无损 WebP 编码逐字节比，不同就硬失败
 * —— 美术哪天只换掉其中一张，表现是「那一页的背景静静指到另一张图」，别的检查
 * 一条都拦不住。
 */
export const MENU_ASSET_ALIASES: Readonly<Record<string, string>> = {
  '装备/天书.png': '天书/天书.png',
  '装备/奇术.png': '奇术/奇术.png',
}

/**
 * 一个菜单素材的**产物相对路径**（相对各自的根：进主包的相对
 * `src/generated/assets/`，按需的相对 `public/`）。别名取被指向那一张的产物。
 *
 * 登记表做成参数（默认就是那份手签的），是为了让下面两条硬失败能拿造出来的
 * 登记表真红一次 —— 今天那份登记两条都不会触发。
 *
 * - **不许接力**（a → b → c）：b 的产物是不是 c 的，取决于读登记的人记不记得
 *   再查一跳，排错的那一头看到的是「查不到」。
 * - **不许跨包**：取图时进主包还是按需是按**别名自己的**路径判的
 *   （`isDeferredMenuAsset`），跨了包，ID 就落进另一边的名单，运行时查不到。
 */
export function menuProductPath(
  relative: string,
  aliases: Readonly<Record<string, string>> = MENU_ASSET_ALIASES,
): string {
  const target = aliases[relative]
  if (target !== undefined) {
    if (aliases[target] !== undefined) {
      throw new Error(`菜单素材别名 ${relative} → ${target}：${target} 自己也是别名，不许接力`)
    }
    if (isDeferredMenuAsset(relative) !== isDeferredMenuAsset(target)) {
      throw new Error(`菜单素材别名 ${relative} → ${target}：两张不在同一个包里`)
    }
    return menuProductPath(target, aliases)
  }
  const webp = relative.replace(/\.[^./]+$/, '.webp')
  return isDeferredMenuAsset(relative)
    ? `${MENU_DEFERRED_PUBLIC_DIR}/${webp}`
    : `${MENU_BUNDLED_DIR}/${webp}`
}

/**
 * 按需素材的运行时 URL。与 `deferredBattleUrl` 同形：`encodeURI` 是必须的，
 * 菜单产物路径几乎全是中文，没编码在部分环境下取不到，而取不到的表现是
 * 「这一页是空的」。
 */
export function deferredMenuUrl(base: string, productPath: string, version: string): string {
  const prefix = base.endsWith('/') ? base : `${base}/`
  return `${prefix}${encodeURI(productPath)}?v=${encodeURIComponent(version)}`
}

/** `menuContent.json` 的形状。 */
export interface DeferredMenuManifest {
  /** 产物字节的摘要（前 16 位十六进制）。换了素材就换一个 URL。 */
  readonly version: string
  /** 逻辑 ID → `public/` 下的产物相对路径。 */
  readonly files: Readonly<Record<AssetId, string>>
}
