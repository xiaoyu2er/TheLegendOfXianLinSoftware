import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { SKILLS, SKILL_MENU, SKILL_NUMBER } from './skills'
import type { PartyKey } from './units'

/**
 * `skills.ts` 那张表抄得对不对，由**原版 GBK 源码**自己说了算。
 *
 * 一条技能路径散在三个文件里，下标一路差一（按钮 k → pattern k+2 →
 * skillCode k+1）。抄错一位的表现是「放了隔壁那一招的动画」或者「扣错了灵力」，
 * 画面上完全正常 —— 所以这里把三处都解出来再对，而不是读一遍觉得没问题。
 *
 * ⚠️ GBK 源码用 `readFileSync` + `TextDecoder('gbk')` 读，不能用 `grep`
 * （不加 `-a` 会被当成二进制整个跳过，"没找到"和"不存在"长得一样，
 * 见 `docs/agents/dispatch.md`）。
 */
function javaSource(path: string): string {
  return new TextDecoder('gbk').decode(readFileSync(repoPath(path)))
}

const JAVA_CLASS: Readonly<Record<PartyKey, string>> = {
  zhang: 'ZhangXiaoFan',
  yu: 'YuJie',
  lu: 'LuXueQi',
}

describe('技能表对回原版源码', () => {
  it('菜单上有几颗按钮 = skillNumber 那个静态字段的初值', () => {
    // 导出器只写 `<类>.level = n` 再 new 一个出来，构造函数一个字都不碰
    // skillNumber。改它的两处（levelUp / intialFromInfo）战斗面板都走不到，
    // 所以菜单上永远是这几颗 —— 而"按等级算"与"读初值"在 5 级那一场里
    // 推出来的按钮数不同（3/4 对 2/3），差的那一颗正是剧本要点的那一颗。
    for (const key of ['zhang', 'yu', 'lu'] as const) {
      const src = javaSource(`src/battle/${JAVA_CLASS[key]}.java`)
      const m = src.match(/public\s+static\s+int\s+skillNumber\s*=\s*(\d+)\s*;/)
      expect(m, `${JAVA_CLASS[key]}.java 里找不到 skillNumber 的初值 —— 解析器空转`).not.toBeNull()
      expect(Number(m![1]), `${key} 的 skillNumber`).toBe(SKILL_NUMBER[key])
    }
  })

  it('LaunchAttack 里那几发 skillAttack(mpUse, reminderCode, skillCode) 逐位对上', () => {
    const src = javaSource('src/battle/LaunchAttack.java')
    // `skillAttack(120, 1, 2, bp.zxf)` / `skillAttack(120,6,2,bp.yj)` ——
    // 原版的空格写得很随意，所以正则不认空格。
    //
    // ⚠️ **第一个实参不一定是字面量**：陆雪琪的技能2 写的是
    // `skillAttack((int)(LuXueQi.mpMax*0.6), 11, 2, bp.lxq)` —— 耗的是她灵力
    // 上限的六成，随等级走。所以这里把它解成 `null`，只在是字面量时才比。
    // （最初这条正则只认整数，于是陆雪琪只解出 4 条 —— 而"少解一条"与
    // "原版少写一条"长得一样，靠下面那句 `toBe(5)` 才露的头。）
    const found = new Map<string, [number | null, number, number][]>()
    for (const m of src.matchAll(
      /skillAttack\(\s*([^,]+?)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*bp\.(zxf|yj|lxq)\s*\)/g,
    )) {
      const key = { zxf: 'zhang', yj: 'yu', lxq: 'lu' }[m[4] as 'zxf' | 'yj' | 'lxq']
      const list = found.get(key) ?? []
      const mp = /^\d+$/.test(m[1]!) ? Number(m[1]) : null
      list.push([mp, Number(m[2]), Number(m[3])])
      found.set(key, list)
    }
    // 分母：解析器真的解出了东西。三个人各 5 招（pattern 2..6）。
    expect([...found.keys()].sort()).toEqual(['lu', 'yu', 'zhang'])
    for (const [key, calls] of found) {
      expect(calls.length, `${key} 解出来的 skillAttack 条数`).toBe(5)
      // 原版那五段 if 是按 currentPattern 2..6 顺序写的。
      const mine = SKILLS[key as PartyKey]
      if (Object.keys(mine).length === 0) continue // 陆雪琪那一份还没抄（见 skills.ts）
      expect(
        calls.map((c, i) => [i + 2, ...c]),
        `${key} 的 mpUse / reminderCode / skillCode`,
      ).toEqual(
        calls.map((c, i) => {
          const e = mine[i + 2]!
          return [i + 2, c[0] === null ? null : e.mpUse, e.reminderCode, e.skillCode]
        }),
      )
      // 反方向：抄进表里的 mpUse 必须真的是字面量那几条 —— 不然一个算出来的
      // 耗蓝会被当成常数抄下来，而它随等级走。
      for (const [i, c] of calls.entries()) {
        if (c[0] !== null) continue
        expect(mine[i + 2], `${key} pattern ${i + 2} 的 mpUse 是算出来的，不该出现在表里`).toBeUndefined()
      }
    }
  })

  it('每个人 skill(i) 里那几发 backgroundAnimation.set(名字, 帧数) 逐位对上', () => {
    for (const key of ['zhang', 'yu'] as const) {
      const src = javaSource(`src/battle/${JAVA_CLASS[key]}.java`)
      const body = src.slice(src.indexOf('public void skill(int i)'))
      const sets = [
        ...body.matchAll(/backgroundAnimation\.set\("([^"]+)"\s*,\s*(\d+)\)/g),
      ].map((m) => [m[1]!, Number(m[2])] as [string, number])
      expect(sets.length, `${key} 的 skill() 里解出来的背景动画条数`).toBe(5)
      // skillCode i（1..5）对应第 i 条。
      for (const [pattern, e] of Object.entries(SKILLS[key])) {
        const got = sets[e.skillCode - 1]!
        expect([e.background.name, e.background.length], `${key} pattern ${pattern} 的背景动画`).toEqual(
          got,
        )
      }
    }
  })

  it('按钮 k → pattern k+2，三张表的下标不许各走各的', () => {
    for (const key of ['zhang', 'yu', 'lu'] as const) {
      SKILL_MENU[key].forEach((e, i) => {
        expect(e.pattern, `${key} 第 ${i + 1} 颗按钮的 pattern`).toBe(i + 2)
      })
      // 菜单上画得出来的那几颗，SKILLS 里必须都有条目（哪怕 damage 是 null）。
      const listed = Object.keys(SKILLS[key])
      if (listed.length === 0) continue
      for (let i = 0; i < SKILL_NUMBER[key]; i++) {
        expect(SKILLS[key][i + 2], `${key} 第 ${i + 1} 颗按钮在 SKILLS 里没有条目`).toBeDefined()
      }
    }
  })

  it('移植了的那几条各自写明了伤害参数，没移植的一律是 null', () => {
    // 反方向：不许出现"写了一半"的条目 —— 那种条目会让 step.ts 走进一条
    // 半真半假的路，而它算出来的伤害看着完全正常。
    const ported: string[] = []
    for (const key of ['zhang', 'yu', 'lu'] as const) {
      for (const [pattern, e] of Object.entries(SKILLS[key])) {
        if (e.damage === null) continue
        ported.push(`${key}/${pattern}`)
        expect(e.damage.mpUse, `${key} pattern ${pattern}`).toBe(e.mpUse)
        expect(e.damage.baseHurt).toBeGreaterThan(0)
      }
    }
    // 至少有两条移植了，否则 battle-menus 那条真值根本走不通。
    expect(ported.sort()).toEqual(['yu/3', 'zhang/3'])
  })
})
