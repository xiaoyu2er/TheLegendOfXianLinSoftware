import { DRUGS } from '../battle/drugs'
import { EQUIPMENT_LISTS } from '../menu/equipment'
import { SHOP_CATEGORIES } from './layout'
import { cursorRow, pressedLabels } from './step'
import { activePanel, currentHeld, currentRows } from './world'
import type { ShopWorld } from './types'

/**
 * 把商店世界快照成**行为真值那一行的形状**。字段名、字段个数、嵌套层级与
 * `tools/src/devtools/ShopDriver.snapshotState` 逐字对应，逐字段比对时
 * `toEqual` 直接就能对上。
 *
 * ## 这里**每一组都出**，与菜单那一份不同
 *
 * 菜单那边"没实现的组不在这里编占位值"，因为它那几组各自是一整块状态。
 * 商店这十组不是：`list` / `coins` / `pack` 这几组**开局的值就是对的**
 * （存货是掷出来的、金钱与背包是剧本铺的），错的只是"买卖之后它们该变而
 * 没变"。把它们从快照里拿掉的话，`shop-categories` 那三格（那条剧本一次都
 * 没买卖）就再也没人对了 —— 而那正是掷骰次数与顺序唯一的判据。
 *
 * 谁做完了、谁还欠着，由 `shopTrace.test.ts` 那张**按（字段组 × 剧本）的
 * 手写登记表**说，并与真值现出的那份分母对撞。
 */
export function snapshotShop(w: ShopWorld): Record<string, unknown> {
  const p = activePanel(w)
  const rows = currentRows(w)
  const held = currentHeld(w)
  const icon = iconRow(w)
  return {
    music: [...w.music],
    shop: w.active,
    // 药店没有分类栏，那一列是 `null`，不是"某个默认的分类"。
    category: p.kind === 'equipment' ? p.category : null,
    coins: w.coins,
    cursor: { x: p.currentX, y: p.currentY, row: cursorRow(w) },
    list: rows.map((r, i) => ({
      name: r.name,
      price: r.price,
      stock: r.stock,
      purchase: r.purchase,
      // 与店里那一列**逐下标**对齐 —— 原版的买卖就是按下标对的。
      held: held[i]!,
    })),
    icon: { row: icon, name: icon < 0 ? null : rows[icon]!.name },
    message: {
      message: p.message,
      plus: p.messagePlus,
      // 药店没有第三行（`ShopPanel` 没有 `messageremark` 这个字段）。
      remark: p.kind === 'equipment' ? p.messageRemark : null,
    },
    pressed: pressedLabels(w),
    pack: {
      drugs: DRUGS.map((d, i) => ({ name: d.name, count: w.pack.drugs[i]! })),
      equipment: Object.fromEntries(
        SHOP_CATEGORIES.map((slot) => [
          slot,
          EQUIPMENT_LISTS[slot].map((e, i) => ({
            name: e.name,
            count: w.pack.equipment[slot][i]!,
          })),
        ]),
      ),
    },
  }
}

/**
 * 图标框里那张图属于当前这一列的第几行 —— **首个 `picture` 相同的行**，
 * 没有就是 -1。
 *
 * 与原版逐字同形：它比的是 `Image` 对象，而 `ImageIcon` 按文件名缓存，
 * 所以共用同一张 png 的两行（头盔那两行）只认得出头一行。切分类之后上一件
 * 的图还挂在框里，于是这里返回 -1 —— 那正是 `shop-trade` 第 31 步的读数。
 */
function iconRow(w: ShopWorld): number {
  const shown = activePanel(w).iconPicture
  if (shown === null) return -1
  return currentRows(w).findIndex((r) => r.picture === shown)
}
