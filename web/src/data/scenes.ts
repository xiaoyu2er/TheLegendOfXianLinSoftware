import type { SceneScript } from './types'

/**
 * 已烘焙场景的注册表。内容来自 `src/generated/scenes/`，由 `pnpm bake` 生成、
 * 入库；glob 的名单是构建期静态展开的，所以往烘焙清单里加一个场景，这里自动
 * 就有了，不需要再手抄一份名单（名单抄两份，迟早会对不上）。
 *
 * ## 为什么是按需加载（`loadScene` 是异步的）
 *
 * 这个 glob **不是 eager 的**：eager 会把 96 份 JSON 整个塞进主 chunk，而其中
 * 89.9% 是碰撞网格（`mapSet`），玩家一次只可能站在一个场景里。实测（xl-9bd.15，
 * 手法是把 MODULES 换成 `{}` 再 `pnpm build`，两次产物相减）：
 *
 *     eager：index chunk 1227.30 kB / gzip 340.60 kB
 *     去掉场景 JSON：        629.74 kB / gzip 254.79 kB
 *     即场景 JSON 占       597.56 kB / gzip  85.81 kB —— 主 chunk 的一半 / 四分之一
 *
 * 而且这个数随烘焙的场景数线性长。地图图片早就没有这个问题（`resolveAsset`
 * 走 `?url`，谁用谁 fetch），场景 JSON 现在跟它一致：一个场景一个 chunk。
 *
 * 代价是取场景变成了异步。这条边界本来就在：渲染器的 `showScene` 一直是异步的，
 * 舞台上也一直有"正在载入 X"的状态。
 *
 * JSON 只有形状没有类型，这里断言成 `SceneScript`。这个断言不是空口无凭：
 * `src/data/scenes.test.ts` 会拿脚本源文件现场重烘一遍来对，
 * 而烘焙器本身对着冻结真值有黄金测试。
 */
const LOADERS: Record<string, () => Promise<SceneScript>> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../generated/scenes/*.json', { import: 'default' }) as Record<
      string,
      () => Promise<SceneScript>
    >,
  ).map(([path, load]) => [sceneNameFromPath(path), load]),
)

/**
 * 游戏的起点。原版 `ScenePanel` 的构造函数里
 * `currentScript[1] = "宿舍.txt"` —— 打开就是宿舍。
 */
export const START_SCENE = '宿舍'

/** 已烘焙的场景名，字典序。名单是静态的，不用等任何一份 JSON 到位。 */
export const SCENE_NAMES: readonly string[] = Object.keys(LOADERS).sort()

/**
 * 缓存的是 **Promise 而不是结果**：同一个场景通常被两个调用方（渲染器和
 * `useGame`）在同一帧里同时要，缓存结果会让两边各发一次请求。
 */
const PENDING = new Map<string, Promise<SceneScript>>()

/** 取一个场景，没加载过就现取。同一个名字并发调用只会取一次。 */
export function loadScene(name: string): Promise<SceneScript> {
  const cached = PENDING.get(name)
  if (cached) return cached
  const load = LOADERS[name]
  if (!load) return Promise.reject(new Error(missingSceneMessage(name)))
  const pending = load().catch((error: unknown) => {
    // 失败不留缓存，否则一次网络抖动就把这个场景永久钉死在错误上。
    PENDING.delete(name)
    throw error
  })
  PENDING.set(name, pending)
  return pending
}

export function missingSceneMessage(name: string): string {
  // 96 个名字全列出来是一堵墙，不是信息。说清楚"有多少、在哪儿看"就够了。
  return `没有烘焙过的场景 ${name}；已烘焙 ${SCENE_NAMES.length} 个，见 src/generated/scenes/。`
}

export function sceneNameFromPath(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.json$/, '')
}
