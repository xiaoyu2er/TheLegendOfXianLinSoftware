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

  it('四种驱动器都有真值，且取图页每一支都装得出来（M4 收口）', () => {
    const drivers = [...new Set(TRACE_NAMES.map((n) => readTrace(n).driver))].sort()
    // 这四支各自**必须有真值**（xl-1vu 收的就是这个口），少一支就红；但用
    // arrayContaining 而不是 toEqual —— 将来加第五支驱动器时这条不该因为一个
    // 过期的名单而红，那是"写死了目前只有 X"的老毛病。
    expect(drivers).toEqual(expect.arrayContaining(['battle', 'menu', 'scene', 'shop']))
    // 至少一种装得出来（否则整条流水线一帧都比不了，`--self-check` 也没得跑）。
    expect(drivers.filter(isImplementedDriver).length).toBeGreaterThan(0)
    // ⚠️ **这一行原先是「至少一种装不出来」**，理由是"否则下面那几条判据是
    // 空转的"。xl-knp.10 把 shop 接上之后，磁盘上一条装不出来的剧本都没有了 ——
    // 那句断言从此恒红，而它想守的那件事（判据别空转）已经改由下面那一族
    // **合成素材**来守，不再依赖磁盘上碰巧还剩几条没接的。
    //
    // 换成的这一条两头都会红：谁往 `tools/traces/scripts/` 里加一支新驱动器的
    // 剧本而没在 `IMPLEMENTED_DRIVERS` 里接线，它当场点名。
    //
    // 签的一笔（xl-i06.6）：`saveload` —— 存读档面板的真值先行（M6 的 SPEC 定的
    // 顺序是「判据先行、真值铺够、再动 Web 侧」），面板与取图页装配归 xl-i06.12。
    // 那张票接上之后这一笔要删；不删，这条照样红。
    expect(
      drivers.filter((d) => !isImplementedDriver(d)),
      'M4 收口之后四支驱动器全接上了。多出来的这几支是新加的真值，取图页还没装配 —— ' +
        '要么把那一套装配做出来，要么在这里签一笔，说明为什么它可以先挂着',
    ).toEqual(['saveload'])
  })

  it('装不出来的每一条都点得出驱动器与归属票号', () => {
    // 非零退出不够 —— 票要的是"点名"。报告里那一行必须同时有剧本名、判别名与
    // 票号，否则人只知道"炸了"。
    //
    // **分母是写死的 1，不是磁盘上碰巧有几条**（xl-knp.10）：M4 收口之后磁盘上
    // 一条装不出来的剧本都没有了，照旧只跑那个 filter 的话，循环零轮、判据恒真，
    // 而"一条都没验到"与"全验过了"长得一模一样。所以素材改成**合成的**。
    const line = unassembledLine(ghostStanding(UNASSEMBLED))
    expect(line, '那一行没点出剧本名').toContain(GHOST_SCRIPT)
    expect(line, '那一行没点出驱动器').toContain(GHOST_DRIVER)
    expect(line, '那一行没点出票号').toMatch(/xl-/)

    // 磁盘上真有装不出来的剧本时（新驱动器落了真值、还没接线），它们也得逐条
    // 点得出来。今天这个循环是零轮的 —— 上面那一条才是分母。
    const blocked = TRACE_NAMES.map((n) => checkStanding(n, readTrace(n).driver)).filter(
      (s) => !s.implemented,
    )
    for (const s of blocked) {
      const l = unassembledLine(s)
      expect(l, `${s.script} 那一行没点出剧本名`).toContain(s.script)
      expect(l, `${s.script} 那一行没点出驱动器`).toContain(s.driver)
      expect(l, `${s.script} 那一行没点出票号`).toMatch(/xl-/)
    }
  })
})

/**
 * 合成的素材（xl-knp.10）。
 *
 * 这一族篡改从前是**从磁盘上挑一条 `driver` 不在名单里的剧本**来伪造的。M4
 * 收口把最后一支（shop）接上之后，那样的剧本一条都不剩了 —— 而
 * `TRACE_NAMES.find(...)` 挑不到时返回 `undefined`，四条篡改会一起变成对
 * `undefined` 的断言：其中两条报的是"剧本 undefined 没有表态"、另外两条直接
 * ENOENT。**「素材没了」与「判据在验」长得完全不一样，可它也不是判据在验。**
 *
 * 所以素材改成合成的：一个取图页装配不出的判别名，加一条临时注册进 `EXPECTED`
 * 的剧本。这样这一族的分母是写死的，不随仓库还剩几条没接线而变。
 */
const GHOST_DRIVER = 'ghost'
const GHOST_SCRIPT = 'ghost-script'

const UNASSEMBLED = {
  status: 'unassembled',
  why: '合成出来的处境：取图页装配不出 driver=ghost',
  issue: 'xl-knp.10',
} as const

function ghostStanding(expectation: unknown) {
  return withExpectation(GHOST_SCRIPT, expectation, () => checkStanding(GHOST_SCRIPT, GHOST_DRIVER))
}

/** 把一条表态临时挂进 `EXPECTED`，跑完原样摘掉（原先没有的键要删，不是写回 undefined）。 */
function withExpectation<T>(name: string, expectation: unknown, body: () => T): T {
  const table = EXPECTED as Record<string, unknown>
  const had = Object.prototype.hasOwnProperty.call(table, name)
  const saved = table[name]
  try {
    table[name] = expectation
    return body()
  } finally {
    if (had) table[name] = saved
    else delete table[name]
  }
}

describe('篡改：伪造一份「web 侧已实现」的假象', () => {
  // 这几条就是票里那条验收标准的可执行版本。它们不是假设 —— 每一条都是把那两份
  // 记录之一改掉，然后确认裁决处**抛**，而不是静静放行。
  const implemented = IMPLEMENTED_DRIVERS[0]
  const okScript = TRACE_NAMES.find((n) => isImplementedDriver(readTrace(n).driver))

  it('合成的素材本身立得住 —— 否则下面几条会静静地失去分辨力', () => {
    // `ghost` 哪天真成了一支驱动器的名字，下面那几条会全部改去验另一件事，
    // 而它们照样是绿的。这一行把那种情况变成红的。
    expect(isImplementedDriver(GHOST_DRIVER), 'ghost 成了真驱动器？换一个合成名').toBe(false)
    expect(EXPECTED[GHOST_SCRIPT], 'ghost-script 撞上了一条真剧本？换一个合成名').toBeUndefined()
    // 磁盘上得真有一条装得出来的剧本，最后那两条要拿它当素材。
    expect(okScript, '一条装得出来的剧本都没有？那整条流水线一帧都比不了').toBeTruthy()
  })

  it('把一份 unassembled 真值的判别字段改成 scene → 抛，不是悄悄比出零差异', () => {
    // 票里点名的那种伪造：改真值头里的 driver，让取图页以为它装得出来。
    withExpectation(GHOST_SCRIPT, UNASSEMBLED, () => {
      expect(() => checkStanding(GHOST_SCRIPT, implemented)).toThrow(/表态还写着 unassembled/)
    })
  })

  it('把表态从 unassembled 改成 gap/match（面板其实没做）→ 抛', () => {
    // 另一个方向：不动真值，改 expected.ts。判别名仍是页面装不出来的那个。
    for (const status of ['match', 'gap'] as const) {
      expect(() => ghostStanding({ ...UNASSEMBLED, status })).toThrow(/装配不出/)
    }
  })

  it('页面装不出来、表却写 unpainted → 抛，两件事分得开', () => {
    // `unpainted` 说的是「驱动器装得出、只是有一层还没画」。拿它去盖「整个面板
    // 还没做」的话，归的票不是一张，而报告里那一行会指错地方。
    expect(() => ghostStanding({ ...UNASSEMBLED, status: 'unpainted' })).toThrow(/unpainted/)
  })

  it('给一条装得出来的剧本写 unassembled → 抛', () => {
    withExpectation(okScript!, { ...EXPECTED[okScript!]!, status: 'unassembled' }, () => {
      expect(() => checkStanding(okScript!, readTrace(okScript!).driver)).toThrow(
        /表态还写着 unassembled/,
      )
    })
  })

  it('判别名形状不对 → 抛，不按"不认识就是没实现"放过去', () => {
    // 空串 / 带空格 / 大写都是合法 JSON，写进真值头照样导出成功、退出码 0。
    for (const bad of ['', ' scene', 'Scene', 'scene ']) {
      expect(() => checkStanding(okScript!, bad)).toThrow(/判别名/)
    }
  })
})
