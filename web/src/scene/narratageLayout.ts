/**
 * 旁白的摆位，从 `scene/Narratage.java` 的 `drawNarratage` / `init` 里搬出来。
 *
 * **纯函数**，出参是逻辑画布（1024×640）上的基线坐标。抽出来的理由与
 * `ui/dialogueLayout.ts` 同一条：那几个常量（左边距 50、字号 20、第 `i` 行的
 * 基线 `fontSize * (3 + 2i)`）是**可以对着原版逐个核**的，混进渲染器就只能靠
 * 眼睛看。
 *
 * ## 为什么要逐字摆，而不是 `fillText(整行)`（xl-9bd.18）
 *
 * 原版画的是一句 `g.drawString(bufferedText[i], 50, top)` —— 一次调用画一整行。
 * 照抄成 `ctx.fillText(line, 50, y)` 看起来最忠实，实际不是：Java2D 与浏览器
 * 对**同一个字给的步进不一样**，一行 40 多个字累积下来就是十几个像素。
 *
 * 实测（openjdk 17，`new Font("文鼎粗钢笔行楷", Font.BOLD, 20)` 在基准机上落到
 * 逻辑字体 `Dialog`，见 `src/textFont.ts`）：把 `tools/ground-truth/*.json` 里
 * 全部 29 行旁白用到的 **190 个不同字符**逐个过 `FontMetrics.charWidth`，
 *
 * - **188 个恰好是 20**（= 字号），全角标点（`，` `。`）也在内；
 * - 只有半角 `,`（1 处）与 `.`（35 处）是 5。
 *
 * 而浏览器给中文的步进不是整 20：xl-9bd.17 在 dorm-intro t=800 上量到第一行
 * 19 个字 java 的墨迹到 x=426、web 到 x=433，第二行 43 个字 java 到 908、
 * web 到 924 —— 每字约 0.37 px 的累积。
 *
 * 所以这里的规则是：**全角字按整 20 px 走格，其余字按浏览器自己量的步进走**。
 * 半角的那两个字符（都是句末或句中的省略点）没有一个"整数格宽"可抄，它们的
 * 步进在两端各自的字体里本来就不同，那是字形那笔账（`src/textFont.ts`），
 * 不是这里能消的。
 *
 * 这消掉的是**横向漂移**，不是字形差：浏览器的粗体比 Java2D 重（同一行亮度
 * > 220 的像素 java 2508 / web 3017），笔画边缘的差另有交代。
 */
import { scaledBlitPasses } from '../battle/render/scaledBlit'
import type { ScaledBlitPasses } from '../battle/render/scaledBlit'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/constants'

/**
 * 背景图的源矩形。原版 `drawNarratage` 那一句（GBK 现读）：
 *
 *     g.drawImage(backImages1.get(index), 0, 0, 1024, 640, 0, 0, 639, 395, scene);
 *
 * 源 (0,0)-(639,395) 恰好是整张图（52 张 PNG 全是 639×395、RGB 无 alpha，
 * `ExportScaledBlit` 逐张核），拉满目标 (0,0)-(1024,640)。
 */
export const BG_SRC_WIDTH = 639
export const BG_SRC_HEIGHT = 395

/**
 * **背景图拉满画布要搬哪些矩形**（xl-03x.15）。
 *
 * 不交给 GPU 采样。原先是 `Sprite.setSize(1024, 640)`，差异只在第 599 行、
 * 横贯整行（xl-t0h / xl-yg6.12 实测 dorm-intro 36 帧，单帧最多 264 个像素）。
 * 追下去是这样：
 *
 * - 原版那条循环（源图全不透明，走 Java2D 的不透明 blit）在这一对长度上**量**出来
 *   的采样表，与理想最近邻 `floor((i + 0.5) * 源长 / 目标长)` 两条轴**逐个相同**，
 *   与 `opaqueSourceIndexes` 的 23 位定点模型也逐个相同（黄金数据的 `narratage`
 *   一节，由原版那句 `drawImage` 真画一遍梯度图读回；52 张真图画出来的像素与
 *   两张表的外积逐个相同）。
 * - 所以原版的取整没有任何特别之处，偏的是 GPU 那一侧。第 599 行的精确落点是
 *   `599.5 * 395 / 640 = 370 + 1/256`，离纹素边界只有 1/256；⚠️ **但这不是
 *   一个成立的解释**：87 / 215 / 343 / 471 这四行离边界同样恰好 1/256，却一个
 *   像素都没差。GPU 为什么偏在这一行，**没查清，未验证**。
 *
 * 解法不押在那个「为什么」上：与 xl-ttu（提示图）同一个做法，CPU 按采样表拼好
 * 一张 1024×640 的位图，再 1:1 贴上去 —— 这样哪一行取哪一行由表说了算，与 GPU
 * 的实现无关。几何在这里算、能进 `pnpm test`，渲染器只负责把矩形交给 `drawImage`。
 */
export function narratageBgPasses(): ScaledBlitPasses {
  return scaledBlitPasses(
    { x: 0, y: 0, width: BG_SRC_WIDTH, height: BG_SRC_HEIGHT },
    { width: STAGE_WIDTH, height: STAGE_HEIGHT },
    'opaque',
  )
}

/** 正文字号。原版 `Narratage.init` 的 `fontSize = 20`。 */
export const FONT_SIZE = 20

/** 左边距。原版 `g.drawString(bufferedText[i], 50, top)` 的那个 50。 */
export const TEXT_LEFT = 50

/** 一个全角字符格的横向步进。原版 `FontMetrics` 给中文的步进就是字号本身。 */
export const CELL_WIDTH = FONT_SIZE

/**
 * 第 `row` 行的**基线** y。原版：
 * `new Double((double) fontSize * (3.0D + 2.0D * (double) i)).intValue()`
 * —— 60 / 100 / 140 …，行距正好两倍字号。
 */
export function baselineY(row: number): number {
  return FONT_SIZE * (3 + 2 * row)
}

/**
 * 这个码位在 Java2D 里是不是"一格 = 一个字号"的全角字。
 *
 * 取的是 Unicode 里 East Asian Wide / Fullwidth 的那几段。**可核的证据只有
 * 上面那 190 个字符**（`narratageLayout.test.ts` 拿磁盘上的真值逐个断言）；
 * 段的边界是照 Unicode 的分区写的，不是量出来的。
 */
export function isFullWidth(char: string): boolean {
  const c = char.codePointAt(0)
  if (c === undefined) return false
  return (
    (c >= 0x1100 && c <= 0x115f) || // 谚文字母
    (c >= 0x2e80 && c <= 0x303e) || // CJK 部首 / 康熙部首 / CJK 符号与标点
    (c >= 0x3041 && c <= 0x33ff) || // 假名 / 谚文兼容 / 注音 / CJK 兼容
    (c >= 0x3400 && c <= 0x4dbf) || // 扩展 A
    (c >= 0x4e00 && c <= 0x9fff) || // 基本区
    (c >= 0xa000 && c <= 0xa4cf) || // 彝文
    (c >= 0xac00 && c <= 0xd7a3) || // 谚文音节
    (c >= 0xf900 && c <= 0xfaff) || // 兼容汉字
    (c >= 0xfe30 && c <= 0xfe6f) || // CJK 兼容形式 / 小写变体
    (c >= 0xff00 && c <= 0xff60) || // 全角形式
    (c >= 0xffe0 && c <= 0xffe6) || // 全角符号
    (c >= 0x20000 && c <= 0x2fa1f) // 扩展 B 及以后
  )
}

/** 一个字符格。`x` 是这个字左边缘（`fillText` 的原点）在画布上的横坐标。 */
export interface Cell {
  readonly char: string
  readonly x: number
}

/**
 * 把一行旁白铺成一串字符格。
 *
 * `measure` 只在**非全角字**上调用 —— 全角字走的是整 20 px 的格子，量它就是
 * 把漂移放回来。`narratageLayout.test.ts` 直接断言这一点：给一行纯中文时
 * `measure` 一次都不许被调到。
 */
export function layoutLine(
  line: string,
  measure: (char: string) => number,
  left: number = TEXT_LEFT,
): Cell[] {
  const cells: Cell[] = []
  let x = left
  for (const char of line) {
    cells.push({ char, x })
    x += isFullWidth(char) ? CELL_WIDTH : measure(char)
  }
  return cells
}
