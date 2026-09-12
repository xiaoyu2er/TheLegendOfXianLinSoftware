/**
 * 战斗持久缓冲这一拍**清不清、合不合**（xl-84z / xl-pgq）。
 *
 * 从 `battleRenderer.ts` 里拆出来，是因为渲染器没有测试缝，而这两条规矩错了的样子
 * 与对了一模一样：多合成一次，半透明的边叠得快一点；多清一次，第二场头两帧的边
 * 暗一点 —— 都不报错。
 *
 * - **一拍只合成一次**：原版一拍 `paint()` 一次，同一拍再调是 `'skip'`。拍号只在
 *   一场之内去重，换场之后撞上上一场的末拍照样合成。
 * - **只有新缓冲才清**：`TYPE_INT_ARGB` 的初值是全透明，`paint()` 从不清屏。
 *   换场时由调用方表态：`'keep'` 接着上一场的缓冲画（原版一个进程只有一块
 *   `BattlePanel`），`'fresh'` 当成新建了一块（导出器每份剧本一块）。
 */

export type BufferMode = 'keep' | 'fresh'

/** `'clear'`：先清成全透明再合成；`'over'`：直接合成在上一拍上；`'skip'`：不合成。 */
export type BufferStep = 'skip' | 'clear' | 'over'

export interface BufferPlan {
  /** 新的一场。 */
  load(mode: BufferMode): void
  /** 要画第 `tick` 拍了：这一拍该怎么合成。 */
  next(tick: number): BufferStep
}

export function createBufferPlan(): BufferPlan {
  let lastTick: number | null = null
  let blank = true
  return {
    load(mode) {
      lastTick = null
      if (mode === 'fresh') blank = true
    },
    next(tick) {
      if (tick === lastTick) return 'skip'
      lastTick = tick
      const step = blank ? 'clear' : 'over'
      blank = false
      return step
    },
  }
}
