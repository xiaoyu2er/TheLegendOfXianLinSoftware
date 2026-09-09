import { describe, expect, it } from 'vitest'
import { MENU_TICK_MS, advanceMenu, createMenuTicker } from './loop'
import { snapshotMenu } from './snapshot'
import { createMenuWorld } from './world'
import type { MenuInput } from './step'

const CONFIG = { party: ['zhang'], fullHeal: true }

function drive(chunks: readonly number[], inputs: readonly MenuInput[] = []): unknown {
  let ticker = createMenuTicker(createMenuWorld(CONFIG))
  ticker = advanceMenu(ticker, inputs, chunks[0]!)
  for (const ms of chunks.slice(1)) ticker = advanceMenu(ticker, [], ms)
  return snapshotMenu(ticker.world)
}

describe('菜单那条 100ms 循环', () => {
  it('什么都不点，游标照样往前走 —— 这条缝就是为它存在的', () => {
    const ticker = createMenuTicker(createMenuWorld(CONFIG))
    const before = snapshotMenu(ticker.world)
    advanceMenu(ticker, [], 5 * MENU_TICK_MS)
    const after = snapshotMenu(ticker.world)
    expect(after).not.toEqual(before)
    // 五拍：code 从 0 走到 5，画出来的那张是第 4 张。做成纯事件驱动的话
    // 这两个数会停在 0/0，而画面上只表现为"游标不闪了"。
    expect((after as { mouse: Record<string, { code: number; frame: number }> }).mouse.thingPanel)
      .toEqual({ code: 5, frame: 4, x: 0, y: 0 })
  })

  it('同样的总时长、同样的输入，切成几段喂进来结果都一样', () => {
    const inputs: readonly MenuInput[] = [{ e: 'press', x: 619, y: 62 }, { e: 'release', x: 619, y: 62 }]
    const whole = drive([1000], inputs)
    const split = drive([250, 250, 250, 250], inputs)
    const uneven = drive([37, 963], inputs)
    expect(split).toEqual(whole)
    expect(uneven).toEqual(whole)
  })

  it('凑不够一拍的余量攒着，不丢', () => {
    let ticker = createMenuTicker(createMenuWorld(CONFIG))
    for (let i = 0; i < 10; i++) ticker = advanceMenu(ticker, [], 10)
    // 10 × 10ms = 100ms，恰好一拍。丢余量的写法在这里推 0 拍。
    expect(ticker.world.tick).toBe(1)
  })

  it('时间倒流按 0 处理，不倒着走', () => {
    let ticker = createMenuTicker(createMenuWorld(CONFIG))
    ticker = advanceMenu(ticker, [], -5000)
    expect(ticker.world.tick).toBe(0)
    expect(ticker.carryMs).toBe(0)
  })

  it('输入不等下一拍 —— 点一下当场生效', () => {
    let ticker = createMenuTicker(createMenuWorld(CONFIG))
    ticker = advanceMenu(ticker, [{ e: 'press', x: 619, y: 62 }], 0)
    // 一拍都没走，页已经换了。攒到脉冲上再发的话这里还停在物品页。
    expect(ticker.world.panel).toBe('magicPanel')
    expect(ticker.world.tick).toBe(1)
  })
})
