import { declareFake } from './fake'

/**
 * **假的钱包**（`shop.Money`）。归 xl-knp.1（M4 商店）。
 *
 * 原版是 `shop.Money` 那个 `static int coins=10000`，加减都走静态方法。
 *
 * 这一份假在哪：**初值是抄来的常量，而不是从存档里读的**。原版的 10000 是
 * 新游戏的初值，读档时会被 `SaveAndLoad` 覆盖 —— 存档那条路归 M5，商店那边
 * 怎么花钱归 xl-knp.1。战斗结算只需要"加得进去"，所以这里只把加法做对。
 *
 * `reduceCoins` **故意不做**：战斗结算不花钱，凭空补一个没人调的方法，等于
 * 给下一个人一个"看起来已经做完了"的假象。
 */
export const FAKE = declareFake('wallet')

/** `Money.coins` 的初值，原版写死的 10000。 */
const INITIAL_COINS = 10000

let coins = INITIAL_COINS

/** `Money.getCoins()`。 */
export function getCoins(): number {
  return coins
}

/** `Money.addCoins(addCoins)`。 */
export function addCoins(addCoins: number): void {
  coins = coins + addCoins
}

/** 回到初值。理由同 `resetDrugPack`。 */
export function resetWallet(): void {
  coins = INITIAL_COINS
}
