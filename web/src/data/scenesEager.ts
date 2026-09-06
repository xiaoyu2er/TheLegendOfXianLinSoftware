import type { SceneScript } from './types'
import { missingSceneMessage, sceneNameFromPath } from './scenes'

/**
 * 同一批烘焙产物的**同步**取法，一次性全读进来。
 *
 * ⚠️ **只给测试与 `scripts/` 下的 node 工具用。应用代码一律用
 * `scenes.ts` 的 `loadScene`** —— 这里的 glob 是 eager 的，谁 import 它谁就把
 * 96 份场景 JSON（约 gzip 86 kB，见 `scenes.ts` 的实测）拖进自己的 chunk，
 * 而这正是 xl-9bd.15 要去掉的东西。这条纪律由 `scenes.test.ts` 里
 * "谁在 import 这个模块"那条用例守着 —— 它数的是导入方的名单，不是"没找到问题"。
 *
 * 测试要同步是有道理的：`viewport.test.ts` 这类用例在循环和 `reduce` 里反复取
 * 场景，为了 96 份 JSON 的打包形态把它们改成异步，是让被测代码之外的东西
 * 决定测试怎么写。
 */
const MODULES = import.meta.glob('../generated/scenes/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, SceneScript>

const SCENES: Record<string, SceneScript> = Object.fromEntries(
  Object.entries(MODULES).map(([path, scene]) => [sceneNameFromPath(path), scene]),
)

export function getScene(name: string): SceneScript {
  const scene = SCENES[name]
  if (!scene) throw new Error(missingSceneMessage(name))
  return scene
}
