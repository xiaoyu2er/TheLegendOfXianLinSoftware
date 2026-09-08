/**
 * **Java2D 缩放时的采样规律**（xl-ttu）：目标的第 i 个像素取源的第几个像素。
 *
 * ## 为什么不交给 GPU
 *
 * 战斗里只有 `Reminder`（提示图）那一层是真的在缩放：源恒为 128×24，目标由
 * `Reminder.update()` 每拍朝两边张开。原本这一层是把源矩形交给 Pixi、由 GPU 的
 * 最近邻采样去顶的，两者绝大多数位置一致，**只在纹素边界上打平时分道扬镳** ——
 * xl-rh9.12 实测 `battle-menus` 的 t=125（目标 80×16，k=1.6）那块 1280 个像素里
 * 差 111 个，差异图上是一排周期 5 的竖条，正是 `1.6i+0.8` 落在整数上的那几列。
 *
 * 打平往哪边倒**不是一条能用一次平移凑出来的规则**：带透明那条循环里，方向由
 * 目标长度整体定（提示图高度走过的档位里 Y=2 全部向上、Y=10 全部向下），一个 ε
 * 只能把所有平局往同一边推，两者必错一边；不透明那条更进一步，同一档里两个方向
 * 都有（实测 X=20 是 1 上 3 下）。所以 xl-rh9.12 试过的那两种平移（精灵 +0.5 个
 * 目标像素、源矩形 −0.5·sw/dw 个纹素）都只会更差 —— 那两次实测从 111 涨到 800 以上。
 *
 * 于是这一层**不再靠 GPU 采样**：这里按原版的规律算出「每个目标像素取哪个源
 * 像素」，渲染器照着它在 CPU 上拼出一张目标尺寸的位图，再 1:1 贴上去。顺带
 * 甩掉一个可移植性隐患 —— WebGL 的最近邻在**恰好落在纹素边界**上取哪一个是
 * 实现自定的，也就是说旧写法在别的 GPU 上未必还是这 111 个像素。
 *
 * ## 规律是量出来的，判据是那张表
 *
 * `tools/scaled-blit-golden/java-scaled-blit.json` 是用一张「像素值就是自己的
 * 坐标」的梯度图跑真的 Java2D 扫出来的（源 128×24，目标 1..256 × 1..48，五个
 * 落点各跑一遍且逐个相同；两条轴同时缩放时的整块映射等于两张一维表的外积，
 * 那也是量出来的）。下面这个定点模型在整张表上一处不差，但它是**拟合**出来的，
 * 不是从 OpenJDK 源码里读出来的：
 *
 * ```
 *   inc = (srcLen << 16) / destLen     // 整数除法，截尾
 *   loc = inc / 2                      // 同样截尾
 *   src(i) = (loc + i * inc) >> 16
 * ```
 *
 * ⚠️ **它只对「源图带透明」的那条 blit 循环成立。** 源图全不透明时 Java2D 走的
 * 是另一条，定点设置也不一样（实测是 23 位、半步向上取整）。提示图那 22 张 PNG
 * 全都带透明（导出器逐张核过），所以这里用的是带透明那一份。**这条不是推出来
 * 的，是撞出来的**：头一版拿全不透明的梯度图量，20×4 那一档（`battle-menus`
 * 的 t=200 那一帧）就差两个像素。
 *
 * 两张表具体差在哪几档**不抄在这里** —— 那是黄金数据自己说了算的事，
 * `scaledBlit.test.ts` 的「两条 blit 循环」现推现比；这份测量的来龙去脉在
 * `ExportScaledBlit` 的头注释里，那份是权威。
 *
 * ⚠️ **16 这个位数不是被数据钉死的**：实测 16..31 里**任何一个**配上「半步截尾」
 * 都给出同一张表（表在 16 位上就已经稳定了，再多的位数改不动它）。所以把它改成
 * 23 是**看不出来的**，别把 16 读成一个量出来的常数。真正被钉死的是**半步截尾**
 * 这件事 —— 改成向上取整（也就是不透明那条循环的做法），24 条测试里 4 条当场红。
 *
 * 判对错的是那两张表，不是这段公式 —— 见 `scaledBlit.test.ts`。
 */

/** 定点小数位数。见文件头：16..31 给出同一张表，被钉死的是下面那个半步截尾。 */
const SHIFT = 16
const ONE = 2 ** SHIFT

/**
 * 源长的护栏。
 *
 * **它不是量出来的边界**：黄金数据只覆盖源长 24 与 128（提示图就这一种源）。
 * 定这条线是因为「超出量过的范围」与「量过且成立」必须长得不一样 —— 与其对着
 * 一个没量过的源长悄悄给出一个编出来的答案，不如在这里响。
 */
const MAX_SRC_LEN = 255

/**
 * 目标长相对源长的上界。黄金数据只扫到源长的两倍，超过就是外推。
 *
 * 与 {@link MAX_SRC_LEN} 同一条理由：没量过的地方要响，不要悄悄给一个答案。
 * 提示图缩放时目标恒小于源（最大 120×24），离这条线远得很。
 */
const MAX_DEST_RATIO = 2

/**
 * 目标第 i 个像素取的源下标，i = 0..destLen-1。**源图必须带透明**，理由见文件头。
 *
 * `srcLen` / `destLen` 都要是正整数。
 */
export function nearestSourceIndexes(srcLen: number, destLen: number): number[] {
  requirePositiveInt(srcLen, 'srcLen')
  requirePositiveInt(destLen, 'destLen')
  if (srcLen > MAX_SRC_LEN) {
    throw new Error(
      `缩放采样只在源长 ≤ ${MAX_SRC_LEN} 上量过（见 tools/scaled-blit-golden/），收到 ${srcLen}`,
    )
  }
  if (destLen > srcLen * MAX_DEST_RATIO) {
    throw new Error(
      `缩放采样只扫到源长的 ${MAX_DEST_RATIO} 倍（见 tools/scaled-blit-golden/），` +
        `源长 ${srcLen} 配目标长 ${destLen} 是外推`,
    )
  }
  const inc = Math.floor((srcLen * ONE) / destLen)
  const loc = Math.floor(inc / 2)
  const out = new Array<number>(destLen)
  for (let i = 0; i < destLen; i++) out[i] = Math.floor((loc + i * inc) / ONE)
  return out
}

/** 目标上一段取同一个源下标的连续区间。 */
export interface BlitRun {
  /** 取源的第几个像素。 */
  readonly srcIndex: number
  /** 目标里这一段的起点。 */
  readonly destStart: number
  /** 这一段有几个像素。缩小时几乎全是 1，放大时才会 > 1。 */
  readonly length: number
}

/**
 * 把 {@link nearestSourceIndexes} 压成连续区间。
 *
 * 渲染器按区间搬像素：一段一次 `drawImage`，缩小时是 1:1 的整段拷贝、放大时是
 * 「一个源像素铺满 length 个目标像素」，两种都不经过任何插值，与原版一致。
 */
export function nearestBlitRuns(srcLen: number, destLen: number): BlitRun[] {
  const idx = nearestSourceIndexes(srcLen, destLen)
  const runs: BlitRun[] = []
  let start = 0
  for (let i = 1; i <= destLen; i++) {
    if (i === destLen || idx[i] !== idx[start]) {
      runs.push({ srcIndex: idx[start]!, destStart: start, length: i - start })
      start = i
    }
  }
  return runs
}

/** 一次 `drawImage`：从源的一块矩形搬到目标的一块矩形，不插值。 */
export interface BlitRect {
  readonly sx: number
  readonly sy: number
  readonly sw: number
  readonly sh: number
  readonly dx: number
  readonly dy: number
  readonly dw: number
  readonly dh: number
}

/** 两趟搬法。中间位图的尺寸是 `目标宽 × 源高`。 */
export interface ScaledBlitPasses {
  /** 第一趟：源图 -> 中间位图，只动横轴。 */
  readonly horizontal: readonly BlitRect[]
  /** 第二趟：中间位图 -> 目标位图，只动纵轴。 */
  readonly vertical: readonly BlitRect[]
}

/**
 * **把一块源区域拼成目标尺寸要搬哪些矩形。**
 *
 * 分两趟：先横着把每一列搬到位（源高不变），再竖着把每一行搬到位。两趟都是
 * 整段拷贝（缩小）或整段复制（放大），不经过任何插值。一趟一次 `drawImage`
 * 的写法要 `dw*dh` 次调用（120×24 = 2880），两趟只要 `dw+dh` 次。
 *
 * 几何在这里而不在渲染器里，是因为**轴搞反、源偏移漏加这类错，画面上看起来
 * 只是"提示图有点糊"**，而在这里它可以被逐像素核（`scaledBlit.test.ts` 拿一个
 * 十行的软件 blitter 把这两趟跑一遍，结果必须等于采样表的外积）。
 *
 * `src` 是源图里那块区域的位置与大小（提示图恒为整张图）；`dest` 只要尺寸，
 * 落点由调用方摆。
 */
export function scaledBlitPasses(
  src: { x: number; y: number; width: number; height: number },
  dest: { width: number; height: number },
): ScaledBlitPasses {
  const horizontal = nearestBlitRuns(src.width, dest.width).map((run) => ({
    sx: src.x + run.srcIndex,
    sy: src.y,
    sw: 1,
    sh: src.height,
    dx: run.destStart,
    dy: 0,
    dw: run.length,
    dh: src.height,
  }))
  const vertical = nearestBlitRuns(src.height, dest.height).map((run) => ({
    sx: 0,
    sy: run.srcIndex,
    sw: dest.width,
    sh: 1,
    dx: 0,
    dy: run.destStart,
    dw: dest.width,
    dh: run.length,
  }))
  return { horizontal, vertical }
}

function requirePositiveInt(v: number, name: string): void {
  if (!Number.isInteger(v) || v <= 0) {
    throw new Error(`缩放采样的 ${name} 要是正整数，收到 ${v}`)
  }
}
