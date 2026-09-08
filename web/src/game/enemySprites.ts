import { resolveAsset } from '../assets/resolve'
import { enemyWalkId } from '../battle/render/assets'
import { enemyNames } from '../state/fight'
import type { SceneScript } from '../data/types'

/**
 * 怪物**出场图的像素尺寸**，游戏本体这一侧的预取（xl-rh9.17）。
 *
 * 为什么非要预取：`EnemySlector` 的九个字段是拿这张图的宽高算出来的，而
 * `createBattle` 是**同步**的 —— 它发生在 `FightEvent.checkBattle0()` 数到
 * 门槛的那一拍里。原版不需要预取，因为 `Reader.readImage` 在 Java 里是同步
 * 读文件；浏览器里解一张图必须过一次异步。
 *
 * 所以这里走的是和出口预取（`data/loadedScenes.ts` 的 `prepareExits`）一模
 * 一样的路：**走到门口之前先把数据取到手**，取不到就停一拍。取图页那一侧
 * （`replay/main.ts` 的 `enemySpriteSizes`）做的是同一件事，只是它在 load
 * 那一步就知道要量谁。
 *
 * 量的是**真的图片**，不是任何一份真值 —— 从真值里读框、再拿它去比框，
 * 是一条恒真的检查（`battleTrace.test.ts` 那条注释）。
 */
const sizes = new Map<string, { width: number; height: number }>()

/** 这个场景可能打到的所有怪物名字（三个 battle 段的第 5/6/7 列）。 */
export function enemyNamesOf(scene: SceneScript): readonly string[] {
  const out = new Set<string>()
  // **三段都要扫**。大地图正是只有 `battle2`（选择式战斗，归 M4）的场景 ——
  // 只扫 0/1 的话它数出零只怪，而玩家随时会在那儿撞进一场。
  for (const list of [scene.battle0, scene.battle1, scene.battle2]) {
    for (const row of list ?? []) {
      for (const name of enemyNames(row)) out.add(name)
    }
  }
  return [...out]
}

export function spritesReady(names: readonly string[]): boolean {
  return names.every((name) => sizes.has(name))
}

/** 量还没量过的那些。**并发调用是安全的**：重复量一遍只是多解一次图。 */
export async function prepareEnemySprites(names: readonly string[]): Promise<void> {
  await Promise.all(
    names
      .filter((name) => !sizes.has(name))
      .map(async (name) => {
        const image = new Image()
        image.src = resolveAsset(enemyWalkId(name, 0))
        await image.decode()
        sizes.set(name, { width: image.naturalWidth, height: image.naturalHeight })
      }),
  )
}

/**
 * 量好的尺寸。**没量过就抛** —— 静默给一个默认值会让点击范围整个错位，
 * 而画面看着完全正常（`replay/main.ts` 里同一处的注释）。
 */
export function enemySpriteSize(name: string): { width: number; height: number } {
  const size = sizes.get(name)
  if (!size) {
    throw new Error(
      `还没量过怪物「${name}」的出场图尺寸 —— 起战斗之前要先 prepareEnemySprites()`,
    )
  }
  return size
}

/** 只给测试用：量出来的东西是模块级的，用例之间会互相污染。 */
export function resetEnemySprites(): void {
  sizes.clear()
}
