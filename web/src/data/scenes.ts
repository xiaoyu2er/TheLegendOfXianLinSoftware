import type { SceneScript } from './types'

/**
 * 已烘焙场景的注册表。内容来自 `src/generated/scenes/`，由 `pnpm bake` 生成、
 * 入库；glob 是 eager 的，所以往烘焙清单里加一个场景，这里自动就有了，
 * 不需要再手抄一份名单（名单抄两份，迟早会对不上）。
 *
 * JSON 只有形状没有类型，这里断言成 `SceneScript`。这个断言不是空口无凭：
 * `src/data/scenes.test.ts` 会拿脚本源文件现场重烘一遍来对，
 * 而烘焙器本身对着冻结真值有黄金测试。
 */
const MODULES = import.meta.glob('../generated/scenes/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, SceneScript>

const SCENES: Record<string, SceneScript> = Object.fromEntries(
  Object.entries(MODULES).map(([path, scene]) => [sceneNameFromPath(path), scene]),
)

/**
 * 游戏的起点。原版 `ScenePanel` 的构造函数里
 * `currentScript[1] = "宿舍.txt"` —— 打开就是宿舍。
 */
export const START_SCENE = '宿舍'

/** 已烘焙的场景名，字典序。 */
export const SCENE_NAMES: readonly string[] = Object.keys(SCENES).sort()

export function getScene(name: string): SceneScript {
  const scene = SCENES[name]
  if (!scene) {
    throw new Error(`没有烘焙过的场景 ${name}；已有 ${SCENE_NAMES.join('、')}。`)
  }
  return scene
}

function sceneNameFromPath(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.json$/, '')
}
