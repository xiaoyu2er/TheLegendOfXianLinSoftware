import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import { START_BUTTONS } from './buttons'
import { buttonAt, startStartReplay } from './replay'
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

const ALL = ['start-about', 'start-newgame', 'start-about-again', 'start-hover-end']

/** **已经对齐的格子 —— 手写登记。** `start-hover-end` 的 `buttons` 那一格在 {@link EXCEPTED} 里。 */
const ALIGNED: Readonly<Record<string, readonly string[]>> = {
  music: ALL,
  current: ALL,
  card: ALL,
  onScreen: ALL,
  buttons: ['start-about', 'start-newgame', 'start-about-again'],
  mouse: ALL,
  scroll: ALL,
  backScroll: ALL,
  loading: ALL,
  loading2: ALL,
  cloud: ALL,
  aboutTimer: ALL,
  loadTimer: ALL,
  isUnfolded: ALL,
  signal: ALL,
}

/** **还欠着的格子 —— 手写登记，每一格写明归哪张票。** 今天一格都不欠。 */
const PENDING: Readonly<Record<string, Readonly<Record<string, string>>>> = {}

/**
 * **签过字、不还的格子 —— 手写登记，每一格写明 ADR-0001 例外表里的键**（xl-r0x）。
 *
 * 与 {@link PENDING} 不是一回事：那边是欠着、有票要还；这边是例外表里签过字的故意不复刻，
 * 回放照**产品**推（`replay.ts`），所以逐步 `toEqual` 必须不过。整格登出去会丢掉那一格里
 * 别的按钮的逐步对齐，所以每一格另有一条专项判据把差钉死在它该在的地方（见下面「结」那条）。
 */
const EXCEPTED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  buttons: { 'start-hover-end': 'start-exit-disabled' },
}

/** ADR-0001 例外表的键，现读（表格行的第一格 `` `键` ``）。 */
const ADR_KEYS: ReadonlySet<string> = new Set(
  [...readFileSync(repoPath('docs/adr/0001-web-duplicates-original-defects.md'), 'utf8').matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map(
    (m) => m[1]!,
  ),
)

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

  it('每一个（字段组 × 剧本）的格子要么已对齐、要么记着归谁、要么签过例外 —— 恰好一种', () => {
    const groups = groupsOnDisk()
    const unregistered: string[] = []
    const several: string[] = []
    for (const group of groups) {
      for (const name of START_TRACE_NAMES) {
        const aligned = (ALIGNED[group] ?? []).includes(name)
        const pending = name in (PENDING[group] ?? {})
        const excepted = name in (EXCEPTED[group] ?? {})
        const count = Number(aligned) + Number(pending) + Number(excepted)
        if (count === 0) unregistered.push(`${group} × ${name}`)
        if (count > 1) several.push(`${group} × ${name}`)
      }
    }
    expect(unregistered, '这几格三张登记表里都没有').toEqual([])
    expect(several, '同一个格子登记在不止一张表里').toEqual([])
    for (const [group, byTrace] of Object.entries(EXCEPTED)) {
      expect(groups, `EXCEPTED 里的 ${group} 不是真值的字段组`).toContain(group)
      for (const [n, key] of Object.entries(byTrace)) {
        expect(START_TRACE_NAMES, `EXCEPTED[${group}] 里的 ${n} 不在真值目录里`).toContain(n)
        expect(ADR_KEYS.has(key), `EXCEPTED[${group}][${n}] 的 ${key} 不在 ADR-0001 例外表里`).toBe(true)
      }
    }
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

  it('反方向：登记成「还欠着」或「签过例外」的格子必须真的还没对上', () => {
    const wrong: string[] = []
    for (const table of [PENDING, EXCEPTED]) {
      for (const [group, byTrace] of Object.entries(table)) {
        for (const name of Object.keys(byTrace)) if (cellMatches(group, name)) wrong.push(`${group} × ${name}`)
      }
    }
    expect(wrong, '这几格已经逐步对上了，把它从 PENDING / EXCEPTED 挪进 ALIGNED').toEqual([])
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
        if (tick.input[0]!.e === 'tick') {
          // 这一拍画的鼠标帧，拿**真值**这一步的鼠标帧去对（原版 paint 读的是循环体推过之后
          // 的那一帧）。不写 `not.toBe(views[i-1])`：tickStartPanel 每拍都造新对象，那一条
          // 按构造成立（xl-whk 评审）。
          const truthFrame = (tick.mouse as { anim: { frame: number } }).anim.frame
          expect(views[i]!.cursorFrame, `${name} 第 ${i} 步画的鼠标帧`).toBe(truthFrame)
        } else if (i > 0) {
          expect(views[i], `${name} 第 ${i} 步是输入步，位图应停在上一拍`).toBe(views[i - 1])
          inputs++
        }
      })
      expect(inputs, `${name} 一个输入步都没有 —— 这条判据空转`).toBeGreaterThan(0)
    }
  })

  it('「关于我们」这一拍画多宽：照原版 drawScroll 的三支，从真值现算', () => {
    // 逐帧比对那两条是整屏上界（卷轴的有损 WebP），**看不见揭开宽度错一两段**（xl-whk 评审）。
    // 所以宽度在这里从真值算：drawScroll 读的是过场**之前**的 isUnfolded / signal —— 即上一步
    // 那一行 —— 与这一拍更新段推过之后的 aboutTimer（paint 不动它，就是这一行的值）。
    const src = javaSource('src/start/StartPanel.java').replace(/\s+/g, '')
    expect(src).toContain('100*(9-aboutTimer.getTimeLeft())')
    expect(src).toContain('100*(aboutTimer.getTimeLeft())')
    let drawn = 0
    for (const [name, trace] of TRACES) {
      const { views } = REPLAYED.get(name)!
      trace.ticks.forEach((tick, i) => {
        if (i === 0 || tick.input[0]!.e !== 'tick') return
        const prev = trace.ticks[i - 1]!
        const unfolded = prev.isUnfolded as boolean
        const signal = prev.signal as number
        const left = (tick.aboutTimer as { timeLeft: number }).timeLeft
        const want = !unfolded
          ? signal === 2 ? 100 * (9 - left) : null
          : signal === 3 ? 100 * left : signal === 2 ? 1024 : null
        expect(views[i]!.aboutWidth, `${name} 第 ${i} 步`).toBe(want)
        if (want !== null) drawn++
      })
    }
    expect(drawn, '一拍「关于我们」都没画 —— 这条判据空转').toBeGreaterThan(0)
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

  it('「回」留着真的后果：展开着在别的按钮上松手，当场收起 —— 不开卷轴、不开载入（xl-r0x）', () => {
    // 原版 setButton() 展开之后只看 back.isIsclicked()，不看松手的是哪一颗。选步的条件只写**起因**
    // （上一步展开着、按住的不是「回」、而「回」的 clicked 是真），后果全部从真值读出来再断言 ——
    // 一步都没选到是抛，找不到不许当成通过。
    type Btns = Record<string, { clicked: boolean }>
    const pressedOtherThanBack = (t: StartTrace['ticks'][number]) =>
      Object.entries(t.buttons as Btns).filter(([k, b]) => k !== 'back' && b.clicked).map(([k]) => k)
    const hits: { name: string; i: number }[] = []
    for (const [name, trace] of TRACES) {
      trace.ticks.forEach((t, i) => {
        const prev = trace.ticks[i - 1]
        if (t.input[0]!.e !== 'release' || prev === undefined || prev.isUnfolded !== true) return
        if (pressedOtherThanBack(prev).length !== 1 || !(prev.buttons as Btns).back!.clicked) return
        hits.push({ name, i })
      })
    }
    expect(hits.length, '没有一份真值走到「展开着、在别的按钮上松手」').toBeGreaterThan(0)
    const collapse = ['signal', 'onScreen', 'scroll', 'backScroll', 'loading', 'loadTimer', 'aboutTimer'] as const
    for (const { name, i } of hits) {
      const truth = TRACES.get(name)!.ticks[i]!
      // 真值自己说的是「收起」：先把这件事从真值里读出来，免得判据在真值变了之后跟着空转。
      expect(truth.signal, `${name} 第 ${i} 步：真值的 signal`).toBe(3)
      expect((truth.backScroll as { isStop: boolean }).isStop, `${name} 第 ${i} 步：反向卷轴开播`).toBe(false)
      expect((truth.scroll as { isStop: boolean }).isStop, `${name} 第 ${i} 步：卷轴没开`).toBe(true)
      expect((truth.loading as { isStop: boolean }).isStop, `${name} 第 ${i} 步：载入动画没开`).toBe(true)
      const ours = REPLAYED.get(name)!.rows[i]!
      for (const group of collapse) expect(ours[group], `${name} 第 ${i} 步 · ${group}`).toEqual(truth[group])
    }
  })

  it('「结」的悬停：与原版只差在「结」那一颗、只差在原版换了悬停图的那几步（ADR-0001 的 start-exit-disabled）', () => {
    type Btn = { image: string; clicked: boolean; glow: { frame: number; isStop: boolean } }
    type Btns = Record<string, Btn>
    /** 画面上看得见的那几项：画哪张图、高亮第几帧、停没停。 */
    const visible = (b: Btn) => ({ image: b.image, clicked: b.clicked, frame: b.glow.frame, isStop: b.glow.isStop })
    const hits = stepsWhere((t) => (t.buttons as Btns).end!.image === 'hover')
    const names = [...new Set(hits.map((h) => h.name))]
    for (const name of names) {
      expect(EXCEPTED.buttons?.[name], `${name} 悬停了「结」，它的 buttons 那一格该登在 EXCEPTED 里`).toBe('start-exit-disabled')
      const truth = TRACES.get(name)!.ticks
      const ours = REPLAYED.get(name)!.rows
      let differs = 0
      truth.forEach((t, i) => {
        const { end: tEnd, ...tRest } = t.buttons as Btns
        const { end: oEnd, ...oRest } = ours[i]!.buttons as Btns
        expect(oRest, `${name} 第 ${i} 步：除「结」之外的按钮`).toEqual(tRest)
        if (tEnd!.image === 'hover') {
          // 原版换了图、高亮在转；产品那颗禁用的收不到悬停，常态图、高亮停着。
          expect(tEnd!.glow.isStop, `${name} 第 ${i} 步：原版的高亮在转`).toBe(false)
          expect(oEnd!.image, `${name} 第 ${i} 步`).toBe('normal')
          expect(oEnd!.glow.isStop, `${name} 第 ${i} 步`).toBe(true)
          differs++
        } else if (differs === 0) {
          expect(oEnd, `${name} 第 ${i} 步：悬停「结」之前，两边逐字一样`).toEqual(tEnd)
        } else {
          // 移开之后画面上两边一样（常态图、第 0 帧、停着），但原版那圈高亮转过一轮，
          // `next` / `isLoop` 留着残余（实测 start-hover-end 第 12 步起 1 / true 对 0 / false）。
          // 那是同一处例外在看不见的簿记里的尾巴 —— 产品里「结」本来就不会再亮起来去读它。
          expect(visible(oEnd!), `${name} 第 ${i} 步：移开之后画面上的那几项两边一样`).toEqual(visible(tEnd!))
        }
      })
      expect(differs).toBeGreaterThan(0)
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

  it('回放在禁用的「结」上按下当场抛 —— 产品里那颗点不下去，没有对应物（xl-r0x）', () => {
    const replay = startStartReplay('负面用例')
    replay.step({ e: 'tick' })
    // 「结」画在 (200,450)，命中框 [185,235) × [444,494)。
    expect(() => replay.step({ e: 'press', x: 210, y: 469 })).toThrow(/禁用/)
  })
})
