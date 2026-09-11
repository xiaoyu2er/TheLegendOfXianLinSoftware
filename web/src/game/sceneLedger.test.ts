import { beforeEach, describe, expect, it } from 'vitest'
import { drugCount, drugEntries, resetDrugPack } from '../fakes/drugPack'
import { getCoins, resetWallet } from '../fakes/wallet'
import { NO_REQUESTS } from '../state/types'
import type { SceneRequests } from '../state/types'
import { LEDGER_REQUESTS, settleSceneRequests } from './sceneLedger'

/**
 * 场景请求里**记账的那两类**（xl-03x.3）：答题加扣金币、开箱进背包。会话层与取图页
 * 共用这一段，所以这里验的是它自己；「会话真的调了它」在 `session.test.ts`，「取图页
 * 真的调了它」在跨端逐帧比对的账本对撞（取图页没有测试缝）。
 */

const requests = (over: Partial<SceneRequests>): SceneRequests => ({ ...NO_REQUESTS, ...over })

beforeEach(() => {
  resetWallet()
  resetDrugPack()
})

describe('settleSceneRequests', () => {
  it('答对加钱、答错扣钱 —— Money.addCoins / reduceCoins', () => {
    const before = getCoins()
    settleSceneRequests(requests({ presentRequest: { correct: true, coins: 750, text: '' } }))
    expect(getCoins()).toBe(before + 750)
    settleSceneRequests(requests({ presentRequest: { correct: false, coins: 501, text: '' } }))
    expect(getCoins()).toBe(before + 750 - 501)
  })

  it('开出来的每一项都进背包 —— DrugPack.addDrug', () => {
    settleSceneRequests(
      requests({
        treasureRequest: [
          { name: '金创药', count: 2 },
          { name: '金创药', count: 1 },
        ],
      }),
    )
    expect(drugCount('金创药')).toBe(3)
  })

  it('原版药表里没有的名字一件都不进 —— maze-treasure 那个「金疮药」（脚本错字）', () => {
    // 账本对撞的实测（2026-09-11）：原版这一侧 drugList 里没有「金疮药」，开箱之后
    // 药包全是 0；Web 的假药包从前收下了 2 件。
    settleSceneRequests(requests({ treasureRequest: [{ name: '金疮药', count: 2 }] }))
    expect(drugEntries().filter(([, n]) => n !== 0)).toEqual([])
  })

  it('什么请求都没亮的一拍，账一个字都不动', () => {
    const coins = getCoins()
    settleSceneRequests(NO_REQUESTS)
    expect(getCoins()).toBe(coins)
    expect(drugEntries().filter(([, n]) => n !== 0)).toEqual([])
  })
})

/**
 * **分母现读、登记手签**（dispatch.md 纪律 3）：场景请求有几类，从 `NO_REQUESTS`
 * 现读；哪几类记账、哪几类是「切面板」只由会话层接，由这里手签。给
 * `SceneRequests` 加了一类而没在这里归队，这一条当场红 —— 这就是票面要的「哪些账
 * 只由会话层记」那张清单的可执行形式，不照抄任何写下来的名单。
 */
const PANEL_SWITCHES: readonly (keyof SceneRequests)[] = ['battleRequest', 'selectPanelRequest', 'endRequest']

describe('场景请求的分工', () => {
  it('每一类请求恰好归一边：记账（共用）或切面板（只有会话层）', () => {
    const all = Object.keys(NO_REQUESTS).sort()
    // 拼起来与分母逐项相等：漏归队（短一个）与两边都登记（多一个）都在这一句红。
    expect([...LEDGER_REQUESTS, ...PANEL_SWITCHES].sort()).toEqual(all)
  })
})
