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

/** 一段逐帧动画：源目录、共几帧。 */
export interface StartSequence {
  /** `sources/StartPanel/` 下的目录名，原版 `new StartAnimation(n, s, …)` 的 `s`。 */
  readonly dir: string
  /** 帧数，原版那个 `n`。文件是 `1.png .. n.png`，下标 `0 .. n-1`。 */
  readonly count: number
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
 * ## ⚠️ 卷轴那两段是 9.3 MB（实测），而且**只能按需取**
 *
 * 无损 WebP 实测（2026-09-08）：`卷轴` 与 `反向卷轴` 各 10 帧、各 4642 KB，
 * 六段加两张整屏图一共 9988 KB。走的是 `?url`（见 `assets/resolve.ts`），
 * 所以它们**不进 JS 包**，是一帧一个文件；渲染层每一拍只挂当前那一帧的
 * `<img>`（`StartPanel.tsx`），因此标题屏静止时只取第 0 帧的 101 KB。
 *
 * 代价是**过场第一次播的时候会卡**：10 帧在 1 秒内依次首取，慢网上补不齐。
 * 没有在这里开有损的例外 —— `scripts/bake.ts` 的 `toWebp` 头注里写着
 * 「PNG 一律无损，不给任何一张开例外」，那是 xl-9bd.14 拿眼睛看过之后的裁定，
 * 不该由这张票顺手推翻。要预取还是要降质，登记在 `xl-4si` 的收尾里。
 */
export const START_SEQUENCES: Readonly<Record<StartSequenceName, StartSequence>> = {
  buttonGlow: { dir: '按钮动画', count: 4 },
  cursor: { dir: '鼠标', count: 8 },
  scroll: { dir: '卷轴', count: 10 },
  backScroll: { dir: '反向卷轴', count: 10 },
  loading: { dir: '载入', count: 10 },
  loading2: { dir: '载入2', count: 3 },
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
