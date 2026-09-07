import { deferredBattleUrl } from './battleAssets'
import type { DeferredBattleManifest } from './battleAssets'
import type { AssetId } from './ids'

/**
 * 按需加载那一半战斗素材的运行时入口（xl-rh9.2）。边界画在哪、为什么，
 * 见 `battleAssets.ts` 的头注。
 *
 * **这个模块里那句 import 必须是动态的。** 写成 `import manifest from
 * '../generated/battleAnimations.json'`，那张 1770 条的名单就静态进了主包——
 * 主包体积照样涨，只是二进制没进去。判据是 `battleAssets.test.ts` 里
 * 「主包不静态引用按需名单」那一条：它扫 `src/` 的源码找静态 import。
 *
 * 名单只加载一次，缓存的是 Promise 而不是结果——并发的两次调用不会去 fetch
 * 两遍。
 */

let manifestPromise: Promise<DeferredBattleManifest> | null = null

function loadManifest(): Promise<DeferredBattleManifest> {
  manifestPromise ??= import('../generated/battleAnimations.json').then(
    (m) => (m.default ?? m) as unknown as DeferredBattleManifest,
  )
  return manifestPromise
}

/** 测试用：把缓存清掉，让下一次调用重新加载名单。 */
export function resetDeferredBattleCache(): void {
  manifestPromise = null
}

/**
 * 一个按需战斗素材的 URL。
 *
 * **名单外的 ID 一律抛**，跟 `resolveAsset` 是同一个规矩：换成"查不到就不画"
 * 的话，一次真正的烘焙遗漏就表现为"某个技能偶尔没有动画"，谁都看不出来。
 */
export async function resolveDeferredBattleAsset(id: AssetId): Promise<string> {
  const manifest = await loadManifest()
  const product = manifest.files[id]
  if (product === undefined) {
    throw new Error(
      `按需战斗素材名单里没有 ${id}（名单共 ${Object.keys(manifest.files).length} 条）；` +
        `常用素材走 resolveAsset，新素材要先跑 pnpm bake。`,
    )
  }
  return deferredBattleUrl(import.meta.env.BASE_URL, product, manifest.version)
}

/** 名单里全部的逻辑 ID，按字典序。诊断与测试用。 */
export async function deferredBattleAssetIds(): Promise<AssetId[]> {
  return Object.keys((await loadManifest()).files).sort()
}
