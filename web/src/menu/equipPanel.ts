import { menuButton, moveInButton, pressButton, releaseButton } from './buttons'
import { EQUIPMENT_LISTS, EQUIP_SLOTS } from './equipment'
import type { EquipSlot, EquipmentSpec } from './equipment'
import { DEFAULT_WEAPONS } from './defaultWeapons'
import { EQUIP_LIST_BOX, clampScroll, rowBandTop } from './scroll'
import type { ListViewport } from './scroll'
import { refreshMenuHero } from './heroes'
import type { MenuHero } from './heroes'
import { SCOLL_HEROES } from './types'
import type { MenuButtonState, ScollHero, ScollState } from './types'

/**
 * 装备页的状态层 —— `src/menu/EquipPanel.java`（1107 行，原版菜单里最大的一个）
 * 里**改状态的那一半**。画的那一半在 `render/equipDraw.ts`。
 *
 * 判据是 `menuTrace.test.ts` 的 `equip × menu-equip` / `equip × menu-magic`
 * 两格：真值 `equip` 那一列有 13 个字段（`tab` / `packHero` / `list` /
 * `selected` / `selectedName` / `signal` / `worn` / `equipped` / `useDraw` /
 * `abandonDraw` / `warnEquipped` / `warnCannotUse` / `diff`），逐步逐字段相等。
 * 期望值一个都不是手写的。
 *
 * ## 三件在别处看不见、必须照抄的事
 *
 * 1. **背包是全局的，不是每个人一份。** `EquipmentPack` 那六个 list 是
 *    `static`，`numberGOT` 挂在装备对象自己身上 —— 张小凡弃用的那把刀，
 *    陆雪琪的列表里立刻就看得见。做成"每人一个背包"在单人剧本里长得一模一样。
 * 2. **`heroEquipment` 是「当前槽位上穿着的那件」，不是「选中的那件」。**
 *    它跟着 `CURRENTLIST` 走：切槽位（`judgeCurrentPack`）、切人、穿、脱
 *    四处各改一次。混淆这两个字段的表现是差值算反。
 *   3. **两条拒绝路径互斥，且顺序固定**：先判使用者（`canBeEquiped`），
 *    通过了才进 `doUseButton()`，那里再判槽位空不空（`isEquiped`）。所以
 *    「一件别人才能用的东西，穿在一个槽位已经满了的人身上」记的是
 *    `warnCannotUse`，不是 `warnEquipped` —— `menu-equip` 第 6 步就是这一场。
 *
 * ## `paintEquip`：原版的绘制**有状态副作用**
 *
 * 三件事只发生在 `paint()` 里，而 `MenuDriver` 每一步都真的画一次当前页，
 * 所以状态层也必须在每步末尾跑一遍（`step.ts` 的 `paintCurrentPanel`）：
 * `drawEquipment → showValueDifference()` 算属性差值、`drawWarning()` 出
 * 「禁止.wav」、`drawHeroStuff()` 按身上有没有东西改 `abandon_button.isDraw`。
 * 少了它，`abandonDraw` 与 `diff` 两列永远对不上。
 */

/** 一个人的六个槽位（`menu.EquipPack`）。空槽是 `null`。 */
export type EquipPackState = Record<EquipSlot, string | null>

/** 装备页中间那四个升降数字（`ShowValue[4]`）。 */
export interface EquipDiff {
  readonly physicalPower: number
  readonly agile: number
  readonly strength: number
  readonly spirit: number
}

export interface EquipPanelState {
  /**
   * `Equipment.numberGOT` —— 按槽位 × 表内下标。**全局共享**（那六个 list 是
   * static），所以三个人共用这一份。
   */
  owned: Record<EquipSlot, number[]>
  /** 三个人各自的六个槽位（`equipPack_hero1/2/4`）。 */
  packs: Record<ScollHero, EquipPackState>
  /** `currentPack` 是谁的。真值 `equip.packHero` 那一列。 */
  currentPackHero: ScollHero
  /** `CURRENTLIST`。真值 `equip.tab` 那一列。 */
  currentList: EquipSlot
  /** `currentEquipment` 的名字 —— 背包里**选中**的那件。 */
  currentEquipment: string | null
  /** `heroEquipment` 的名字 —— 当前槽位上**穿着**的那件。真值 `equip.worn`。 */
  heroEquipment: string | null
  /** `signal`：1 = 有选中的东西（差值与那张图才画）。 */
  signal: 0 | 1
  /** `isEquiped==1`：这个槽位已经有东西了。由输入置位，下一步开头清。 */
  warnEquipped: boolean
  /** `canBeEquiped==1`：这件东西不是这个人能用的。同上。 */
  warnCannotUse: boolean
  /** 四个 `ShowValue` 的读数。**由 `paintEquip` 算**，`signal!=1` 时真值记 null。 */
  diff: EquipDiff | null
  /**
   * 背包列表翻到第几行了（**原版没有这个东西**，xl-6lo.13）。
   *
   * ⚠️ 它**不进真值**：`snapshotEquip` 一个字都不记它。原版不裁剪、也没有
   * 滚动条，所以真值里没有任何一列会因为它变 —— 判据在 `scroll.test.ts`。
   */
  scroll: number
  /** 六个槽位按钮（`buttonlist`）。 */
  slots: Record<EquipSlot, MenuButtonState>
  /** `use_button` / `abandon_button`。 */
  use: MenuButtonState
  abandon: MenuButtonState
  /**
   * **「弃用」这一帧真的画出来的 `isDraw`** —— 与 `abandon.isDraw` 差一帧。
   *
   * 原版 `drawThisPanel()` 的次序是「先把 `useButtonList` 两颗画掉，再
   * `drawEquipment / drawWarning / drawHeroStuff / drawValueBar`」，而
   * `drawHeroStuff()` 里那两句 `abandon_button.isDraw=Yes/No` **在按钮画完
   * 之后才跑**。也就是说：这一帧看得见的「弃用」，用的是**上一帧
   * `drawHeroStuff()` 留下的值**，而 `MenuDriver` 的快照是 paint 之后抓的、
   * 记的是新值。两者本来就不是同一个东西。
   *
   * 所以行为真值那一列（`equip.abandonDraw`）核的是 `abandon.isDraw`，而
   * **画面**要核这一个。少了它，逐帧比对会在「弃用」出现 / 消失的那一帧
   * 上红一整块 120×40 —— 状态层全绿，看起来完全像渲染层画错了
   * （xl-6lo.14 接上 menu 那条流水线的当天量到的，menu-scroll 第 2 / 5 帧
   * 各 4800 个像素）。
   *
   * ⚠️ 「使用」那一颗**没有**这个问题：改它 `isDraw` 的 `isMoveIn()` 是
   * `checkAllButtonMoveIn()` 调的，跑在事件里、paint 之前。唯一在 paint
   * **中途**改按钮的只有 `drawHeroStuff()` 这一处。
   *
   * ## 为什么不像战斗那样单开一层 `PaintState`
   *
   * 战斗那边把"只有画面看得见、状态层不记"的东西收进 `battle/render/paint.ts`
   * 的 `PaintState`，因为那里有**四样**且都带惯性或自由相位（血条每拍走 1 px、
   * 怒气与游标的轮播、按钮三态图）。菜单这边到今天**只有这一个布尔**，为它
   * 铺一层 `MenuPaintState` + `stepMenuWithPaint` 是 Speculative Generality。
   * 再有第二样时就该搬过去 —— 那时这个字段是现成的搬运对象。
   *
   * 它不进 `snapshotEquip()`（那个函数逐字段列举，不 spread），所以
   * `menuTrace.test.ts` 的 `equip` 那一组不会多出一列没人核的字段。
   */
  abandonDrawn: boolean
}

/**
 * `EquipPanel.addButton()` 里那几个坐标，逐行照抄。判据在 `equipPanel.test.ts`
 * （从 GBK 源码里现读）。
 *
 * 六颗槽位按钮排成一行：`x_equipButton + n*width_button`，n = 0..5。
 */
export const EQUIP_X_START = 548
export const EQUIP_Y_START = 177
export const SLOT_BUTTON_X = EQUIP_X_START - 16
export const SLOT_BUTTON_Y = EQUIP_Y_START - 42
export const SLOT_BUTTON_W = 43
export const SLOT_BUTTON_H = 20
/** `x_currentImage=790+32`、`y_currentImage=180` —— 选中那件的图。 */
export const CURRENT_IMAGE_X = 790 + 32
export const CURRENT_IMAGE_Y = 180
/** `x_heroEquipment_image=300+32` —— 身上那件的图。 */
export const WORN_IMAGE_X = 300 + 32
export const USE_BUTTON_X = CURRENT_IMAGE_X + 5 + 25
export const USE_BUTTON_Y = CURRENT_IMAGE_Y + 250
export const ABANDON_BUTTON_X = WORN_IMAGE_X + 23
export const ABANDON_BUTTON_Y = USE_BUTTON_Y
export const USE_BUTTON_W = 120
export const USE_BUTTON_H = 40
/** `isMoveIn()` 的行高，也是列表每一行的行距（`drawEquipment` 里的 `y += 22`）。 */
export const EQUIP_ROW_H = 22
/** 命中带的宽度：`currentX < x_start_point+70`。 */
export const EQUIP_HIT_W = 70

/**
 * 装备页那处列表的全部几何 —— 前四项是原版的常量，`box` 是从 `装备4.png`
 * 上量出来的（`scroll.ts` 的 `LIST_BOX_MEASUREMENT`）。滚动条与命中带共用
 * 这一份，所以"画在哪"与"点得中哪"不会分家。
 */
export const EQUIP_LIST_VIEW: ListViewport = {
  firstBaseline: EQUIP_Y_START,
  rowHeight: EQUIP_ROW_H,
  hitLeft: EQUIP_X_START,
  hitRight: EQUIP_X_START + EQUIP_HIT_W,
  box: EQUIP_LIST_BOX,
}

/** 一件装备在它那张表里的下标；不在表里时 -1。 */
function indexIn(slot: EquipSlot, name: string | null): number {
  if (name === null) return -1
  return EQUIPMENT_LISTS[slot].findIndex((e) => e.name === name)
}

/** 一件装备的四项加成。名字必须在那张表里 —— 找不到是 bug，不是缺省值。 */
export function specOf(slot: EquipSlot, name: string): EquipmentSpec {
  const spec = EQUIPMENT_LISTS[slot].find((e) => e.name === name)
  if (!spec) throw new Error(`${slot} 表里没有「${name}」`)
  return spec
}

/**
 * 当前那张表里**持有数大于 0** 的那几件，按表内次序 —— 也就是屏幕上列表的
 * 那几行，以及真值 `equip.list`。
 *
 * ⚠️ **不能用原版那个 `list` 字段**：`drawEquipment()` 每画一帧就往里 add 一遍
 * 而从不清空，几步之后它是一份越来越长的重复列表（`MenuDriver.equipJson`
 * 的注释里记着同一件事）。这里每次现算。
 */
export function equipList(e: EquipPanelState): readonly EquipmentSpec[] {
  const counts = e.owned[e.currentList]
  return EQUIPMENT_LISTS[e.currentList].filter((_, i) => counts[i]! > 0)
}

/** 一件装备的持有数（`Equipment.numberGOT`）。 */
export function equipCount(e: EquipPanelState, slot: EquipSlot, name: string): number {
  const i = indexIn(slot, name)
  if (i < 0) throw new Error(`${slot} 表里没有「${name}」`)
  return e.owned[slot][i]!
}

function setCount(e: EquipPanelState, slot: EquipSlot, name: string, count: number): void {
  const i = indexIn(slot, name)
  if (i < 0) throw new Error(`${slot} 表里没有「${name}」`)
  e.owned[slot][i] = count
}

/**
 * `EquipmentPack.addEqupment(name, number)`：**六张表全扫一遍**，凡是叫这个
 * 名字的都加。
 *
 * ⚠️ 原版那个方法把参数 `number` 当中间变量用（`number=e1.getNumberGOT()+number`），
 * 所以同一个名字要是在两张表里都有，第二张加的是**累计后**的数。今天六张表
 * 里没有重名，观测不到 —— 照抄，别"顺手修好"。
 */
export function addEquipment(e: EquipPanelState, name: string, count: number): void {
  let number = count
  for (const slot of EQUIP_SLOTS) {
    const i = indexIn(slot, name)
    if (i < 0) continue
    number = e.owned[slot][i]! + number
    e.owned[slot][i] = number
  }
}

function emptyPack(): EquipPackState {
  return { weapon: null, armor: null, helmet: null, shoe: null, glove: null, decoration: null }
}

/**
 * 建装备页。**顺序照抄原版，而顺序就是结果**：
 *
 * `EquipPanel` 的构造函数跑完时六张表的 `numberGOT` 全是 0（`ShopReader` 不给
 * 它赋值），所以那一段 `if(list.size()>0)` 走的是 else —— `signal=0`、
 * `currentEquipment=null`、`use_button.isDraw=No`。剧本 `setup.equipment` 里
 * 那几件是**构造之后**才加进去的（`MenuDriver.start()`），于是真值第 0 帧
 * 长成这样：`list` 里有东西，`signal` 却是 0、「使用」也不画。
 * 先加东西再建面板的话，第 0 帧的 `signal` 会是 1 —— 一个完全合法的错。
 */
export function createEquipPanel(
  setup: readonly { readonly name: string; readonly count: number }[] = [],
): EquipPanelState {
  const owned = {} as Record<EquipSlot, number[]>
  for (const slot of EQUIP_SLOTS) owned[slot] = EQUIPMENT_LISTS[slot].map(() => 0)

  const packs = {} as Record<ScollHero, EquipPackState>
  for (const { hero, party } of SCOLL_HEROES) {
    // `addPack()`：三个人各穿一把写死下标的武器。那四项加成已经算进
    // `heroes.ts` 的开局属性里了（`DEFAULT_WEAPONS`），这里只记"穿着什么"。
    packs[hero] = { ...emptyPack(), weapon: DEFAULT_WEAPONS[party === 'wen' ? 'yu' : party].name }
  }

  const slots = {} as Record<EquipSlot, MenuButtonState>
  EQUIP_SLOTS.forEach((slot, n) => {
    slots[slot] = menuButton(
      SLOT_BUTTON_X + n * SLOT_BUTTON_W,
      SLOT_BUTTON_Y,
      SLOT_BUTTON_W,
      SLOT_BUTTON_H,
      true,
    )
  })

  const e: EquipPanelState = {
    owned,
    packs,
    currentPackHero: 1,
    currentList: 'weapon',
    currentEquipment: null,
    heroEquipment: packs[1]!.weapon,
    signal: 0,
    warnEquipped: false,
    warnCannotUse: false,
    diff: null,
    scroll: 0,
    slots,
    use: menuButton(USE_BUTTON_X, USE_BUTTON_Y, USE_BUTTON_W, USE_BUTTON_H, false),
    abandon: menuButton(ABANDON_BUTTON_X, ABANDON_BUTTON_Y, USE_BUTTON_W, USE_BUTTON_H, false),
    abandonDrawn: false,
  }
  // 构造函数末尾那两句：身上有东西就画「弃用」；列表空着就 signal=0。
  if (e.heroEquipment !== null) e.abandon.isDraw = true
  // 头一帧画的就是构造函数留下的这个值（原版的第一次 paint 之前没人改过它）。
  e.abandonDrawn = e.abandon.isDraw
  // ⚠️ 这一支今天到不了（六张表的 numberGOT 全是 0），照抄是因为它取的是
  // `currentList.get(0)` 而不是 `list.get(0)` —— 与别处那几段不一样。
  if (equipList(e).length > 0) {
    e.currentEquipment = EQUIPMENT_LISTS[e.currentList][0]!.name
    e.signal = 1
    e.use.isDraw = true
  }

  for (const item of setup) addEquipment(e, item.name, item.count)
  return e
}

/**
 * 那一段"重算列表、挑第一件、开关「使用」按钮"—— 原版在**六处**逐字重复
 * （三个换人分支 + 六个换槽位分支 + 弃用），这里收成一个函数。
 *
 * ⚠️ 与构造函数里那一段**不是同一段**：这里取的是过滤后 `list.get(0)`。
 */
function reselectFirst(e: EquipPanelState): void {
  const list = equipList(e)
  if (list.length > 0) {
    e.currentEquipment = list[0]!.name
    e.signal = 1
    e.use.isDraw = true
  } else {
    e.currentEquipment = null
    e.signal = 0
    e.use.isDraw = false
  }
}

/** `addHeroValue()` / `minusHeroValue()`：四项属性加减，然后三个人全部 `refreshValue()`。 */
function applyBonus(heroes: MenuHero[], who: ScollHero, spec: EquipmentSpec, sign: 1 | -1): void {
  // `switch(scoll.whichHero)` 的 default 是空的 —— 到不了，因为 whichHero
  // 的取值域就是那三个。
  const h = menuHeroOf(heroes, who)
  h.agile += sign * spec.addAgile
  h.strength += sign * spec.addStrength
  h.spirit += sign * spec.addSpirit
  h.physicalPower += sign * spec.addPhysicalPower
  // ⚠️ 三个人**全部**重算，不只是被改的那一个。原版就是这么写的
  // （`hero4.refreshValue(); hero1.refreshValue(); hero2.refreshValue();`），
  // 而它有观测得到的后果：`refreshValue()` 会把超过上限的 hp/mp 夹回去。
  for (const other of heroes) refreshMenuHero(other)
}

/**
 * `checkAllButtonPressed()` 里**装备页自己那一段**（`scoll.checkPressed()`
 * 之后的全部），逐段照抄，段与段之间的顺序就是结果。
 *
 * `whichHero` 与 `heroes` 由调用方传进来 —— 它们住在卷轴与世界上，不在这一页。
 */
export function equipCheckPressed(
  e: EquipPanelState,
  scoll: ScollState,
  heroes: MenuHero[],
  x: number,
  y: number,
  music: string[],
): void {
  // 1. 三个换人分支。**并列的 if，不是 if-else**，照抄。
  //    ⚠️ 换人一律把列表拨回武器（`CURRENTLIST=WEAPON`），并且**不出声** ——
  //    那一声「换头像.wav」是 `Scoll.checkPressed()` 出的，不是这里。
  //    「编号 → 卷轴上的字段名」这张表由 `types.ts` 一处owns，调用方不重建。
  for (const { hero, field } of SCOLL_HEROES) {
    if (!scoll[field].isclicked) continue
    e.currentPackHero = hero
    e.heroEquipment = e.packs[hero]!.weapon
    e.abandon.isDraw = e.heroEquipment !== null
    e.currentList = 'weapon'
    reselectFirst(e)
  }

  // 2. 六颗槽位按钮 + 使用 / 弃用，各派一次命中判据。
  for (const slot of EQUIP_SLOTS) pressButton(e.slots[slot]!, x, y)
  pressButton(e.use, x, y)
  pressButton(e.abandon, x, y)

  // 3. `judgeCurrentPack()`：换槽位。**if-else 链**，第一个命中的说了算。
  judgeCurrentPack(e, music)

  // 4. 「使用」。先判使用者，通过了才进 `doUseButton()`。
  if (e.use.isclicked) {
    // ⚠️ 原版这里没有 null 判断，`currentEquipment` 为 null 时 NPE。到不了：
    // `signal==0` 时 `use.isDraw=No`，而 `MenuButton.isPressedButton` 整个跳过。
    if (e.currentEquipment === null) throw new Error('「使用」被点中，但没有选中的装备')
    const spec = specOf(e.currentList, e.currentEquipment)
    if (spec.user === 0 || spec.user === scoll.whichHero) {
      doUseButton(e, scoll.whichHero, heroes, music)
    } else {
      e.warnCannotUse = true
    }
  }

  // 5. 「弃用」。
  if (e.abandon.isclicked) {
    if (e.heroEquipment === null) throw new Error('「弃用」被点中，但身上什么都没穿')
    const worn = specOf(e.currentList, e.heroEquipment)
    music.push('弃用.wav')
    setCount(e, e.currentList, worn.name, equipCount(e, e.currentList, worn.name) + 1)
    applyBonus(heroes, scoll.whichHero, worn, -1)
    e.heroEquipment = null
    e.packs[e.currentPackHero]![e.currentList] = null
    reselectFirst(e)
  }
}

/** `judgeCurrentPack()`：六个 `else if`，换列表、换 `heroEquipment`、出声、重挑。 */
function judgeCurrentPack(e: EquipPanelState, music: string[]): void {
  const hit = EQUIP_SLOTS.find((slot) => e.slots[slot]!.isclicked)
  if (!hit) return
  e.currentList = hit
  e.heroEquipment = e.packs[e.currentPackHero]![hit]
  music.push('换list.wav')
  reselectFirst(e)
}

/** 每个槽位穿上时的那一声（`doUseButton()` 里六个 case 各一句 `readmusic`）。 */
const EQUIP_SOUND: Readonly<Record<EquipSlot, string>> = {
  weapon: '武器.wav',
  armor: '盔甲.wav',
  helmet: '头盔.wav',
  shoe: '靴子.wav',
  glove: '手套.wav',
  decoration: '首饰.wav',
}

/**
 * `doUseButton()`：槽位空着才穿得上，否则记下"已装备"这条拒绝。
 *
 * ⚠️ **拒绝的判据是「槽位上有东西」，不是「跟身上那件重名」。** 换一件更好的
 * 武器要先弃用旧的 —— 原版就是这么设计的，`menu-equip` 第 12→13 步走的正是
 * 「先弃用、再穿另一件」。
 */
function doUseButton(
  e: EquipPanelState,
  whichHero: ScollHero,
  heroes: MenuHero[],
  music: string[],
): void {
  if (e.heroEquipment !== null) {
    e.warnEquipped = true
    return
  }
  if (e.currentEquipment === null) throw new Error('doUseButton 没有选中的装备')
  const spec = specOf(e.currentList, e.currentEquipment)
  e.warnEquipped = false
  const left = equipCount(e, e.currentList, spec.name) - 1
  setCount(e, e.currentList, spec.name, left)
  // ⚠️ **只有减到 0 才 signal=0**，而 `currentEquipment` 留在原处不动 ——
  // 真值里于是出现 `selected: -1` 配 `selectedName: "月苗刀"`：选中的那件
  // 已经不在列表里了，名字却还在。
  if (left === 0) {
    e.signal = 0
    e.use.isDraw = false
  } else {
    e.signal = 1
  }
  e.packs[e.currentPackHero]![e.currentList] = spec.name
  e.heroEquipment = spec.name
  music.push(EQUIP_SOUND[e.currentList])
  applyBonus(heroes, whichHero, spec, 1)
}

/** `checkAllButtonMoveIn()` 里装备页那一段：`isMoveIn()` 在前，按钮判据在后。 */
export function equipCheckMoveIn(e: EquipPanelState, x: number, y: number): void {
  equipRowMoveIn(e, x, y)
  for (const slot of EQUIP_SLOTS) moveInButton(e.slots[slot]!, x, y)
  moveInButton(e.use, x, y)
  moveInButton(e.abandon, x, y)
}

/**
 * `EquipPanel.isMoveIn()`：鼠标落在列表第几行上。
 *
 * 命中带从 `y_start_point-22` 起，每行 22 高，**开区间两头都不含**
 * （`currentY > originalY && currentY < originalY+22`）—— 行与行之间那一条线
 * 上谁都不选中。⚠️ 命中了**不会 break**，也不会在没命中时清掉选中项：
 * 鼠标移开列表时上一次选的那件还留着。照抄。
 *
 * 唯一加进来的东西是滚动位置（xl-6lo.13）：整排带子往上挪 `offset` 行，
 * 卷上去的那几行不再参与。`offset == 0` 时这个循环与原版逐字相同 ——
 * **包括框外那几行照样点得中**，`menu-scroll` 第 9 / 10 步就点在那里。
 * 理由与那条唯一的例外见 `scroll.ts` 的文件头注。
 */
function equipRowMoveIn(e: EquipPanelState, x: number, y: number): void {
  const list = equipList(e)
  if (list.length === 0) return
  const offset = clampScroll(EQUIP_LIST_VIEW, list.length, e.scroll)
  for (let i = offset; i < list.length; i++) {
    const rowY = rowBandTop(EQUIP_LIST_VIEW, i, offset)
    if (
      x > EQUIP_LIST_VIEW.hitLeft &&
      x < EQUIP_LIST_VIEW.hitRight &&
      y > rowY &&
      y < rowY + EQUIP_ROW_H
    ) {
      e.currentEquipment = list[i]!.name
      e.signal = 1
      e.use.isDraw = true
    }
  }
}

/** `checkAllButtonReleased()` 里装备页那一段。 */
export function equipCheckReleased(e: EquipPanelState, x: number, y: number): void {
  for (const slot of EQUIP_SLOTS) releaseButton(e.slots[slot]!, x, y)
  releaseButton(e.use, x, y)
  releaseButton(e.abandon, x, y)
}

/**
 * `EquipPanel.paint()` 那三处**改状态**的绘制，按 `drawThisPanel()` 里的次序：
 * `drawEquipment`（算差值）→ `drawWarning`（出声）→ `drawHeroStuff`（开关「弃用」）。
 *
 * ⚠️ 两个拒绝旗标**不在这里清**。原版是 `drawWarning()` 出声的同一段就把它们
 * 清零，而 `MenuDriver` 在 paint **之前**把它们抓进真值 —— 也就是说真值里的
 * 读数是"这一步置的位"。在这里清的话，那两列永远是 false，一份"从来没有
 * 拒绝发生过"的实现，而它看上去完全正常。清位在 `stepMenu` 每步开头。
 */
export function paintEquip(e: EquipPanelState, music: string[]): void {
  // **这一帧的「弃用」画不画，在这里就定了** —— 下面那句 `drawHeroStuff()`
  // 改的是**下一帧**的事。理由见 `abandonDrawn` 那个字段的注释。
  e.abandonDrawn = e.abandon.isDraw
  // drawEquipment → showValueDifference()：只有 signal==1 时才算，else 那半
  // 留着上一次的陈值（真值那时记 null，看不见）。
  if (e.signal === 1) e.diff = computeDiff(e)
  // drawWarning()：两声「禁止」。
  if (e.warnEquipped) music.push('禁止.wav')
  if (e.warnCannotUse) music.push('禁止.wav')
  // drawHeroStuff()：身上有东西才画「弃用」。
  e.abandon.isDraw = e.heroEquipment !== null
}

/**
 * `showValueDifference()`：身上有同类装备时算**差**，空着时直接给**绝对值**。
 *
 * 两支不一样是有观测后果的 —— 真值 `menu-equip` 第 8 步（刚弃用完，身上是空的）
 * 记的是藏璎环的绝对加成 `{0,0,3,2}`，第 4 步（身上有月苗刀）记的是差
 * `{0,-1,1,1}`。
 */
function computeDiff(e: EquipPanelState): EquipDiff {
  if (e.currentEquipment === null) throw new Error('signal=1 却没有选中的装备')
  const cur = specOf(e.currentList, e.currentEquipment)
  const worn = e.heroEquipment === null ? null : specOf(e.currentList, e.heroEquipment)
  const at = (pick: (s: EquipmentSpec) => number) => (worn ? pick(cur) - pick(worn) : pick(cur))
  return {
    physicalPower: at((s) => s.addPhysicalPower),
    agile: at((s) => s.addAgile),
    strength: at((s) => s.addStrength),
    spirit: at((s) => s.addSpirit),
  }
}

/** 装备页那一列的快照，字段名与 `MenuDriver.equipJson()` 逐字对应。 */
export function snapshotEquip(e: EquipPanelState): Record<string, unknown> {
  const list = equipList(e)
  const names = list.map((item) => item.name)
  const equipped: Record<string, string | null> = {}
  for (const slot of EQUIP_SLOTS) equipped[slot] = e.packs[e.currentPackHero]![slot]
  return {
    tab: e.currentList,
    packHero: e.currentPackHero,
    list: list.map((item) => ({ name: item.name, count: equipCount(e, e.currentList, item.name) })),
    // 选中那件**不在列表里**时是 -1（刚穿上、存货减到 0 的那一步），而
    // `selectedName` 照样留着名字。两列分开记，就是为了让这件事看得见。
    selected: e.currentEquipment === null ? -1 : names.indexOf(e.currentEquipment),
    selectedName: e.currentEquipment,
    signal: e.signal,
    worn: e.heroEquipment,
    equipped,
    useDraw: e.use.isDraw,
    abandonDraw: e.abandon.isDraw,
    warnEquipped: e.warnEquipped,
    warnCannotUse: e.warnCannotUse,
    diff: e.signal === 1 ? diffOrThrow(e) : null,
  }
}

/**
 * `signal==1` 时 `diff` 必须已经算出来了（那一步末尾的 `paintEquip` 算的）。
 * 少一次 paint 的话这里应当**响**，而不是安安静静地记一份空对象 ——
 * `{...null}` 是 `{}`，逐字段比对会说"少了四个键"，指向的却是错的地方。
 */
function diffOrThrow(e: EquipPanelState): EquipDiff {
  if (e.diff === null) throw new Error('signal=1 却还没算过属性差值 —— 这一步漏了 paintEquip')
  return e.diff
}

/** 每一步开头清掉两个拒绝旗标 —— 见 `paintEquip` 的注释。 */
export function clearEquipWarnings(e: EquipPanelState): void {
  e.warnEquipped = false
  e.warnCannotUse = false
}

/**
 * 三个人里的某一个，按**卷轴上的编号**（1/2/4）取。
 *
 * ⚠️ `SCOLL_HEROES`（1/2/4）与 `MENU_HERO_ORDER`（张 / 陆 / 玉）**必须同序**，
 * 否则"给张小凡穿的东西加到了陆雪琪身上"，而两个人的属性都是合法数字。
 * 同序这件事由 `equipPanel.test.ts` 核。
 *
 * 名字里带 `menu` 是为了和 `battle/snapshot.ts` 那个同名但不相干的 `heroOf`
 * 分开 —— 两个都进过同一个文件的进口清单时，认错一个不会有任何提示。
 */
export function menuHeroOf(heroes: MenuHero[], who: ScollHero): MenuHero {
  const index = SCOLL_HEROES.findIndex((h) => h.hero === who)
  if (index < 0) throw new Error(`卷轴上没有 ${who} 号`)
  const h = heroes[index]
  if (!h) throw new Error(`没有 ${who} 号`)
  return h
}
