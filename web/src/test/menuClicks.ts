import { EQUIP_ROW_H, EQUIP_X_START, EQUIP_Y_START, equipList } from '../menu/equipPanel'
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
  stepMenu(w, [
    {
      e: 'move',
      x: EQUIP_X_START + 1,
      y: EQUIP_Y_START - EQUIP_ROW_H + EQUIP_ROW_H * index + Math.floor(EQUIP_ROW_H / 2),
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
