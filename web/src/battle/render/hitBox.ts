import type { BattleWorld, Enemy, GameButton } from '../types'

/**
 * 两个命中判定，渲染这一层也要用（xl-rh9.9）。
 *
 * 为什么渲染要判命中：原版的按钮贴图与怪物贴图**是被鼠标事件换掉的**
 * （`GameButton.buttonImage`、`Enemy.currentImage=selectedImage`），换哪一张
 * 完全由命中判定说了算。也就是说这两个矩形不只决定"点得中点不中"，它们
 * **直接画在屏幕上** —— 偏 15 个像素，画面上就是另一颗按钮亮着。
 *
 * ## 那个 −15 / −6 是原版缺陷，照抄（ADR-0001）
 *
 * `tools/GameButton.isMoveIn/isPressedButton/isRelesedButton` 三处一模一样地
 * 写着 `currentX>x-15 && currentX<x+width-15 && currentY>y-6 && currentY<y+height-6`：
 * 判的矩形比画出来的位置**左偏 15、上偏 6**，四边还都是严格不等号。
 *
 * ⚠️ **xl-rh9.7 实测过：把这个偏移抹掉，battle-min 的行为真值照样全绿。**
 * 原因是导出器点的正是命中框中心 (514,325)，它同时落在偏移前后两个矩形里。
 * 也就是说状态层那一侧观测不到这件事。渲染这一侧观测得到 —— 一颗按钮在
 * 「亮」与「不亮」之间只差这 15 px，而它进逐帧比对。判据见 `hitBox.test.ts`
 * 的边界四条，以及跨端比对里 command 画出来的那几帧。
 *
 * ## 这一份与 `step.ts` 里那一份是两份
 *
 * `step.ts` 有一个同样的 `hit()`，没有导出。抄一份过来是有意的：两份**互相
 * 是对方的判据**（`hitBox.test.ts` 里那条交叉验证，拿 `stepBattle` 真的点一遍，
 * 逐像素扫过边界确认两边同时翻）。合并成一份会让这条交叉验证退化成恒真，
 * 而且要动 `step.ts` —— 那是 xl-rh9.8 正在改的文件。
 */

/** `GameButton` 三个 check 里那个矩形：左偏 15、上偏 6，四边严格不等号。 */
export function hitsButton(b: GameButton, x: number, y: number): boolean {
  return x > b.x - 15 && x < b.x + b.width - 15 && y > b.y - 6 && y < b.y + b.height - 6
}

/**
 * `EnemySlector` 那个矩形：**不偏**，四边都是闭区间。
 *
 * 第三槽的高用的是 `height1`（第一只怪的图高）—— xl-1dv.8，照抄。
 * `battle-min` 三只怪的图都是 172 高，这个错在那一场里看不出来；看得出来的是
 * `battle-em3-box`（归 xl-rh9.8）。
 */
export function hitsEnemy(w: BattleWorld, slot: 1 | 2 | 3, x: number, y: number): boolean {
  const s = w.selector
  const box =
    slot === 1
      ? { x: s.x1, y: s.y1, width: s.width1, height: s.height1 }
      : slot === 2
        ? { x: s.x2, y: s.y2, width: s.width2, height: s.height2 }
        : { x: s.x3, y: s.y3, width: s.width3, height: s.height1 }
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height
}

/**
 * 这一拍这只怪身上画的是不是「选中」那张图 —— 状态层记着的 `showsSelected`
 * （`step.ts` 的 `selectorMoveIn` 换上、`enemyDoAction` 换回）。
 *
 * ⚠️ 这里原先是**按游标现在在哪现算**的（还能选且游标在框里）。xl-qqw 之前玩家只能
 * 点，游标只在点击时落下一次，两种写法看不出区别；分开收鼠标事件之后它就错了：
 * 按着键拖过怪物，游标在框里而原版不换图（`mouseDragged` 不调 `checkMoveIn`）。
 * `battle-mouse` 每 5 拍取帧实测 t=155/160/165 三帧 2 号怪那一框 9353/9328/9324 个
 * 像素对不上，t=170 起（真悬停）全等。顺带，游标离框那一拍 `code` 正好等于走图长度时
 * 选中图多留一拍 —— 那一条原先登记为「对不上」，现在是照抄的。
 */
export function enemyShowsSelected(e: Enemy): boolean {
  return e.showsSelected
}
