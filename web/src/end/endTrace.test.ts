import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { NO_INPUT, advanceSession, createSession, enterEnd, enterScene, keyReceiver } from '../game/session'
import type { RunningSession } from '../game/session'
import { createMemorySaveStore } from '../save/memoryStore'
import { createWorld } from '../state/step'
import { javaSource } from '../test/javaSource'
import { END_CARD_OF } from './snapshot'
import { END_TRACE_NAMES, readEndTrace, replayEnd } from './test/replayTrace'
import type { EndTrace, ReplayedEnd } from './test/replayTrace'
import { END_TICK_MS } from './world'

/**
 * 结局面板对齐行为真值（xl-czb.6）。
 *
 * ## 登记按（字段组 × 剧本）的格子
 *
 * 与场景 / 菜单 / 商店 / 存读档四份同形：真值一行里除 {@link NON_STATE_COLUMNS} 之外的
 * 每一列是一个字段组，每个（组 × 剧本）格子要么登记在 {@link ALIGNED}（逐步 `toEqual`
 * 必须过），要么登记在 {@link PENDING}（逐步 `toEqual` 必须**不**过，且写明归哪张票）。
 * 两个方向都有用例，任何一格两边都没登记、或者登记错了边，都红。
 *
 * ⚠️ 两张表都是**手签的登记**，不是现扫的分母（`docs/agents/dispatch.md` 纪律 3）。
 * 分母 —— 有几条剧本、有几组列 —— 才从磁盘现数。
 */

/** 真值一行里不属于状态的列：步号、剧本指令号、这一步的输入。 */
const NON_STATE_COLUMNS = ['t', 'ip', 'input'] as const

/** **已经对齐的格子 —— 手写登记。** */
const ALIGNED: Readonly<Record<string, readonly string[]>> = {
  music: ['end-credits'],
  current: ['end-credits'],
  card: ['end-credits'],
  wordY: ['end-credits'],
  blankY: ['end-credits'],
  code: ['end-credits'],
  picture: ['end-credits'],
  isDraw: ['end-credits'],
  isStop: ['end-credits'],
  repainted: ['end-credits'],
  loop: ['end-credits'],
}

/** **还欠着的格子 —— 手写登记，每一格写明归哪张票。** 今天一格都不欠。 */
const PENDING: Readonly<Record<string, Readonly<Record<string, string>>>> = {}

const TRACES = new Map<string, EndTrace>(END_TRACE_NAMES.map((n) => [n, readEndTrace(n)]))
const REPLAYED = new Map<string, ReplayedEnd>(END_TRACE_NAMES.map((n) => [n, replayEnd(TRACES.get(n)!)]))

/** 真值里的字段组，现扫：每一步的键的并集，去掉非状态列。 */
function groupsOnDisk(): string[] {
  const keys = new Set<string>()
  for (const t of TRACES.values()) for (const tick of t.ticks) for (const k of Object.keys(tick)) keys.add(k)
  for (const k of NON_STATE_COLUMNS) keys.delete(k)
  return [...keys].sort()
}

function cellMatches(group: string, name: string): boolean {
  const truth = TRACES.get(name)!.ticks.map((r) => r[group])
  const ours = REPLAYED.get(name)!.rows.map((r) => r[group])
  try {
    expect(ours).toEqual(truth)
    return true
  } catch {
    return false
  }
}

describe('结局面板状态层对齐行为真值', () => {
  it('end 真值不止零份（分母现扫）', () => {
    expect(END_TRACE_NAMES.length).toBeGreaterThan(0)
  })

  it('每一个（字段组 × 剧本）的格子要么已对齐、要么记着归谁 —— 没有第三种', () => {
    const groups = groupsOnDisk()
    const unregistered: string[] = []
    const both: string[] = []
    for (const group of groups) {
      for (const name of END_TRACE_NAMES) {
        const aligned = (ALIGNED[group] ?? []).includes(name)
        const pending = name in (PENDING[group] ?? {})
        if (!aligned && !pending) unregistered.push(`${group} × ${name}`)
        if (aligned && pending) both.push(`${group} × ${name}`)
      }
    }
    expect(unregistered, '这几格两张登记表里都没有').toEqual([])
    expect(both, '同一个格子同时登记在 ALIGNED 与 PENDING 里').toEqual([])
    // 反方向：登记表里不许有磁盘上没有的组名或剧本名，否则表在骗人。
    for (const [group, names] of Object.entries(ALIGNED)) {
      expect(groups, `ALIGNED 里的 ${group} 不是真值的字段组`).toContain(group)
      for (const n of names) expect(END_TRACE_NAMES, `ALIGNED[${group}] 里的 ${n} 不在真值目录里`).toContain(n)
    }
    for (const [group, byTrace] of Object.entries(PENDING)) {
      expect(groups, `PENDING 里的 ${group} 不是真值的字段组`).toContain(group)
      for (const [n, issue] of Object.entries(byTrace)) {
        expect(END_TRACE_NAMES).toContain(n)
        expect(issue, `PENDING[${group}][${n}] 没写票号`).toMatch(/^xl-[\w.]+$/)
      }
    }
  })

  it('每一条剧本都至少签下了一格 —— 否则那条剧本整条一个断言都不跑，还全绿', () => {
    for (const name of END_TRACE_NAMES) {
      expect(Object.values(ALIGNED).some((names) => names.includes(name)), `${name} 一格都没签`).toBe(true)
    }
  })

  for (const [group, names] of Object.entries(ALIGNED)) {
    for (const name of names) {
      it(`${name} · ${group}：逐步与真值相等`, () => {
        const truth = TRACES.get(name)!.ticks
        const ours = REPLAYED.get(name)!.rows
        expect(ours).toHaveLength(truth.length)
        truth.forEach((tick, i) => {
          expect(ours[i]![group], `第 ${i} 步（${JSON.stringify(tick.input)}）`).toEqual(tick[group])
        })
      })
    }
  }

  it('反方向：登记成「还欠着」的格子必须真的还没对上', () => {
    const wrong: string[] = []
    for (const [group, byTrace] of Object.entries(PENDING)) {
      for (const name of Object.keys(byTrace)) if (cellMatches(group, name)) wrong.push(`${group} × ${name}`)
    }
    expect(wrong, '这几格已经逐步对上了，把它从 PENDING 挪进 ALIGNED').toEqual([])
  })
})

/** 某份真值里满足条件的步，全部。一步都没有是抛 —— 找不到不许当成通过。 */
function stepsWhere(pred: (tick: EndTrace['ticks'][number], name: string) => boolean): { name: string; i: number }[] {
  const hits: { name: string; i: number }[] = []
  for (const [name, trace] of TRACES) trace.ticks.forEach((t, i) => pred(t, name) && hits.push({ name, i }))
  if (hits.length === 0) throw new Error('没有一份真值走到这条路')
  return hits
}

/**
 * 「有进无出」那三样（xl-czb.6 票面，按主干裁定改过的那一版）。逐字段的对齐上面已经
 * 签了；这里各立一条**只守那一件事**的判据，失败时报的就是那件事。
 */
describe('「有进无出」三样', () => {
  it('按键照旧交给场景面板：每个 key 步落到谁手里与真值相同；退出键开菜单、结局被切走', () => {
    const keys = stepsWhere((t) => t.input[0]?.e === 'key')
    for (const { name, i } of keys) {
      const truthTo = (TRACES.get(name)!.ticks[i]!.input[0] as { to?: unknown }).to
      expect(REPLAYED.get(name)!.to[i], `${name} 第 ${i} 步`).toBe(truthTo)
    }
    // 退出键那一步：读数取自真值，回放逐字对上它。
    const esc = stepsWhere((t) => t.input[0]?.e === 'key' && (t.input[0] as { key: string }).key === 'escape')
    for (const { name, i } of esc) {
      const tick = TRACES.get(name)!.ticks[i]!
      expect([tick.current, tick.card], '真值：退出键之后当前面板与拦下的卡片').toEqual(['menu', 'menuPanel'])
      const ours = REPLAYED.get(name)!.rows[i]!
      expect([ours.current, ours.card]).toEqual([tick.current, tick.card])
      expect(REPLAYED.get(name)!.replay.session.panel, '会话落在了菜单上').toBe('menu')
    }
  })

  it('结局期间当前面板仍是场景，键落在场景手里（keyReceiver 就是那三个 if）', () => {
    const src = javaSource('src/main/GameLauncher.java').replace(/\s+/g, '')
    const keyPressed = src.slice(src.indexOf('publicvoidkeyPressed(KeyEvente){'), src.indexOf('publicvoidkeyReleased'))
    const forwarded = [...keyPressed.matchAll(/if\(currentPanel==(\w+)Panel\)/g)].map((m) => m[1])
    expect(forwarded.length).toBeGreaterThan(0)
    expect(forwarded.sort()).toEqual(['battle', 'ls', 'scene'])
    // `switchTo("end")` 那一支没有 `currentPanel=`。
    const endCase = src.slice(src.indexOf('case"end":'), src.indexOf('break;', src.indexOf('case"end":')))
    expect(endCase).toContain('switcher.show(c,"endPanel");endPanel.start();')
    expect(endCase).not.toContain('currentPanel')
    expect(keyReceiver('end')).toBe('scene')
    expect(keyReceiver('menu')).toBeNull()
  })

  it('那条线程永不退出：每个 wake 步线程都还活着；isStop 之后会话照样推它', () => {
    const wakes = stepsWhere((t) => t.input[0]?.e === 'wake')
    for (const { name, i } of wakes) {
      const truth = TRACES.get(name)!.ticks[i]!.loop as { alive: boolean }
      expect(truth.alive, '真值：叫醒之后线程还在').toBe(true)
      expect(REPLAYED.get(name)!.rows[i]!.loop).toEqual(TRACES.get(name)!.ticks[i]!.loop)
    }
    // 会话层：推到 isStop 之后再推一秒，线程还是那一条、又走了十圈。
    const session = enterEnd(
      enterScene(
        createSession({ scenes: () => undefined, sprite: () => ({ width: 0, height: 0 }), random: () => 0, saves: createMemorySaveStore([]) }),
        createWorld(getScene('脚本41')),
      ),
    )
    let s: RunningSession = session
    for (let i = 0; i < 400; i++) s = advanceSession(s, NO_INPUT, END_TICK_MS)
    expect(s.end?.world.isStop).toBe(true)
    const loop = s.end!
    const before = loop.iterations
    s = advanceSession(s, NO_INPUT, 10 * END_TICK_MS)
    expect(s.end, '会话把那条线程摘掉了').toBe(loop)
    expect(loop.iterations - before).toBe(10)
  })

  it('画面冻在最后一帧：isStop 之后结局还显示着的每一步，绘制清单与定格那一步逐条相同', () => {
    for (const [name, trace] of TRACES) {
      const stopAt = trace.ticks.findIndex((t) => t.isStop === true)
      expect(stopAt, `${name} 里 isStop 一次都没翻真`).toBeGreaterThan(0)
      const { frames, rows } = REPLAYED.get(name)!
      const frozen = frames[stopAt]!
      expect(frozen.length, '定格那一帧一笔都没画').toBeGreaterThan(0)
      let checked = 0
      for (let i = stopAt + 1; i < trace.ticks.length; i++) {
        expect(frames[i], `${name} 第 ${i} 步`).toEqual(frozen)
        expect(rows[i]!.repainted, `${name} 第 ${i} 步又 repaint 了`).toBe(false)
        checked++
      }
      expect(checked, '定格之后一步都没有 —— 这条判据空转').toBeGreaterThan(0)
    }
  })
})

describe('回放件里不从真值取、而从原版源码现读的约定', () => {
  it('END_CARD_OF 与 GameLauncher.switchTo 的每个 case 一一对应', () => {
    const src = javaSource('src/main/GameLauncher.java')
    const body = src.slice(src.indexOf('public static void switchTo'))
    const cases = [...body.matchAll(/case\s+"(\w+)":\s*[^]*?switcher\.show\(\s*c\s*,\s*"(\w+)"\s*\)/g)].map((m) => [m[1], m[2]])
    expect(cases.length).toBeGreaterThan(0)
    for (const [target, card] of Object.entries(END_CARD_OF)) {
      expect(cases, `switchTo("${target}")`).toContainEqual([target, card])
    }
  })

  it('结局面板一声都不出：EndPanel.java 里没有任何 MusicReader / readmusic', () => {
    const src = javaSource('src/start/EndPanel.java')
    expect(src).toContain('class EndPanel')
    expect(src).not.toMatch(/MusicReader|readmusic|readBGM/)
  })
})
