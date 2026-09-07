import type { AssetId } from './ids'
import { normalizePath } from './path'

/**
 * 战斗素材的**打包边界**（xl-rh9.2）：哪些进主包、哪些按需加载，以及两边各自
 * 的产物落在哪。
 *
 * 原版 `image/` 下是 2000 多个文件、60 多 MB，一次性全进主包会重演 M1 吃过的
 * 两次亏（96 份场景数据整个进主包；一张大地图无损编码 2.5 MB）。所以这里定一条
 * 边界，并且**边界本身是可测的**——判据见 `battleAssets.test.ts`。
 *
 * ## 边界画在哪，为什么
 *
 * 按**顶层目录**切，只切出去两个：`技能动画` 与 `背景动画`。理由是可数的
 * （分母现扫 `image/`，不写死）：
 *
 * - 这两个目录占了 `image/` 全部文件的四分之三、全部字节的三分之二；
 * - 它们是**逐帧动画**，一场战斗只会放到其中极少数几个技能的那几十帧，
 *   而其余目录（按钮、状态栏、怪物、背景图、菜单）是**每一场都要画**的；
 * - 它们也是唯一"按名字 + 帧号"取用的两类（`SkillAnimation` 与
 *   `BackgroundAnimation` 各自拼 `image/<目录>/<技能名>/<帧号>.<ext>`），
 *   所以运行时天然就是"用到哪个技能才去取哪一批"。
 *
 * 换句话说，切的不是"大的那些"，切的是**"这一场战斗多半一张都用不到"的那些**。
 *
 * ## 两边的产物为什么不放在一起
 *
 * 进主包的那批走 `src/generated/assets/`，由 `resolve.ts` 里那条 `?url` 的
 * **eager** glob 变成带指纹的 URL——和地图、NPC、头像走的是同一条路。
 *
 * 按需的那批**不能**走 glob，两种写法都不行，这是这条边界真正的技术理由：
 *
 * - `eager: true`：glob 会把每一个文件的 URL 字符串**塞进主包**。二进制确实
 *   没进去，但 1770 条路径字符串进去了——正是这张票要避免的那件事。
 * - `eager: false`：Vite 为**每一个**文件生成一个 `() => import('…?url')`，
 *   于是 1770 个几十字节的 chunk；而那张 `路径 → 加载函数` 的表本身还是在
 *   写下这条 glob 的模块里。
 *
 * 所以按需的那批落在 `public/` 下：Vite 原样拷贝，**不产生任何 JS 模块**。
 * 它们的 URL 由规则算出来（见 `deferredBattleUrl`），运行时只需要一张
 * `src/generated/battleAnimations.json` 名单，而那张名单是**动态 import** 的
 * （见 `deferredBattle.ts`），自己占一个 chunk，不进主包。
 *
 * 代价是 `public/` 下的文件名不带内容指纹，浏览器缓存不会自动失效。补法是
 * 名单里带一个 `version`（烘焙时按产物字节算），拼 URL 时作为查询串——
 * 换了素材就换一个 URL。
 */

/** 原版素材根目录，仓库相对。 */
export const IMAGE_ROOT = 'image'

/** 逻辑 ID 的前缀。`image/怪物/怪物1/5.png` → `battle:怪物/怪物1/5.png`。 */
const ID_PREFIX = 'battle:'

/**
 * 按需加载的顶层目录。**只有这两个**，其余一律进主包。
 *
 * 名单写在这里而不是从大小推导：按大小自动切会让"今天哪个目录大"决定打包
 * 结构，素材换一批边界就悄悄变了，而变了之后没有任何东西会响。
 */
export const DEFERRED_TOP_DIRS: readonly string[] = ['技能动画', '背景动画']

/** 按需素材在 `public/` 下的目录名，也是它在 `dist/` 里的目录名。 */
export const DEFERRED_PUBLIC_DIR = 'battle-anim'

/** 进主包的战斗素材在 `src/generated/assets/` 下的目录名。 */
export const BUNDLED_DIR = 'battle'

/**
 * 原版路径 → 逻辑 ID。入参是**以 `image/` 开头的仓库相对路径**，正斜杠反斜杠
 * 都认——脚本数据的 Fight 段里有 3 条 Windows 反斜杠路径（xl-1dv.4），
 * 它们正是这条规范化唯一的、现成的夹具。
 *
 * **扩展名留在 ID 里**，跟 `npcAssetId` 同一个考虑：`背景动画` 全是 `.jpg`、
 * 其余是 `.png`，而原版取图时扩展名是写死在拼接里的（`SkillAnimation` 拼
 * `.png`、`BackgroundAnimation` 拼 `.jpg`）。去掉扩展名，ID 就不再是原版那条
 * 路径的函数了。
 *
 * **前缀对不上一律抛**，不是"猜一个"：猜出来的 ID 要么查不到（还好），要么
 * 恰好撞上别的素材（画错图，而且悄无声息）。
 */
export function battleAssetId(imagePath: string): AssetId {
  return `${ID_PREFIX}${battleRelativePath(imagePath)}`
}

/** 同上，但返回**相对 `image/` 的路径**（正斜杠）。 */
function battleRelativePath(imagePath: string): string {
  const normalized = normalizePath(imagePath)
  const prefix = `${IMAGE_ROOT}/`
  if (!normalized.startsWith(prefix)) {
    throw new Error(`战斗素材路径要以 ${prefix} 开头，收到的是 ${JSON.stringify(imagePath)}`)
  }
  return normalized.slice(prefix.length)
}

/**
 * 这个素材走按需加载吗？入参是**相对 `image/` 的路径**。
 *
 * 判的是第一段目录名逐字相等，不是 `startsWith` ——后者会让将来某个叫
 * `技能动画说明` 的目录悄悄跟着被切出去。
 */
export function isDeferredBattleAsset(relative: string): boolean {
  const top = relative.split('/')[0]
  return top !== undefined && DEFERRED_TOP_DIRS.includes(top)
}

/**
 * 一个战斗素材的**产物相对路径**（相对各自的根：进主包的相对
 * `src/generated/assets/`，按需的相对 `public/`）。
 *
 * 源是 PNG 还是 JPG 都转成 `.webp`，所以这里换扩展名。目录结构原样保留：
 * 产物的 diff 要能一眼看出改的是哪个技能的第几帧。
 */
export function battleProductPath(relative: string): string {
  const webp = relative.replace(/\.[^./]+$/, '.webp')
  return isDeferredBattleAsset(relative)
    ? `${DEFERRED_PUBLIC_DIR}/${webp}`
    : `${BUNDLED_DIR}/${webp}`
}

/**
 * 按需素材的运行时 URL。
 *
 * `base` 传 `import.meta.env.BASE_URL`（本项目是 `./`，见 `vite.config.ts`）。
 * `encodeURI` 是必须的：产物路径几乎全是中文，直接拼进 `fetch` / `Image.src`
 * 在部分环境下取不到，而取不到的表现是"这个技能没有动画"——没人看得出来。
 */
export function deferredBattleUrl(base: string, productPath: string, version: string): string {
  const prefix = base.endsWith('/') ? base : `${base}/`
  return `${prefix}${encodeURI(productPath)}?v=${encodeURIComponent(version)}`
}

/** `battleAnimations.json` 的形状。 */
export interface DeferredBattleManifest {
  /** 产物字节的摘要（前 16 位十六进制）。换了素材就换一个 URL。 */
  readonly version: string
  /** 逻辑 ID → `public/` 下的产物相对路径。 */
  readonly files: Readonly<Record<AssetId, string>>
}
