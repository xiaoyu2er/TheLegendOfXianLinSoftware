/**
 * **账本对撞**（xl-03x.3）：逐帧拿原版的金币与药包去撞取图页的。
 *
 * ## 它补的是哪个洞
 *
 * 答题加扣金币、开箱进背包这两笔账**只由 Web 的会话层记**，而两条现有判据都看不见：
 *
 * - 行为真值（trace.json）不记 —— 场景快照里没有金币与药包；
 * - 逐帧比对的金币数字那一格是字形缺口区（`expected.ts` 的 `coinDigits`），只查上界。
 *   答题之前两端都画 10000 时字形差就有 559 个像素，而数值不同的帧并不比它多
 *   （2026-09-11，question-answer / question-memory 实测）。把会话层的加钱改成扣钱，
 *   两条剧本照样「2/2 符合预期」。
 *
 * 取图页从前只推 `step()`、不走会话层，这一层的账于是整层失明。修法是会话层与取图页
 * 共用那一段结算（`game/sceneLedger.ts`），而**让它失明时会红**的，是这里。
 *
 * ## ⚠️ 这是 M8 的第二道新缝
 *
 * SPEC（xl-03x.1）只预算了一道新的仅测试缝（对照表的引用完整性）。这一道是修这张票时
 * 被逼出来的：原版那一侧的数只能从导出器取（`ExportTrace.ledgerEntry`，`--frames` 时写进
 * 不入库的帧清单，**不进 trace.json**），因为真值层没有这两个数的别的读者，为它改真值
 * 格式要全部场景真值重导。没有它，「共用那一段改坏了」在所有判据下都是绿的。
 *
 * ## 为什么两端的数对得上
 *
 * 答题加扣的额是 `500 + (int)(500 * Math.random())`。原版那一侧由 `SceneDriver` 起手最后
 * 一句播种，取图页拿同一个种子起一个 `JavaRandom`（`replay/main.ts`）。不播的话原版每导
 * 一次都不同（同一条 question-answer 两次读到 9117 与 9055）。
 */

export interface LedgerEntry {
  readonly coins: number
  /** 原版：`DrugPack.drugList` 全表（件数可为 0）。Web：假药包收到过的名字。 */
  readonly drugs: readonly { readonly name: string; readonly count: number }[]
}

export interface LedgerVerdict {
  readonly ok: boolean
  readonly verdict: string
  /** 第一帧对不上的帧号；全对是 `null`。 */
  readonly firstMismatch: number | null
}

/**
 * 逐帧对账。**两端都得交齐**：原版帧清单里没有账本、原版药包是空表、取图页某一帧没交
 * 账本、帧数对不上 —— 都是硬失败（抛），不是「没什么可比」。空药包对空药包恒等，那样的
 * 「逐帧相等」是对空气的。
 */
export function judgeLedger(
  ticks: readonly number[],
  java: readonly LedgerEntry[] | undefined,
  web: readonly (LedgerEntry | undefined)[],
): LedgerVerdict {
  if (ticks.length === 0) throw new Error('账本一帧都没有 —— 空序列不算通过')
  if (java === undefined) {
    throw new Error('原版帧清单里没有 ledger —— 那是旧的导出器写的，重跑 tools/compare-frames.sh')
  }
  if (java.length !== ticks.length || web.length !== ticks.length) {
    throw new Error(`账本帧数对不上：清单 ${ticks.length} 帧，原版 ${java.length} 份，取图页 ${web.length} 份`)
  }
  const mismatches: string[] = []
  let firstMismatch: number | null = null
  ticks.forEach((t, i) => {
    const a = java[i]!
    const b = web[i]
    if (b === undefined) throw new Error(`取图页第 ${t} 帧没交账本 —— 这一套装配没接上 settleSceneRequests`)
    if (a.drugs.length === 0) {
      throw new Error(`原版第 ${t} 帧的药包是空表 —— 驱动器没立药包，对药等于对空气（见 SceneDriver.start）`)
    }
    const problems: string[] = []
    if (a.coins !== b.coins) problems.push(`金币 原版 ${a.coins} / Web ${b.coins}`)
    const webCount = new Map(b.drugs.map((d) => [d.name, d.count]))
    for (const d of a.drugs) {
      const got = webCount.get(d.name) ?? 0
      if (got !== d.count) problems.push(`${d.name} 原版 ${d.count} / Web ${got}`)
    }
    const known = new Set(a.drugs.map((d) => d.name))
    for (const d of b.drugs) {
      if (!known.has(d.name) && d.count !== 0) problems.push(`${d.name} 原版药包里没有这一味 / Web ${d.count}`)
    }
    if (problems.length > 0) {
      firstMismatch ??= t
      mismatches.push(`第 ${t} 帧 ${problems.join('、')}`)
    }
  })
  if (mismatches.length > 0) {
    return {
      ok: false,
      firstMismatch,
      verdict: `账本对不上：${ticks.length} 帧里 ${mismatches.length} 帧不同，最早 ${mismatches[0]}。`,
    }
  }
  const last = java[java.length - 1]!
  const held = last.drugs.filter((d) => d.count !== 0).map((d) => `${d.name}×${d.count}`)
  return {
    ok: true,
    firstMismatch: null,
    verdict:
      `账本 ${ticks.length} 帧逐帧相等（金币 ${java[0]!.coins} → ${last.coins}` +
      `，末帧药包 ${held.length === 0 ? '空' : held.join(' ')}）。`,
  }
}
