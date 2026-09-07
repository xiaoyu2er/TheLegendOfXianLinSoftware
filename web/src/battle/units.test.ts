import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { BGM_BY_BACKGROUND, battleBgm, derive, expToLevelUp, refreshValue } from './units'

/**
 * 出厂数据里那些**没有行为真值盖得住**的部分，各自找一条分母固定的判据。
 *
 * `battle-min` 那一场只用得到十二首 BGM 里的一首、只走得到升级公式的零次。
 * 剩下的部分不是"随它去"，也不是"抄了就算数"——抄错了和抄对了长得一样，正是
 * 这个仓库最贵的那种失败。所以这里把它们对回**原版源码本身**。
 */

/**
 * GBK 源码要显式解码。`src/` 全是 GBK+CRLF（见 CLAUDE.md），按 UTF-8 读出来
 * 的中文路径全是乱码，而乱码与"表里少一行"在正则匹配下长得一样——匹配不到
 * 就是 0 行，下面第一条断言正是拦这个的。
 */
function javaSource(path: string): string {
  return new TextDecoder('gbk').decode(readFileSync(repoPath(path)))
}

describe('背景图 → BGM 的那张表对回原版源码', () => {
  /** `BattlePanel.initial` 里那个 switch 的每一个 case。 */
  const rows = [
    ...javaSource('src/battle/BattlePanel.java').matchAll(
      /case "(image\/背景图\/[^"]+)":\s*\r?\n\s*MusicReader\.readBGM\("([^"]+)"\);/g,
    ),
  ].map((m) => [m[1]!, m[2]!] as const)

  it('从源码里真的解出了那些 case —— 解析器空转要响', () => {
    // 分母是"源码里有几个 case"，解析器失灵（编码错了、写法变了）时它是 0，
    // 而 0 行的逐行对比是一条恒真的检查。
    expect(rows.length).toBeGreaterThan(0)
    // 同一个背景不许在源码里出现两次，否则下面那条"条数相等"会被抵消掉。
    expect(new Set(rows.map(([bg]) => bg)).size).toBe(rows.length)
  })

  it('逐行相等，且一行不多一行不少', () => {
    expect(Object.fromEntries(rows)).toEqual(BGM_BY_BACKGROUND)
    for (const [background, bgm] of rows) {
      expect(battleBgm(background), background).toBe(bgm)
    }
  })

  it('认不出的背景一首都不播（原版那个 switch 没有 default）', () => {
    expect(battleBgm('image/背景图/根本没有这张图.png')).toBeNull()
  })
})

describe('属性公式', () => {
  it('refreshValue 会把 hp / mp 夹回上限，derive 不碰它们', () => {
    // 原版 `refreshValue()` 末尾那两句 `if(hp>=hpMax){hp=hpMax;}`。两个调用点
    // 后面都紧跟着 `hp=hpMax`，所以它在 battle-min 里观测不到 —— 这条用例是
    // 它今天唯一的判据。
    const unit = {
      physicalPower: 10,
      sprit: 10,
      agile: 10,
      strength: 10,
      ...derive({ physicalPower: 10, sprit: 10, agile: 10, strength: 10 }),
      hp: 99999,
      mp: 99999,
    }
    refreshValue(unit)
    expect({ hp: unit.hp, mp: unit.mp }).toEqual({ hp: 700, mp: 300 })

    // 反方向：没顶到上限的不许被动。
    unit.hp = 1
    unit.mp = 2
    refreshValue(unit)
    expect({ hp: unit.hp, mp: unit.mp }).toEqual({ hp: 1, mp: 2 })
  })

  /**
   * 期望值**不是手算的，是 openjdk 17 当场跑出来的**（2026-09-07）：
   *
   *     for(int l=1;l<=10;l++) System.out.println((int)(500*(Math.pow(1.4,l))));
   *
   * 头一版这里写的是手算的 1372 与 5271，两个都错 —— `Math.pow(1.4,3)` 是
   * 2.7439999999999993 而不是 2.744，×500 截尾得 1371。这一条同时钉住的是
   * **V8 与 JVM 的 `Math.pow` 在这十个点上给出同一个 double**：规范只保证
   * 1 ulp 内，而 1 ulp 的差在截尾之后就是整整 1 点经验。哪天不成立了要响。
   */
  it('expToLevelUp 的 1..10 级与 openjdk 17 逐级相等', () => {
    const fromJvm = [700, 979, 1371, 1920, 2689, 3764, 5270, 7378, 10330, 14462]
    expect(fromJvm.map((_, i) => expToLevelUp(i + 1))).toEqual(fromJvm)
  })
})
