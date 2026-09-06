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
    // 地图底图本身已经逐像素对齐（xl-9bd.16）：第 0 帧里原版仍是地图底图的
    // 652306 个像素，Web 侧一个都没取错。剩下的偏离全部是原版画了、这边还没画
    // 的东西 —— 全帧 0.33%，且只落在这三样所在的格子里。
    why: '宿舍的 2 个 NPC + 宝箱 + 走到萧逸才跟前的对话框',
    issue: 'xl-9bd.9 / xl-yg6.1 / xl-9bd.10',
  },
  'bigmap-walk': {
    status: 'gap',
    // 大地图这条剩下的 37% 是**素材重编码**，不是渲染：大地图.jpg 烘成 q80 的
    // 有损 WebP，把烘焙产物解回来按同一个采样公式取，与原版第 0 帧就已经差
    // 37.22%，而两端实测差 37.09%——渲染没有再加进去任何东西。
    why: '大地图.jpg → 有损 WebP 的重编码差异 + 大地图的 13 个 NPC',
    issue: 'xl-9bd.14 / xl-9bd.9',
  },
  'dorm-intro': {
    status: 'gap',
    why: '旁白与主线对话框',
    issue: 'xl-9bd.10 / xl-9bd.11',
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
