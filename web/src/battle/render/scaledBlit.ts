/**
 * **Java2D 缩放时的采样规律**（xl-ttu，xl-cpo 改写）：目标的第 i 个像素取源的第几个像素。
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
 * 于是缩放**不再靠 GPU 采样**：这里按原版的规律算出「每个目标像素取哪个源
 * 像素」，渲染器照着它在 CPU 上拼出一张目标尺寸的位图，再 1:1 贴上去。顺带
 * 甩掉一个可移植性隐患 —— WebGL 的最近邻在**恰好落在纹素边界**上取哪一个是
 * 实现自定的。现在走这条路的有三处：提示图、旁白背景（xl-03x.15）、存读档缩略图（xl-cpo）。
 *
 * ## 规律是量出来的，判据是那几张表
 *
 * `tools/scaled-blit-golden/java-scaled-blit.json` 是拿「像素值就是自己的坐标」的
 * 梯度图跑真的 Java2D 读回来的，三批：两轴扫描（源 128×24，目标 1..256 × 1..48）、
 * 旁白那一对（639×395 → 1024×640）、缩略图（`maps/` 下每种尺寸 → 150×100，两条循环
 * 各一批）。下面这个定点模型在**三批全部**表上一处不差，但它是**拟合**出来的，
 * 不是从 OpenJDK 源码里读出来的（那两条循环在 JDK 的 native 代码里）：
 *
 * ```
 *   shift = 31 - bitLength(源宽 | 源高)       // 两条循环共用
 *   inc   = (srcLen << shift) / destLen       // 整数除法，截尾
 *   loc   = 带透明：inc / 2                    // 半步，截尾
 *           不透明：(inc + 1) / 2              // 半步，向上取整
 *   src(i) = (loc + i * inc) >> shift
 * ```
 *
 * **两条循环只差半步那一下的取整。** 这是 xl-cpo 从缩小区间里撞出来的；此前的写法是
 * 「带透明 16 位、不透明 23 位」两个常数，两个都只在它们量过的地方碰巧成立：
 *
 * - 不透明那条的 23 就是 `31 - bitLength(128 | 24)`。缩略图里 1024×640 与 2048×640
 *   两张图的**纵轴**同是 640 → 100，第 2 行一个取 15、一个取 16 —— 纵轴的表跟着**横轴**
 *   的源宽变，常数位数解释不了，按源尺寸定位数才解释得了（位数 20 与 19）。
 * - 带透明那条的 16：两轴扫描里 16..31 任何一个都给出同一张表（xl-ttu 当时就记了「16 不
 *   是被数据钉死的」），缩略图 150×100 上也还成立；到 2865×699 → 233×253（大迷宫那张图的
 *   探针）才露馅，按源尺寸定的 19 位吻合。
 *
 * ## 源图透不透明决定走哪条，判据是像素，不是有没有 alpha 通道
 *
 * 导出器拿每张真地图画一遍去对两张表（`thumbnail.maps`）：**凡是真有一个像素不透明度
 * 小于 255 的都走带透明那条，全不透明的走不透明那条** —— 包括带 alpha 通道、而每个
 * 像素 alpha 都是 255 的 PNG（宿舍.png、迷宫2.png…），它们走的是**不透明**那条。
 * 票面原先按「PNG 带 alpha 通道」推成带透明，那是错的。提示图那 22 张每张都有真透明
 * 像素（导出器逐张核），所以战斗那边仍是 `'transparent'`。
 */

/**
 * 源图透不透明，Java2D 走的是哪一条 blit 循环。见文件头。
 */
export type BlitLoop = 'transparent' | 'opaque'

/** 源图（整张）的尺寸。定点位数由它定，见文件头。 */
export interface BlitExtent {
  readonly width: number
  readonly height: number
}

/**
 * 两轴扫描之外**量过**的 (源尺寸 → 目标尺寸)。登记，不是推导 —— 新添一对必须先让
 * 导出器量过，`scaledBlit.test.ts` 拿黄金数据逐条核这张表里的每一对。
 */
const MEASURED_BLITS: readonly { readonly src: BlitExtent; readonly dest: BlitExtent }[] = [
  // 旁白背景：`Narratage.drawNarratage` 的 `drawImage(img, 0,0,1024,640, 0,0,639,395)`（xl-03x.15）。
  { src: { width: 639, height: 395 }, dest: { width: 1024, height: 640 } },
  // 存读档缩略图：`LoadAndSavePanel.paint()` 的 `drawImage(img, 100, 100+i*200, 150, 100)`，
  // 场景地图出现过的每一种尺寸（xl-cpo）。哪几种由 `scaledBlit.test.ts` 与数据层真值对撞。
  ...(
    [
      [1022, 640],
      [1023, 639],
      [1024, 639],
      [1024, 640],
      [2048, 640],
      [2048, 1280],
      [2865, 699],
      [3200, 2560],
    ] as const
  ).map(([width, height]) => ({ src: { width, height }, dest: { width: 150, height: 100 } })),
]

/** 存读档缩略图量过的源尺寸（{@link MEASURED_BLITS} 里目标是 150×100 的那几条）。给测试对撞用。 */
export function measuredThumbnailSources(): BlitExtent[] {
  return MEASURED_BLITS.filter((m) => m.dest.width === 150 && m.dest.height === 100).map((m) => m.src)
}

/**
 * 源长的护栏（两轴扫描那一批）。
 *
 * **它不是量出来的边界**：两轴扫描只覆盖源长 24 与 128。定这条线是因为「超出量过的
 * 范围」与「量过且成立」必须长得不一样 —— 与其对着一个没量过的源长悄悄给出一个编出来
 * 的答案，不如在这里响。{@link MEASURED_BLITS} 里登记的那几对不受它管。
 */
const MAX_SRC_LEN = 255

/**
 * 目标长相对源长的上界。两轴扫描只扫到源长的两倍，超过就是外推。
 *
 * 这条线是真的有用的：xl-cpo 的导出器在 81×73 → 203×235 上（放大两倍多）撞见过拟合公式
 * 对不上（那一次用的还是旧公式，新公式在那里**没量过**）。
 */
const MAX_DEST_RATIO = 2

/** 两条循环共用的定点位数：`31 - bitLength(源宽 | 源高)`。见文件头。 */
export function blitShift(extent: BlitExtent): number {
  requirePositiveInt(extent.width, 'extent.width')
  requirePositiveInt(extent.height, 'extent.height')
  const bits = (extent.width | extent.height).toString(2).length
  return 31 - bits
}

/**
 * **源图全不透明**时目标第 i 个像素取的源下标。`extent` 是整张源图的尺寸（定点位数由它
 * 定），`srcLen` 是这一条轴的源长。
 *
 * 数都在 2^53 以内（shift ≤ 30，srcLen·2^shift < 2^31），所以用浮点做整数算术是精确的。
 */
export function opaqueSourceIndexes(srcLen: number, destLen: number, extent: BlitExtent): number[] {
  return sourceIndexes('opaque', srcLen, destLen, extent)
}

/** 目标第 i 个像素取的源下标，**源图带透明**时。参数同 {@link opaqueSourceIndexes}。 */
export function nearestSourceIndexes(srcLen: number, destLen: number, extent: BlitExtent): number[] {
  return sourceIndexes('transparent', srcLen, destLen, extent)
}

function sourceIndexes(loop: BlitLoop, srcLen: number, destLen: number, extent: BlitExtent): number[] {
  requirePositiveInt(srcLen, 'srcLen')
  requirePositiveInt(destLen, 'destLen')
  if (srcLen !== extent.width && srcLen !== extent.height) {
    throw new Error(`缩放采样的源长 ${srcLen} 既不是源图的宽也不是高（${extent.width}×${extent.height}）`)
  }
  guardMeasured(srcLen, destLen, extent)
  const shift = blitShift(extent)
  const one = 2 ** shift
  const inc = Math.floor((srcLen * one) / destLen)
  const loc = loop === 'opaque' ? Math.floor((inc + 1) / 2) : Math.floor(inc / 2)
  const out = new Array<number>(destLen)
  for (let i = 0; i < destLen; i++) out[i] = Math.floor((loc + i * inc) / one)
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
 * 把采样表压成连续区间。
 *
 * 渲染器按区间搬像素：一段一次 `drawImage`，缩小时是 1:1 的整段拷贝、放大时是
 * 「一个源像素铺满 length 个目标像素」，两种都不经过任何插值，与原版一致。
 */
export function nearestBlitRuns(
  srcLen: number,
  destLen: number,
  extent: BlitExtent,
  loop: BlitLoop = 'transparent',
): BlitRun[] {
  const idx = sourceIndexes(loop, srcLen, destLen, extent)
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
 * 只是"有点糊"**，而在这里它可以被逐像素核（`scaledBlit.test.ts` 拿一个
 * 十行的软件 blitter 把这两趟跑一遍，结果必须等于采样表的外积）。
 *
 * `src` 是源图里那块区域的位置与大小。**定点位数按 `src` 的宽高定** —— 三个调用方
 * 的源矩形都是整张图（提示图、旁白背景、缩略图），所以「按源矩形还是按整张图定」
 * 这件事**没有量过**，两者在这里没有区别。`dest` 只要尺寸，落点由调用方摆。`loop`
 * 按源图透不透明选（见文件头）。
 */
export function scaledBlitPasses(
  src: { x: number; y: number; width: number; height: number },
  dest: { width: number; height: number },
  loop: BlitLoop = 'transparent',
): ScaledBlitPasses {
  const extent = { width: src.width, height: src.height }
  const horizontal = nearestBlitRuns(src.width, dest.width, extent, loop).map((run) => ({
    sx: src.x + run.srcIndex,
    sy: src.y,
    sw: 1,
    sh: src.height,
    dx: run.destStart,
    dy: 0,
    dw: run.length,
    dh: src.height,
  }))
  const vertical = nearestBlitRuns(src.height, dest.height, extent, loop).map((run) => ({
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

/**
 * 量过才给答案：{@link MEASURED_BLITS} 里登记过的那一对（同一张源图、同一条轴的目标长），
 * 或者两轴扫描覆盖的范围。之外的输入要响，理由见 {@link MAX_SRC_LEN}。
 */
function guardMeasured(srcLen: number, destLen: number, extent: BlitExtent): void {
  const registered = MEASURED_BLITS.some(
    (m) =>
      m.src.width === extent.width &&
      m.src.height === extent.height &&
      ((srcLen === extent.width && destLen === m.dest.width) ||
        (srcLen === extent.height && destLen === m.dest.height)),
  )
  if (registered) return
  if (srcLen > MAX_SRC_LEN) {
    throw new Error(
      `缩放采样只在源长 ≤ ${MAX_SRC_LEN} 上扫过（见 tools/scaled-blit-golden/），` +
        `源图 ${extent.width}×${extent.height} 的源长 ${srcLen} → ${destLen} 也不在量过的登记里`,
    )
  }
  if (destLen > srcLen * MAX_DEST_RATIO) {
    throw new Error(
      `缩放采样只扫到源长的 ${MAX_DEST_RATIO} 倍（见 tools/scaled-blit-golden/），` +
        `源长 ${srcLen} 配目标长 ${destLen} 是外推`,
    )
  }
}

function requirePositiveInt(v: number, name: string): void {
  if (!Number.isInteger(v) || v <= 0) {
    throw new Error(`缩放采样的 ${name} 要是正整数，收到 ${v}`)
  }
}
