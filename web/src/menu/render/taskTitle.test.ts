import { describe, expect, it } from 'vitest'
import { replayMenuTask } from '../replay'
import { stepMenu } from '../step'
import { MENU_TRACE_NAMES, readMenuTrace, replayMenu } from '../trace'
import { menuDrawList } from './drawList'

/**
 * 顶栏「当前任务:」那一行字，逐步对齐菜单真值的 `task` 列（xl-03x.10）。
 *
 * 为什么不交给跨端逐帧比对：那一行是 `文鼎粗钢笔行楷` 25 号，原版字体没交付，
 * 逐帧比对里它是一块只核像素个数上界的缺口区 —— 字换了一个，差异像素数多半还在
 * 上界里。能红在「错一个字」上的只有这里：字符串对字符串。
 *
 * 喂进 `menuDrawList` 的任务值走的是取图页那一条（`replayMenuTask`，照剧本回显的
 * `setup.scene` 推），期望值是原版 `Reader.task` 自己的读数 —— 两边不同源。
 */
function topBar(ops: ReturnType<typeof menuDrawList>): string {
  const bar = ops.filter((op) => op.kind === 'text' && op.layer === 'command')
  // 恰好一行：零行时下面那句比的是 undefined，多行时比的是哪一行说不准。
  expect(bar).toHaveLength(1)
  return (bar[0] as { text: string }).text
}

describe('菜单顶栏「当前任务:」对齐真值 task 列', () => {
  for (const name of MENU_TRACE_NAMES) {
    it(`${name}：每一步顶栏那行字 = 「当前任务:」+ (Reader.task ?? 「无」)`, () => {
      const trace = readMenuTrace(name)
      const world = replayMenu(trace)
      const task = replayMenuTask(trace.script.setup)
      for (const tick of trace.ticks) {
        stepMenu(world, tick.input)
        // `task` 列缺席（导出器没记）与记了 null 必须分开：前者是真值旧了，不是「无」。
        expect(tick, `${name} 第 ${tick.t} 步没有 task 列 —— 重导菜单真值`).toHaveProperty('task')
        const want = tick['task'] as string | null
        expect({ t: tick.t, text: topBar(menuDrawList(world, task)) }).toEqual({
          t: tick.t,
          text: `当前任务:${want ?? '无'}`,
        })
      }
    })
  }

  it('至少一条真值走到 if 那一支（task 非 null）—— 否则上面全是「无」对「无」', () => {
    // 分母是磁盘上的真值；这条守的是「非 null 那一支有人盖到」。只剩五条老剧本时
    // 上面的逐步用例照样全绿，而绿的全是「当前任务:无」对「当前任务:无」。
    const covering = MENU_TRACE_NAMES.filter((name) =>
      readMenuTrace(name).ticks.some((tick) => tick['task'] !== null && tick['task'] !== undefined),
    )
    expect(covering).not.toEqual([])
  })
})
