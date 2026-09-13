import { commandButtons, skillMenuButtons } from '../battle/step'
import type { BattleClick } from '../battle/step'
import { hitsButton, hitsEnemy } from '../battle/render/hitBox'
import type { BattleWorld } from '../battle/types'

/**
 * **一次真的鼠标点击 → 一条 `BattleInput`**（xl-rh9.17）。
 *
 * 行为真值里的每一条输入都自带一个 `target`（`command:击` / `enemy:1` …），
 * 那是导出器写进去的：它知道自己要点谁。玩家不知道 —— 他只有一对坐标。
 * 所以游戏本体这一侧要把坐标**判回**那个判别名，而且必须用**与状态层同一套
 * 命中框**，否则会出现"画面上按钮亮着、点下去没反应"这种查不出来的错。
 *
 * 判的顺序照抄 `BattlePanel.setMouse()` 里那个 `mousePressed`：
 * 控制台 → 技能菜单 → 药品菜单 → 怪物选择器。四段都套着各自的 `isDraw` /
 * `isSlectable`，所以同一对坐标在不同时刻判出来的东西不一样 —— 这正是原版
 * 的语义，不是这一层的取舍。
 *
 * 落空返回 `'none'`：原版的三个监听器是无条件挂着的，点在空处照样跑一遍
 * （四颗按钮的贴图会一起刷回常态）。见 `battle/step.ts` 的 `applyBattleInput`。
 *
 * ## xl-qqw 之后玩家那一侧不走这里
 *
 * 战斗画布现在送的是分开来的四种事件（`BattlePointer`：移动 / 拖动 / 按下 / 松开），
 * 按坐标直接喂 `applyBattleInput`，不需要先判回 target。这里只剩测试在用：
 * `session.test.ts` 的自动攻打要一次**焊死的点击**，形状与真值里导出器那几条老指令
 * 记下来的一样。
 *
 * ## 这一层没有独立判据，也不需要
 *
 * 它一行几何都不自己写：`hitsButton` / `hitsEnemy` 是渲染层那两个，而那两个
 * 与 `step.ts` 里没导出的那一份**互为判据**（`hitBox.test.ts` 的逐像素交叉
 * 验证）。这里只剩"先判哪一段"，而那由 `session.test.ts` 的自动攻打整条跑
 * 一遍 —— 顺序判错了，那一场就打不完。
 */
export function classifyClick(w: BattleWorld, x: number, y: number): string {
  if (w.command.isDraw) {
    const keys = ['attack', 'skill', 'defend', 'thing'] as const
    const buttons = commandButtons(w)
    for (let i = 0; i < buttons.length; i++) {
      if (hitsButton(buttons[i]!, x, y)) return `command:${keys[i]}`
    }
  }
  if (w.skillMenu.isDraw) {
    const buttons = skillMenuButtons(w)
    for (let i = 0; i < buttons.length; i++) {
      if (hitsButton(buttons[i]!, x, y)) return `skillMenu:${i}`
    }
    const back = w.skillMenu.returnButton
    if (back !== null && hitsButton(back, x, y)) return `skillMenu:${buttons.length}`
  }
  if (w.drugMenu.isDraw) {
    for (let i = 0; i < w.drugMenu.buttons.length; i++) {
      if (hitsButton(w.drugMenu.buttons[i]!, x, y)) return `drugMenu:${i}`
    }
  }
  if (w.selector.isSlectable) {
    for (const slot of [1, 2, 3] as const) {
      if (hitsEnemy(w, slot, x, y)) return `enemy:${slot}`
    }
  }
  return 'none'
}

export function battleClick(w: BattleWorld, x: number, y: number): BattleClick {
  return { e: 'click', x, y, target: classifyClick(w, x, y) }
}
