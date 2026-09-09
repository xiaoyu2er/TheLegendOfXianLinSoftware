import { EQUIP_LIST_VIEW, EQUIP_ROW_H, EQUIP_X_START, equipList } from '../menu/equipPanel'
import { clampScroll, rowBandTop } from '../menu/scroll'
import { stepMenu } from '../menu/step'
import type { MenuButtonState, MenuWorld } from '../menu/types'

/**
 * 在菜单里"点东西"的三个动作，**落点算法与 `tools/src/devtools/MenuDriver` 同一套**。
 *
 * 收在一处而不是每个测试文件各写一遍：`menu/equipPanel.test.ts` 与
 * `menu/render/equipDraw.test.ts` 各自需要同样的点击，头一版两边各写了一份，
 * 其中一份还把落点写成了 `{x: 897, y: 444}` 这样的裸数字 —— 那几个数是从按钮
 * 几何算出来的，写死之后按钮一挪，测试点空了却照样绿（/code-review 的
 * Standards 轴提的 Duplicated Code）。
 *
 * ⚠️ 这些是**动作**，不是期望值。真值那两条剧本的逐字段比对仍然是正本判据
 * （`menu/menuTrace.test.ts`）；这里只服务真值盖不到的那几条路径。
 */

/**
 * 一颗按钮的中心。⚠️ **命中框比画出来的位置偏左 15、偏上 6**
 * （`GameButton.isMoveIn/isPressedButton` 里那个 `x-15` / `y-6`，见
 * `menu/buttons.ts` 的第 1 条），所以中心不是 `x+width/2`。
 *
 * ⚠️ **这个偏移在这里是观测不到的，别以为它有判据守着。** 实测（2026-09-09，
 * 菜单里全部 15 颗按钮）：抹掉这两个偏移，朴素中心 `x+w/2` **仍然落在**偏移后
 * 的命中框里，所以整套判据全绿。原因是它要求 `width>30 && height>12`，而这
 * 15 颗最小的是 40×40 与 43×20 —— 一颗都不例外。真正守着这两个数的是
 * `menu/buttons.test.ts` 对 `hits()` 的判据（那里点的是边缘），不是这里。
 * 这里写全是为了让落点与原版同源，不是因为写错了会红。
 */
export function buttonCenter(b: MenuButtonState): [number, number] {
  return [b.x - 15 + Math.floor(b.width / 2), b.y - 6 + Math.floor(b.height / 2)]
}

/** 点一颗按钮：按下一步、松开一步 —— 与真值里每条指令展开的那两步同形。 */
export function clickButton(w: MenuWorld, b: MenuButtonState): void {
  const [x, y] = buttonCenter(b)
  stepMenu(w, [{ e: 'press', x, y }])
  stepMenu(w, [{ e: 'release', x, y }])
}

/** 只按下、不松开 —— 拒绝旗标那一类**只活一步**的东西要在这一步上看。 */
export function pressButtonOnly(w: MenuWorld, b: MenuButtonState): void {
  const [x, y] = buttonCenter(b)
  stepMenu(w, [{ e: 'press', x, y }])
}

/** 松开上一次按下的那颗。 */
export function releaseButtonOnly(w: MenuWorld, b: MenuButtonState): void {
  const [x, y] = buttonCenter(b)
  stepMenu(w, [{ e: 'release', x, y }])
}

/**
 * 把鼠标移到装备页当前列表里那一件所在的行。
 *
 * 行高与起点从 `equipPanel.ts` 的常量来（它们自己由 `equipPanel.test.ts`
 * 对回 GBK 源码），落点公式与 `MenuDriver.move()` 相同：命中带从
 * `y_start_point - 22` 起，取带中。
 *
 * **移完核对真的选中了它** —— 差一行在状态里长得跟选对了一模一样。
 */
export function selectEquipRow(w: MenuWorld, name: string): void {
  const e = w.panels.equipPanel.equip
  if (!e) throw new Error('equipPanel 没有装备页状态')
  const index = equipList(e).findIndex((i) => i.name === name)
  if (index < 0) throw new Error(`当前列表里没有「${name}」`)
  // ⚠️ 落点要跟着**滚动位置**走（xl-6lo.13）：翻过页之后同一行的带子已经
  // 整体上移了 `offset` 行。写死成"从 y_start_point-22 起数"的话，翻过页的
  // 场子里这里会选中另一件，而下面那句核对报的是"想选 A，实际选中 B" ——
  // 看起来像实现错了。`offset` 为 0 时算出来的 y 与原来逐字相同。
  const offset = clampScroll(EQUIP_LIST_VIEW, equipList(e).length, e.scroll)
  stepMenu(w, [
    {
      e: 'move',
      x: EQUIP_X_START + 1,
      y: rowBandTop(EQUIP_LIST_VIEW, index, offset) + Math.floor(EQUIP_ROW_H / 2),
    },
  ])
  if (e.currentEquipment !== name) {
    throw new Error(`想选「${name}」，实际选中的是「${e.currentEquipment}」`)
  }
}

/**
 * 点卷轴上的一颗头像换人。
 *
 * ⚠️ 二号与四号的头像**开局 `isDraw=No`**，是 `Scoll.checkMoveIn()` 按出战名单
 * 把它们打开的 —— 不先移一下鼠标，`MenuButton.isPressedButton` 整个跳过，
 * 这一点就是空的（而"点了没反应"与"这个人不在队里"长得一样）。
 */
export function clickScollHead(w: MenuWorld, head: MenuButtonState): void {
  const [x, y] = buttonCenter(head)
  stepMenu(w, [{ e: 'move', x, y }])
  stepMenu(w, [{ e: 'press', x, y }])
  stepMenu(w, [{ e: 'release', x, y }])
}
