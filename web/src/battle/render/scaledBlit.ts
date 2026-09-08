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
 * 是另一条，定点设置也不一样（实测是 23 位、半步向上取整），两张表在 X 的
 * 3/7/9/11/12/20/21/31/33/48/56/60/63/77/93/99/116 与 Y 的 9/10 等档上不同。
 * 提示图那 22 张 PNG 全都带透明（导出器逐张核过，见 `ExportScaledBlit`），所以
 * 这里用的是带透明那一份。**这条不是推出来的，是撞出来的**：头一版拿全不透明
 * 的梯度图量，20×4 那一档（`battle-menus` 的 t=200 那一帧）就差两个像素。
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

function requirePositiveInt(v: number, name: string): void {
  if (!Number.isInteger(v) || v <= 0) {
    throw new Error(`缩放采样的 ${name} 要是正整数，收到 ${v}`)
  }
}
