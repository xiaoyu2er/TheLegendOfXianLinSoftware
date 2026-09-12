import { advanceBattle, createBattleTicker } from '../battle/loop'
import { advanceMenu, createMenuTicker } from '../menu/loop'
import type { MenuTicker } from '../menu/loop'
import {
  applyMenuInput,
  clearMenuExit,
  clearMenuSaveLoad,
  clearMenuTitle,
  menuSaveLoadRequest,
  menuWantsScene,
  menuWantsTitle,
} from '../menu/step'
import { applySaveLoadInput } from '../saveload/step'
import type { SaveLoadInput, SaveLoadPorts } from '../saveload/step'
import { createSaveLoadWorld } from '../saveload/world'
import type { SaveLoadFrom, SaveLoadMode, SaveLoadWorld } from '../saveload/world'
import type { MenuInput } from '../menu/step'
import { createMenuWorld, refreshMenuWorld } from '../menu/world'
import type { SfxPlayer } from '../audio/sfxPlayer'
import type { BattleTicker } from '../battle/loop'
import { createBattle } from '../battle/world'
import type { BattleConfig } from '../battle/world'
import type { BattleInput } from '../battle/step'
import type { BattleWorld } from '../battle/types'
import type { MenuWorld } from '../menu/types'
import type { PartyKey } from '../battle/units'
import { attributesOf, getParty, rememberMenuParty, rememberParty } from '../fakes/party'
import type { PartyMemberState } from '../fakes/party'
import { addCoins, getCoins, reduceCoins } from '../fakes/wallet'
import { addDrug, drugCount } from '../fakes/drugPack'
import { DRUGS } from '../battle/drugs'
import { EQUIP_SLOTS } from '../menu/equipment'
import { addEquipment } from '../menu/equipPanel'
import type { EquipSlot } from '../menu/equipment'
import type { SelectRecord } from '../state/select'
import { applyShopInput, stepShop } from '../shop/step'
import type { ShopInput } from '../shop/step'
import { createShopWorld } from '../shop/world'
import type { ShopKind } from '../shop/layout'
import type { ShopWorld } from '../shop/types'
import type { LiveParty } from '../menu/heroes'
import { getAudioSettings, openBgm, rememberAudioSettings } from './audioSettings'
import { settleSceneRequests } from './sceneLedger'
import { TITLE_BGM } from '../start/assets'
import { advance, createTicker } from '../state/loop'
import type { Ticker } from '../state/loop'
import type { SceneSource } from '../state/step'
import { BATTLE_INFO_COLUMNS, COL_BACKGROUND, COL_PARTY, enemySlots } from '../state/fight'
import type { BattleInfo } from '../state/fight'
import { NO_REQUESTS } from '../state/types'
import type { InputEvent, World } from '../state/types'
import { saveSlotsView } from '../save/store'
import type { SaveSlotsView, SaveStore } from '../save/store'
import { WORN_HEROES, captureSave } from '../save/capture'
import { readBack } from '../save/format'
import type { NeverReadBack, ReadBack, SaveFile } from '../save/format'
import { heroesFromSave } from '../save/load'
import { worldAfterLoad } from '../state/load'
import { setParty } from '../fakes/party'
import { setCoins } from '../fakes/wallet'
import { setDrugCount } from '../fakes/drugPack'
import { advanceEnd, createEndLoop, createEndWorld, startEnd } from '../end/world'
import type { EndLoop, EndWorld } from '../end/world'

/**
 * **面板机**：场景 ↔ 战斗 ↔ 标题（xl-rh9.17）↔ 菜单 ↔ 商店（xl-yg6.11）。
 *
 * 原版的这一层是 `GameLauncher.switchTo(...)` 加一个 `CardLayout` —— 八个
 * 面板全都活着，只有一个显示。这里只做已经移植过来的那几块：
 * `scenePanel` / `battlePanel` / `startPanel` / `menuPanel`，以及两家店
 * （`shopPanel` 与 `equipmentShopPanel` 共用一个 `'shop'`，见 `SHOP_OF_DOOR`）。
 * 标题那一屏本身是 DOM，画在
 * overlay 层里（`start/StartPanel.tsx`，xl-kaa）—— 这一层只负责说"现在该
 * 显示它了"，以及它该放哪首曲子（`currentBgm` 里那句 `TITLE_BGM`）。
 *
 * **开机停在标题上**（xl-q7f）：`createSession(deps)` 交出来的会话
 * `panel: 'start'`、`scene: null`，点「起」走 `enterScene(session, world)`
 * 才建世界。两处与原版的对应行写在那两个函数上。
 *
 * ## 为什么场景在战斗期间**照跑不误**
 *
 * `ScenePanel.run()` 是 `while(true){ step(); sleep(10); }`，一个线程，
 * `switchTo("battle")` 只换 `CardLayout` 显示的是谁，**不停那条线程**。
 * 所以打架的时候地图上的 NPC 还在走、对话定时器还在跑。这里照抄：每一拍
 * 两个世界都推。冻住场景是更省事的写法，但那会让"打完回来 NPC 站在哪"
 * 与原版分家，而那正是本票要守的"场景那边没被弄坏"。
 *
 * 唯一读"现在显示的是谁"的地方是 `ScenePanel.step()` 的第 1 步（旁白），
 * 所以 `World.showing` 只喂那一处。
 *
 * ## ⚠️ 这一段没有行为真值覆盖，凭什么算过
 *
 * 真值的边界正好落在战斗面板的两头：**进战斗之前、回场景之后都不在任何一份
 * trace 里**（`driver=scene` 的五份走的三个场景既没有 `battle0` 也没有
 * `battle1`；`driver=battle` 的 13 份从 `BattlePanel.initial()` 之后才开始，
 * 到切面板那一拍为止）。所以这一层的判据是另外三条，都在
 * `session.test.ts` 里，都能跑出红绿：
 *
 * 1. **一整条环路真的跑一遍**，两端都用真数据：从烘焙好的 `迷宫1` 建世界，
 *    喂方向键让主角**真的走**到第 30 格，看战斗是不是这一拍起的、起的是不是
 *    `battle0` 那两行之一；然后**一条输入都不喂**把战斗跑到全灭
 *    （怪自己会打），看它回到哪个面板。中间没有一个手写的状态字段。
 * 2. **回来之后场景那边逐字段没变**：主角像素坐标、当前脚本、NPC **名单**、
 *    `audio.bgm` —— 拿进战斗那一刻的快照比，而且**每一拍都比一遍**。
 *    比的是名单不是坐标：NPC 在战斗期间照样在走（原版那条线程没停），
 *    钉住坐标等于把一条与原版相反的不变量立成判据。
 * 3. **打赢那条路**用 `battle-victory` 那份真值的**剧本与输入**（不是它的
 *    状态）建一场战斗塞进会话里，跑到结算结束，看会话回没回场景、经验有没有
 *    记进队伍。
 */
export type Panel = 'scene' | 'battle' | 'start' | 'menu' | 'shop' | 'ls' | 'end'

/**
 * 原版 `GameLauncher.currentPanel` 此刻是哪一块（xl-czb.6）。
 *
 * 与 {@link Panel}（`CardLayout` 此刻**显示**的是哪一块）只差一处：`switchTo("end")`
 * 是八支里**唯一不更新 `currentPanel`** 的一支（`switcher.show(c,"endPanel")` +
 * `endPanel.start()`，没有第三句）。而它唯一的调用点在 `DialogueEvent.keyPressed`
 * —— 场景的按键分发里，所以进了结局 `currentPanel` **仍是场景面板**。
 */
export type CurrentPanel = Exclude<Panel, 'end'>

export function currentPanelOf(panel: Panel): CurrentPanel {
  return panel === 'end' ? 'scene' : panel
}

/**
 * 一次按键落到谁手里 —— 原版 `GameLauncher.keyPressed` 的三个 `if`：
 * `currentPanel == scenePanel / lsPanel / battlePanel` 才转，别的面板一个键都收不到。
 *
 * **结局在这里没有自己的一支**，而这不等于「键盘全哑」：`currentPanel` 仍是场景
 * （{@link currentPanelOf}），于是结局期间的每一个键都照旧交给看不见的场景面板 ——
 * 退出键在那里是开菜单（`ScenePanel.keyPressed` 的 `VK_ESCAPE → switchTo("menu")`），
 * **结局会被一个退出键切走**。真值 `end-credits` 末步 `key=escape / to=scene /
 * card=menuPanel / current=menu`；xl-czb.6 的主干裁定照复刻（ADR-0001：它是原版量出来
 * 的行为，不是缺陷）。判据在 `end/endTrace.test.ts`。
 */
export function keyReceiver(panel: Panel): 'scene' | 'ls' | 'battle' | null {
  const current = currentPanelOf(panel)
  return current === 'scene' || current === 'ls' || current === 'battle' ? current : null
}

/**
 * 选择框那两扇商店门 → 进哪一家（xl-yg6.11）。
 *
 * 原版是两步：`switchTo("shop")` 把卡片翻到 `shopPanel`，而那张卡片上挂的
 * 是 `ShopPanel`（药店）；`"equipmentShop"` → `equipmentShopPanel` →
 * `EquipmentShopPanel`（装备自选超市）。这一层两家店共用一个世界
 * （`shop/types.ts` 的头注），所以落到的是 `ShopWorld.active` 的两个取值。
 *
 * ⚠️ 这张表**有判据**，不是誊抄了事：`game/doors.test.ts` 现读原版
 * `GameLauncher.switchTo` 的卡片名（GBK）与导出器 `ShopDriver` 的 `open` 名
 * （UTF-8），逐支对撞
 * —— 「场景那侧记下的目标 == 对面那条剧本的起点」。
 */
export const SHOP_OF_DOOR: Readonly<Record<'shop' | 'equipmentShop', ShopKind>> = {
  shop: 'drug',
  equipmentShop: 'equipment',
}

/** 会话跟外界打交道的三样东西。全是入参，所以整个模块可以在 node 上跑。 */
export interface SessionDeps {
  /** 出口要进的下一个场景（同步）。见 `state/step.ts` 的 `SceneSource`。 */
  readonly scenes: SceneSource
  /** 怪物出场图的尺寸。`EnemySlector` 的九个字段要它。 */
  readonly sprite: BattleConfig['sprite']
  /**
   * `Math.random()` 的替身。**两处**读它：计步战斗挑哪一场（原版
   * `FightEvent.startBattle0`），以及新战斗的 `JavaRandom` 种子。
   *
   * 原版第二处根本没有种子：`calDamage` 直接调 `Math.random()`。这一层的
   * 战斗世界带一个 `JavaRandom`（真值要可复现），所以游戏本体得**现摇一个
   * 种子**出来 —— 那是这一层与原版的一处明写出来的差别，不是疏忽。
   *
   * @exception ADR-0001#random-streams-per-battle-and-shop
   */
  readonly random: () => number
  /**
   * 存档仓库（xl-i06.8）。**读写都是同步的**，对一份内存快照 —— 这一层从头到尾
   * 是同步纯函数，异步的「快照与浏览器存储对齐」在它外头（`save/store.ts`）。
   * 运行时是 `save/browserStore.ts`，测试与真值回放是 `save/memoryStore.ts`。
   */
  readonly saves: SaveStore
}

export interface Session {
  readonly panel: Panel
  /**
   * 场景那一侧。`null` = **这一局还没开始**（xl-q7f）—— 开机就是这个样子。
   *
   * 原版没有"空场景"这回事，它是**根本还没建**：`ScenePanel` 的构造函数只
   * 摆了三个字段（`currentScript`），`reader` / `map` / `role` 全是 null；
   * 建世界的是 `initiation(fileName)`，而唯一的调用点是「起」那一下
   * （`StartPanel.startLoadAction()` 的 case 0），推场景的那条线程也是在
   * 那一句的前后 `new Thread(...).start()` 起来的。也就是说**开机到点「起」
   * 之间，场景那一侧一个对象都没有、一拍都没推**。
   *
   * 所以这里是 `null` 而不是"一个空世界"：空世界推得动，而它推的是一份
   * 谁都没在看的状态 —— 那跟原版分家，且画面上完全看不出来。
   *
   * 开局之后它再也不会变回 `null`（`RunningSession`），全灭回标题也不会：
   * 原版那条线程从此再没停过。
   */
  readonly scene: Ticker | null
  /** 战斗那一侧。`null` = 这一局还没打过架，或者上一场已经收了。 */
  readonly battle: BattleTicker | null
  /**
   * 菜单那一侧。**从开机活到关机，永远不为 `null`**（xl-6lo.18）——
   * 菜单开没开着看 `panel === 'menu'`，不看这个字段。
   *
   * 原版的 `MenuPanel` 是 `GameLauncher` 构造函数里 `new` 的**一份**，
   * `switchTo("menu")` 只调三句 `refreshValue()`、不重建任何东西，而
   * `GameLauncher.init()`（唯一会重建它的地方）**没有人调** —— 它自己是活的
   * 源码，被注释掉的是它唯一的调用点（`StartPanel.startLoadAction()` 的
   * `//	Game.game.init();`）。也就是说那一份从开机活到关机。这里照抄，因为它顺手当了两样状态的家，而那两样
   * **在这一层没有别的出处**：
   *
   * - `EquipPanelState.packs` —— 六个槽位穿着什么（`equipPack_hero1/2/4`）；
   * - `EquipPanelState.owned` —— 六张装备表的持有量（那六个 list 是 `static`，
   *   是**全局背包**）。
   *
   * 顺带活过来的还有当前在哪一页、四个 `Mouse` 的计数器、两条列表的滚动位置。
   * （**活着**不等于**在走**：原版那四条 run 线程关着菜单也在跑，这一层没有，
   * 见 `advanceSession` 里那一段与 xl-6lo.19。）
   *
   * ⚠️ 起先这里是**每次开菜单新建一份**，理由写的是「那三句 `refreshValue()`
   * 说的就是每次打开都按最新属性重算一遍」。那句话对了一半：属性确实要刷
   * （`refreshMenuWorld`），但**重建把不该刷的一起丢了** —— 穿一件 +5 体力的
   * 盔甲、关菜单（xl-6lo.16 让属性 +5 记住了）、再开菜单，那件盔甲不在槽位里
   * 了，于是再穿一次变成 +10。判据在 `menuSession.test.ts`（xl-6lo.18）。
   */
  readonly menu: MenuTicker
  /**
   * 两家店那一份（xl-yg6.11）。`null` = **这一局还没进过店**。
   *
   * 原版 `GameLauncher` 构造函数里就把 `ShopPanel` 与 `EquipmentShopPanel`
   * 都 `new` 好了，存货在那一刻逐件 `Math.random()` 掷定、从此不变。这里推迟到
   * **头一次进门**才建：玩家进门之前看不见存货，两者观察不到差别；而开机就建
   * 会在 `createSession` 里多摇 `deps.random()` 一次，把每一条拿定值序列喂
   * 随机数的用例整体错一位 —— 那种错位在断言里只表现为"挑中的是另一场架"。
   *
   * 建好之后同菜单那一份一样**活到关机**：再进门不重建，存货与两家店各自的
   * 光标、店主上一句话都留着。
   *
   * ⚠️ 钱、药、装备**不以这里为准**：那三样在原版里是 static（`Money` /
   * `DrugPack` / `EquipmentPack`），这一层的落点分别是 `fakes/wallet.ts`、
   * `fakes/drugPack.ts` 与菜单装备页的 `owned`。进门时从那三处现读进来，
   * 店里每一步再写回去 —— 见 `enterShop` / `writeShopBack`。
   */
  readonly shop: ShopWorld | null
  /**
   * 存读档面板那一份（xl-i06.9）。`null` = **还没进过**。
   *
   * 原版 `lsPanel` 在 `GameLauncher` 构造函数里就 `new` 好了、从开机活到关机，面板上
   * `isRoleExist` 那份只置不清的记忆也就跟着活到关机（`saveload/world.ts` 的头注）。
   * 这里推迟到**头一次进面板、而且存档仓库已就绪**才建：开机时仓库可能还在从浏览器
   * 存储里读，那时建出来的摘要是一句谎话。建好之后再不重建。
   */
  readonly saveload: SaveLoadWorld | null
  /**
   * 进了存读档面板、但仓库还没就绪（`loading` / `failed`），面板世界还没法建 ——
   * 先把「以什么模式、从哪进来的」记在这里。就绪的那一拍补上那一下 `enter`
   * （`stepSaveLoad`）；没就绪之前退出键照样回得去。`null` = 没有悬着的。
   */
  readonly lsEntry: { readonly mode: SaveLoadMode; readonly from: SaveLoadFrom } | null
  /**
   * 读档点中了、**还没读进来**的那个槽。`null` = 没有。
   *
   * 点下去那一下原版是同步的：`loader.load(i)` → `switchTo("scene")`，中间没有空当。
   * 这一层多一段空当，因为要读进的那个场景的 JSON 是按需取的（`data/loadedScenes.ts`），
   * 而重建场景（{@link loadGame}）是同步的。所以分两步：面板那一下只记槽号（面板
   * **不切**：切回场景而不重建，画面上像读档成功了，而进度一样没回来）；调用方按
   * {@link loadTargetOf} 把场景取到手，再调 {@link loadGame}。空当里面板上不再收输入 ——
   * 原版此刻已经在场景里了。
   */
  readonly loadRequest: number | null
  /**
   * 结局面板那条线程（xl-czb.6）。`null` = **还没进过结局**。
   *
   * 原版 `endPanel` 在 `GameLauncher` 构造函数里就 `new` 好了，线程却是 `start()` 才起
   * （`switchTo("end")` 那一句）。所以这里推迟到头一次进结局才建 —— 在那之前它一拍
   * 都不走，两者观察不到差别。建好之后**再也不摘**：那条 `while(true)` 没有出口，
   * 被退出键切走（进了菜单）之后它照样每 100 ms 走一圈（`end/world.ts`）。
   *
   * ⚠️ 未复刻：原版「起」不重建 `endPanel`（`GameLauncher.init()` 的调用点被注释掉），
   * 所以那条线程与字幕停下的位置活过新局 —— 新局再走到 `$`，原版一进来就定格；这一层
   * 「起」整个重建会话（`NewGameCarry` 不带它），会从头再滚一遍。未量过。
 *
 * @exception ADR-0001#end-not-kept-across-new-game
   */
  readonly end: EndLoop | null
  /**
   * **这一次** `advanceSession` 里请求的音效文件名，按先后（xl-03x.7）。每次推进都
   * 重算，不是「当前该响什么」：菜单与商店真值的 `music` 是每步清空的瞬时量，所以
   * 这里是那几步各自的依次相接，交给 `audio/sfxPlayer.ts` 的 `play` 一拍一次
   * （{@link playSfx}）。空数组 = 这一拍没出声，**不是**「该静音了」。
   *
   * 四处往里收：场景（`World.sfxRequest`，开箱 / 答题那一声）、战斗（`BattleTicker.sfx`，
   * xl-b36）、菜单、商店。
   *
   * ⚠️ 它证的是「该响的时候调了播放器、参数对」，证不了玩家真的听到了。
   */
  readonly sfx: readonly string[]
  readonly deps: SessionDeps
}

/**
 * 已经开局的会话 —— 场景那一侧一定在。
 *
 * 有它是为了让"开局之后 `scene` 不再为空"这件事由类型来说，而不是靠一串
 * `!`：`enterScene` 交出它，`advanceSession` 收下它就还它一个（下面那对
 * 重载），于是调用方一路 `session.scene.world` 都不必断言。
 */
export interface RunningSession extends Session {
  readonly scene: Ticker
}

/** 一拍里到达的输入，按面板分开投递 —— 原版的 `keyPressed` 也是按面板分派的。 */
export interface SessionInput {
  readonly scene: readonly InputEvent[]
  readonly battle: readonly BattleInput[]
  /** 菜单里的鼠标事件。**没有键盘那一种** —— 见 `menu/step.ts` 的 `menuWantsScene`。 */
  readonly menu: readonly MenuInput[]
  /**
   * 店里的鼠标事件（xl-yg6.11）。与菜单一样**纯鼠标**：按下 / 松开 / 移动。
   * 可省：进店之前的每一处调用方都不必改。
   */
  readonly shop?: readonly ShopInput[]
  /** 存读档面板上的鼠标事件与退出键（xl-i06.9）。可省，理由同 `shop`。 */
  readonly saveload?: readonly SaveLoadInput[]
}

export const NO_INPUT: SessionInput = { scene: [], battle: [], menu: [], shop: [], saveload: [] }

/** 场景收不到键的那几拍喂它。常量，省得每拍新建一个数组。 */
const NO_KEYS: readonly InputEvent[] = []

/**
 * 起手态：**停在标题上，还没开局**（xl-q7f）。
 *
 * 原版 `GameLauncher` 构造函数的最后一句就是 `switchTo("start")` —— 开机
 * 进的是标题画面，不是脚本1。这里照抄那一句。
 *
 * ## `switchTo("start")` 里那句 `Clock.sleep(1000)` 不抄，它不是一秒卡顿
 *
 * 原版那一支是三句：`readBGM("主题曲.mp3")` → `sleep(1000)` → `openBGM()`。
 * 中间那一秒是**音频播放器的线程同步补丁**，不是给玩家看的停顿：
 *
 * - `MusicPlayer.play()` 起手 `isStop = true` 再 `while(!hasStop) sleep(10)`，
 *   等的是上一条 `PlayThread` 收工；
 * - 构造函数第一句是 `closeBGM()`（`CAN_PLAY_BGM = NO`），所以 `readBGM`
 *   起的那条播放线程一进循环就 `isStop = true` 当场 break，随后才把
 *   `hasStop` 置回 true；
 * - `openBGM()` 又调一次 `play()`。这一秒是留给上面那条线程跑完的 ——
 *   没有它，`play()` 可能在 `hasStop` 还是 true（线程尚未启动）时就往下走，
 *   于是两条播放线程、两条输出线抢同一个设备。
 *
 * 浏览器这边没有那对标志位：`audio/bgmPlayer.ts` 收到的是"该放哪首"，
 * 换曲子由它自己收尾。照抄成一秒延迟，等于把一个别人家的竞态修补，变成
 * 我们自己的一秒黑屏。
 *
 * @exception ADR-0001#title-bgm-sleep
 */
export function createSession(deps: SessionDeps, carry: NewGameCarry = NOTHING_CARRIED): Session {
  // 菜单**开机就建**，与原版同一句：`GameLauncher` 构造函数里那句
  // `menuPanel=new MenuPanel(zhangXiaoFan,luXueQi,yuJie)` 排在
  // `switchTo("start")` 之前。见 `Session.menu`。
  const menu = createGameMenu()
  if (carry.owned !== null) {
    const owned = ownedEquipment(menu)
    for (const slot of EQUIP_SLOTS) owned[slot].splice(0, owned[slot].length, ...carry.owned[slot])
  }
  return {
    panel: 'start',
    scene: null,
    battle: null,
    menu,
    shop: null,
    saveload: null,
    lsEntry: null,
    loadRequest: null,
    end: null,
    sfx: NO_SFX,
    deps,
  }
}

/** 这一拍没出声。常量，省得每拍新建一个数组。 */
const NO_SFX: readonly string[] = []

/**
 * 「起」带进新局的东西（xl-i06.11）：原版点「起」只做 `switchTo("scene")` +
 * `initiation("脚本1.txt")` + 起线程，**一样都不清**（`GameLauncher.init()` 那句被注释掉，
 * xl-lly）。这一层的「起」把会话整个重建（`game/useGame.ts` 的 `restart`），所以原版里活过
 * 「起」的东西要从上一局的会话里显式带过来 —— 除非它另有落点：
 *
 * - **钱、药**：落点是 `fakes/wallet.ts` / `fakes/drugPack.ts` 两个模块单例，重建会话碰不到，
 *   本来就带着，这里不管；
 * - **装备库存**（`EquipmentPack` 六张 static 表）：落点在菜单装备页的 `owned`
 *   （`Session.menu`），会话一重建就没了 —— `owned`；
 * - **答题记录**（`SelectEvent.mapName` / `answeredRecorder` 两张 static 表）：落点在场景世界的
 *   `recorder`，同样随会话没了 —— `recorder`，由调用方交给新世界（`createWorld` 第三个参数）。
 *
 * **不带**、归 xl-9rv 裁的：三个人的等级 / 血 / 经验（web 的「起」故意回出厂状态，xl-lly 的
 * 例外）、身上的装备（四项加成算在属性上，与等级绑在一起：只带装备不带属性，弃用那一下会把加成
 * 扣成负的）、剧情三元组 `currentScript` / `isLoad` / 任务文本（原版也活过「起」，于是「新局」的
 * 剧情接着上一局走；这一层的新世界回到开机值），以及菜单停在哪一页。JVM 读数与判据见
 * `game/loadResidue.test.ts` 最后一组。
 *
 * **也不带、而且上面那张名单漏了的**：两家店（`Session.shop`）。原版 `ShopPanel` /
 * `EquipmentShopPanel` 开机建一次、存货从此不变，活过「起」；这里会话一重建它就回到
 * `null`，新局头一次进门重掷存货（xl-03x.20 现查，读代码，未跑）。
 * @exception ADR-0001#new-game-rerolls-shop-stock
 */
export interface NewGameCarry {
  /** 上一局的装备库存；`null` = 没有上一局（开机）。 */
  readonly owned: Readonly<Record<EquipSlot, readonly number[]>> | null
  /** 上一局的答题记录；开机是空的。 */
  readonly recorder: readonly SelectRecord[]
}

const NOTHING_CARRIED: NewGameCarry = { owned: null, recorder: [] }

/** 从上一局的会话里取出「起」要带进新局的那几样（见 {@link NewGameCarry}）。`null` = 开机。 */
export function carryIntoNewGame(prev: Session | null): NewGameCarry {
  if (prev === null) return NOTHING_CARRIED
  const owned = ownedEquipment(prev.menu)
  return {
    owned: Object.fromEntries(EQUIP_SLOTS.map((s) => [s, [...owned[s]]])) as Record<EquipSlot, number[]>,
    recorder: prev.scene?.world.recorder ?? [],
  }
}

/**
 * 建游戏本体那一份菜单世界 —— `new MenuPanel(zhangXiaoFan,luXueQi,yuJie)`。
 *
 * 与回放真值那条路（`menu/replay.ts`）的区别只有两样：三个人从队伍现读、
 * 音频那两个开关从 `game/audioSettings.ts` 现读。背包里一件装备、一瓶药都
 * 没有 —— 那正是一个干净进程的样子，来源要等商店（M4 / xl-knp）。
 */
function createGameMenu(): MenuTicker {
  return createMenuTicker(
    createMenuWorld({
      // 见 `GAME_PARTY`：与商店读的是同一份名单。
      party: GAME_PARTY,
      fullHeal: false,
      live: liveParty(getParty()),
      // 原版那两个开关是 static，活得比菜单久（`game/audioSettings.ts`）。
      audio: getAudioSettings(),
    }),
  )
}

/**
 * 队伍那一份里**菜单看得见的那几样**（`LiveParty`）：等级、四项基础属性、
 * 血与灵力。派生值不喂 —— 菜单那边自己 `derive` 一遍，喂过去等于同一个事实
 * 有两个出处。
 */
function liveParty(carry: Readonly<Record<PartyKey, PartyMemberState>>) {
  const live = (m: PartyMemberState): LiveParty => ({
    level: m.level,
    ...attributesOf(m),
    hp: m.hp,
    mp: m.mp,
    skillNumber: m.skillNumber,
  })
  return { zhang: live(carry.zhang), lu: live(carry.lu), yu: live(carry.yu) }
}

/**
 * 开局了没有 —— `RunningSession` 的类型守卫。
 *
 * 要它而不是直接写 `session.scene !== null`，是因为后者只窄化那个属性，
 * **不窄化会话本身**，于是 `advanceSession` 挑不到还回 `RunningSession`
 * 的那条重载，调用方又得一路 `!`。
 */
export function isRunning(session: Session): session is RunningSession {
  return session.scene !== null
}

/**
 * 开局：建世界、进场景 —— 原版「起」那一下的
 * `switchTo("scene")` + `scenePanel.initiation("脚本1.txt")` + 那条线程。
 *
 * 进哪个场景由调用方决定（`useGame` 那边是 `sceneName`），因为原版这三句
 * 里只有 `initiation` 认文件名，别的两句对进哪个场景一无所知。
 *
 * 战斗那一侧一并清掉：原版这一下 `new` 的是一整套面板。
 */
export function enterScene(session: Session, world: World): RunningSession {
  // ⚠️ **菜单那一份不重建**：原版「起」那一下是三句
  // （`switchTo("scene")` + `initiation` + 起线程），一句都没碰 `menuPanel`。
  // 唯一重建它的 `GameLauncher.init()` 没有人调 —— 那个方法本身是活的源码，
  // 被注释掉的是它唯一的调用点（`StartPanel` 里那句 `//	Game.game.init();`）。
  return { ...session, panel: 'scene', scene: createTicker(world), battle: null }
}

/**
 * 按 ESC 开菜单 —— 原版 `ScenePanel.keyPressed` 里那句
 * `if (keyCode == VK_ESCAPE) GameLauncher.switchTo("menu")`。
 *
 * **只有场景那一屏进得去**：那句 ESC 在 `ScenePanel` 里，而顶层的 `keyPressed`
 * 只把键分发给场景 / 存档 / 战斗三家。菜单开着的时候当前面板是菜单，一个分支
 * 都不命中 —— 于是**进了菜单按 ESC 出不来**，出口只有天书页的「返回」
 * （`menu/step.ts` 的 `menuWantsScene`）。这是复刻，不是缺陷，缺陷登记 xl-1dv.*。
 *
 * 三个人的属性从队伍现读：`switchTo("menu")` 那三句 `refreshValue()` 说的
 * 就是「打开的那一刻看到的是最新的」。
 */
export function openMenu(session: RunningSession, carry = getParty()): RunningSession {
  // 那句 ESC 在 `ScenePanel.keyPressed` 里：键落到场景手里才开得了。**结局期间也落到
  // 场景手里**（`keyReceiver`），于是结局被切走 —— 照复刻（xl-czb.6）。
  if (keyReceiver(session.panel) !== 'scene') return session
  // 那一句还套在两层门里（xl-03x.16）：`if (!narratage.isNarratage)` 包着整个
  // `keyPressed`，`if (!dialogueEvent.isSpeaking)` 包着 ESC 那一支 —— 旁白播着、
  // 主线对话在说，都开不了。**口头语不挡**：ESC 在 `if (!npcEvent.isOral)` 那组
  // if/else 之后，所以这里读 `speaking`，不是 `dialogueActive()`。结局那条路不受
  // 影响：`DialogueEvent` 切到结局之前刚把 `isSpeaking` 置假。判据：`escGate.test.ts`。
  const { narratage, dialogue } = session.scene.world
  if (narratage.active || dialogue.speaking) return session
  // **刷新，不重建**（xl-6lo.18）：`switchTo("menu")` 那个 case 里除了换面板
  // 就只有三句 `refreshValue()`。装备槽位、全局背包、当前在哪一页原样留着。
  refreshMenuWorld(session.menu.world, { live: liveParty(carry), audio: getAudioSettings(), drugs: heldDrugs() })
  return { ...session, panel: 'menu' }
}

/**
 * 把 `Fight` 段那一行解成一场战斗的配置 —— `FightEvent.fight()` 的前半。
 *
 * 七列：背景图、`zhang`/`null`、`yu`/`null`、`lu`/`null`、三个槽位。
 * 判的是**逐字相等**（原版 `zhang.equals("zhang")`），所以写成别的什么词
 * 一律当成"没出战"，照抄。
 *
 * 等级从队伍现读（`fakes/party.ts`）—— 原版读的是那三个静态字段。
 */
export function configFor(
  info: BattleInfo,
  deps: SessionDeps,
  carry = getParty(),
): BattleConfig {
  if (info.length !== BATTLE_INFO_COLUMNS) {
    throw new Error(
      `Fight 段的一行应当是 ${BATTLE_INFO_COLUMNS} 列，实际 ${info.length} 列：${JSON.stringify(info)}`,
    )
  }
  // `if(zhang.equals("zhang"))` —— **逐字**相等才算出战，别的词一律不算。
  const present = (Object.keys(COL_PARTY) as PartyKey[]).filter(
    (key) => info[COL_PARTY[key]] === key,
  )
  return {
    background: info[COL_BACKGROUND]!,
    party: present,
    // 等级与其余几样出自**同一份** `carry`：分开取会让显式传 carry 的调用方
    // 拿到一份"等级是全局的、血是传进来的"的混合体。
    levels: { zhang: carry.zhang.level, yu: carry.yu.level, lu: carry.lu.level },
    // 四项基础属性也从队伍现读（xl-6lo.16）。原版根本不用搬：那三个类的属性
    // 字段是 `static`，菜单里穿的装备、喝的药改的就是战斗读的同一份。少了这
    // 一行，菜单里 1190 点上限的玉洁一进战斗就被 `refreshValue()` 夹回 980。
    attributes: {
      zhang: attributesOf(carry.zhang),
      yu: attributesOf(carry.yu),
      lu: attributesOf(carry.lu),
    },
    // 技能菜单几颗按钮（xl-03x.17）。原版读的是那三个 static，这一层读队伍。
    skillNumbers: { zhang: carry.zhang.skillNumber, yu: carry.yu.skillNumber, lu: carry.lu.skillNumber },
    // 药品菜单的存货（xl-byy）。原版读的是 static 的 `DrugPack.drugList`，
    // 这一层从药包现读；打的过程中每一拍写回（`advanceSession` 战斗那一段）。
    drugStock: heldDrugs(),
    enemies: enemySlots(info),
    // 原版这里没有种子（`Math.random()` 直调），见 `SessionDeps.random`。
    seed: Math.trunc(deps.random() * 0x7fffffff),
    sprite: deps.sprite,
    carry: { zhang: carry.zhang, yu: carry.yu, lu: carry.lu },
  }
}

/**
 * 推 `elapsedMs` 真实毫秒。
 *
 * 一拍里的次序照抄原版的两条线程：**场景先推**（它每 10 ms 一拍），推出来的
 * `battleRequest` 当场就切面板；然后才推战斗（100 ms 一拍）。反过来的话，
 * 起战斗的那一拍战斗世界会晚一整拍才开始动，而画面上看不出来。
 */
export function advanceSession(
  session: RunningSession,
  input: SessionInput,
  elapsedMs: number,
): RunningSession
export function advanceSession(
  session: Session,
  input: SessionInput,
  elapsedMs: number,
): Session
export function advanceSession(
  session: Session,
  input: SessionInput,
  elapsedMs: number,
): Session {
  // 存读档面板（xl-i06.9）排在最前：**标题上按「承」进来时还没开局**，下面那道
  // 「没开局就原样交回」会把它的输入整个吞掉。它只收自己的输入，不碰场景 ——
  // 场景那条线程照跑，就在下面。
  if (session.panel === 'ls' || session.lsEntry !== null) {
    session = stepSaveLoad(session, input.saveload ?? NO_SAVELOAD_INPUT)
  } else if (input.saveload !== undefined && input.saveload.length > 0) {
    // 面板藏着却收到了它的输入：按下时在它上面、松手落在切走之后（xl-o9z），见那里。
    session = grabbedSaveLoad(session, input.saveload)
  }
  const { deps } = session
  // 还没开局（xl-q7f）：原版这时 `ScenePanel` 那条线程根本没起来，没有世界
  // 可推。**原样交回去**，而不是推一个空世界 —— 见 `Session.scene`。
  //
  // 原样交回也不必清 `sfx`：没开局的会话从没推过菜单与商店，它恒为空（xl-03x.7）。
  if (session.scene === null) return session
  // ——— 结局那条线程（xl-czb.6）———
  //
  // 进过结局就一直在走，**不看当前显示的是谁**：`EndPanel.run()` 是 `while(true)`，
  // 被退出键切进菜单之后它照样每 100 ms 走一圈（`isStop` 之后那一圈什么都不改）。
  // 排在场景前面：这一拍刚进结局的话，线程是这一拍才起的，不该吃这一拍的时间。
  if (session.end !== null) advanceEnd(session.end, elapsedMs)
  let panel = session.panel
  let battle = session.battle
  let menu = session.menu
  /** 这一拍各步请求的音效，逐步收（见 `Session.sfx`）。 */
  const heard: string[] = []

  // ——— 场景那条线程 ———
  //
  // ⚠️ **菜单开着的时候场景照跑不误** —— 与战斗期间一样，理由也一样：
  // `ScenePanel.run()` 是 `while(true){ step(); sleep(10); }` 一条线程，
  // `switchTo("menu")` 只换 `CardLayout` 显示的是谁（`GameLauncher.switchTo`
  // 的 case "menu" 只有 `switcher.show` + `currentPanel=` + 三句
  // `refreshValue()`），**不停那条线程**。
  //
  // ⚠️⚠️ **这一条与 xl-6lo.8 的票面写反了。** 票面与 xl-6lo.2 都写着「菜单
  // 打开时背后的场景停住 / 场景在背后是冻住的」，实测不成立：那两处是从
  // 「CardLayout 八面板之一」推出来的，而 CardLayout 管的是画谁，不是谁在跑。
  // 唯一读「现在显示的是谁」的地方是 `ScenePanel.step()` 第 1 步那个旁白判据
  // （`GameLauncher.currentPanel.equals(GameLauncher.scenePanel)`），所以这里
  // 照战斗那一份把 `showing` 喂过去就够了。冻住场景是更省事的写法，但那会让
  // 「翻完菜单回来 NPC 站在哪」与原版分家，而 ADR-0001 说复刻原版。
  // 判据在 `session.test.ts`「菜单开着时场景照跑」那一条（连同从 GBK 源码
  // 现读 `switchTo` 的 case "menu" 里没有任何停线程的动作）。
  const before: Ticker = {
    ...session.scene,
    // 原版旁白那道门比的是 `currentPanel` 而不是显示的是谁 —— 结局期间它仍是场景
    // （`currentPanelOf`）。
    world: { ...session.scene.world, showing: currentPanelOf(panel) === 'scene' },
  }
  // ⚠️ **不显示的时候一个键都收不到** —— `GameLauncher` 那个 KeyListener 的
  // `keyPressed` / `keyReleased` 两个方法都从 `if(currentPanel==scenePanel)`
  // 起手。所以菜单（以及战斗）开着的时候主角**站住不动**，而地图上的 NPC、
  // 对话定时器照走。
  //
  // **这才是票面那句「场景停步」的真正内容**，而它只对了一半：停的是玩家的
  // 输入，不是那条线程。（本票起先把整句都判成假的，是 /code-review 的 Spec
  // 轴把另一半找回来的。）
  //
  // ⚠️ 顺带复刻一个坑：按住方向键的时候开菜单，那一下**松手事件也被吃掉**
  // （`keyReleased` 同一个门），于是回到场景主角还在往那边走，要再按一次
  // 那个键才停。原版就是这样，ADR-0001 说照抄。
  let scene = advance(
    before,
    // 结局期间键照样落到场景手里（`keyReceiver`，xl-czb.6）。
    keyReceiver(panel) === 'scene' ? input.scene : NO_KEYS,
    elapsedMs,
    deps.scenes,
    deps.random,
  )
  // ⚠️ **下面五类只亮一拍的请求，只在这一次真的推过场景时才接**（xl-b36）。
  // 凑不满一拍时（`elapsedMs` 不到 10 ms —— `setInterval` 抖一下就是；存读档那条
  // 路 `useGame` 明写着传 0）`advance` 把世界**原样交回**，上一拍亮着的请求还亮着。
  // 不看这一条的话，那一次 pump 会把它再接一遍：金币再加一遍、那一声再交一遍、
  // 已经在店里了又要进店（→ 下面那句抛）。sfxWiring.test.ts 的「拍间空转」喂法
  // 头一次喂到它：三扇门的剧本全抛、开箱那一声变四声。
  const stepped = scene.world !== before.world
  const requestsThisPump = stepped ? scene.world : NO_REQUESTS
  const request = requestsThisPump.battleRequest

  // 答对答错的加扣（xl-yg6.9）与开箱进背包（xl-yg6.10）。两者都只亮一拍，
  // `advance` 在亮的那一拍停批（`state/loop.ts`），所以读的就是这一拍的；**只在
  // 这里记一次**：下一次 pump 的世界里它们已经落回 `null`（或者这一次没推，见上）。
  // 这一段与取图页共用（`sceneLedger.ts`，xl-03x.3）。
  if (stepped) settleSceneRequests(scene.world)
  // 开箱 / 答题那一声（xl-b36）。同样只亮一拍、同样停批，读的就是这一拍的。
  if (requestsThisPump.sfxRequest !== null) heard.push(...requestsThisPump.sfxRequest)

  if (request !== null && panel === 'scene') {
    battle = createBattleTicker(createBattle(configFor(request, deps)))
    panel = 'battle'
  } else if (request !== null) {
    // 打架的时候又起了一场。今天到不了（战斗期间主角不动，`checkBattle0`
    // 的 count 不涨；剧情战要按空格，而空格这时投给战斗面板）。真到了这里
    // 是**抛**，不是悄悄丢掉：丢掉的表现是"这一场打完还得再打一场"没有发生，
    // 而那与"本来就只有一场"长得一样。
    throw new Error(
      `${scene.world.scene} 在战斗进行中又起了一场（${JSON.stringify(request)}）—— ` +
        '原版这时会用后一场把前一场整个盖掉，这一层不替它选。',
    )
  }

  // 选择框那两扇商店门（xl-yg6.11）：`SelectEvent.keyPressed` 里选「是」那一句
  // `GameLauncher.switchTo("shop" | "equipmentShop")`。只亮一拍，`advance` 在
  // 它亮的那一拍停批（`state/loop.ts`），所以读的就是这一拍的。
  //
  // ⚠️ 原版「是」那一支**只有一句 switchTo**，不清 `isSelect` / `shopSelect`：
  // 从店里「返回游戏」回来，场景还停在选择框上，再按一下回车又进店。照抄 ——
  // 这一层什么都不用做，那两个旗标本来就没人动。
  let shop = session.shop
  const door = requestsThisPump.selectPanelRequest
  if (door !== null && panel === 'scene') {
    shop = enterShop(shop, SHOP_OF_DOOR[door], menu, deps)
    panel = 'shop'
  } else if (door !== null) {
    // 今天到不了：选择框只收场景面板的键，而场景不显示时一个键都收不到。
    // 真到了是**抛**，理由同上面那一场架。
    throw new Error(`${scene.world.scene} 在 ${panel} 面板上又要进店（${door}）`)
  }

  // 结局（xl-czb.6）：`DialogueEvent.keyPressed` 里那句 `switchTo("end")`。只亮一拍，
  // `advance` 在它亮的那一拍停批（`state/loop.ts`）。它只能从场景的按键分发里来，
  // 所以键不落在场景手里的时候亮起来就是接线错了 —— 抛，理由同上面那一场架。
  let end = session.end
  if (requestsThisPump.endRequest !== null) {
    if (keyReceiver(panel) !== 'scene') {
      throw new Error(`${scene.world.scene} 在 ${panel} 面板上要切结局 —— 那一句只在场景的按键分发里`)
    }
    const entered = enterEnd({ ...session, end })
    panel = entered.panel
    end = entered.end
  }

  // ——— 战斗那条线程 ———
  if (panel === 'battle' && battle !== null) {
    const drugsBefore = [...battle.world.drugStock]
    battle = advanceBattle(battle, input.battle, elapsedMs)
    // 这一次推进跑过的每一拍各自的音效，依次相接（xl-b36）。
    heard.push(...battle.sfx)
    // 药**每一拍都写回**，理由与商店、菜单同一条：原版喝下去那一刻 static 的
    // `DrugPack` 就变了。等打完再写的话，打输回标题那条出口也得记得写。
    applyDrugDelta(drugsBefore, battle.world.drugStock)
    // 打赢那一拍发出去的装备搬进全局装备背包（xl-5jx）。一次性请求，搬完就清。
    // 走 `addEquipment`：名字对不上出厂表的一声不响丢掉，与原版 `addEqupment` 同。
    const equip = equipPanelOf(menu)
    for (const name of battle.world.lootEquipment.splice(0)) addEquipment(equip, name, 1)
    const exit = battle.world.exitPanel
    if (exit !== null) {
      // 三个人的结果记回队伍。**记的是 `party` 不是 `heroes`**：两条打输的
      // 出口末尾都有一句 `heroes.clear()`，拿它记等于一个人都没记。
      rememberParty(battle.world.party)
      panel = exit === 'scenePanel' ? 'scene' : enterTitle()
      // `switchTo("scene")` 里那句 `SCENE_SIGNAL=1`：下一拍场景把自己的曲子
      // 放回去（进战斗那一下 BGM 被 `initial()` 换成了战斗曲，xl-yg6.11）。
      if (panel === 'scene') scene = signalScene(scene)
      battle = null
    }
  }

  // ——— 菜单那四条线程 ———
  // @exception ADR-0001#panel-threads-run-while-hidden —— 只在菜单显示着时推（xl-6lo.19）。
  if (panel === 'menu') {
    // ⚠️ **这一批输入整批投进去，「返回」之后的那几个也照投** —— 包括那一下
    // **松手**。原版的松手真的到得了已经被 CardLayout 藏起来的菜单：Swing 的
    // `LightweightDispatcher` 从按下到松开一直握着 grab，`isMouseGrab` 对
    // RELEASED 也为真，于是事件被重定向回**按下时**那个组件，不看它还显不显示。
    //
    // 这不是读文档读来的，是量出来的（2026-09-10，openjdk 17，真 JFrame +
    // CardLayout，A 面板在 `mousePressed` 里把自己 `cl.show` 掉，再往窗口派
    // 一条 MOUSE_RELEASED）：`A pressed=true released=true`、B 两个都是 false。
    // 于是原版走的是 `funcPanel.mouseReleased → isRelesedButton`，落点与按下
    // 同一处、必然命中，`returnButton.isclicked` **被清掉**。
    //
    // ⚠️ 本票起先反着写（逐个投递、见到「返回」就 break，理由是"藏起来就收不到"）
    // ——那条前提是假的，/code-review 的 Spec 轴起了一个真 JVM 把它证伪的。
    // 松手落在**下一帧**的那一半见下面的 `else`（xl-z4f）。
    const menuDrugsBefore = menu.world.drugPack.map((s) => s.count)
    menu = advanceMenu(menu, input.menu, elapsedMs, heard)
    // 天书页那两颗「背景音乐 开 / 关」改的是菜单世界上的开关，而原版改的是
    // 两个 static。**每一拍都记回去**，不是等关菜单时记 —— 关菜单那条路只有
    // 「返回」一条，而 BGM 该在按下那一拍就停（原版 `closeBGM()` 是同步的）。
    rememberAudioSettings(menu.world.audio)
    // 三个人也**每一拍都记回去**（xl-6lo.16），理由与上面那两个开关同一条：
    // 原版菜单里的 `hero1/hero2/hero4` 就是战斗与场景读的那三个对象，属性
    // 字段还大半是 `static` —— 喝药那句 `addValue()` 一执行，别处当场就看得见。
    // 等关菜单再记的话，中间那段时间队伍是陈的；而"陈的"与"对的"在只有一条
    // 出口的今天长得一模一样，明天多一条出口（存档、装备超市回菜单）就不是了。
    rememberMenuParty(menu.world.heroes)
    // 物品页喝掉的药也每一拍写回（xl-bsv 的反方向）：存档读的是药包，不是菜单。
    applyDrugDelta(menuDrugsBefore, menu.world.drugPack.map((s) => s.count))
    if (menuWantsScene(menu.world)) {
      panel = 'scene'
      // 天书页「返回」走的也是 `switchTo("scene")`，同一句 `SCENE_SIGNAL=1`。
      scene = signalScene(scene)
      // 一次性信号，读了就收 —— 菜单世界活着，不清的话下次开菜单第一拍
      // 又关上了。`returnButton.isclicked` **不清**，见 `clearMenuExit`。
      clearMenuExit(menu.world)
    }
    // 「退出」→「重新开始」（xl-03x.11）：`switchTo("start")`。落点与打输回标题
    // 那一支（上面战斗那一段的 `exitPanel`）同一个 —— 面板翻成 `'start'`，
    // 曲子由 `currentBgm` 跟着换成主题曲，标题上点「起」之后 App 不分来路。
    // 场景那一侧**不给信号**：原版 `switchTo("start")` 那一支没有 `SCENE_SIGNAL=1`。
    if (menuWantsTitle(menu.world)) {
      clearMenuTitle(menu.world)
      panel = enterTitle()
    }
    // 「存档」/「提取」（xl-i06.9）：`setLastPanel("menu")` + `changeStateTo` +
    // `switchTo("ls")`。同一个理由的一次性信号。
    const lsRequest = menuSaveLoadRequest(menu.world)
    if (lsRequest !== null) {
      clearMenuSaveLoad(menu.world)
      const entered = enterSaveLoad({ ...session, panel, scene, battle, menu }, lsRequest, 'menu')
      panel = entered.panel
      session = entered
    }
  } else if (input.menu.length > 0) {
    // ——— 菜单藏着，却收到了菜单输入：Swing 的 mouse grab（xl-z4f）———
    //
    // 按下「返回」那一拍菜单就关了，松手落在**下一拍**—— 浏览器里这是常态。原版
    // 那一下照样送到 `MenuPanel`（上面那段注释的读数：grab 按**按下时**那个组件
    // 派发，不看它还显不显示），`isclicked` 于是被清掉。
    //
    // **哪些事件归菜单，由送的人按 grab 定**（`useGame.menuInput`），这里不猜：
    // 收到什么就逐个 `applyMenuInput` 什么。今天送得进来的只有松手 —— 那是原版
    // `mouseReleased` 那一截。不走 `advanceMenu`：不补脉冲（藏着的菜单不推，
    // ADR-0001#panel-threads-run-while-hidden），也不画（藏着的面板 `repaint()`
    // 不真画）。松手只动按钮贴图与 `isclicked`，不碰队伍、药包与那几个一次性
    // 信号，所以上面那几句写回与出口这里都用不着。
    //
    // ⚠️ **拖动不送，是一处有意的差异**：Swing 把 MOUSE_DRAGGED 也按 grab 派，
    // 原版按下「返回」到松手之间的拖动会跑 `command.checkMoveIn()` +
    // `currentPanel.mouseDragged`（`MenuPanel.java` 的 `mouseDragged`）。这里一条
    // 都不送 —— 它只改藏着的菜单上按钮的悬停贴图，松手重写 `currentX/Y`、再开
    // 菜单头一下移动又全刷一遍，画面与玩法状态上都看不出来（xl-z4f 的 Spec 轴）。
    for (const i of input.menu) applyMenuInput(menu.world, i)
  }

  // ——— 商店（xl-yg6.11）———
  //
  // 两家店的 `while(true)` 线程只换鼠标图与四条人物动画的帧（`shop/step.ts`
  // 的头注），一个状态字段都不碰，所以这里**只在有输入时推一步**：一步 = 一次
  // 输入事件，与商店真值同一个口径。帧号归绘制层（`game/useGame.ts`）。
  if (panel === 'shop' && shop !== null) {
    const clicks = input.shop ?? NO_SHOP_INPUT
    // 音效只在推了的那一步收：没输入的拍 `stepShop` 不跑、`music` 也不清，那时读它
    // 读到的是上一次点击的，每个空拍都会再交一遍（xl-03x.7）。
    const shopDrugsBefore = [...shop.pack.drugs]
    if (clicks.length > 0) {
      stepShop(shop, clicks)
      heard.push(...shop.music)
    }
    // **每一步都写回去**，理由与菜单那三个人同一条：原版买下的那一刻
    // `Money` / `DrugPack` / `EquipmentPack` 就变了，别处当场看得见。
    writeShopBack(shop, menu, shopDrugsBefore)
    if (shop.leaving) {
      // 「返回游戏」：`ShopPanel` / `EquipmentShopPanel` 里那句
      // `GameLauncher.switchTo("scene")`。**回到的就是进门时那个场景、那一格**
      // —— 场景那条线程一直在跑，从没被换掉。
      shop.leaving = false
      panel = 'scene'
      scene = signalScene(scene)
    }
  }

  return { ...session, panel, scene, battle, menu, shop, end, sfx: heard.length === 0 ? NO_SFX : heard }
}

/**
 * 接线层交给音效播放器的那一下（xl-03x.7）：**推完一拍调一次**，交的是这一拍推出来
 * 的 {@link Session.sfx}。`useGame` 的 pump 与 `sfxWiring.test.ts` 的对撞走的都是它。
 *
 * 交之前先把天书页「特殊音效 开 / 关」拨到播放器上（xl-03x.8）—— `CAN_PLAY_MUSIC`
 * 的落点。**先拨后交**，因为这一拍里开关已经是推完之后的值：原版第 8 段是
 * `openMusic()` 在前、`readmusic` 在后，那一声要响；第 9 段关掉之后这一拍再没有
 * 请求。只拨音效这一个播放器：原版两个开关各自只被自己那条播放线程读
 * （读数与判据见 `sfxSwitch.test.ts`），背景音乐那个由 {@link currentBgm} 管。
 *
 * ⚠️ 判据证的是「该响的时候调了播放器、参数对」，**证不了玩家真的听到了** ——
 * 自动播放策略、解码失败、音量为零都在它外面。
 */
export function playSfx(player: Pick<SfxPlayer, 'play' | 'setEnabled'>, session: Session): void {
  player.setEnabled(getAudioSettings().sfx)
  player.play(session.sfx)
}

/**
 * 进结局（xl-czb.6）—— `switchTo("end")` 那两句：`switcher.show(c, "endPanel")`（换成
 * `end` 面板）+ `endPanel.start()`（起线程、`isDraw = true`、`isStop = false`）。**不更新
 * 当前面板**，见 {@link currentPanelOf}。
 *
 * 头一次进来才建那份面板世界与那条线程。⚠️ 原版每 `switchTo("end")` 一次就**多起一条**
 * 线程（`start()` 里 `new Thread(this).start()`），这里第二次进来只把旗标重置、不多起一条。
 * 走不走得到第二次：2026-09-10 的读数是 `$` 只出现在 脚本41 那一段对话里（`end/trigger.test.ts`
 * 现扫断言「对话里的 `$` 只落在一个场景」），那段对话按完 `dialogueEventOver` 就翻真、不会再开。⚠️ 未验证的推理：读一个
 * 停在那段对话之前的档再按一遍，可能是一条路 —— 那时字幕已经停在底，多一条线程只让
 * 过场画在停下之前多翻一张，而两条线程谁先跑是竞态。未复刻，未量过。
 *
 * @exception ADR-0001#end-thread-not-duplicated
 */
export function enterEnd<S extends Session>(session: S): S & { readonly end: EndLoop } {
  const end = session.end ?? createEndLoop(createEndWorld())
  startEnd(end.world)
  return { ...session, panel: 'end', end }
}

/** 结局面板世界，结局没显示着就是 `null`。渲染层要它。 */
export function endWorldOf(session: Session): EndWorld | null {
  return session.panel === 'end' && session.end !== null ? session.end.world : null
}

const NO_SHOP_INPUT: readonly ShopInput[] = []
const NO_SAVELOAD_INPUT: readonly SaveLoadInput[] = []

/**
 * 进存读档面板（xl-i06.9）—— 菜单「存档 / 提取」与标题「承」替它做的那三句：
 * `setLastPanel(from)` + `changeStateTo(mode)` + `switchTo("ls")`。
 *
 * **仓库没就绪就先不建面板**（`save/store.ts` 的就绪标志）：面板上照样换成 `ls`，
 * 但画的是「正在读取存档」而不是三个空槽；就绪那一拍 `stepSaveLoad` 补上这一下。
 */
export function enterSaveLoad<S extends Session>(session: S, mode: SaveLoadMode, from: SaveLoadFrom): S {
  const store = session.deps.saves
  if (store.status() !== 'ready') {
    return { ...session, panel: 'ls', lsEntry: { mode, from }, loadRequest: null }
  }
  const w = session.saveload ?? createSaveLoadWorld(store)
  applySaveLoadInput(w, { e: 'enter', mode, from }, { store, capture: noCapture })
  return { ...session, panel: 'ls', saveload: w, lsEntry: null, loadRequest: null }
}

/** 进面板与退出键用不到写档装置；真用到了就是接线错了。 */
function noCapture(): never {
  throw new Error('存读档面板在不该存档的地方要了一份档')
}

/** 存读档面板要的外部件。存档只从菜单进得来，菜单只从场景进得去 —— 真要存档时一定开了局。 */
function saveLoadPorts(session: Session): SaveLoadPorts {
  return {
    store: session.deps.saves,
    capture: () => {
      if (!isRunning(session)) throw new Error('还没开局就要存档 —— 存档的入口在菜单上，菜单只从场景进得去')
      return captureSession(session)
    },
  }
}

/**
 * 存读档面板藏着，却收到了它的输入：Swing 的 mouse grab（xl-o9z，xl-z4f 的同形）。
 *
 * 在一个槽上按住、按退出键切走面板（`returnToLastPanel()`）、再松手 —— 原版那一下
 * 松手照样送到 `LoadAndSavePanel`（grab 按**按下时**那个组件派发，读数在菜单那一段），
 * `mouseReleased` 整段照跑：`setButton()` 存档就当场存、读档就当场 `load(i)` +
 * `switchTo("scene")`，然后 `isRelesedButton` 清掉 `isclicked`。丢了这一下，那颗槽
 * 就粘着，下次进面板随便在哪松一次手都连带把它再存 / 读一遍。
 *
 * **哪些事件归它，由送的人按 grab 定**（`useGame` 的 `grabRef`），这里不猜：收到什么
 * 就逐个 `applySaveLoadInput` 什么，今天送得进来的只有松手。读档照 `stepSaveLoad`
 * 的口径只记槽号（`loadRequest`），场景取到手那一拍 `loadGame` 才把面板换回场景。
 * 换面板的另外两种（`menu` / `start`）只有退出键给得出，而键只归当前面板
 * （{@link keyReceiver}），走不到这里。
 *
 * ⚠️ 拖动不送，与菜单同一处有意的差异：`mouseDragged` 在这个面板上只记坐标，
 * 松手又重写一遍。
 */
function grabbedSaveLoad<S extends Session>(session: S, inputs: readonly SaveLoadInput[]): S {
  const w = session.saveload
  if (w === null) return session
  const ports = saveLoadPorts(session)
  let { loadRequest } = session
  for (const input of inputs) {
    const loaded = applySaveLoadInput(w, input, ports).loads.at(-1)
    if (loaded !== undefined) loadRequest = loaded
  }
  return loadRequest === session.loadRequest ? session : { ...session, loadRequest }
}

/**
 * 推存读档面板一批输入。**一个事件一步**，与 saveload 真值同一个口径；面板那条
 * 10 Hz 的动画线程只推绘制量，不在这里（`saveload/world.ts` 头注）。
 */
function stepSaveLoad<S extends Session>(session: S, inputs: readonly SaveLoadInput[]): S {
  const store = session.deps.saves
  let { saveload, lsEntry, loadRequest } = session
  let panel: Panel = session.panel
  const ports = saveLoadPorts(session)
  // 就绪的那一拍补上悬着的那一下 `enter`。
  if (lsEntry !== null && store.status() === 'ready') {
    saveload = saveload ?? createSaveLoadWorld(store)
    applySaveLoadInput(saveload, { e: 'enter', ...lsEntry }, ports)
    lsEntry = null
  }
  for (const input of inputs) {
    // 切走之后这一批剩下的事件落在别的面板上，这里不再收。点了读档也算切走：原版
    // 那一下同步读完档就 `switchTo("scene")`，这一层只是晚几拍才真的切（见 `loadRequest`）。
    if (panel !== 'ls' || loadRequest !== null) break
    if (lsEntry !== null || saveload === null) {
      // 没就绪：一个槽都没画出来，点什么都不算；退出键照样回得去（原版 `lastPanel`
      // 在进面板那三句的第一句就设好了）。
      if (input.e === 'key' && lsEntry !== null) {
        panel = lsEntry.from
        lsEntry = null
      }
      continue
    }
    const fx = applySaveLoadInput(saveload, input, ports)
    for (const to of fx.switches) {
      // `scene`：读档那一下原版要切回场景 —— 等场景取到手才切，见 `Session.loadRequest`。
      if (to === 'menu' || to === 'start') panel = to
    }
    const loaded = fx.loads.at(-1)
    if (loaded !== undefined) loadRequest = loaded
  }
  // `switchTo("menu")` 那三句 `refreshValue()`：回菜单时属性按最新的刷一遍（同 `openMenu`）。
  if (panel === 'menu' && session.panel !== 'menu') {
    refreshMenuWorld(session.menu.world, {
      live: liveParty(getParty()),
      audio: getAudioSettings(),
      drugs: heldDrugs(),
    })
  }
  // 退出键回标题：`switchTo(lastPanel)` 落在 `"start"` 那一支。上面就绪、没就绪两段
  // 都翻得到这里，所以拨开关放在出口，不放进哪一段里。
  if (panel === 'start' && session.panel !== 'start') openBgm()
  return { ...session, panel, saveload, lsEntry, loadRequest }
}

/**
 * 会话翻到标题 —— `switchTo("start")` 那一支。除了换面板，它末尾还有一句
 * `MusicReader.openBGM()`：**回标题会把背景音乐开关强制拨回「开」**（xl-03x.21）。
 * 天书页关掉背景音乐再「重新开始」，原版标题上主题曲照响。
 *
 * 原版读数（2026-09-11，JVM 实跑天书页「关」→「重新开始」）：`CAN_PLAY_BGM`
 * 1 → 2 → 1，切到 `startPanel`。那一支前面的 `readBGM("主题曲.mp3")` 与
 * `Clock.sleep(1000)` 由 `currentBgm` 现算代掉，这一层没有那一秒的停顿。
 *
 * 存读档面板的退出键那一支在 `stepSaveLoad` 的出口上拨，理由见那里。
 */
function enterTitle(): 'start' {
  openBgm()
  return 'start'
}

/**
 * 存读档面板此刻的样子，面板没开着就是 `null`（xl-i06.9）。
 *
 * - `loading` —— 仓库还在从浏览器存储里读。**不画三个空槽**：两者在原版画面上长得
 *   一模一样，而后者是一句谎话；
 * - `failed` —— 读不上来（没有 IndexedDB 的环境、盘上有一份不认识版本号的档……）。
 *   这时存不了也读不了：`write` 会抛，`read` 也会抛。**面板上说清楚并且只留退出键**，
 *   不画槽（规格没定这一支，xl-i06.9 裁定，见关票理由）；
 * - `ready` —— 面板世界，外加最近一次落盘失败的原因（`persistError`，快照已经是新的、
 *   浏览器存储没写进去）与点中了、场景还在取的那个槽（`loadRequest`）。
 */
export type SaveLoadView =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly error: Error | null }
  | {
      readonly status: 'ready'
      readonly world: SaveLoadWorld
      readonly persistError: Error | null
      readonly loadRequest: number | null
    }

export function saveLoadViewOf(session: Session): SaveLoadView | null {
  if (session.panel !== 'ls') return null
  const store = session.deps.saves
  if (session.saveload === null || session.lsEntry !== null) {
    return store.status() === 'failed' ? { status: 'failed', error: store.error() } : { status: 'loading' }
  }
  return {
    status: 'ready',
    world: session.saveload,
    persistError: store.persistError(),
    loadRequest: session.loadRequest,
  }
}

/**
 * 点中的那个槽要读进哪个场景（脚本文件名，如 `脚本38.txt`）；没有待读的档就是 `null`。
 * 调用方拿它先把场景 JSON 取到手，再调 {@link loadGame}。
 */
export function loadTargetOf(session: Session): string | null {
  return session.loadRequest === null ? null : savedSlot(session, session.loadRequest).scene.fileName
}

/**
 * **读档**（xl-i06.10）—— `LoadAndSavePanel.setButton()` 读档分支那三句：
 * `loader.load(i)` → `if(!t.isAlive()) t.start()` → `switchTo("scene")`。
 *
 * 读一半（`save/format.ts` 的 `readBack`）：原版写了但从不读回的三组 —— 装备库存与
 * 两张答题表 —— 取**读档前的值**，一个字都不取自存档。开机读档时读档前的值就是初值。
 * 真正回填的交给 {@link applyReadBack}。
 *
 * @exception ADR-0001#load-extra-scene-loop
 *
 * 中间那句多起一条场景循环（中途读档之后双倍速）**不复刻**：ADR-0001 例外表的
 * 「读档多起一条场景循环」那一行，判据在 `game/loadResidue.test.ts`。读档之后留下来的
 * 其余几样（`isLoad`、装备页 `heroEquipment`、任务文本……）也在那份文件里逐条断言。
 */
export function loadGame(session: Session): RunningSession {
  const slot = session.loadRequest
  if (slot === null) throw new Error('没有点中的档可读 —— loadGame 只在 loadRequest 有值时调')
  const save = savedSlot(session, slot)
  const owned = ownedEquipment(session.menu)
  const prev = session.scene?.world ?? null
  const before: NeverReadBack = {
    equipmentStock: Object.fromEntries(EQUIP_SLOTS.map((s) => [s, [...owned[s]]])) as unknown as NeverReadBack['equipmentStock'],
    questionMaps: prev?.recorder.map((r) => r.scene) ?? [],
    answers: prev?.recorder.map((r) => [...r.answered]) ?? [],
  }
  return applyReadBack({ ...session, loadRequest: null }, readBack(save, before))
}

/**
 * 把读回来的那一半落到各处 —— `Loader.load` 的回填，按原版的先后：
 *
 * 1. 三个英雄 + 菜单装备页三格（`save/load.ts`：`intialFromInfo` ×3、`initialEquipInfo`）；
 * 2. 场景（`state/load.ts`：`loadSceneInfo`，含**跳过旁白**），与队伍三开关；
 * 3. 药与钱（`ShopPanel.initialShopInfo`：各药 `setNumberGOT`、末项 `Money.setCoins`）；
 * 4. 装备店那一行（`initialEquipmentShopInfo`）写进装备店面板**自建**的六张表、下标跳着走
 *    （xl-1dv.32）—— 全局背包一格都没被写到。这一层没有那几张自建表，全局背包
 *    （菜单装备页的 `owned`）照原版一个字都不动。
 *
 * 然后 `switchTo("scene")`：面板换回场景，场景下一拍把自己的曲子放上（`worldAfterLoad`
 * 里那句 `SCENE_SIGNAL=1`）。
 *
 * **不收 `neverReadBack`**：那三组原版读档一个字都不写，这里也一个字都不写 —— 用类型把
 * 这句话说死，免得有人顺手把它们落下去。
 *
 * 导出给真值回放用（`state/traceReplay.test.ts` 的 `load-slot*`）：那边读回来的那一半由
 * 原版读取器的**实际**读法解出来（`save/test/originalSave.ts` 的 `loaderReadBack`）。
 */
export function applyReadBack(session: Session, rb: Omit<ReadBack, 'neverReadBack'>): RunningSession {
  const scene = session.deps.scenes(rb.scene.fileName)
  if (scene === undefined) {
    throw new Error(`存档要读进 ${rb.scene.fileName}，这个场景还没取到手 —— 先按 loadTargetOf 取`)
  }
  const equip = session.menu.world.panels.equipPanel.equip
  if (equip === null) throw new Error('菜单装备页没有 equip 那一摊 —— 身上的装备无处可落')
  if (rb.drugs.length < DRUGS.length) {
    // `drugList.get(i).setNumberGOT(parseInt(shopInfo.get(i)))`：少一项原版当场越界抛。
    throw new Error(`存档里只有 ${rb.drugs.length} 种药，药包有 ${DRUGS.length} 种`)
  }
  const heroes = heroesFromSave(rb, getParty())
  setParty(heroes.party)
  for (const h of WORN_HEROES) equip.packs[h] = heroes.packs[h]
  const world = worldAfterLoad(session.scene?.world ?? null, rb.scene, rb.party, scene)
  DRUGS.forEach((d, i) => setDrugCount(d.name, rb.drugs[i]!))
  setCoins(rb.coins)
  return { ...session, panel: 'scene', scene: createTicker(world), lsEntry: null, loadRequest: null }
}

/** 点中的那个槽里的档。面板那一下已经判过空槽（`Loader.isNull`），这里再空就是接线错了。 */
function savedSlot(session: Session, slot: number): SaveFile {
  const save = session.deps.saves.read(slot)
  if (save === null) throw new Error(`第 ${slot} 个槽是空的 —— 读档面板点空槽什么都不发生，走不到这里`)
  return save
}

/** `switchTo("scene")` 里那句 `SCENE_SIGNAL=1`（见 `World.sceneSignal`）。 */
function signalScene(ticker: Ticker): Ticker {
  return { ...ticker, world: { ...ticker.world, sceneSignal: true } }
}

/**
 * 队伍名单（`SaveAndLoad.zhang/lu/wen`）。原版这三个标志位归存档，今天没有
 * 存档，所以照三个类的处境给：三个人都在。菜单与商店读的是**同一份**。
 * ⚠️ 玉洁那一位的键是 `wen`。
 */
const GAME_PARTY: readonly string[] = ['zhang', 'lu', 'wen']

/**
 * 进门：`switchTo("shop" | "equipmentShop")`（xl-yg6.11）。
 *
 * 头一次进门才建两家店（见 `Session.shop`）；每一次进门都把钱、药、装备从
 * 那三处 static 的落点**现读**进来 —— 两次进门之间打过架、开过箱、在菜单里
 * 弃过装备，店里看到的都得是此刻的数。
 */
function enterShop(
  shop: ShopWorld | null,
  kind: ShopKind,
  menu: MenuTicker,
  deps: SessionDeps,
): ShopWorld {
  const w =
    shop ??
    createShopWorld({
      party: GAME_PARTY,
      coins: getCoins(),
      // 原版存货是 `Math.random()` 现掷的，没有种子；这一层的商店世界带一个
      // `JavaRandom`（真值要可复现），所以现摇一个 —— 与战斗那一处同一个取舍
      // （见 `SessionDeps.random`）。@exception ADR-0001#random-streams-per-battle-and-shop
      seed: Math.trunc(deps.random() * 0x7fffffff),
    })
  w.coins = getCoins()
  w.pack.drugs = heldDrugs()
  const owned = ownedEquipment(menu)
  for (const slot of EQUIP_SLOTS) w.pack.equipment[slot] = [...owned[slot]]
  // 换店不派发鼠标事件，只换引用 —— 与 `ShopDriver.open()` 同一个动作。
  applyShopInput(w, { e: 'open', shop: kind })
  return w
}

/**
 * 药包此刻每味药的件数，按 `DRUGS` 的次序（xl-byy / xl-bsv）。
 *
 * 原版的 `DrugPack.drugList` 是**一份** static，商店、菜单物品页、战斗药品菜单
 * 读写的是同一张表。这一层三家各有自己的世界，落点只有 `fakes/drugPack.ts`
 * 一处：进门（开店、开菜单、起一场架）时从这里现读，里面每一步之后由
 * {@link applyDrugDelta} 写回这一步的增减。**三家都必须走这一对**：漏一家，那一家看到的就是
 * 进门之前的数，而它自己单测全绿（xl-bsv、xl-byy 就是这么漏的）。
 */
function heldDrugs(): number[] {
  return DRUGS.map((d) => drugCount(d.name))
}

/**
 * 把某一家世界**这一步自己的增减**写回药包：`after − before`，走 `addDrug`。
 *
 * ⚠️ **不是**「世界里的数 − 药包里的数」。战利品的药是在战斗那一拍**里面**直接
 * `addDrug` 进药包的（`victory.ts` 的 `awardLoot`），不经过战斗世界 —— 按药包去补
 * 的话，打赢那一拍掉的药当场被减回去（实测：迷宫1 那一场掉的 金创药 1 + 姜黄粉 2
 * 全没了；判据 `session.test.ts`「打赢掉的药进了药包……」）。只写自己的增减，别处
 * 同一时刻写进药包的东西就不会被抹掉。
 *
 * 只写有变化的那几味：写成 `setDrugCount` 会让一味从没碰过的药在药包里留下一条 0
 * —— 账本对撞（`compare/ledger.ts`）比的正是「药包收到过哪些名字」。
 */
function applyDrugDelta(before: readonly number[], after: readonly number[]): void {
  if (before.length !== DRUGS.length || after.length !== DRUGS.length) {
    throw new Error(`写回药包的是 ${before.length} → ${after.length} 个数，而药品有 ${DRUGS.length} 种`)
  }
  DRUGS.forEach((d, i) => {
    const delta = after[i]! - before[i]!
    if (delta !== 0) addDrug(d.name, delta)
  })
}

/** 店里这一步之后，把钱、药、装备写回那三处 static 的落点。 */
function writeShopBack(w: ShopWorld, menu: MenuTicker, drugsBefore: readonly number[]): void {
  const coins = w.coins - getCoins()
  if (coins > 0) addCoins(coins)
  else if (coins < 0) reduceCoins(-coins)
  applyDrugDelta(drugsBefore, w.pack.drugs)
  // 就地改：菜单装备页读的就是这几个数组（`EquipPanelState.owned`）。
  const owned = ownedEquipment(menu)
  for (const slot of EQUIP_SLOTS) owned[slot].splice(0, owned[slot].length, ...w.pack.equipment[slot])
}

/**
 * 全局装备背包 —— 原版那六张 static 表，这一层唯一的落点是菜单装备页
 * （`Session.menu` 的头注）。它没建出来就是菜单那一层坏了，**抛**，不是当成空。
 */
function ownedEquipment(menu: MenuTicker) {
  return equipPanelOf(menu).owned
}

function equipPanelOf(menu: MenuTicker) {
  const equip = menu.world.panels.equipPanel.equip
  if (equip === null) throw new Error('菜单装备页没有 equip 那一摊 —— 全局装备背包无处可落')
  return equip
}

/** 商店世界，店没开着就是 `null`。渲染层要它。 */
export function shopWorldOf(session: Session): ShopWorld | null {
  return session.panel === 'shop' ? session.shop : null
}

/**
 * 这一拍是不是**刚翻到标题** —— `switchTo("start")` 那一支执行了一次（xl-6zf）。
 *
 * 那一支里的 `readBGM("主题曲.mp3")` 不看同名：`MusicPlayer.play` 先停再从头打开。
 * 全灭与「重新开始」两条路上曲子本来就换了（场景 / 战斗曲 → 主题曲），这一位看不出
 * 区别；**只有标题 →「承」→ 存读档 → Esc 回标题这条路上它才有用** —— 那条路上
 * {@link currentBgm} 一路都是主题曲，光比「该放哪首」永远看不见这一下。
 *
 * 是个边沿，所以要两份会话：pump 手上正好有推进之前与之后那两份。
 */
export function titleEntered(before: Session, after: Session): boolean {
  return after.panel === 'start' && before.panel !== 'start'
}

/**
 * 这一拍场景是不是**放了一次 `readBGM(reader.getSceneMusic())`**（xl-4io）。
 *
 * 原版 `switchTo("scene")` 置 `SCENE_SIGNAL=1`，场景线程下一拍 `step()` 第 7 步之后
 * 读到就 `readBGM` 再清零 —— 那一句不看同名，场景曲从头放。菜单「返回」、商店
 * 「返回游戏」回来，{@link currentBgm} 前后是同一首，光比曲名看不见这一下；打赢
 * 回场景那条曲子本来就换了，这一位看不出区别，但它也走这一句。
 *
 * 判的是**消费**，不是置位：会话在推进的末尾置信号（`signalScene`），下一次推进里
 * `state/step.ts` 才读它、清它，所以「推进前有、推进后没了」恰好就是那一拍 ——
 * 读档那一下（`worldAfterLoad` 置的）也一样。一次推进补跑几拍也不怕：信号只会被
 * 头一拍清掉。
 */
export function sceneMusicReplayed(before: Session, after: Session): boolean {
  return before.scene?.world.sceneSignal === true && after.scene?.world.sceneSignal === false
}

/** pump 交给 `BgmPlayer.sync` 的「同一首也从头放」：原版两句不看同名的 `readBGM`。 */
export function bgmFromStart(before: Session, after: Session): boolean {
  return titleEntered(before, after) || sceneMusicReplayed(before, after)
}

/**
 * 这一拍该放哪首曲子。
 *
 * `GameLauncher.switchTo("scene")` 里那句 `SCENE_SIGNAL=1` 与
 * `ScenePanel.step()` 末尾那句 `MusicReader.readBGM(reader.getSceneMusic())`
 * 合起来说的就是这件事：**回到场景就把该场景的曲子重新放上**。
 *
 * 这一层不需要那个信号位，因为"该放哪首"是从当前面板现算的 —— 回到场景的
 * 那一拍这个函数的返回值自己就变了回去。信号位是原版用来把一次性动作挤进
 * 一个轮询循环的手法，而这里没有那个循环。
 */
export function currentBgm(session: Session): string | null {
  // 天书页把背景音乐关掉了（`MusicPlayer.CAN_PLAY_BGM = NO`）。原版那一位
  // 关的是播放线程 —— 下一个缓冲块就 break，声音当场停，而"该放哪首"那个
  // 字段一个字没变；`openBGM()` 再把**同一首**放回去。这一层的对应物就是
  // 让声明值变成 `null`：播放器收到 `null` 就 `pause()`，收到曲名再 `play()`。
  if (!getAudioSettings().bgm) return null
  if (session.panel === 'battle' && session.battle !== null) return session.battle.world.bgm
  // 标题那一屏放主题曲。**还没开局与全灭回标题走的是同一句**，原版也是同一句
  // （`switchTo("start")` 里那个 `readBGM("主题曲.mp3")`），两条路都到得了它。
  //
  // 后半个 `scene === null` 是**给类型看的**，不是第二条路：没开局蕴含
  // `panel === 'start'`，前半个已经拦住了；但 `panel` 不窄化 `scene`，
  // 少了它下面那句就得写 `!`。
  if (session.panel === 'start' || session.scene === null) return TITLE_BGM
  return session.scene.world.audio.bgm
}

/**
 * 写档装置的来源（xl-i06.9）：`Recorder.save` 读的那几处，在这一层的落点逐个现读，
 * 交给 `save/capture.ts` 的纯函数拼成一份档。
 *
 * - 场景与 `Reader` 那几个静态字段 —— 场景世界；
 * - 三个人 —— 队伍（`fakes/party.ts`）；
 * - 身上的装备与六张装备表的持有量 —— 菜单装备页（全局装备背包唯一的落点，
 *   见 `Session.menu`）；
 * - 药与钱 —— 药包与钱包。店开着时每一步都写回过（`writeShopBack`），所以这里读到
 *   的就是此刻的数。
 *
 * 只有开了局才存得了档：存档的入口在菜单上，而菜单只从场景进得去。
 */
export function captureSession(session: RunningSession): SaveFile {
  const equip = session.menu.world.panels.equipPanel.equip
  if (equip === null) throw new Error('菜单装备页没有 equip 那一摊 —— 身上的装备无处可取')
  return captureSave({
    world: session.scene.world,
    party: getParty(),
    worn: equip.packs,
    owned: equip.owned,
    drugs: heldDrugs(),
    coins: getCoins(),
  })
}

/**
 * 存读档面板此刻该画的几个槽（xl-i06.8）。没就绪就是 `loading` / `failed`，
 * **不是**三个空槽 —— 见 `save/store.ts` 的就绪标志。面板本身归 xl-i06.9。
 */
export function saveSlotsOf(session: Session): SaveSlotsView {
  return saveSlotsView(session.deps.saves)
}

/** 菜单世界，菜单没开着就是 `null`。渲染层要它。 */
export function menuWorldOf(session: Session): MenuWorld | null {
  return session.panel === 'menu' ? session.menu.world : null
}

/** 战斗世界，没在打架就是 `null`。渲染层要它。 */
export function battleWorldOf(session: Session): BattleWorld | null {
  return session.panel === 'battle' && session.battle !== null ? session.battle.world : null
}
