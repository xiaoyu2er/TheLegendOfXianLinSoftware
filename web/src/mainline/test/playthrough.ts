import { readFileSync } from 'node:fs'
import { advanceSession, createSession, enterScene } from '../../game/session'
import type { RunningSession, SessionInput } from '../../game/session'
import type { BattleInput } from '../../battle/step'
import { decodePng } from '../../compare/png'
import { START_SCENE } from '../../data/scenes'
import { resetDrugPack } from '../../fakes/drugPack'
import { resetParty } from '../../fakes/party'
import { resetWallet } from '../../fakes/wallet'
import { JavaRandom } from '../../game/javaRandom'
import { createMemorySaveStore } from '../../save/memoryStore'
import { facing } from '../../state/npc'
import { isAllow } from '../../state/role'
import { TICK_MS, createWorld } from '../../state/step'
import { sceneSourceOf } from '../../state/trace'
import type { ArrowKey, InputEvent, TilePos, World } from '../../state/types'
import type { SceneScript } from '../../data/types'
import { repoPath } from '../../test/repoPath'
import { enemyNames } from '../../state/fight'
import { type Chain, type Hop, type Truths, bare, exitsOf } from './chain'
import { landingMismatches, roleTileOf as tileOf } from './landing'

/**
 * **主线连跑**（xl-03x.18）：从新游戏那一刻起，只喂按键，一拍一拍推会话层，看它能不能沿着
 * 链（`chain.ts`）一路走到结局。
 *
 * ## 它比交接判据（`handoff.test.ts`）多证了什么
 *
 * 交接判据每一跳之前都**把世界摆好**：对话直接置成放完、剧情战的计数直接指到那一场、主角
 * 直接摆到出口格上。摆的那几个字段里如果有上一段留下的残留，摆一下就抹平了 —— 它看不见。
 *
 * 这里一个字段都不摆：对话是一句一句按空格按完的，主角是按方向键一格一格走过去的，剧情战
 * 是会话层真的开出来、按调试键 J（原版留的那个外挂，xl-03x.14）打赢、结算走完回场景的，
 * 结局是把 `$` 那段对话按完、会话真的翻到结局面板。每一跳落地的那一拍拿**同一把尺**
 * （`landing.ts`）量一次。
 *
 * ## ⚠️ 它证不了什么 —— 这两句不许删
 *
 * 1. **它证不了画面。** 推的是状态层与会话层，一个像素都没画。
 * 2. **它不是「有人真的在浏览器里从头玩到尾」。** 没有游戏启动器、没有真键盘、没有 React；
 *    按键是自动驾驶按「这一拍该做什么」现算出来的。真正的端到端归 xl-x0t。
 *
 * 另外几处取舍，都是自动驾驶的，不是被测对象的：
 *
 * - 仗全靠 J 打赢，**打仗本身对不对不在这里**（归战斗真值）；
 * - 只走主线要走的那几步：不去开箱、不去答题、不进店、不开菜单、不存读档；
 * - 逐字打印用回车跳过（Web 加出来的键，`dialogue.ts` 的 `skipPrinting`）—— 终点与等它
 *   慢慢打完是同一个函数，省的只是时间。
 *
 * ## 断在哪
 *
 * 断了就报**断在第几跳**（`Hop.index`，从 1 数）与怎么断的。「卡」（`stuck`）有两种：一跳之内推了
 * `hopBudget` 拍还没落地；或者自动驾驶看出该发生的没发生（对话放完了、推剧情的仗却没开）。
 * 报的还有自动驾驶最后一刻想干什么（`intent`）—— 卡住可能是
 * 被测对象的错，也可能是自动驾驶不会走，**两者要分开看**，报文里带着那句意图就是为了分。
 */

export interface Landing {
  /** 第几跳（`Hop.index`）。 */
  hop: number
  /** 落地在第几拍（从 1 数）。 */
  tick: number
  /** 这一跳之内推了几拍。 */
  ticks: number
  /** 这一跳的出发脚本里主线对话开口了几次。 */
  spoke: number
  mismatches: string[]
}

/**
 * **对话一段都没漏**：出口跳（含走自由场景）要求出发脚本的主线对话放完，而放完只能是一段一段
 * 开口放完的 —— 开口次数 == 段数。交接那把尺看不见这一条：上一段留下的「对话已放完」
 * （`eventOver`）要是带进了新脚本，主角一句不说就走出门，照样落在下一本的入口上。
 *
 * 没有自己对话段的脚本沿用上一本的对话对象，不查。战斗跳不查：推剧情那一场在带 `@` 的那一段
 * 说完就开打、场景当场换走，后面的段本来就不在这本里放（脚本38 那种前两场不推剧情的，`@` 不在
 * 最后一段）。
 */
function dialogueMismatch(truths: Truths, hop: Hop, spoke: number): string[] {
  if (hop.how.kind === 'battle') return []
  const s = truths.get(hop.from)!
  if (s.dialogueCode === null) return []
  const groups = (s.dialogue ?? []).length
  return spoke === groups ? [] : [`${hop.from} 的主线对话 ${groups} 段，走出去之前只开口了 ${spoke} 次`]
}

export type BreakKind =
  /** 被测对象抛了。 */
  | 'threw'
  /** 走不下去了：一跳之内推满预算还没落地，或者自动驾驶看出该发生的没发生（对话放完了、推剧情的仗却没开）。 */
  | 'stuck'
  /** 落地了，但交接那把尺不认。 */
  | 'mismatch'
  /** 跳过了链上的某一本，直接进了后面的。 */
  | 'skipped'
  /** 翻到了主线不该去的面板（打输回标题、提前进结局……）。 */
  | 'panel'
  /** 自动驾驶自己不会处理的局面（比如选择框开了）。**不是被测对象的错**，单独一类。 */
  | 'pilot'

export type Outcome =
  | { kind: 'ended'; ticks: number; landings: Landing[] }
  | { kind: 'broken'; hop: number; how: BreakKind; reason: string; intent: string; ticks: number; landings: Landing[] }

/** 人话，测试失败时直接打出来。 */
export function describeOutcome(o: Outcome): string {
  if (o.kind === 'ended') {
    const most = o.landings.reduce((a, b) => (b.ticks > a.ticks ? b : a))
    return `走到了结局：${o.landings.length} 跳、${o.ticks} 拍；每跳最多 ${most.ticks} 拍（第 ${most.hop} 跳）`
  }
  return `连跑断在第 ${o.hop} 跳（${o.how}）：${o.reason}；自动驾驶此刻在「${o.intent}」；已推 ${o.ticks} 拍`
}

class PilotError extends Error {}

/** 自动驾驶看出来的「被测对象走不下去了」—— 报成 `stuck`，不算自动驾驶的错。 */
class StallError extends Error {}

/** 怪物出场图的尺寸从真的 PNG 里量 —— 与 `game/session.test.ts` 同一条路。 */
function spriteSize(name: string): { width: number; height: number } {
  const png = decodePng(readFileSync(repoPath('image/怪物', name, '1.png')))
  return { width: png.width, height: png.height }
}

/**
 * 新游戏：清掉钱 / 药 / 队伍三个模块单例，建会话、点「起」进起点场景。随机数（计步战斗挑场次、
 * 战斗种子）用定种子的 `JavaRandom`，所以每次跑出来的是同一条路。
 *
 * 场景来源由调用方（测试文件）交进来：这个文件不叫 `*.test.ts`，而 eager 场景注册表只许测试
 * 与 `scripts/` import（`data/sceneLoading.test.ts` 数着这份名单）。
 */
export function newGame(getScene: (name: string) => SceneScript): RunningSession {
  resetParty()
  resetWallet()
  resetDrugPack()
  const rng = new JavaRandom(0)
  const deps = {
    scenes: sceneSourceOf(getScene),
    sprite: spriteSize,
    random: () => rng.nextDouble(),
    saves: createMemorySaveStore(),
  }
  return enterScene(createSession(deps), createWorld(getScene(START_SCENE)))
}

/** 一场仗：哪本脚本、哪一类（`battle0` 随机遭遇 / `battle1` 剧情战）、三个槽里的怪。 */
export interface Fight {
  script: string
  kind: 'battle0' | 'battle1'
  monsters: readonly string[]
}

/** 出厂数据的缺口：缺哪几只（全库现数）、链上哪几场撞到它们。 */
export interface MonsterGap {
  missing: string[]
  fights: Fight[]
}

/** 把一个「取出厂数据、没有就抛」的函数变成「有没有」。两份连跑测试各拿自己那一份 `enemySpec` 来问。 */
export const specExists =
  (spec: (name: string) => unknown) =>
  (name: string): boolean => {
    try {
      spec(name)
      return true
    } catch {
      return false
    }
  }

/**
 * **出厂数据的缺口，现数**（xl-3hn）：全库脚本用到、而 `hasSpec` 说没有的那几只怪（`missing`），
 * 与链上各本里撞到它们的那几场（`fights`）。分母是数据层真值，一个都不手写。
 */
export function monsterGap(
  truths: Truths,
  chain: Chain,
  hasSpec: (name: string) => boolean,
): MonsterGap {
  const all = new Set<string>()
  for (const s of truths.values()) {
    for (const list of [s.battle0, s.battle1, s.battle2]) for (const b of list ?? []) for (const n of enemyNames(b)) all.add(n)
  }
  const missing = [...all].filter((n) => !hasSpec(n)).sort()
  const fights: Fight[] = []
  for (const script of chain.scripts) {
    const s = truths.get(script)!
    for (const kind of ['battle0', 'battle1'] as const) {
      for (const b of s[kind] ?? []) {
        const monsters = enemyNames(b)
        if (monsters.some((n) => missing.includes(n))) fights.push({ script, kind, monsters })
      }
    }
  }
  return { missing, fights }
}

/** 缺口的一行读数，打进测试输出（关票理由与新票的数从这里抄）。 */
export function describeGap(gap: MonsterGap): string {
  const plot = gap.fights.filter((f) => f.kind === 'battle1')
  const random = gap.fights.filter((f) => f.kind === 'battle0')
  const plotScripts = [...new Set(plot.map((f) => f.script))]
  return (
    `缺出厂数据的怪 ${gap.missing.length} 只（${gap.missing.join('、')}）；` +
    `链上撞到的剧情战 ${plot.length} 场、分布在 ${plotScripts.length} 本（${plotScripts.join('、')}）；` +
    `随机遭遇 ${random.length} 行、分布在 ${[...new Set(random.map((f) => f.script))].join('、') || '无'}`
  )
}

/**
 * 一跳之内最多推几拍。定法：替身连跑（`playthrough.standin.test.ts`）实测每跳最多 19662 拍
 * （2026-09-11，第 13 跳），取三倍略多。**这是一次读数定的上界**，读数漂了要重量。
 */
export const HOP_BUDGET = 60_000

export function runMainline(chain: Chain, truths: Truths, start: RunningSession, hopBudget = HOP_BUDGET): Outcome {
  const { hops } = chain
  const pilot = new Pilot(chain, truths)
  const landings: Landing[] = []
  let s = start
  let next = 0
  let tick = 0
  let hopStart = 0
  /** 这一跳的出发脚本里，主线对话开口了几次。 */
  let spoke = 0
  /** 上一拍的对话状态，认「这一拍开口了」用。 */
  let was = { speaking: false, order: 0, scene: '' }
  const broken = (how: BreakKind, reason: string): Outcome => ({
    kind: 'broken',
    hop: hops[next]?.index ?? hops.length + 1,
    how,
    reason,
    intent: pilot.intent,
    ticks: tick,
    landings,
  })

  for (;;) {
    if (tick - hopStart >= hopBudget) {
      const what = next < hops.length ? `推了 ${hopBudget} 拍还没落到 ${hops[next]!.triple[2]}` : `推了 ${hopBudget} 拍还没进结局`
      return broken('stuck', what)
    }
    let input: SessionInput
    try {
      input = pilot.decide(s, hops[next])
    } catch (e) {
      if (e instanceof PilotError) return broken('pilot', e.message)
      if (e instanceof StallError) return broken('stuck', e.message)
      throw e
    }
    try {
      s = advanceSession(s, input, TICK_MS)
    } catch (e) {
      tick++
      return broken('threw', String(e))
    }
    tick++

    if (s.panel === 'end') {
      if (next < hops.length) return broken('panel', `还差 ${hops.length - next} 跳就进了结局`)
      return { kind: 'ended', ticks: tick, landings }
    }
    if (s.panel !== 'scene' && s.panel !== 'battle') {
      return broken('panel', `会话翻到了 ${s.panel} 面板`)
    }

    const w = s.scene.world
    const hop = hops[next]
    // 主线对话开口的那一拍。不能只看 `speaking` 由假转真：一拍之内可以先收一段、再开一段
    // （按完带 `@` 的那段起仗、换进下一本、它当拍自动开口；或者按完一段、第 5 步当拍开下一段），
    // 前后两拍都是真。`startSpeak` 每次都让 `groupOrder` 加一，换场景则新建对话对象 —— 看这两样。
    const rose =
      w.dialogue.speaking && (!was.speaking || w.dialogue.groupOrder !== was.order || w.scene !== was.scene)
    was = { speaking: w.dialogue.speaking, order: w.dialogue.groupOrder, scene: w.scene }
    if (hop !== undefined && w.scene === hop.triple[2]) {
      const mismatches = [...landingMismatches(w, hop), ...dialogueMismatch(truths, hop, spoke)]
      landings.push({ hop: hop.index, tick, ticks: tick - hopStart, spoke, mismatches })
      if (mismatches.length > 0) return broken('mismatch', mismatches.join('；'))
      next++
      hopStart = tick
      // 落地那一拍新脚本就可能已经开口（出口那一拍第 5 步的位置对话）。
      spoke = rose && w.scene === hops[next]?.from ? 1 : 0
      continue
    }
    if (rose && hop !== undefined && w.scene === hop.from) spoke++
    const at = chain.scripts.indexOf(w.scene)
    if (at > next + 1) return broken('skipped', `没落到 ${hop?.triple[2]} 就进了链上更后面的 ${w.scene}`)
  }
}

const NONE: SessionInput = { scene: [], battle: [], menu: [] }
const J: readonly BattleInput[] = [{ e: 'key', key: 'j' }]
const SPACE: readonly InputEvent[] = [{ e: 'press', k: 'space', ctrl: false }]
const ENTER: readonly InputEvent[] = [{ e: 'press', k: 'enter', ctrl: false }]
const DIRS: readonly { k: ArrowKey; dx: number; dy: number }[] = [
  { k: 'up', dx: 0, dy: -1 },
  { k: 'down', dx: 0, dy: 1 },
  { k: 'left', dx: -1, dy: 0 },
  { k: 'right', dx: 1, dy: 0 },
]

const key = (p: TilePos): string => `${p.x},${p.y}`

/**
 * 自动驾驶：每一拍看一眼会话，决定这一拍按什么。**只读会话，不写**。
 *
 * 它要回答的问题只有一个：「为了走完眼前这一跳，此刻该按哪个键」。按顺序：
 *
 * 1. 战斗面板上：按一次 J，然后等结算走完；
 * 2. 旁白在播 / 主角正走着：等；
 * 3. 对话框开着：打印中按回车跳过，一句打完或一屏打满按空格；
 * 4. 还站在这一跳的出发脚本里、主线对话没放完：去触发下一段 —— 触发码是 `-1` 就等它自己
 *    开口，是一串坐标就走过去，是一个 NPC 序号就走到它跟前按空格；
 * 5. 对话放完了（或者已经走进了自由场景）：沿出口走向下一段剧情要踩的那个出口名。这一跳若是
 *    战斗跳，走到这一步就说明推剧情的仗该开没开 —— 报 `stuck`（`StallError`）。
 */
class Pilot {
  intent = '开局'
  private sentJ = false

  constructor(
    private readonly chain: Chain,
    private readonly truths: Truths,
  ) {}

  decide(s: RunningSession, hop: Hop | undefined): SessionInput {
    if (s.panel === 'battle') {
      if (this.sentJ) {
        this.intent = '按过 J，等结算走完'
        return NONE
      }
      this.sentJ = true
      this.intent = '按 J 秒杀'
      return { ...NONE, battle: J }
    }
    this.sentJ = false
    const w = s.scene.world
    const d = w.dialogue
    if (w.narratage.active) return this.wait('等旁白放完')
    if (w.select.isSelect) throw new PilotError(`${w.scene} 里选择框开着 —— 自动驾驶不答题、不进店`)
    if (d.speaking || d.oral) {
      if (d.sentenceOver || d.pageOver) return this.keys('按空格翻下一句', SPACE)
      if (d.printing) return this.keys('按回车跳过逐字打印', ENTER)
      return this.wait('等对话框滑进来')
    }
    if (w.role.walk.running || w.role.run.running) return this.wait('等这一步走完')

    const story = hop?.from ?? this.chain.scripts.at(-1)!
    if (w.scene === story && !d.eventOver) return this.trigger(w)
    if (hop === undefined) return this.wait(`${w.scene} 的对话放完了，等结局`)
    if (hop.how.kind === 'battle') {
      throw new StallError(`${w.scene} 的对话放完了，第 ${hop.index} 跳那场推剧情的仗（${hop.how.boss}）却没开出来`)
    }
    return this.towardExit(w, hop.triple[1])
  }

  /** 触发这本脚本的下一段主线对话（`DialogueEvent` 的三种触发码）。 */
  private trigger(w: World): SessionInput {
    const code = w.script.code
    const entry = code?.[w.dialogue.groupOrder]
    if (entry === undefined) throw new PilotError(`${w.scene} 对话没放完，却没有第 ${w.dialogue.groupOrder} 段的触发码`)
    if (entry.length > 2) {
      const tiles = entry.split(',').map((loc) => {
        const [x, y] = loc.split(' ').map(Number)
        return { x: x!, y: y! }
      })
      return this.walkTo(w, tiles, `走到 ${w.scene} 第 ${w.dialogue.groupOrder} 段对话的触发格 ${entry}`)
    }
    const index = Number.parseInt(entry, 10)
    if (index === -1) return this.wait(`等 ${w.scene} 进场自动开口`)
    const npc = w.npcs[index]
    if (npc === undefined) throw new PilotError(`${w.scene} 第 ${w.dialogue.groupOrder} 段对话挂在第 ${index} 个 NPC 上，场景里没有它`)
    const role = tileOf(w)
    const eligible =
      npc.type === 0
        ? facing(npc.x, npc.y, role.x, role.y)
        : npc.type === 1
          ? !npc.walk.running
          : npc.type === 2
            ? !npc.action.running
            : false
    const what = `找 ${w.scene} 的 ${npc.name}（第 ${index} 个 NPC）说第 ${w.dialogue.groupOrder} 段`
    if (eligible) return this.keys(`${what}：按空格`, SPACE)
    // 静止的站到四个贴身位之一（`facing`）；走动 / 原地动的走近它，`checkNpcStop` 会让它停下。
    const spots = [
      { x: npc.x - 1, y: npc.y + 1 },
      { x: npc.x + 1, y: npc.y + 1 },
      { x: npc.x, y: npc.y },
      { x: npc.x, y: npc.y + 2 },
      { x: npc.x, y: npc.y + 1 },
    ]
    return this.walkTo(w, spots, what)
  }

  /**
   * 走向名为 `exit` 的出口。它不在本场景的出口段里，就沿出口先走进自由场景（广度优先、
   * 最短），再从那里踩它 —— 与链的 `roam` 同一把尺（win32 语义）。
   */
  private towardExit(w: World, exit: string): SessionInput {
    const table = w.exit
    if (table === null) throw new PilotError(`${w.scene} 没有出口段，走不到 ${exit}`)
    const name = table.nextScene.includes(exit) ? exit : this.firstStep(w, exit)
    const i = table.nextScene.indexOf(name)
    return this.walkTo(w, table.exits[i]!, `在 ${w.scene} 走向出口 ${JSON.stringify(name)}（去踩 ${exit}）`, i)
  }

  /** 从当前场景出发，到一个出口段里有 `exit` 的场景，第一步踩哪个出口名。 */
  private firstStep(w: World, exit: string): string {
    const open = (n: string): string | undefined => {
      if (w.currentScript[1] === n) return w.currentScript[2]
      const f = bare(n)
      return this.truths.has(f) ? f : undefined
    }
    const seen = new Set([w.scene])
    const queue: { file: string; first: string }[] = []
    for (const n of w.exit?.nextScene ?? []) {
      const f = open(n)
      if (f !== undefined && !seen.has(f)) {
        seen.add(f)
        queue.push({ file: f, first: n })
      }
    }
    for (let cur = queue.shift(); cur !== undefined; cur = queue.shift()) {
      const exits = exitsOf(this.truths.get(cur.file)!)
      if (exits.includes(exit)) return cur.first
      for (const n of exits) {
        const f = open(n)
        if (f !== undefined && !seen.has(f)) {
          seen.add(f)
          queue.push({ file: f, first: cur.first })
        }
      }
    }
    throw new PilotError(`从 ${w.scene} 只沿出口走，走不到一个带 ${exit} 出口的场景`)
  }

  /**
   * 朝 `targets` 里最近的一格走一步（按下再松开：走完这一段就停，见 `role.ts`）。
   * 别的出口格当墙绕开，免得半路被带进别的场景；`useExit` 是这一次要踩的那一组。
   */
  private walkTo(w: World, targets: readonly TilePos[], what: string, useExit?: number): SessionInput {
    const avoid = new Set<string>()
    w.exit?.exits.forEach((group, i) => {
      if (i !== useExit) for (const t of group) avoid.add(key(t))
    })
    const goal = new Set(targets.map(key))
    const from = tileOf(w)
    if (goal.has(key(from))) return this.wait(`${what}：已经站在目标格上，等它起作用`)
    const dir =
      firstMove(w, from, goal, avoid, true) ?? firstMove(w, from, goal, avoid, false)
    if (dir === null) return this.wait(`${what}：找不到路`)
    this.intent = what
    return {
      ...NONE,
      scene: [
        { e: 'press', k: dir, ctrl: false },
        { e: 'release', k: dir },
      ],
    }
  }

  private wait(intent: string): SessionInput {
    this.intent = intent
    return NONE
  }

  private keys(intent: string, scene: readonly InputEvent[]): SessionInput {
    this.intent = intent
    return { ...NONE, scene }
  }
}

/** 广度优先求到 `goal` 的最短路的第一步。`npcsBlock` 为假时把 NPC 当空气（它们会走开）。 */
function firstMove(
  w: World,
  from: TilePos,
  goal: ReadonlySet<string>,
  avoid: ReadonlySet<string>,
  npcsBlock: boolean,
): ArrowKey | null {
  const npcs = npcsBlock ? w.npcs : []
  const seen = new Set([key(from)])
  const queue: { p: TilePos; first: ArrowKey }[] = []
  const expand = (p: TilePos, first: ArrowKey | null): ArrowKey | null => {
    for (const d of DIRS) {
      const q = { x: p.x + d.dx, y: p.y + d.dy }
      const k = key(q)
      if (seen.has(k) || !isAllow(w.collision, npcs, q.x, q.y)) continue
      const f = first ?? d.k
      if (goal.has(k)) return f
      seen.add(k)
      if (!avoid.has(k)) queue.push({ p: q, first: f })
    }
    return null
  }
  const hit = expand(from, null)
  if (hit !== null) return hit
  for (let cur = queue.shift(); cur !== undefined; cur = queue.shift()) {
    const f = expand(cur.p, cur.first)
    if (f !== null) return f
  }
  return null
}
