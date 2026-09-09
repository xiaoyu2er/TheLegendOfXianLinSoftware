import { menuButton, moveInButton, pressButton, releaseButton } from './buttons'
import type { MenuAudioSettings, MenuButtonState } from './types'

/**
 * 天书页那一排按钮（`menu.FuncButtons`）—— **整页**：五颗主按钮、设定与退出
 * 两组子菜单的展开收起、BGM 开关，以及三颗背后接空实现的按钮（xl-6lo.12）。
 *
 * 存档 / 提取的后半段（进 ls 面板、真的存与读）归 **M6**，退出与重开的后半段
 * 归 **M7**（xl-6lo.2 §边界跟真值走）。那三颗**照画、照响应三态、点得响**，
 * 背后是空实现 —— 不画或者禁用都会引入一个原版没有的差异：真值第 0 帧的
 * `func.drawn` 就写着六个按钮名，而禁用会让三态贴图少画一态。
 *
 * ⚠️ `setKey`（键盘设定）是这一页最反直觉的一颗，**三件事同时成立**：
 *
 * 1. **开局就 `isDraw=Yes`** —— `addButton()` 末尾那两层循环只关
 *    `subButtonList[1..4]`，而 `setKey` 一个数组都没进去。真值第 0 帧的
 *    `func.drawn` 里有它，就是这么来的。
 * 2. **永远画不出来** —— `drawFuncButtons()` 只遍历 `buttonList` 与
 *    `subButtonList[1..4]`，同样漏掉它。
 * 3. **永远点不响** —— `checkPressed()` 里那句 `if(setKey.isIsclicked())` 下面
 *    确实写着 `//重新设置键盘`，可给子按钮派命中判据的那两层循环也只走
 *    `subButtonList[1..4]`：`setKey.isclicked` **没有任何一条路能置真**，
 *    那一支是死代码。
 *
 * 也就是说「键盘设定」比票面说的"点下去只展开子按钮、没有功能"还空一层 ——
 * 它连点都点不着。三条都是原版的，别去调和它们，更不要"顺手实现"它
 * （ADR-0001：原版缺陷全部复刻；缺陷登记 xl-1dv.16）。
 */

/** `addButton()` 里那五个局部常量。 */
const X = 400
const Y = 150
const W = 88
const H = 50
const SUB_Y = 230
const SUB_W = 145
const SUB_H = 40
const Y_MOVE = 10
const ON_W = 40
const ON_H = 40

/** 五颗主按钮，次序同 `buttonList[0..4]`。 */
export type FuncMainKey = 'saveButton' | 'readButton' | 'setButton' | 'returnButton' | 'exitButton'

export const FUNC_MAIN_ORDER: readonly FuncMainKey[] = [
  'saveButton',
  'readButton',
  'setButton',
  'returnButton',
  'exitButton',
]

/** 子按钮，按原版字段名。开局除 `setKey` 外一律不画。 */
export type FuncSubKey =
  | 'setBGM'
  | 'setClick'
  | 'setKey'
  | 'on_BGM'
  | 'off_BGM'
  | 'on_click'
  | 'off_click'
  | 'exitForSure'
  | 'restart'

/**
 * `subButtonList[1..4]` 那四组，逐组照抄。**下标从 1 起是原版的**：
 * `subButtonList` 声明成 `new MenuButton[5][]`，`[0]` 一直是 `null`，
 * 而每一处遍历都写 `for(int i=1;i<5;i++)`。这里用数组下标 0..3 表示第 1..4 组，
 * 换算只在 `subGroup()` 一处。
 *
 * ⚠️ **`setKey` 不在任何一组里**（见文件头注）：它既不被展开收起的循环碰到，
 * 也不被命中判据的循环碰到，还不被绘制的循环碰到。
 */
export const FUNC_SUB_GROUPS: readonly (readonly FuncSubKey[])[] = [
  ['setBGM', 'setClick'], // subButtonList[1] —— 设定
  ['on_BGM', 'off_BGM'], // subButtonList[2] —— 背景音乐 开 / 关
  ['on_click', 'off_click'], // subButtonList[3] —— 特殊音效 开 / 关
  ['exitForSure', 'restart'], // subButtonList[4] —— 确认离开 / 重新开始
]

/**
 * 子按钮的绘制次序，逐个对应 `drawFuncButtons()` 里那两层循环走的
 * `subButtonList[1..4]`。**从分组现摊平**，不再手抄第二遍 —— 抄第二遍时
 * 漏掉的那一颗，两处都漏，判据全绿。
 */
export const FUNC_SUB_ORDER: readonly FuncSubKey[] = FUNC_SUB_GROUPS.flat()

/** 十四颗按钮的字段名。真值 `func.drawn` 的取值域就是它按字段名排序之后的子集。 */
export const FUNC_ALL_KEYS: readonly (FuncMainKey | FuncSubKey)[] = [
  ...FUNC_MAIN_ORDER,
  ...FUNC_SUB_ORDER,
  // 唯一一颗哪个循环都碰不到的（见文件头注）。
  'setKey',
]

export interface FuncButtonsState {
  readonly main: Readonly<Record<FuncMainKey, MenuButtonState>>
  readonly sub: Readonly<Record<FuncSubKey, MenuButtonState>>
  /** 「返回」这一步被按下了 —— 会话读它，把面板换回场景。 */
  exitToScene: boolean
}

export function createFuncButtons(): FuncButtonsState {
  const main = {} as Record<FuncMainKey, MenuButtonState>
  FUNC_MAIN_ORDER.forEach((key, i) => {
    // `x_move` 恒为 0，所以那几个 `+n*x_move` 项一律是 0。照抄倍数即可。
    main[key] = menuButton(X + i * W, Y, W, H, true)
  })
  const sub: Record<FuncSubKey, MenuButtonState> = {
    setBGM: menuButton(X + 2 * W, SUB_Y, SUB_W, SUB_H, false),
    setClick: menuButton(X + 2 * W, SUB_Y + (Y_MOVE + SUB_H), SUB_W, SUB_H, false),
    // ⚠️ 唯一开局就画的子按钮 —— 见文件头注。
    setKey: menuButton(X + 2 * W, SUB_Y + 2 * (Y_MOVE + SUB_H), SUB_W, SUB_H, true),
    on_BGM: menuButton(X + 4 * W, SUB_Y - Y_MOVE, ON_W, ON_H, false),
    off_BGM: menuButton(X + 4 * W, SUB_Y + 2 * Y_MOVE + 10, ON_W, ON_H, false),
    on_click: menuButton(X + 4 * W, SUB_Y - Y_MOVE + SUB_H, ON_W, ON_H, false),
    off_click: menuButton(X + 4 * W, SUB_Y + 2 * Y_MOVE + 10 + SUB_H, ON_W, ON_H, false),
    exitForSure: menuButton(X + 4 * W, SUB_Y, SUB_W, SUB_H, false),
    restart: menuButton(X + 4 * W, SUB_Y + (Y_MOVE + SUB_H), SUB_W, SUB_H, false),
  }
  return { main, sub, exitToScene: false }
}

/** 第 `n` 组（1..4）那两颗。下标换算只在这一处，见 `FUNC_SUB_GROUPS`。 */
function subGroup(fb: FuncButtonsState, n: number): MenuButtonState[] {
  const group = FUNC_SUB_GROUPS[n - 1]
  if (!group) throw new Error(`subButtonList 没有第 ${n} 组`)
  return group.map((key) => fb.sub[key])
}

/**
 * `subButtonList[1..4]` 全体，按组次序。
 *
 * 原版每一处都写死 `for(int i=1;i<5;i++)`，而这里上界从 `FUNC_SUB_GROUPS`
 * **现算** —— 分组表多一组时写死的 5 会把它静默漏掉，而"漏掉一组"的表现是
 * 那两颗按钮点不响、也收不起来，跟"本来就没有它们"长得一模一样
 * （`docs/agents/dispatch.md` 纪律 3）。
 */
function allSubButtons(fb: FuncButtonsState): MenuButtonState[] {
  return FUNC_SUB_GROUPS.flatMap((group) => group.map((key) => fb.sub[key]))
}

/** `for(int i=1;i<5;i++) for(MenuButton b:subButtonList[i]) b.isDraw=Yes/No;` */
function setAllGroups(fb: FuncButtonsState, isDraw: boolean): void {
  for (const b of allSubButtons(fb)) b.isDraw = isDraw
}

/** `for(MenuButton button:subButtonList[n]) button.isDraw=Yes/No;` */
function setGroup(fb: FuncButtonsState, n: number, isDraw: boolean): void {
  for (const b of subGroup(fb, n)) b.isDraw = isDraw
}

/**
 * 这一页**现在画得出来**的按钮，按字段名排序 —— 真值 `func.drawn` 那一列。
 *
 * 排序不是审美：导出器那边是 `Class.getDeclaredFields()` 按
 * `Comparator.comparing(Field::getName)` 排过的（`MenuDriver.funcJson`），
 * 而声明顺序未经规范保证。这里的键名与原版字段名逐字相同，`sort()` 的
 * UTF-16 序在纯 ASCII 上与 Java 的 `String.compareTo` 一致。
 */
export function drawnFuncButtons(fb: FuncButtonsState): string[] {
  return FUNC_ALL_KEYS.filter((key) => funcButtonOf(fb, key).isDraw)
    .map((key) => String(key))
    .sort()
}

/** 按字段名取一颗按钮 —— 主按钮与子按钮分在两个 record 里，取的时候不必知道。 */
export function funcButtonOf(fb: FuncButtonsState, key: FuncMainKey | FuncSubKey): MenuButtonState {
  return key in fb.main
    ? fb.main[key as FuncMainKey]
    : fb.sub[key as FuncSubKey]
}

/**
 * `FuncButtons.checkPressed`，逐段照抄。段与段之间的**顺序就是结果**，
 * 所以下面按原版的编号分段，一段都不合并。
 *
 * `tabsClicked` 是 `command.buttonList` 里有没有哪一颗 `isclicked` ——
 * 原版第一段读的正是那四颗页签，而这一层的页签挂在世界上、不挂在这一页上。
 *
 * ⚠️ **两处不对称，都是原版的，别去抹平**：
 *
 * - 第 4 段（特殊音效）与第 8/9 段（音效开 / 关）**没有**开头那句"先全收起来"，
 *   而第 3 段（背景音乐）有。于是从退出子菜单直接点「特殊音效」时，
 *   `subButtonList[4]` 那两颗是被第 4 段自己那句 `isDraw=No` 收掉的，
 *   而不是被开头那句。结果相同，路径不同 —— 哪天有人给第 4 段"补上"开头
 *   那句，真值不会变，所以这条只能靠照抄守住。
 * - 第 9 段（音效关）**一声都不出**，第 8 段（音效开）那声在 `openMusic()`
 *   **之后**才发，而第 6 段（背景音乐开）那声在 `openBGM()` **之前**。
 */
export function funcCheckPressed(
  fb: FuncButtonsState,
  tabsClicked: boolean,
  x: number,
  y: number,
  music: string[],
  audio: MenuAudioSettings,
): void {
  // ——— 第 0 段：任何一颗页签被按下，子菜单全收起来 ———
  if (tabsClicked) setAllGroups(fb, false)

  // ——— 五颗主按钮的命中判据 ———
  for (const key of FUNC_MAIN_ORDER) pressButton(fb.main[key], x, y)

  // ——— 主按钮那一串 if-**else**：第一颗命中的就收工 ———
  if (fb.main.saveButton.isclicked) {
    music.push('换list.wav')
    setAllGroups(fb, false)
    // 空实现：原版这里切到存档面板（`lsPanel` + `SAVE`）。存档 → **M6**（xl-i06）。
  } else if (fb.main.readButton.isclicked) {
    music.push('换list.wav')
    setAllGroups(fb, false)
    // 空实现：原版这里切到存档面板（`lsPanel` + `LOAD`）。提取 → **M6**（xl-i06）。
  } else if (fb.main.setButton.isclicked) {
    music.push('换list.wav')
    setAllGroups(fb, false)
    setGroup(fb, 1, true)
  } else if (fb.main.returnButton.isclicked) {
    music.push('换list.wav')
    // ⚠️ 原版这一支里 `switchTo("scene")` 写在那个 `for` 的**循环体内**，
    // 于是连调四次。四次与一次同效，照抄的是可观测的那一半。
    setAllGroups(fb, false)
    fb.exitToScene = true
  } else if (fb.main.exitButton.isclicked) {
    music.push('换list.wav')
    setAllGroups(fb, false)
    setGroup(fb, 4, true)
  }

  // ——— 子按钮的命中判据。**只有 subButtonList[1..4]**，`setKey` 不在其中 ———
  for (const b of allSubButtons(fb)) pressButton(b, x, y)

  // ——— 第 3..11 段：并列的 `if`，不是 if-else。多颗同时命中时全都跑 ———

  // 3
  if (fb.sub.setBGM.isclicked) {
    music.push('换list.wav')
    setAllGroups(fb, false)
    setGroup(fb, 1, true)
    setGroup(fb, 2, true)
  }
  // 4 —— 注意：**没有**开头那句全收起来（见文件头注）。
  if (fb.sub.setClick.isclicked) {
    music.push('换list.wav')
    setGroup(fb, 1, true)
    setGroup(fb, 2, false)
    setGroup(fb, 3, true)
    setGroup(fb, 4, false)
  }
  // 5 —— **死代码**：`setKey.isclicked` 没有任何一条路能置真（见文件头注）。
  //      原版这里是 `//重新设置键盘` 加一片空白，ADR-0001 说复刻这个空。
  if (fb.sub.setKey.isclicked) {
    music.push('换list.wav')
    setAllGroups(fb, false)
    setGroup(fb, 1, true)
    // 「键盘设定」本身没有任何功能 —— 原版注释下面一行代码都没有。
    // **不要"顺手实现"它**（xl-1dv.16）。
  }
  // 6
  if (fb.sub.on_BGM.isclicked) {
    music.push('换list.wav')
    setGroup(fb, 1, true)
    setGroup(fb, 2, true)
    setGroup(fb, 3, false)
    setGroup(fb, 4, false)
    // `MusicReader.openBGM()`：重放当前那首并把 `CAN_PLAY_BGM` 拨回 YES。
    audio.bgm = true
  }
  // 7
  if (fb.sub.off_BGM.isclicked) {
    music.push('换list.wav')
    setGroup(fb, 1, true)
    setGroup(fb, 2, true)
    setGroup(fb, 3, false)
    setGroup(fb, 4, false)
    // `MusicReader.closeBGM()`：`CAN_PLAY_BGM=NO`，播放线程下一个缓冲块就 break。
    audio.bgm = false
  }
  // 8 —— ⚠️ 那一声在 `openMusic()` **之后**。
  if (fb.sub.on_click.isclicked) {
    setGroup(fb, 1, true)
    setGroup(fb, 2, false)
    setGroup(fb, 3, true)
    setGroup(fb, 4, false)
    audio.sfx = true
    music.push('换list.wav')
  }
  // 9 —— ⚠️ 这一支**一声都不出**。
  if (fb.sub.off_click.isclicked) {
    setGroup(fb, 1, true)
    setGroup(fb, 2, false)
    setGroup(fb, 3, true)
    setGroup(fb, 4, false)
    audio.sfx = false
  }
  // 10 —— 重新开始。原版 `switchTo("start")`；后半段 → **M7**（xl-czb）。
  if (fb.sub.restart.isclicked) {
    music.push('换list.wav')
    setGroup(fb, 1, false)
    setGroup(fb, 2, false)
    setGroup(fb, 3, false)
    setGroup(fb, 4, true)
  }
  // 11 —— 确认离开。原版 `System.exit(0)`；后半段 → **M7**（xl-czb）。
  if (fb.sub.exitForSure.isclicked) {
    music.push('换list.wav')
    setAllGroups(fb, false)
    setGroup(fb, 4, true)
  }
}

/**
 * `FuncButtons.checkReleased`：五颗主按钮 + `subButtonList[1..4]`。
 *
 * ⚠️ `isRelesedButton` **不看 `isDraw`**（`MenuButton` 没覆写它），所以收起来
 * 的子按钮照样会被松开事件清掉 `isclicked` —— 没有这一条，收起来时正
 * `isclicked` 的那一颗会一直挂着真，下一次展开时凭空自己触发一遍。
 */
export function funcCheckReleased(fb: FuncButtonsState, x: number, y: number): void {
  for (const key of FUNC_MAIN_ORDER) releaseButton(fb.main[key], x, y)
  for (const b of allSubButtons(fb)) releaseButton(b, x, y)
}

/** `FuncButtons.checkMoveIn`：同上的名单。三态贴图的「待点」那一态靠它。 */
export function funcCheckMoveIn(fb: FuncButtonsState, x: number, y: number): void {
  for (const key of FUNC_MAIN_ORDER) moveInButton(fb.main[key], x, y)
  for (const b of allSubButtons(fb)) moveInButton(b, x, y)
}
