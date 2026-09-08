import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'

/**
 * **原版点「起」的三件事，以及它们的先后**（xl-w16）。
 *
 * xl-w16 的票面上写着一处"与原版的差别"：
 *
 * > 点「起」之后的载入窗口里，面板先翻成 scene（画面上是"正在载入
 * > 脚本1…"），原版是 `initiation(...)` 返回之后才 `switchTo("scene")`。
 *
 * **那句话是反的。** 照 `src/start/StartPanel.java` 的 `startLoadAction()`
 * case 0 现读，原版是先 `switchTo("scene")`、后 `initiation("脚本1.txt")`
 * —— 跟 `game/useGame.ts` 里的顺序一模一样，没有差别要抹。
 *
 * 这份文件存在，是因为**这个结论本身要能被别人复核**。它原先只是一句写在
 * `useGame.ts` 注释里的话，而这个仓库反复栽在同一件事上：注释与判据长得
 * 一样，转抄进来的枚举与自己量过的枚举也长得一样（见
 * `docs/agents/dispatch.md`）。票面那句就是这么来的。
 *
 * 顺带钉住第三件事：这两句都在 `if (loadTimer.stop())` 里面 —— 点「起」
 * 之后原版**先在标题这一屏上放一段载入动画**（`LOAD_TICKS` = 30 拍，见
 * `layout.ts`），走完才换面板。那一段这一层也复刻了（`panelState.ts`）。
 * 少了它，"换面板"会提前 30 拍发生，而画面上只是"快了一点"。
 *
 * ## 零匹配就是这类检查的失败态，所以每个界标都单独断言一次
 *
 * `javaSource` 按 GBK 解码（不按 GBK 读出来中文全是乱码，而乱码与"源码里
 * 没有这一行"在 `indexOf` 下都是 `-1`）。下面每个界标都先断言 `>= 0` 再
 * 比先后：直接比两个 `-1` 的大小是一条**恒真**的检查，而它跟真的通过长得
 * 一模一样。
 */
describe('原版点「起」：先换面板，后读盘（xl-w16）', () => {
  /** `startLoadAction()` 里 `case 0:` 那一段（到 `case 1:` 为止）。 */
  function newGameCase(): string {
    const source = javaSource('src/start/StartPanel.java')
    const methodAt = source.indexOf('private void startLoadAction()')
    expect(methodAt).toBeGreaterThanOrEqual(0)
    const method = source.slice(methodAt)
    const caseAt = method.indexOf('case 0:')
    const nextAt = method.indexOf('case 1:')
    expect(caseAt).toBeGreaterThanOrEqual(0)
    expect(nextAt).toBeGreaterThan(caseAt)
    return method.slice(caseAt, nextAt)
  }

  it('`switchTo("scene")` 在 `initiation("脚本1.txt")` 之前，两句都在 `loadTimer.stop()` 里', () => {
    const case0 = newGameCase()
    const timer = case0.indexOf('loadTimer.stop()')
    const switchTo = case0.indexOf('GameLauncher.switchTo("scene")')
    const initiation = case0.indexOf('initiation("脚本1.txt")')

    // 三个界标各自都要真的找到 —— 少了这三句，下面那两个不等式在全 `-1`
    // 的情况下依然成立（`-1 < -1` 为假，但 `-1 <= -1` 之类的写法会放行，
    // 而"界标写错了"与"顺序对"本就该分得开）。
    expect(timer).toBeGreaterThanOrEqual(0)
    expect(switchTo).toBeGreaterThanOrEqual(0)
    expect(initiation).toBeGreaterThanOrEqual(0)

    expect(timer).toBeLessThan(switchTo)
    expect(switchTo).toBeLessThan(initiation)
  })

  /**
   * 那句 `switchTo("scene")` 只出现一次。
   *
   * 出现两次的话上面那个 `indexOf` 量的是哪一次就说不清了 —— 而"量错了
   * 一处"与"顺序真的对"在那条断言下长得一样。
   */
  it('case 0 里 `switchTo` 只有一处', () => {
    const hits = newGameCase().match(/GameLauncher\.switchTo\(/g) ?? []
    expect(hits).toHaveLength(1)
  })
})
