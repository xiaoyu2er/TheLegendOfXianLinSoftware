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
  return createMenuWorld({
    party: setup.party,
    fullHeal: setup.fullHeal,
    drugs: setup.drugs,
    equipment: setup.equipment,
  })
}
