import type { World } from '../state/types'

/**
 * 游戏里菜单顶栏「当前任务:」画的那一句（xl-03x.10）。
 *
 * 原版 `Command.drawCommand()` 每画一帧现读 static 的 `Reader.task`；这一层它住在
 * 场景世界的 `readerStatics.task` 里（进场景时照 `Task` 段写，缺席时留着上一个场景的，
 * 见 `World.readerStatics`）。所以这里读场景那一侧，不读菜单世界 —— 菜单世界从开机
 * 活到关机，存一份就会在换场景之后过期。
 *
 * `null` 场景（还没开局）没有任务：原版那个 static 的初值就是 null，画成「无」。
 */
export function menuTaskOf(scene: { readonly world: World } | null): string | null {
  return scene?.world.readerStatics.task ?? null
}
