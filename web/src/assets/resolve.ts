import manifest from '../generated/assets.json'
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
    throw new Error(
      `映射表里没有资产 ${id}；已有 ${Object.keys(manifest).join(', ')}。` +
        `新场景要先跑 pnpm bake。`,
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

/** 映射表里已有的全部逻辑 ID，按字典序。诊断与测试用。 */
export function knownAssetIds(): AssetId[] {
  return Object.keys(manifest).sort()
}
