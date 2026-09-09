import { clickedLabels, moveInButton, pressButton, releaseButton } from './buttons'
import type { ShopButtonLabel, ShopButtonState } from './buttons'
import { rowAt } from './layout'
import type { ShopKind } from './layout'
import type { EquipSlot } from '../menu/equipment'
import { activePanel, currentRows, stepBase, stepButtons } from './world'
import type { EquipShopState, ShopPanelState, ShopWorld } from './types'

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
 * **这一票只做前一件**（图标框是列表框骨架的一部分）；后一件是店主对白 /
 * 属性加成 / 谁能用，归 xl-knp.7 与 xl-knp.8 —— 它们往下面那个 `if` 里
 * **加**几句赋值就是了，不必重排。真值 `icon` 那一组因此这一票就签得下，
 * `message` 那一组挂在 PENDING 上（`shopTrace.test.ts`）。
 */
function panelMoveIn(w: ShopWorld): void {
  const p = activePanel(w)
  const rows = currentRows(w)
  const row = rowAt(p.currentX, p.currentY, rows.length)
  if (row < 0) return
  p.iconPicture = rows[row]!.picture
  // xl-knp.7 / xl-knp.8 在这里加 message / messagePlus / messageRemark。
}

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
  // 买 / 卖：**这一票不做**，见 `pendingBuySell` 的注释。原版在这里。
  pendingBuySell(w)
  if (clicked(p.buttons, 'back')) {
    w.music.push('换头像.wav')
    // 原版这里是 `GameLauncher.switchTo("scene")` —— 面板自己不知道要去哪，
    // 换面板是外面那一层的事。浏览器里同理，会话侧接它（xl-yg6.2）。
    w.leaving = true
  }
  // 加 / 减：**这一票不做**。⚠️ 它在 `back` **之后**，不是和买卖挤在一起 ——
  // 两个洞分开留，正是为了后面两张票各自往自己那个洞里填、不必重排。
  pendingStepButtons(w)
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
 * 买 / 卖 —— **这一票不做**，归 xl-knp.7（药店）与 xl-knp.8（装备店）。
 *
 * 空着而不是抛：真值要从头跑到尾。抛的话整条剧本一步都跑不动，于是"这几组
 * 还没做"会伪装成"这一层崩了"，而 `shopTrace.test.ts` 反方向那半边判据
 * （登记成"还欠着"的格子必须**真的**还没对上）就再也跑不到了。
 *
 * 这个洞的登记在 `shopTrace.test.ts` 的 `PENDING` 里，逐格带票号；
 * 它同时是**双向**的：哪天有人把这里做了却忘了改登记，那半边判据立刻红。
 */
function pendingBuySell(_w: ShopWorld): void {
  // xl-knp.7 / xl-knp.8 在这里加 buy / sell 两段。
}

/**
 * 加 / 减 —— 同上，**这一票不做**。
 *
 * ⚠️ **它是第二个洞，位置不能和上面那个合并**：原版两个面板的 `setButton`
 * 里，那个 `for(int i=3/9;i<buttonlist.size();i+=2)` 排在 `back` 分支
 * **之后**（`ShopPanel.java` / `EquipmentShopPanel.java`）。合成一个洞、
 * 让后面两张票把四段一起填进 `back` 之前，加减就跑到「返回游戏」前头去了
 * —— 表现是同一次松开同时挂着 `back` 与加号时 `music` 成了
 * `[click.wav, 换头像.wav]`，而原版是 `[换头像.wav, click.wav]`
 * （/code-review 的 Spec 轴提的）。**留两个洞，`back` 夹在中间**，后面两张票
 * 才真的只做加法。判据在 `step.test.ts`。
 */
function pendingStepButtons(_w: ShopWorld): void {
  // xl-knp.7 / xl-knp.8 在这里加 plus / minus 两段。
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
