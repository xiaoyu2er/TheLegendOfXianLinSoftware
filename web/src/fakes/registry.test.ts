import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { REGISTERED_FAKES } from './registry'

/**
 * 假货登记册的**双向对撞**（ADR-0005，票 xl-rh9.5）。
 *
 * 两边各出一半，谁都不能自己给自己签字：
 *
 * - **代码侧**（分母）：磁盘上 `web/src/` 里所有 `export const FAKE =
 *   declareFake('…')` 的调用，现扫出来的；
 * - **登记侧**（登记）：`registry.ts` 里那张手写的 `REGISTERED_FAKES`。
 *
 * 两个方向都要红：
 *
 * | 篡改 | 哪一条红 |
 * |---|---|
 * | 册子说它是假的，而代码已经是真的（删掉模块里那句 `declareFake`） | 「册子里的每一样，磁盘上都还真是假的」 |
 * | 代码还是假的，而册子里删了它（删掉 `REGISTERED_FAKES` 里那一行） | 「磁盘上的每一样假货都登记在册」 |
 *
 * 两条篡改在 xl-rh9.5 里都真跑过一遍：删掉 `wallet.ts` 里那句 `declareFake`
 * 红 2 条（多的那条是下面「两套并存」，它也要先在磁盘上找到这个假货），
 * 删掉册子里 `wallet` 那一行红 3 条。**这两个数是跑出来的**，完整的篡改记录
 * 在 `bd show xl-rh9.5` 的关票理由里。
 */

/**
 * 扫描根。**这张表就是这套判据的分母**，一个目录漏在外头，落在那儿的假货就会
 * 因为「扫不到」而通过 —— 而 CONTEXT.md §响亮失败 说的正是这个：
 * 「找不到东西」不许成为通过条件。
 *
 * 取的是 `web/tsconfig.json` 的 `include` 里那两个真的装 TypeScript 的目录
 * （`vite.config.ts` 是单文件，不是目录）。下面第一条用例会核每个根都真的存在
 * 且真的扫出了东西，还会拿 tsconfig 对撞 —— include 里冒出新目录时它红，
 * 而不是安静地少扫一片。
 */
const SCAN_ROOTS = ['web/src', 'web/scripts'] as const

/** 扫描根底下所有非测试的 TypeScript 源码。 */
function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      if (/\.test\.tsx?$/.test(entry.name)) continue
      out.push(path)
    }
  }
  for (const root of SCAN_ROOTS) walk(repoPath(root))
  return out
}

/**
 * 去掉注释再匹配。**必须去**：这个文件、`fake.ts` 与 `registry.ts` 的文档里
 * 都写着 `declareFake('…')` 的样子，不去掉的话文档会被当成声明，于是"文档写
 * 得越全，扫出来的假货越多"。
 *
 * 去错了的后果是**响亮的**：某个真的声明被当成注释吃掉 → 它从磁盘侧消失 →
 * 下面「册子里的每一样磁盘上都还在」那条红。不会安静地变绿。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** 磁盘上真正声明了自己是假货的那些模块：id → 文件（仓库相对路径）。 */
const DECLARED: ReadonlyMap<string, string> = (() => {
  const found = new Map<string, string>()
  for (const path of sourceFiles()) {
    const src = stripComments(readFileSync(path, 'utf8'))
    for (const m of src.matchAll(/export\s+const\s+FAKE\s*=\s*declareFake\(\s*'([^']+)'\s*\)/g)) {
      const id = m[1]!
      const rel = relative(repoPath('.'), path)
      const already = found.get(id)
      if (already !== undefined) {
        throw new Error(`假货 id "${id}" 被声明了两次：${already} 与 ${rel}`)
      }
      found.set(id, rel)
    }
  }
  return found
})()

describe('假货登记册（ADR-0005）', () => {
  it('每个扫描根都真的存在，而且都扫出了源码 —— 少扫一片要响', () => {
    for (const root of SCAN_ROOTS) {
      const files = sourceFiles().filter((p) => p.startsWith(repoPath(root)))
      expect(files.length, `扫描根 ${root} 一个 .ts 都没扫到 —— 路径写错了？`).toBeGreaterThan(0)
    }
    // 反方向：`tsconfig.json` 的 include 里冒出新目录时，这条提醒有人来加。
    const tsconfig = JSON.parse(readFileSync(repoPath('web/tsconfig.json'), 'utf8')) as {
      include: string[]
    }
    const dirs = tsconfig.include.filter((entry) => !entry.endsWith('.ts'))
    expect(
      dirs.map((d) => `web/${d}`).sort(),
      'tsconfig 的 include 里有目录不在 SCAN_ROOTS 里 —— 落在那儿的假货扫不到，' +
        '而扫不到与"没有假货"长得一样。',
    ).toEqual([...SCAN_ROOTS].sort())
  })

  it('扫描器真的扫到了东西 —— 空转要响', () => {
    // 分母是磁盘。扫描器失灵（正则写错、目录挪了、注释剥过头）时它是 0，
    // 而 0 项的双向对撞是两条恒真的检查。
    expect(
      DECLARED.size,
      'web/src 里一句 `export const FAKE = declareFake(…)` 都没扫到 —— ' +
        '下面两条对撞会同时变成恒真。',
    ).toBeGreaterThan(0)
    expect(Object.keys(REGISTERED_FAKES).length).toBeGreaterThan(0)
  })

  it('磁盘上的每一样假货都登记在册（代码还是假的而册子里删了 → 红）', () => {
    const unregistered = [...DECLARED].filter(([id]) => !(id in REGISTERED_FAKES))
    expect(
      unregistered.map(([id, file]) => `${id} (${file})`),
      '有假货没有登记 —— 一个被忘掉的假货和一个正常工作的真货长得一样（ADR-0005）。',
    ).toEqual([])
  })

  it('册子里的每一样，磁盘上都还真是假的（册子说假而代码已真 → 红）', () => {
    const gone = Object.keys(REGISTERED_FAKES).filter((id) => !DECLARED.has(id))
    expect(
      gone,
      '登记册里写着的假货，磁盘上已经没有 `declareFake` 了 —— 要么真货做出来了' +
        '（那就把这一行从册子里删掉），要么假货被挪走了（那就把登记跟过去）。',
    ).toEqual([])
  })

  it('每一行都写明归哪张票，写法是真的票号', () => {
    for (const [id, entry] of Object.entries(REGISTERED_FAKES)) {
      // 票号形如 xl-6lo.1 / xl-knp.1；写"以后"「TODO」这类占位会红。
      expect(entry.owner, `${id} 的 owner`).toMatch(/^xl-[0-9a-z]+(\.[0-9]+)*$/)
      expect(entry.original.length, `${id} 的 original`).toBeGreaterThan(0)
      expect(entry.fakeBecause.length, `${id} 的 fakeBecause`).toBeGreaterThan(0)
      expect(entry.exports.length, `${id} 的 exports`).toBeGreaterThan(0)
    }
  })

  /**
   * **两套并存**检查。ADR-0005 怕的正是这个：真货做出来的那天没人记得这里
   * 还挂着一个假的，两套并存，而两套并存的样子和一套正常工作的样子完全相同。
   *
   * 分母是登记册里写的那些导出名（每一样假货自己报的）；判据是每个名字在
   * `web/src/` 里**只许有一个文件导出**，而且必须就是那个假货自己的文件。
   */
  it('假货导出的名字在 web/src 里只有一处 —— 真货另起一份而假货还在，要红', () => {
    const exporters = new Map<string, string[]>()
    for (const path of sourceFiles()) {
      const src = stripComments(readFileSync(path, 'utf8'))
      const rel = relative(repoPath('.'), path)
      for (const m of src.matchAll(/export\s+(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) {
        const name = m[1]!
        const list = exporters.get(name)
        if (list) list.push(rel)
        else exporters.set(name, [rel])
      }
    }
    for (const [id, entry] of Object.entries(REGISTERED_FAKES)) {
      const file = DECLARED.get(id)
      expect(file, `${id} 不在磁盘上`).toBeDefined()
      for (const name of entry.exports) {
        expect(
          exporters.get(name) ?? [],
          `假货 ${id} 的 ${name} 在 web/src 里被导出了不止一处（或一处都没有）—— ` +
            '真的那一份（' + entry.owner + '）做出来了却没拆掉假的，两套并存。',
        ).toEqual([file])
      }
    }
  })
})
