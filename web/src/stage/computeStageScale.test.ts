import { describe, expect, it } from 'vitest'
import { computeStageScale } from './computeStageScale'
import { STAGE_ASPECT, STAGE_HEIGHT, STAGE_WIDTH } from './constants'

const RATIOS: Array<[string, number, number]> = [
  ['原生尺寸', 1024, 640],
  ['更宽（21:9）', 2560, 1080],
  ['更高（竖屏手机）', 390, 844],
  ['更方（4:3）', 1024, 768],
  ['小于逻辑画布', 640, 400],
  ['整数倍', 2048, 1280],
]

describe('computeStageScale', () => {
  it.each(RATIOS)('%s：长宽比恒为 1024:640', (_name, width, height) => {
    const { cssWidth, cssHeight } = computeStageScale({ width, height })
    expect(cssWidth / cssHeight).toBeCloseTo(STAGE_ASPECT, 10)
  })

  it.each(RATIOS)('%s：不溢出视口（不会产生横向滚动）', (_name, width, height) => {
    const { cssWidth, cssHeight } = computeStageScale({ width, height })
    expect(cssWidth).toBeLessThanOrEqual(width + 1e-9)
    expect(cssHeight).toBeLessThanOrEqual(height + 1e-9)
  })

  it.each(RATIOS)('%s：居中，letterbox 两侧等厚且非负', (_name, width, height) => {
    const { barX, barY } = computeStageScale({ width, height })
    expect(barX).toBeGreaterThanOrEqual(0)
    expect(barY).toBeGreaterThanOrEqual(0)
  })

  it.each(RATIOS)('%s：短边贴边（letterbox 只出现在一个方向）', (_name, width, height) => {
    const { barX, barY } = computeStageScale({ width, height })
    expect(Math.min(barX, barY)).toBeCloseTo(0, 10)
  })

  it('原生尺寸时 scale 恰为 1，无边条', () => {
    expect(computeStageScale({ width: STAGE_WIDTH, height: STAGE_HEIGHT })).toEqual({
      scale: 1,
      cssWidth: STAGE_WIDTH,
      cssHeight: STAGE_HEIGHT,
      barX: 0,
      barY: 0,
    })
  })

  it('窗口比逻辑画布小时缩小而不是裁切', () => {
    const { scale, cssWidth } = computeStageScale({ width: 512, height: 640 })
    expect(scale).toBeCloseTo(0.5, 10)
    expect(cssWidth).toBeCloseTo(512, 10)
  })

  it('视口尺寸为 0 或非法时退化为 scale 0，不产出 NaN', () => {
    for (const viewport of [
      { width: 0, height: 0 },
      { width: 1024, height: 0 },
      { width: -1, height: 640 },
      { width: Number.NaN, height: 640 },
    ]) {
      const layout = computeStageScale(viewport)
      expect(layout.scale).toBe(0)
      expect(Number.isNaN(layout.cssWidth)).toBe(false)
    }
  })
})
