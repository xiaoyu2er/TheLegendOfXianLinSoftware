import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { CELL_WIDTH, FONT_SIZE, TEXT_LEFT, baselineY, isFullWidth, layoutLine } from './narratageLayout'

/**
 * 磁盘上真值里的全部旁白行。**分母从源头数**：96 份真值里哪几份有 `Narratage`
 * 段，是数出来的，不是抄一份名单。有旁白的真值一条都不许是 0 —— 读不到文件、
 * 字段改名、目录搬家，在这里都会变成"一行都没有"，而那与"全过"长得一模一样。
 */
function narratageLines(): { file: string; line: string }[] {
  const dir = repoPath('tools/ground-truth')
  const out: { file: string; line: string }[] = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const truth = JSON.parse(readFileSync(`${dir}/${file}`, 'utf-8')) as {
      narratage?: string[] | null
    }
    for (const line of truth.narratage ?? []) out.push({ file, line })
  }
  return out
}

describe('旁白的排版常量照抄原版', () => {
  it('基线是 fontSize * (3 + 2i)', () => {
    // Narratage.drawNarratage：new Double(fontSize * (3.0 + 2.0 * i)).intValue()
    expect([0, 1, 2, 9].map(baselineY)).toEqual([60, 100, 140, 420])
    expect(FONT_SIZE).toBe(20)
    expect(TEXT_LEFT).toBe(50)
    expect(CELL_WIDTH).toBe(FONT_SIZE)
  })
})

describe('全角判定与基准侧 Java 的步进一致', () => {
  const lines = narratageLines()

  it('真值里确实有旁白可查（否则下面几条全是空转）', () => {
    expect(lines.length).toBeGreaterThan(0)
    expect(new Set(lines.map((l) => l.file)).size).toBeGreaterThan(1)
  })

  /**
   * 基准机（macOS 15 / openjdk 17）实测：把这些行用到的全部不同字符逐个过
   * `new Font("文鼎粗钢笔行楷", Font.BOLD, 20)` 的 `FontMetrics.charWidth`，
   * **190 个字符里 188 个恰好是 20**（含 `，` `。` 这些全角标点），
   * 只有半角 `,` 与 `.` 是 5。
   *
   * 也就是说：在这批数据上，"步进是整 20 px" 与 "不是 ASCII" 是同一个判定。
   * 这条断言把它钉住 —— 将来哪条剧本引进一个新字符（希腊字母、半角数字…），
   * 这里会红，提醒去基准机上重量一遍，而不是让它悄悄按 20 px 摆错。
   */
  it('旁白用到的每个字符：全角 ⇔ 非 ASCII', () => {
    const wrong: string[] = []
    for (const { char } of [...new Set(lines.flatMap((l) => [...l.line]))].map((char) => ({ char }))) {
      const ascii = char.codePointAt(0)! < 0x80
      if (isFullWidth(char) === ascii) wrong.push(`${char} U+${char.codePointAt(0)!.toString(16)}`)
    }
    expect(wrong).toEqual([])
  })
})

describe('逐字按格摆', () => {
  const never = (char: string): number => {
    throw new Error(`不该量全角字 ${char} 的宽度`)
  }

  it('中文一路 20 px 一格，量都不量', () => {
    const cells = layoutLine('走过百年风雨', never)
    expect(cells.map((c) => c.x)).toEqual([50, 70, 90, 110, 130, 150])
  })

  /**
   * 票里那条最长的行（脚本1 第 2 行，43 个字）。原版 `FontMetrics` 下它的
   * 末字左边缘在 50 + 42×20 = 890；xl-9bd.17 量到 web 侧整行 `fillText` 的
   * 墨迹右边界跑到了 924，java 是 908 —— 每字约 0.37 px 的累积。
   */
  it('43 个字的那一行，末字落在 890 而不是漂出去', () => {
    const line = narratageLines().find((l) => l.line.length === 43)
    expect(line, '真值里应当有那条 43 个字的旁白').toBeDefined()
    const cells = layoutLine(line!.line, never)
    expect(cells).toHaveLength(43)
    expect(cells[42]!.x).toBe(50 + 42 * CELL_WIDTH)
  })

  it('半角字符按量到的步进走，后面的字跟着挪', () => {
    // 脚本2 第 4 行的形状：'…很晚,很晚….'，半角逗号在中间。
    const cells = layoutLine('晚,很', (char) => {
      expect(char).toBe(',')
      return 5
    })
    expect(cells.map((c) => c.x)).toEqual([50, 70, 75])
  })

  it('left 可以挪，格子整体跟着走', () => {
    expect(layoutLine('风雨', never, 0).map((c) => c.x)).toEqual([0, 20])
  })
})
