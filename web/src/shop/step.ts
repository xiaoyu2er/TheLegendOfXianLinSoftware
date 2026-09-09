import { DRUGS } from '../battle/drugs'
import { clickedLabels, moveInButton, pressButton, releaseButton } from './buttons'
import type { ShopButtonLabel, ShopButtonState } from './buttons'
import { rowAt } from './layout'
import type { ShopKind } from './layout'
import type { EquipSlot } from '../menu/equipment'
import { activePanel, currentRows, stepBase, stepButtons } from './world'
import type { DrugShopState, EquipShopState, ShopPanelState, ShopWorld } from './types'

/**
 * 推进商店一步。**一步 = 一次输入事件**，与菜单同一个口径
 * （`tools/src/devtools/ShopDriver.step()`）。
 *
 * 与菜单不同的是**商店没有时钟那一支**：两个面板里那条 `while(true)` 线程只
 * 换鼠标图与四条人物动画的帧，一个真值记着的字段都不碰，而导出真值时它被
 * `Clock.setFactor(1e-9)` 冻在第一帧上。所以真值里的 `input` 只有鼠标三种
 * （外加 `open` 那一种空输入，见下）。web 侧要让动画动起来，用的是这里第五
 * 种输入 `anim` —— **真值里没有它**，与菜单的 `wheel` 同一个道理。
 *
 * ## 原版的 `paint()` 在这里没有对应物，这是量过的
 *
 * `MenuDriver` 每一步末尾都要 `paint()` 一次，因为 `FatherPanel.paint()` 真的
 * 改状态（装备页那两个旗标、奇术页的按钮 `isDraw`）。商店两个面板的
 * `paint()` / `drawIcon()` 从头到尾只有 `g.drawImage` 与 `g.drawString`，
 * **一句赋值都没有**（`src/shop/ShopPanel.java`、`EquipmentShopPanel.java`）。
 * 所以这一层不需要"画一次"这一步。⚠️ 这不是"大概不影响"：哪天有人往
 * `drawIcon` 里加了赋值，这句话就不成立了 —— 而它的表现是某一列安静地慢一拍。
 */

/** 真值 `input` 那一列的条目，外加两种真值里没有的。 */
export type ShopInput =
  | {
      readonly e: 'press' | 'release' | 'move'
      readonly x: number
      readonly y: number
      readonly target?: string
    }
  /**
   * 换一家店。**真值里这一步的 `input` 是空数组** —— 原版是靠场景里的选择
   * 事件 `GameLauncher.switchTo` 进店的，面板自己收不到任何鼠标事件
   * （`ShopDriver.open()`）。回放时它由剧本的 `open` 指令还原，见
   * `replay.ts` 的 `shopInputsOfTicks`。
   */
  | { readonly e: 'open'; readonly shop: ShopKind }
  /**
   * 鼠标图与四条人物动画往前走一格（那条 `while(true)` 线程的循环体）。
   * **真值里没有它** —— 导出时那条线程被冻在第一帧上。
   */
  | { readonly e: 'anim' }

export function stepShop(w: ShopWorld, inputs: readonly ShopInput[] = []): ShopWorld {
  // 音效是**这一步**的（`MusicTap` 每步取走一次），所以每步开头清空。
  w.music = []
  for (const input of inputs) applyShopInput(w, input)
  w.tick++
  return w
}

export function applyShopInput(w: ShopWorld, input: ShopInput): void {
  switch (input.e) {
    case 'open':
      w.active = input.shop
      return
    case 'press':
      shopMousePressed(w, input.x, input.y)
      return
    case 'release':
      shopMouseReleased(w, input.x, input.y)
      return
    case 'move':
      shopMouseMoved(w, input.x, input.y)
      return
    case 'anim':
      // 帧号今天不在状态层里 —— 绘制层自己数（`render/drawList.ts` 的
      // `frame` 参数）。留着这一支是为了让"输入的种类"在一处说全。
      return
  }
}

/** `mousePressed`：记下落点，逐颗按钮走 `isPressedButton`。 */
function shopMousePressed(w: ShopWorld, x: number, y: number): void {
  const p = activePanel(w)
  p.currentX = x
  p.currentY = y
  for (const b of p.buttons) pressButton(b, x, y)
}

/** `mouseReleased`：记下落点，然后 `setButton()`。 */
function shopMouseReleased(w: ShopWorld, x: number, y: number): void {
  const p = activePanel(w)
  p.currentX = x
  p.currentY = y
  setButton(w)
}

/** `mouseMoved`：记下落点，逐颗按钮走 `isMoveIn`，再走面板自己的 `isMoveIn()`。 */
function shopMouseMoved(w: ShopWorld, x: number, y: number): void {
  const p = activePanel(w)
  p.currentX = x
  p.currentY = y
  for (const b of p.buttons) moveInButton(b, x, y)
  panelMoveIn(w)
}

/**
 * 两个面板那个私有的 `isMoveIn()`。
 *
 * 它做两件事：换图标框里那张图，以及换店主说的那两三行话。
 *
 * 图标框那一半是骨架做的（xl-knp.6）；店主对白**按店分**：药店那两行
 * 在这里（xl-knp.7），装备店那三行归 xl-knp.8 —— 它往下面那个 `if`
 * 旁边**加**自己那一支就是了，不必重排。
 */
function panelMoveIn(w: ShopWorld): void {
  const p = activePanel(w)
  const rows = currentRows(w)
  const row = rowAt(p.currentX, p.currentY, rows.length)
  if (row < 0) return
  p.iconPicture = rows[row]!.picture
  if (p.kind === 'drug') drugHoverMessage(p, row)
  // xl-knp.8 在这里加装备店那一支（messagePlus 三档 + messageRemark 四档）。
}

/**
 * 药店的 `isMoveIn()` 里那两句赋值（`src/shop/ShopPanel.java`）：
 *
 *     message="Hp恢复"+getAddHp()+", Mp恢复"+getAddMp();
 *     if(getReduceMoney()>=6000) messageplus="药是好药，但是好像有点贵呢";
 *     else                       messageplus="物美价廉，呵呵";
 *
 * ⚠️ **逗号后面那个空格与「Mp」的大小写都进真值**，差一个字符就红。
 * 分档的阈值与两句话都由 `drugShop.test.ts` 从 GBK 源码里现读，不手写。
 *
 * 回血回蓝那两个数不在 {@link ShopRow} 上 —— 店里那一列与 {@link DRUGS}
 * **逐下标对齐**（`world.ts` 的 `drugRows` 就是照它建的），所以按下标取。
 */
function drugHoverMessage(p: DrugShopState, row: number): void {
  const drug = DRUGS[row]!
  p.message = `Hp恢复${drug.addHp}, Mp恢复${drug.addMp}`
  p.messagePlus =
    p.rows[row]!.price >= DRUG_EXPENSIVE_FROM ? '药是好药，但是好像有点贵呢' : '物美价廉，呵呵'
}

/**
 * `if(drugList.get(i).getReduceMoney()>=6000)` —— 药店店主对白唯一的那道坎。
 *
 * ⚠️ **导出它是为了让它可测**：`drug.txt` 里没有一件药的价钱落在 5000 与
 * 6000 之间，所以把这个数改成 5000 之后**分档的结果一个字都不变** ——
 * 篡改矩阵实测那一条是绿的。`drugShop.test.ts` 因此直接拿它与 GBK 源码里
 * 现读的那个数对，而不是只对分档的结果。
 */
export const DRUG_EXPENSIVE_FROM = 6000

/**
 * `setButton()` —— 松开鼠标之后按"哪几颗按钮还挂着 `isclicked`"派活。
 *
 * ⚠️ **分支顺序是原版的顺序，不是我排的**，而且它们**不是 else-if**：
 * 两颗按钮同时 `isclicked` 时两件事都会发生。装备店的分类切换排在最前，
 * 于是它重建过的加减按钮表，后面那个加减循环再也点不着 —— 照抄。
 *
 * ⚠️ 末尾那句"逐颗 `isRelesedButton`"必须在最后：真值 `pressed` 那一列是在
 * 这之后抓的，所以松开那一步永远是空数组。少了它，`isclicked` 会一直挂着，
 * 下一次松开鼠标会把这一颗再触发一遍。
 */
function setButton(w: ShopWorld): void {
  const p = activePanel(w)
  if (p.kind === 'equipment') setEquipCategory(w, p)
  buySellButtons(w)
  if (clicked(p.buttons, 'back')) {
    w.music.push('换头像.wav')
    // 原版这里是 `GameLauncher.switchTo("scene")` —— 面板自己不知道要去哪，
    // 换面板是外面那一层的事。浏览器里同理，会话侧接它（xl-yg6.2）。
    w.leaving = true
  }
  // ⚠️ 加减在 `back` **之后**，不是和买卖挤在一起（原版两个面板都是）。
  stepPurchaseButtons(w)
  for (const b of p.buttons) releaseButton(b, p.currentX, p.currentY)
}

/**
 * 六颗分类按钮。原版那六个 `if` 的**次序是 weapon / armor / helmet / shoe /
 * decoration / glove**（与按钮表的次序不同，也与 `SHOP_CATEGORIES` 不同），
 * 每一支都是同样的三句：出声、换 `equipment`、**把第 9 颗起的加减按钮整段
 * 删掉再按新一栏重建**。
 *
 * 今天观测不出次序的差别（六颗互不重叠，一次最多一颗 `isclicked`），但它们
 * 是六个独立的 `if`，真有两颗同时挂着时次序就是结果。照抄。
 */
const CATEGORY_BRANCH_ORDER: readonly EquipSlot[] = [
  'weapon',
  'armor',
  'helmet',
  'shoe',
  'decoration',
  'glove',
]

function setEquipCategory(w: ShopWorld, p: EquipShopState): void {
  for (const category of CATEGORY_BRANCH_ORDER) {
    if (!clicked(p.buttons, `category:${category}`)) continue
    w.music.push('换list.wav')
    p.category = category
    // `for(int i=buttonList.size()-1;i>=9;i--) buttonList.remove(...)` 然后
    // `setList()`。新建出来的按钮 `isclicked` 全是 false —— 下面那个加减循环
    // 因此在切栏那一步什么都点不着。
    p.buttons.length = stepBase('equipment')
    p.buttons.push(...stepButtons(p.rows[category].length))
  }
}

/**
 * `for(int i=0;i<6;i++)` —— 药店那三个买卖循环的上界是**字面量 6**，不是
 * `drugList.size()`。今天两者相等（`drug.txt` 六行），但抄成 `.length` 的话
 * 数据多一行时这里会安静地跟着变，而原版不会。
 *
 * ⚠️ **导出它的理由与 {@link DRUG_EXPENSIVE_FROM} 一样**：`drugShop.test.ts`
 * 从 GBK 源码里现读那个 6，如果只把它对到 {@link DRUGS} 的行数，这里改成 5
 * 时那一条仍然是绿的 —— 判据必须对到**这个常量本身**。
 */
export const DRUG_TRADE_ROWS = 6

/**
 * 买 / 卖。**这一票只做药店**（xl-knp.7）；装备店归 xl-knp.8 —— 它往下面
 * 那个 `if (p.kind !== 'drug') return` 旁边加自己那一支。
 *
 * 空着而不是抛：真值要从头跑到尾。抛的话整条剧本一步都跑不动，于是"这几组
 * 还没做"会伪装成"这一层崩了"，而 `shopTrace.test.ts` 反方向那半边判据
 * （登记成"还欠着"的格子必须**真的**还没对上）就再也跑不到了。
 *
 * ⚠️ **`buy` 在 `sell` 前面**，而药店的按钮表是 `buy` / `sell`、装备店是
 * `sell` / `buy` —— 分支的先后与按钮表的次序**不是同一件事**，两边的
 * `setButton()` 都是先 `buy` 后 `sell`。
 */
function buySellButtons(w: ShopWorld): void {
  const p = activePanel(w)
  // xl-knp.8：把这一句换成按 kind 分派，装备店那一支照 `EquipmentShopPanel`。
  if (p.kind !== 'drug') return
  if (clicked(p.buttons, 'buy')) drugBuy(w, p)
  if (clicked(p.buttons, 'sell')) drugSell(w, p)
}

/**
 * 药店的买入。逐行 `temp=Math.min(要几件, 店里还剩几件)`，先**整单成交**，
 * 再看钱够不够；不够就整单退回来，并换掉店主那两行话。
 *
 * ⚠️ 三处照抄，每一处都反直觉：
 *
 * 1. **`Money.getCoins()<0` 是严格小于**：钱正好花光（`coins==0`）算买得起。
 * 2. **退回来那个循环里 `temp` 是重算的，而 `stock` 已经被上面那个循环减过了**
 *    （`Math.min(purchase, number)`，`number` 是新的）。买的件数没超过原存货
 *    的一半时两次算出来一样、退得干净；超过一半就**退不干净** —— 原版缺陷，
 *    照抄（ADR-0001）。今天三条真值都没走到那一路。
 * 3. **`purchase` 的清零在最外面**，买成了没成都清。
 *
 * 「钱不够时钱与背包一个数都不动」这件事因此是**买了再退**得到的，不是
 * 先检查后扣钱 —— 两者在真值上分得开：中间那一刻没人观测，但第 2 条的
 * 退不干净只有前一种写法才会发生。
 */
function drugBuy(w: ShopWorld, p: DrugShopState): void {
  w.music.push('Clip986.wav')
  for (let i = 0; i < DRUG_TRADE_ROWS; i++) {
    const row = p.rows[i]!
    const temp = Math.min(row.purchase, row.stock)
    w.pack.drugs[i]! += temp
    w.coins -= row.price * temp
    row.stock -= temp
  }
  if (w.coins < 0) {
    for (let i = 0; i < DRUG_TRADE_ROWS; i++) {
      const row = p.rows[i]!
      const temp = Math.min(row.purchase, row.stock)
      w.pack.drugs[i]! -= temp
      w.coins += row.price * temp
      row.stock += temp
    }
    p.message = '哎呀,小兄弟,你的钱不顾了,要省着点花啊'
    p.messagePlus = null
  }
  for (let i = 0; i < DRUG_TRADE_ROWS; i++) p.rows[i]!.purchase = 0
}

/**
 * 药店的卖出。`temp=Math.min(要几件, 背包里有几件)`，钱**加上同一个单价**
 * —— 卖价等于买价，不打折（xl-knp.2 明写：不许"顺手修好"，ADR-0001）。
 *
 * ⚠️ 与买入的三处差别：没有钱不够那一支（钱只会变多）、`purchase` 的清零在
 * 循环**里面**、店主那两行话一个字都不动。
 */
function drugSell(w: ShopWorld, p: DrugShopState): void {
  w.music.push('Clip986.wav')
  for (let i = 0; i < DRUG_TRADE_ROWS; i++) {
    const row = p.rows[i]!
    const temp = Math.min(row.purchase, w.pack.drugs[i]!)
    w.pack.drugs[i]! -= temp
    w.coins += row.price * temp
    row.stock += temp
    row.purchase = 0
  }
}

/** `drugList.get(i/2-1)` 里那个 `-1`。装备店那一支是 `-4`（`base` 是 9）。 */
const DRUG_ROW_OFFSET = 1

/**
 * 加 / 减。**这一票只做药店**；装备店归 xl-knp.8。
 *
 * ⚠️ **它是第二个洞，位置不能和买卖那个合并**：原版两个面板的 `setButton`
 * 里，那个 `for(int i=3/9;i<buttonlist.size();i+=2)` 排在 `back` 分支
 * **之后**（`ShopPanel.java` / `EquipmentShopPanel.java`）。填进 `back`
 * 之前的表现是：同一次松开同时挂着 `back` 与加号时 `music` 成了
 * `[click.wav, 换头像.wav]`，而原版是 `[换头像.wav, click.wav]`。
 * 判据在 `step.test.ts`。
 *
 * ⚠️ **那一声 `click.wav` 在守卫外面**：`purchase` 已经是 0 时再按减号，
 * 一个数都不动，**但照样出声**。「什么都不发生」是错的读法，而这两种读法
 * 在除了 `music` 之外的每一列上都长得一样 —— `shop-trade` 第 3 步就是它。
 */
function stepPurchaseButtons(w: ShopWorld): void {
  const p = activePanel(w)
  // xl-knp.8：装备店只差 `base` 与读哪一栏（`i/2-4`），形状与这里相同。
  if (p.kind !== 'drug') return
  const base = stepBase('drug')
  for (let i = base; i < p.buttons.length; i += 2) {
    // 原版是 `drugList.get(i/2-1)`（整除）—— `base` 是 3，所以偏移就是 1。
    const row = p.rows[Math.floor(i / 2) - DRUG_ROW_OFFSET]!
    if (p.buttons[i]!.isclicked) {
      w.music.push('click.wav')
      if (row.purchase > 0) row.purchase--
    }
    if (p.buttons[i + 1]?.isclicked) {
      w.music.push('click.wav')
      row.purchase++
    }
  }
}

function clicked(buttons: readonly ShopButtonState[], label: ShopButtonLabel): boolean {
  return buttons.some((b) => b.isclicked && b.label === label)
}

/** 当前面板此刻挂着 `isclicked` 的那几颗，按按钮表次序。真值 `pressed` 那一列。 */
export function pressedLabels(w: ShopWorld): string[] {
  return clickedLabels(activePanel(w).buttons)
}

/** 当前落点落在商品列表的第几行（-1 = 不在任何一行的命中带上）。 */
export function cursorRow(w: ShopWorld): number {
  const p: ShopPanelState = activePanel(w)
  return rowAt(p.currentX, p.currentY, currentRows(w).length)
}
