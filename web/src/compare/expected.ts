import { readdirSync } from 'node:fs'
import { repoPath } from '../test/repoPath'

/**
 * 每条剧本在**当前这个移植进度下**应该是什么结果。
 *
 * 为什么需要这张表：Web 版还没做对话框、素材重编码还差一层，跨端比对现在
 * 必然红。
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
    // 地图底图已逐像素对齐（xl-9bd.16），NPC 已实现并逐 tick 对齐（xl-9bd.9）。
    // 剩下的偏离全部是原版画了、这边还没画的东西。
    why: '宿舍的宝箱 + 走到萧逸才跟前的对话框',
    issue: 'xl-yg6.1 / xl-9bd.10',
  },
  'bigmap-walk': {
    status: 'gap',
    // 大地图这条剩下的是**素材重编码**，不是渲染：大地图.jpg 烘成 q80 的有损
    // WebP，把烘焙产物解回来按同一个采样公式取，与原版第 0 帧就已经差 37.22%。
    why: '大地图.jpg → 有损 WebP 的重编码差异',
    issue: 'xl-9bd.14',
  },
  'dorm-intro': {
    status: 'gap',
    // 旁白的状态机与背景动画已经逐 tick 对齐（xl-9bd.11）。实测
    // （`tools/compare-frames.sh dorm-intro --every 50`，容差 8）：
    //
    //   - 第 0 帧（旁白已起、还没有字）**只差 15 个像素**，全在第 599 行，
    //     最大通道差 41 —— 那是 639×395 拉满 1024×640 时最近邻的取整边界，
    //     两端各按各的规则舍入。占比 0.0023%，在 0.02% 的判定阈值之内。
    //   - 有字的帧，**差异行整齐地落在每一行字上**，别处一个像素都不差：
    //     t=400 差的是 43-64 / 83-104 / 123-143 这三段（外加那条 599），
    //     t=800 是同样宽度的六段（43 起、每 40 行一段）—— 六段对六句、
    //     间距正好是原版那个两倍字号的行距。偏离随字数长：t=50 0.41%、
    //     t=400 2.87%、t=800 5.54%。
    //
    //     这同时是"旁白期间别的什么都不画"这条的证据：地图、主角、NPC 只要
    //     有一个漏画或多画，差异行就不会只有这几段。
    //
    // 所以剩下的两处偏离是：
    //   1. 字形。原版的 `文鼎粗钢笔行楷` 没有随游戏交付，两边各自退到自己的
    //      后备字体，同样的基线坐标画出来的笔画不同（xl-9bd.17）；
    //   2. 第 810 个 tick 之后整段主线对话框还没画（xl-9bd.10），
    //      最差帧 t=1800 偏离 15.54%，包围盒正是对话框那块。
    why: '旁白文字的字形（原版字体未交付）+ 主线对话框',
    issue: 'xl-9bd.10 / xl-9bd.17',
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
