import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from './test/repoPath'
import { TEXT_FONT_CSS_VAR, TEXT_FONT_STACK } from './textFont'

/**
 * 字体链有两个消费方——Canvas 侧的旁白读 `TEXT_FONT_STACK`，CSS 侧的对话框
 * 读 `--xl-text-font`——但只能有一处定义。这里直接读 `index.css` 的源码把
 * 两边对上：**只改一处就会响**。
 *
 * 不用 `getComputedStyle`：jsdom 不做字体回退，读回来的也只是这个字符串，
 * 徒增一层间接。读源码反而是"改了哪一行就断在哪一行"。
 */
const css = readFileSync(repoPath('web/src/index.css'), 'utf8')

describe('文字层字体链的单一来源', () => {
  it('index.css 里声明了这个自定义属性', () => {
    // 分母是"这个变量出现过几次声明"，不是"有没有出现" ——
    // 声明成两份（比如媒体查询里再覆盖一次）同样是失去单一来源。
    const declarations = css.match(new RegExp(`^\\s*${TEXT_FONT_CSS_VAR}:`, 'gm')) ?? []
    expect(declarations).toHaveLength(1)
  })

  it('CSS 变量的值与 TEXT_FONT_STACK 逐字一致', () => {
    const m = css.match(new RegExp(`${TEXT_FONT_CSS_VAR}:\\s*([^;]+);`))
    if (!m) throw new Error(`index.css 里找不到 ${TEXT_FONT_CSS_VAR} 的声明`)
    expect(m[1]?.trim()).toBe(TEXT_FONT_STACK)
  })

  it('文字层的规则都走这个变量，没有人另写一条字体链', () => {
    // 原版写死的 `文鼎粗钢笔行楷` 曾经在三处各抄一份。任何 .dialogue-* 规则
    // 里再出现字面量 font-family 都算把单一来源破掉了。
    const literals = css
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /font-family:/.test(line))
      .filter(([, line]) => !line.includes(`var(${TEXT_FONT_CSS_VAR})`))
      .filter(([, line]) => !line.includes(TEXT_FONT_CSS_VAR))
      // `:root` 上给整个页面 UI（React 菜单、报告页）用的那条不是文字层。
      .filter(([, line]) => !/^\s*font-family: system-ui,/.test(line))
    expect(literals).toEqual([])
  })
})
