import { advanceBattle, createBattleTicker } from '../battle/loop'
import { advanceMenu, createMenuTicker } from '../menu/loop'
import type { MenuTicker } from '../menu/loop'
import { menuWantsScene } from '../menu/step'
import type { MenuInput } from '../menu/step'
import { createMenuWorld } from '../menu/world'
import type { BattleTicker } from '../battle/loop'
import { createBattle } from '../battle/world'
import type { BattleConfig } from '../battle/world'
import type { BattleInput } from '../battle/step'
import type { BattleWorld } from '../battle/types'
import type { MenuWorld } from '../menu/types'
import type { PartyKey } from '../battle/units'
import { getParty, rememberParty } from '../fakes/party'
import { TITLE_BGM } from '../start/assets'
import { advance, createTicker } from '../state/loop'
import type { Ticker } from '../state/loop'
import type { SceneSource } from '../state/step'
import { BATTLE_INFO_COLUMNS, COL_BACKGROUND, COL_PARTY, enemySlots } from '../state/fight'
import type { BattleInfo } from '../state/fight'
import type { InputEvent, World } from '../state/types'

/**
 * **面板机**：场景 ↔ 战斗 ↔ 标题（xl-rh9.17）。
 *
 * 原版的这一层是 `GameLauncher.switchTo(...)` 加一个 `CardLayout` —— 八个
 * 面板全都活着，只有一个显示。这里只做已经移植过来的那三个：
 * `scenePanel` / `battlePanel` / `startPanel`。标题那一屏本身是 DOM，画在
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
export type Panel = 'scene' | 'battle' | 'start' | 'menu'

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
   * 菜单那一侧。`null` = 菜单没开着。
   *
   * **每次开菜单都新建一份**，而不是像原版那样留一个从开机活到关机的
   * `MenuPanel`。原版留着它是因为它顺手当了状态的家（三个人的引用、背包、
   * 已装备的东西全挂在上面）；这一层的那些状态另有出处（`fakes/party.ts`），
   * 而 `switchTo("menu")` 那三句 `refreshValue()` 说的正是「每次打开都按最新
   * 的属性重算一遍」—— 新建一份就是它最直白的对应物。
   */
  readonly menu: MenuTicker | null
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
}

export const NO_INPUT: SessionInput = { scene: [], battle: [], menu: [] }

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
  return { panel: 'start', scene: null, battle: null, menu: null, deps }
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
  return { ...session, panel: 'scene', scene: createTicker(world), battle: null, menu: null }
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
  const world = createMenuWorld({
    // 原版这三个标志位归存档（`SaveAndLoad.zhang/lu/wen`），今天没有存档，
    // 所以照原版三个类的处境给：三个人都在。⚠️ 玉洁那一位的键是 `wen`。
    party: ['zhang', 'lu', 'wen'],
    fullHeal: false,
    live: {
      zhang: { level: carry.zhang.level, hp: carry.zhang.hp, mp: carry.zhang.mp },
      lu: { level: carry.lu.level, hp: carry.lu.hp, mp: carry.lu.mp },
      yu: { level: carry.yu.level, hp: carry.yu.hp, mp: carry.yu.mp },
    },
  })
  return { ...session, panel: 'menu', menu: createMenuTicker(world) }
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
    // 等级与其余六样出自**同一份** `carry`：分开取会让显式传 carry 的调用方
    // 拿到一份"等级是全局的、血是传进来的"的混合体。
    levels: { zhang: carry.zhang.level, yu: carry.yu.level, lu: carry.lu.level },
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
  const scene = advance(
    before,
    panel === 'scene' ? input.scene : NO_KEYS,
    elapsedMs,
    deps.scenes,
    deps.random,
  )
  const request = scene.world.battleRequest

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

  // ——— 战斗那条线程 ———
  if (panel === 'battle' && battle !== null) {
    battle = advanceBattle(battle, input.battle, elapsedMs)
    const exit = battle.world.exitPanel
    if (exit !== null) {
      // 三个人的结果记回队伍。**记的是 `party` 不是 `heroes`**：两条打输的
      // 出口末尾都有一句 `heroes.clear()`，拿它记等于一个人都没记。
      rememberParty(battle.world.party)
      panel = exit === 'scenePanel' ? 'scene' : 'start'
      battle = null
    }
  }

  // ——— 菜单那四条线程 ———
  if (panel === 'menu' && menu !== null) {
    menu = advanceMenu(menu, input.menu, elapsedMs)
    if (menuWantsScene(menu.world)) {
      panel = 'scene'
      menu = null
    }
  }

  return { ...session, panel, scene, battle, menu }
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

/** 菜单世界，菜单没开着就是 `null`。渲染层要它。 */
export function menuWorldOf(session: Session): MenuWorld | null {
  return session.panel === 'menu' && session.menu !== null ? session.menu.world : null
}

/** 战斗世界，没在打架就是 `null`。渲染层要它。 */
export function battleWorldOf(session: Session): BattleWorld | null {
  return session.panel === 'battle' && session.battle !== null ? session.battle.world : null
}
