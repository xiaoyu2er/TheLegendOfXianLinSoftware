import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { javaStaticInt } from '../test/javaStaticInt'
import { HEROES, derive } from '../battle/units'
import type { PartyKey } from '../battle/units'
import { DEFAULT_WEAPONS } from '../menu/defaultWeapons'
import { DEFAULT_LEVEL, getParty, initialMember, rememberParty, resetParty } from './party'

/**
 * 队伍的**出厂状态**（xl-kaa 补的判据）。
 *
 * 为什么现在才补：`resetParty()` 一直就在（它是测试之间不互相污染用的），
 * 但没有任何一条用例核过它回到的那个状态**对不对**。xl-kaa 的验收标准点名
 * 写着「1 / 3 / 1 级，满血，经验 0」，而拿 `initialMember()` 去比
 * `initialMember()` 是自己给自己签字：`DEFAULT_LEVEL` 抄错一个数，那种比法
 * 一声不吭。
 *
 * 所以这里的三个等级从**原版 GBK 源码里现读**。抄错一个数，整场仗的每一个
 * 伤害数字都会变，而画面上完全正常。
 */

/**
 * `public static int <字段>=<n>;` —— 三个类里各一行。
 *
 * 「恰好一行」这条分母在 `javaStaticInt` 里：零行是正则被排版带偏（或者源码
 * 没按 GBK 解出来，那种情况下满屏乱码而匹配数同样是 0，与「这一行不存在」
 * 长得一样），两行以上则说不清读的是哪一处 —— 两种都抛。
 */
function javaStatic(className: string, field: string): number {
  const source = javaSource(`src/battle/${className}.java`)
  return javaStaticInt(source, field, `${className}.java`)
}

/** 逻辑名 → 原版的类名。 */
const CLASSES: Readonly<Record<PartyKey, string>> = {
  zhang: 'ZhangXiaoFan',
  yu: 'YuJie',
  lu: 'LuXueQi',
}

describe('队伍的出厂状态', () => {
  it('三个人的出厂等级来自三个类里那三行 static 初值', () => {
    // 分母是 `CLASSES` 的键数，而它的类型是 `Record<PartyKey, string>` ——
    // 队伍里多一个人，typecheck 就逼着这里也多一条。
    const keys = Object.keys(CLASSES) as PartyKey[]
    expect(keys).toHaveLength(3)
    const fromJava = Object.fromEntries(keys.map((k) => [k, javaStatic(CLASSES[k], 'level')]))
    expect(DEFAULT_LEVEL).toEqual(fromJava)
    // 三个数**不一样**，所以上面那条比得出东西：三个都是 1 的话，把
    // `DEFAULT_LEVEL` 整个换成 `{zhang:1,yu:1,lu:1}` 也照样绿。
    expect(new Set(Object.values(fromJava)).size).toBeGreaterThan(1)
  })

  it('开局血与灵力是满的、经验是 0（三个构造函数末尾那两句 hp=hpMax; mp=mpMax;）', () => {
    for (const key of Object.keys(CLASSES) as PartyKey[]) {
      const member = initialMember(key)
      const d = derive(HEROES[key].attributes(member.level))
      expect({ key, hp: member.hp, mp: member.mp, exp: member.exp, dead: member.isDead }).toEqual({
        key,
        hp: d.hpMax,
        mp: d.mpMax,
        exp: javaStatic(CLASSES[key], 'exp'),
        dead: false,
      })
      // 分得开：满血不是 0，也不是某个小数。
      expect(member.hp).toBeGreaterThan(0)
    }
  })

  it('resetParty() 真的回到那个状态，不是回到"上一次的样子"', () => {
    resetParty()
    // 先弄脏，走的是"打完一场记回去"那条正路。
    rememberParty([
      {
        spec: { key: 'zhang' },
        level: 9,
        physicalPower: 99,
        agile: 98,
        strength: 97,
        sprit: 96,
        exp: 123,
        hp: 1,
        mp: 2,
        isDead: true,
        angryValue: 5,
      },
      {
        spec: { key: 'yu' },
        level: 7,
        physicalPower: 89,
        agile: 88,
        strength: 87,
        sprit: 86,
        exp: 45,
        hp: 3,
        mp: 4,
        isDead: false,
        angryValue: 6,
      },
    ])
    expect(getParty().zhang.level).toBe(9)

    resetParty()
    const after = getParty()
    // 逐个人整块比一次：漏了谁一眼看得出是谁。
    expect({ zhang: after.zhang, yu: after.yu, lu: after.lu }).toEqual({
      zhang: initialMember('zhang'),
      yu: initialMember('yu'),
      lu: initialMember('lu'),
    })
    // 而且等级真的是原版那三个数，不只是"和 initialMember 一致"。
    expect([after.zhang.level, after.yu.level, after.lu.level]).toEqual([
      javaStatic(CLASSES.zhang, 'level'),
      javaStatic(CLASSES.yu, 'level'),
      javaStatic(CLASSES.lu, 'level'),
    ])
  })
})

/**
 * **出厂属性带着开局那三把武器**（xl-6lo.16）。
 *
 * 这不是"给队伍加个 buff"，是照抄 `GameLauncher` 构造函数里那两行的先后：
 * 先 `new ZhangXiaoFan(x,y,battlePanel)`（按等级重算属性、`hp=hpMax`），
 * 再 `new MenuPanel(zhangXiaoFan,luXueQi,yuJie)` —— 里头 `new EquipPanel()`
 * 的构造函数调 `addPack()`，四项属性各 `+=` 一次武器加成再 `refreshValue()`，
 * 而 `refreshValue()` **只往下夹、不往上补**。
 *
 * 于是玉洁开局就**不是满血**：她 3 级、体力 14，鸳鸯刀 +3 变 17，`hpMax`
 * 从 980 推到 1190，而 `hp` 停在 980。两个数都是合法数字，只有先后不同才分得
 * 出来 —— 所以这条判据的一半是**从 GBK 源码现读那个先后**。
 *
 * ⚠️ 这几个数是注释里的读数（2026-09-09 现算），**下面的断言一个都不写它们**
 * —— 写关系不写数，改了武器表或等级公式也不会假红。
 */
describe('出厂属性带着开局那把武器（xl-6lo.16）', () => {
  const launcher = javaSource('src/main/GameLauncher.java')

  it('原版的先后：三个人先建、MenuPanel 后建，而且收的就是那三个对象', () => {
    const born = launcher.indexOf('zhangXiaoFan=new ZhangXiaoFan(')
    const menu = launcher.indexOf('menuPanel=new MenuPanel(')
    // 零匹配与"次序对"长得一样（源码没按 GBK 解出来时满屏乱码，两个都是 -1，
    // 而 `-1 < -1` 是 false —— 所以两句 `toBeGreaterThan(-1)` 不能省）。
    expect(born, 'GameLauncher 里没解出 new ZhangXiaoFan(').toBeGreaterThan(-1)
    expect(menu, 'GameLauncher 里没解出 new MenuPanel(').toBeGreaterThan(-1)
    expect(menu, 'MenuPanel 竟然建在三个人之前').toBeGreaterThan(born)
    // 传的就是那三个对象 —— 传别的什么，"共用同一份状态"这条就不成立了。
    expect(launcher).toContain('menuPanel=new MenuPanel(zhangXiaoFan,luXueQi,yuJie)')
    // 而那一步真的会改属性：EquipPanel 的构造函数调 addPack()。
    expect(javaSource('src/menu/EquipPanel.java')).toContain('addPack()')
  })

  it('四项属性 = 按等级算的那一份 + 武器加成；血与灵力停在**穿之前**的上限', () => {
    let notFull = 0
    for (const key of Object.keys(CLASSES) as PartyKey[]) {
      const m = initialMember(key)
      const base = HEROES[key].attributes(m.level)
      const w = DEFAULT_WEAPONS[key]
      expect({
        physicalPower: m.physicalPower,
        agile: m.agile,
        strength: m.strength,
        sprit: m.sprit,
      }).toEqual({
        physicalPower: base.physicalPower + w.addPhysicalPower,
        agile: base.agile + w.addAgile,
        strength: base.strength + w.addStrength,
        sprit: base.sprit + w.addSpirit,
      })
      // 血是**穿武器之前**那个上限，不是穿完之后的。
      expect({ hp: m.hp, mp: m.mp }).toEqual({ hp: derive(base).hpMax, mp: derive(base).mpMax })
      if (m.hp < derive(m).hpMax) notFull += 1
    }
    // ⚠️ 分辨力所在：**至少有一个人开局不满血**。三把武器要是都不加体力，
    // 上面那条"停在穿之前的上限"就与"停在穿之后的上限"长得一模一样。
    expect(notFull, '三个人开局都满血 —— 那上面那条判据分不出先后').toBeGreaterThan(0)
  })
})
