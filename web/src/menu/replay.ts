import { readerStaticsFor } from '../data/readerStatics'
import { createMenuWorld } from './world'
import type { MenuConfig } from './world'
import type { MenuWorld } from './types'

/**
 * 照真值头部的**剧本回显**（`script.setup`）把菜单世界建出来。
 * **只读 `setup`，一个状态字段都不从真值里读。**
 *
 * 与 `battle/replay.ts` 同一个规矩、同一个理由：喂状态进去等于让真值给自己
 * 打分。`setup.drugs` 铺药品存货（物品页 xl-6lo.10 读它）、`setup.equipment`
 * 铺装备页的背包（xl-6lo.9 读它）—— 两列都有人逐步守着，所以两列都读。
 *
 * 为什么单开一个文件而不留在 `./trace.ts` 里：那个模块转手 `state/trace.ts`
 * 的 `node:fs`，进不了浏览器包，而取图页（`replay/main.ts`）正需要在浏览器
 * 里把同一件事做一遍（xl-6lo.14）。这个文件是**纯的** —— 不碰 `node:fs`，
 * 也不碰 DOM，于是 Node 上的 `menuTrace.test.ts` 与浏览器里的取图页读的是
 * 同一份实现。抄两份的表现是两端各自建出一个世界、逐帧比对却比得挺像，
 * 那是这条流水线最不能有的形状。
 */
export function replayMenuSetup(setup: MenuConfig): MenuWorld {
  // ⚠️ **四个字段是挑出来的，不是把 `setup` 整个转手。** `MenuConfig` 还有
  // `live`（队伍此刻的等级与血）与 `audio`（两个音频开关）—— 回放真值时那两样
  // **一个都不能喂**：它们是状态，喂进去等于让真值给自己打分。剧本里今天没有
  // 这两个键，所以整个转手今天结果相同；哪天剧本多写一个 `live`，整个转手会
  // 悄悄把它接上，而那正是这一层唯一要挡住的事。
  return createMenuWorld({
    party: setup.party,
    fullHeal: setup.fullHeal,
    drugs: setup.drugs,
    equipment: setup.equipment,
    // xl-03x.17：开局升级。导出器调原版 `levelUp()`，这边调 `levelUpMenuHero`。
    levelUps: setup.levelUps,
  })
}

/**
 * 顶栏「当前任务:」那一句（`Reader.task`），照剧本回显的 `setup.scene` 推（xl-03x.10）。
 *
 * 它不是菜单世界的状态：原版 `Command.drawCommand()` 画的时候现读那个 static，
 * 而那个 static 只有进场景的 `new Reader(...)` 会写。导出器给了 `setup.scene` 就
 * 在一个干净 JVM 里读那一本，所以这里是「那一本的 `Task` 段，没有就 null」——
 * **不是**「没有就留着上一个场景的」，干净 JVM 里没有上一个场景。
 * 没给 `setup.scene` = 一个场景都没进过 = null。
 *
 * 游戏里不走这里：会话那一侧喂的是场景世界的 `readerStatics.task`（`game/menuTask.ts`）。
 */
export function replayMenuTask(setup: { readonly scene?: string | undefined }): string | null {
  return setup.scene === undefined ? null : readerStaticsFor(setup.scene).task
}
