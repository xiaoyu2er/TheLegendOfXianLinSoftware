import { addDrug } from '../fakes/drugPack'
import { addCoins, reduceCoins } from '../fakes/wallet'
import type { SceneRequests } from '../state/types'

/**
 * 场景请求里**记账的那几类**（xl-03x.3）。其余几类（`battleRequest` /
 * `selectPanelRequest` / `endRequest`）是切面板，只归会话层 —— 分工的判据在
 * `sceneLedger.test.ts`，给 `SceneRequests` 加一类而没在那里归队就红。
 */
export const LEDGER_REQUESTS = ['presentRequest', 'treasureRequest'] as const satisfies readonly (keyof SceneRequests)[]

/**
 * 把这一拍场景提出的**记账请求**落到钱包与药包上 —— 原版在按键分发里与
 * `drawString` 同一拍做的两句：
 *
 * - `SelectEvent.keyPressed` 的 `Money.addCoins(i)` / `Money.reduceCoins(i)`（答对 / 答错，xl-yg6.9）；
 * - `TreasureBox.keyPressed` 的 `DrugPack.addDrug(treasureName, i)`（开箱，xl-yg6.10）。
 *
 * **会话层（`game/session.ts`）与取图页（`replay/main.ts`）共用这一段**。取图页从前
 * 只推 `step()`、不走会话层，于是这两笔账在跨端逐帧比对里整层看不见：答完题金币 HUD
 * 一直画 10000。这里只抽记账这一小段 —— 切面板、存档与逐帧比对无关，不拖进取图页。
 *
 * 请求只亮一拍（`state/loop.ts` 在亮的那一拍停批），所以**每一拍调一次、只调一次**：
 * 同一个世界结算两遍就是记了两遍账。
 */
export function settleSceneRequests(world: Pick<SceneRequests, (typeof LEDGER_REQUESTS)[number]>): void {
  const present = world.presentRequest
  if (present !== null) {
    if (present.correct) addCoins(present.coins)
    else reduceCoins(present.coins)
  }
  for (const got of world.treasureRequest ?? []) addDrug(got.name, got.count)
}
