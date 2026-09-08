import type { Bitmap } from './png'
import type { Rect } from './regions'

/**
 * **逐像素相等区**（xl-aq0）：矩形不写在表里，**每一帧从行为真值现读**，
 * 区里一个超容差的像素都不许有。
 *
 * ## 它补的是哪个洞
 *
 * xl-ttu 把提示图的缩放从 GPU 的最近邻采样换成原版的定点采样
 * （`battle/render/scaledBlit.ts`，CPU 两趟搬 + 1:1 贴），`battle-menus` 的
 * t=125 那块 80×16 从差 111 个像素变成 **0**。可**把渲染器换回改前那一版，
 * 全套检查一条都不红**：`pnpm test` 全绿（渲染器按设计没有测试缝，见
 * `battleRenderer.ts` 头注与 `docs/adr/0002`），而跨端逐帧比对在这条剧本上
 * 只核整屏的 `maxRatio` —— 111 个像素在 655360 里是 0.017%，离 1.9610% 的
 * 上界远得很。
 *
 * 也就是这个仓库最怕的形状：**一个已经做对的东西被改回去，而所有判据都是
 * 绿的**。守它的只有 `expected.ts` 里的一段注释，而注释不是判据。
 *
 * ## 为什么是这条路
 *
 * 选的是「在跨端比对那一层立硬比区」。三条路都写在票面上（xl-aq0），另外
 * 两条的代价：
 *
 * - **让渲染器把「这一帧走了哪条采样路径」记到某个可读的地方**：等于给
 *   渲染器开一个只为测试存在的出口，而「渲染器不开测试缝」是 M2 定的
 *   （`docs/adr/0002`）；而且它验的是"我调用了自己"，不是"画出来的像素对"。
 * - **把分支判定抽成纯函数再钉住它**：只守得住「判定逻辑对不对」，守不住
 *   「渲染器真的调了它」—— 换回 GPU 采样的那一版照样绿，洞原封不动。
 *
 * 立硬比区守的是**画出来的像素**，跟渲染器内部长什么样无关：哪天有人用另一种
 * 写法把这块画对了，它照样绿；画错了，不管用哪种写法它都红。
 *
 * ## 为什么不能直接用 `regions.ts` 的分区表态
 *
 * 那一套是**整屏切分**：列出来的是缺口区，**其余全是硬比区**。放提示图的那
 * 四条战斗剧本身上还欠着背景动画的有损重编码（xl-7ip），那笔账是**满屏**的，
 * 声明不成几个矩形。所以这里是另一套：**只声明极小的几块「这里必须逐像素
 * 相等」**，屏幕其余部分照旧交给整屏的 `maxRatio`。两套可以同时挂在一条剧本上。
 *
 * ## 矩形为什么必须现读
 *
 * 提示图每拍朝两边张开（`dx1-=5; dx2+=5; dy1-=1; dy2+=1`），一条剧本里走过
 * 十二档尺寸。写死坐标的话，它跟真值一分家就变成「守着一块空地」——而空地上
 * 两端本来就相等，**判据会安安静静地恒真**。现读的是 `reminder.dx1..dy2`，
 * 与 `drawList.ts` 的 `reminderOps` 推目标矩形用的是同一组字段。
 *
 * ## 两个分母
 *
 * 「找不到东西」不许成为通过条件，所以这套判据有两个分母，缺一个就哑：
 *
 * 1. **真值层**（`ExactRegionSpec.drawnTicks`）：整条真值里这一层画着、且矩形
 *    非空的 tick 数。它是**人签的一份登记**，不许现扫——现扫等于让被守的东西
 *    自己给自己签字（纪律 3 那条误用）。它与取帧密度无关，所以能写死一个数：
 *    `--every` 怎么调都不影响它。`expected.test.ts` 拿入库真值现数一遍对撞它，
 *    那条判据在 CI 里跑，不需要 Java 也不需要 Chrome。
 * 2. **本次运行层**：这一趟采样到的帧里**至少有一帧**命中矩形。一帧都没命中
 *    时是硬失败，不是通过 —— 那说明这一趟根本没验到这块，多半是 `--every`
 *    调大了跳过了所有出提示图的拍。
 */

/** 真值里读得出矩形的那几层。现在只有提示图。 */
export type ExactRectSource = 'reminder'

/** 一条剧本上的一块逐像素相等区。 */
export interface ExactRegionSpec {
  readonly name: string
  /** 从真值的哪一层读矩形。 */
  readonly source: ExactRectSource
  /** 这块为什么必须逐像素相等 —— 它守的是哪个已经做对的东西。 */
  readonly why: string
  /** 挂哪张票。 */
  readonly issue: string
  /**
   * **登记**：整条真值里这一层画着且矩形非空的 tick 数。人签的，不许现扫，
   * 理由见文件头「两个分母」。与 `--every` 无关。
   */
  readonly drawnTicks: number
}

/** 真值里一拍**这套判据读得到的那部分**。别的字段一概不看。 */
export interface ExactTraceTick {
  readonly t: number
  readonly reminder?: {
    readonly image: number | null
    /** `Reminder.isStop`。提示图 `show()` 时 `isDraw=true` 与 `isStop=false` 同时置。 */
    readonly stopped: boolean
    readonly dx1: number
    readonly dy1: number
    readonly dx2: number
    readonly dy2: number
  }
}

/**
 * 从真值里现读每一拍的矩形。返回的是 **tick → 闭区间矩形**，只含真的画了的拍。
 *
 * 真值里整层字段都没有时是硬失败：那说明读错了真值或者字段改了名，而「一个
 * 矩形都没提出来」与「这条剧本本来就不出提示图」长得一模一样。
 */
export function exactRectsOf(
  source: ExactRectSource,
  ticks: readonly ExactTraceTick[],
): Map<number, Rect> {
  if (source !== 'reminder') {
    throw new Error(`不认识的矩形来源 ${String(source)} —— 认不出来就抛，不猜`)
  }
  if (!ticks.some((t) => t.reminder !== undefined)) {
    throw new Error(
      '真值里一拍都没有 reminder 这一层 —— 读错了真值，或者这个字段改了名。' +
        '一个矩形都提不出来不算"这条剧本不出提示图"。',
    )
  }
  const out = new Map<number, Rect>()
  for (const tick of ticks) {
    const r = tick.reminder
    if (!r) continue
    // `isStop` 与 `isDraw` 在提示图上是同一件事的两面（`show()` 一起置、
    // `update()` 走到 code==10 一起清），真值只记了前者。
    if (r.stopped || r.image === null) continue
    // `show()` 之后、第一次 `update()` 之前目标是 0 宽，原版什么都不画
    // （渲染器那边也是 `dest.width <= 0` 就跳过）。空矩形不许进来 ——
    // 那会变成一块面积为零、永远相等的"硬比区"。
    if (r.dx2 <= r.dx1 || r.dy2 <= r.dy1) continue
    out.set(tick.t, { x0: r.dx1, y0: r.dy1, x1: r.dx2 - 1, y1: r.dy2 - 1 })
  }
  return out
}

/** 矩形里超容差的像素数。矩形越界是硬失败 —— 那是接错了，不是差异大。 */
export function rectDiffering(a: Bitmap, b: Bitmap, rect: Rect, tolerance: number): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`两端帧的尺寸不同：${a.width}×${a.height} vs ${b.width}×${b.height}`)
  }
  if (rect.x0 < 0 || rect.y0 < 0 || rect.x1 >= a.width || rect.y1 >= a.height) {
    throw new Error(
      `逐像素相等区 (${rect.x0},${rect.y0})-(${rect.x1},${rect.y1}) 越出了 ` +
        `${a.width}×${a.height} 的画面 —— 真值里读出来的矩形落在画布外，先查真值。`,
    )
  }
  let n = 0
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      const i = (y * a.width + x) * 4
      // alpha 不参与，理由同 `frameDiff`。
      const d = Math.max(
        Math.abs(a.rgba[i]! - b.rgba[i]!),
        Math.abs(a.rgba[i + 1]! - b.rgba[i + 1]!),
        Math.abs(a.rgba[i + 2]! - b.rgba[i + 2]!),
      )
      if (d > tolerance) n++
    }
  }
  return n
}

/** 一帧上一块逐像素相等区的账。 */
export interface ExactFrame {
  readonly tick: number
  readonly rect: Rect
  readonly differing: number
}

export interface ExactVerdict {
  readonly name: string
  readonly ok: boolean
  /** 一行结论，给报告用。 */
  readonly verdict: string
  /** 这一趟命中了几帧。 */
  readonly frames: number
  /** 这一趟一共比了多少个像素。 */
  readonly pixels: number
  /** 超容差的像素总数。判通过的条件就是它等于 0。 */
  readonly differing: number
  /** 第一个破了的帧号；没有则 `null`。 */
  readonly firstBreak: number | null
}

/**
 * 判一块逐像素相等区。**通过条件是「一个都没有」**，不是「少于某个数」——
 * 这块本来就该完全相等，给它一个上界等于给回归留位置。
 *
 * `drawnTicks` 是**这一次从真值现数出来**的拍数，拿去对撞表里那份登记。
 */
export function judgeExact(
  spec: ExactRegionSpec,
  drawnTicks: number,
  frames: readonly ExactFrame[],
): ExactVerdict {
  if (drawnTicks !== spec.drawnTicks) {
    throw new Error(
      `逐像素相等区 ${spec.name} 的登记过期了：表里写 ${spec.drawnTicks} 拍，` +
        `真值里现数出 ${drawnTicks} 拍。真值变了就得有人重新签一遍这个数 —— ` +
        `它是这套判据的分母，悄悄跟着真值走的话，"这一层根本没画"也会照样通过。`,
    )
  }
  if (frames.length === 0) {
    throw new Error(
      `逐像素相等区 ${spec.name} 这一趟一帧都没命中（真值里有 ${drawnTicks} 拍画着它）。` +
        `这不算通过 —— 多半是取帧密度太稀，正好跳过了所有画着它的拍；` +
        `用 tools/compare-frames.sh --every 调密一点再跑。`,
    )
  }
  let pixels = 0
  let differing = 0
  let firstBreak: number | null = null
  let worst: ExactFrame | null = null
  for (const f of frames) {
    pixels += (f.rect.x1 - f.rect.x0 + 1) * (f.rect.y1 - f.rect.y0 + 1)
    differing += f.differing
    if (f.differing > 0) {
      if (firstBreak === null) firstBreak = f.tick
      if (worst === null || f.differing > worst.differing) worst = f
    }
  }
  if (differing > 0) {
    const w = worst!
    const area = (w.rect.x1 - w.rect.x0 + 1) * (w.rect.y1 - w.rect.y0 + 1)
    return {
      name: spec.name,
      ok: false,
      verdict:
        `逐像素相等区 ${spec.name} 破了：第 ${firstBreak} 帧起有像素超容差，` +
        `${frames.length} 帧 ${pixels} 个像素里合计 ${differing} 个；最坏的是第 ${w.tick} 帧 ` +
        `${w.differing}/${area} @ (${w.rect.x0},${w.rect.y0})-(${w.rect.x1},${w.rect.y1})。` +
        `这一块声明的是"一个都不许差"（${spec.why}，${spec.issue}）—— 差一个就是回归了。`,
      frames: frames.length,
      pixels,
      differing,
      firstBreak,
    }
  }
  return {
    name: spec.name,
    ok: true,
    verdict: `逐像素相等区 ${spec.name} ${frames.length} 帧 ${pixels} 个像素逐像素相等`,
    frames: frames.length,
    pixels,
    differing,
    firstBreak,
  }
}
