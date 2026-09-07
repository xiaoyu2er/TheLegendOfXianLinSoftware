import { describe, expect, it } from 'vitest'
import { UnknownDriverError, pickAssembly } from './drivers'
import { TRACE_NAMES, readTrace } from '../state/trace'

/**
 * 判别名派发的判据（xl-1vu.2）。这里验的**只有一件事**：未实现的驱动器要
 * 响亮失败并点名，不能被当成"没有可比的帧"悄悄放过。
 *
 * 装配表是假的（三个字符串），因为真的那张表在 `replay/main.ts` 里，
 * 而那个模块要 Pixi 与 DOM。派发规则本身与装配的内容无关。
 */
describe('pickAssembly', () => {
  const table = { scene: '场景装配', battle: '战斗装配' } as const

  it('认识的驱动器 → 取到对应那一套', () => {
    expect(pickAssembly('scene', table, 'dorm-walk')).toBe('场景装配')
    expect(pickAssembly('battle', table, 'x')).toBe('战斗装配')
  })

  it('未实现的驱动器 → 抛，并点名是哪个、本页有哪些', () => {
    expect(() => pickAssembly('shop', table, 'dorm-walk')).toThrow(UnknownDriverError)
    try {
      pickAssembly('shop', table, 'dorm-walk')
      expect.unreachable('未实现的驱动器居然装配成功了')
    } catch (e) {
      const err = e as UnknownDriverError
      expect(err.driver).toBe('shop')
      // 点名：错误里必须同时有那个驱动器与出错的剧本，否则人只知道"炸了"。
      expect(err.message).toContain('shop')
      expect(err.message).toContain('dorm-walk')
      // "本页实现了哪些"是从表里现数的，不是抄的名单。
      expect(err.implemented).toEqual(['battle', 'scene'])
    }
  })

  it('判别名缺失 / 不是字符串 / 空串 → 一律抛，不许默认成 scene', () => {
    // 老真值根本没有这个字段。默认成 scene 等于把一份来路不明的真值
    // 当场景真值回放 —— 那种失败长得和成功一模一样。
    for (const bad of [undefined, null, '', 42, {}]) {
      expect(() => pickAssembly(bad, table, 'dorm-walk')).toThrow(UnknownDriverError)
    }
  })

  it('空装配表 → 任何驱动器都装不出来（"没实现"不是"通过"）', () => {
    expect(() => pickAssembly('scene', {}, 'dorm-walk')).toThrow(UnknownDriverError)
  })
})

describe('入库真值都自报了驱动器', () => {
  // 分母是 TRACE_NAMES 本身（从 tools/traces/out/ 现数）：将来加了真值而没有
  // 判别名，这里立刻少一条、立刻红。
  it.each(TRACE_NAMES)('%s 的 driver 是取图页装得起来的形状', (name) => {
    expect(readTrace(name).driver).toMatch(/^[a-z][a-z0-9-]*$/)
  })

  it('至少有一份真值', () => {
    expect(TRACE_NAMES.length).toBeGreaterThan(0)
  })
})
