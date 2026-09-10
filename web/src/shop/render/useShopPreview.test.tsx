import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetId } from '../../assets/ids'
import { animationLoopOfPanels, loopFrames } from '../test/animationLoop'
import { previewFrame } from '../preview'
import { KEEPER_ROLE, PARTY_ROLES, animationFrameId, mouseId } from './assets'
import type { ShopDrawOp } from './drawList'
import type { ShopRenderer } from './shopRenderer'
import { useShopPreview } from './useShopPreview'

/**
 * **那八格真的在转 —— 而且是照原版那条 `for` 的形状转的（xl-knp.11）。**
 *
 * ## 这个文件补的是哪一格
 *
 * 「八格怎么循环」这一维，本仓库两层判据都够不着：状态真值一个动画字段都不记，
 * 跨端逐帧比对里那条线程被 `Clock.setFactor(1e-9)` 冻在第 0 格
 * （`compare/expected.ts` 商店那一段、`test/animationLoop.ts` 的头注）。
 * 判据因此回到 GBK 源码上取，参照模型在 `../test/animationLoop.ts`。
 *
 * 而**帧号怎么数**那一半（`preview.ts` 的 `previewFrame`）与**谁按那个帧号
 * 贴图**那一半（`drawList.ts`）各自都已经有判据了；今天真正没人守的是**中间
 * 那一段** —— 计时器有没有按 120ms 转、传进去的到底是不是"开了多少毫秒"。
 * 那一段整个在 `useShopPreview` 这个 hook 里，它泡在 React 里，进不了普通的
 * `pnpm test`。
 *
 * **实测过它没人守**（2026-09-09，八条篡改跑 `pnpm vitest run src/shop`，
 * 每条都先确认改到了几处再看颜色）：
 *
 * | 篡改 | 这个文件之前 | 之后 |
 * |---|---|---|
 * | `previewFrame` 改成七格一圈 | 红 | 红 |
 * | `previewFrame` 倒着走 | 红 | 红 |
 * | `previewFrame` 每格睡两倍 | 红 | 红 |
 * | `drawList` 鼠标图钉死在第 0 格 | 红 | 红 |
 * | `drawList` 队伍动画钉死在第 0 格 | 红 | 红 |
 * | `drawList` 店主动画错开一格 | 红 | 红 |
 * | **hook 的 `setInterval` 间隔翻倍** | **绿** | **红** |
 * | **hook 里帧号永远传 `previewFrame(0)`** | **绿** | **红** |
 *
 * 最后两行是这个文件买到的分辨力，前六行是第二双眼睛。⚠️ 那两条**绿**尤其
 * 值得看一眼：`setInterval` 间隔翻倍之后画面照样在转，只是慢一半 —— 与"对了"
 * 长得几乎一样；而帧号永远是 0 时画面**一动不动**，而那正是导出时的样子，
 * 也就是逐帧比对认得的那一种。
 *
 * ## 渲染器是假的，React 是真的
 *
 * 换掉的只有 `ShopRenderer`（三个方法的接口，`load` 给一个已决的 Promise、
 * `draw` 记账）。hook 自己、`previewFrame`、`shopDrawList` 全是真的跑，
 * 计时器由 `vi.useFakeTimers()` 推 —— 也就是说**它验的是这三者接起来之后的
 * 行为**，不是任何一处的内部实现。
 */

const drawn: ShopDrawOp[][] = []
const renderer: ShopRenderer = {
  load: async (_ids: readonly AssetId[]) => {},
  draw: (ops) => {
    drawn.push([...ops])
  },
  destroy: () => {},
}

/** 一份绘制清单里，鼠标图那一条落在第几格。认不出来是抛错，不是返回 -1。 */
function mouseFrameOf(ops: readonly ShopDrawOp[], frames: number): number {
  const op = ops.find((o) => o.kind === 'image' && o.layer === 'mouse')
  if (!op || op.kind !== 'image') throw new Error('这一帧的清单里没有鼠标图')
  for (let i = 0; i < frames; i++) if (op.id === mouseId(i)) return i
  throw new Error(`鼠标图的 ID ${op.id} 不属于 0..${frames - 1} 任何一格`)
}

/** 同一份清单里，四条人物动画各自落在第几格（去重之后应当只剩一个数）。 */
function iconFramesOf(ops: readonly ShopDrawOp[], frames: number): number[] {
  const ids = ops.flatMap((o) => (o.kind === 'image' && o.layer === 'icon' ? [o.id] : []))
  const roles = [...PARTY_ROLES.map((r) => r.role), KEEPER_ROLE.drug, KEEPER_ROLE.equipment]
  const got: number[] = []
  for (const id of ids) {
    for (const role of roles) {
      for (let i = 0; i < frames; i++) {
        if (id === animationFrameId(role, i)) got.push(i)
      }
    }
  }
  if (got.length === 0) throw new Error('这一帧的清单里一条人物动画都没有')
  return got
}

beforeEach(() => {
  drawn.length = 0
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/** 把 hook 挂起来并让 `renderer.load` 那个 Promise 落地，返回卸载函数。 */
async function mount(): Promise<() => void> {
  const { unmount } = renderHook(() => useShopPreview(renderer, 'drug'))
  await act(async () => {})
  return unmount
}

describe('店里那八格真的在转，而且照原版那条 for 的形状转', () => {
  const loop = animationLoopOfPanels()
  const count = loop.bound - loop.from

  it('参照模型解出来了 —— 零匹配与「源码里没这一段」长得一样', () => {
    expect(loop.from).toBe(0)
    expect(loop.step).toBe(1)
    expect(loop.wraps).toBe(true)
    expect(count).toBeGreaterThan(1)
    expect(loop.intervalMs).toBeGreaterThan(0)
    // 循环变量在三处是同一个（for 头、mouses[i]、images.get(i)）——
    // 解析器解不出这三处之一时上面那句 `animationLoopOfPanels()` 已经抛了。
    expect(loop.variable).toMatch(/^\w+$/)
  })

  it('⚠️ 跨过第一圈：走完一圈从头再来，而「走完就停」在头一圈里长得一模一样', () => {
    const twoCycles = loopFrames(loop, count * 2)
    expect(twoCycles.slice(0, count)).toEqual(twoCycles.slice(count))
    // 不循环的模型给不出第二圈 —— 长度就对不上（这一条是给 `wraps` 立的）。
    expect(loopFrames({ ...loop, wraps: false }, count * 2)).toHaveLength(count)
  })

  it('`previewFrame` 逐格对上参照模型，连着三圈', () => {
    const want = loopFrames(loop, count * 3)
    // 每一格的**开头**与**末尾**各取一次：整除那一处最容易差一格，而差一格
    // 在单看一帧时完全正常。
    expect(want.map((_, k) => previewFrame(k * loop.intervalMs))).toEqual(want)
    expect(want.map((_, k) => previewFrame(k * loop.intervalMs + loop.intervalMs - 1))).toEqual(want)
  })

  it('挂上去之后，鼠标图与四条人物动画**一起**按那个次序转', async () => {
    const unmount = await mount()
    // 推三圈。⚠️ 分母是解出来的格数 × 解出来的毫秒数，不是写死的 8 × 120。
    await act(async () => {
      vi.advanceTimersByTime(loop.intervalMs * count * 3)
    })
    unmount()

    // 空转要响：一帧都没画与「每一帧都对」在下面那两条断言下长得一样。
    // 上界也顺手守住了转速：推三圈该画出三圈那么多张，画少了同样红。
    expect(drawn.length, '推了三圈，画出来的帧数却不够两圈').toBeGreaterThan(count * 2)

    const want = loopFrames(loop, drawn.length)
    expect(drawn.map((ops) => mouseFrameOf(ops, count)), '鼠标图那一串').toEqual(want)
    // 人物动画与鼠标图**同一个下标**：原版那条 for 一次赋值推完五处。
    drawn.forEach((ops, k) => {
      expect([...new Set(iconFramesOf(ops, count))], `第 ${k} 帧的人物动画`).toEqual([want[k]!])
    })
  })

  it('⚠️ 转得快慢也要对：推半圈就该恰好走过半圈那么多格', async () => {
    const unmount = await mount()
    const half = Math.floor(count / 2)
    await act(async () => {
      vi.advanceTimersByTime(loop.intervalMs * half)
    })
    unmount()
    // 第 0 帧是挂上去当场画的那一张，之后每 intervalMs 一张。
    expect(drawn.map((ops) => mouseFrameOf(ops, count))).toEqual(loopFrames(loop, half + 1))
  })
})
