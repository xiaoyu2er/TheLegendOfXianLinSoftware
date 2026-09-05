import { describe, expect, it } from 'vitest'
import { DEFAULT_SCALING_MODE, imageRenderingFor } from './scaling'

describe('放大方式', () => {
  it('默认是平滑', () => {
    expect(DEFAULT_SCALING_MODE).toBe('smooth')
  })

  it('两种模式映射到不同的 image-rendering', () => {
    expect(imageRenderingFor('smooth')).toBe('auto')
    expect(imageRenderingFor('sharp')).toBe('pixelated')
  })
})
