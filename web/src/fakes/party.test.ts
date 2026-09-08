import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { javaStaticInt } from '../test/javaStaticInt'
import { HEROES, derive } from '../battle/units'
import type { PartyKey } from '../battle/units'
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
      { spec: { key: 'zhang' }, level: 9, exp: 123, hp: 1, mp: 2, isDead: true, angryValue: 5 },
      { spec: { key: 'yu' }, level: 7, exp: 45, hp: 3, mp: 4, isDead: false, angryValue: 6 },
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
