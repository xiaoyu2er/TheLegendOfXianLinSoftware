import manifest from '../generated/assets.json'
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

/** 映射表里已有的全部逻辑 ID，按字典序。诊断与测试用。 */
export function knownAssetIds(): AssetId[] {
  return Object.keys(manifest).sort()
}
