import { ANIMATION_FRAMES, ANIMATION_INTERVAL_MS } from './layout'
import type { ShopKind } from './layout'
import type { ShopConfig } from './world'

/**
 * **开发用的商店预览**那一点点纯逻辑（xl-knp.6）。
 *
 * ⚠️ **这不是进店的正路。** 原版进店走的是场景里的选择事件
 * （`GameLauncher.switchTo`），那条路 **xl-yg6.11** 接上了（`game/session.ts`）；
 * `previewFrame` 那一份数法两边共用（`game/useGame.ts` 的 `drawShop`）。这里只是让骨架
 * 在浏览器里**真的画得出来** —— 少了它，"两个店的骨架画得出来"就只剩一句
 * 断言不了的话：`drawList.test.ts` 守的是清单，守不了"这份清单真的贴上了
 * 纹理"，而那两件事失败的样子不一样（前者是断言红，后者是一片空白）。
 *
 * 逻辑放在这里而不是那个 hook 里，是因为 hook 整个泡在 React 与 Pixi 里、
 * 进不了 `pnpm test`，而**帧号怎么数**是会错的那一半。
 */

/** 预览用的开局：一个人、原版那个 `Money.coins` 的初值、一个固定的种子。 */
export const PREVIEW_CONFIG: ShopConfig = {
  // 三个人都在，四条人物动画与三组属性于是全画得出来 —— 预览要看的正是骨架。
  party: ['zhang', 'lu', 'wen'],
  // `Money.coins` 那个 static 的初始化式。
  coins: 10000,
  // 随便一个定值。预览不是判据，不必与任何一条剧本对上；固定它是为了同一个
  // 浏览器里两次打开长得一样，"存货又变了"与"哪里画错了"分不开。
  seed: 1,
  drugs: [{ name: '金创药', count: 2 }],
  equipment: [{ name: '皮靴', count: 1 }],
}

/** 预览选择器的取值域。`none` = 不预览。 */
export type ShopPreviewChoice = 'none' | ShopKind

export const SHOP_PREVIEW_CHOICES: readonly {
  readonly value: ShopPreviewChoice
  readonly label: string
}[] = [
  { value: 'none', label: '不看' },
  { value: 'drug', label: '药店' },
  { value: 'equipment', label: '装备超市' },
]

/**
 * 开了多少毫秒 → 那条动画线程走到第几格。
 *
 * 原版那个 `for(int i=0;i<8;i++){ …; Clock.sleep(120); }` 是**先赋值后睡**，
 * 所以 0ms 时就已经在第 0 格上了。⚠️ 负数与非有限值要顶回第 0 格：
 * `Math.floor(-1/120) % 8` 是 `-0`… 而 `mouseId(-1)` 算出来是
 * `鼠标图/0.png`，一张不存在的图 —— 而"取不到纹理"那句抛错与"这一层写坏了"
 * 分不开。
 */
export function previewFrame(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0
  return Math.floor(elapsedMs / ANIMATION_INTERVAL_MS) % ANIMATION_FRAMES
}
