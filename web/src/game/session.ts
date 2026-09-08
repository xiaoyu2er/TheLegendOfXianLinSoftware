import { advanceBattle, createBattleTicker } from '../battle/loop'
import type { BattleTicker } from '../battle/loop'
import { createBattle } from '../battle/world'
import type { BattleConfig } from '../battle/world'
import type { BattleInput } from '../battle/step'
import type { BattleWorld } from '../battle/types'
import type { PartyKey } from '../battle/units'
import { partyLevels, rememberParty } from '../fakes/party'
import { getParty } from '../fakes/party'
import { advance, createTicker } from '../state/loop'
import type { Ticker } from '../state/loop'
import type { SceneSource } from '../state/step'
import type { BattleInfo } from '../state/fight'
import type { InputEvent, World } from '../state/types'

/**
 * **面板机**：场景 ↔ 战斗 ↔ 标题（xl-rh9.17）。
 *
 * 原版的这一层是 `GameLauncher.switchTo(...)` 加一个 `CardLayout` —— 八个
 * 面板全都活着，只有一个显示。这里只做已经移植过来的那三个：
 * `scenePanel` / `battlePanel` / `startPanel`（标题今天只是一个终止态，
 * 真的开始界面归 M5）。
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
 * 2. **回来之后场景那边逐字段没变**：主角像素坐标、当前脚本、NPC 名单与
 *    它们的格子、`audio.bgm` —— 拿进战斗那一刻的快照比。
 * 3. **打赢那条路**用 `battle-victory` 那份真值的**剧本与输入**（不是它的
 *    状态）建一场战斗塞进会话里，跑到结算结束，看会话回没回场景、经验有没有
 *    记进队伍。
 */
export type Panel = 'scene' | 'battle' | 'start'

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
  /** 场景那一侧。**任何时候都不为空**，战斗期间也在推。 */
  readonly scene: Ticker
  /** 战斗那一侧。`null` = 这一局还没打过架，或者上一场已经收了。 */
  readonly battle: BattleTicker | null
  readonly deps: SessionDeps
}

/** 一拍里到达的输入，按面板分开投递 —— 原版的 `keyPressed` 也是按面板分派的。 */
export interface SessionInput {
  readonly scene: readonly InputEvent[]
  readonly battle: readonly BattleInput[]
}

export const NO_INPUT: SessionInput = { scene: [], battle: [] }

export function createSession(world: World, deps: SessionDeps): Session {
  return { panel: 'scene', scene: createTicker(world), battle: null, deps }
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
  if (info.length !== 7) {
    throw new Error(`Fight 段的一行应当是 7 列，实际 ${info.length} 列：${JSON.stringify(info)}`)
  }
  const present: PartyKey[] = []
  if (info[1] === 'zhang') present.push('zhang')
  if (info[2] === 'yu') present.push('yu')
  if (info[3] === 'lu') present.push('lu')
  return {
    background: info[0]!,
    party: present,
    levels: partyLevels(),
    // `if(!enemy1.equals("null"))` —— 逐字的 "null" 才是空槽位。
    enemies: [info[4]!, info[5]!, info[6]!].map((e) => (e === 'null' ? null : e)),
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
  session: Session,
  input: SessionInput,
  elapsedMs: number,
): Session {
  const { deps } = session
  let panel = session.panel
  let battle = session.battle

  // ——— 场景那条线程 ———
  const before: Ticker = {
    ...session.scene,
    world: { ...session.scene.world, showing: panel === 'scene' },
  }
  const scene = advance(before, input.scene, elapsedMs, deps.scenes, deps.random)
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

  return { ...session, panel, scene, battle }
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
  if (session.panel === 'start') return '主题曲.mp3'
  return session.scene.world.audio.bgm
}

/** 战斗世界，没在打架就是 `null`。渲染层要它。 */
export function battleWorldOf(session: Session): BattleWorld | null {
  return session.panel === 'battle' && session.battle !== null ? session.battle.world : null
}
