import { describe, expect, it } from 'vitest'
import { createStubContext } from '../test/canvasStub'
import { drawPlaceholder } from './drawPlaceholder'
import { STAGE_HEIGHT, STAGE_WIDTH } from './constants'

describe('drawPlaceholder', () => {
  it('整段绘制跑得通，并且先清空整块逻辑画布', () => {
    const ctx = createStubContext()
    drawPlaceholder(ctx)

    expect(ctx.calls[0]).toEqual({
      method: 'clearRect',
      args: [0, 0, STAGE_WIDTH, STAGE_HEIGHT],
    })
    expect(ctx.calls.length).toBeGreaterThan(10)
  })

  it('所有绘制坐标都落在 1024×640 之内', () => {
    const ctx = createStubContext()
    drawPlaceholder(ctx)

    const outOfBounds = ctx.calls.filter(({ method, args }) => {
      if (method !== 'fillRect' && method !== 'strokeRect') return false
      const [x, y, w, h] = args as number[]
      return x! < 0 || y! < 0 || x! + w! > STAGE_WIDTH || y! + h! > STAGE_HEIGHT
    })
    expect(outOfBounds).toEqual([])
  })
})
