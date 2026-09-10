import { advanceBattle, createBattleTicker } from '../battle/loop'
import { advanceMenu, createMenuTicker } from '../menu/loop'
import type { MenuTicker } from '../menu/loop'
import { clearMenuExit, menuWantsScene } from '../menu/step'
import type { MenuInput } from '../menu/step'
import { createMenuWorld, refreshMenuWorld } from '../menu/world'
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
import { applyShopInput, stepShop } from '../shop/step'
import type { ShopInput } from '../shop/step'
import { createShopWorld } from '../shop/world'
import type { ShopKind } from '../shop/layout'
import type { ShopWorld } from '../shop/types'
import type { LiveParty } from '../menu/heroes'
import { getAudioSettings, rememberAudioSettings } from './audioSettings'
import { TITLE_BGM } from '../start/assets'
import { advance, createTicker } from '../state/loop'
import type { Ticker } from '../state/loop'
import type { SceneSource } from '../state/step'
import { BATTLE_INFO_COLUMNS, COL_BACKGROUND, COL_PARTY, enemySlots } from '../state/fight'
import type { BattleInfo } from '../state/fight'
import type { InputEvent, World } from '../state/types'
import { saveSlotsView } from '../save/store'
import type { SaveSlotsView, SaveStore } from '../save/store'
import { captureSave } from '../save/capture'
import type { SaveFile } from '../save/format'

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
export type Panel = 'scene' | 'battle' | 'start' | 'menu' | 'shop'

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
}

export const NO_INPUT: SessionInput = { scene: [], battle: [], menu: [], shop: [] }

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
 */
export function createSession(deps: SessionDeps): Session {
  // 菜单**开机就建**，与原版同一句：`GameLauncher` 构造函数里那句
  // `menuPanel=new MenuPanel(zhangXiaoFan,luXueQi,yuJie)` 排在
  // `switchTo("start")` 之前。见 `Session.menu`。
  return { panel: 'start', scene: null, battle: null, menu: createGameMenu(), shop: null, deps }
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
  if (session.panel !== 'scene') return session
  // **刷新，不重建**（xl-6lo.18）：`switchTo("menu")` 那个 case 里除了换面板
  // 就只有三句 `refreshValue()`。装备槽位、全局背包、当前在哪一页原样留着。
  refreshMenuWorld(session.menu.world, { live: liveParty(carry), audio: getAudioSettings() })
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
  const { deps } = session
  // 还没开局（xl-q7f）：原版这时 `ScenePanel` 那条线程根本没起来，没有世界
  // 可推。**原样交回去**，而不是推一个空世界 —— 见 `Session.scene`。
  if (session.scene === null) return session
  let panel = session.panel
  let battle = session.battle
  let menu = session.menu

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
    world: { ...session.scene.world, showing: panel === 'scene' },
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
    panel === 'scene' ? input.scene : NO_KEYS,
    elapsedMs,
    deps.scenes,
    deps.random,
  )
  const request = scene.world.battleRequest

  // 答对答错那一下的加扣（xl-yg6.9）。原版 `SelectEvent.keyPressed` 里
  // `Money.addCoins(i)` / `Money.reduceCoins(i)` 与 `drawString` 同一拍；这一层
  // 把它做成只亮一拍的 `presentRequest`，`advance` 在它亮的那一拍停批（见
  // `state/loop.ts`），所以读的就是这一拍的。**只在这里记一次**：下一次 pump
  // 的世界里它已经落回 `null`。
  const present = scene.world.presentRequest
  if (present !== null) {
    if (present.correct) addCoins(present.coins)
    else reduceCoins(present.coins)
  }
  // 开箱开出来的东西进背包（xl-yg6.10）：`TreasureBox.keyPressed` 里那句
  // `DrugPack.addDrug(treasureName, i)`，与 `drawString` 同一拍。停批的理由
  // 与上面那条一样（`state/loop.ts`）。
  for (const got of scene.world.treasureRequest ?? []) addDrug(got.name, got.count)

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
  const door = scene.world.selectPanelRequest
  if (door !== null && panel === 'scene') {
    shop = enterShop(shop, SHOP_OF_DOOR[door], menu, deps)
    panel = 'shop'
  } else if (door !== null) {
    // 今天到不了：选择框只收场景面板的键，而场景不显示时一个键都收不到。
    // 真到了是**抛**，理由同上面那一场架。
    throw new Error(`${scene.world.scene} 在 ${panel} 面板上又要进店（${door}）`)
  }

  // ——— 战斗那条线程 ———
  if (panel === 'battle' && battle !== null) {
    battle = advanceBattle(battle, input.battle, elapsedMs)
    const exit = battle.world.exitPanel
    if (exit !== null) {
      // 三个人的结果记回队伍。**记的是 `party` 不是 `heroes`**：两条打输的
      // 出口末尾都有一句 `heroes.clear()`，拿它记等于一个人都没记。
      rememberParty(battle.world.party)
      panel = exit === 'scenePanel' ? 'scene' : 'start'
      // `switchTo("scene")` 里那句 `SCENE_SIGNAL=1`：下一拍场景把自己的曲子
      // 放回去（进战斗那一下 BGM 被 `initial()` 换成了战斗曲，xl-yg6.11）。
      if (panel === 'scene') scene = signalScene(scene)
      battle = null
    }
  }

  // ——— 菜单那四条线程 ———
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
    // 剩下的那一半差别在 `game/useGame.ts`：松手落在**下一帧**时它整个丢掉，
    // 而原版照样送得到。单开一张票：**xl-z4f**。
    menu = advanceMenu(menu, input.menu, elapsedMs)
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
    if (menuWantsScene(menu.world)) {
      panel = 'scene'
      // 天书页「返回」走的也是 `switchTo("scene")`，同一句 `SCENE_SIGNAL=1`。
      scene = signalScene(scene)
      // 一次性信号，读了就收 —— 菜单世界活着，不清的话下次开菜单第一拍
      // 又关上了。`returnButton.isclicked` **不清**，见 `clearMenuExit`。
      clearMenuExit(menu.world)
    }
  }

  // ——— 商店（xl-yg6.11）———
  //
  // 两家店的 `while(true)` 线程只换鼠标图与四条人物动画的帧（`shop/step.ts`
  // 的头注），一个状态字段都不碰，所以这里**只在有输入时推一步**：一步 = 一次
  // 输入事件，与商店真值同一个口径。帧号归绘制层（`game/useGame.ts`）。
  if (panel === 'shop' && shop !== null) {
    const clicks = input.shop ?? NO_SHOP_INPUT
    if (clicks.length > 0) stepShop(shop, clicks)
    // **每一步都写回去**，理由与菜单那三个人同一条：原版买下的那一刻
    // `Money` / `DrugPack` / `EquipmentPack` 就变了，别处当场看得见。
    writeShopBack(shop, menu)
    if (shop.leaving) {
      // 「返回游戏」：`ShopPanel` / `EquipmentShopPanel` 里那句
      // `GameLauncher.switchTo("scene")`。**回到的就是进门时那个场景、那一格**
      // —— 场景那条线程一直在跑，从没被换掉。
      shop.leaving = false
      panel = 'scene'
      scene = signalScene(scene)
    }
  }

  return { ...session, panel, scene, battle, menu, shop }
}

const NO_SHOP_INPUT: readonly ShopInput[] = []

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
      // （见 `SessionDeps.random`）。
      seed: Math.trunc(deps.random() * 0x7fffffff),
    })
  w.coins = getCoins()
  w.pack.drugs = DRUGS.map((d) => drugCount(d.name))
  const owned = ownedEquipment(menu)
  for (const slot of EQUIP_SLOTS) w.pack.equipment[slot] = [...owned[slot]]
  // 换店不派发鼠标事件，只换引用 —— 与 `ShopDriver.open()` 同一个动作。
  applyShopInput(w, { e: 'open', shop: kind })
  return w
}

/** 店里这一步之后，把钱、药、装备写回那三处 static 的落点。 */
function writeShopBack(w: ShopWorld, menu: MenuTicker): void {
  const coins = w.coins - getCoins()
  if (coins > 0) addCoins(coins)
  else if (coins < 0) reduceCoins(-coins)
  DRUGS.forEach((d, i) => {
    const delta = (w.pack.drugs[i] ?? 0) - drugCount(d.name)
    if (delta !== 0) addDrug(d.name, delta)
  })
  // 就地改：菜单装备页读的就是这几个数组（`EquipPanelState.owned`）。
  const owned = ownedEquipment(menu)
  for (const slot of EQUIP_SLOTS) owned[slot].splice(0, owned[slot].length, ...w.pack.equipment[slot])
}

/**
 * 全局装备背包 —— 原版那六张 static 表，这一层唯一的落点是菜单装备页
 * （`Session.menu` 的头注）。它没建出来就是菜单那一层坏了，**抛**，不是当成空。
 */
function ownedEquipment(menu: MenuTicker) {
  const equip = menu.world.panels.equipPanel.equip
  if (equip === null) throw new Error('菜单装备页没有 equip 那一摊 —— 全局装备背包无处可落')
  return equip.owned
}

/** 商店世界，店没开着就是 `null`。渲染层要它。 */
export function shopWorldOf(session: Session): ShopWorld | null {
  return session.panel === 'shop' ? session.shop : null
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
    drugs: DRUGS.map((d) => drugCount(d.name)),
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
