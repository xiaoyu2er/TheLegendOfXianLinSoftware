/**
 * 菜单里两处列表的**滚动条**（xl-6lo.13）—— 装备页的背包列表与物品页的
 * 药品清单。
 *
 * ## 这一层补的是原版没有的东西，所以先说清楚它**不改**什么
 *
 * ⚠️ **原版既没有滚动条，也不裁剪**：`EquipPanel.drawEquipment()` 的 y 一路
 * 加下去，画到框外照样画；`isMoveIn()` 的命中带同样无界（`originalY` 一路
 * `+22`）。`menu-scroll` 那份真值把这件事量了出来 —— 20 件武器撑过列表框
 * 4 行，而第 17..20 行**在原版里仍然点得中**（落点 y 是 518 / 540 / 562 /
 * 584，都还在 640 高的面板里）。
 *
 * 所以这一层的规矩是两句话：
 *
 * - **看得见那一半改**：只画滚动窗口里的那几行，右边加一条滚动条。
 * - **够得着那一半不改**：命中带仍然按 `originalY += rowHeight` 一路往下排，
 *   没有下界。翻页只是把整排带子**整体上移** `offset` 行；`offset` 为 0 时
 *   算式与原版逐字相同，`menu-scroll` 第 9 / 10 步（选中第 16 行与第 19 行，
 *   两行都在框外）照样对得上真值。
 *
 * 这两件事在真值里分得开，合成一条就会把「第 17 行点不中了」当成正确行为，
 * 而真值当场变红 —— 那时候多半会去改真值。
 *
 * **唯一的例外是往上翻**：`offset > 0` 时前 `offset` 行被推到框上面去了，
 * 而那片区域住着六颗槽位按钮（y 135..155）。所以命中只从第 `offset` 行起算，
 * 卷上去的行点不中。原版永远 `offset == 0`，这条例外在那边观测不到。
 *
 * ## 滚动位置**不进真值**
 *
 * `offset` 挂在装备页与物品页自己的状态上，而 `snapshotEquip` /
 * `drugSnapshot` 一个字都不记它 —— 真值那两列是原版导出来的，原版没有这个
 * 概念。判据在 `scroll.test.ts` 那条「滚动不改真值那几列」。
 *
 * ## ⚠️ 给 xl-6lo.14（menu 进逐帧比对）的登记
 *
 * 滚动条是**画在屏幕上的、原版没有的东西**。menu 那条流水线接上以后，
 * `menu-scroll` 那一条在滚动条那片矩形上必然与原版不同，而 `menu-equip` /
 * `menu-magic` 两条不会（它们的列表都装得下，滚动条整个不画）。接线的人要么
 * 给那片矩形写一条分区表态，要么让取图页把它关掉 —— **别把它当成"渲染错了"**。
 */

/** 一处列表框的内区。**量出来的**，来源见 `LIST_BOX_MEASUREMENT`。 */
export interface ListBox {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/**
 * 一处可滚动列表的全部几何。前四项抄自原版 Java（各自那一页的常量已经由
 * `equipPanel.test.ts` / `drugPanel.test.ts` 对回 GBK 源码），`box` 是量出来的。
 */
export interface ListViewport {
  /** 第一行的**基线** y（`y_start_point`）。 */
  readonly firstBaseline: number
  /** 行距，也是命中带的高（`y += 22` / `y += 32`）。 */
  readonly rowHeight: number
  /** 命中带的左右开区间（`currentX > left && currentX < right`）。 */
  readonly hitLeft: number
  readonly hitRight: number
  readonly box: ListBox
}

/**
 * 两处列表框内区的**测量**，2026-09-09。
 *
 * 测法：把背景图整张解出来，从框里的一个种子点出发沿横竖两向走到暗区尽头
 * （框线是亮的，框里是暗的，阈值取亮度 80）。种子点与 `menu-scroll` 那份真值
 * 描述里用的是同两个 —— 那条真值也是这么量的，两次独立量到同一组数。
 *
 * **这份测量每跑一次 `pnpm test` 就重做一遍**（`scroll.test.ts`），所以下面
 * 那两组数字不是"抄在注释里的读数"：图换了、数抄错了，当场红。
 */
export const LIST_BOX_MEASUREMENT = {
  equip: { image: 'sources/菜单/装备/装备4.png', seedX: 650, seedY: 300 },
  drug: { image: 'sources/菜单/物品/物品3.png', seedX: 500, seedY: 300 },
} as const

/** 装备页那个列表框的内区（`装备4.png`）。 */
export const EQUIP_LIST_BOX: ListBox = { left: 536, right: 777, top: 142, bottom: 521 }

/** 物品页那个列表框的内区（`物品3.png`）。 */
export const DRUG_LIST_BOX: ListBox = { left: 427, right: 730, top: 155, bottom: 532 }

/**
 * 一屏放得下几行。
 *
 * **按基线算，不按行盒算**：一行"在框里"的判据是它的基线还没掉出框底 ——
 * 原版画字用的是 `drawString(s, x, 基线)`，字身在基线**上方**。所以第 n 行
 * （n 从 0 起）在框里当且仅当 `firstBaseline + n*rowHeight <= box.bottom`。
 *
 * 装备页：`(521-177)/22 = 15.6` → 16 行（末行基线 507，第 17 行 529 掉在框外）。
 * 物品页：`(532-190)/32 = 10.7` → 11 行，而药品表一共只有 6 种。
 */
export function viewportRows(v: ListViewport): number {
  const rows = Math.floor((v.box.bottom - v.firstBaseline) / v.rowHeight) + 1
  if (rows < 1) throw new Error(`列表框放不下一行：框底 ${v.box.bottom}、首行基线 ${v.firstBaseline}`)
  return rows
}

/** 最多能往下翻几行。列表装得下时是 0 —— 也就是"滚不动"。 */
export function maxScroll(v: ListViewport, length: number): number {
  return Math.max(0, length - viewportRows(v))
}

/**
 * 把一个滚动位置夹进 `[0, maxScroll]`。
 *
 * **读的时候也要夹，不只是写的时候**：列表会在存放者不知情的情况下变短
 * （喝掉最后一瓶药、穿上最后一件装备、换到另一个槽位），那时候存着的
 * `offset` 会指到列表外面去，表现是"翻到底之后列表空了一片"。
 */
export function clampScroll(v: ListViewport, length: number, offset: number): number {
  if (!Number.isInteger(offset)) throw new Error(`滚动位置必须是整数行，收到 ${offset}`)
  return Math.min(Math.max(0, offset), maxScroll(v, length))
}

/** 这一屏画得出来的行号区间 `[from, to)`。 */
export function visibleRange(
  v: ListViewport,
  length: number,
  offset: number,
): { readonly from: number; readonly to: number } {
  const from = clampScroll(v, length, offset)
  return { from, to: Math.min(length, from + viewportRows(v)) }
}

/**
 * 第 `index` 行这一屏画在哪条基线上。翻上去的行会算出框外的值 ——
 * 那是有意的，调用方拿 `visibleRange` 决定画不画，这里只管算。
 */
export function rowBaseline(v: ListViewport, index: number, offset: number): number {
  return v.firstBaseline + (index - offset) * v.rowHeight
}

/**
 * 第 `index` 行命中带的**上沿**（开区间，带高 `rowHeight`）。
 *
 * `offset == 0` 时就是原版那句 `int originalY = y_start_point - 22;` 加上
 * `originalY += 22` 的第 index 次 —— 一个字都没变。
 */
export function rowBandTop(v: ListViewport, index: number, offset: number): number {
  return rowBaseline(v, index, offset) - v.rowHeight
}

/** 一个点落在列表框内区里吗（闭区间，框线本身算在外面）。滚轮认这块地方。 */
export function inListBox(v: ListViewport, x: number, y: number): boolean {
  return x >= v.box.left && x <= v.box.right && y >= v.box.top && y <= v.box.bottom
}

/** 滚动条的宽度（像素）。原版没有这东西，这个数是这一层自己定的。 */
export const SCROLLBAR_WIDTH = 8

/** 滑块最短多少像素 —— 列表很长时不让它缩成一条看不见的线。 */
export const SCROLLBAR_MIN_THUMB = 12

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * 滚动条的槽与滑块。**列表装得下时返回 `null`** —— 滚不动的滚动条不画。
 *
 * 槽贴着框的右内沿，纵向正好盖住那 `viewportRows` 条命中带（从第 0 行带子的
 * 上沿到最后一条带子的下沿），所以"滑块在槽里的位置"与"第几行在屏幕上"是
 * 同一把尺子。
 */
export function scrollbar(
  v: ListViewport,
  length: number,
  offset: number,
): { readonly track: Rect; readonly thumb: Rect } | null {
  const max = maxScroll(v, length)
  if (max === 0) return null
  const rows = viewportRows(v)
  const track: Rect = {
    x: v.box.right - SCROLLBAR_WIDTH + 1,
    y: rowBandTop(v, 0, 0),
    width: SCROLLBAR_WIDTH,
    height: rows * v.rowHeight,
  }
  const height = Math.max(SCROLLBAR_MIN_THUMB, Math.round((track.height * rows) / length))
  const at = clampScroll(v, length, offset)
  const thumb: Rect = {
    x: track.x,
    y: track.y + Math.round(((track.height - height) * at) / max),
    width: track.width,
    height,
  }
  return { track, thumb }
}

/** 一个点在这个矩形里吗（闭区间）。 */
export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height
}

/**
 * 在滚动条的槽里按一下 —— 滑块上方翻一屏，下方翻一屏，按在滑块上不动
 * （没有拖拽，拖拽是另一件事）。
 *
 * 返回新的滚动位置；这一下**不在槽里**时返回 `null`，调用方据此知道"这一下
 * 与滚动条无关"，而不是"滚动条决定不动"。两者分开，是因为后者会把"槽的几何
 * 算错了"变成一次安静的无操作。
 */
export function trackPress(
  v: ListViewport,
  length: number,
  offset: number,
  x: number,
  y: number,
): number | null {
  const bar = scrollbar(v, length, offset)
  if (!bar || !inRect(bar.track, x, y)) return null
  if (inRect(bar.thumb, x, y)) return clampScroll(v, length, offset)
  const rows = viewportRows(v)
  return clampScroll(v, length, offset + (y < bar.thumb.y ? -rows : rows))
}

/** 一格滚轮翻几行。 */
export const WHEEL_ROWS = 3

/**
 * 浏览器的 `WheelEvent.deltaY` → 翻几行。
 *
 * **只看方向，不看大小**：`deltaY` 的量纲随 `deltaMode`、操作系统与设备变
 * （鼠标滚轮一格是 100 上下，触控板是逐像素的小数），照它的大小换算的结果是
 * 触控板上一划飞过整份列表。一格三行是这一层自己定的手感。
 */
export function wheelRows(deltaY: number): number {
  return Math.sign(deltaY) * WHEEL_ROWS
}
