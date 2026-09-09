import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { createShopWorld } from '../shop/world'
import { DRUGS, drugIntroText } from './drugs'

/**
 * `drugs.ts` 抄得对不对，由 `sources/Shop/drug.txt` 自己说了算。
 *
 * 这一层不读磁盘（它要进浏览器包），所以抄了一份；而"抄了一份"必须有人核，
 * 否则抄错一位与抄对了在别的测试里长得一模一样（药品菜单上那六个数、
 * 介绍文字里那两个数，都直接来自这里）。
 */
describe('六种回复类药品对回 sources/Shop/drug.txt', () => {
  /**
   * GBK + CRLF。`$` 锚点在这份文件上不加 `\r` 处理会静默匹配不到（CLAUDE.md）。
   *
   * ⚠️ **这一处故意不换成 `test/javaSource.ts`**（xl-xh3）：那个 helper 读的是
   * 原版 **Java 源码**，这里读的是**游戏数据文件**，解码方式碰巧相同而已。
   * 完整理由与豁免登记在 `test/javaSource.ts`，判据在 `javaSource.test.ts`。
   */
  const rows = (() => {
    const text = new TextDecoder('gbk').decode(readFileSync(repoPath('sources/Shop/drug.txt')))
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => line.split('/'))
  })()

  it('真的读到了行 —— 解析器空转要响', () => {
    expect(rows.length).toBeGreaterThan(0)
    // 分母从文件现数，不写死 6：多一行少一行都该在下一条里露头。
    expect(DRUGS.length).toBe(rows.length)
    for (const cols of rows) {
      // `ShopReader.readDrug` 读的是前五列（第六列它一眼都没看）。
      expect(cols.length).toBeGreaterThanOrEqual(5)
    }
  })

  it('逐行逐列相等', () => {
    expect(
      DRUGS.map((d) => [d.name, String(d.addHp), String(d.addMp), d.picture, String(d.reduceMoney)]),
    ).toEqual(rows.map((c) => [c[0]!, c[1]!, c[2]!, c[3]!, c[4]!]))
  })

  /**
   * ⚠️ **第三个消费者的对撞判据**（xl-knp.7 / xl-knp.2）。
   *
   * 这份表现在有三处在读：战斗那边的药品菜单、商店的药店列表，以及这份数据
   * 本身。xl-knp.2 明确**决定不把它抽到共享位置**（抽公共件会撞 M3 刚落的
   * 文件，而抽到一起也防不住有人再抄一份出去），改用这一条：药店列出来的
   * 那几种药与这里**逐字相等**。
   *
   * 哪天有人给商店另抄一份价格表，或者在 `world.ts` 的 `drugRows` 里改了
   * 名字与价钱的来源，这一条立刻红 —— 而"三份分家"平时是**看不出来的**：
   * 各自的测试都还绿着，只有改了其中一份的那一天才会露头。
   */
  it('⚠️ 药店列出来的那几种药与这份表逐字相等 —— 三处消费的是同一份', () => {
    // 种子随便给：名字与价钱不是摇出来的，摇出来的只有存货。
    const rows = createShopWorld({ party: ['zhang'], coins: 10000, seed: 1 }).drug.rows
    // 分母两头现数：药店少列一行、或者这份表多一行，都在这里露头。
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBe(DRUGS.length)
    expect(rows.map((r) => [r.name, r.price])).toEqual(
      DRUGS.map((d) => [d.name, d.reduceMoney]),
    )
  })

  it('介绍文字的形状照抄 DrugMenu.checkMoveIn', () => {
    // `"hp "+getAddHp()+" mp "+getAddMp()` —— 空格位置进真值，差一个空格就红。
    expect(drugIntroText(DRUGS[0]!)).toBe('hp 300 mp 0')
    expect(drugIntroText(DRUGS[5]!)).toBe('hp 0 mp 1200')
  })
})
