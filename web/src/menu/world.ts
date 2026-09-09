import { menuButton } from './buttons'
import { createMenuHeroes } from './heroes'
import { HEAD_H, HEAD_POS, HEAD_W, TABS, TAB_H, TAB_W, TAB_Y, tabX } from './layout'
import type { MenuPanelName, MenuSubPanel, MenuTabKey, MenuWorld, ScollState } from './types'

/**
 * 建一份菜单世界。参数就是**菜单剧本**里 `setup` 那几行
 * （`docs/trace-format.md` §菜单剧本），一个字段都不从行为真值里读状态。
 */
export interface MenuConfig {
  /** `SaveAndLoad.zhang/lu/wen`。⚠️ 玉洁那一位在这里的键是 **`wen`**，不是 `yu`。 */
  readonly party: readonly string[]
  readonly fullHeal: boolean
}

/**
 * 四个子面板的**建立次序**，逐个对应 `MenuPanel` 构造函数里那四段 `new`。
 *
 * 次序是有意义的：`MenuDriver.tick()` 按这个次序推四条 run 线程的循环体，
 * 而真值就是那么导出来的。四者互不相干（各自的 `Mouse` 只读自己面板的
 * currentX/Y），所以次序今天影响不到结果 —— 但"今天影响不到"不是"随便写"。
 */
export const MENU_PANEL_ORDER: readonly MenuPanelName[] = [
  'thingPanel',
  'magicPanel',
  'funcPanel',
  'equipPanel',
]

/** `MenuPanel` 两个构造函数的最后一句都是 `currentPanel=thingPanel`。 */
export const MENU_FIRST_PANEL: MenuPanelName = 'thingPanel'

/** 页签键 → 它切到哪个子面板。`Command.checkPressed` 里那四条分支。 */
export const PANEL_OF_TAB: Readonly<Record<MenuTabKey, MenuPanelName>> = {
  thing: 'thingPanel',
  equip: 'equipPanel',
  magic: 'magicPanel',
  func: 'funcPanel',
}

/**
 * `Command.checkPressed` 里那串 if-else 的**分支顺序** —— 物品 / 奇术 / 天书 /
 * 装备，与 `addGameButton()` 建按钮的顺序（物品 / 装备 / 奇术 / 天书）**不同**。
 *
 * 今天两者观测不出差别（四颗按钮互不重叠，一次按下最多一颗 `isclicked`），
 * 但它是一串 if-**else**：真有两颗同时 `isclicked` 时，顺序就是结果。照抄。
 */
export const TAB_PRIORITY: readonly MenuTabKey[] = ['thing', 'magic', 'func', 'equip']

function createScoll(): ScollState {
  const at = (hero: number) => {
    const pos = HEAD_POS.find((p) => p.hero === hero)
    if (!pos) throw new Error(`卷轴上没有 ${hero} 号头像`)
    // `initial()`：一号 Yes，二号与四号 No。出战名单是靠 `checkMoveIn` /
    // `drawScoll` 后来才把它们打开的。
    return menuButton(pos.x, pos.y, HEAD_W, HEAD_H, hero === 1)
  }
  return { whichHero: 1, hero1: at(1), hero2: at(2), hero4: at(4) }
}

function createSubPanel(name: MenuPanelName): MenuSubPanel {
  return {
    name,
    currentX: 0,
    currentY: 0,
    mouse: { code: 0, frame: 0, x: 0, y: 0 },
    // 天书页没有卷轴：`FuncPanel` 的构造函数不建 `Scoll`，所以真值里它的
    // `hero` 是 `null`。给它编一个卷轴出来，那一列就再也不会是 null 了。
    scoll: name === 'funcPanel' ? null : createScoll(),
  }
}

export function createMenuWorld(config: MenuConfig): MenuWorld {
  const panels = {} as Record<MenuPanelName, MenuSubPanel>
  for (const name of MENU_PANEL_ORDER) panels[name] = createSubPanel(name)

  const tabs = {} as Record<MenuTabKey, ReturnType<typeof menuButton>>
  for (const tab of TABS) {
    tabs[tab.key] = menuButton(tabX(tab.multiple), TAB_Y, TAB_W, TAB_H, true)
  }

  return {
    panel: MENU_FIRST_PANEL,
    currentX: 0,
    currentY: 0,
    panels,
    tabs,
    heroes: createMenuHeroes(config.fullHeal),
    party: {
      zhang: config.party.includes('zhang'),
      lu: config.party.includes('lu'),
      wen: config.party.includes('wen'),
    },
    music: [],
    tick: 0,
  }
}
