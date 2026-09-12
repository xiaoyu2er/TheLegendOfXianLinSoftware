import { describe, expect, it } from 'vitest'
import { createBufferPlan } from './bufferPlan'

/**
 * 持久缓冲那两件事的合同（xl-84z 一拍只合成一次、xl-pgq 跨场复用）。
 *
 * 渲染器本身没有测试缝（见 `battleRenderer.ts` 文件头），「这一拍清不清、合不合」
 * 却是纯逻辑，而且错了的样子与对了一模一样 —— 多清一次只是第二场头两帧的边暗一点。
 */
describe('bufferPlan', () => {
  it('新建的缓冲：头一次合成先清成全透明（TYPE_INT_ARGB 的初值）', () => {
    const plan = createBufferPlan()
    expect(plan.next(0)).toBe('clear')
    expect(plan.next(1)).toBe('over')
  })

  it('同一拍再调不合成（原版一拍只 paint 一次）', () => {
    const plan = createBufferPlan()
    expect(plan.next(5)).toBe('clear')
    expect(plan.next(5)).toBe('skip')
    expect(plan.next(6)).toBe('over')
    expect(plan.next(6)).toBe('skip')
  })

  it("'keep'：新的一场接着上一场的缓冲合成，不清（原版一个进程只有一块 BattlePanel）", () => {
    const plan = createBufferPlan()
    plan.next(0)
    plan.next(1)
    plan.load('keep')
    expect(plan.next(0)).toBe('over')
  })

  it("'fresh'：新的一场从全透明起步（导出器每份剧本新建一块面板）", () => {
    const plan = createBufferPlan()
    plan.next(0)
    plan.next(1)
    plan.load('fresh')
    expect(plan.next(0)).toBe('clear')
    expect(plan.next(1)).toBe('over')
  })

  it('换场之后拍号撞上上一场的末拍，照样合成 —— 拍号只在一场之内去重', () => {
    for (const mode of ['keep', 'fresh'] as const) {
      const plan = createBufferPlan()
      plan.next(7)
      plan.load(mode)
      expect(plan.next(7)).toBe(mode === 'keep' ? 'over' : 'clear')
    }
  })

  it("还没画过就 'keep'：缓冲本来就是新的，头一次照样清", () => {
    const plan = createBufferPlan()
    plan.load('keep')
    expect(plan.next(0)).toBe('clear')
  })
})
