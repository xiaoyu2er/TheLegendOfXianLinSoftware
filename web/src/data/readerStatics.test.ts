import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { javaSource } from '../test/javaSource'
import { READER_STATICS_SCRIPTS, readerStaticsFor } from './readerStatics'

/**
 * `Role` / `Task` 两段的烘焙产物（xl-i06.9）。存档第 1 行就是这几样，读错一个，
 * 存读档面板上那一格就画错。
 *
 * 期望值**不经过烘焙器**：这里自己把 GBK 脚本解码、按行找关键字、取下一行。
 * 与烘焙器唯一共享的是「值在关键字的下一行」这条读法，而那条读法本身由最后一条
 * 用例从原版 `Reader.switchReader` 现读核对。
 */
const SCRIPTS = readdirSync(repoPath('script'))
  .filter((f) => f.endsWith('.txt'))
  .sort()

function lines(file: string): string[] {
  return new TextDecoder('gbk').decode(readFileSync(repoPath('script', file))).split(/\r\n|\r|\n/)
}

/** 关键字行（trim 后逐字相等）的下一行；多次出现取最后一次。 */
function after(ls: readonly string[], keyword: string): string | null {
  let v: string | null = null
  ls.forEach((l, i) => {
    if (l.trim() === keyword && i + 1 < ls.length) v = ls[i + 1]!
  })
  return v
}

describe('readerStatics.json（Role / Task 两段）', () => {
  it('烘过的脚本与 script/ 下的脚本一一对应（分母现扫）', () => {
    expect(SCRIPTS.length).toBeGreaterThan(0)
    expect(READER_STATICS_SCRIPTS).toEqual(SCRIPTS)
  })

  it.each(SCRIPTS)('%s：task 与 role 与脚本原文逐字相等', (file) => {
    const ls = lines(file)
    const task = after(ls, 'Task')
    const roleLine = after(ls, 'Role')
    const role = roleLine === null ? null : roleLine.split(' ').slice(0, 3).map((s) => Number.parseInt(s, 10) === 1)
    expect(readerStaticsFor(file)).toEqual({ task, role })
  })

  it('两段都不是全空 —— 否则上面那一组对的全是 null，等于没测', () => {
    const withTask = SCRIPTS.filter((f) => readerStaticsFor(f).task !== null)
    const withRole = SCRIPTS.filter((f) => readerStaticsFor(f).role !== null)
    const withoutTask = SCRIPTS.filter((f) => readerStaticsFor(f).task === null)
    expect(withTask.length).toBeGreaterThan(0)
    expect(withRole.length).toBeGreaterThan(0)
    // 「没有这一段」那一支也要有人走到：粘不粘上一个场景的值只在这时候看得见。
    expect(withoutTask.length).toBeGreaterThan(0)
    // 陆、文两位各自既取过真也取过假，所以它俩对调看得出来。**张那一位在全部
    // 脚本里都是 1**（2026-09-10 现读：45 个带 Role 段的脚本，第一位没有一个是 0）
    // —— 它与另两位对调时，这一组对撞里只有取值组合会变、张那一列看不出来；
    // 它的位置由最后一条（从 Reader.switchReader 现读次序）钉着。
    const seen = (k: number) =>
      new Set(SCRIPTS.map((f) => readerStaticsFor(f).role?.[k]).filter((v) => v !== undefined))
    expect(seen(0), 'role[0]（张）').toEqual(new Set([true]))
    expect(seen(1), 'role[1]（陆）').toEqual(new Set([true, false]))
    expect(seen(2), 'role[2]（文）').toEqual(new Set([true, false]))
  })

  it('没烘过的脚本名是抛，不是「两段都没有」', () => {
    expect(() => readerStaticsFor('不存在的脚本.txt')).toThrow(/readerStatics\.json 里没有/)
  })

  it('读法与原版 Reader.switchReader 一致：两段都是「再读一行」，Role 按 zhang/lu/wen 与 == 1', () => {
    const src = javaSource('src/tools/Reader.java').replace(/\s+/g, '')
    expect(src).toContain('case"Task":task=br.readLine();break;')
    const role = /case"Role":String\[\]ss=br\.readLine\(\)\.split\(""\);(.*?)break;/.exec(src)?.[1]
    expect(role, 'Role 那一支没认出来').toBeDefined()
    const order = [...role!.matchAll(/Integer\.parseInt\(ss\[(\d)\]\)==1\)SaveAndLoad\.(\w+)=true;/g)].map(
      (m) => [Number(m[1]), m[2]],
    )
    expect(order).toEqual([
      [0, 'zhang'],
      [1, 'lu'],
      [2, 'wen'],
    ])
  })
})
