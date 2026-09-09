import type { MenuButtonState } from '../menu/types'

/**
 * 一颗菜单按钮的**命中中心** —— 与导出器 `MenuDriver.center()` 同一条公式。
 *
 * 原版 `MenuButton.isPressedButton` 的判据是
 * `currentX>x-15 && currentX<x+width-15 && currentY>y-6 && currentY<y+height-6`，
 * 也就是命中框比画出来的位置偏左 15、偏上 6（`menu/buttons.ts` 的文件头注）。
 *
 * 收成一处，是因为它**必须跟着 Java 那边的导出器走**：抄成四份之后，哪天原版
 * 那两个偏移变了，改一处、漏三处，而漏掉的那几处照样绿 —— 它们点的是按钮
 * 中心，偏移前后两个矩形都盖得住（`docs/agents/dispatch.md` 那条"这一场
 * 观测不到"里的第一例，就是这个偏移）。
 */
export function menuHitCenter(b: MenuButtonState): { x: number; y: number } {
  return { x: b.x - 15 + Math.floor(b.width / 2), y: b.y - 6 + Math.floor(b.height / 2) }
}
