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
          { name: '金疮药', count: 2 },
          { name: '金疮药', count: 1 },
        ],
      }),
    )
    expect(drugCount('金疮药')).toBe(3)
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
    expect([...LEDGER_REQUESTS, ...PANEL_SWITCHES].sort()).toEqual(all)
    expect(LEDGER_REQUESTS.filter((k) => PANEL_SWITCHES.includes(k))).toEqual([])
  })

  it('切面板那几类亮着，结算这一段一笔账都不记', () => {
    const coins = getCoins()
    settleSceneRequests(
      requests({ battleRequest: ['bg', 'zhang', 'null', 'null', 'em1', 'null', 'null'], selectPanelRequest: 'shop', endRequest: true }),
    )
    expect(getCoins()).toBe(coins)
    expect(drugEntries().filter(([, n]) => n !== 0)).toEqual([])
  })
})
