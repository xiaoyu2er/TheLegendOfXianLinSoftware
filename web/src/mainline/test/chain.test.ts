import { describe, expect, it } from 'vitest'
import { KNOWN_MISSING } from '../../assets/knownMissing'
import type { SceneScript } from '../../data/types'
import {
  SEGMENT_KINDS,
  anyPlotBattle,
  hasDialogueFight,
  type Platform,
  type Truths,
  describeBreak,
  exitsOf,
  filesWithExit,
  isMissingFile,
  isPlaceholder,
  isTrailingSpace,
  loadTruths,
  placeholders,
  reachable,
  readPlotBosses,
  readStart,
  segmentReport,
  unreachable,
  walkChain,
} from './chain'

/**
 * 主线链与可达闭包的数据层判据（xl-czb.4）。
 *
 * 分母全部现数：几本脚本是 `tools/ground-truth/*.json` 有几份，链多长是走出来的，
 * 闭包多大是算出来的。下面几张 `const` 表是**登记**（纪律 3）：由人签、与现算的结果
 * 对撞，双向都红 —— 有人动了出口表或下一段剧情，现算的那一侧就变了。
 *
 * 两种平台语义见 `chain.ts` 文件头：`posix` 下行尾空格的出口名打不开（实测），
 * `win32` 下打得开（⚠️ 未验证，Win32 文档行为）。
 */

const truths = loadTruths()
const start = readStart()
const bosses = readPlotBosses()
const chainOf = (p: Platform, t: Truths = truths) => walkChain(t, p, start.script, bosses)

/** 一份改过一本脚本的真值副本（篡改用，不碰磁盘）。 */
const tampered = (file: string, patch: Partial<SceneScript>): Truths => {
  const copy = new Map(truths)
  copy.set(file, { ...truths.get(file)!, ...patch })
  return copy
}

// ── 登记（人签） ─────────────────────────────────────────────────────────────

/**
 * `posix` 下主线断在哪。原因是 xl-1dv.11：这本脚本唯一的出口名带行尾空格，
 * 实测原版 `new Reader("仙二教学楼二楼夜.txt ")` 在 macOS 上 `FileNotFoundException`。
 */
const POSIX_BREAK = { from: '脚本32.txt', issue: 'xl-1dv.11' } as const

/**
 * 不是「出口目标就在本脚本出口段里」的那几跳（`win32` 链）。票面写的「每一跳的出口
 * 目标都在本脚本的出口段里」**比数据宽**：战斗跳不看出口段，走自由场景的那几跳
 * 要先出门、在别的场景里才踩得到那个出口名。
 */
const NON_DIRECT_HOPS: Readonly<Record<string, 'battle' | 'roam'>> = {
  '脚本3.txt': 'battle',
  '脚本4.txt': 'roam',
  '脚本5.txt': 'roam',
  '脚本7.txt': 'battle',
  '脚本7+.txt': 'roam',
  '脚本8.txt': 'roam',
  '脚本12.txt': 'battle',
  '脚本13.txt': 'roam',
  '脚本15.txt': 'roam',
  '脚本17.txt': 'roam',
  '脚本18.txt': 'roam',
  '脚本21.txt': 'roam',
  '脚本22.txt': 'battle',
  '脚本24.txt': 'roam',
  '脚本25.txt': 'battle',
  '脚本27.txt': 'roam',
  '脚本29.txt': 'roam',
  '脚本31.txt': 'battle',
  '脚本32.txt': 'roam',
  '脚本35.txt': 'roam',
  '脚本38.txt': 'battle',
  '脚本39.txt': 'battle',
}

/** `win32` 语义下全库够不着的那几本，各自为什么。 */
const UNREACHABLE_WIN32: Readonly<Record<string, string>> = {
  '剧情1.txt': '没有任何出口或下一段剧情指向它（起点是 脚本1）；xl-1dv.12 那个坏出口就在它里面',
  '迷宫1.txt': '只有 剧情1 的出口指向它',
  '大迷宫1.txt': '没有任何出口指向它',
}

/** 占位名出口（xl-1dv.13）各自的裁定。键是「脚本 出口名」，一本里有两个也不会被压成一条。 */
const PLACEHOLDER_VERDICTS: Readonly<Record<string, 'breaks-if-early' | 'never-breaks'>> = {
  '脚本11.txt 中途逃跑': 'breaks-if-early',
  '脚本23.txt 消失': 'breaks-if-early',
  // 自己没有对话编号，沿用 脚本24 那个已经走完的对话对象（xl-1dv.7），「没走完」那一支永远进不去。
  '脚本24+.txt 出现黑衣人': 'never-breaks',
  '脚本31.txt 李洵逃跑': 'breaks-if-early',
  '脚本37.txt 比武第二阶段': 'breaks-if-early',
  '脚本40.txt 最终话': 'breaks-if-early',
}

/** 产品侧已知缺失清单里挂在某张票下的出口名（去掉 `script/` 前缀）。 */
const registeredExits = (issue: string): string[] =>
  KNOWN_MISSING.filter((k) => k.issue === issue).map((k) => k.path.replace(/^script\//, '')).sort()

/**
 * **缺陷交集清单**：主线那几条已登记的原版缺陷，各在不在主线上（`win32` 链）。
 * `chain` = 链上某本就带着它；`closure` = 只在够得着的场景里；`off` = 够不着。
 * 「主线不经过它」这件事哪天改道会失效 —— 现算的一侧会变，这里就红。
 */
const DEFECTS: readonly {
  issue: string
  /** 现算出来带着这个缺陷的那几本（人签，与现算对撞）。 */
  where: readonly string[]
  on: 'chain' | 'closure' | 'off'
  files: (t: Truths) => string[]
}[] = [
  {
    issue: 'xl-1dv.13',
    where: ['脚本11.txt', '脚本23.txt', '脚本24+.txt', '脚本31.txt', '脚本37.txt', '脚本40.txt'],
    on: 'chain',
    files: (t) => filesWithExit(t, (n) => isPlaceholder(t, n)),
  },
  // 票面只列了 仙二205 / 仙二205夜 两本（不在链上、只在闭包里）。脚本32 是同族、票面没列的第三本
  // —— 它唯一的出口就是这个名字，posix 下主线正断在它这里。
  { issue: 'xl-1dv.11', where: ['仙二205.txt', '仙二205夜.txt'], on: 'closure', files: (t) => filesWithExit(t, (n) => isTrailingSpace(t, n)).filter((f) => !f.startsWith('脚本')) },
  { issue: 'xl-1dv.11（票面未列）', where: ['脚本32.txt'], on: 'chain', files: (t) => filesWithExit(t, (n) => isTrailingSpace(t, n)).filter((f) => f.startsWith('脚本')) },
  { issue: 'xl-1dv.12', where: ['剧情1.txt'], on: 'off', files: (t) => filesWithExit(t, (n) => isMissingFile(t, n)) },
  // 机制：`initiation` 只在有对话编号时新建 DialogueEvent。在主线上**起作用**的是那几本
  // 「有下一段剧情、却没有自己对话编号」的剧情脚本 —— 它们推不推得动剧情全看上一本留下的对象。
  // 票面写「20 个场景」，怎么数的没写（全库无对话编号的有 52 本），这里不跟那个数对。
  {
    issue: 'xl-1dv.7',
    where: ['脚本20.txt', '脚本24+.txt'],
    on: 'chain',
    files: (t) => [...t.values()].filter((s) => s.nextScript !== null && s.dialogueCode === null).map((s) => s.script),
  },
]

// ── 判据 ────────────────────────────────────────────────────────────────────

describe('源码现读', () => {
  // 读不出来的时候 readStart / readPlotBosses 自己抛；这里只核读出来的起点在真值里。
  it('起点是真值里的一本脚本', () => {
    expect(truths.has(start.script)).toBe(true)
  })
})

describe('连通性', () => {
  it('win32：从起点顺着下一段剧情走到结局，链不断', () => {
    const chain = chainOf('win32')
    expect(chain.broken && describeBreak(chain.broken)).toBeUndefined()
    // 走到的是结局那本，不是「没有下一段剧情」就停了。
    const last = truths.get(chain.scripts.at(-1)!)!
    expect(SEGMENT_KINDS['结局']!(last, bosses)).toBe(true)
  })

  it(`posix：主线断在 ${POSIX_BREAK.from}，因为它的出口名带行尾空格（${POSIX_BREAK.issue}）`, () => {
    const chain = chainOf('posix')
    expect(chain.broken).toMatchObject({ reason: 'unreachable', from: POSIX_BREAK.from })
    const exits = exitsOf(truths.get(POSIX_BREAK.from)!)
    expect(exits.length).toBeGreaterThan(0)
    expect(exits.every((n) => isTrailingSpace(truths, n))).toBe(true)
    // 断点之前两种语义走的是同一条路。
    expect(chainOf('win32').hops.slice(0, chain.hops.length)).toEqual(chain.hops)
  })

  it('篡改：把某一跳的下一段剧情指到不存在的脚本，报得出断在哪一跳', () => {
    // 挑链中间那一跳：头尾各有别的判据盯着，中间那一跳最能说明「报得出是哪一跳」。
    const { hops } = chainOf('win32')
    const hop = hops[Math.floor(hops.length / 2)]!
    const s = truths.get(hop.from)!
    const broken = chainOf('win32', tampered(hop.from, { nextScript: [s.nextScript![0]!, s.nextScript![1]!, '不存在.txt'] })).broken
    expect(broken).toEqual({ reason: 'missing', index: hop.index, from: hop.from, target: '不存在.txt' })
    expect(describeBreak(broken!)).toContain(`第 ${hop.index} 跳：${hop.from}`)
  })
})

// 不在登记里的那几跳，`hopKind` 判出来的就是 'exit' —— 按定义「出口目标在本脚本的出口段里」。
// 所以这一条对撞就是「每一跳的出口目标都在本脚本出口段里」的判据，别的跳单独再核一遍是恒真。
describe('每一跳的出口目标', () => {
  it('不在本脚本出口段里的那几跳与登记一致（双向）', () => {
    const computed = Object.fromEntries(
      chainOf('win32')
        .hops.filter((h) => h.how.kind !== 'exit')
        .map((h) => [h.from, h.how.kind]),
    )
    expect(computed).toEqual(NON_DIRECT_HOPS)
  })
})

describe('链模型的前提（数据里钉住，别只写在注释里）', () => {
  const chain = chainOf('win32')
  const closure = reachable(truths, chain)
  const roamOnly = [...closure].filter((f) => !chain.scripts.includes(f))

  it('自由场景没有自己的下一段剧情、也没有自己的对话编号 —— 走过它们 nextScript 与对话对象都不会被换掉', () => {
    expect(roamOnly.length).toBeGreaterThan(0)
    for (const f of roamOnly) {
      expect(truths.get(f)!.nextScript, f).toBeNull()
      expect(truths.get(f)!.dialogueCode, f).toBeNull()
    }
  })

  it('闭包里只有链上的战斗跳那几本带推剧情名单上的敌人（三类战斗都查）', () => {
    const withBoss = [...closure].filter((f) => anyPlotBattle(truths.get(f)!, bosses)).sort()
    const battleHops = chain.hops.filter((h) => h.how.kind === 'battle').map((h) => h.from).sort()
    expect(withBoss).toEqual(battleHops)
  })

  it('每一个战斗跳的对话里都有 @ 那一句（否则那场剧情固定战开不起来）', () => {
    for (const h of chain.hops.filter((x) => x.how.kind === 'battle')) {
      expect(hasDialogueFight(truths.get(h.from)!), h.from).toBe(true)
    }
  })
})

describe('可达闭包', () => {
  it('win32：够不着的那几本与登记一致', () => {
    expect(unreachable(truths, reachable(truths, chainOf('win32')))).toEqual(Object.keys(UNREACHABLE_WIN32).sort())
  })

  it('posix：多出来的够不着的，正好是断点之后那段链', () => {
    const win = chainOf('win32')
    const posix = chainOf('posix')
    const extra = unreachable(truths, reachable(truths, posix)).filter((f) => !(f in UNREACHABLE_WIN32))
    expect(extra).toEqual(win.scripts.slice(posix.scripts.length).sort())
  })

  it('篡改：给宿舍加一个通向 迷宫1 的出口，够不着的就少一本', () => {
    const dorm = truths.get('宿舍.txt')!
    const t = tampered('宿舍.txt', { nextScene: [...exitsOf(dorm), '迷宫1.txt'] })
    // 与未篡改的现算结果比，不与登记比：这条验的是闭包算法对出口有反应，登记那条另有人管。
    const before = unreachable(truths, reachable(truths, chainOf('win32')))
    expect(before).toContain('迷宫1.txt')
    const got = unreachable(t, reachable(t, chainOf('win32', t)))
    expect(got).toEqual(before.filter((f) => f !== '迷宫1.txt'))
  })
})

describe('占位名出口：踩的顺序不对才断（xl-1dv.13）', () => {
  const chain = chainOf('win32')
  const found = placeholders(truths, chain, reachable(truths, chain), start.currentScript)

  it('每一个都在链上、且就是本脚本下一段剧情的场景名（ExitEvent 那一支认的正是这个名字）', () => {
    expect(found.length).toBeGreaterThan(0)
    for (const p of found) {
      expect(chain.scripts, p.script).toContain(p.script)
      expect(p.isOwnNext, p.script).toBe(true)
    }
  })

  it('各自的裁定与登记一致', () => {
    expect(found).toHaveLength(Object.keys(PLACEHOLDER_VERDICTS).length)
    expect(Object.fromEntries(found.map((p) => [`${p.script} ${p.name}`, p.verdict]))).toEqual(PLACEHOLDER_VERDICTS)
  })

  it('全库的占位名与产品侧已知缺失清单那几条逐个相同', () => {
    const names = [...truths.values()].flatMap((s) => exitsOf(s).filter((n) => isPlaceholder(truths, n)))
    expect(names.sort()).toEqual(registeredExits('xl-1dv.13'))
  })
})

describe('缺陷交集清单', () => {
  const chain = chainOf('win32')
  const closure = reachable(truths, chain)

  for (const d of DEFECTS) {
    it(`${d.issue} 在 ${d.where.join(' / ')}，登记为 ${d.on}`, () => {
      const files = d.files(truths).sort()
      expect(files, `${d.issue} 现算出来落在哪几本`).toEqual([...d.where].sort())
      const on = files.some((f) => chain.scripts.includes(f)) ? 'chain' : files.some((f) => closure.has(f)) ? 'closure' : 'off'
      expect(on, files.join(',')).toBe(d.on)
    })
  }

  it('行尾空格与坏路径两族与产品侧已知缺失清单逐个相同', () => {
    for (const [issue, pred] of [
      ['xl-1dv.11', isTrailingSpace],
      ['xl-1dv.12', isMissingFile],
    ] as const) {
      const names = new Set([...truths.values()].flatMap((s) => exitsOf(s).filter((n) => pred(truths, n))))
      expect([...names].sort(), issue).toEqual(registeredExits(issue))
    }
  })
})

describe('段落类别的选择器', () => {
  it('每一类在全库里都至少选得中一本（选择器写错会零命中）', () => {
    for (const [kind, has] of Object.entries(SEGMENT_KINDS)) {
      expect([...truths.values()].some((s) => has(s, bosses)), kind).toBe(true)
    }
  })

  it('结局全库只有一本，就在链尾', () => {
    const ends = [...truths.values()].filter((s) => SEGMENT_KINDS['结局']!(s, bosses)).map((s) => s.script)
    expect(ends).toEqual([chainOf('win32').scripts.at(-1)])
  })

  it('段落报表：链上 / 只在闭包里两栏互不相交、都在闭包里、结局那一栏落在链上', () => {
    const chain = chainOf('win32')
    const closure = reachable(truths, chain)
    const report = segmentReport(truths, chain, closure, bosses)
    expect(Object.keys(report)).toEqual(Object.keys(SEGMENT_KINDS))
    for (const [kind, { chain: on, closureOnly }] of Object.entries(report)) {
      for (const f of on) expect(chain.scripts, kind).toContain(f)
      for (const f of closureOnly) {
        expect(closure.has(f), kind).toBe(true)
        expect(chain.scripts, kind).not.toContain(f)
      }
    }
    expect(report['结局']).toEqual({ chain: [chain.scripts.at(-1)], closureOnly: [] })
  })
})
