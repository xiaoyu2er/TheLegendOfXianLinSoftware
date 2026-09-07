import { describe, expect, it } from 'vitest'
import { EXPECTED, scriptNames } from './expected'
import { checkStanding, unassembledLine } from './unassembled'
import { IMPLEMENTED_DRIVERS, isImplementedDriver } from '../replay/implemented'
import { TRACE_NAMES, readTrace } from '../state/trace'

/**
 * 「未实现的 web 侧不许被当成通过」这件事的判据（xl-1vu.7）。
 *
 * 跨端比对流水线本身要 Java 与 Chrome，进不了 CI；而它对每条剧本判「能不能
 * 比」用的那套规则是纯的，所以搬进 `compare/unassembled.ts`，在这里跑。
 *
 * 分母有两处，都从源头现数：磁盘上的剧本数（`scriptNames()`）与入库真值数
 * （`TRACE_NAMES`）。谁加一条剧本，这里立刻跟着变。
 */
describe('四种驱动器的处境表', () => {
  it('每一份入库真值的表态都跟取图页的实现状况对得上', () => {
    // 分母 = 入库真值的份数。这一条同时验两个方向：表说比得了而页面装不出、
    // 页面装得出而表还说比不了，两种都抛。
    expect(TRACE_NAMES.length).toBeGreaterThan(0)
    for (const name of TRACE_NAMES) {
      const driver = readTrace(name).driver
      expect(() => checkStanding(name, driver), `${name}（driver=${driver}）`).not.toThrow()
    }
  })

  it('入库真值与剧本目录是同一批名字', () => {
    // 两处名单对不上时，上一条会漏掉那几个 —— 而"少验了几条"和"全验过了"
    // 长得一模一样。
    expect(TRACE_NAMES).toEqual(scriptNames())
  })

  it('四种驱动器都有真值，且其中恰有 web 侧还装不出来的那几种', () => {
    const drivers = [...new Set(TRACE_NAMES.map((n) => readTrace(n).driver))].sort()
    // 名单从真值现数，不写死"应该有四种"：这张票收的口是"齐了"，而将来加第五
    // 种驱动器时这条不该因为一个过期的数字而红。
    expect(drivers).toEqual(['battle', 'menu', 'scene', 'shop'])
    // 至少一种装得出来（否则整条流水线一帧都比不了，`--self-check` 也没得跑），
    // 至少一种装不出来（否则下面那几条判据是空转的）。
    expect(drivers.filter(isImplementedDriver).length).toBeGreaterThan(0)
    expect(drivers.filter((d) => !isImplementedDriver(d)).length).toBeGreaterThan(0)
  })

  it('装不出来的每一条都点得出驱动器与归属票号', () => {
    // 非零退出不够 —— 票要的是"点名"。报告里那一行必须同时有剧本名、判别名与
    // 票号，否则人只知道"炸了"。
    const blocked = TRACE_NAMES.map((n) => checkStanding(n, readTrace(n).driver)).filter(
      (s) => !s.implemented,
    )
    expect(blocked.length).toBeGreaterThan(0)
    for (const s of blocked) {
      const line = unassembledLine(s)
      expect(line, `${s.script} 那一行没点出剧本名`).toContain(s.script)
      expect(line, `${s.script} 那一行没点出驱动器`).toContain(s.driver)
      expect(line, `${s.script} 那一行没点出票号`).toMatch(/xl-/)
    }
  })
})

describe('篡改：伪造一份「web 侧已实现」的假象', () => {
  // 这四条就是票里那条验收标准的可执行版本。它们不是假设 —— 每一条都是把上面
  // 那两份记录之一改掉，然后确认裁决处**抛**，而不是静静放行。
  const implemented = IMPLEMENTED_DRIVERS[0]
  const blockedScript = TRACE_NAMES.find((n) => !isImplementedDriver(readTrace(n).driver))!
  const okScript = TRACE_NAMES.find((n) => isImplementedDriver(readTrace(n).driver))!

  it('把一份 unassembled 真值的判别字段改成 scene → 抛，不是悄悄比出零差异', () => {
    // 票里点名的那种伪造：改真值头里的 driver，让取图页以为它装得出来。
    expect(() => checkStanding(blockedScript, implemented)).toThrow(/表态还写着 unassembled/)
  })

  it('把表态从 unassembled 改成 gap/match（面板其实没做）→ 抛', () => {
    // 另一个方向：不动真值，改 expected.ts。判别名仍是页面装不出来的那个。
    const driver = readTrace(blockedScript).driver
    for (const status of ['match', 'gap'] as const) {
      const saved = EXPECTED[blockedScript]!
      try {
        ;(EXPECTED as Record<string, unknown>)[blockedScript] = { ...saved, status }
        expect(() => checkStanding(blockedScript, driver)).toThrow(/装配不出/)
      } finally {
        ;(EXPECTED as Record<string, unknown>)[blockedScript] = saved
      }
    }
  })

  it('给一条装得出来的剧本写 unassembled → 抛', () => {
    const saved = EXPECTED[okScript]!
    try {
      ;(EXPECTED as Record<string, unknown>)[okScript] = { ...saved, status: 'unassembled' }
      expect(() => checkStanding(okScript, readTrace(okScript).driver)).toThrow(
        /表态还写着 unassembled/,
      )
    } finally {
      ;(EXPECTED as Record<string, unknown>)[okScript] = saved
    }
  })

  it('判别名形状不对 → 抛，不按"不认识就是没实现"放过去', () => {
    // 空串 / 带空格 / 大写都是合法 JSON，写进真值头照样导出成功、退出码 0。
    for (const bad of ['', ' scene', 'Scene', 'scene ']) {
      expect(() => checkStanding(okScript, bad)).toThrow(/判别名/)
    }
  })
})
