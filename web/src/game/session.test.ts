import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { decodePng } from '../compare/png'
import { bgmAssetId } from '../assets/ids'
import { resolveBgmOrNull } from '../assets/resolve'
import { TITLE_BGM } from '../start/assets'
import { repoPath } from '../test/repoPath'
import { getScene } from '../data/scenesEager'
import { getParty, rememberParty, resetParty } from '../fakes/party'
import { createMemorySaveStore } from '../save/memoryStore'
import { getCoins, resetWallet } from '../fakes/wallet'
import { addDrug, drugCount, drugEntries, resetDrugPack } from '../fakes/drugPack'
import { DRUGS } from '../battle/drugs'
import { HEROES, derive, expToLevelUp } from '../battle/units'
import { MENU_HERO_ORDER } from '../menu/heroes'
import type { PartyKey } from '../battle/units'
import { readBattleTrace } from '../battle/trace'
import { replayBattle } from '../battle/replay'
import { createBattleTicker } from '../battle/loop'
import { REVIVE_HP_RATIO, createBattle } from '../battle/world'
import { hitsEnemy } from '../battle/render/hitBox'
import { commandButtons } from '../battle/step'
import { battleClick } from './battleInput'
import type { BattleInput } from '../battle/step'
import type { BattleWorld } from '../battle/types'
import { sceneSourceOf } from '../state/trace'
import { createWorld } from '../state/step'
import { roleTileX, roleTileY } from '../state/role'
import {
  NO_INPUT,
  advanceSession,
  battleWorldOf,
  menuWorldOf,
  openMenu,
  configFor,
  createSession,
  currentBgm,
  enterScene,
} from './session'
import type { RunningSession, SessionDeps } from './session'
import { getAudioSettings, rememberAudioSettings, resetAudioSettings } from './audioSettings'
import { slotOf, wonBattle } from './test/wonBattle'
import { equipCount } from '../menu/equipPanel'
import { NEXT_SCRIPT_ENEMIES } from '../state/fight'
import type { InputEvent, World } from '../state/types'

/**
 * 「从地图走进战斗、打完回到该回的地方」这一整条环路。
 *
 * ## ⚠️ 这一段没有行为真值，凭什么算过
 *
 * 真值的边界正好落在战斗面板的两头。`driver=scene` 的五份走的是
 * `宿舍` / `大地图` / `脚本1` —— 三个都既没有 `battle0` 也没有 `battle1`，
 * 正文里一个 `@` 都没有；`driver=battle` 的十三份从 `BattlePanel.initial()`
 * **之后**才开始，到切面板那一拍为止。也就是说这一层抄错了和抄对了，
 * **十八份真值的每一个字段都相同**。
 *
 * 所以这里不假装有真值判据，改成三条各自能跑出红绿的检查，共同点是
 * **失败的样子和成功不一样**：
 *
 * 1. **环路真的跑一遍，两端都是真数据。** 从烘焙好的 `迷宫1` 建世界，喂
 *    方向键让主角**真的走**（`step()` 逐 tick 推，跟真值回放同一条路径），
 *    走到第 30 格看战斗是不是这一拍起的、打的是不是 `battle0` 那两行之一；
 *    然后**一条输入都不喂**把战斗跑到全灭（怪自己会打），看它落到哪个面板。
 *    从头到尾没有一个手写的状态字段。
 * 2. **回来之后场景那边逐字段没变。** 主角像素坐标、脚本名、NPC **名单**、
 *    `audio.bgm` —— 拿进战斗那一刻的快照比。这条挡的是"打完回来主角站到
 *    别处去了"，而那在画面上只是"咦怎么在这儿"。
 * 3. **打赢那条路**拿 `battle-victory` 那份真值的**剧本与输入**（不是它的
 *    状态字段）建一场战斗塞进会话里跑到底，看会话回没回场景、经验有没有记
 *    进队伍。真值负责"这串点击真的能打赢"，会话负责"打赢之后往哪走"。
 */

/** 怪物出场图的尺寸从真的 PNG 里量 —— 与 `battleTrace.test.ts` 同一条路。 */
function spriteSize(name: string): { width: number; height: number } {
  const png = decodePng(readFileSync(repoPath('image/怪物', name, '1.png')))
  return { width: png.width, height: png.height }
}

/** 挑场次与战斗种子都读它。写成常数是为了让"打的是哪一场"可复现。 */
function fixedRandom(value = 0): () => number {
  return () => value
}

function deps(random: () => number = fixedRandom()): SessionDeps {
  return { scenes: sceneSourceOf(getScene), sprite: spriteSize, random, saves: createMemorySaveStore() }
}

/**
 * 把队伍拉到 `level` 级，血与灵力满 —— 也就是"玩家已经打了一阵子"。
 *
 * 为什么需要它：三个人的出厂等级是 1 / 3 / 1，拿这样的队伍去打 `迷宫1` 的
 * 计步战斗，实测会打成**两败俱伤**（怪物1 先倒、三个人随后全灭），而原版
 * `GameOver.update()` 这时读的是 `bp.em1.name` —— 一个已经被 `checkEnemyDead`
 * 置空的引用，当场空指针。那是原版真有的一个缺陷（这一层照抄，见
 * `battle/step.ts` 里那个 throw），但它不是这张票要验的东西。
 *
 * 走的是 `rememberParty`，也就是**打完一场之后记回去**那条路 —— 不是绕过
 * 假货直接改字段。
 */
function levelParty(level: number): void {
  for (const key of ['zhang', 'yu', 'lu'] as PartyKey[]) {
    const attrs = HEROES[key].attributes(level)
    const d = derive(attrs)
    rememberParty([
      {
        spec: { key },
        level,
        ...attrs,
        exp: 0,
        hp: d.hpMax,
        mp: d.mpMax,
        isDead: false,
        angryValue: 0,
        isAngry: false,
        // 格数不是这个函数要验的东西，照原样留着。
        skillNumber: getParty()[key].skillNumber,
      },
    ])
  }
}

/**
 * 一个**已经开局**的会话 —— `createSession` 交出来的那个停在标题上、没有
 * 世界（xl-q7f），下面每条用例要的都是进了场景之后的那个。
 *
 * 这两步合起来正是原版「起」那一下：`switchTo("scene")` 加
 * `scenePanel.initiation(...)`。开机停在标题上那一条由本文件末尾单独验。
 */
function openSession(world: World, d: SessionDeps): RunningSession {
  return enterScene(createSession(d), world)
}

const press = (k: string): InputEvent => ({ e: 'press', k, ctrl: false })
const release = (k: string): InputEvent => ({ e: 'release', k })

/** 场景那一侧的一拍：10 ms 一个 tick，这里一次喂 10 ms。 */
const SCENE_PUMP_MS = 10
/** 战斗那一侧的一拍是 100 ms。 */
const BATTLE_PUMP_MS = 100

interface Walk {
  session: RunningSession
  /** 主角一共换过几格 —— **独立数一遍**，不读 `FightEvent.count`。 */
  tiles: number
  pumps: number
}

/** 一个矩形的中心。导出器点的也是命中框中心，不是画出来那个框的中心。 */
function centerOf(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + Math.trunc(box.width / 2), y: box.y + Math.trunc(box.height / 2) }
}

/**
 * 「能点击就点『击』，能选敌就选第一个还站着的怪」—— 与导出器的 `autoAttack`
 * 同一条策略（`tools/src/devtools/BattleDriver.java`）。
 *
 * 为什么非得自动打：**一条输入都不喂的战斗根本不会结束**。行动条转到我方
 * 就停在那里等一次点击，怪物也就再不出手 —— 实测跑满 20000 拍仍未分出胜负。
 * 那个"跑不完"看起来像死循环，其实是原版的正常语义。
 *
 * 坐标是**真的算出来的**（命中框的中心），并且过一遍 `battleClick` 判回
 * 判别名 —— 也就是说这条自动攻打同时在验 `game/battleInput.ts` 那一层：
 * 判别名判错，这一场就打不完，用例超时变红。
 */
function autoAttackInput(w: BattleWorld): BattleInput[] {
  if (w.command.isDraw) {
    const attack = commandButtons(w)[0]!
    const c = centerOf({ x: attack.x - 15, y: attack.y - 6, width: attack.width, height: attack.height })
    const input = battleClick(w, c.x, c.y)
    if (input.target !== 'command:attack') {
      throw new Error(`点「击」按钮的中心 (${c.x},${c.y}) 判成了 ${input.target}`)
    }
    return [input]
  }
  if (w.selector.isSlectable) {
    for (const slot of [1, 2, 3] as const) {
      const e = [w.em1, w.em2, w.em3][slot - 1]
      if (!e || e.isDead) continue
      const s = w.selector
      const box =
        slot === 1
          ? { x: s.x1, y: s.y1, width: s.width1, height: s.height1 }
          : slot === 2
            ? { x: s.x2, y: s.y2, width: s.width2, height: s.height2 }
            : { x: s.x3, y: s.y3, width: s.width3, height: s.height1 }
      const c = centerOf(box)
      if (!hitsEnemy(w, slot, c.x, c.y)) continue
      const input = battleClick(w, c.x, c.y)
      if (input.target !== `enemy:${slot}`) {
        throw new Error(`点第 ${slot} 只怪的中心 (${c.x},${c.y}) 判成了 ${input.target}`)
      }
      return [input]
    }
  }
  return []
}

/**
 * 在场景里**真的走**，直到起了一场战斗。
 *
 * 走法：按住一个方向，格子不再变就换一个方向（迷宫里会撞墙）。这是玩家会做
 * 的事，也是唯一不作弊的走法 —— 直接改 `role.px` 就等于跳过了被测的那一层。
 */
function walkUntilBattle(
  session: RunningSession,
  maxPumps = 20000,
  pumpMs = SCENE_PUMP_MS,
  /** 提前收手的条件。默认一直走到开打。 */
  stop: (s: RunningSession) => boolean = (s) => s.panel !== 'scene',
): Walk {
  const dirs = ['right', 'left', 'down', 'up'] as const
  let dir = 0
  let tiles = 0
  let at = { x: roleTileX(session.scene.world.role), y: roleTileY(session.scene.world.role) }
  let stuck = 0
  let s = session
  for (let pumps = 1; pumps <= maxPumps; pumps++) {
    const key = dirs[dir % dirs.length]!
    s = advanceSession(s, { scene: [press(key)], battle: [], menu: [] }, pumpMs)
    // **先数格子再看面板**：起战斗的那一拍主角正好换了一格，漏掉它这个
    // 计数就恒比 `FightEvent.count` 少 1，而少 1 与"门槛写成 29"长得一样。
    const now = { x: roleTileX(s.scene.world.role), y: roleTileY(s.scene.world.role) }
    if (now.x !== at.x || now.y !== at.y) {
      tiles++
      at = now
      stuck = 0
    }
    if (stop(s)) return { session: s, tiles, pumps }
    if (now.x === at.x && now.y === at.y && ++stuck > 60) {
      // 撞墙了：松手换一个方向。松手是真的松（`keyReleased` 那一路）。
      s = advanceSession(s, { scene: [release(key)], battle: [], menu: [] }, pumpMs)
      dir++
      stuck = 0
    }
  }
  throw new Error(`走了 ${maxPumps} 拍还没起战斗（换过 ${tiles} 格）`)
}

/** 自动攻打，直到战斗自己切面板为止。`each` 每一拍跑一次，用来立不变量。 */
function runBattleToExit(
  session: RunningSession,
  maxPumps = 20000,
  each?: (s: RunningSession) => void,
): { session: RunningSession; pumps: number } {
  let s = session
  for (let pumps = 1; pumps <= maxPumps; pumps++) {
    const w = battleWorldOf(s)
    s = advanceSession(s, { scene: [], menu: [], battle: w ? autoAttackInput(w) : [] }, BATTLE_PUMP_MS)
    each?.(s)
    if (s.panel !== 'battle') return { session: s, pumps }
  }
  throw new Error(`战斗跑了 ${maxPumps} 拍还没结束`)
}

describe('场景 → 战斗 → 场景', () => {
  beforeEach(() => {
    resetParty()
  })

  it('迷宫1：走满 30 格起战斗，起的是 battle0 里的一行', () => {
    const scene = getScene('迷宫1')
    // 分母从数据现读：`count_battle0` 是 `mapSet.length > 20 ? 50 : 30`。
    expect(scene.mapSet.length).toBe(20)
    expect(scene.battle0).not.toBeNull()
    const session = openSession(createWorld(scene), deps())

    const walked = walkUntilBattle(session)
    expect(walked.session.panel).toBe('battle')
    // 门槛从数据推：20 行不大于 20，所以是 30 而不是 50。
    const threshold = session.scene.world.fight.stepsToBattle
    expect(threshold).toBe(30)
    // 独立数出来的格数比门槛**少一格**，而这不是凑出来的：原版 `FightEvent`
    // 的 `x` / `y` 字段初值是 **0**，不是主角的出生格（12,8），所以它第一次
    // `checkBattle0` 就先白记一格。把那两个字段改成"进场时的格子"，这条会红。
    expect(walked.tiles).toBe(threshold - 1)

    const world = battleWorldOf(walked.session)
    expect(world).not.toBeNull()
    // `random()` 恒为 0，所以挑中的是第 0 行：反斜杠那一条（伏魔山树林）。
    const picked = scene.battle0![0]!
    expect(world!.background).toBe('image/背景图/伏魔山树林.png')
    expect(picked[0]).toBe('image\\背景图\\伏魔山树林.png')
    expect(world!.em1!.name).toBe(picked[4]!.split('/')[0])
    expect(world!.em2!.name).toBe(picked[5]!.split('/')[0])
    expect(world!.em3!.name).toBe(picked[6]!.split('/')[0])
    // 三个人都出战（这一行是 zhang / yu / lu）。
    expect([world!.zxf, world!.yj, world!.lxq].every((h) => h !== null)).toBe(true)
    // BGM 换了：`initial()` 里那张背景图 → 曲子的表。
    expect(currentBgm(walked.session)).toBe('B6.mp3')
    expect(currentBgm(walked.session)).not.toBe(scene.sceneMusic)
  })

  it('整条环路：走进战斗、打完、回到原来那一格', () => {
    levelParty(20)
    const session = openSession(createWorld(getScene('迷宫1')), deps())
    const entered = walkUntilBattle(session).session
    expect(entered.panel).toBe('battle')

    // `FightEvent.fight()` 里那句 `role.setEvent(true)` 是"**允许**停"，
    // 不是"立刻停"：走路定时器要走到下一个可停点才吸附到整格并停表
    // （`role.ts` 的 `snapWalk`）。所以"原来的位置"是那个可停点，不是起
    // 战斗那一拍的像素坐标 —— 实测差 24 px，正好是三拍。
    let rest = entered
    for (let i = 0; i < 20 && rest.scene.world.role.walk.running; i++) {
      rest = advanceSession(rest, NO_INPUT, BATTLE_PUMP_MS)
    }
    expect(rest.scene.world.role.walk.running).toBe(false)
    expect(rest.scene.world.role.px % 32).toBe(0)
    expect(rest.scene.world.role.py % 32).toBe(0)
    const before = snapshotScene(rest)

    const done = runBattleToExit(rest, 20000, (mid) => {
      // **整场战斗里每一拍都比一遍**，不是只比首尾：中途被挪走再挪回来，
      // 只比首尾是看不出来的。
      expect(snapshotScene(mid)).toEqual(before)
    })
    expect(done.session.panel).toBe('scene')
    expect(battleWorldOf(done.session)).toBeNull()
    // 进战斗那一下，场景这一列就被 `BattlePanel.initial` 换成了战斗曲 ——
    // `MusicPlayer.currentPlayingBGM` 是全局的，真值 `battle-door` 记着
    // （xl-yg6.11）。伏魔山树林那一行按背景图挑的是 B6。
    expect(before.bgm).toBe('B6.mp3')
    // 回到场景那一拍原版只是 `SCENE_SIGNAL=1`；**下一拍** `ScenePanel.step()`
    // 末尾才 `readBGM(reader.getSceneMusic())`。所以这里先看信号、再推一拍看曲子。
    expect(done.session.scene.world.sceneSignal).toBe(true)
    const back = advanceSession(done.session, NO_INPUT, SCENE_PUMP_MS)
    expect(back.scene.world.sceneSignal).toBe(false)
    expect(currentBgm(back)).toBe(getScene('迷宫1').sceneMusic)

    // 场景那一侧：主角像素坐标、脚本、NPC 名单、BGM 声明一个都没变。
    // （虚拟时间与 NPC 的定时器**是**会走的 —— 原版那条线程没停。）
    expect(snapshotScene(done.session)).toEqual(before)
    expect(done.session.scene.world.timeMs).toBeGreaterThan(entered.scene.world.timeMs)

    // 经验涨了。分母是这一场三只怪的 exp 之和，从战斗世界现算。
    const party = getParty()
    expect(party.zhang.exp + party.yu.exp + party.lu.exp).toBeGreaterThan(0)
  })

  it('打输的两条分支各走各的：罹年居士回地图，别的怪回标题', () => {
    const seen: Record<string, string> = {}
    for (const name of ['battle-defeat-scene', 'battle-defeat-start'] as const) {
      resetParty()
      const trace = readBattleTrace(name)
      const base = openSession(createWorld(getScene('迷宫1')), deps())
      const s: RunningSession = {
        ...base,
        panel: 'battle',
        battle: createBattleTicker(replayBattle(trace, spriteSize)),
      }
      seen[name] = runBattleToExit(s).session.panel
    }
    // 两条真的**分家**了。写成两条独立断言的话，"两条都回标题"要看两处才
    // 发现；写成一个对象比一次，分不开就整块红。
    expect(seen).toEqual({
      'battle-defeat-scene': 'scene',
      'battle-defeat-start': 'start',
    })
  })

  /**
   * 回标题那一屏放的是主题曲（xl-kaa）。
   *
   * 判据**不是** `currentBgm` 返回了这个字符串 —— 那是拿一个常量去比它自己。
   * 判的是播放器接下来那一步：它拿这个声明值去查 URL，而
   * `resolveBgmOrNull` 对既不在映射表、也不在"故意没烘"名单里的 ID 是**抛**，
   * 调用点在游戏循环里（`useGame` 的 pump），也就是每一拍抛一次、画面就此
   * 定住。xl-rh9.17 落下 `panel === 'start'` 这个终止态之后，实测就是这个
   * 下场 —— 而它跟"到了标题所以不动了"长得一模一样。
   */
  it('打输回标题：曲子换成主题曲，而且它真的烘出来了', () => {
    const trace = readBattleTrace('battle-defeat-start')
    const base = openSession(createWorld(getScene('迷宫1')), deps())
    const s: RunningSession = {
      ...base,
      panel: 'battle',
      battle: createBattleTicker(replayBattle(trace, spriteSize)),
    }
    const done = runBattleToExit(s).session
    expect(done.panel).toBe('start')
    expect(currentBgm(done)).toBe(TITLE_BGM)
    // 场景那一侧的曲子还挂着（世界照跑），所以这条真的换过了。
    expect(currentBgm(done)).not.toBe(getScene('迷宫1').sceneMusic)

    const url = resolveBgmOrNull(bgmAssetId(TITLE_BGM))
    expect(url).not.toBeNull()
    expect(decodeURIComponent(url!)).toContain('bgm/主题曲.m4a')
  })

  /**
   * 打输回标题会把背景音乐开关拨回「开」（xl-03x.21）：`switchTo("start")` 那一支
   * 末尾是 `MusicReader.openBGM()`，而它是 `play(currentPlayingBGM)` +
   * `CAN_PLAY_BGM = YES`。原版读数（2026-09-11，JVM 实跑天书页「关」→「重新开始」，
   * 走的是同一个 case）：1 → 2 → 1。
   *
   * 两支一起跑：罹年居士那支走 `switchTo("scene")`，**不**拨开关 —— 分不开的话
   * 「凡是打输都拨回开」也是绿的。特殊音效那一位 `openBGM()` 不碰，也一并钉住。
   */
  it('打输回标题把背景音乐开关拨回「开」；回地图那支不拨，特殊音效那位也不碰', () => {
    const seen: Record<string, unknown> = {}
    try {
      for (const name of ['battle-defeat-scene', 'battle-defeat-start'] as const) {
        resetParty()
        rememberAudioSettings({ bgm: false, sfx: false })
        const trace = readBattleTrace(name)
        const base = openSession(createWorld(getScene('迷宫1')), deps())
        const s: RunningSession = { ...base, panel: 'battle', battle: createBattleTicker(replayBattle(trace, spriteSize)) }
        // 反向控制：关着的时候战斗那一屏是无声的，下面那条「有声」才是开关拨回来的。
        expect(currentBgm(s), `${name}：关掉背景音乐之后战斗里还有声`).toBeNull()
        const done = runBattleToExit(s).session
        seen[name] = { panel: done.panel, audio: getAudioSettings(), bgm: currentBgm(done) }
      }
    } finally {
      resetAudioSettings()
    }
    expect(seen).toEqual({
      'battle-defeat-scene': { panel: 'scene', audio: { bgm: false, sfx: false }, bgm: null },
      'battle-defeat-start': { panel: 'start', audio: { bgm: true, sfx: false }, bgm: TITLE_BGM },
    })
  })

  it('打赢：结算跑完回场景，经验记进队伍', () => {
    const trace = readBattleTrace('battle-victory')
    const session = openSession(createWorld(getScene('迷宫1')), deps())
    // 战斗那一侧整个换成这份真值的剧本（**只有剧本，没有状态**），因为
    // "这串点击真的能打赢"是真值负责的事。场景那一侧原样留着。
    const world = replayBattle(trace, spriteSize)
    let s: RunningSession = { ...session, panel: 'battle', battle: createBattleTicker(world) }

    for (const tick of trace.ticks) {
      s = advanceSession(s, { scene: [], menu: [], battle: tick.input }, BATTLE_PUMP_MS)
      if (s.panel !== 'battle') break
    }
    // 真值到胜利那一刻就停了，结算还要几十拍才走完。
    const done = s.panel === 'battle' ? runBattleToExit(s) : { session: s, pumps: 0 }
    expect(done.session.panel).toBe('scene')
    expect(battleWorldOf(done.session)).toBeNull()
    // 回到场景 = BGM 换回这个场景的曲子（原版的 SCENE_SIGNAL）。
    expect(currentBgm(done.session)).toBe(getScene('迷宫1').sceneMusic)

    // 经验涨了：分母是这一场三只怪的 exp 之和，从战斗世界现算，不是手写的。
    const gained = world.party.map((h) => h.exp)
    expect(gained.some((e) => e > 0)).toBe(true)
    const party = getParty()
    for (const h of world.party) {
      expect(party[h.spec.key].exp).toBe(h.exp)
      expect(party[h.spec.key].level).toBe(h.level)
      expect(party[h.spec.key].hp).toBe(h.hp)
    }
  })

  it('剧情固定战：把带 @ 的那段对话按完就开打，而且剧情往前推了一段', () => {
    // 脚本22 的 Dialogue 触发码是 -1（进场自动播），正文里有 @，battle1 只有
    // 一场，一号位是罹年居士 —— 也就是 `NEXT_SCRIPT_ENEMIES` 里那八个之一，
    // 所以开打之前原版还要 `exitEvent.nextScript()` 把剧情推到脚本23。
    const scene = getScene('脚本22')
    expect(scene.dialogueCode).toEqual(['-1'])
    const row = scene.battle1![0]!
    expect(NEXT_SCRIPT_ENEMIES).toContain(row[4])

    let s = openSession(createWorld(scene), deps())
    // 自动对话弹出 + 逐字打印，然后一路空格按到底。判据是"开打了"，不是拍数。
    for (let i = 0; i < 4000 && s.panel === 'scene'; i++) {
      const key = i % 20 === 19 ? [press('space'), release('space')] : []
      s = advanceSession(s, { scene: key, battle: [], menu: [] }, SCENE_PUMP_MS)
    }
    expect(s.panel).toBe('battle')
    const w = battleWorldOf(s)!
    expect(w.em1!.name).toBe(row[4]!.split('/')[0])
    expect(w.background).toBe(row[0])
    // `ExitEvent.nextScript()`：场景整个换掉，主角站到 currentScript[0]。
    const next = scene.nextScript!
    expect(s.scene.world.scene).toBe(next[2])
    expect(s.scene.world.currentScript).toEqual(next)
    const [ex, ey] = next[0]!.split('/').map(Number)
    expect([s.scene.world.role.px / 32, s.scene.world.role.py / 32]).toEqual([ex, ey])
    // 这一场之后 battle1Over 该是真的（只有一场）。注意 fight 已经跟着
    // nextScript 换成新场景那一份了，所以读的是**换之前**那一份留下的结果 ——
    // 换句话说这里读到的是新场景的，恒为 false。断言的是新场景的事实。
    expect(s.scene.world.fight.battle1Over).toBe(false)
  })

  it('一次 pump 补跑很多拍，起战斗那一拍不会被吞掉', () => {
    const session = openSession(createWorld(getScene('迷宫1')), deps())
    const threshold = session.scene.world.fight.stepsToBattle

    // 先一拍一拍地走到**再换一格就开打**为止，然后只喂一次 500 ms
    // （50 拍）—— 触发的那一拍一定落在这一批的中间。
    //
    // ⚠️ 这里必须是"停在门槛前一格再一次大 pump"，不能只是"整趟都用大 pump
    // 走"。后者**分辨不出东西**（实测：`state/loop.ts` 那个 break 换成
    // `if (false) break` 照样绿；xl-i06.3 收拢之前量的，那时每个请求各一条
    // break）—— 请求被同批的下一拍覆盖之后 `count` 归零，
    // 走者只是再走 30 格，总有一趟的触发拍正好落在批尾。
    const ready = walkUntilBattle(
      session,
      20000,
      SCENE_PUMP_MS,
      (s) => s.scene.world.fight.count === threshold - 1,
    )
    expect(ready.session.panel).toBe('scene')
    expect(ready.session.scene.world.fight.count).toBe(threshold - 1)

    const burst = advanceSession(ready.session, { scene: [press('right')], battle: [], menu: [] }, 500)
    expect(burst.panel, '起战斗那一拍被同一批的下一拍吞掉了').toBe('battle')
    expect(battleWorldOf(burst)).not.toBeNull()
    // 没跑完的那几拍留在 carryMs 里，一拍都没丢。
    expect(burst.scene.carryMs).toBeGreaterThan(0)
  })

  it('上一场死掉的人，这一场从上限的 10% 起（BattlePanel.initial 末尾那个循环）', () => {
    const d = deps()
    const spec = ['image/背景图/仙二迷宫.png', 'zhang', 'null', 'null', '怪物1/5', 'null', 'null']
    const dead = { level: 1, exp: 0, hp: 0, mp: 0, isDead: true, angryValue: 0 }
    const world = createBattle({
      ...configFor(spec, d),
      carry: { zhang: dead },
    })
    const zxf = world.zxf!
    expect(zxf.isDead).toBe(false)
    expect(zxf.hp).toBe(Math.trunc(zxf.hpMax * REVIVE_HP_RATIO))
    // 分辨得开：10% 与满血差得远，也与 0 差得远。
    expect(zxf.hp).toBeGreaterThan(0)
    expect(zxf.hp).toBeLessThan(zxf.hpMax)

    // 没死但血低的人**不复位**：那个循环只在 `wheatherDead()` 为真时跑。
    const hurt = createBattle({
      ...configFor(spec, d),
      carry: { zhang: { ...dead, isDead: false, hp: 7 } },
    })
    expect(hurt.zxf!.hp).toBe(7)
  })

  it('打赢跨过 10 级那道门槛：格数 +1、记进队伍，下一场技能菜单与奇术页都多一颗（xl-03x.17）', () => {
    // 9 级、经验差 1 点升级：这一场打赢必过 10 级。三个人各自的出厂格数不同（2/3/2），
    // 所以先抬到同一个 4 —— 过门槛后该是 5。「10」是 `levelUp` 那三道门槛（2/5/10）里
    // 离 9 最近的一道，由 `skills.test.ts` 从源码现读。
    levelParty(9)
    for (const key of ['zhang', 'yu', 'lu'] as PartyKey[]) {
      getParty()[key].exp = expToLevelUp(9) - 1
      getParty()[key].skillNumber = 4
    }
    const session = openSession(createWorld(getScene('迷宫1')), deps())
    const first = runBattleToExit(walkUntilBattle(session).session).session
    expect(first.panel, '这一场要打赢才有结算').toBe('scene')
    const party = getParty()
    for (const key of ['zhang', 'yu', 'lu'] as PartyKey[]) {
      // 只核真出了战的：没出战的那位原版一个字都没被动过。
      if (party[key].level === 9) continue
      expect(party[key].level, `${key} 升到 10`).toBe(10)
      expect(party[key].skillNumber, `${key} 的格数`).toBe(5)
    }
    const leveled = (['zhang', 'yu', 'lu'] as PartyKey[]).filter((k) => party[k].level === 10)
    expect(leveled.length, '至少一个人真的升了级 —— 否则上面那个循环一条都没核').toBeGreaterThan(0)

    // 下一场：技能菜单那一组按钮数 = 队伍上的格数。
    const second = walkUntilBattle(first).session
    const menu = battleWorldOf(second)!.skillMenu
    for (const key of leveled) expect(menu.groups[key], `${key} 的技能菜单`).toHaveLength(5)
    // 开菜单：奇术页读的那三个人也是 5。
    const opened = openMenu({ ...first })
    MENU_HERO_ORDER.forEach(({ key, name }, i) => {
      const h = menuWorldOf(opened)!.heroes[i]!
      expect(h.name).toBe(name)
      expect(h.skillNumber, name).toBe(party[key].skillNumber)
    })
  })

  it('第二场接着第一场：血、经验、等级都带过去了', () => {
    // **12 级不是随手挑的**：20 级打这一场毫发无伤（实测 3360/3360），
    // 于是"血带过去了"与"血是满的"长得一模一样，`carry` 拆掉也不会红。
    // 12 级打赢还剩 2139/2240 —— 差 101，这条才分得开。
    levelParty(12)
    const session = openSession(createWorld(getScene('迷宫1')), deps())
    const first = runBattleToExit(walkUntilBattle(session).session).session
    expect(first.panel).toBe('scene')
    const after = { ...getParty().zhang }
    expect(after.exp).toBeGreaterThan(0)

    // 再走 30 格，第二场。开场的血与经验要等于上一场收工时的那份 ——
    // `createBattle` 的 `carry` 不接上的话，这里会是满血、经验 0。
    const second = walkUntilBattle(first).session
    expect(second.panel).toBe('battle')
    const zxf = battleWorldOf(second)!.zxf!
    expect(zxf.level).toBe(after.level)
    expect(zxf.exp).toBe(after.exp)
    expect(zxf.hp).toBe(after.hp)
    // 上一场是打赢的，所以血没满 —— 这条保证上面那三条不是"正好等于开局值"。
    expect(after.hp).toBeLessThan(zxf.hpMax)
  })

  /**
   * 开机停在标题上（xl-q7f）—— 原版 `GameLauncher` 构造函数的最后一句
   * `switchTo("start")`。
   *
   * **判据不是"panel 是 start"一条**：先建好一个世界、再把面板摆成 start，
   * 那一条照样绿，而那正是这处差别最容易被做成的样子（画面上两者一模一样，
   * 都是一张标题图）。所以还要验"世界根本不在"与"推它是空操作"。
   */
  it('起手就停在标题上：没有世界，推多少拍都原地不动', () => {
    const session = createSession(deps())
    expect(session.panel).toBe('start')
    expect(session.scene).toBeNull()
    expect(battleWorldOf(session)).toBeNull()
    // 标题那一屏放主题曲 —— 原版 `switchTo("start")` 里那句
    // `readBGM("主题曲.mp3")`。夹在它与 `openBGM()` 之间那个 `sleep(1000)`
    // 是音频线程的同步补丁，不抄，理由写在 `createSession` 上。
    expect(currentBgm(session)).toBe(TITLE_BGM)

    // 推它是**空操作**：原样的那个对象回来。写成 `toBe` 而不是 `toEqual` ——
    // 一个"每拍推一个空世界、只是恰好什么都没变"的实现 `toEqual` 也是绿的。
    const later = advanceSession(session, { scene: [press('right')], battle: [], menu: [] }, 5000)
    expect(later).toBe(session)
  })

  /**
   * 点「起」那一下：`switchTo("scene")` + `scenePanel.initiation(...)`。
   *
   * 进哪个场景由调用方给（原版那三句里只有 `initiation` 认文件名），所以
   * 这里验的是"给什么进什么"，"「起」给的恒是脚本1"归 `app/App.tsx`。
   */
  it('开局才建世界：进的是给的那个场景，主角在脚本写的出生格上', () => {
    const scene = getScene('脚本1')
    const started = enterScene(createSession(deps()), createWorld(scene))
    expect(started.panel).toBe('scene')
    expect(battleWorldOf(started)).toBeNull()
    // 曲子从主题曲换成这个场景的（`initiation` 末尾那句 `readBGM`）。
    expect(currentBgm(started)).toBe(scene.sceneMusic)
    expect(currentBgm(started)).not.toBe(TITLE_BGM)
    // 出生格从脚本现读，不是手写的一对数。
    const role = started.scene.world.role
    expect([roleTileX(role), roleTileY(role)]).toEqual([scene.roleX, scene.roleY])
  })

  it('configFor：7 元组逐位解开，"null" 是空槽位、别的词是没出战', () => {
    const d = deps()
    const c = configFor(['image/背景图/仙二迷宫.png', 'zhang', 'no', 'lu', '怪物1/5', 'null', '怪物2/7'], d)
    expect(c.party).toEqual(['zhang', 'lu'])
    expect(c.enemies).toEqual(['怪物1/5', null, '怪物2/7'])
    expect(c.levels).toEqual({ zhang: 1, yu: 3, lu: 1 })
    expect(() => configFor(['a', 'b', 'c'], d)).toThrow(/7 列/)
  })
})

/** 场景那一侧**不许因为打了一架而变**的东西。 */
function snapshotScene(s: RunningSession) {
  const w = s.scene.world
  return {
    scene: w.scene,
    px: w.role.px,
    py: w.role.py,
    dir: w.role.dir,
    bgm: w.audio.bgm,
    currentScript: w.currentScript,
    // 只有名单与条数，**没有坐标**：NPC 在战斗期间照样在走（原版
    // `ScenePanel.run()` 那条线程没停），钉住坐标会立成一条与原版相反的
    // 不变量 —— 它会红，而红的是对的那一侧。
    npcs: w.npcs.map((n) => n.name),
    npcCount: w.npcs.length,
  }
}

/**
 * 答对答错的加扣金币落进钱包（xl-yg6.9）。
 *
 * 原版是 `SelectEvent.keyPressed` 里那两句 `Money.addCoins(i)` /
 * `Money.reduceCoins(i)` —— 与 `drawString` 在同一拍。状态层把它做成只亮一拍的
 * `World.presentRequest`（xl-yg6.8），这里验的是**会话真的把它记进了钱包**。
 *
 * 真值不记钱（金额是 `Math.random()` 现掷的，见 `docs/trace-format.md`），所以
 * 这一条没有真值可对：`random` 钉成 0.5，金额恒为 `500 + (int)(500 * 0.5)`。
 */
describe('答题 → 钱包', () => {
  beforeEach(() => {
    resetWallet()
  })

  /** 站到大活 0 号 NPC 那一格上（与 `state/select.test.ts` 同一个摆法）。 */
  function daHuo(): RunningSession {
    const world = createWorld(getScene('大活'))
    const npc = world.npcs[0]!
    return openSession(
      { ...world, role: { ...world.role, px: npc.x * 32, py: npc.y * 32 } },
      deps(fixedRandom(0.5)),
    )
  }

  const scene = (keys: InputEvent[]) => ({ scene: keys, battle: [], menu: [] })

  /** 一拍一拍推，直到选择框的三个定时器都停下来。 */
  function settle(session: RunningSession): RunningSession {
    let s = session
    for (let i = 0; i < 4000; i++) {
      const t = s.scene.world.select
      if (!t.selectImageMove.running && !t.questionImageMove.running && !t.wordsRun.running) return s
      s = advanceSession(s, scene([]), SCENE_PUMP_MS)
    }
    throw new Error('选择框 4000 拍还没停下来')
  }

  /** 走到问题框吐完、光标停在初值上。 */
  function asking(): RunningSession {
    let s = daHuo()
    // 0 号 NPC 是原地运动型，要等 `checkNpcStop` 把它停下来才搭得上话。
    for (let i = 0; i < 5; i++) s = advanceSession(s, scene([]), SCENE_PUMP_MS)
    s = settle(advanceSession(s, scene([press('space')]), SCENE_PUMP_MS))
    expect(s.scene.world.select.question, '第一下空格该弹出「要不要答题」').toBe(true)
    s = settle(advanceSession(s, scene([press('enter')]), SCENE_PUMP_MS))
    expect(s.scene.world.select.asking).toBe(true)
    return s
  }

  it('答错扣钱、答对加钱，金额与提示语是同一个数', () => {
    const answer = Number(getScene('大活').answer![0]![0])

    // 答错：光标停在初值 size()-5 上，而这道题的答案不是它（夹具先核一遍）。
    const wrong = asking()
    expect(wrong.scene.world.select.abcd).not.toBe(answer)
    const w = advanceSession(wrong, scene([press('enter')]), SCENE_PUMP_MS)
    expect(w.scene.world.presentRequest).toEqual({
      correct: false,
      coins: 750,
      text: '回答错误，扣掉750个金币',
    })
    expect(getCoins()).toBe(10000 - 750)

    // 答对：挪到答案那一行再交卷。
    resetWallet()
    let right = asking()
    // 有界：答案那一行要是不在光标的取值范围里，这里该报错，而不是挂到超时。
    for (let i = 0; i < 8 && right.scene.world.select.abcd !== answer; i++) {
      right = advanceSession(right, scene([press('down')]), SCENE_PUMP_MS)
    }
    expect(right.scene.world.select.abcd, '按了 8 下下键还没挪到答案那一行').toBe(answer)
    const r = advanceSession(right, scene([press('enter')]), SCENE_PUMP_MS)
    expect(r.scene.world.presentRequest?.correct).toBe(true)
    expect(getCoins()).toBe(10000 + 750)
  })

  /**
   * `presentRequest` 只亮一拍，而一次 pump 常常补跑好几拍 —— 与 `battleRequest`
   * 同一个坑（`state/loop.ts` 的那个 break）。不停的话，交卷那一拍的请求被同批
   * 下一拍的 `null` 盖掉，钱包一个子儿都不动，而画面上"题答完了"照常发生。
   */
  it('一次 pump 补跑很多拍，交卷那一拍的加扣不会被吞掉', () => {
    const s = asking()
    const burst = advanceSession(s, scene([press('enter')]), 500)
    expect(burst.scene.world.presentRequest, '交卷那一拍被同一批的下一拍吞掉了').not.toBeNull()
    expect(getCoins()).toBe(10000 - 750)
    // 没跑完的那几拍留在 carryMs 里；下一次 pump 接着跑，钱不会再扣一次。
    expect(burst.scene.carryMs).toBeGreaterThan(0)
    const next = advanceSession(burst, scene([]), SCENE_PUMP_MS)
    expect(next.scene.world.presentRequest).toBeNull()
    expect(getCoins()).toBe(10000 - 750)
  })
})

/**
 * 开箱开出来的东西进背包（xl-yg6.10）。
 *
 * 原版是 `TreasureBox.keyPressed` 里那句 `DrugPack.addDrug(treasureName, i)`，
 * 与 `drawString` 同一拍。状态层把它做成只亮一拍的 `World.treasureRequest`，
 * 这里验的是**会话真的把它记进了背包**，而且一个箱子只记一次。
 *
 * 真值不记背包（数量是 `Math.random()` 现掷的），`random` 钉成 0.5，
 * 数量恒为 `1 + (int)(2 * 0.5)` = 2。
 */
describe('开箱 → 背包', () => {
  beforeEach(() => {
    resetDrugPack()
  })

  /** 站在迷宫1 那个 (4,17) 宝箱的正上方 (4,16) —— maze-treasure 的同一个摆法。 */
  function maze(): RunningSession {
    const world = createWorld(getScene('迷宫1'), false)
    return openSession(
      { ...world, role: { ...world.role, px: 4 * 32, py: 16 * 32 } },
      deps(fixedRandom(0.5)),
    )
  }

  const scene = (keys: InputEvent[]) => ({ scene: keys, battle: [], menu: [] })

  /**
   * ⚠️ 这个箱子写的是「金疮药」，原版药表里是「金创药」（脚本错字）。原版 `addDrug` 找不到
   * 名字什么都不做 —— xl-03x.3 的账本对撞在 maze-treasure 上实测：原版开箱之后药包全 0。
   * 所以这里钉的是**请求照亮、药包一件不进**；「真药名进背包」在 `sceneLedger.test.ts`。
   */
  const held = () => drugEntries().filter(([, n]) => n !== 0)

  it('按空格：请求亮了，但错字名一件都不进背包；再按一下，同一个箱子不再给', () => {
    // 先走一拍，让第 6 步 checBoxes 把 near 置真。
    let s = advanceSession(maze(), scene([]), SCENE_PUMP_MS)
    s = advanceSession(s, scene([press('space')]), SCENE_PUMP_MS)
    expect(s.scene.world.treasureRequest).toEqual([{ name: '金疮药', count: 2 }])
    expect(held(), '原版药表里没有这一味，addDrug 什么都不做').toEqual([])
    for (let i = 0; i < 5; i++) s = advanceSession(s, scene([]), SCENE_PUMP_MS)
    s = advanceSession(s, scene([press('space')]), SCENE_PUMP_MS)
    expect(s.scene.world.treasureRequest, '同一个箱子给了第二次').toBeNull()
  })

  /**
   * 同一个箱子换成**原版药表里真有的名字**：进得去，再按一下不重复给。少了这一条，上面
   * 那条「错字名一件不进」在「addDrug 整个坏掉」的篡改下也是绿的。原版这一侧的读数见
   * xl-03x.3 关票理由（探针直接驱动 `TreasureBox.keyPressed`）。
   */
  function mazeWithRealDrug(): RunningSession {
    const s = maze()
    const t = s.scene.world.treasure
    const boxes = t.boxes!.map((b) => ({ ...b, name: '还魄丹' }))
    return { ...s, scene: { ...s.scene, world: { ...s.scene.world, treasure: { ...t, boxes } } } }
  }

  it('真药名：进背包 2 件；再按一下，同一个箱子不再给', () => {
    let s = advanceSession(mazeWithRealDrug(), scene([]), SCENE_PUMP_MS)
    expect(drugCount('还魄丹')).toBe(0)
    s = advanceSession(s, scene([press('space')]), SCENE_PUMP_MS)
    expect(s.scene.world.treasureRequest).toEqual([{ name: '还魄丹', count: 2 }])
    expect(drugCount('还魄丹')).toBe(2)
    for (let i = 0; i < 5; i++) s = advanceSession(s, scene([]), SCENE_PUMP_MS)
    s = advanceSession(s, scene([press('space')]), SCENE_PUMP_MS)
    expect(s.scene.world.treasureRequest).toBeNull()
    expect(drugCount('还魄丹'), '同一个箱子给了第二次').toBe(2)
  })

  it('一次 pump 补跑很多拍，开箱那一拍的东西不会被吞掉', () => {
    // 真药名的箱子：错字名一件不进，拿它当「这一拍结算过」的证据就恒为 0、分辨不出吞没吞。
    const s = advanceSession(mazeWithRealDrug(), scene([]), SCENE_PUMP_MS)
    const burst = advanceSession(s, scene([press('space')]), 500)
    expect(burst.scene.world.treasureRequest, '开箱那一拍被同一批的下一拍吞掉了').not.toBeNull()
    expect(drugCount('还魄丹')).toBe(2)
    expect(burst.scene.carryMs).toBeGreaterThan(0)
    const next = advanceSession(burst, scene([]), SCENE_PUMP_MS)
    expect(next.scene.world.treasureRequest).toBeNull()
    expect(drugCount('还魄丹')).toBe(2)
  })
})

/**
 * 战斗药品菜单读的是药包那一份（xl-byy）。
 *
 * 原版 `DrugMenu` 读 static 的 `DrugPack.drugList`：商店买的、宝箱开的、战利品掉的，
 * 战斗里都用得上。从前这一层 `drugStock` 写死全 0，玩家点任何药都只弹「没药」。
 * 真的用药那一路（回血回蓝、回复数字、progressGo）由 `battle-drugs` 那份真值逐字段
 * 钉住；这里钉的是**会话的接线**：进门现读、用掉当拍写回。
 */
describe('战斗里的药来自药包，用掉的写回药包（xl-byy）', () => {
  beforeEach(() => {
    resetParty()
    resetDrugPack()
  })

  /** 一颗按钮的命中框中心（`hit` 左偏 15、上偏 6），并核对它真的判成了 `target`。 */
  function clickOn(w: BattleWorld, b: { x: number; y: number; width: number; height: number }, target: string) {
    const c = centerOf({ x: b.x - 15, y: b.y - 6, width: b.width, height: b.height })
    const input = battleClick(w, c.x, c.y)
    if (input.target !== target) throw new Error(`点 (${c.x},${c.y}) 判成了 ${input.target}，要的是 ${target}`)
    return [input]
  }

  it('起的那一场，药品菜单的存货就是药包此刻的数', () => {
    addDrug(DRUGS[0]!.name, 2)
    addDrug(DRUGS[3]!.name, 1)
    const expected = DRUGS.map((d) => drugCount(d.name))
    expect(expected.some((n) => n > 0), '对照失效：药包是空的').toBe(true)
    const walked = walkUntilBattle(openSession(createWorld(getScene('迷宫1')), deps()))
    expect(battleWorldOf(walked.session)!.drugStock).toEqual(expected)
  })

  it('点「物」→ 金创药：扣一件，药包当拍跟上；没点的那几味不动', () => {
    levelParty(20)
    const drug = DRUGS[0]!
    addDrug(drug.name, 2)
    const before = DRUGS.map((d) => drugCount(d.name))
    let s = walkUntilBattle(openSession(createWorld(getScene('迷宫1')), deps())).session
    for (let pumps = 0; pumps < 5000; pumps++) {
      const w = battleWorldOf(s)
      if (w === null) throw new Error('还没用上药战斗就结束了')
      const input = w.drugMenu.isDraw
        ? clickOn(w, w.drugMenu.buttons[0]!, 'drugMenu:0')
        : w.command.isDraw
          ? clickOn(w, commandButtons(w)[3]!, 'command:thing')
          : []
      s = advanceSession(s, { scene: [], menu: [], battle: input }, BATTLE_PUMP_MS)
      const after = battleWorldOf(s)
      if (after !== null && after.drugStock[0] !== before[0]) {
        expect(after.drugStock[0], '一次扣了不止一件').toBe(before[0]! - 1)
        expect(after.reminder.isDraw, '走的是「没药」那一支').toBe(false)
        // 正本判据：**同一拍**药包就少了那一件，别的几味一个不动。
        expect(DRUGS.map((d) => drugCount(d.name))).toEqual(before.map((n, i) => (i === 0 ? n - 1 : n)))
        return
      }
    }
    throw new Error('5000 拍里一次药都没用上')
  })

  /**
   * 战利品的药是在战斗那一拍**里面**直接 `addDrug` 进药包的（`victory.ts` 的
   * `awardLoot`），不经过战斗世界的 `drugStock`。写回要是拿「世界里的数 − 药包里的数」
   * 去补，这一拍掉的药当场就被减回去 —— 打赢了、画面上也画着掉了什么，背包里没有。
   */
  it('打赢掉的药进了药包，战斗每一拍的写回不许把它抹掉', () => {
    levelParty(20)
    const before = DRUGS.map((d) => drugCount(d.name))
    const s = walkUntilBattle(openSession(createWorld(getScene('迷宫1')), deps())).session
    // 这一场掉什么从怪现读（`thing` 那一列，`名字/1` 是药），不手写。
    const loot = new Map<string, number>()
    for (const e of battleWorldOf(s)!.enemies) {
      const [name, kind] = e.spec.thing.split('/')
      if (kind === '1' && DRUGS.some((d) => d.name === name)) loot.set(name!, (loot.get(name!) ?? 0) + 1)
    }
    expect(loot.size, '对照失效：这一场一味药都不掉').toBeGreaterThan(0)

    const done = runBattleToExit(s)
    expect(done.session.panel, '没打赢 —— 战利品那一拍没走到').toBe('scene')
    expect(DRUGS.map((d) => drugCount(d.name))).toEqual(before.map((n, i) => n + (loot.get(DRUGS[i]!.name) ?? 0)))
  })
})

/**
 * 原版的 `EquipmentPack` 是**一份** static，`VictoryReminder` 发的装备、装备超市卖的、
 * 菜单装备页列的是同一张表。这一层的落点是菜单装备页的 `owned`；战利品从前落进一个
 * 没人读的假货（`fakes/equipmentPack`），打赢了、卷轴上也画着掉了什么，菜单里没有（xl-5jx）。
 * 装备超市那一半在 `doors.test.ts`。
 */
describe('打赢掉的装备进全局装备背包（xl-5jx）', () => {
  beforeEach(() => {
    resetParty()
    resetDrugPack()
  })

  it('打完回场景，开菜单装备页：每件战利品各多一件', () => {
    // 三只都掉装备，三件分属不同的表（武器 / 头 / 盔甲）—— 只搬进一张表的写法也会红。
    const { world, loot } = wonBattle(['罹年居士/5', '物理阁护法/6', '大刀/7'], spriteSize)
    expect(new Set([...loot.keys()].map(slotOf)).size, '对照失效：掉的装备没有分属几张表').toBeGreaterThan(1)
    const base = openSession(createWorld(getScene('迷宫1')), deps())
    const before = base.menu.world.panels.equipPanel.equip!
    const countsBefore = [...loot.keys()].map((n) => equipCount(before, slotOf(n), n))

    const done = runBattleToExit({ ...base, panel: 'battle', battle: createBattleTicker(world) }).session
    expect(done.panel, '没打赢 —— 战利品那一拍没走到').toBe('scene')
    // 一次性请求，搬完就清：留着的话下一拍又搬一遍。
    expect(world.lootEquipment).toEqual([])

    const equip = menuWorldOf(openMenu(done))!.panels.equipPanel.equip!
    expect([...loot.keys()].map((n) => equipCount(equip, slotOf(n), n))).toEqual(
      countsBefore.map((c, i) => c + loot.get([...loot.keys()][i]!)!),
    )
  })

  /**
   * 原版自己名字对不上的那一件：`缘铭道者` 掉 `颀崟巨环/2`（`VictoryReminder` 那张怪表），
   * 出厂表 `sources/Shop/武器.txt` 里写的是 `颀鉴巨环`。`addEqupment` 六张表扫一遍找不到，
   * **什么都不做** —— 照抄，别"顺手修好"，也别抛（2026-09-12 现查：13 件装备战利品只有这一件
   * 对不上）。
   */
  it('名字对不上出厂表的那一件（颀崟巨环）一声不响丢掉，六张表一格不动', () => {
    const { world, loot } = wonBattle(['缘铭道者/5', null, null], spriteSize)
    const [name] = [...loot.keys()]
    expect(name, '对照失效：缘铭道者不掉装备了').toBeDefined()
    expect(() => slotOf(name!), '对照失效：这件的名字已经对得上出厂表了').toThrow()
    const base = openSession(createWorld(getScene('迷宫1')), deps())
    const snapshot = () => structuredClone(base.menu.world.panels.equipPanel.equip!.owned)
    const before = snapshot()

    const done = runBattleToExit({ ...base, panel: 'battle', battle: createBattleTicker(world) }).session
    expect(done.panel, '没打赢 —— 战利品那一拍没走到').toBe('scene')
    expect(snapshot()).toEqual(before)
  })
})
