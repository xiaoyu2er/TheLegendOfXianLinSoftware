import { describe, expect, it } from 'vitest'
import { SCENE_TRACE_NAMES, TRACE_NAMES, parseTrace, readTrace } from './trace'

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

describe('按驱动器分组的真值名单', () => {
  // SCENE_TRACE_NAMES 是下面一大批"按场景形状写"的用例的分母。它要是空了，
  // 那些用例会**一条都不跑而全绿** —— 又一次"没找到东西"当成了通过。
  it('场景真值不止一份', () => {
    expect(SCENE_TRACE_NAMES.length).toBeGreaterThan(0)
  })

  it('掉出场景名单的那几份，driver 确实不是 scene', () => {
    // 反过来钉一遍：筛子筛掉的必须是真的非场景真值，而不是某份场景真值
    // 因为头里少写了判别名而被顺手漏掉。
    const dropped = TRACE_NAMES.filter((n) => !SCENE_TRACE_NAMES.includes(n))
    for (const name of dropped) expect(readTrace(name).driver).not.toBe('scene')
  })
})
