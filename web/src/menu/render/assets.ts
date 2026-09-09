import { menuAssetId } from '../../assets/menuAssets'
import type { AssetId } from '../../assets/ids'
import type { ButtonImage, MenuPanelName, MenuTabKey, MenuWorld } from '../types'
import type { FuncMainKey, FuncSubKey } from '../funcButtons'

/**
 * 菜单骨架用得到的逻辑 ID。**路径逐字照抄原版那几处 `new ImageIcon(...)` /
 * `Reader.readImage(...)`**，判据在 `assets.test.ts`（从 GBK 源码里现读）。
 *
 * 边界（谁进主包、谁按需加载）由 `assets/menuAssets.ts` 定，这一层不重复它：
 * 骨架 = `菜单` / `scoll` / `鼠标图` / `物品` 四个目录，其余三页的整屏背景走
 * `resolveDeferredMenuAsset`。
 */

function id(relative: string): AssetId {
  return menuAssetId(`sources/菜单/${relative}`)
}

/** 四页各自的整屏背景（`readBackgroundImage()`）。 */
export const MENU_BACKGROUND: Readonly<Record<MenuPanelName, AssetId>> = {
  thingPanel: id('物品/物品3.png'),
  magicPanel: id('奇术/奇术.png'),
  funcPanel: id('天书/天书.png'),
  equipPanel: id('装备/装备4.png'),
}

/** 顶栏那条 `标题栏.png`。 */
export const COMMAND_BAR: AssetId = id('菜单/标题栏.png')

/** 四颗页签的三态贴图。`标题物品1/2/3.png` 依次是常态 / 待点 / 按下。 */
const TAB_STEM: Readonly<Record<MenuTabKey, string>> = {
  thing: '标题物品',
  equip: '标题装备',
  magic: '标题奇术',
  func: '标题天书',
}

/** 三态 → 原版文件名末尾那个数字。`GameButton` 的三张图就是这个次序。 */
const STATE_SUFFIX: Readonly<Record<ButtonImage, 1 | 2 | 3>> = {
  normal: 1,
  waitclick: 2,
  pressed: 3,
}

export function tabId(key: MenuTabKey, image: ButtonImage): AssetId {
  return id(`菜单/${TAB_STEM[key]}${STATE_SUFFIX[image]}.png`)
}

/** 卷轴底图：`whichHero` 决定贴 `卷轴1/2/4`（3 号宋大仁原版没做进菜单）。 */
export function scollId(whichHero: number): AssetId {
  return id(`scoll/卷轴${whichHero}.png`)
}

/** 「等级」那两个字的贴图。 */
export const LEVEL_LABEL: AssetId = id('scoll/等级.png')

/**
 * 卷轴上三颗头像的三态贴图。命名不规则，照抄：一号是 `hero1/hero12/hero13`，
 * 二号 `hero2/hero22/hero23`，四号 `hero4/hero42/hero43`。
 */
export function headId(hero: number, image: ButtonImage): AssetId {
  const n = STATE_SUFFIX[image]
  return id(`scoll/hero${hero}${n === 1 ? '' : n}.png`)
}

/** 游标那八张图。`Mouse.getImage()` 拼的是 `鼠标图/<1..8>.png`，下标从 0 起。 */
export function mouseId(frame: number): AssetId {
  return id(`鼠标图/${frame + 1}.png`)
}

/**
 * 天书页那批按钮的贴图词干，按原版 `FuncButtons.addButton()` 里读图那几行。
 *
 * **走按需加载**（`天书/` 整个目录在 `menuAssets` 那条边界的内容那一半），
 * 所以只在真的翻到天书页时才取。
 */
const FUNC_STEM: Readonly<Record<FuncMainKey | FuncSubKey, string>> = {
  saveButton: '存档',
  readButton: '提取',
  setButton: '设定',
  returnButton: '返回',
  exitButton: '退出',
  setBGM: '背景音乐',
  setClick: '特殊音效',
  setKey: '键盘设定',
  on_BGM: '开',
  off_BGM: '关',
  on_click: '开',
  off_click: '关',
  exitForSure: '确认离开',
  restart: '重新开始',
}

export function funcButtonId(key: FuncMainKey | FuncSubKey, image: ButtonImage): AssetId {
  return id(`天书/${FUNC_STEM[key]}${STATE_SUFFIX[image]}.png`)
}

/** 天书页那一页要用到的全部按钮贴图（十四颗 × 三态，`开`/`关` 两对共用）。 */
export function funcButtonIds(): AssetId[] {
  const ids = new Set<AssetId>()
  for (const key of Object.keys(FUNC_STEM) as (FuncMainKey | FuncSubKey)[]) {
    for (const image of Object.keys(STATE_SUFFIX) as ButtonImage[]) {
      ids.add(funcButtonId(key, image))
    }
  }
  return [...ids]
}

/** 骨架里**恒定的**那几张（顶栏 + 四颗页签三态 + 游标八帧 + 等级）。 */
export function menuSkeletonIds(): AssetId[] {
  const ids: AssetId[] = [COMMAND_BAR, LEVEL_LABEL]
  for (const key of Object.keys(TAB_STEM) as MenuTabKey[]) {
    for (const image of Object.keys(STATE_SUFFIX) as ButtonImage[]) ids.push(tabId(key, image))
  }
  for (let frame = 0; frame < 8; frame++) ids.push(mouseId(frame))
  for (const hero of [1, 2, 4]) {
    for (const image of Object.keys(STATE_SUFFIX) as ButtonImage[]) ids.push(headId(hero, image))
  }
  for (const hero of [1, 2, 4]) ids.push(scollId(hero))
  return ids
}

/**
 * 这一帧要用到的全部贴图 —— 骨架那批加上**当前页**的整屏背景。
 *
 * 背景按当前页取，是因为另外三页的背景走按需加载（4.74 MiB）：一次把四张都
 * 要过来，等于把"按需"变回"打开菜单就全下"。
 */
export function menuTextureIds(w: MenuWorld): AssetId[] {
  const ids = [MENU_BACKGROUND[w.panel], ...menuSkeletonIds()]
  // 天书页那一排按钮 —— 出菜单唯一那条路（「返回」）就在上面，**画不出来
  // 等于玩家出不去**（/code-review 的 Spec 轴提的）。
  if (w.panel === 'funcPanel') ids.push(...funcButtonIds())
  return ids
}
