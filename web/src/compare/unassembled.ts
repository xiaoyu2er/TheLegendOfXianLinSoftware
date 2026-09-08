import { IMPLEMENTED_DRIVERS, isImplementedDriver } from '../replay/implemented'
import { expectationOf } from './expected'
import type { Expectation } from './expected'

/**
 * 「这条剧本的 web 侧到底做没做」这件事的**唯一裁决处**（xl-1vu.7）。
 *
 * 四种驱动器的真值现在都齐了（场景 / 战斗 / 菜单 / 商店），而 web 侧还没接满
 * 四支 —— **接了哪几支看下面那份 `IMPLEMENTED_DRIVERS`，这里不抄第二份**
 * （原先这句写死成「只有场景那一套」，M2 把战斗接上之后它就错了；xl-rh9.16 改）。
 * 没接上的那几支在跨端比对里必须**响亮**地失败：一条没被装配的剧本比出来是
 * 「零帧差异」，跟「两端完全一致」长得一模一样，那是这条流水线最不能有的东西。
 *
 * 裁决靠**两份互不抄袭的记录**对撞：
 *
 * - `replay/implemented.ts` 的名单 —— 取图页**能**装配哪些（由 `main.ts` 的
 *   装配表用类型钉住，运行时还挂在 `window.__xlDrivers` 上供比对器核对）；
 * - `compare/expected.ts` 的表态 —— 每条剧本**声称**自己现在是什么处境。
 *
 * 两份对不上，**两个方向都是硬失败**：
 *
 * - 页面装不出来、表却说 `match`/`gap` → 那笔账是编的，一帧都没比过；
 * - 页面已经装得出来、表还写 `unassembled` → 面板做好了而表没改，这条剧本会
 *   一直挂在「比不了」上，永远没人回来量它。
 *
 * 只有一方说了算的话，这两种错都表现为「安安静静地少比一条剧本」。
 */

export interface DriverStanding {
  readonly script: string
  /** 真值头里的判别名（`TraceDriver.kind()` 写的那个）。 */
  readonly driver: string
  /** 取图页装得出这个**驱动器**吗。 */
  readonly implemented: boolean
  /**
   * 这一轮到底比不比得成。
   *
   * 与 `implemented` 分成两个字段，是因为「比不成」有**两种**（xl-rh9.11）：
   * 驱动器整个装不出来（`unassembled`），或者驱动器装得出、可这条剧本会走进
   * 一层还没实现的绘制（`unpainted` —— `battleDrawList` 当场抛）。两种在报告
   * 里都得响亮地点名，但归的票不是一张，指的东西也不是一件。
   */
  readonly comparable: boolean
  readonly expectation: Expectation
}

const KIND = /^[a-z][a-z0-9-]*$/

/**
 * 核一条剧本的处境。**不一致就抛** —— 返回一个「说不清」的值，调用方多半会
 * 把它当成「没问题」。
 *
 * @param script 剧本名（`expected.ts` 的键）。
 * @param driver 这一次真的读到的判别名。传的必须是**从真值/帧清单里读出来的
 *   那个**，不是照剧本猜的：判别名是导出侧写的，比对侧只能读。
 */
export function checkStanding(script: string, driver: string): DriverStanding {
  if (!KIND.test(driver)) {
    throw new Error(
      `${script} 的驱动器判别名是 ${JSON.stringify(driver)}，不是 [a-z][a-z0-9-]* 的形状。` +
        `真值头里的 driver 由导出侧的 TraceDriver.kind() 写入 —— 重导一遍。`,
    )
  }
  const expectation = expectationOf(script)
  const implemented = isImplementedDriver(driver)
  const pageHas = `取图页实现了：${[...IMPLEMENTED_DRIVERS].sort().join('、')}`

  if (!implemented && expectation.status === 'unpainted') {
    throw new Error(
      `${script} 的表态是 unpainted（驱动器装得出、只是有一层还没画），但取图页` +
        `根本装配不出 driver=${driver}（${pageHas}）。这两件事分得开：` +
        `装不出驱动器写 unassembled。`,
    )
  }
  if (!implemented && expectation.status !== 'unassembled') {
    throw new Error(
      `${script} 的表态是 ${expectation.status}，但取图页装配不出 driver=${driver}（${pageHas}）。` +
        `一帧都没比过的剧本不能声称自己「比过了」—— 把 expected.ts 里这条改成 unassembled，` +
        `或者先把 ${driver} 那一套装配做出来。`,
    )
  }
  if (implemented && expectation.status === 'unassembled') {
    throw new Error(
      `${script} 的表态还写着 unassembled（一帧都比不了），可取图页已经装得出 driver=${driver} 了。` +
        `web 侧的面板做出来之后，这条要么改成 match，要么带上真量出来的 gap —— ` +
        `留着这条表态的话，这条剧本会永远挂在「比不了」上，没人回来量它。`,
    )
  }
  return {
    script,
    driver,
    implemented,
    comparable: implemented && expectation.status !== 'unpainted',
    expectation,
  }
}

/** 报给人看的一行：是哪条剧本、哪个驱动器、为什么比不了、归哪张票。 */
export function unassembledLine(s: DriverStanding): string {
  const e = s.expectation
  return (
    `${s.script.padEnd(15)} driver=${s.driver.padEnd(7)} ` +
    `${e.why ?? '（没写原因）'} · 归 ${e.issue ?? '（没挂票）'}`
  )
}
