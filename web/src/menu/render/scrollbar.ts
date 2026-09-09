import { scrollbar } from '../scroll'
import type { ListViewport } from '../scroll'
import type { MenuDrawOp } from './drawList'

/**
 * 滚动条的两块矩形（xl-6lo.13）。**列表装得下时一条 op 都不出** ——
 * `scrollbar()` 那时返回 `null`。
 *
 * 颜色与透明度是这一层自己定的（原版没有可抄的）：槽压暗、滑块提亮，两块都
 * 半透，压在列表框的右内沿上。
 */
export function scrollbarOps(view: ListViewport, length: number, offset: number): MenuDrawOp[] {
  const bar = scrollbar(view, length, offset)
  if (!bar) return []
  return [
    { kind: 'rect', layer: 'page', ...bar.track, color: SCROLLBAR_TRACK_COLOR, alpha: 0.45 },
    { kind: 'rect', layer: 'page', ...bar.thumb, color: SCROLLBAR_THUMB_COLOR, alpha: 0.9 },
  ]
}

const SCROLLBAR_TRACK_COLOR = '#000000'
const SCROLLBAR_THUMB_COLOR = '#e8d7a8'
