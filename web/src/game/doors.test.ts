import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { decodePng } from '../compare/png'
import { repoPath } from '../test/repoPath'
import { javaSource } from '../test/javaSource'
import { getScene } from '../data/scenesEager'
import { normalizePath } from '../assets/path'
import { DRUGS } from '../battle/drugs'
import { resetParty } from '../fakes/party'
import { createMemorySaveStore } from '../save/memoryStore'
import { addCoins, getCoins, resetWallet } from '../fakes/wallet'
import { addDrug, drugCount, resetDrugPack } from '../fakes/drugPack'
import { BACK_BOX, BUY_BOX } from '../shop/layout'
import { hitCenter } from '../shop/test/hitCenter'
import type { ShopInput } from '../shop/step'
import { COL_BACKGROUND } from '../state/fight'
import {
  NO,
  YES,
  checkSelectEvent,
  createSelect,
  selectKeyPressed,
  toSelectDraft,
} from '../state/select'
import type { BattleInfo } from '../state/fight'
import { step } from '../state/step'
import { SCENE_TRACE_NAMES, readTrace, replayWorld, sceneSourceOf } from '../state/trace'
import type { Trace } from '../state/trace'
import type { World } from '../state/types'
import {
  SHOP_OF_DOOR,
  advanceSession,
  battleWorldOf,
  createSession,
  currentBgm,
  enterScene,
  shopWorldOf,
} from './session'
import type { RunningSession, SessionDeps } from './session'

/**
 * **三扇门**（xl-yg6.11）：选「是」就去那一块、选「否」就留下。
 *
 * ## 验收是「拦截到的目标」，不是真的切过去
 *
 * 导出器里没有任何一支驱动器跟着面板切换走过。场景驱动器把
 * `GameLauncher.switcher` 换成 `PanelTap`，只记下 `CardLayout.show` 收到的
 * **卡片名**；剧本的 `awaitExit` 断言它，所以**真值里那条剧本能导出来，本身就是
 * "原版切到了 `awaitExit.panel` 那一块"的读数**（切错、没切都是导出期硬失败，
 * 见 `SceneDriver.awaitExit`）。
 *
 * 于是这里逐支取一次读数：web 那一侧在哪一拍、发出了去哪的请求，翻成卡片名之后
 * **必须等于**那条剧本 `awaitExit` 里的卡片名。跨面板的端到端不在这里（xl-x0t）。
 *
 * ## 几扇门、各通往哪 —— 一个都不手写
 *
 * - 门的名单：`SelectEvent.keyPressed` 里每一句 `GameLauncher.switchTo("…")`；
 * - 入参 → 卡片名：`GameLauncher.switchTo` 那个 switch 里每个 case 的
 *   `switcher.show(c, "…")`；
 * - 卡片名 → 面板类：`c.add("卡片名", 字段)` 加那个字段的声明类型；
 * - 面板类 → 商店剧本的 `open` 名：`ShopDriver` 里 `isDrugShop()` 的字面量、
 *   `panel()` 那个三目、两个 `new` 以及 `ShopScript.SHOPS`。
 *
 * 读数的分母是磁盘上**带 `awaitExit` 的那几条场景真值**，现数。
 */

// ——— 从源码现读 ———

/** 从 `header` 起第一个 `{` 到与它配对的 `}` 之间的正文。找不到就抛。 */
function bodyOf(source: string, header: string): string {
  const at = source.indexOf(header)
  if (at < 0) throw new Error(`源码里找不到 ${header}`)
  const open = source.indexOf('{', at)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i)
  }
  throw new Error(`${header} 的花括号没配上`)
}

function allMatches(source: string, re: RegExp): RegExpExecArray[] {
  return [...source.matchAll(re)]
}

const SELECT_EVENT = javaSource('src/scene/SelectEvent.java')
const LAUNCHER = javaSource('src/main/GameLauncher.java')
// 导出器那一侧是 UTF-8（`tools/build.sh` 以 UTF-8 编 dev tools）。
const SHOP_DRIVER = readFileSync(repoPath('tools/src/devtools/ShopDriver.java'), 'utf8')
const SHOP_SCRIPT = readFileSync(repoPath('tools/src/devtools/ShopScript.java'), 'utf8')

/** 选择框里那几扇门：`keyPressed` 里 `switchTo` 的入参，按出现先后、去重。 */
const DOORS: readonly string[] = [
  ...new Set(
    allMatches(bodyOf(SELECT_EVENT, 'public void keyPressed'), /GameLauncher\.switchTo\("(\w+)"\)/g).map(
      (m) => m[1]!,
    ),
  ),
]

/** `GameLauncher.switchTo` 的 case → 卡片名。 */
const CARD_OF: ReadonlyMap<string, string> = new Map(
  allMatches(
    bodyOf(LAUNCHER, 'public static void switchTo'),
    /case "(\w+)":[^]*?switcher\.show\(c,\s*"(\w+)"\)/g,
  ).map((m) => [m[1]!, m[2]!]),
)

/** 卡片名 → 挂在那张卡片上的面板**类名**。 */
const CLASS_OF_CARD: ReadonlyMap<string, string> = (() => {
  const fieldType = new Map(
    allMatches(LAUNCHER, /public static (\w+) (\w+)\s*[;=]/g).map((m) => [m[2]!, m[1]!]),
  )
  return new Map(
    allMatches(LAUNCHER, /c\.add\("(\w+)",\s*(\w+)\)/g).map((m) => {
      const type = fieldType.get(m[2]!)
      if (type === undefined) throw new Error(`GameLauncher 里没有字段 ${m[2]} 的声明`)
      return [m[1]!, type]
    }),
  )
})()

/** 面板类名 → 商店剧本里 `open` 的那个名字（也就是商店真值的起点）。 */
const OPEN_OF_CLASS: ReadonlyMap<string, string> = (() => {
  const shops = SHOP_SCRIPT.match(/SHOPS = Arrays\.asList\(([^)]*)\)/)
  const drug = SHOP_DRIVER.match(/isDrugShop\(\) \{ return "(\w+)"\.equals\(active\); \}/)
  const ternary = SHOP_DRIVER.match(/JPanel panel\(\) \{ return isDrugShop\(\) \? (\w+) : (\w+); \}/)
  if (!shops || !drug || !ternary) throw new Error('ShopScript.SHOPS / isDrugShop / panel() 没解析出来')
  const names = allMatches(shops[1]!, /"(\w+)"/g).map((m) => m[1]!)
  const other = names.filter((n) => n !== drug[1])
  if (other.length !== 1) throw new Error(`SHOPS 应当是药店加另一家，实际 ${names.join(' / ')}`)
  const classOf = (field: string) => {
    const m = SHOP_DRIVER.match(new RegExp(`${field} = new (\\w+)\\(\\)`))
    if (!m) throw new Error(`ShopDriver 里没有 ${field} = new …()`)
    return m[1]!
  }
  return new Map([
    [classOf(ternary[1]!), drug[1]!],
    [classOf(ternary[2]!), other[0]!],
  ])
})()

// ——— 真值那一侧 ———

interface ScriptStep {
  readonly op: string
  readonly panel?: string
}

/** 剧本回显里的指令表。`Trace` 的类型没把它写出来（别的测试不用），这里现取。 */
function stepsOf(trace: Trace): readonly ScriptStep[] {
  const steps = (trace.script as unknown as { steps?: ScriptStep[] }).steps
  if (!Array.isArray(steps)) throw new Error(`${trace.script.name} 的剧本回显里没有 steps`)
  return steps
}

/** 带 `awaitExit` 的场景真值 —— 每一条就是一扇门的一次读数。分母，现数。 */
const DOOR_TRACES: readonly string[] = SCENE_TRACE_NAMES.filter((name) =>
  stepsOf(readTrace(name)).some((s) => s.op === 'awaitExit'),
)

/** 一条剧本里原版切到的那张卡片（`awaitExit.panel`）。一条剧本只许一扇门。 */
function cardOfTrace(trace: Trace): string {
  const exits = stepsOf(trace).filter((s) => s.op === 'awaitExit')
  expect(exits, `${trace.script.name} 应当恰好一条 awaitExit`).toHaveLength(1)
  return exits[0]!.panel!
}

const scenes = sceneSourceOf(getScene)

/** 在选择框的是 / 否那一步上按下的回车（问题框里那种不算）。 */
interface Confirm {
  readonly tick: number
  /** 按下之前光标停在哪 —— `YES` / `NO`。 */
  readonly yesNo: number
  /** 这一拍 web 发出的门：`selectPanelRequest` 或 `battle`（`battleRequest`）。 */
  readonly door: string | null
  readonly after: World
}

/** 把一条真值逐 tick 回放（`step()`，与 `traceReplay.test.ts` 同一条路），记下每一次确认。 */
function confirmsOf(trace: Trace): Confirm[] {
  let world = replayWorld(trace, getScene)
  const out: Confirm[] = []
  trace.ticks.forEach((tick, i) => {
    const before = world
    world = step(world, tick.input, trace.script.tickMs, scenes)
    const entered = tick.input.some((e) => e.e === 'press' && e.k === 'enter')
    const s = before.select
    if (!entered || !s.isSelect || !(s.shop || s.equipShop || s.battle)) return
    const door = world.selectPanelRequest ?? (world.battleRequest !== null ? 'battle' : null)
    out.push({ tick: i, yesNo: s.yesNo, door, after: world })
  })
  return out
}

describe('三扇门：几扇、各通往哪 —— 从源码现读（原版 GBK + 导出器 UTF-8）', () => {
  it('门的名单与三张映射表都解析出了东西', () => {
    // 分母不许是空的：空名单会让下面每一条 `for` 零轮、全绿。
    expect(DOORS.length).toBeGreaterThan(0)
    for (const door of DOORS) {
      expect(CARD_OF.get(door), `switchTo 的 case "${door}" 没解析出卡片名`).toBeDefined()
      expect(CLASS_OF_CARD.get(CARD_OF.get(door)!), `卡片 ${CARD_OF.get(door)} 上挂的面板没解析出来`).toBeDefined()
    }
    expect(OPEN_OF_CLASS.size).toBe(2)
  })

  it('每一扇门都有一条真值读数，每一条读数都是一扇门 —— 两边对撞', () => {
    expect(DOOR_TRACES.length).toBeGreaterThan(0)
    const traced = DOOR_TRACES.map((name) => cardOfTrace(readTrace(name))).sort()
    const fromSource = DOORS.map((door) => CARD_OF.get(door)!).sort()
    expect(traced).toEqual(fromSource)
  })

  it('两扇商店门落到哪一家（SHOP_OF_DOOR）== 商店剧本 open 的那个名字', () => {
    const shopDoors = Object.keys(SHOP_OF_DOOR) as (keyof typeof SHOP_OF_DOOR)[]
    // 表里的门都在源码的门名单里，源码里挂着商店面板的门也都在表里。
    const fromSource = DOORS.filter((door) => OPEN_OF_CLASS.has(CLASS_OF_CARD.get(CARD_OF.get(door)!)!))
    expect([...shopDoors].sort()).toEqual([...fromSource].sort())
    for (const door of shopDoors) {
      const open = OPEN_OF_CLASS.get(CLASS_OF_CARD.get(CARD_OF.get(door)!)!)
      expect(SHOP_OF_DOOR[door], `${door} 那扇门`).toBe(open)
    }
  })
})

describe('三扇门：逐支一次读数（状态层）', () => {
  it.each(DOOR_TRACES)('%s：选「否」不发请求、选择框关上；选「是」发的门 == 原版拦截到的卡片', (name) => {
    const trace = readTrace(name)
    const confirms = confirmsOf(trace)
    const no = confirms.filter((c) => c.yesNo === NO)
    const yes = confirms.filter((c) => c.yesNo === YES)
    // 三条剧本都是"先否后是"。一次都没有的话下面的断言就成了恒真。
    expect(no.length, '剧本里没有一次选「否」').toBeGreaterThan(0)
    expect(yes.length, '剧本里没有一次选「是」').toBeGreaterThan(0)

    for (const c of no) {
      expect(c.door, `第 ${c.tick} 拍选「否」却发了门`).toBeNull()
      expect(c.after.select.isSelect, '选「否」之后选择框还开着').toBe(false)
      // 与真值同一拍对一遍（期望值取自真值，不手写）。
      expect(trace.ticks[c.tick]!.select.active).toBe(false)
    }
    // 整条剧本 web 只发了一次门，发在选「是」的那一拍，翻成卡片名就是原版切到的那张。
    const doors = confirms.filter((c) => c.door !== null)
    expect(doors.map((c) => c.tick)).toEqual(yes.map((c) => c.tick))
    expect(doors.map((c) => CARD_OF.get(c.door!))).toEqual([cardOfTrace(trace)])
  })
})

/**
 * **`select.battleNo` 这一场观测不到**（主干评论 3）—— 如实登记，判据回到数据上取。
 *
 * 大地图有两场选择战（`SelectBattlePanel` 两行），而 `battle-door` 只走到了
 * 第 0 场那个 NPC 面前；第 1 场的 NPC 一直在走，没有一条剧本停在它脚下。于是
 * 真值里 `battleNo` 从头到尾是 0，"战斗那扇门按 `battleNo` 挑哪一行 Fight"
 * 这件事，照抄与写死成 0 读出来一模一样。
 *
 * 两条用例各管一半：
 * 1. **读数**：磁盘上每一条场景真值的每一拍 `battleNo` 都是 0 —— 哪天补了走到
 *    第 1 场的真值，这条先红，提醒把判据换成真值读数；
 * 2. **判据**：在状态层把第 1 场的选择框打开（NPC 序号从数据现读）、选「是」，
 *    打的必须是 `battle2` 的**那一行**，而且那一行与第 0 场真的不同（否则
 *    "挑对了"与"写死成 0"又长得一样）。选择框状态机这一半
 *    （`checkSelectEvent` 那句无条件 `count_battle2 = i`）在 `state/select.test.ts`
 *    「打过的那一场不再问」里。
 */
describe('select.battleNo：这一场观测不到，判据回到数据上取', () => {
  it('读数：每一条场景真值的每一拍 battleNo 都是 0', () => {
    const seen = new Set<number>()
    for (const name of SCENE_TRACE_NAMES) {
      for (const tick of readTrace(name).ticks) seen.add(tick.select.battleNo)
    }
    expect([...seen]).toEqual([0])
  })

  it('判据：打开第 1 场、选「是」，打的是 battle2 的第 1 行，与第 0 行不同', () => {
    const scene = getScene('大地图')
    const rows = scene.selectBattlePanel!
    const fights = scene.battle2!
    expect(rows.length, '大地图不再有两场选择战，这条用例得换个场景').toBeGreaterThan(1)
    expect(fights[1], '第 1 场与第 0 场同一行 Fight —— 挑没挑对看不出来').not.toEqual(fights[0])

    const d = toSelectDraft(createSelect(scene, []).select, [])
    expect(checkSelectEvent(d, Number(rows[1]![0]), 0)).toBe(true)
    expect(d.battleNo).toBe(1)
    const got: BattleInfo[] = []
    selectKeyPressed(d, 'enter', 0, {
      fight: (info) => got.push(info),
      switchTo: () => {},
      present: () => {},
      random: () => 0,
    })
    expect(got).toEqual([fights[1]])
  })
})

// ——— 会话那一侧 ———

function spriteSize(name: string): { width: number; height: number } {
  const png = decodePng(readFileSync(repoPath('image/怪物', name, '1.png')))
  return { width: png.width, height: png.height }
}

function deps(): SessionDeps {
  return { scenes, sprite: spriteSize, random: () => 0, saves: createMemorySaveStore() }
}

/** 走过某张卡片那扇门的那条真值。 */
function doorTraceOf(card: string | undefined): string {
  const name = DOOR_TRACES.find((n) => cardOfTrace(readTrace(n)) === card)
  if (name === undefined) throw new Error(`没有一条真值走过卡片 ${card} 那扇门`)
  return name
}

interface DoorRun {
  readonly session: RunningSession
  readonly trace: Trace
  readonly yesTick: number
  readonly panels: string[]
}

/** 用真值的输入推会话，一 tick 一拍，推到 `last` 那一拍为止（含）。 */
function sessionUpTo(trace: Trace, last: number): { session: RunningSession; panels: string[] } {
  let s = enterScene(createSession(deps()), replayWorld(trace, getScene))
  const panels: string[] = []
  for (let i = 0; i <= last; i++) {
    s = advanceSession(s, { scene: trace.ticks[i]!.input, battle: [], menu: [] }, trace.script.tickMs)
    panels.push(s.panel)
  }
  return { session: s, panels }
}

function yesTickOf(trace: Trace): number {
  return confirmsOf(trace).find((c) => c.yesNo === YES)!.tick
}

/** 推到选「是」的那一拍为止（含）。 */
function sessionThroughDoor(name: string): DoorRun {
  const trace = readTrace(name)
  const yesTick = yesTickOf(trace)
  return { ...sessionUpTo(trace, yesTick), trace, yesTick }
}

/** 按下再松开一颗商店按钮 —— 两拍，与商店真值同一个口径。 */
function clickShop(s: RunningSession, box: Parameters<typeof hitCenter>[0]): RunningSession {
  const [x, y] = hitCenter(box)
  const pump = (from: RunningSession, e: ShopInput) =>
    advanceSession(from, { scene: [], battle: [], menu: [], shop: [e] }, 10)
  return pump(pump(s, { e: 'press', x, y }), { e: 'release', x, y })
}

describe('三扇门：会话真的去了那一块、选「否」留在场景里', () => {
  beforeEach(() => {
    resetParty()
    resetWallet()
    resetDrugPack()
  })

  it.each(DOOR_TRACES)('%s：「是」之前一直在场景上，「是」那一拍翻到门后那一块', (name) => {
    const { session, trace, panels } = sessionThroughDoor(name)
    expect(panels.slice(0, -1).every((p) => p === 'scene'), '选「是」之前就离开了场景').toBe(true)
    const card = cardOfTrace(trace)
    const cls = CLASS_OF_CARD.get(card)!
    const open = OPEN_OF_CLASS.get(cls)
    if (open !== undefined) {
      // **交接判据**：场景这一侧进的那一家 == 商店剧本 `open` 的名字（商店真值的起点）。
      expect(session.panel).toBe('shop')
      expect(shopWorldOf(session)?.active).toBe(open)
    } else {
      expect(card, `卡片 ${card} 既不是商店也不是战斗`).toBe(CARD_OF.get('battle'))
      expect(session.panel).toBe('battle')
    }
  })

  it('战斗那扇门的交接：场景真值那一拍记下的 BGM == 会话建出来的那场战斗的 BGM', () => {
    const { session, trace, yesTick } = sessionThroughDoor(doorTraceOf(CARD_OF.get('battle')))
    const battle = battleWorldOf(session)
    expect(battle).not.toBeNull()
    // 原版这一拍 `BattlePanel.initial` 放的曲子，真值场景那一列记着 ——
    // 战斗那一侧的起点（`initial()` 按背景图挑的那一首）必须就是它。
    const recorded = trace.ticks[yesTick]!.audio.bgm
    expect(recorded).not.toBe(trace.ticks[yesTick - 1]!.audio.bgm)
    expect(battle!.bgm).toBe(recorded)
    expect(currentBgm(session)).toBe(recorded)
    // 背景就是选择框那一行 Fight 数据的第 0 列（规范化之后）。
    const row = session.scene.world.select.script.battle2![session.scene.world.select.battleNo]!
    expect(battle!.background).toBe(normalizePath(row[COL_BACKGROUND]!))
  })

  /**
   * `selectPanelRequest` 只亮一拍，而浏览器里一次 pump 常常补跑好几拍 —— 不在
   * 它亮的那一拍停批，它就被同一批下一拍的 `null` 盖掉，表现是"选了「是」什么
   * 也没发生"，与"压根没发"在画面上一模一样（主干评论 2，`state/loop.ts`）。
   */
  it.each(Object.keys(SHOP_OF_DOOR).map((door) => CARD_OF.get(door)!))(
    '一次 pump 补跑十拍：%s 那扇门「是」那一下不会被同批的下一拍吞掉',
    (card) => {
      const trace = readTrace(doorTraceOf(card))
      const yesTick = yesTickOf(trace)
      const s = sessionUpTo(trace, yesTick - 1).session
      expect(s.panel).toBe('scene')
      const burst = advanceSession(
        s,
        { scene: trace.ticks[yesTick]!.input, battle: [], menu: [] },
        trace.script.tickMs * 10,
      )
      expect(burst.panel, '选「是」那一拍被同一批的下一拍吞掉了').toBe('shop')
    },
  )

  it('进店之后按「返回游戏」：回到原地、曲子放回来、选择框照原版还开着', () => {
    const { session, trace } = sessionThroughDoor(doorTraceOf(CARD_OF.get('shop')))
    const shop = shopWorldOf(session)!
    const role = { px: session.scene.world.role.px, py: session.scene.world.role.py }

    const back = clickShop(session, BACK_BOX)
    expect(back.panel).toBe('scene')
    expect(shopWorldOf(back)).toBeNull()
    // 原地：场景那条线程一直在跑，从没被换掉。
    expect(back.scene.world.scene).toBe(trace.script.scene)
    expect({ px: back.scene.world.role.px, py: back.scene.world.role.py }).toEqual(role)
    // `switchTo("scene")` 那句 SCENE_SIGNAL=1，下一拍曲子放回场景自己那一首。
    expect(back.scene.world.sceneSignal).toBe(true)
    const next = advanceSession(back, { scene: [], battle: [], menu: [] }, 10)
    expect(currentBgm(next)).toBe(getScene(trace.script.scene.replace(/\.txt$/, '')).sceneMusic)
    // ⚠️ 原版「是」那一支只有一句 switchTo，不清 isSelect / shopSelect：
    // 回来时选择框还开着，再按一下回车又进店 —— **进的是同一份店**（存货不重掷）。
    expect(next.scene.world.select.isSelect).toBe(true)
    expect(next.scene.world.select.shop).toBe(true)
    // 两次进门之间钱变了（打架、答题、开箱都会动它）—— 再进门时店里必须是**此刻**
    // 的数。头一次进门看不出这一条：店是那一刻才建的，建的时候本来就读过钱包。
    //
    // ⚠️ 期望值要在进门**之前**记下来：进门那一拍店里立刻写回一次钱包，所以
    // 事后比 `shop.coins === getCoins()` 是恒真的 —— 进门不现读时，写回会把钱包
    // 拽回店里那个旧数，两边照样相等（篡改实测，那一版这条是绿的）。
    addCoins(777)
    const wallet = getCoins()
    const again = advanceSession(next, { scene: [{ e: 'press', k: 'enter', ctrl: false }], battle: [], menu: [] }, 10)
    expect(again.panel).toBe('shop')
    expect(shopWorldOf(again)).toBe(shop)
    expect(shop.coins).toBe(wallet)
    expect(getCoins(), '进门那一下把钱包里多出来的钱弄丢了').toBe(wallet)
  })

  it('药店里买下的东西：钱从钱包里扣、药进背包 —— 进门时也是从那两处现读的', () => {
    addCoins(90000)
    addDrug(DRUGS[0]!.name, 3)
    // 期望值进门**之前**记下来：进门那一拍店里就写回一次钱包，事后比
    // `shop.coins === getCoins()` 是恒真的（/code-review Standards 轴指出）。
    const wallet = getCoins()
    const { session } = sessionThroughDoor(doorTraceOf(CARD_OF.get('shop')))
    const shop = shopWorldOf(session)!
    // 进门时现读：钱与背包都是此刻那两处 static 的数。
    expect(shop.coins).toBe(wallet)
    expect(getCoins()).toBe(wallet)
    expect(shop.pack.drugs[0]).toBe(3)

    // 摆一单（加减按钮的几何归 `shop/step.test.ts` 管，这里验的是会话那座桥）。
    const row = shop.drug.rows[0]!
    row.stock = 5
    row.purchase = 2
    const coins0 = getCoins()
    const done = clickShop(session, BUY_BOX)
    expect(done.panel).toBe('shop')
    expect(getCoins()).toBe(coins0 - row.price * 2)
    expect(drugCount(DRUGS[0]!.name)).toBe(5)
  })

  it('装备超市里买下的东西进菜单装备页那份全局背包', () => {
    addCoins(900000)
    const { session } = sessionThroughDoor(doorTraceOf(CARD_OF.get('equipmentShop')))
    const shop = shopWorldOf(session)!
    const slot = shop.equipment.category
    const row = shop.equipment.rows[slot][0]!
    row.stock = 5
    row.purchase = 1
    const owned = session.menu.world.panels.equipPanel.equip!.owned
    const before = owned[slot][0]!
    clickShop(session, BUY_BOX)
    expect(owned[slot][0]).toBe(before + 1)
  })
})
