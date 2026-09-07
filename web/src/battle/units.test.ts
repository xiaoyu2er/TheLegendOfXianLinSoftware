import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { parseEnemySource } from './enemySource'
import type { EnemySpec } from './units'
import { BGM_BY_BACKGROUND, ENEMIES, battleBgm, derive, expToLevelUp, refreshValue } from './units'

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

/**
 * 怪物出厂表**每一列**对回 `src/battle/Enemy.java`。
 *
 * ## 为什么不能只靠行为真值
 *
 * 表里大多数列被五份 driver=battle 的真值逐字段盖着（xl-rh9.8 实测：把
 * 武林高手2 的 hp 500 改成 5000、把商塔护法的 skill.attackCode 17 改成 18，
 * `battle-em3-box` 都红）。但有几列**一个读者都没有**：`skillHurt` 与
 * `money`，以及经由它们写进 `world.ts` 的 `hurtMax` / `skillHurtMax` /
 * `defenseMax` —— 写进去之后再没人读。没有读者的列，抄错了和抄对了在测试里
 * 长得一模一样（实测把罹年居士分身的 skillHurt 600 改成 590，逐字段比对全绿）。
 *
 * ## 这条判据的形状
 *
 * 解析器（`enemySource.ts`）把源码那两个 switch 解成一张表，然后**整行
 * `toEqual`**。用 `toEqual` 而不是逐字段挑，是为了让"漏核了一列"也响：
 * 哪天有人往 `EnemySpec` 加一列而不去源码里找它的出处，这里立刻多出一个键。
 *
 * 分母是**我们表里有几行**（`Object.keys(ENEMIES).length`），不是源码的 25 行
 * —— 那张表只抄跑得到真值的那几只，还会随别人的票一起长。
 *
 * ## 篡改验证（2026-09-07 实测）
 *
 * 7 行 × 每行 24 列 = **168 次逐列篡改**（数值 +1、名字加后缀、罹年居士那个
 * `zhangSpeed + 6` 改成 `+ 7`），每次都先断言篡改真的写进了文件再跑
 * `vitest run src/battle/units.test.ts`：**168 红 0 绿**。
 */
describe('怪物出厂表逐列对回原版源码', () => {
  const source = parseEnemySource()

  /** 我们表里 `speed` 是 `number | (zhangSpeed) => number`，两种形状要分得开。 */
  function normaliseSpeed(speed: EnemySpec['speed']): unknown {
    if (typeof speed !== 'function') return { kind: 'const', value: speed }
    // 两个点定一条斜率为 1 的线：只对一个点会让 `() => 6` 冒充 `z => z + 6`。
    return { kind: 'zhangSpeedPlus', atZero: speed(0), atHundred: speed(100) }
  }

  function fromSource(name: string): unknown {
    const s = source.get(name)
    if (!s) throw new Error(`原版的 Enemy.initial() 里没有「${name}」`)
    return {
      length: s.length,
      beAttackedFrames: s.beAttackedLength,
      speed:
        s.speed.kind === 'const'
          ? { kind: 'const', value: s.speed.value }
          : { kind: 'zhangSpeedPlus', atZero: s.speed.delta, atHundred: 100 + s.speed.delta },
      hurt: s.hurt,
      skillHurt: s.skillHurt.kind === 'sameAsHurt' ? s.hurt : s.skillHurt.value,
      defense: s.defense,
      hp: s.hp,
      exp: s.exp,
      money: s.money,
      skillNum: s.skillNum,
      beAttackedOffsetX: s.beAttackedOffsetX,
      beAttackedOffsetY: s.beAttackedOffsetY,
      skill: { ...s.skill },
    }
  }

  it('从源码里真的解出了那些 case —— 解析器空转要响', () => {
    // 这个数是解出来的，不是抄的；它随原版源码走，而原版源码在迁移期间不动。
    expect(source.size, '`Enemy.initial()` 的 case 数变了 —— 原版源码不该动').toBe(25)
  })

  it('我们表里的每一行都在原版的两个 switch 里', () => {
    // 分母是我们抄了几行。它今天是 7，明天别人加真值时会变，所以不写死。
    expect(Object.keys(ENEMIES).length).toBeGreaterThan(0)
    for (const name of Object.keys(ENEMIES)) {
      expect(source.has(name), `${name} 不在原版的 Enemy.java 里`).toBe(true)
    }
  })

  it('逐行逐列相等，多一列少一列都要响', () => {
    for (const [name, spec] of Object.entries(ENEMIES)) {
      const actual = { ...spec, speed: normaliseSpeed(spec.speed) }
      expect(actual, `怪物「${name}」`).toEqual(fromSource(name))
    }
  })

  /**
   * 上面那条 `toEqual` 已经把 `skillHurt` 的数值盖住了，但盖不住**它为什么是
   * 那个数**：原版 25 行里 23 行写的是 `skillHurt=hurt`，另外两行写的是恰好
   * 等于 `hurt` 的字面量 —— 也就是说这一列从来没有独立信息。`units.ts` 仍然把
   * 它分成两个字段，所以这条盯着的是"哪天原版分开了"（那时 `EnemySpec` 的
   * 注释就该改）。
   */
  it('原版每一行的 skillHurt 都不与 hurt 分开', () => {
    const split = [...source].filter(
      ([, v]) => v.skillHurt.kind === 'const' && v.skillHurt.value !== v.hurt,
    )
    expect(
      split.map(([name]) => name),
      '原版有怪物的 skillHurt 与 hurt 不是同一个数了 —— `EnemySpec.skillHurt` 上那段注释要改',
    ).toEqual([])
  })
})

/**
 * 解析器**解不出来要当场抛**，不许安静地返回空表 —— 空表的逐行对比是一条恒真
 * 的检查，而"恒真地通过"与"真的对上了"长得一模一样。这一节把改坏的源码文本
 * 喂给**真正的那个** `parseEnemySource`（它收一个可选的源码参数就是为了这个），
 * 一道门一条用例。
 */
describe('源码解析器解不出来就抛', () => {
  const raw = readFileSync(repoPath('src/battle/Enemy.java'))
  const gbk = new TextDecoder('gbk').decode(raw)

  /** 篡改必须真的写进去了才算数（`sed` 没匹配到照样 exit 0，见 dispatch.md）。 */
  function tamper(from: string | RegExp, to: string): string {
    const out = gbk.replace(from, to)
    if (out === gbk) throw new Error(`篡改点没匹配到：${from}`)
    return out
  }

  it('方法签名变了 → 抛', () => {
    expect(() => parseEnemySource(tamper('public void initial(String name,int roleCode){', 'public void initial2(String name,int roleCode){'))).toThrow(
      '找不到 initial(…) 的开头',
    )
  })

  it('一个 case 都没解出来 → 抛，而不是返回空表', () => {
    expect(() => parseEnemySource(tamper(/case "[^"]+":[\s\S]*?break;/g, ''))).toThrow(
      'initial(…) 里一个 case 都没解出来',
    )
  })

  it('某个 case 少了一个字段 → 抛，并点名是哪一个', () => {
    expect(() => parseEnemySource(tamper('money=1000;', ''))).toThrow(
      'initial 的 case "怪物1" 里没有 money=',
    )
  })

  it('表达式换成不认得的形状 → 抛，并把原文带出来', () => {
    expect(() => parseEnemySource(tamper('this.speed=11;', 'this.speed=hurt/2;'))).toThrow(
      '"hurt/2"',
    )
    expect(() => parseEnemySource(tamper('this.beAttackedX=x-125;', 'this.beAttackedX=x*2;'))).toThrow(
      '期望 x±N 的形状',
    )
  })

  it('setSkill 的参数个数变了 → 抛', () => {
    expect(() =>
      parseEnemySource(tamper('setSkill("怪物/怪物1攻击", 16,', 'setSkill("怪物/怪物1攻击", 16, 0,')),
    ).toThrow('13 个参数')
  })

  it('同一个字段被赋值两次 → 抛，而不是取第一个', () => {
    expect(() => parseEnemySource(tamper('this.hp=250;', 'this.hp=250;\r\n\t\tthis.hp=1;'))).toThrow(
      '被赋值了 2 次',
    )
  })

  it('两个 switch 的 case 名单对不上 → 抛', () => {
    expect(() => parseEnemySource(tamper(/case "怪物2":\s*\r?\n\s*setSkill[\s\S]*?break;/, ''))).toThrow(
      '名单对不上',
    )
  })

  /**
   * 用 UTF-8 读 GBK 源码是这一类里最阴的一种：中文全变乱码，而
   * `case "([^"]+)"` 照样匹配得上（引号与数字都是 ASCII），于是解析器很容易
   * 解出 25 个名字全是乱码的 case，然后逐行对比一条都跑不到 —— 空转着通过。
   *
   * 这里拦住它的是**切段用的那两个界标本身就是中文注释**（`//载入图片` /
   * `//做出动作`）：乱码之后找不到结尾，当场抛。实测的报错就是下面这句 ——
   * 头一版这条用例写的是"解得出来但名字对不上"，跑出来才发现更早一道门就拦住了。
   */
  it('UTF-8 读 GBK 源码 → 抛，而不是解出一表乱码名字', () => {
    expect(() => parseEnemySource(new TextDecoder('utf-8').decode(raw))).toThrow(
      '找不到 initial(…) 的结尾',
    )
  })
})
