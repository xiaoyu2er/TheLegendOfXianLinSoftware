import { declareFake } from './fake'

/**
 * **假的钱包**（`shop.Money`）。归 xl-knp.1（M4 商店）。
 *
 * 原版是 `shop.Money` 那个 `static int coins=10000`，加减都走静态方法。
 *
 * 这一份假在哪：**初值是抄来的常量，而不是从存档里读的**。原版的 10000 是
 * 新游戏的初值，读档时会被 `SaveAndLoad` 覆盖 —— 存档那条路归 M6，商店那边
 * 怎么花钱归 xl-knp.1。
 *
 * `reduceCoins` 起先故意没做（那时没人调它）。答错扣钱是它的第一个调用方
 * （xl-yg6.9，`game/session.ts` 消费 `World.presentRequest`），于是补上。
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

/** `Money.reduceCoins(reduceCoins)`。**不夹 0**：原版就是减成负数也照减。 */
export function reduceCoins(reduceCoins: number): void {
  coins = coins - reduceCoins
}

/**
 * `Money.setCoins(coins)`。唯一的调用方是读档（`ShopPanel.initialShopInfo` 末句，xl-i06.10）。
 */
export function setCoins(value: number): void {
  coins = value
}

/** 回到初值。理由同 `resetDrugPack`。 */
export function resetWallet(): void {
  coins = INITIAL_COINS
}
