import { hits } from '../buttons'
import type { MenuButtonState } from '../types'

/**
 * 一颗菜单按钮命中框的**中心**，也就是"想点中它该往哪按"。
 *
 * 判据抄自 `tools.GameButton.isPressedButton`：
 * `x-15 < cx < x+width-15 && y-6 < cy < y+height-6` —— 原版那两个偏移是历史
 * 遗留，命中框比画出来的位置偏左 15、偏上 6（`menu/buttons.ts` 的文件头注）。
 * 与 `tools/src/devtools/MenuDriver.center()` 同一个算式，菜单真值里每一个落点
 * 都是这么算出来的。
 *
 * **测试里不要手写一个"看起来点得中"的坐标** —— 几何抄错了它多半照样点得中
 * （按钮 220×50，偏移只有 15/6），于是"落点对"与"几何对"分不开。这个函数把
 * 落点绑在几何上：几何一改，落点跟着改，点不中就红。
 *
 * ⚠️ 返回之前**自己核一遍真的命中**（`hits`）。算式抄错了照样返回一个数，
 * 而"没点中"的表现是下游那条断言莫名其妙地失败，跟实现错了长得一样。
 */
export function hitCenter(x: number, y: number, width: number, height: number): [number, number] {
  const point: [number, number] = [x - 15 + Math.floor(width / 2), y - 6 + Math.floor(height / 2)]
  const box: MenuButtonState = {
    x,
    y,
    width,
    height,
    isDraw: true,
    isclicked: false,
    isMoveIn: false,
    image: 'normal',
  }
  if (!hits(box, point[0], point[1])) {
    throw new Error(`(${point[0]},${point[1]}) 不在 ${x},${y} ${width}×${height} 的命中框里`)
  }
  return point
}
