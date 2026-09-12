import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { START_BUTTONS } from './buttons'
import { buttonAt } from './replay'
import { JAVA_BUTTON_NAME } from './snapshot'
import { START_TRACE_NAMES, readStartTrace, replayStart } from './test/replayTrace'
import type { ReplayedStart, StartTrace } from './test/replayTrace'
import { createStartPanelState } from './panelState'

/**
 * 标题页对齐行为真值（xl-whk）。
 *
 * ## 登记按（字段组 × 剧本）的格子
 *
 * 与结局 / 存读档那几份同形：真值一行里除 {@link NON_STATE_COLUMNS} 之外的每一列是一个
 * 字段组，每个（组 × 剧本）格子要么登记在 {@link ALIGNED}（逐步 `toEqual` 必须过），要么
 * 登记在 {@link PENDING}（逐步 `toEqual` 必须**不**过，且写明归哪张票）。两个方向都有用例。
 *
 * ⚠️ 两张表都是**手签的登记**，不是现扫的分母（`docs/agents/dispatch.md` 纪律 3）。
 * 分母 —— 有几条剧本、有几组列 —— 才从磁盘现数。
 */

/** 真值一行里不属于状态的列：步号、剧本指令号、这一步的输入。 */
const NON_STATE_COLUMNS = ['t', 'ip', 'input'] as const

const BOTH = ['start-about', 'start-newgame']

/** **已经对齐的格子 —— 手写登记。** */
const ALIGNED: Readonly<Record<string, readonly string[]>> = {
  music: BOTH,
  current: BOTH,
  card: BOTH,
  onScreen: BOTH,
  buttons: BOTH,
  mouse: BOTH,
  scroll: BOTH,
  backScroll: BOTH,
  loading: BOTH,
  loading2: BOTH,
  cloud: BOTH,
  aboutTimer: BOTH,
  loadTimer: BOTH,
  isUnfolded: BOTH,
  signal: BOTH,
}

/** **还欠着的格子 —— 手写登记，每一格写明归哪张票。** 今天一格都不欠。 */
const PENDING: Readonly<Record<string, Readonly<Record<string, string>>>> = {}

const TRACES = new Map<string, StartTrace>(START_TRACE_NAMES.map((n) => [n, readStartTrace(n)]))
const REPLAYED = new Map<string, ReplayedStart>(START_TRACE_NAMES.map((n) => [n, replayStart(TRACES.get(n)!)]))

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

describe('标题页状态层对齐行为真值', () => {
  it('start 真值不止零份（分母现扫）', () => {
    expect(START_TRACE_NAMES.length).toBeGreaterThan(0)
  })

  it('每一个（字段组 × 剧本）的格子要么已对齐、要么记着归谁 —— 没有第三种', () => {
    const groups = groupsOnDisk()
    const unregistered: string[] = []
    const both: string[] = []
    for (const group of groups) {
      for (const name of START_TRACE_NAMES) {
        const aligned = (ALIGNED[group] ?? []).includes(name)
        const pending = name in (PENDING[group] ?? {})
        if (!aligned && !pending) unregistered.push(`${group} × ${name}`)
        if (aligned && pending) both.push(`${group} × ${name}`)
      }
    }
    expect(unregistered, '这几格两张登记表里都没有').toEqual([])
    expect(both, '同一个格子同时登记在 ALIGNED 与 PENDING 里').toEqual([])
    for (const [group, names] of Object.entries(ALIGNED)) {
      expect(groups, `ALIGNED 里的 ${group} 不是真值的字段组`).toContain(group)
      for (const n of names) expect(START_TRACE_NAMES, `ALIGNED[${group}] 里的 ${n} 不在真值目录里`).toContain(n)
    }
    for (const [group, byTrace] of Object.entries(PENDING)) {
      expect(groups, `PENDING 里的 ${group} 不是真值的字段组`).toContain(group)
      for (const [n, issue] of Object.entries(byTrace)) {
        expect(START_TRACE_NAMES).toContain(n)
        expect(issue, `PENDING[${group}][${n}] 没写票号`).toMatch(/^xl-[\w.]+$/)
      }
    }
  })

  it('每一条剧本都至少签下了一格 —— 否则那条剧本整条一个断言都不跑，还全绿', () => {
    for (const name of START_TRACE_NAMES) {
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
function stepsWhere(pred: (tick: StartTrace['ticks'][number]) => boolean): { name: string; i: number }[] {
  const hits: { name: string; i: number }[] = []
  for (const [name, trace] of TRACES) trace.ticks.forEach((t, i) => pred(t) && hits.push({ name, i }))
  if (hits.length === 0) throw new Error('没有一份真值走到这条路')
  return hits
}

describe('逐帧比对要的那一帧：只有 tick 步画', () => {
  it('输入步之后的那一帧与上一步是同一帧；tick 步之后换成这一拍画的', () => {
    for (const [name, trace] of TRACES) {
      const { views } = REPLAYED.get(name)!
      expect(views[0], `${name} 第 0 步是 tick，得画出一帧`).not.toBeNull()
      let inputs = 0
      trace.ticks.forEach((tick, i) => {
        if (i === 0) return
        if (tick.input[0]!.e === 'tick') expect(views[i], `${name} 第 ${i} 步`).not.toBe(views[i - 1])
        else {
          expect(views[i], `${name} 第 ${i} 步是输入步，位图应停在上一拍`).toBe(views[i - 1])
          inputs++
        }
      })
      expect(inputs, `${name} 一个输入步都没有 —— 这条判据空转`).toBeGreaterThan(0)
    }
  })

  it('「回」的那一颗：点完之后 back.clicked 留着真（原版 setButton 先把它移出列表）', () => {
    // 这是 xl-whk 头一轮对齐时状态层判据当场逮到的差：web 的 releaseStartButton 原先
    // 无条件把 clicked 清零。读数取自真值，回放逐字对上它。
    const hits = stepsWhere((t) => t.input[0]!.e === 'release' && !(t.onScreen as string[]).includes('back')
      && (t.buttons as Record<string, { clicked: boolean }>).back!.clicked)
    for (const { name, i } of hits) {
      const ours = REPLAYED.get(name)!.rows[i]!.buttons as Record<string, { clicked: boolean }>
      expect(ours.back!.clicked, `${name} 第 ${i} 步`).toBe(true)
    }
  })
})

describe('回放件里不从真值取、而从原版源码现读的约定', () => {
  it('JAVA_BUTTON_NAME 与 initialButtons() 的五个字段逐个对应，顺序同 START_BUTTONS', () => {
    const src = javaSource('src/start/StartPanel.java')
    const body = src.slice(src.indexOf('private void initialButtons()'))
    const fields = [...body.matchAll(/(\w+)\s*=\s*new\s+StartButton\(\s*(\d+)\s*,\s*(\d+)/g)].map((m) => [m[1], Number(m[2]), Number(m[3])])
    expect(fields).toHaveLength(START_BUTTONS.length)
    START_BUTTONS.forEach((b, i) => {
      expect(fields[i], b.key).toEqual([JAVA_BUTTON_NAME[b.key], b.x, b.y])
    })
  })

  it('标题页一声都不出：StartPanel.java 里没有任何 MusicReader / readmusic', () => {
    const src = javaSource('src/start/StartPanel.java')
    expect(src).toContain('class StartPanel')
    expect(src).not.toMatch(/MusicReader|readmusic|readBGM/)
  })

  it('buttonAt 按 DOM 盒子判：左、上两条边算命中，右、下两条边不算', () => {
    const s = createStartPanelState()
    // 「起」画在 (200,150)，命中框往左上挪 (15,6)：[185,235) × [144,194)。
    expect(buttonAt(s, 185, 144)).toBe('newGame')
    expect(buttonAt(s, 234, 193)).toBe('newGame')
    expect(buttonAt(s, 235, 169)).toBeNull()
    expect(buttonAt(s, 210, 194)).toBeNull()
    expect(buttonAt(s, 184, 169)).toBeNull()
    // 「回」开机不在屏幕上，它的盒子里谁都不是。
    expect(buttonAt(s, 810, 569)).toBeNull()
  })
})
