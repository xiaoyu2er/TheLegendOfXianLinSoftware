import { describe, expect, it } from 'vitest'
import { replayShopSetup, shopInputsOfTicks } from './replay'
import type { ShopReplayTick, ShopScriptStep } from './replay'

const STEPS: readonly ShopScriptStep[] = [
  { op: 'open', name: 'drug' },
  { op: 'hover' },
  { op: 'open', name: 'equipment' },
]

const TICKS: readonly ShopReplayTick[] = [
  { ip: 0, input: [] },
  { ip: 1, input: [{ e: 'move', x: 600, y: 190 }] },
  { ip: 2, input: [] },
]

describe('从真值还原喂给状态层的输入', () => {
  it('空输入的那一步 = 剧本里的 open，其余原样转手', () => {
    expect(shopInputsOfTicks(STEPS, TICKS)).toEqual([
      [{ e: 'open', shop: 'drug' }],
      [{ e: 'move', x: 600, y: 190 }],
      [{ e: 'open', shop: 'equipment' }],
    ])
  })

  it('⚠️ 空输入却不是 open —— 抛，不许当成一次换店悄悄吞掉', () => {
    // 那意味着导出器有一条指令一个事件都没派发出去，而"少了一个事件"与
    // "这一步本来就没有输入"长得一模一样。
    expect(() =>
      shopInputsOfTicks([{ op: 'hover' }], [{ ip: 0, input: [] }]),
    ).toThrow(/它对应的剧本指令是 hover 不是 open/)
  })

  it('⚠️ 反方向：是 open 却带着输入事件 —— 也抛', () => {
    expect(() =>
      shopInputsOfTicks(
        [{ op: 'open', name: 'drug' }],
        [{ ip: 0, input: [{ e: 'move', x: 1, y: 2 }] }],
      ),
    ).toThrow(/却带了 1 个输入事件/)
  })

  it('ip 指到剧本外面 —— 抛', () => {
    expect(() => shopInputsOfTicks(STEPS, [{ ip: 9, input: [] }])).toThrow(/剧本只有 3 条/)
  })

  it('open 的 name 认不出来 —— 抛，不猜', () => {
    expect(() =>
      shopInputsOfTicks([{ op: 'open', name: 'grocery' }], [{ ip: 0, input: [] }]),
    ).toThrow(/只认 drug \/ equipment/)
  })

  it('replayShopSetup 只挑那五个字段 —— 多写的一个状态字段接不上', () => {
    const w = replayShopSetup({
      party: ['zhang'],
      coins: 4242,
      seed: 7,
      // 这一行是状态，不是剧本回显；它**不该**被转手进世界。
      ...({ active: 'equipment' } as Record<string, unknown>),
    })
    expect(w.coins).toBe(4242)
    expect(w.active).toBe('drug')
  })
})
