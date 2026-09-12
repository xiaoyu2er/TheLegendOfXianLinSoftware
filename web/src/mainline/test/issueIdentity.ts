/**
 * **只给判据用**：每一张还开着的票恰好贴一个身份标签（xl-03x.19）。
 *
 * 为什么要它：「还欠什么」原先只能靠读几十段票面正文回答。贴了身份之后它是一句查询 ——
 * `bd list --label 身份:没人认领` —— 而这句查询只有在**每张 open 票都恰好一个身份**时才答得全：
 * 少贴一张，它就从三份清单里同时消失，与「没有这张票」长得一样。
 *
 * 三种身份的**判断**（什么票该贴哪一个）写在 `docs/adr/0007-what-done-means.md`；
 * 这里一个字都不核「贴得对不对」—— 那是人签的登记，自动推导等于让被守的东西自己签字
 * （`docs/agents/dispatch.md` 纪律 3）。这里只核**形状**：恰好一个、认得出、与快照的 open 名单双向对得上。
 *
 * 真值源是入库的 `tools/issue-snapshot/identity.json`，由 `tools/export-issues.sh` 与
 * `issues.json` 同一次从活库导出、同一个 `--check` 守新鲜。**导出器照实写**（零个、两个都照写），
 * 让这里红，而不是在导出时替人补一个。
 */

import type { Snapshot } from './playerCoverage'

export const IDENTITIES = ['身份:登记', '身份:下一轮', '身份:没人认领'] as const

/** 票号 → 这张票身上以 `身份:` 开头的全部标签（导出器照实写，可能是零个或多个）。 */
export type Identity = Readonly<Record<string, readonly string[]>>

/** 列出所有问题；空表示每张 open 票恰好一个认得出的身份。 */
export function identityProblems(snapshot: Snapshot, identity: Identity): string[] {
  const out: string[] = []
  const open = Object.keys(snapshot).filter((id) => snapshot[id] === 'open')
  // 零张 open 票时下面每条检查都恒真。一个真实的仓库不会零张 open —— 零张多半是快照读空了。
  if (open.length === 0) out.push('快照里一张 open 票都没有 —— 读空了？拒绝判')

  for (const id of open) {
    const labels = identity[id]
    if (labels === undefined) {
      out.push(`${id}：open，但身份快照里没有这张票（快照与身份不是同一次导出的？）`)
      continue
    }
    const unknown = labels.filter((l) => !(IDENTITIES as readonly string[]).includes(l))
    if (unknown.length > 0) out.push(`${id}：不认识的身份 ${unknown.join('、')}（只认 ${IDENTITIES.join(' / ')}）`)
    if (labels.length === 0) out.push(`${id}：open，但一个身份标签都没有`)
    else if (labels.length > 1) out.push(`${id}：贴了 ${labels.length} 个身份（${labels.join('、')}），只许一个`)
  }
  for (const id of Object.keys(identity)) {
    if (snapshot[id] !== 'open') out.push(`${id}：身份快照里有，而票据快照里它是 ${snapshot[id] ?? '不存在'} —— 只给 open 票记身份`)
  }
  return out
}

/** 每种身份各几张（读数用）。 */
export function identityTally(identity: Identity): Record<string, number> {
  const t: Record<string, number> = Object.fromEntries(IDENTITIES.map((i) => [i, 0]))
  for (const labels of Object.values(identity)) if (labels.length === 1) t[labels[0]!] = (t[labels[0]!] ?? 0) + 1
  return t
}
