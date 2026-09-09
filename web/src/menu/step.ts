import { moveInButton, pressButton, releaseButton } from './buttons'
import { funcCheckPressed, funcCheckReleased } from './funcButtons'
import { MENU_PANEL_ORDER, PANEL_OF_TAB, TAB_PRIORITY } from './world'
import { SCOLL_HEROES } from './types'
import type { MenuSubPanel, MenuWorld } from './types'

/**
 * 推进菜单一步。
 *
 * **一步 = 一次输入事件；`tick` 那种一步 = 一次 `FatherPanel.run()` 的循环体**
 * （`docs/trace-format.md` §菜单剧本与菜单真值）。两种一步不是同一件事，而
 * 菜单真值把它们摆在同一列 `input` 里：`[{"e":"press",…}]` 与 `[{"e":"tick"}]`。
 *
 * 为什么不是纯事件驱动：菜单里**可断言的状态变化**确实全由鼠标事件同步引起，
 * 但那四条 `while(true){ Clock.sleep(100); update(); mouse.update(); repaint(); }`
 * 线程一直在跑，不管哪一页正显示着 —— 鼠标图标的循环换图与奇术页那段技能动画
 * 就挂在它上面。`menu-magic` 从第 8 步起连推 40 多拍**一次输入都没有**，
 * 而每一拍四个 `Mouse` 都往前走一格。做成纯事件驱动的话那 40 多行全是一模一样
 * 的状态 —— 而"没输入就不动"与"动了"在别处看不出来。
 *
 * 状态是**就地改**的（`types.ts` 的规矩），返回的就是传进来的那个世界。
 */

/** 真值 `input` 那一列的条目。菜单只有鼠标，外加一个时钟脉冲。 */
export type MenuInput =
  | { readonly e: 'press' | 'release' | 'move'; readonly x: number; readonly y: number; readonly target?: string }
  | { readonly e: 'tick' }

export function stepMenu(w: MenuWorld, inputs: readonly MenuInput[] = []): MenuWorld {
  // 音效是**这一步**的（`MusicTap` 每步取走一次），所以每步开头清空。
  // 不清的话它会越积越长，而"这一步响了"与"上一步响过"就分不开了。
  w.music = []
  for (const input of inputs) applyMenuInput(w, input)
  w.tick++
  return w
}

export function applyMenuInput(w: MenuWorld, input: MenuInput): void {
  switch (input.e) {
    case 'tick':
      tickMenu(w)
      return
    case 'press':
      menuMousePressed(w, input.x, input.y)
      return
    case 'release':
      menuMouseReleased(w, input.x, input.y)
      return
    case 'move':
      menuMouseMoved(w, input.x, input.y)
      return
  }
}

/**
 * `MenuPanel` 那个匿名 `MouseAdapter` 的 `mousePressed`，逐行照抄：
 *
 *     currentX = e.getX(); currentY = e.getY();
 *     command.checkPressed();                    ← 可能在这里换掉 currentPanel
 *     currentPanel.mousePressed(currentX, currentY);
 *
 * ⚠️ **顺序就是结果**：切页发生在第 2 行，所以第 3 行那次派发落在**新的**
 * 那一页上。真值里看得见 —— `menu-magic` 第 2 步按下「奇术」之后，
 * `magicPanel` 的 `Mouse` 拿到了 (619,62)，而按下时正显示着的 `thingPanel`
 * 一直是 (0,0)。两行对调的话四个 Mouse 的坐标会整体串到上一页去。
 */
function menuMousePressed(w: MenuWorld, x: number, y: number): void {
  w.currentX = x
  w.currentY = y
  commandCheckPressed(w)
  const p = currentPanel(w)
  p.currentX = x
  p.currentY = y
  checkAllButtonPressed(w, p)
}

function menuMouseReleased(w: MenuWorld, x: number, y: number): void {
  w.currentX = x
  w.currentY = y
  for (const key of TAB_PRIORITY) releaseButton(w.tabs[key], w.currentX, w.currentY)
  const p = currentPanel(w)
  p.currentX = x
  p.currentY = y
  if (p.scoll) {
    for (const { field } of SCOLL_HEROES) releaseButton(p.scoll[field], p.currentX, p.currentY)
  }
  if (p.funcButtons) funcCheckReleased(p.funcButtons, p.currentX, p.currentY)
}

function menuMouseMoved(w: MenuWorld, x: number, y: number): void {
  w.currentX = x
  w.currentY = y
  for (const key of TAB_PRIORITY) moveInButton(w.tabs[key], w.currentX, w.currentY)
  const p = currentPanel(w)
  p.currentX = x
  p.currentY = y
  scollCheckMoveIn(w, p)
}

/**
 * `Command.checkPressed`：先给四颗按钮各派一次 `isPressedButton`，**再**按
 * 物品 / 奇术 / 天书 / 装备的顺序看谁 `isclicked`。
 *
 * 两段分开是原版的形状，也是必须的：命中判据要对四颗都跑一遍（没命中的那几颗
 * 要把贴图拨回常态），换页那一步只认第一个命中的。
 */
function commandCheckPressed(w: MenuWorld): void {
  for (const key of TAB_PRIORITY) pressButton(w.tabs[key], w.currentX, w.currentY)
  for (const key of TAB_PRIORITY) {
    if (!w.tabs[key].isclicked) continue
    w.music.push('换list.wav')
    w.panel = PANEL_OF_TAB[key]
    return
  }
}

/**
 * `FatherPanel.checkAllButtonPressed` 里**四页共有**的那一句 ——
 * `scoll.checkPressed()`（天书页没有卷轴，所以它那一支整个没有）。
 *
 * 各页自己那部分（装备的六个分类与使用 / 弃用、物品的使用、奇术的技能按钮、
 * 天书的五颗）**不在这一票里**，见 `menuTrace.test.ts` 那张按字段组的登记表：
 * equip → xl-6lo.9、drug → xl-6lo.10、magic → xl-6lo.11、func → xl-6lo.12。
 */
function checkAllButtonPressed(w: MenuWorld, p: MenuSubPanel): void {
  scollCheckPressed(w, p)
  // 天书页没有卷轴，它的 `checkAllButtonPressed` 只有 `fb.checkPressed()` 一句。
  if (p.funcButtons) funcCheckPressed(p.funcButtons, p.currentX, p.currentY, w.music)
}

/** `Scoll.checkPressed`。切人、换卷轴图、出声。 */
function scollCheckPressed(w: MenuWorld, p: MenuSubPanel): void {
  const s = p.scoll
  if (!s) return
  for (const { field } of SCOLL_HEROES) pressButton(s[field], p.currentX, p.currentY)
  // ⚠️ 三条是**并列的 if**，不是 if-else —— 原版就是这么写的，所以这里是一个
  // 不带 break 的循环，不是 `find`。⚠️ 一号那一条**没有出战名单的门**
  // （`if(hero1.isIsclicked())` 光秃秃地在最外层，另外两条包在
  // `if(SaveAndLoad.lu/wen)` 里），照抄。
  for (const { hero, field, party } of SCOLL_HEROES) {
    if (party !== 'zhang' && !w.party[party]) continue
    if (!s[field].isclicked) continue
    s.whichHero = hero
    w.music.push('换头像.wav')
  }
}

/**
 * `Scoll.checkMoveIn`：**它顺手把二号与四号头像的 `isDraw` 打开**（按出战
 * 名单），然后才派发命中判据。副作用在前、判据在后，照抄。
 */
function scollCheckMoveIn(w: MenuWorld, p: MenuSubPanel): void {
  const s = p.scoll
  if (!s) return
  // ⚠️ 只打开二号与四号：一号那一句在 `drawScoll()` 里，不在这儿。
  for (const { field, party } of SCOLL_HEROES) {
    if (party === 'zhang') continue
    if (w.party[party]) s[field].isDraw = true
  }
  for (const { field } of SCOLL_HEROES) moveInButton(s[field], p.currentX, p.currentY)
}

/**
 * 一次 `FatherPanel.run()` 的循环体，**四个子面板各一次**：原版四条线程一直
 * 在跑，不管哪一页正显示着。`repaint()` 那一半归渲染层。
 */
export function tickMenu(w: MenuWorld): void {
  for (const name of MENU_PANEL_ORDER) {
    // `update()`：四页里只有奇术页有实质动作（技能动画），归 xl-6lo.11。
    updateMouse(w.panels[name])
  }
}

/**
 * `Mouse.update()`，逐行照抄：
 *
 *     x=fp.currentX; y=fp.currentY;
 *     if(code<8){ currentImage=images.get(code); code++; }
 *     else if(code==8){ code=1; }
 *
 * **先取图再自增**，而 `code==8` 那一次只把计数器拨回 1、**不换图**。于是
 * 第 0 张只在开局出现一次、第 7 张连画两帧 —— 真值里 `code` 与 `frame` 两列
 * 分开记，就是为了让这件事看得见。
 */
function updateMouse(p: MenuSubPanel): void {
  const m = p.mouse
  m.x = p.currentX
  m.y = p.currentY
  if (m.code < 8) {
    m.frame = m.code
    m.code++
  } else if (m.code === 8) {
    m.code = 1
  }
}

export function currentPanel(w: MenuWorld): MenuSubPanel {
  return w.panels[w.panel]
}

/**
 * 玩家点了天书页的「返回」吗 —— **出菜单唯一的那条路**。
 *
 * 进菜单是场景侧的 ESC（`game/keyboard.ts`），出菜单**只有这一颗按钮**。
 * `MenuPanel` 里那个 `keyPressed(ESC) → switchTo("scene")` 是**死代码**：
 * 顶层的 `keyPressed` 只分发给场景 / 存档 / 战斗三家，当前面板是菜单时一个
 * 分支都不命中 —— 也就是**进了菜单按 ESC 出不来**。按 ADR-0001 照样复刻，
 * 缺陷登记在 xl-1dv.*（xl-6lo.2 §输入）。
 *
 * ⚠️ **Web 上按 ESC 关面板是肌肉记忆，不要"顺手修好"它** —— 改了真值就对不上。
 */
export function menuWantsScene(w: MenuWorld): boolean {
  return w.panels.funcPanel.funcButtons?.exitToScene === true
}
