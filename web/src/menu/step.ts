import { moveInButton, pressButton, releaseButton } from './buttons'
import {
  clearEquipWarnings,
  equipCheckMoveIn,
  EQUIP_LIST_VIEW,
  equipCheckPressed,
  equipCheckReleased,
  equipList,
  paintEquip,
} from './equipPanel'
import { funcCheckMoveIn, funcCheckPressed, funcCheckReleased } from './funcButtons'
import {
  DRUG_LIST_VIEW,
  drugPanelMoveIn,
  drugPanelPressed,
  drugPanelReleased,
  visibleDrugs,
} from './drugPanel'
import { dragScroll, pressScrollTrack, releaseScrollDrag, wheelScroll } from './scroll'
import type { ListViewport, Scrollable } from './scroll'
import {
  magicCheckMoveIn,
  magicCheckPressed,
  magicCheckReleased,
  magicDrawThisPanel,
  magicUpdate,
} from './magic'
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

/**
 * 真值 `input` 那一列的条目。菜单只有鼠标，外加一个时钟脉冲。
 *
 * ⚠️ `wheel` 那一支**真值里没有** —— 原版没有滚动条，导出器也不会导出它
 * （`MenuDriver` 认得的 op 里没有滚轮）。它是 web 侧加的第五种输入
 * （xl-6lo.13），只从浏览器进来。加在这里而不是另开一条路，是因为它与另外
 * 四种一样要走 `stepMenu` 那一步的开头收尾（清音效、清拒绝旗标、末尾 paint）。
 */
export type MenuInput =
  | { readonly e: 'press' | 'release' | 'move'; readonly x: number; readonly y: number; readonly target?: string }
  | { readonly e: 'tick' }
  | { readonly e: 'wheel'; readonly x: number; readonly y: number; readonly rows: number }

export function stepMenu(w: MenuWorld, inputs: readonly MenuInput[] = []): MenuWorld {
  // 音效是**这一步**的（`MusicTap` 每步取走一次），所以每步开头清空。
  // 不清的话它会越积越长，而"这一步响了"与"上一步响过"就分不开了。
  w.music = []
  // 两个拒绝旗标同理：由**这一步**的输入置位。原版清它们的是紧接着那次
  // `drawWarning()`，而真值是在 paint **之前**抓的 —— 也就是"这一步置的位"
  // 看得见、下一步就没了。清在这里，不会把它们抹成永远的 false
  // （`equipPanel.ts` 的 `paintEquip` 注释）。
  //
  // ⚠️ **与原版等价是有条件的**，条件写在这里免得下一个人以为它无条件成立：
  // 这里是**每一步都清、不看当前是哪一页**，原版只在装备页真的被画时清。
  // 两者今天结果相同，**因为置位的只有装备页自己的 `checkAllButtonPressed`**
  // —— 而它只在装备页是当前页时才跑，那一步末尾原版必定画它。哪天有别处
  // 置这两个位，这条等价就不成立了。
  const equip = w.panels.equipPanel.equip
  if (equip) clearEquipWarnings(equip)
  for (const input of inputs) applyMenuInput(w, input)
  // 原版的 `paint()` **有状态副作用**，而 `MenuDriver` 每一步都真的画一次
  // 当前页（`current().paint(sink)`）。照办 —— 少了它，装备页的
  // `abandonDraw` 与 `diff` 两列永远对不上。
  paintCurrentPanel(w)
  w.tick++
  return w
}

/**
 * **原版的绘制有副作用，而真值是在绘制之后抓的。**
 *
 * `MenuDriver.step()` 每一步的末尾都是一句 `current().paint(sink)`，之后才
 * 快照。`FatherPanel.paint()` 里那六层中有两层会改状态：`drawScoll()` 打开
 * 二号 / 四号头像的 `isDraw`，`MagicPanel.drawThisPanel()` 按当前角色的
 * `skillNumber` 现设十五颗技能按钮的 `isDraw`。**后者真值记着**
 * （`magic.visible` 那一列），所以它必须在状态层里跑一遍 —— 少了这一句，
 * 那一列会**一直停在开局的十五个 true 上**，而"从没翻到过奇术页"与"翻到了
 * 但一颗按钮都没关掉"长得一样。
 *
 * 前者（`drawScoll()` 那三句）不在这里：真值不记头像的 `isDraw`，而绘制层
 * 已经把它折算成"或上出战名单"了（`render/drawList.ts`）。两处的分界是
 * **真值记不记**，不是"原版写在哪个方法里"。
 *
 * ⚠️ **只画当前页**，与原版一致：`CardLayout` 盖住的三页 `repaint()` 不会
 * 真画。四页全画的话，从没翻到过的奇术页也会把按钮关掉 —— `menu-equip`
 * 前 24 步的 `visible` 当场就红。
 */
function paintCurrentPanel(w: MenuWorld): void {
  const p = currentPanel(w)
  if (p.equip) paintEquip(p.equip, w.music)
  if (p.magic && p.scoll) magicDrawThisPanel(p.magic, p.scoll.whichHero)
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
    case 'wheel':
      menuWheel(w, input.x, input.y, input.rows)
      return
  }
}

/**
 * 滚轮（xl-6lo.13）。**只送给当前显示的那一页**，与鼠标的三种事件同一个规矩
 * （`CardLayout` 盖住的三页收不到任何事件）。
 *
 * 每一页自己再判这一下落没落在它的列表框里 —— 落在别处一律不动。
 * ⚠️ 它**一个真值记着的字段都不碰**：不动 `Mouse` 的坐标（滚轮不移动指针）、
 * 不动选中项、不出声。
 *
 * ⚠️ **翻完页不重跑一次悬停判定，这是有意的**（/code-review 的 Spec 轴问到）。
 * 后果看得见：鼠标停在列表上不动、滚一格，屏幕上那一行换了内容，而选中的
 * 仍然是原来那一件，直到下一次 `mouseMoved`。两个理由：
 *
 * - 原版的选中**只由 `mouseMoved` 改**，没有第二条路。补一条等于给状态机加了
 *   一种原版没有的转移，而它改的恰恰是真值记着的 `selected` / `selectedName`。
 * - 「滚动不进真值」这条不变式就没了 —— 而它是这张票最好用的一条判据
 *   （`scroll.test.ts` 最后那一组）。
 *
 * 真要跟手，该做的是在渲染层按当前指针位置画高亮，而不是让滚轮去改状态。
 */
function menuWheel(w: MenuWorld, x: number, y: number, rows: number): void {
  const p = currentPanel(w)
  for (const l of scrollLists(w, p)) wheelScroll(l.view, l.state, l.length, x, y, rows)
}

/**
 * 这一页上**能滚的那几份列表**：装备页的背包、物品页的药品清单（其余两页没有）。
 * 滚轮、按下、拖动、松手四处都要「这一页的视口 + 存滚动位置的那份状态 + 列表
 * 现在多长」这三样，收在一处，免得四处各抄一对 `if (p.equip)` / `if (p.drug)`。
 * 长度**每次现算**：列表会在滚动层不知情时变短（`scroll.ts` 的 `clampScroll`）。
 */
function scrollLists(
  w: MenuWorld,
  p: MenuSubPanel,
): { readonly view: ListViewport; readonly state: Scrollable; readonly length: number }[] {
  const lists = []
  if (p.equip) lists.push({ view: EQUIP_LIST_VIEW, state: p.equip, length: equipList(p.equip).length })
  if (p.drug) lists.push({ view: DRUG_LIST_VIEW, state: p.drug, length: visibleDrugs(w.drugPack).length })
  return lists
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
  // 任何一次按下都先结束**四页**的拖拽（xl-03x.9），不只当前页：能再按一次，
  // 说明上一次的松手丢了（`scroll.ts` 的 `ScrollDrag`）；而这一下若是页签，
  // 下一行就换页了，旧那一页的锚点会一直留着 —— 哪天有一条不经过按下就回到
  // 那一页的路，头一次移动就会把列表拖走。按在滑块上的话，下面
  // `pressScrollTrack` 会在当前页重新开始一次。
  for (const name of MENU_PANEL_ORDER) {
    const panel = w.panels[name]
    if (panel.equip) releaseScrollDrag(panel.equip)
    if (panel.drug) releaseScrollDrag(panel.drug)
  }
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
  if (p.equip) equipCheckReleased(p.equip, p.currentX, p.currentY)
  if (p.funcButtons) funcCheckReleased(p.funcButtons, p.currentX, p.currentY)
  drugPanelReleased(p)
  // 奇术页的松开**扫全部三组**，不只当前角色那一组（原版就是这么写的）。
  if (p.magic) magicCheckReleased(p.magic, p.currentX, p.currentY)
  // 拖滑块结束（xl-03x.9）。只结束当前页的 —— 松手与按下一样只送给当前页，
  // 而拖拽只能在当前页上开始。
  for (const l of scrollLists(w, p)) releaseScrollDrag(l.state)
}

function menuMouseMoved(w: MenuWorld, x: number, y: number): void {
  w.currentX = x
  w.currentY = y
  for (const key of TAB_PRIORITY) moveInButton(w.tabs[key], w.currentX, w.currentY)
  const p = currentPanel(w)
  p.currentX = x
  p.currentY = y
  // 拖滑块（xl-03x.9）。浏览器按住左键的移动也送成 `move`，这是忠实的：原版
  // `MenuPanel` 的 `mouseDragged` 与 `mouseMoved` 两支逐字相同（都是
  // `checkMoveIn` + `checkAllButtonMoveIn`），所以拖拽不另开一种输入。
  //
  // **排在悬停判定前面**：先把列表翻到拖到的那一行，下面 `equipCheckMoveIn`
  // 那条命中带按翻好的位置算 —— 指针若在拖的途中漂进了列表，选中的是屏幕上
  // 那一行，而不是上一拍的那一行。两页的命中带与槽那一列不相交（`scroll.test.ts`
  // 「命中带碰不到槽那一列」守着），所以真值走到的每一步都不受这个次序影响
  // （真值里根本没有拖拽，`drag` 恒为 null、这一句什么都不做）。
  for (const l of scrollLists(w, p)) dragScroll(l.view, l.state, l.length, p.currentY)
  scollCheckMoveIn(w, p)
  // `FuncPanel.checkAllButtonMoveIn` 只有 `fb.checkMoveIn()` 一句 —— 三态贴图
  // 的「待点」那一态靠它。真值不记 `image`，所以这一条由逐帧比对守（xl-6lo.14）。
  if (p.funcButtons) funcCheckMoveIn(p.funcButtons, p.currentX, p.currentY)
  drugPanelMoveIn(w, p)
  // 奇术页的悬停**只扫当前角色那一组**（`checkAllButtonMoveIn` 的 switch）。
  if (p.magic && p.scoll) magicCheckMoveIn(p.magic, p.scoll.whichHero, p.currentX, p.currentY)
  // `EquipPanel.checkAllButtonMoveIn()`：`isMoveIn()`（挑列表的第几行）在前，
  // 八颗按钮的命中判据在后。
  if (p.equip) equipCheckMoveIn(p.equip, p.currentX, p.currentY)
}

/**
 * `Command.checkPressed`：先给四颗按钮各派一次 `isPressedButton`，**再**按
 * 物品 / 奇术 / 天书 / 装备的顺序看谁 `isclicked`。
 *
 * 两段分开是原版的形状，也是必须的：命中判据要对四颗都跑一遍（没命中的那几颗
 * 要把贴图拨回常态），换页那一步只认第一个命中的。
 */
/**
 * ⚠️ **`w.music` 今天没有任何人去播** —— 整个 web 端没有音效播放器
 * （战斗那边从 M2 起同样如此，`sources/music/` 35 个文件一个都没进烘焙）。
 * 这一列是**状态**，由 menu 真值的 `music` 那一列守着；把它变成声音是
 * **xl-8l2**。
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
 * 各页自己那部分见 `menuTrace.test.ts` 那张按字段组的登记表：equip →
 * xl-6lo.9、magic → xl-6lo.11 仍未对齐；**drug 已对齐**（xl-6lo.10，见
 * `drugPanel.ts`）、**func 已对齐**（xl-6lo.12，见 `funcButtons.ts`）。
 */
function checkAllButtonPressed(w: MenuWorld, p: MenuSubPanel): void {
  scollCheckPressed(w, p)
  // 装备页那一段在 `scoll.checkPressed()` **之后** —— 它头三段读的正是刚被
  // 置位的 `scoll.heroN.isclicked`（换人时把背包与列表整个拨回那个人的武器）。
  if (p.equip && p.scoll) {
    equipCheckPressed(p.equip, p.scoll, w.heroes, p.currentX, p.currentY, w.music)
  }
  // 天书页没有卷轴，它的 `checkAllButtonPressed` 只有 `fb.checkPressed()` 一句。
  //
  // 页签那一项要现读：原版第一段读的是 `command.buttonList` 里有没有哪一颗
  // `isclicked` —— 而 `commandCheckPressed` 刚刚在同一次事件里跑过。
  if (p.funcButtons) {
    const tabsClicked = TAB_PRIORITY.some((key) => w.tabs[key].isclicked)
    funcCheckPressed(p.funcButtons, tabsClicked, p.currentX, p.currentY, w.music, w.audio)
  }
  drugPanelPressed(w, p)
  // 奇术页：技能按钮 + 那一句无条件的 `currentAnimation=null`。它跑在
  // `scoll.checkPressed()` **之后** —— 切人与清动画同一拍时，先切人。
  if (p.magic && p.scoll) magicCheckPressed(p.magic, p.scoll.whichHero, p.currentX, p.currentY, w.music)
  // 滚动条的槽（xl-6lo.13）。**排在最后，而且不改上面任何一段的结果**：槽贴着
  // 列表框的右内沿，那片矩形上原版一颗按钮都没有（六颗槽位按钮在框上面
  // y 129..149，「使用」「弃用」在框下面），所以它既接不到别人的点击，也不会
  // 把自己的让出去。判据在 `scroll.test.ts`。
  for (const l of scrollLists(w, p)) pressScrollTrack(l.view, l.state, l.length, p.currentX, p.currentY)
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
    const p = w.panels[name]
    // 循环体是 `update(); mouse.update();` 两句，次序照抄。四页里只有奇术页
    // 的 `update()` 有实质动作 —— 技能动画就是靠它往前走的，**与有没有输入
    // 无关**：`menu-magic` 从第 9 步起连推 35 拍一次输入都没有，而动画每拍
    // 加一帧。
    if (p.magic) magicUpdate(p.magic)
    updateMouse(p)
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

/**
 * 把「返回」那条**一次性信号**收掉 —— 会话切回场景的那一拍调它（xl-6lo.18）。
 *
 * 原版没有这个字段：那一支直接就是 `switchTo("scene")`，一句话执行完就没了。
 * `exitToScene` 是这一层为了让会话读得到而加的旗标，所以它必须由**读它的人**
 * 清掉。菜单世界从开机活到关机（`game/session.ts`），不清的话下一次开菜单
 * 第一拍就自己关上了 —— 而"按 ESC 开不了菜单"看起来像 ESC 那条路坏了。
 *
 * ⚠️ **`returnButton.isclicked` 不在这里清，也不需要**：那一下松手会把它清掉。
 * 原版的松手真的到得了已经被 CardLayout 藏起来的 `menuPanel` —— Swing 的
 * `LightweightDispatcher` 从按下到松开一直握着 grab，事件按**按下时**那个组件
 * 重定向，不看它还显不显示（2026-09-10 用一个真 JFrame + CardLayout 量过：
 * 藏起来那个 `pressed=true released=true`）。落点与按下同一处、必然命中，
 * `GameButton.isRelesedButton` 里那句 `isclicked=false` 就跑了。
 *
 * 这里要清的只有 `exitToScene` 这一个**原版没有**的字段。多清一个
 * `isclicked` 今天看不出差别（松手已经清过了），但那是把一件别人做过的事
 * 又做一遍，而它掩盖的恰恰是"松手没送到"这种真的会出问题的情况。
 */
export function clearMenuExit(w: MenuWorld): void {
  const fb = w.panels.funcPanel.funcButtons
  if (fb) fb.exitToScene = false
}

/**
 * 玩家点了天书页的「存档」或「提取」吗（xl-i06.9）。原版那两支是
 * `setLastPanel("menu")` + `changeStateTo(SAVE | LOAD)` + `switchTo("ls")`。
 */
export function menuSaveLoadRequest(w: MenuWorld): 'save' | 'load' | null {
  return w.panels.funcPanel.funcButtons?.saveLoadRequest ?? null
}

/** 收掉那条一次性信号 —— 理由同 `clearMenuExit`：菜单世界活到关机，不清就下次一开菜单又跳走。 */
export function clearMenuSaveLoad(w: MenuWorld): void {
  const fb = w.panels.funcPanel.funcButtons
  if (fb) fb.saveLoadRequest = null
}
