import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
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

  it('介绍文字的形状照抄 DrugMenu.checkMoveIn', () => {
    // `"hp "+getAddHp()+" mp "+getAddMp()` —— 空格位置进真值，差一个空格就红。
    expect(drugIntroText(DRUGS[0]!)).toBe('hp 300 mp 0')
    expect(drugIntroText(DRUGS[5]!)).toBe('hp 0 mp 1200')
  })
})
