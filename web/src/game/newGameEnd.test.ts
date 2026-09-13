import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { END_INITIAL, END_TICK_MS, END_WORD_STOP } from '../end/world'
import { resetParty } from '../fakes/party'
import { createMemorySaveStore } from '../save/memoryStore'
import { createWorld } from '../state/step'
import { sceneSourceOf } from '../state/trace'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import { NO_INPUT, advanceSession, carryIntoNewGame, createSession, enterEnd, enterScene } from './session'
import type { RunningSession } from './session'

/**
 * **「起」之后结局面板还在不在**（xl-eqo）。
 *
 * 票面原写的是「判据要押在跨面板端到端（xl-x0t）上」。这里没押：原版那一半回到 GBK 源码上取
 * （dispatch.md「真值盖不到那个分支 —— 判据得回到源码上取」），会话那一半照 `useGame.restart()`
 * 的三句拼。**这两半证不了的**写在最后一组的头注里。
 */

/** `src/` 下所有 `.java` 的仓库相对路径，排过序。 */
function javaFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(repoPath(dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(`${dir}/${entry.name}`)
        : entry.name.endsWith('.java')
          ? [`${dir}/${entry.name}`]
          : [],
    )
  return walk('src').sort()
}

/** 从 `header` 起配对花括号取方法体（`fakes/originalNewGame.test.ts` 同名函数同一个理由）。 */
function methodBody(source: string, header: string): string {
  const start = source.indexOf(header)
  expect(start, `找不到 ${header}`).toBeGreaterThanOrEqual(0)
  let depth = 0
  for (let i = start + header.length - 1; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`${header} 的花括号没配上`)
}

/** 对 `field` 的赋值：`=`（不是 `==`）、复合赋值、自增自减。只找 `=` 会漏 `wordY-=5`。 */
const assignmentTo = (field: string): RegExp => new RegExp(`\\b${field}\\s*(?:[+\\-*/%]?=(?!=)|\\+\\+|--)`, 'g')

/** 全 `src/` 里给 `field` 赋值的每一行。 */
function assignmentsAcrossSrc(field: string): { where: string; text: string }[] {
  const files = javaFiles()
  // 分母自证：扫空了目录与「没有赋值」长得一样，都是零行。
  expect(files.length).toBeGreaterThan(50)
  return files.flatMap((path) =>
    javaSource(path)
      .split(/\r?\n/)
      .map((line, i) => ({ where: `${path}:${i + 1}`, text: line.trim() }))
      .filter((row) => assignmentTo(field).test(row.text)),
  )
}

describe('原版：endPanel 活过「起」（GBK 源码现读）', () => {
  it('全 src/ 只有一处给 endPanel 赋值，而且在 GameLauncher 构造函数里', () => {
    const rows = assignmentsAcrossSrc('endPanel')
    expect(rows).toEqual([{ where: 'src/main/GameLauncher.java:64', text: 'endPanel=new EndPanel();' }])
    const ctor = methodBody(javaSource('src/main/GameLauncher.java'), 'public GameLauncher(){')
    expect(ctor).toContain('endPanel=new EndPanel();')
  })

  it('对照：同一个选择器在 init() 里抓得到重建 —— 「init() 不碰 endPanel」不是选择器瞎了', () => {
    // `init()` 是死代码（`fakes/originalNewGame.test.ts`），但就算它活着也不碰结局面板。
    // 这条「不碰」靠上一条的整表比较成立；这里证明那张表的选择器看得见 init() 里的赋值。
    const init = methodBody(javaSource('src/main/GameLauncher.java'), 'public  void init(){')
    expect([...init.matchAll(assignmentTo('battlePanel'))].length).toBeGreaterThan(0)
    expect([...init.matchAll(assignmentTo('endPanel'))]).toEqual([])
  })

  it('EndPanel.start() 只改两个旗标，不复位字幕、侧栏与过场画编号；update() 里那三样选择器抓得到', () => {
    const source = javaSource('src/start/EndPanel.java')
    const start = methodBody(source, 'public void start(){')
    const update = methodBody(source, 'public void update(){')
    for (const field of ['wordY', 'blankY', 'code']) {
      expect([...start.matchAll(assignmentTo(field))], `start() 里对 ${field} 的赋值`).toEqual([])
      expect([...update.matchAll(assignmentTo(field))].length, `update() 里对 ${field} 的赋值`).toBeGreaterThan(0)
    }
    expect(start).toMatch(/isStop\s*=\s*false/)
  })

  it('从结局回得到「起」：菜单「重新开始」switchTo("start")，而 switchTo 的 start 那一支不碰 endPanel', () => {
    expect(javaSource('src/menu/FuncButtons.java')).toMatch(/restart\.isIsclicked\(\)[\s\S]{0,600}?GameLauncher\.switchTo\("start"\)/)
    const launcher = javaSource('src/main/GameLauncher.java')
    const startCase = launcher.slice(launcher.indexOf('case "start":'), launcher.indexOf('case "ls":'))
    expect(startCase).toContain('switcher.show(c, "startPanel")')
    expect(startCase).not.toContain('endPanel')
  })
})

/**
 * ## 会话这一半，以及它证不了的
 *
 * `useGame.restart()` 是 React 那一侧的接线，这里照 `loadResidue.test.ts` 同样的三句拼
 * （`carryIntoNewGame` → `createSession` → `enterScene`），拼法与 `useGame.ts` 对不对得上靠读。
 *
 * 证不了的三样，都要跨面板真值（xl-x0t）：
 * - **新局走不走得到第二个 `$`**：`$` 只在脚本41 那段对话里；原版「起」连剧情三元组也带着（xl-9rv），
 *   web 回开机值 —— 两边走到那段对话的路不同，谁都没量过；
 * - **原版第二次进来是两条线程**（`ADR-0001#end-thread-not-duplicated`）：`isStop` 放开那一拍两条
 *   线程各走一次 `update()` 是竞态，过场画会多翻一张还是两张没量；这一层一条；
 * - **标题页那几秒线程仍在走**：原版不停，这一层新会话 `scene === null` 时 `advanceSession` 原样交回，
 *   `iterations` 不涨。`isStop` 之后那一圈什么都不改，所以只差计数。
 */
describe('会话：「起」把结局循环带进新局（xl-eqo）', () => {
  const deps = () => ({
    scenes: sceneSourceOf(getScene),
    sprite: () => ({ width: 1, height: 1 }),
    random: () => 0.5,
    saves: createMemorySaveStore(),
  })

  /** 进结局、推到字幕停下，再多推一秒（停下之后线程照走）。 */
  function creditsRolledToTheEnd(): RunningSession {
    let s: RunningSession = enterEnd(enterScene(createSession(deps()), createWorld(getScene('脚本1'))))
    const ticks = (END_INITIAL.wordY - END_WORD_STOP) / 5 + 10
    for (let i = 0; i < ticks; i++) s = advanceSession(s, NO_INPUT, END_TICK_MS)
    return s
  }

  function newGame(prev: RunningSession): RunningSession {
    resetParty()
    const carry = carryIntoNewGame(prev)
    return enterScene(createSession(prev.deps, carry), createWorld(getScene('脚本1'), true, carry.recorder))
  }

  it('新局再进结局：字幕接着停在 −1280，头一拍就定格', () => {
    const prev = creditsRolledToTheEnd()
    // 期望在动作之前钉：上一局确实滚到底了（没滚到底的话下面那条跟「从头滚」分不开）。
    expect(prev.end!.world.wordY).toBe(END_WORD_STOP)
    expect(prev.end!.world.isStop).toBe(true)

    let next: RunningSession = enterEnd(newGame(prev))
    expect(next.end!.world.wordY).toBe(END_WORD_STOP)
    expect(next.end!.world.isStop).toBe(false)
    next = advanceSession(next, NO_INPUT, END_TICK_MS)
    expect(next.end!.world.wordY).toBe(END_WORD_STOP)
    expect(next.end!.world.isStop).toBe(true)
  })

  it('新局还没进结局时，那条循环也在（原版线程 while(true)，「起」不摘）', () => {
    const next = newGame(creditsRolledToTheEnd())
    expect(next.end).not.toBeNull()
    expect(next.panel).not.toBe('end')
  })

  it('对照：开机那一局没有上一局，头一次进结局从 640 起滚', () => {
    const s = enterEnd(enterScene(createSession(deps(), carryIntoNewGame(null)), createWorld(getScene('脚本1'))))
    expect(s.end.world.wordY).toBe(END_INITIAL.wordY)
  })
})
