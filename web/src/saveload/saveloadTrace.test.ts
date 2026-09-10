import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { CARD_OF } from './snapshot'
import { SAVELOAD_TRACE_NAMES, readSaveLoadTrace, replaySaveLoad } from './test/replayTrace'
import type { ReplayedRow, SaveLoadTrace } from './test/replayTrace'

/**
 * 存读档面板对齐行为真值（xl-i06.9）。
 *
 * ## 登记按（字段组 × 剧本）的格子
 *
 * 与场景 / 菜单 / 商店三份同形：真值一行里除 {@link NON_STATE_COLUMNS} 之外的每一列
 * 是一个字段组，每个（组 × 剧本）格子要么登记在 {@link ALIGNED}（逐步 `toEqual`
 * 必须过），要么登记在 {@link PENDING}（逐步 `toEqual` 必须**不**过，且写明归哪张票）。
 * 两个方向都有用例，任何一格两边都没登记、或者登记错了边，都红。
 *
 * ⚠️ 两张表都是**手签的登记**，不是现扫的分母：改成「对上了的自动算 ALIGNED」
 * 等于让被守的东西自己给自己签字（`docs/agents/dispatch.md` 纪律 3）。分母 ——
 * 有几条剧本、有几组列 —— 才从磁盘现数。
 */

/** 真值一行里不属于状态的列：步号、剧本指令号、这一步的输入。 */
const NON_STATE_COLUMNS = ['t', 'ip', 'input'] as const

/** **已经对齐的格子 —— 手写登记。** */
const ALIGNED: Readonly<Record<string, readonly string[]>> = {
  music: ['saveload-menu', 'saveload-start'],
  current: ['saveload-menu', 'saveload-start'],
  mode: ['saveload-menu', 'saveload-start'],
  lastPanel: ['saveload-menu', 'saveload-start'],
  slots: ['saveload-menu', 'saveload-start'],
  intercept: ['saveload-menu', 'saveload-start'],
}

/** **还欠着的格子 —— 手写登记，每一格写明归哪张票。** 今天一格都不欠。 */
const PENDING: Readonly<Record<string, Readonly<Record<string, string>>>> = {}

const TRACES = new Map<string, SaveLoadTrace>(SAVELOAD_TRACE_NAMES.map((n) => [n, readSaveLoadTrace(n)]))
const REPLAYED = new Map<string, ReplayedRow[]>(
  SAVELOAD_TRACE_NAMES.map((n) => [n, replaySaveLoad(TRACES.get(n)!).rows]),
)

/** 真值里的字段组，现扫：每一步的键的并集，去掉非状态列。 */
function groupsOnDisk(): string[] {
  const keys = new Set<string>()
  for (const t of TRACES.values()) for (const tick of t.ticks) for (const k of Object.keys(tick)) keys.add(k)
  for (const k of NON_STATE_COLUMNS) keys.delete(k)
  return [...keys].sort()
}

function column(rows: readonly Record<string, unknown>[], group: string): unknown[] {
  return rows.map((r) => r[group])
}

function cellMatches(group: string, name: string): boolean {
  const truth = column(TRACES.get(name)!.ticks, group)
  const ours = column(REPLAYED.get(name)!, group)
  try {
    expect(ours).toEqual(truth)
    return true
  } catch {
    return false
  }
}

describe('存读档面板状态层对齐行为真值', () => {
  it('saveload 真值不止零份（分母现扫）', () => {
    expect(SAVELOAD_TRACE_NAMES.length).toBeGreaterThan(0)
  })

  it('每一个（字段组 × 剧本）的格子要么已对齐、要么记着归谁 —— 没有第三种', () => {
    const groups = groupsOnDisk()
    const unregistered: string[] = []
    const both: string[] = []
    for (const group of groups) {
      for (const name of SAVELOAD_TRACE_NAMES) {
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
      for (const n of names) expect(SAVELOAD_TRACE_NAMES, `ALIGNED[${group}] 里的 ${n} 不在真值目录里`).toContain(n)
    }
    for (const [group, byTrace] of Object.entries(PENDING)) {
      expect(groups, `PENDING 里的 ${group} 不是真值的字段组`).toContain(group)
      for (const [n, issue] of Object.entries(byTrace)) {
        expect(SAVELOAD_TRACE_NAMES).toContain(n)
        expect(issue, `PENDING[${group}][${n}] 没写票号`).toMatch(/^xl-[\w.]+$/)
      }
    }
  })

  it('每一条剧本都至少签下了一格 —— 否则那条剧本整条一个断言都不跑，还全绿', () => {
    for (const name of SAVELOAD_TRACE_NAMES) {
      const signed = Object.values(ALIGNED).some((names) => names.includes(name))
      expect(signed, `${name} 一格都没签`).toBe(true)
    }
  })

  for (const [group, names] of Object.entries(ALIGNED)) {
    for (const name of names) {
      it(`${name} · ${group}：逐步与真值相等`, () => {
        const truth = TRACES.get(name)!.ticks
        const ours = REPLAYED.get(name)!
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

describe('几条路径各自在真值里取到了读数（读数来自真值，回放逐步对上它）', () => {
  /** 某份真值里第一处满足条件的步。找不到是抛 —— 找不到不许当成通过。 */
  function find(pred: (tick: SaveLoadTrace['ticks'][number], prev: SaveLoadTrace['ticks'][number] | undefined, mode: string) => boolean) {
    for (const [name, trace] of TRACES) {
      const i = trace.ticks.findIndex((t, k) => pred(t, trace.ticks[k - 1], String(t.mode)))
      if (i >= 0) return { name, i, tick: trace.ticks[i]!, prev: trace.ticks[i - 1] }
    }
    throw new Error('没有一份真值走到这条路')
  }

  it('存完摘要当场重算：存档那一下松手，那个槽的摘要变了，且回放出来的逐字相同', () => {
    const hit = find((t, prev, mode) => mode === 'save' && t.input[0]?.e === 'release' && JSON.stringify(t.slots) !== JSON.stringify(prev?.slots))
    const ours = REPLAYED.get(hit.name)![hit.i]!
    expect(ours.slots).toEqual(hit.tick.slots)
    // 「前后摘要不同」是上面 find 的挑选条件，不另断言（那会按构造成立）。
  })

  it('点空槽读档什么都不发生：当前面板仍是 ls、intercept 两项都空、摘要不变', () => {
    const hit = find((t, prev, mode) => {
      const target = (t.input[0] as { target?: string } | undefined)?.target
      if (mode !== 'load' || t.input[0]?.e !== 'release' || !target) return false
      const n = Number(target.split(':')[1])
      const slot = (prev?.slots as { map: string }[] | undefined)?.[n]
      return slot?.map === '无'
    })
    expect(hit.tick.current).toBe('ls')
    expect(hit.tick.intercept).toEqual({ card: null, sceneLoopStart: false })
    expect(hit.tick.slots).toEqual(hit.prev!.slots)
    expect(REPLAYED.get(hit.name)![hit.i]).toMatchObject({ current: 'ls', intercept: { card: null, sceneLoopStart: false } })
  })

  it('点非空槽读档：拦截到的目标是 scenePanel、那条多余的场景循环起了', () => {
    const hit = find((t) => (t.intercept as { card: string | null }).card === 'scenePanel')
    expect(hit.tick.intercept).toEqual({ card: 'scenePanel', sceneLoopStart: true })
    expect(REPLAYED.get(hit.name)![hit.i]!.intercept).toEqual(hit.tick.intercept)
  })

  it('退出键回到进来时那个面板', () => {
    const hit = find((t) => t.input[0]?.e === 'key')
    const ours = REPLAYED.get(hit.name)![hit.i]!
    // 回放自己的 current 等于回放自己的 lastPanel，且都等于真值那一步的。
    expect(ours.current).toBe(ours.lastPanel)
    expect(ours.current).toBe(hit.tick.current)
  })

  it('两种进面板（存 / 读）都有', () => {
    for (const mode of ['save', 'load']) {
      const hit = find((t) => t.input[0]?.e === 'enter' && (t.input[0] as { mode: string }).mode === mode)
      expect(REPLAYED.get(hit.name)![hit.i]).toMatchObject({ current: 'ls', mode })
    }
  })
})

describe('回放件里两处不从真值取、而从原版源码现读的约定', () => {
  it('CARD_OF 与 GameLauncher.switchTo 的每个 case 一一对应', () => {
    const src = javaSource('src/main/GameLauncher.java')
    const body = src.slice(src.indexOf('public static void switchTo'))
    const cases = [...body.matchAll(/case\s+"(\w+)":\s*[^]*?switcher\.show\(\s*c\s*,\s*"(\w+)"\s*\)/g)].map((m) => [m[1], m[2]])
    for (const [target, card] of Object.entries(CARD_OF)) {
      expect(cases, `switchTo("${target}")`).toContainEqual([target, card])
    }
  })

  it('存读档面板一声都不出：LoadAndSavePanel.java 里没有任何 MusicReader / readmusic', () => {
    const src = javaSource('src/start/LoadAndSavePanel.java')
    expect(src).toContain('class LoadAndSavePanel')
    expect(src).not.toMatch(/MusicReader|readmusic|readBGM/)
  })
})
