import { beforeEach, describe, expect, it } from 'vitest'
import type { SfxPlayer } from '../audio/sfxPlayer'
import { getScene } from '../data/scenesEager'
import { resetDrugPack } from '../fakes/drugPack'
import { resetParty } from '../fakes/party'
import { resetWallet } from '../fakes/wallet'
import { MENU_TICK_MS, createMenuTicker } from '../menu/loop'
import { readMenuTrace, replayMenu } from '../menu/trace'
import { createMemorySaveStore } from '../save/memoryStore'
import { readShopTrace, replayShop, shopInputsOf } from '../shop/trace'
import { createWorld } from '../state/step'
import { TRACE_NAMES, readTrace, sceneSourceOf, traceNamesOf } from '../state/trace'
import { resetAudioSettings } from './audioSettings'
import { NO_INPUT, advanceSession, createSession, enterScene, playSfx } from './session'
import type { RunningSession, SessionDeps, SessionInput } from './session'

/**
 * 音效接线的判据（xl-03x.7）：**每条剧本真值声明的「这一步该响什么」 ==
 * 接线层实际交给播放器的调用序列**，逐剧本、逐步对。
 *
 * 被测的是两段：会话层把每一步推出来的音效收成 `Session.sfx`（`advanceSession`），
 * 与 pump 把它交给播放器的那一下（`playSfx`，`useGame.ts` 调的就是它）。播放器
 * 是个只记账的假对象 —— 这里要的是「交出去的是什么」，不是「放没放出来」。
 *
 * ⚠️ **它证的是「该响的时候调了播放器、参数对」，证不了玩家真的听到了。**
 * 浏览器的自动播放策略、解码失败、音量为零、`HTMLAudioElement` 换 `src` 之后
 * 到底停没停旧的那段，这里一样都看不见（后者见 `audio/sfxPlayer.ts`，未在真
 * 浏览器验证）。明确不做的：浏览器里真出声的采样；人戴耳机听一遍签字。
 *
 * ## 真值是瞬时量，所以回放要有「空转」与「并拍」两种喂法
 *
 * 菜单与商店真值的 `music` 是**这一步请求了哪几声、每步清空**（读数：menu-func
 * t16 按下 `func:set` → `['换list.wav']`、t17 松开 → `[]`；shop-trade t3 松开 →
 * `['click.wav']`、t4 → `[]`）。只按「一步一拍」回放的话，接线写成「推完之后读
 * 世界上的当前值」**恰好也对**：每一拍只推一步，当前值就是这一步的。所以两种
 * 真实会发生、而「一步一拍」看不见的情形都要喂：
 *
 * - **拍间空转**：真实的 pump 每 10 ms 一拍，两次点击之间是一大串**没有输入**
 *   的拍。商店那边没输入就不推（`stepShop` 不跑、`music` 不清），菜单那边不到
 *   100 ms 不补脉冲 —— 读当前值的写法会在每一个空拍上把上一声再交一遍；
 * - **两步并一拍**：按下与松开落进同一次 pump（快速点击就是这样）。菜单每个
 *   事件各推一步、每步开头清 `music`，读当前值的写法只剩最后一步的，按下那一声
 *   被松开那一步抹掉。
 *
 * ## 分母是现扫的，登记是手签的
 *
 * - **分母**：磁盘上 `tools/traces/out/` 里**有非空音效真值**的剧本，现扫。
 * - **登记**：`WIRED` —— 哪几支驱动器的真值有人能经由会话层回放。手写，因为
 *   它是「谁已经接上了」，改成从磁盘推就成了被守的东西给自己签字（dispatch.md
 *   纪律 3 的那条 ⚠️）。
 *
 * 两者对撞：分母里任何一份的驱动器不在登记里 → 红，点名它归哪张票（篡改读数：
 * 把 `menu` 从登记里删掉，「每一份都已接线」与「集合 == 分母」两条红）。战斗与
 * 场景两支今天**没有音效真值**，所以不在分母里 —— 它们归 xl-b36。
 *
 * ⚠️ 分母只认**每一步顶层的 `music` 列**（`MusicTap` 的现成写法，menu / shop /
 * saveload / end 四支都是它）。xl-b36 要是把音效导到别处（比如 `audio` 底下），
 * 这里扫不到、会安静地保持绿 —— 那张票的票面写着要照 `MusicTap` 导。
 */

const DEPS: SessionDeps = {
  scenes: sceneSourceOf(getScene),
  sprite: () => ({ width: 1, height: 1 }),
  random: () => 0.5,
  saves: createMemorySaveStore(),
}

/** 真值一步喂给会话的东西。 */
interface Step {
  readonly input: SessionInput
  readonly elapsed: number
}

interface Replay {
  readonly start: RunningSession
  readonly steps: readonly Step[]
  /** 真值逐步的 `music` 列 —— 期望值，一个都不是手写的。 */
  readonly truth: readonly (readonly string[])[]
}

/**
 * 背后那个场景只是为了让会话「已开局」。菜单与商店真值都从面板建好之后开始
 * （`MenuDriver` / `ShopDriver`），进面板之前的事不在真值里，所以这里直接把
 * 面板世界换成照剧本回显建的那一份，**不走 `openMenu` / `enterShop`** —— 那两条
 * 会用会话自己的队伍、钱包把回显盖掉。
 */
function running(): RunningSession {
  return enterScene(createSession(DEPS), createWorld(getScene('宿舍')))
}

function musicColumn(name: string, ticks: readonly Record<string, unknown>[]): string[][] {
  return ticks.map((tick, t) => {
    const music = tick['music']
    if (!Array.isArray(music)) throw new Error(`${name}@${t} 没有 music 列`)
    return music as string[]
  })
}

/**
 * **登记：哪几支驱动器接上了 —— 手签。** 每一支说明怎么把一份真值经由
 * `advanceSession` 回放。
 */
const WIRED: Readonly<Record<string, (name: string) => Replay>> = {
  menu: (name) => {
    const trace = readMenuTrace(name)
    return {
      start: { ...running(), panel: 'menu', menu: createMenuTicker(replayMenu(trace)) },
      // 真值把时钟脉冲与鼠标事件摆在同一列；会话那边脉冲是按流逝的时间补的
      // （`advanceMenu`），所以一个 `tick` 换成 100 ms。
      steps: trace.ticks.map((tick) => ({
        input: { ...NO_INPUT, menu: tick.input.filter((e) => e.e !== 'tick') },
        elapsed: tick.input.filter((e) => e.e === 'tick').length * MENU_TICK_MS,
      })),
      truth: musicColumn(name, trace.ticks),
    }
  },
  shop: (name) => {
    const trace = readShopTrace(name)
    return {
      start: { ...running(), panel: 'shop', shop: replayShop(trace) },
      steps: shopInputsOf(trace).map((shop) => ({ input: { ...NO_INPUT, shop }, elapsed: 0 })),
      truth: musicColumn(name, trace.ticks as unknown as Record<string, unknown>[]),
    }
  },
}

/** 分母：磁盘上有非空音效真值的剧本，现扫。 */
const SOUNDING: readonly string[] = TRACE_NAMES.filter((name) =>
  readTrace(name).ticks.some((tick) => {
    const music = (tick as unknown as Record<string, unknown>)['music']
    return Array.isArray(music) && music.length > 0
  }),
)

/** 只记账的播放器：每一次 `play` 交进来的名单，按先后。 */
function recorder(): { player: Pick<SfxPlayer, 'play'>; take: () => string[] } {
  let calls: string[] = []
  return {
    player: {
      play(names) {
        calls.push(...names)
      },
    },
    take() {
      const got = calls
      calls = []
      return got
    },
  }
}

/** 一拍：推一次会话，把这一次推出来的交给播放器。与 `useGame` 的 pump 同一个次序。 */
function pump(s: RunningSession, step: Step, player: Pick<SfxPlayer, 'play'>): RunningSession {
  const next = advanceSession(s, step.input, step.elapsed)
  playSfx(player, next)
  return next
}

const IDLE: Step = { input: NO_INPUT, elapsed: 0 }
/**
 * 每一步之后空转几拍。篡改读数：把接线改成「推完读世界上的 `music`」，空转 3 拍时
 * 「一步一拍」那 9 条全红；同一篡改下把这里改成 0，那 9 条全绿 —— 逮住它的就是空转。
 */
const IDLE_PUMPS = 3

/**
 * 喂法一：一步一拍，每步之后空转几拍。返回每一步（连同它后面那几个空拍）交给
 * 播放器的名单。
 */
function stepThenIdle(replay: Replay): string[][] {
  const { player, take } = recorder()
  let s = replay.start
  return replay.steps.map((step) => {
    s = pump(s, step, player)
    for (let i = 0; i < IDLE_PUMPS; i++) s = pump(s, IDLE, player)
    return take()
  })
}

/**
 * 喂法二：相邻两个**纯事件**步（都不带脉冲）并进同一拍。返回 `[步号们, 交出去的]`。
 * 期望是那几步真值的依次相接 —— 一拍里推了几步，就该交几步的。
 */
function pairedPumps(replay: Replay): { steps: number[]; got: string[] }[] {
  const { player, take } = recorder()
  let s = replay.start
  const out: { steps: number[]; got: string[] }[] = []
  for (let i = 0; i < replay.steps.length; ) {
    const a = replay.steps[i]!
    const b = replay.steps[i + 1]
    if (b && a.elapsed === 0 && b.elapsed === 0) {
      s = pump(s, { input: mergeInputs(a.input, b.input), elapsed: 0 }, player)
      out.push({ steps: [i, i + 1], got: take() })
      i += 2
    } else {
      s = pump(s, a, player)
      out.push({ steps: [i], got: take() })
      i += 1
    }
  }
  return out
}

function mergeInputs(a: SessionInput, b: SessionInput): SessionInput {
  return {
    scene: [...a.scene, ...b.scene],
    battle: [...a.battle, ...b.battle],
    menu: [...a.menu, ...b.menu],
    shop: [...(a.shop ?? []), ...(b.shop ?? [])],
    saveload: [...(a.saveload ?? []), ...(b.saveload ?? [])],
  }
}

/** 会话层动了几个进程级的替身（队伍、钱包、药、开关）；每份真值从出厂状态起。 */
beforeEach(() => {
  resetParty()
  resetWallet()
  resetDrugPack()
  resetAudioSettings()
})

describe('音效接线 —— 分母与登记对撞', () => {
  it('分母不空：磁盘上至少有一份有非空音效真值的剧本', () => {
    expect(SOUNDING.length).toBeGreaterThan(0)
  })

  it('分母里每一份的驱动器都已接线 —— 没接的点名归哪张票', () => {
    const unwired = SOUNDING.map((name) => ({ name, driver: readTrace(name).driver })).filter(
      ({ driver }) => !(driver in WIRED),
    )
    expect(
      unwired,
      '这几份真值声明了音效，而它们的驱动器没人经由会话层回放（战斗 / 场景归 xl-b36）',
    ).toEqual([])
  })

  it('回放出过声音的剧本集合 == 分母（多一份少一份都红）', () => {
    const heard = Object.keys(WIRED)
      .flatMap((driver) => traceNamesOf(driver))
      .filter((name) => {
        const driver = readTrace(name).driver
        return stepThenIdle(WIRED[driver]!(name)).some((got) => got.length > 0)
      })
      .sort()
    expect(heard).toEqual([...SOUNDING].sort())
  })
})

for (const driver of Object.keys(WIRED)) {
  describe(`音效接线 · ${driver}`, () => {
    for (const name of traceNamesOf(driver)) {
      it(`${name}：一步一拍、拍间空转 —— 每一步交给播放器的 == 真值那一步`, () => {
        const replay = WIRED[driver]!(name)
        const got = stepThenIdle(replay)
        replay.truth.forEach((want, t) => {
          expect(got[t], `${name}@${t}`).toEqual(want)
        })
      })

      it(`${name}：两步并一拍 —— 交出去的 == 那几步真值依次相接`, () => {
        const replay = WIRED[driver]!(name)
        const pumps = pairedPumps(replay)
        // 真的并过：一次都没并的话这条就退化成上面那条。
        expect(pumps.some((p) => p.steps.length === 2), `${name} 一对相邻的纯事件步都没有`).toBe(true)
        for (const { steps, got } of pumps) {
          expect(got, `${name}@${steps.join('+')}`).toEqual(steps.flatMap((t) => replay.truth[t]!))
        }
      })
    }
  })
}
