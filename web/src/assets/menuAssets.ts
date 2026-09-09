import type { AssetId } from './ids'
import { normalizePath } from './path'

/**
 * 菜单素材的**打包边界**（xl-6lo.4）：哪些进主包、哪些按需加载，以及两边各自
 * 的产物落在哪。形状照抄 `battleAssets.ts`，**数字一个都没照抄** —— 票面明写
 * 「那批的读数不许照抄」，下面每一个字节数都是这一趟自己量的。
 *
 * ## 边界画在哪，为什么
 *
 * 判据是票面那一句：**「打开菜单的那一刻要不要全在手上」**。原版
 * `menu/FatherPanel.paint()` 逐字回答了这个问题 —— 它是四个页面**共用**的
 * 绘制入口：
 *
 *     bufferedGraphics.drawImage(backgroundImage, 0, 0, this);  // 各页自己的整屏背景
 *     drawSpecialImage(bufferedGraphics);                       // 各页自己的
 *     menuPanel.command.drawCommand(bufferedGraphics);          // sources/菜单/菜单/
 *     scoll.drawScoll(bufferedGraphics);                        // sources/菜单/scoll/
 *     drawThisPanel(bufferedGraphics);                          // 各页自己的
 *     mouse.drawMouse(bufferedGraphics);                        // sources/菜单/鼠标图/
 *
 * 也就是说 `菜单`（标题栏 + 四颗页签的三态）、`scoll`（卷轴 / 英雄 / 等级）、
 * `鼠标图` 这三个目录**每一页都要画**，其余四个目录（`天书` / `装备` /
 * `奇术` / `物品`）各自只服务一页。边界就画在这里，**不按体积切**。
 *
 * ⚠️ **票面预写的分组是「骨架 = 菜单 / 天书 / 鼠标图 / scoll」，实测把它推翻了，
 * 而推翻它的正是票面自己那句判据。** 两条读数：
 *
 * - `天书/天书.png` 是 `FuncPanel` 的整屏背景（1024×640），压缩后 **672,000 B**
 *   —— 它是「天书那一页的内容」，跟 `装备4.png` 是同一种东西，把它算进骨架，
 *   骨架里 46% 的字节服务的是四页里的一页。
 * - 而 `MenuPanel` 的构造函数末尾是 `currentPanel=thingPanel` —— **打开菜单
 *   看到的是物品页**，票面把物品整个划进了「按需」。照票面切，唯一必然要立刻
 *   画的那张背景反倒不在手上。
 *
 * ## 量出来的体积（cwebp 1.6.0，189 张全是 PNG 走 `-lossless`）
 *
 *   目录        张数   源字节      产物字节    压缩率
 *   菜单          13    100,970      58,402     57.8%
 *   scoll         22    632,817     473,598     74.8%
 *   鼠标图         8      6,990       3,066     43.9%
 *   ——— 骨架 43 张，合计 535,066 B（522.5 KiB）———
 *   天书          50  1,936,420     924,136     47.7%
 *   装备          28  6,494,859   3,051,006     47.0%
 *   奇术          64  1,915,814     999,132     52.2%
 *   物品           4  1,586,319     719,452     45.4%
 *   ——— 内容 146 张，合计 5,693,726 B（5.43 MiB）———
 *   总计         189 12,674,189   6,228,792     49.1%
 *
 * **压缩率与战斗那批不是一回事**：战斗那批 753 张背景动画是 JPG 走有损 q95，
 * 这里 189 张全是 PNG，`toWebp` 的 `-lossless` 分支，所以「49.1%」是无损重编码
 * 的读数，跟 xl-rh9.2 的任何一个百分比都不可比。
 *
 * ## 主包净涨多少
 *
 * 二进制两边都不进 JS —— 进主包的那批走 `resolve.ts` 那条 `?url` 的 **eager**
 * glob，进去的是**路径字符串**。所以「主包净涨」量的是 `dist/assets/index-*.js`：
 *
 *   构型                       index-*.js   对基线      gzip       对基线
 *   基线（菜单一张都不烘）       801.36 kB      —      215.32 kB      —
 *   189 张全进主包               825.59 kB  +24.23 kB  219.51 kB  +4.19 kB
 *   **骨架 43 张进主包**         808.42 kB  **+7.06 kB** 216.40 kB **+1.08 kB**
 *
 * 三行都是同一台机器上连着跑 `pnpm build` 读出来的（2026-09-08）。第二行的量法
 * 是把 `public/menu-content/` 那 146 个产物**原样拷进** `src/generated/assets/menu/`
 * 再 build ——`resolve.ts` 那条 glob 认的是目录不是名单，所以这一拷就等价于
 * 「边界画成 189 张全进主包」；量完删掉，`find … | wc -l` 从 189 回到 43。
 *
 * 也就是说这条边界买到的是 **17.17 kB**（gzip 3.11 kB）主包，外加 5.43 MiB
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
 * **每一页都要画**的那几个顶层目录 —— 也就是进主包的那批。名单是手写的
 * （dispatch.md 纪律 3 意义上的「登记」，不是「分母」）：它记的是
 * `FatherPanel.paint()` 里那三行共用绘制各自吃哪个目录，那是一个要人去读
 * 源码才答得出的问题，按体积或按目录名自动推等于让被守的东西自己签字。
 *
 * 分母那一半在 `menuAssets.test.ts` 里，从 `sources/菜单/` 现扫。
 */
export const MENU_SKELETON_TOP_DIRS: readonly string[] = ['菜单', 'scoll', '鼠标图']

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
 * 名单记的是**进主包**的那三个目录，判的是**不在名单里**——跟战斗那边正好
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
 * 一个菜单素材的**产物相对路径**（相对各自的根：进主包的相对
 * `src/generated/assets/`，按需的相对 `public/`）。
 */
export function menuProductPath(relative: string): string {
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
