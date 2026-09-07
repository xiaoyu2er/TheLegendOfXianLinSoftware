import { describe, expect, it } from 'vitest'
import { SCENE_TRACE_NAMES, TRACE_NAMES, readTrace, traceNamesOf } from './trace'

/**
 * 按驱动器分组的名单（xl-1vu.5）。
 *
 * 为什么值得单独一个文件：`tools/traces/out/` 从菜单真值起是**混着的**，
 * 而这个仓库里一大批测试写的是 `for (const name of …) { 断言场景字段 }`。
 * 那种循环拿到一份空名单时**一条断言都不跑，还是绿的** —— "场景真值一份都
 * 没有"与"全都对上了"长得一模一样。所以分组为空必须是抛，而"它真的会抛"
 * 这件事本身也要有人验。
 */
describe('按驱动器分组的真值名单', () => {
  it('scene 分组是 TRACE_NAMES 的子集，且每一份的 driver 都真的是 scene', () => {
    // 分母是分组自己的长度（从磁盘现数），不是写死的条数。
    expect(SCENE_TRACE_NAMES.length).toBeGreaterThan(0)
    for (const name of SCENE_TRACE_NAMES) {
      expect(TRACE_NAMES).toContain(name)
      expect(readTrace(name).driver).toBe('scene')
    }
  })

  it('菜单真值确实在库里，且没有被算进 scene 分组', () => {
    // 这一条盯的是**真值**：菜单真值哪天没导出来，traceNamesOf 会抛，
    // 而不是让上面那条"scene 分组都对"在一份只有场景真值的库上照样全绿。
    const menu = traceNamesOf('menu')
    expect(menu.length).toBeGreaterThan(0)
    for (const name of menu) expect(SCENE_TRACE_NAMES).not.toContain(name)
  })

  it('每一份真值都恰好归进它自己那个 driver 的分组，一份不多一份不少', () => {
    // 名单不抄：驱动器有哪些，从真值自己报的判别名现数。
    const drivers = [...new Set(TRACE_NAMES.map((name) => readTrace(name).driver))].sort()
    expect(drivers.flatMap((d) => [...traceNamesOf(d)]).sort()).toEqual([...TRACE_NAMES])
  })

  it('分组为空是硬失败，不是返回一个静静全绿的空数组', () => {
    expect(() => traceNamesOf('还没有的驱动器')).toThrow(/没有一份 driver=还没有的驱动器 的真值/)
  })
})
