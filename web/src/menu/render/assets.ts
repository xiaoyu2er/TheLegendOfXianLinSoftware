import { menuAssetId } from '../../assets/menuAssets'
import { magicAnimationFrameIds, magicButtonIds } from './magicSkills'
import { battleAssetId } from '../../assets/battleAssets'
import type { AssetId } from '../../assets/ids'
import { EQUIP_SLOTS } from '../equipment'
import type { EquipSlot } from '../equipment'
import { equipPictureIdOf } from '../equipmentPictures'
import { equipList } from '../equipPanel'
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
 * 物品页「使用」按钮的三态贴图（`DrugPanel.addButton()` 里那三行
 * `new ImageIcon("sources/菜单/物品/使用N.png")`）。
 *
 * `物品/` 整个目录在骨架那一半里（首页的整屏背景就在它下面），所以这三张
 * **随主包一起到手**，不走按需加载。
 */
export function useButtonId(image: ButtonImage): AssetId {
  return id(`物品/使用${STATE_SUFFIX[image]}.png`)
}

/** 物品页那一页额外要用到的贴图 —— 今天就是「使用」按钮那三态。 */
export function thingButtonIds(): AssetId[] {
  return (Object.keys(STATE_SUFFIX) as ButtonImage[]).map((image) => useButtonId(image))
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
  // 物品页那颗「使用」按钮。⚠️ 按 `isDraw` 决定画不画是绘制清单的事，
  // 贴图这一头一律先要过来 —— 选中一瓶药之后再去取图，那一帧会缺一颗按钮。
  if (w.panel === 'thingPanel') ids.push(...thingButtonIds())
  // 奇术页那十五颗技能按钮，外加**正在放的那一条动画整条的帧**（xl-6lo.11）。
  //
  // ⚠️ 整条一起推，不是只推当前那一帧：`load()` 是 async 而 `draw()` 不是，
  // 逐帧现取的话动画每一拍都要等一次网络 —— 表现是"动画卡成幻灯片"，而
  // 每一帧最终都画得出来，看不出是漏了什么。整条 37 帧一次要齐才跟得上
  // 100 ms 一拍。
  const magic = w.panels.magicPanel.magic
  if (w.panel === 'magicPanel' && magic) {
    ids.push(...magicButtonIds())
    if (magic.current) ids.push(...magicAnimationFrameIds(magic.current.hero, magic.current.skill))
  }
  // 装备页那八颗按钮 + 两张拒绝提示 + 升降数字（xl-6lo.9）。`装备/` 走按需，
  // `伤害值数字/` 在主包里（它是 `image/` 下的战斗素材）。
  if (w.panel === 'equipPanel') ids.push(...equipTextureIds(), ...equipPictureIds(w))
  return ids
}

/**
 * 装备页那两张装备图（xl-234）要用到的贴图 —— **背包里这一页能选中的每一件，
 * 加上身上穿着的那一件**。
 *
 * ⚠️ **不是只推"此刻选中的那一件"**，理由与奇术页那条动画同一个（见
 * `menuTextureIds` 里那段）：`load()` 是 async 而 `draw()` 不是，逐张现取的
 * 表现是"点中一行之后画面先空一下"—— 而选中哪一行完全由下一次输入决定。
 * 分母是 `equipList(e)`（背包里有的那几件），**不是整张表**：选不中的东西
 * 取回来只是白下载，而背包通常只有几件。
 *
 * 已知缺失的那三张 `equipPictureId` 返回 `null`，这里一并滤掉 —— 原版在那
 * 三处画的也是一个宽度 −1 的空壳，什么都没画。
 */
export function equipPictureIds(w: MenuWorld): AssetId[] {
  const e = w.panels.equipPanel.equip
  if (!e) return []
  const names = new Set(equipList(e).map((item) => item.name))
  if (e.heroEquipment !== null) names.add(e.heroEquipment)
  const ids: AssetId[] = []
  for (const name of names) {
    const id = equipPictureIdOf(e.currentList, name)
    if (id !== null) ids.push(id)
  }
  return ids
}

/**
 * 装备页那八颗按钮的贴图词干（`EquipPanel.addButton()` 里读图那十六行）。
 *
 * ⚠️ **六颗槽位按钮只有两张图**：`new MenuButton(…, image1, image2, image1, this)`
 * —— 第三个参数（按下时那张）传的是 `image1`，也就是**常态图**。
 * 「使用 / 弃用」那两颗才是三张各一张。照着「三态三张」写会去要一个
 * `武器3.png`，而那个文件根本不存在 —— 表现是按下去那一颗按钮消失了。
 */
export type EquipButtonKey = EquipSlot | 'use' | 'abandon'

const EQUIP_BUTTON_STEM: Readonly<Record<EquipButtonKey, string>> = {
  weapon: '武器',
  armor: '盔甲',
  helmet: '头盔',
  shoe: '靴子',
  glove: '护臂',
  decoration: '饰品',
  use: '使用',
  abandon: '弃用',
}

/** 只有这两颗有第三张图（按下时）。 */
const EQUIP_BUTTON_HAS_PRESSED: readonly EquipButtonKey[] = ['use', 'abandon']

export function equipButtonId(key: EquipButtonKey, image: ButtonImage): AssetId {
  const n =
    image === 'pressed' && !EQUIP_BUTTON_HAS_PRESSED.includes(key) ? 1 : STATE_SUFFIX[image]
  return id(`装备/${EQUIP_BUTTON_STEM[key]}${n}.png`)
}

/** 两条拒绝路径各自那张提示图（`EquipPanel` 构造函数里读的那两张）。 */
export function warningId(which: 'equipped' | 'cannotUse'): AssetId {
  return id(`装备/${which === 'equipped' ? '已装备' : '不能使用'}.png`)
}

/**
 * 升降数字那个箭头。`ShowValue.getCurrentImages()` 里那两张：
 * `上升.png`（type=1）与 `下降.png`（type=2）。
 */
export function showValueArrowId(down: boolean): AssetId {
  return id(`装备/${down ? '下降' : '上升'}.png`)
}

/**
 * 升降数字的一位。`ShowValue.loadImage()` 先读 `伤害/0..9`（下标 0..9）再读
 * `回复/0..9`（下标 10..19），而 `switchNum(num, offset)` 的 offset 是
 * **type=1 传 0、type=2 传 10** —— 也就是上升用「伤害」那套图、下降用「回复」
 * 那套。两套对调在画面上是两排都长得像数字的图，谁都看不出来。
 *
 * ⚠️ 它在 `image/` 下，所以走 `battleAssetId` 而不是菜单那一支。
 */
export function showValueDigitId(digit: number, down: boolean): AssetId {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
    throw new Error(`升降数字只有 0..9，收到 ${digit}`)
  }
  return battleAssetId(`image/伤害值数字/${down ? '回复' : '伤害'}/${digit}.png`)
}

/**
 * 装备页那一页要用到的全部按钮 / 提示 / 升降数字贴图。
 *
 * 与 `funcButtonIds()` 同形、也放在同一个文件里：**ID 这件事整个归这一层**。
 * 放到 `equipDraw.ts` 里会让 `assets.ts` 反过来进口它，而那两个模块本来就是
 * `equipDraw → assets` 的单向依赖 —— 绕成环之后谁都说不清哪一边先初始化。
 */
export function equipTextureIds(): AssetId[] {
  const ids: AssetId[] = []
  const keys: readonly EquipButtonKey[] = [...EQUIP_SLOTS, 'use', 'abandon']
  for (const key of keys) {
    for (const image of Object.keys(STATE_SUFFIX) as ButtonImage[]) {
      ids.push(equipButtonId(key, image))
    }
  }
  ids.push(warningId('equipped'), warningId('cannotUse'))
  for (const down of [false, true]) {
    ids.push(showValueArrowId(down))
    for (let digit = 0; digit <= 9; digit++) ids.push(showValueDigitId(digit, down))
  }
  return [...new Set(ids)]
}
