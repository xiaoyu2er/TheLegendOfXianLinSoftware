import { describe, expect, it } from 'vitest'
import { KNOWN_MISSING } from '../../assets/knownMissing'
import type { SceneScript } from '../../data/types'
import {
  SEGMENT_KINDS,
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

/** 占位名出口（xl-1dv.13）各自的裁定。 */
const PLACEHOLDER_VERDICTS: Readonly<Record<string, 'breaks-if-early' | 'never-breaks'>> = {
  '脚本11.txt': 'breaks-if-early',
  '脚本23.txt': 'breaks-if-early',
  // 自己没有对话编号，沿用 脚本24 那个已经走完的对话对象（xl-1dv.7），「没走完」那一支永远进不去。
  '脚本24+.txt': 'never-breaks',
  '脚本31.txt': 'breaks-if-early',
  '脚本37.txt': 'breaks-if-early',
  '脚本40.txt': 'breaks-if-early',
}

/**
 * **缺陷交集清单**：主线那几条已登记的原版缺陷，各在不在主线上（`win32` 链）。
 * `chain` = 链上某本就带着它；`closure` = 只在够得着的场景里；`off` = 够不着。
 * 「主线不经过它」这件事哪天改道会失效 —— 现算的一侧会变，这里就红。
 */
const DEFECTS: readonly { issue: string; on: 'chain' | 'closure' | 'off'; files: (t: Truths) => string[] }[] = [
  { issue: 'xl-1dv.13', on: 'chain', files: (t) => filesWithExit(t, (n) => isPlaceholder(t, n)) },
  { issue: 'xl-1dv.11', on: 'chain', files: (t) => filesWithExit(t, (n) => isTrailingSpace(t, n)) },
  { issue: 'xl-1dv.12', on: 'off', files: (t) => filesWithExit(t, (n) => isMissingFile(t, n)) },
  // 机制：`initiation` 只在有对话编号时新建 DialogueEvent。票面写「20 个场景」，按这个机制
  // 数出来的是全库所有没有对话编号的脚本，比 20 多 —— 票面的数怎么数的没写，这里不跟它对。
  { issue: 'xl-1dv.7', on: 'chain', files: (t) => [...t.values()].filter((s) => s.dialogueCode === null).map((s) => s.script) },
]

// ── 判据 ────────────────────────────────────────────────────────────────────

describe('源码现读', () => {
  it('起点与推剧情的敌人名单都读得出来', () => {
    expect(truths.has(start.script)).toBe(true)
    expect(start.currentScript).toHaveLength(3)
    expect(bosses.size).toBeGreaterThan(0)
  })
})

describe('连通性', () => {
  it('win32：从起点顺着下一段剧情走到结局，链不断', () => {
    const chain = chainOf('win32')
    expect(chain.broken && describeBreak(chain.broken)).toBeUndefined()
    // 走到的是结局那本，不是「没有下一段剧情」就停了。
    const last = truths.get(chain.scripts.at(-1)!)!
    expect(SEGMENT_KINDS['结局']!(last, bosses)).toBe(true)
    expect(chain.hops.length).toBe(chain.scripts.length - 1)
  })

  it(`posix：主线断在 ${POSIX_BREAK.from}，因为它的出口名带行尾空格（${POSIX_BREAK.issue}）`, () => {
    const chain = chainOf('posix')
    expect(chain.broken?.from).toBe(POSIX_BREAK.from)
    expect(chain.broken?.reason).toBe('unreachable')
    const exits = exitsOf(truths.get(POSIX_BREAK.from)!)
    expect(exits.length).toBeGreaterThan(0)
    expect(exits.every((n) => isTrailingSpace(truths, n))).toBe(true)
    // 断点之前两种语义走的是同一条路。
    expect(chainOf('win32').hops.slice(0, chain.hops.length)).toEqual(chain.hops)
  })

  it('篡改：把某一跳的下一段剧情指到不存在的脚本，报得出断在哪一跳', () => {
    const hop = chainOf('win32').hops[19]!
    const s = truths.get(hop.from)!
    const broken = chainOf('win32', tampered(hop.from, { nextScript: [s.nextScript![0]!, s.nextScript![1]!, '不存在.txt'] })).broken
    expect(broken).toEqual({ reason: 'missing', index: hop.index, from: hop.from, target: '不存在.txt' })
    expect(describeBreak(broken!)).toContain(`第 ${hop.index} 跳：${hop.from}`)
  })
})

describe('每一跳的出口目标', () => {
  it('不在本脚本出口段里的那几跳与登记一致（双向）', () => {
    const computed = Object.fromEntries(
      chainOf('win32')
        .hops.filter((h) => h.how.kind !== 'exit')
        .map((h) => [h.from, h.how.kind]),
    )
    expect(computed).toEqual(NON_DIRECT_HOPS)
  })

  it('其余每一跳：出口目标就在本脚本的出口段里', () => {
    const direct = chainOf('win32').hops.filter((h) => !(h.from in NON_DIRECT_HOPS))
    expect(direct.length).toBeGreaterThan(0)
    for (const h of direct) expect(exitsOf(truths.get(h.from)!), h.from).toContain(h.triple[1])
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

  it('每一个都在链上、且就是本脚本的下一段剧情的场景名 —— 对话走完踩上去是一跳，不是崩溃', () => {
    expect(found.length).toBeGreaterThan(0)
    for (const p of found) {
      expect(chain.scripts, p.script).toContain(p.script)
      expect(p.isOwnNext, p.script).toBe(true)
    }
  })

  it('各自的裁定与登记一致', () => {
    expect(Object.fromEntries(found.map((p) => [p.script, p.verdict]))).toEqual(PLACEHOLDER_VERDICTS)
  })

  it('全库的占位名与产品侧已知缺失清单那几条逐个相同', () => {
    const names = [...truths.values()].flatMap((s) => exitsOf(s).filter((n) => isPlaceholder(truths, n)))
    const registered = KNOWN_MISSING.filter((k) => k.issue === 'xl-1dv.13').map((k) => k.path.replace(/^script\//, ''))
    expect(names.sort()).toEqual(registered.sort())
  })
})

describe('缺陷交集清单', () => {
  const chain = chainOf('win32')
  const closure = reachable(truths, chain)

  for (const d of DEFECTS) {
    it(`${d.issue} 登记为 ${d.on}`, () => {
      const files = d.files(truths)
      expect(files.length, `${d.issue} 在全库里一处都找不到了 —— 缺陷没了还是选择器坏了`).toBeGreaterThan(0)
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
      const registered = KNOWN_MISSING.filter((k) => k.issue === issue).map((k) => k.path.replace(/^script\//, ''))
      expect([...names].sort(), issue).toEqual(registered.sort())
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
})
