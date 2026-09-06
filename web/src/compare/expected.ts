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
    // 地图底图已逐像素对齐（xl-9bd.16），NPC 已实现并逐 tick 对齐（xl-9bd.9），
    // 对话框已实现（xl-9bd.10）。
    //
    // 对话框接进来之后最差帧从 12.73% 降到 1.01%（实测 --every 100），剩下的
    // 那一块**只有正文的字形**：差异图上对话框的边框、名字牌与头像整个是暗的
    // （= 逐像素相同），亮起来的只有字。原因是原版用的 `文鼎粗钢笔行楷` 绝大
    // 多数机器上没有，Java2D 的基线与 DOM 的行盒也不是一回事 —— 这一条不是
    // 待补的功能，是一笔要么换字体、要么接受的账（xl-9bd.17）。
    why: '右下角的金币 HUD + 对话正文的字形（字体不在，基线也不同）',
    issue: 'xl-yg6.1 / xl-9bd.17',
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
    // 旁白（xl-9bd.11）与对话框（xl-9bd.10）都接上之后实测
    // （`tools/compare-frames.sh`，每 25 个 tick 一帧，共 165 帧，容差 8）。
    // 两张票各自的表态都说"欠着对方"，合并之后两边都不欠了，剩下的是这三笔：
    //
    //   1. **字形。** 原版的 `文鼎粗钢笔行楷` 没有随游戏交付，两端各自退到
    //      后备字体，同样的基线坐标画出来的笔画不同（xl-9bd.17）。旁白段偏离
    //      随字数长，最差 t=800 的 5.54%；对话段最差 t=3425 的 3.06%，包围盒
    //      正是对话框那一块。
    //      可核的证据：采样到的 165 帧里**有 8 帧差 0 个像素**（t=1425、1750、
    //      1925、2050、2950、3075、3175、3950），它们全是"对话框已弹出、头像
    //      正在滑入、一个字都还没打"（真值 printing=false、cursor=0）。也就是
    //      对话框的边框、名字牌、头像与滑入动画是逐像素对上的，偏的只有字。
    //   2. **右下角的金币 HUD 还没画**（xl-yg6.1）：没有对话框盖住它的帧固定
    //      偏 527 个像素、0.0804%，包围盒恒为 (925,615)-(993,630)。
    //   3. **旁白背景的缩放取整。** 第 0 帧（旁白已起、还没有字）只差 15 个
    //      像素，全在第 599 行，最大通道差 41 —— 639×395 拉满 1024×640 时最近
    //      邻的取整边界，两端各按各的规则舍入。占比 0.0023%，在判定阈值之内。
    why: '旁白与对话正文的字形（原版字体未交付）+ 右下角的金币 HUD',
    issue: 'xl-9bd.17 / xl-yg6.1',
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
