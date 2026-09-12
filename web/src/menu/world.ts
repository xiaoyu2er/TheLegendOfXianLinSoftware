import { menuButton } from './buttons'
import { createEquipPanel } from './equipPanel'
import { createFuncButtons } from './funcButtons'
import { createDrugPack, createDrugPanelState } from './drugPanel'
import { createMagicState } from './magic'
import { applyMenuLevelUps, createMenuHeroes, refreshMenuHeroes } from './heroes'
import type { LiveParty } from './heroes'
import type { PartyKey } from '../battle/units'
import { HEAD_H, HEAD_POS, HEAD_W, TABS, TAB_H, TAB_W, TAB_Y, tabX } from './layout'
import { SCOLL_HEROES } from './types'
import type {
  MenuAudioSettings,
  MenuPanelName,
  MenuSubPanel,
  MenuTabKey,
  MenuWorld,
  ScollState,
} from './types'

/**
 * 建一份菜单世界。参数就是**菜单剧本**里 `setup` 那几行
 * （`docs/trace-format.md` §菜单剧本），一个字段都不从行为真值里读状态。
 */
export interface MenuConfig {
  /** `SaveAndLoad.zhang/lu/wen`。⚠️ 玉洁那一位在这里的键是 **`wen`**，不是 `yu`。 */
  readonly party: readonly string[]
  readonly fullHeal: boolean
  /**
   * 背包里的药（`setup.drugs`）。`DrugPack.addDrug` 是**累加**，同一个名字
   * 写两行就是两次加。缺席等于六种药一瓶都没有 —— 而那正是一个干净进程的
   * 样子（`ShopReader.readDrug` 不给 `numberGOT` 赋值）。
   */
  readonly drugs?: readonly { readonly name: string; readonly count: number }[] | undefined
  /**
   * 队伍此刻的等级与血 / 灵力（`switchTo("menu")` 那三句 `refreshValue()`）。
   * **回放真值时不喂** —— 见 `heroes.ts` 的 `LiveParty`。
   */
  readonly live?: Readonly<Partial<Record<PartyKey, LiveParty>>> | undefined
  /**
   * 音频那两个开关的**当前值**（`MusicPlayer` 的两个 static）。
   *
   * 不喂就是两个都开着 —— 那是原版那两个字段的初值（`CAN_PLAY_BGM = 1`、
   * `CAN_PLAY_MUSIC = 1`），也是导出真值那个干净 JVM 的起手态。
   */
  readonly audio?: Readonly<MenuAudioSettings> | undefined
  /**
   * 剧本 `setup.equipment` —— 开局往背包里放的那几件装备。
   *
   * **它是开局状态，不是期望值**：原版六张装备表的持有量全是 0，不给点东西的话
   * 装备页永远是空的（`MenuScript` 的注释里写着同一句）。而它加进去的时机是
   * **面板建好之后**，见 `createEquipPanel`。
   */
  readonly equipment?: readonly { readonly name: string; readonly count: number }[] | undefined
  /**
   * 剧本 `setup.levelUps`（xl-03x.17）—— 开局让谁升几级，键与 `party` 同一套
   * （`zhang` / `lu` / `wen`）。**开局状态，不是期望值**：导出器调的是原版自己的
   * `levelUp()`，这边调 `levelUpMenuHero`，技能格数怎么涨由两边各自的实现说了算。
   */
  readonly levelUps?: Readonly<Record<string, number>> | undefined
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
  const scoll = { whichHero: 1 } as ScollState
  for (const { hero, field } of SCOLL_HEROES) scoll[field] = at(hero)
  return scoll
}

function createSubPanel(name: MenuPanelName, config: MenuConfig): MenuSubPanel {
  return {
    name,
    currentX: 0,
    currentY: 0,
    mouse: { code: 0, frame: 0, x: 0, y: 0 },
    // 天书页没有卷轴：`FuncPanel` 的构造函数不建 `Scoll`，所以真值里它的
    // `hero` 是 `null`。给它编一个卷轴出来，那一列就再也不会是 null 了。
    scoll: name === 'funcPanel' ? null : createScoll(),
    funcButtons: name === 'funcPanel' ? createFuncButtons() : null,
    // 物品页那一份只有 `thingPanel` 有 —— 另外三页没有「使用」按钮，
    // 给它们编一个出来的话"这一页没有物品"与"这一页有个点不着的按钮"就
    // 长得一样了。
    drug: name === 'thingPanel' ? createDrugPanelState() : null,
    magic: name === 'magicPanel' ? createMagicState() : null,
    equip: name === 'equipPanel' ? createEquipPanel(config.equipment) : null,
  }
}

export function createMenuWorld(config: MenuConfig): MenuWorld {
  const panels = {} as Record<MenuPanelName, MenuSubPanel>
  for (const name of MENU_PANEL_ORDER) panels[name] = createSubPanel(name, config)

  const tabs = {} as Record<MenuTabKey, ReturnType<typeof menuButton>>
  for (const tab of TABS) {
    tabs[tab.key] = menuButton(tabX(tab.multiple), TAB_Y, TAB_W, TAB_H, true)
  }

  const heroes = createMenuHeroes(config.fullHeal, config.live)
  // `MenuDriver.start()` 里升级在 `new MenuPanel()`（穿开局武器）之后、`fullHeal` 之前；
  // 升级自己就把血拉满，所以与 `createMenuHeroes` 里那句 `fullHeal` 谁先谁后结果相同。
  applyMenuLevelUps(heroes, config.levelUps)

  return {
    panel: MENU_FIRST_PANEL,
    currentX: 0,
    currentY: 0,
    panels,
    tabs,
    heroes,
    drugPack: createDrugPack(config.drugs),
    party: {
      zhang: config.party.includes('zhang'),
      lu: config.party.includes('lu'),
      wen: config.party.includes('wen'),
    },
    music: [],
    // 不喂就是原版那两个 static 的初值：两个都开着。
    audio: { bgm: config.audio?.bgm ?? true, sfx: config.audio?.sfx ?? true },
    tick: 0,
  }
}

/**
 * `GameLauncher.switchTo("menu")` 那个 case 的**全部可观测内容**：换面板，
 * 外加三句 `refreshValue()`。菜单世界从开机活到关机（xl-6lo.18），所以
 * "开菜单"这件事在这一层是**刷新**，不是重建。
 *
 * 两样要刷：三个人（队伍那一份），与音频那两个开关。后者原版是 `static`、
 * 根本不用刷 —— 刷是因为这一层把它们放在世界上（`types.ts` 的
 * `MenuAudioSettings`），而别处（今天没有，明天有存档）可能改得动它。
 *
 * ⚠️ **能刷的只有这两样，这是有意的**：装备槽位、全局背包、当前在哪一页、
 * 四个 `Mouse` 的计数器、两条列表的滚动位置全都**原样留着**，因为原版那一份
 * `MenuPanel` 就那么留着。刷多了的表现是"关一次菜单丢一样"。
 */
export function refreshMenuWorld(
  w: MenuWorld,
  config: Pick<MenuConfig, 'live' | 'audio'> & {
    /**
     * 药包此刻的六个数，按 `DRUGS` 的次序（xl-bsv）。原版物品页读的就是 static 的
     * `DrugPack.drugList`，所以打开那一刻看到的是商店、宝箱、战斗、读档之后的数。
     * 不给就不动（回放真值那条路的药来自剧本 setup，建世界时就定了）。
     */
    readonly drugs?: readonly number[] | undefined
  },
): void {
  // ⚠️ **原地改，不还一份新的**（返回 `void` 是有意的）：还了 `MenuWorld` 的话
  // 它读起来像 `create*` 那族的不可变写法，而唯一的调用点根本没接返回值 ——
  // 下一个人照那个签名写 `const next = refreshMenuWorld(...)` 会以为原来那份
  // 没被动过。菜单世界的规矩是就地改（`types.ts` 文件头注）。
  refreshMenuHeroes(w.heroes, config.live)
  if (config.drugs) {
    const drugs = config.drugs
    // `createDrugPack` 按 `DRUGS` 的次序建满六条，所以下标对得上；对不上就是
    // 两边读的药表分了家 —— 抛，不按名字去猜。**就地改件数**：物品页那个
    // `currentDrug` 认的是名字，条目对象换掉也不要紧，但就地改最省一次推理。
    if (drugs.length !== w.drugPack.length) {
      throw new Error(`药包有 ${drugs.length} 个数，菜单的存货有 ${w.drugPack.length} 条`)
    }
    w.drugPack.forEach((stock, i) => {
      stock.count = drugs[i]!
    })
  }
  if (config.audio) {
    w.audio.bgm = config.audio.bgm
    w.audio.sfx = config.audio.sfx
  }
}
