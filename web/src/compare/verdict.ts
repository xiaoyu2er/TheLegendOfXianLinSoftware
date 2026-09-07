import type { SequenceResult } from './diff'
import type { Expectation } from './expected'

/**
 * 整屏表态的判定（xl-l3o）。分区表态那一半在 `regions.ts`。
 *
 * 这段逻辑原先摊在 `scripts/compare.ts` 的两串三元表达式里，跑不起来就看不见 ——
 * 而它恰恰是整条流水线唯一的判据。搬到这里之后 `verdict.test.ts` 在 CI 里跑，
 * 不需要 Java、不需要 Chrome。
 *
 * **为什么 gap 必须带上界。** 原来的通过条件只有一句"有偏离帧"，不看偏了多少，
 * 于是渲染整个崩掉也照样绿。实测（2026-09-06）：把基准侧 `snapshotImage()` 换成
 * 一张全黑的 1024×640，`dorm-walk` 的最差帧从 0.7401% 跳到 99.9565%，
 * `tools/compare-frames.sh` 退出 0、报"1/1 条剧本符合预期"。
 *
 * 这正是本仓库那条"失败的样子和成功一模一样"：gap 的通过条件是**找到了偏离**，
 * 而灾难性的错误同样能提供偏离。
 *
 * **上界为什么是"每帧"而不是"所有帧之和"。** 采样密度由 `--every` 决定，帧数
 * 一变，和值跟着变，一张按 `--every 25` 量出来的和值表在 `--every 100` 下就是
 * 错的 —— 而且是往松了错。单帧的量与采样密度无关：多采几帧只可能采到更差的帧，
 * 采不到更好的。所以这里判的是 `sequence.worst.ratio`，也就是"每一帧都必须
 * 在上界之内"。
 */
export interface WholeVerdict {
  readonly ok: boolean
  /** 一行结论，给报告用。 */
  readonly verdict: string
}

export function judgeWhole(sequence: SequenceResult, e: Expectation): WholeVerdict {
  const diverged = sequence.firstDivergent !== null
  if (e.status === 'match') {
    return {
      ok: !diverged,
      verdict: diverged ? `回归：第 ${sequence.firstDivergent} 帧起偏离` : '一致',
    }
  }
  if (e.maxRatio === undefined) {
    throw new Error(
      `gap 表态没有幅度上界（maxRatio）。只有"有偏离帧"这一个通过条件的话，` +
        `整屏全黑也会判通过 —— 实测过。跑一遍比对，把报告里的最差帧占比加上` +
        `注释里说明的余量填进 expected.ts。`,
    )
  }
  const worst = sequence.worst
  if (!diverged) {
    return {
      ok: false,
      verdict: `缺口没了 —— ${e.why}，把 expected.ts 里这条改成 match`,
    }
  }
  if (worst.ratio > e.maxRatio) {
    return {
      ok: false,
      verdict:
        `差得比声明的多：第 ${worst.tick} 帧 ${pct(worst.ratio)} > 上界 ${pct(e.maxRatio)}` +
        `（${(worst.ratio / e.maxRatio).toFixed(2)} 倍）` +
        `${worst.box ? ` @ (${worst.box.x0},${worst.box.y0})-(${worst.box.x1},${worst.box.y1})` : ''}。` +
        `已知缺口是一笔说得清的账（${e.why}），差成这样就不是那笔账了。`,
    }
  }
  return {
    ok: true,
    verdict:
      `已知缺口（${e.why}），第 ${sequence.firstDivergent} 帧起偏离；` +
      `最差 #${worst.tick} ${pct(worst.ratio)} ≤ 上界 ${pct(e.maxRatio)}`,
  }
}

function pct(x: number): string {
  return `${(x * 100).toFixed(4)}%`
}
