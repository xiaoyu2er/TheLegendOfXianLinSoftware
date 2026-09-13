import type { BufferMode } from './bufferPlan'

/**
 * 战斗持久缓冲**怎么上屏**（xl-eit）。从 `battleRenderer.ts` 里拆出来，理由同
 * `bufferPlan.ts`：渲染器没有测试缝，而这里错了的样子与对了一模一样 —— 只差进程里
 * 头一场战斗的头两三帧、背景半透明的那几条边。
 *
 * - **游戏（`'keep'`）照原版上屏**：`BattlePanel.paint()` 末尾 `g.drawImage(bufferedPic)`
 *   以 SrcOver 把非预乘 ARGB 的缓冲画到 Swing 上，alpha 不扔；而 Swing 画这块面板之前
 *   先拿**被画的那个组件自己的底色** `clearRect`。原版的内容面板与 `BattlePanel` 都没
 *   `setBackground`，所以每一帧都是「缓冲盖在新铺的 `Panel.background` 上」——
 *   **不是**盖在上一帧屏幕上（`BattleScreenProbe` 实测，见 `tools/src/devtools/ExportPresent.java`）。
 * - **取图页（`'fresh'`）对的是导出的缓冲**：导出器存的是 `bufferedPic` 本身，比对器
 *   不看 alpha，所以上屏要还原缓冲的非预乘 RGB、alpha 置 1。这一支不能改，改了跨端
 *   逐帧比对就不再是在比同一样东西。
 *
 * 两者只在缓冲 alpha 没叠满处不同；跨场复用（`'keep'`）之下，只有进程里头一场就用半透明
 * 背景（「校园小道」）的头几帧叠不满。
 */

/**
 * 原版 `Panel.background`：`new JPanel()` 的默认底色，由 LAF 定。**不是手抄的**：
 * `present.test.ts` 拿 `tools/present-golden/java-present.json`（Java 现取）对它。
 * 那份数据 headless 导出，LAF 是 Metal（Windows 上原版的默认）；macOS 的 Aqua
 * 2026-09-13 在 openjdk 17 上量过一次也是 238。其余平台 / 主题没量。
 */
export const PANEL_BACKGROUND = 0xeeeeee

export type Present =
  /** 缓冲以普通混合（预乘 SrcOver）盖在 `background` 上，alpha 不扔。 */
  | { kind: 'over'; background: number }
  /** 反预乘：RGB 除以 alpha、alpha 置 1（`alpha = 0` 处给黑）。 */
  | { kind: 'unpremultiply' }

/** 这一场怎么上屏。与缓冲清不清同一个表态：游戏 `'keep'`、取图页 `'fresh'`。 */
export function presentFor(mode: BufferMode): Present {
  return mode === 'keep' ? { kind: 'over', background: PANEL_BACKGROUND } : { kind: 'unpremultiply' }
}
