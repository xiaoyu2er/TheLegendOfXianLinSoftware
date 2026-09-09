import { deferredMenuUrl } from './menuAssets'
import type { DeferredMenuManifest } from './menuAssets'
import type { AssetId } from './ids'

/**
 * 按需加载那一半菜单素材的运行时入口（xl-6lo.4）。边界画在哪、为什么，
 * 见 `menuAssets.ts` 的头注。
 *
 * **这个模块里那句 import 必须是动态的。** 写成 `import manifest from
 * '../generated/menuContent.json'`，那张 146 条的名单就静态进了主包 ——
 * 二进制确实没进去，主包体积照样涨，而构建不会有任何提示。判据是
 * `menuAssets.test.ts` 里「主包不静态引用按需名单」那一条。
 *
 * 名单只加载一次，缓存的是 Promise 而不是结果 —— 并发的两次调用不会去
 * fetch 两遍。
 */

let manifestPromise: Promise<DeferredMenuManifest> | null = null

function loadManifest(): Promise<DeferredMenuManifest> {
  manifestPromise ??= import('../generated/menuContent.json').then(
    (m) => (m.default ?? m) as unknown as DeferredMenuManifest,
  )
  return manifestPromise
}

/** 测试用：把缓存清掉，让下一次调用重新加载名单。 */
export function resetDeferredMenuCache(): void {
  manifestPromise = null
}

/**
 * 一个按需菜单素材的 URL。
 *
 * **名单外的 ID 一律抛**，跟 `resolveAsset` 是同一个规矩：换成「查不到就不画」
 * 的话，一次真正的烘焙遗漏就表现成「那一页少了一颗按钮」，谁都看不出来。
 */
export async function resolveDeferredMenuAsset(id: AssetId): Promise<string> {
  const manifest = await loadManifest()
  const product = manifest.files[id]
  if (product === undefined) {
    throw new Error(
      `按需菜单素材名单里没有 ${id}（名单共 ${Object.keys(manifest.files).length} 条）；` +
        `每一页都要画的那批走 resolveAsset，新素材要先跑 pnpm bake。`,
    )
  }
  return deferredMenuUrl(import.meta.env.BASE_URL, product, manifest.version)
}

/** 名单里全部的逻辑 ID，按字典序。诊断与测试用。 */
export async function deferredMenuAssetIds(): Promise<AssetId[]> {
  return Object.keys((await loadManifest()).files).sort()
}
