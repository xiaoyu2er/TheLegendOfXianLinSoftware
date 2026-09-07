import { describe, expect, it } from 'vitest'
import { TRACE_NAMES, parseTrace, readTrace } from './trace'

/**
 * 真值头的校验（xl-1vu.2）。
 *
 * 拿**篡改过的 JSON** 直接喂 `parseTrace`：校验若只在读磁盘那条路上，
 * "它拦不拦得住"就无从验证 —— 而一个不拦的校验和一个拦得住的，
 * 在全绿的测试报告里长得一模一样。
 */

const good = JSON.stringify({
  format: 'xianlin-trace/1',
  driver: 'scene',
  script: { name: 'x', warmup: null, scene: '宿舍.txt', tickMs: 10, isScript: false },
  tickCount: 0,
  ticks: [],
})

const tamper = (patch: Record<string, unknown>) =>
  JSON.stringify({ ...(JSON.parse(good) as Record<string, unknown>), ...patch })

describe('parseTrace', () => {
  it('完好的真值头读得出来', () => {
    expect(parseTrace(good, 'x.json').driver).toBe('scene')
  })

  it('format 不认识 → 抛', () => {
    expect(() => parseTrace(tamper({ format: 'xianlin-trace/2' }), 'x.json')).toThrow(
      'xianlin-trace/1',
    )
  })

  it('driver 缺失 → 抛（不许有默认值）', () => {
    const noDriver = JSON.parse(good) as Record<string, unknown>
    delete noDriver.driver
    expect(() => parseTrace(JSON.stringify(noDriver), 'x.json')).toThrow('driver')
  })

  it('driver 形状不对 → 抛', () => {
    for (const bad of ['', 'Scene', 'scene panel', 3, null]) {
      expect(() => parseTrace(tamper({ driver: bad }), 'x.json')).toThrow('driver')
    }
  })
})

describe('入库的每一份真值都过得了这道校验', () => {
  // 分母是 TRACE_NAMES（从磁盘现数），不是写死的条数。
  it.each(TRACE_NAMES)('%s', (name) => {
    expect(readTrace(name).driver.length).toBeGreaterThan(0)
  })
})
