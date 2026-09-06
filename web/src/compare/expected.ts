import { readdirSync } from 'node:fs'
import { repoPath } from '../test/repoPath'

/**
 * 每条剧本在**当前这个移植进度下**应该是什么结果。
 *
 * 为什么需要这张表：Web 版还没画 NPC、没做旁白与对话框，跨端比对现在必然红。
 * 一条"现在肯定红"的流水线不会有人看，第二天就变成噪声；而把阈值放松到能过，
 * 就变成了这个项目最贵的那种检查 —— 通过条件是"没找到问题"。
 *
 * 所以这里显式声明每条剧本的预期，**两头都会红**（`src/assets/knownMissing.ts`
 * 是同一个套路）：
 *
 * - `match` 的剧本出现偏离帧 → 红，报告指出第一个偏离的帧号；
 * - `gap` 的剧本一帧都不偏了 → **也红**，因为那说明缺口补上了，这张表过期了。
 *
 * 否则"缺口还在"与"表早就该改了"看起来会一模一样。
 */
export interface Expectation {
  readonly status: 'match' | 'gap'
  /** `gap` 必须说清楚差在哪、归哪张票。`match` 不写。 */
  readonly why?: string
  readonly issue?: string
}

export const EXPECTED: Readonly<Record<string, Expectation>> = {
  'dorm-walk': {
    status: 'gap',
    why: '地图拉伸（原版把 1016×632 的源区拉到 1024×640）+ 宿舍的 2 个 NPC',
    issue: 'xl-9bd.16 / xl-9bd.9',
  },
  'bigmap-walk': {
    status: 'gap',
    why: '地图拉伸 + 镜头跟随 + 大地图的 13 个 NPC',
    issue: 'xl-9bd.16 / xl-9bd.7 / xl-9bd.9',
  },
  'dorm-intro': {
    status: 'gap',
    why: '地图拉伸 + 旁白与主线对话框',
    issue: 'xl-9bd.16 / xl-9bd.10 / xl-9bd.11',
  },
}

/**
 * 磁盘上有哪些剧本。**分母从源头数**，不抄一份名单：别人往
 * `tools/traces/scripts/` 里加一条剧本，这里立刻就知道，而它没在 `EXPECTED`
 * 里表态就会红。名单抄两份，迟早对不上。
 */
export function scriptNames(): string[] {
  return readdirSync(repoPath('tools/traces/scripts'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort()
}

export function expectationOf(name: string): Expectation {
  const e = EXPECTED[name]
  if (!e) {
    throw new Error(
      `剧本 ${name} 没有在 src/compare/expected.ts 里表态。` +
        `新剧本必须先说清楚它现在应该全过（match）还是应该差（gap，并写明差在哪、归哪张票）。`,
    )
  }
  return e
}
