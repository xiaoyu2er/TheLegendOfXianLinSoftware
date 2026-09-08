/**
 * 开始界面用到的**源素材**（xl-kaa）：逻辑名 → 仓库里的文件。
 *
 * 这几条路径写死在原版 `start.StartPanel` 的构造函数与 `initialButtons()`
 * 里，脚本数据里一个字都没提 —— 跟主角精灵、对话框素材、旁白背景是同一类，
 * 所以烘焙器按规则算路径，不走 `scanSceneAssets`（见 `scripts/bake.ts`）。
 *
 * **这个模块只放"烘焙器要知道的事"**，按钮摆在哪儿在 `buttons.ts`。分开是
 * 因为烘焙指纹把 `bake.ts` 的整个 import 闭包都算进去（xl-23y）：合成一个
 * 模块的话，挪一下按钮坐标就要重跑一次 `pnpm bake`，而重烘要 cwebp 与
 * afconvert，还会带上一批 m4a 的时间戳 churn。
 */
import type { StartSequenceName, startAssetId } from '../assets/ids'

/**
 * `startAssetId` 认的那几个逻辑名 —— **从那个函数的形参上取**，不再抄一遍。
 * 抄一遍的话，两边各加一个名字才对得上，而少加一边的表现是"某张图查不到"。
 */
export type StartImageName = Parameters<typeof startAssetId>[0]

/**
 * 逻辑名 → 仓库相对路径。
 *
 * **一个按钮只有两张图，不是三张**：原版 `new StartButton(..., normalImage,
 * waitclickImage, pressedImage, ...)` 的后两个实参传的是**同一个文件**
 * （`起2.png` 传了两遍），所以"鼠标悬停"与"按下去"画的是一张图。抄成三张
 * 会凭空多出一个原版没有的状态。
 *
 * 悬停那张比常态那张**大得多**（起.png / 承.png 是 50×50，起2.png / 承2.png
 * 是 190×53，实测），而原版 `drawButton` 是 `g.drawImage(buttonImage, x, y, mp)`
 * —— 不带宽高，按**原始尺寸**画在同一个左上角。所以悬停时那张图是往右铺开的
 * 一条横幅，不是把 50×50 撑大。渲染层照抄这件事，见 `StartPanel.tsx`。
 *
 * 类型写成 `Record<StartImageName, string>`：往这里加一条而忘了加进
 * `startAssetId` 的联合类型，`pnpm typecheck` 当场红。
 */
export const START_IMAGES: Readonly<Record<StartImageName, string>> = {
  back: 'sources/StartPanel/back.png',
  newGame: 'sources/StartPanel/按钮/起.png',
  newGameHover: 'sources/StartPanel/按钮/起2.png',
  load: 'sources/StartPanel/按钮/承.png',
  loadHover: 'sources/StartPanel/按钮/承2.png',
  // 另外三颗按钮与那两张整屏图（xl-4si）。`goBack` 是原版的「回」，
  // **不是** `back` —— 后者是背景图 `back.png`，两个词在原版里就撞了。
  about: 'sources/StartPanel/按钮/转.png',
  aboutHover: 'sources/StartPanel/按钮/转2.png',
  end: 'sources/StartPanel/按钮/结.png',
  endHover: 'sources/StartPanel/按钮/结2.png',
  goBack: 'sources/StartPanel/按钮/回.png',
  goBackHover: 'sources/StartPanel/按钮/回2.png',
  aboutPage: 'sources/StartPanel/关于我们.png',
  cloud: 'sources/StartPanel/最终云彩.png',
}

/** 一段逐帧动画：源目录、共几帧、这一段的 WebP 走无损还是有损。 */
export interface StartSequence {
  /** `sources/StartPanel/` 下的目录名，原版 `new StartAnimation(n, s, …)` 的 `s`。 */
  readonly dir: string
  /** 帧数，原版那个 `n`。文件是 `1.png .. n.png`，下标 `0 .. n-1`。 */
  readonly count: number
  /**
   * `true` = 这一段烘成**有损** WebP（`DEFAULT_LOSSY_QUALITY`），
   * `false` = 走 `-lossless`，也就是 PNG 源的默认。裁定与实测见下面
   * `START_SEQUENCES` 的头注（xl-bbs）。
   *
   * **写成必填而不是可选**，是为了让「新加一段动画」这件事必须在这里表一次态。
   * 可选的话漏写就是静默走无损，而多几 MB 的按需产物在画面上看不出来 ——
   * 这张票要解决的正是那个形状的问题。
   *
   * 产物那一端由 `scrollQuality.test.ts` 核：入库的每一帧的 WebP 编码方式
   * 必须跟这一列对得上，两边不一致立刻红。
   */
  readonly lossy: boolean
}

/**
 * 六段逐帧动画（xl-4si）。
 *
 * **帧数抄的是 Java 源码里的那个字面量，不是扫目录扫出来的**，而这是**故意**
 * 的：`sources/StartPanel/` 下还有 `云彩/`（9 张）与 `载入动画/`（4 张）两个
 * 目录，原版一张都没读过。扫目录会把它们一起烘进来，而多烘几张图在画面上
 * 完全看不出来。
 *
 * 那这个数字谁来守？`layout.test.ts` 把 `initialAnimations()` 里那七句
 * `new StartAnimation(n, "目录名", …)` 从 GBK 源码里现读出来逐条比 ——
 * 分母是「七句」，少一句立刻红。烘焙器那边再核一次文件在不在
 * （`scripts/bake.ts`，缺了攒进 `missing` 一次报全）。
 *
 * 于是两头都有判据：数字对不对着原版，由源码守；文件在不在，由烘焙器守。
 *
 * ## ⚠️ 卷轴那两段单独走**有损 q80**（xl-bbs 的裁定，2026-09-08）
 *
 * 起因：xl-4si 按「PNG 一律无损」把六段全烘了无损 WebP，实测两段卷轴各 10 帧、
 * 各 4642 KB，占 start:* 全部 9988 KB 的 93%。它们走的是 `?url`
 * （见 `assets/resolve.ts`），所以**不进 JS 包**，是一帧一个文件；渲染层每一拍
 * 只挂当前那一帧的 `<img>`（`StartPanel.tsx`），因此标题屏静止时只取第 0 帧。
 * 代价是**过场第一次播的时候会卡**：10 帧要在 1 秒内依次首取，慢网上补不齐。
 *
 * 四条路都摆在票面上（预取 / 降质 / 只预取前几帧 / 就这样），选的是**降质**，
 * 而且**只给这两段开例外**，别的五类 PNG 一张不动。
 *
 * ### 为什么这两段可以，而 xl-9bd.14 判的「大迷宫不行」仍然成立
 *
 * 那条裁定的理由是像素画：大迷宫的草地是**逐像素杂色点阵**，有损把它抹成
 * 色块，而本项目的「锐利」放大模式（`stage/scaling.ts`）存在的意义就是保住
 * 那些颗粒。**卷轴不是像素画，是一张纸卷的照片** —— 连续调、带 alpha 抠像，
 * 正是有损编码擅长而无损编码最吃亏的那一类（纸纤维的噪点无损压不动）。
 *
 * 拿眼睛看过（2026-09-08，第 8 帧，逐点放大即 `pixelated` 的放大方式）：
 * 1:1 分不出来；2 倍下极轻微更平滑，要盯着找；10 倍下纸纤维的颗粒明显被抹平，
 * 卷轴的硬边与投影完好。过场只有 1 秒，且这一屏不进跨端逐帧比对
 * （`replay/implemented.ts` 的 `IMPLEMENTED_DRIVERS` 今天是 scene / battle，
 * 一条 start 驱动器都没有），所以大迷宫那笔「永远留下 22% 偏离」的账这里不存在。
 *
 * ### 量化（10 帧合计 9212800 像素，源 PNG vs q80 解回来的 RGBA）
 *
 * 透明区的 RGB 到不了屏幕，两边按各自的 alpha 合成到同一个中灰底上再比。
 * 「一个像素的差」取三通道最大差，口径逐字照 `compare/diff.ts` 的 `frameDiff`：
 *
 *   完全相同 44.35%   超容差 8 的像素 3.36%   超 32 的 0.01%   最大单通道差 75
 *   alpha 通道**逐字节相同**（`cwebp` 的有损档默认无损存 alpha，抠像边不会晕）
 *
 * 换成 xl-9bd.14 那条「累计口径」（分母 = 像素 × 3 个通道）是 **差>8 1.33%**，
 * 对着大迷宫的 22.31% 小一个数量级。
 *
 * ### 代价与收益
 *
 *   档位     每段 10 帧   两段合计   第 0 帧   超8 像素
 *   无损     4642 KB      9285 KB    101 KB   —
 *   **q80**  **414 KB**   **827 KB** **16 KB** 3.36%
 *   q90      827 KB       1654 KB    —        0.99%
 *
 * start:* 那 58 条产物因此从 9988 KB 降到 1531 KB（重烘后实测）。q90 把偏离压到 0.99%（不到三分之一）
 * 却要两倍字节，而 1:1 下 q80 已经看不出来，所以取 q80 —— 也就是
 * `scripts/bake.ts` 的 `DEFAULT_LOSSY_QUALITY`，**不新造一个档位常量**。
 *
 * ### 另外三条为什么没选
 *
 * - **预取**：那是把 9.3 MB 从「过场时取」改成「开机就主动下载」，比现在糟。
 *   降质之后整段只有 414 KB，浏览器自己按需取就够了，不必再加一套预取机制。
 * - **只预取前几帧**：同上，且它是一个要自己维护的旋钮（预取到第几帧），
 *   而降质把问题从根上消掉了。
 * - **就这样**：9.3 MB 在这两段上是纯浪费，见上面的实测。
 *
 * ### 还剩一笔没在这张票里花掉
 *
 * `反向卷轴` 的 10 帧与 `卷轴` 的 10 帧**逐像素相同、只是次序相反**
 * （2026-09-08 实测：两边解成 RGBA 后 `cmp` 10/10 全同；入库的无损 WebP 产物
 * 也是 md5 两两相等）。把 `backScroll` 的第 f 帧指到 `scroll` 的第 9−f 帧
 * 能再省一半、并让第二次过场全部命中缓存 —— 但那要在烘焙期立一条恒等判据，
 * 跟「降不降质」是两件事，登记在 xl-l6h。
 */
export const START_SEQUENCES: Readonly<Record<StartSequenceName, StartSequence>> = {
  buttonGlow: { dir: '按钮动画', count: 4, lossy: false },
  cursor: { dir: '鼠标', count: 8, lossy: false },
  scroll: { dir: '卷轴', count: 10, lossy: true },
  backScroll: { dir: '反向卷轴', count: 10, lossy: true },
  loading: { dir: '载入', count: 10, lossy: false },
  loading2: { dir: '载入2', count: 3, lossy: false },
}

/**
 * 标题曲。原版 `GameLauncher.switchTo("start")` 里那句
 * `MusicReader.readBGM("主题曲.mp3")`。
 *
 * **它不属于任何一个场景的 `Music` 段**，所以烘焙器那两份现扫的名单
 * （要烘的 / 故意不烘的）都罩不住它，`bakeBgm` 得显式把它加进去。不加不是
 * 静音而是**抛**：`resolveBgmOrNull` 对既不在映射表、也不在"故意没烘"名单里的
 * ID 一律抛，而调用点在游戏循环里 —— 每一拍抛一次，画面就此定住。
 * （xl-rh9.17 落下 `panel === 'start'` 这个终止态之后，实测就是这个下场。）
 */
export const TITLE_BGM = '主题曲.mp3'
