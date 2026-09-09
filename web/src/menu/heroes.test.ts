import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { MENU_DEFAULT_LEVEL, MENU_HERO_ORDER, createMenuHeroes } from './heroes'
import type { PartyKey } from '../battle/units'

/**
 * `MENU_DEFAULT_LEVEL` 抄的是三个类里 `public static int level=N;` 的初值 ——
 * 从 GBK 源码里现读来核。
 *
 * 这一条不是装饰：玉洁是 3、另外两个是 1，而"三个都是 1"推出来的属性同样合法
 * （只是玉洁的每一项都小一截），只有跟真值逐字段比才露头。
 */
describe('菜单里三个人的出厂数据，对回原版', () => {
  const FILE_OF: Readonly<Record<PartyKey, string>> = {
    zhang: 'src/battle/ZhangXiaoFan.java',
    lu: 'src/battle/LuXueQi.java',
    yu: 'src/battle/YuJie.java',
  }

  for (const key of Object.keys(FILE_OF) as PartyKey[]) {
    it(`${key} 的 level 初值`, () => {
      const matches = [
        ...javaSource(FILE_OF[key]).matchAll(/static\s+int\s+level\s*=\s*(\d+)\s*;/g),
      ]
      expect(matches, `${FILE_OF[key]} 里没解出 level 的初始化式`).toHaveLength(1)
      expect(MENU_DEFAULT_LEVEL[key]).toBe(Number(matches[0]![1]))
    })

    it(`${key} 的空构造函数确实什么都不做 —— 否则上面那条前提就没了`, () => {
      // `public ZhangXiaoFan(){ }`：菜单走的就是它。它一旦有内容，菜单的
      // 开局属性就不再是 static 初值 + 武器加成了。
      const cls = FILE_OF[key].replace(/^.*\/(\w+)\.java$/, '$1')
      const matches = [
        ...javaSource(FILE_OF[key]).matchAll(new RegExp(`public\\s+${cls}\\s*\\(\\s*\\)\\s*\\{([^}]*)\\}`, 'g')),
      ]
      expect(matches, `${FILE_OF[key]} 里没解出无参构造函数`).toHaveLength(1)
      expect(matches[0]![1]!.trim()).toBe('')
    })
  }

  it('三个人的名字与次序是真值那一列的次序', () => {
    expect(MENU_HERO_ORDER.map((h) => h.name)).toEqual(['zhangxiaofan', 'luxueqi', 'yujie'])
    expect(MENU_HERO_ORDER.map((h) => h.key)).toEqual(['zhang', 'lu', 'yu'])
  })

  it('fullHeal 关掉时 hp/mp 是 0，开着时才拉满', () => {
    // 这两条分开断言的理由：`fullHeal` 写反了的话三个人照样有合法的血量，
    // 而"开局满血"是剧本说的，不是原版默认的。
    for (const h of createMenuHeroes(false)) {
      expect(h.hp, `${h.name} 的 hp`).toBe(0)
      expect(h.mp, `${h.name} 的 mp`).toBe(0)
      expect(h.hpMax, `${h.name} 的 hpMax`).toBeGreaterThan(0)
    }
    for (const h of createMenuHeroes(true)) {
      expect(h.hp).toBe(h.hpMax)
      expect(h.mp).toBe(h.mpMax)
    }
  })
})
