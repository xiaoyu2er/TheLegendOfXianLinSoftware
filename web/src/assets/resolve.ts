import manifest from '../generated/assets.json'
import deferredBgmIds from '../generated/deferredBgm.json'
import missingIds from '../generated/missingAssets.json'
import type { AssetId } from './ids'

/**
 * 逻辑 ID → 可以直接喂给加载器的 URL。
 *
 * 两层：`assets.json` 是烘焙期写的映射表（逻辑 ID → 产物相对路径），
 * 下面的 glob 把产物相对路径换成 Vite 处理过的最终 URL —— 带指纹、
 * 带 base 前缀，所以产物丢到任意子目录下都还能取到。
 *
 * `query: '?url'` 意味着**只拿 URL，不把二进制打进包里**：一张 2 MB 的
 * 大地图不会进 JS bundle，谁用谁去 fetch，这就是"按场景加载"。
 */
const FILES = import.meta.glob('../generated/assets/**/*', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const PREFIX = '../generated/assets/'

export function resolveAsset(id: AssetId): string {
  const relative = (manifest as Record<string, string>)[id]
  if (relative === undefined) {
    // 报同前缀的那几条，不是整张表：战斗素材进来之后表里有两千多条，全喷出来
    // 的报错没人读得完，而读不完的报错等于没有报错。
    const prefix = id.slice(0, id.indexOf(':') + 1)
    const siblings = Object.keys(manifest).filter((k) => k.startsWith(prefix))
    throw new Error(
      `映射表里没有资产 ${id}；同前缀的有 ${siblings.length} 条` +
        `（如 ${siblings.slice(0, 5).join('、') || '一条都没有'}），全表 ${Object.keys(manifest).length} 条。` +
        `新场景与新素材要先跑 pnpm bake；技能动画与背景动画不在这张表里，走 resolveDeferredBattleAsset。`,
    )
  }
  const url = FILES[PREFIX + relative]
  if (url === undefined) {
    // 映射表指向一个不存在的产物：多半是 assets.json 入了库而产物没有。
    throw new Error(`资产 ${id} 的映射表指向 ${relative}，但产物不存在；跑一次 pnpm bake。`)
  }
  return url
}

/**
 * 仓库里**确实没有**这份素材的逻辑 ID。烘焙期写出来（见 `scripts/bake.ts`），
 * 每一条都对应 `knownMissing.ts` 里一条挂着 bd issue 的记录。
 */
const MISSING = new Set(missingIds as string[])

/**
 * 同 `resolveAsset`，但**已知缺失的素材返回 `null`** 而不是抛。
 *
 * 为什么要有这个而不是"查不到就不画"：仓库里 28 帧 NPC 素材从未交付，原版
 * 在那几处画的是一个宽度 −1 的空壳，也就是什么都没画。Web 侧要复刻这件事，
 * 就得能表达"这里本来就没有图"。但它必须跟"烘焙漏了一帧"分得开 —— 后者
 * 表现成"某个 NPC 偶尔不见了"，是查不出来的那种错。所以放行的只有名单上的，
 * 名单外的照旧抛。
 */
export function resolveAssetOrNull(id: AssetId): string | null {
  if (MISSING.has(id)) return null
  return resolveAsset(id)
}

/**
 * **这一票故意还没转码**的背景音乐（烘焙期写出来，见 `scripts/bake.ts`）。
 * M1 之外的场景今天一个都走不到，96 个场景的 27 首曲子全部转码入库是 20 MB
 * 以上的产物。
 */
const DEFERRED_BGM = new Set(deferredBgmIds as string[])

/**
 * 同 `resolveAsset`，但**名单上那些还没转码的背景音乐返回 `null`**。
 *
 * 为什么不能"查不到就静音"：那样"这一票暂时不管"与"烘焙漏了一首"长得一模
 * 一样，而后者的表现只是某个场景没有音乐，没人看得出来。名单上的静音，
 * 名单外的照旧抛 —— 跟 `resolveAssetOrNull` 是同一个套路。
 */
export function resolveBgmOrNull(id: AssetId): string | null {
  if (DEFERRED_BGM.has(id)) return null
  return resolveAsset(id)
}

/** 映射表里已有的全部逻辑 ID，按字典序。诊断与测试用。 */
export function knownAssetIds(): AssetId[] {
  return Object.keys(manifest).sort()
}
