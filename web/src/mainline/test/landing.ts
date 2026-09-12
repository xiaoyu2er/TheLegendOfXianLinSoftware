import type { World } from '../../state/types'
import type { Hop } from './chain'

/**
 * **交接判据的那把尺**（xl-czb.7 定的，xl-03x.18 抽出来共用）：一跳走完之后，Web 状态层
 * 站的地方是不是下一段剧情的入口 —— 站在下一本脚本里、剧情三元组就是前一段记下的那一份、
 * 落点是它的第 0 格、当成剧情脚本进的。
 *
 * 两个用户，一把尺：`handoff.test.ts`（每一跳之前把世界摆好再走那一下）与
 * `playthrough.test.ts`（从起点按键连着走，不摆任何东西）。尺子只有这一份，改它两边一起变。
 *
 * 返回不相符的那几项的人话，全对是空数组。
 */
export function landingMismatches(w: World, hop: Hop): string[] {
  const out: string[] = []
  const [pos, , target] = hop.triple
  if (w.scene !== target) out.push(`进的脚本是 ${w.scene}，应为 ${target}`)
  if (JSON.stringify(w.currentScript) !== JSON.stringify(hop.triple)) {
    out.push(`currentScript 是 ${JSON.stringify(w.currentScript)}，应为 ${JSON.stringify(hop.triple)}`)
  }
  const at = roleTileOf(w)
  const [x, y] = pos.split('/').map(Number)
  if (at.x !== x || at.y !== y) out.push(`落点是 ${at.x}/${at.y}，应为 ${pos}`)
  if (!w.isScript) out.push('isScript 是 false，应为 true')
  return out
}

/** 主角脚下那一格 —— 原版 `Role.getX()` 的整数除法（`state/role.ts` 的 `roleTileX`）。 */
export function roleTileOf(w: World): { x: number; y: number } {
  return { x: Math.trunc(w.role.px / TILE), y: Math.trunc(w.role.py / TILE) }
}

const TILE = 32
