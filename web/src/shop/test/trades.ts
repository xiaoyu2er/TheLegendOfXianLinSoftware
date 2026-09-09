import type { ShopKind } from '../layout'
import type { ShopTrace, ShopTraceTick } from '../trace'

/**
 * 「真值里那几笔成交」的读取器，**两家店共用一份**。
 *
 * ⚠️ 抽出来是收 `/code-review` Standards 轴的 Duplicated Code：`drugShop.test.ts`
 * 与 `equipShop.test.ts` 里原本各有一份 `Row` / `listOf` / `xxxTrades`，
 * **逐字相同**，只差 `shop` 那一列筛的是 `'drug'` 还是 `'equipment'`。
 * 那种重复的失败方式很具体：给账本加一条校验只加在一家店上，另一家安静地
 * 少一条 —— 而两份代码长得一样，看不出少了什么（`test/hitCenter.ts` 的头注
 * 记着同一个教训）。
 *
 * 这一层**只认真值，不碰状态层** —— 期望值仍然一个都不手写，两个调用方各自
 * 拿它读出来的读数去核自己那半边。
 */

/** 真值 `list` 那一列的一行。 */
export interface TradeRow {
  readonly name: string
  readonly price: number
  readonly stock: number
  readonly purchase: number
  readonly held: number
}

export const listOf = (tick: ShopTraceTick): readonly TradeRow[] =>
  tick['list'] as readonly TradeRow[]

/** 一笔成交：松开 buy / sell 的那一步，连着它的前一步。 */
export interface Trade {
  /** 那一步在真值里的下标（也就是 `t`）。 */
  readonly i: number
  readonly kind: 'buy' | 'sell'
  readonly prev: ShopTraceTick
  readonly cur: ShopTraceTick
}

/**
 * 一条真值里**某一家店**那几笔成交。
 *
 * ⚠️ 第 0 步没有"前一步"，跳过它 —— 而剧本第一条指令必定是 `open`，所以第 0 步
 * 不可能是成交。少了这道过滤，`trace.ticks[-1]` 是 `undefined`，接着每一处
 * `listOf(prev)` 都抛，看起来像真值坏了。
 */
export function tradesOf(trace: ShopTrace, shop: ShopKind): Trade[] {
  const out: Trade[] = []
  for (const [i, cur] of trace.ticks.entries()) {
    if (i === 0 || cur['shop'] !== shop) continue
    for (const e of cur.input) {
      if (e.e !== 'release' || !('target' in e)) continue
      if (e.target === 'buy' || e.target === 'sell') {
        out.push({ i, kind: e.target, prev: trace.ticks[i - 1]!, cur })
      }
    }
  }
  return out
}
