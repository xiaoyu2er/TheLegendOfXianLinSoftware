import type { SceneSource } from '../state/step'
import type { World } from '../state/types'
import { loadScene, sceneNameFromPath } from './scenes'
import type { SceneScript } from './types'

/**
 * 已经取到手的场景，**同步查得到**。
 *
 * 为什么需要它：出口切换是同步的（`state/step.ts` 的 `SceneSource`——原版的
 * `initiation` 就在 `step()` 里同步跑完），而场景 JSON 是按需取的
 * （`data/scenes.ts`，xl-9bd.15）。中间这一层就是"先把邻居取到手，走到门口
 * 才切得动"。
 *
 * 这不是把按需加载撤销：取的只有**当前场景那几个出口的目标**，不是 96 个。
 * 从宿舍出发是 1 个（大地图），进了大地图是 10 个。
 */
const LOADED = new Map<string, SceneScript>()

/** 已经取到手的那些，同步查。键是脚本文件名（`大地图.txt`）。 */
export const loadedSceneSource: SceneSource = (file) => LOADED.get(stem(file))

/**
 * 踩上出口那一刻可能进的**全部**场景，不只是 `nextScene` 那几条。
 *
 * `state/step.ts` 的 `applyExit` 有三条分支，进的分别是 `nextScene[i]`、
 * `nextScript[2]` 与 `currentScript[2]` —— 后两条是剧情往前走/走回同一段剧情
 * 那两支，**目标场景名压根不在出口表里**。少预取它们的表现是：走出宿舍的门
 * 时 `step()` 抛"这个场景没准备好"，而在 xl-9bd.13 之前一直没人撞上，因为
 * 已有的剧本里那个目标恰好是预热脚本、早就在手上了（dorm-exit 走回的 脚本1）。
 */
function exitTargets(world: World): string[] {
  const targets = [...(world.exit?.nextScene ?? [])]
  for (const spec of [world.currentScript, world.nextScript]) {
    const file = spec?.[2]
    if (file !== undefined) targets.push(file)
  }
  return targets
}

/**
 * 这个世界当前场景的出口目标是不是都到手了。
 *
 * 96 个场景里有 92 个有出口，`nextScene` 里有 9 条**指向根本不是脚本文件的
 * 东西**（`assets/knownMissing.ts` 的 xl-1dv.11/12/13）。那几条永远取不到，
 * 所以这里的判据是"每一个目标都试过了"，不是"每一个目标都在手上"——否则
 * 那几个场景会永远卡在"等邻居"上。
 */
export function exitsReady(world: World): boolean {
  return exitTargets(world).every((file) => LOADED.has(stem(file)) || TRIED.has(stem(file)))
}

/** 试过、但取不到的（数据里那 9 条坏路径）。 */
const TRIED = new Set<string>()

/**
 * 把这个世界当前场景的出口目标都取到手。多次调用是幂等的
 * （`loadScene` 自己按名字缓存 Promise）。
 *
 * 取不到的不抛：那 9 条坏路径是**数据的一部分**，进那几个场景不该开不了游戏。
 * 真的走到那种出口上时，`step()` 会抛一句说清楚是哪个出口要进哪个场景——
 * 失败留在踩上去的那一刻，而不是提前变成"这个场景进不去"。
 */
export async function prepareExits(world: World): Promise<void> {
  const targets = exitTargets(world)
  await Promise.all(
    targets.map(async (file) => {
      const name = stem(file)
      if (LOADED.has(name) || TRIED.has(name)) return
      try {
        LOADED.set(name, await loadScene(name))
      } catch {
        TRIED.add(name)
      }
    }),
  )
}

/** 把一份已经取到手的场景放进来（进场那一份不走出口，得有人塞）。 */
export function rememberScene(name: string, scene: SceneScript): void {
  LOADED.set(name, scene)
}

/** `大地图.txt` → `大地图`。注册表用的是场景名，出口写的是文件名。 */
function stem(file: string): string {
  return sceneNameFromPath(file).replace(/\.txt$/, '')
}
