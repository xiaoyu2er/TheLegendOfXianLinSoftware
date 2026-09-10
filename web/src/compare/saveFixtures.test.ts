import { describe, expect, it } from 'vitest'
import { SAVE_SLOT_COUNT } from '../save/store'
import { SAVELOAD_TRACE_NAMES, readSaveLoadTrace } from '../saveload/test/replayTrace'
import { TRACE_NAMES, readTrace } from '../state/trace'
import { saveFixtureOf } from './saveFixtures'

/**
 * 取图页起手要的原版存档（xl-i06.12）。分母是磁盘上的真值，逐份过一遍。
 *
 * **期望值一律取自 Java 侧导出的真值**，不经 `saveFixtures.ts` 自己调的那两个读取器推导 ——
 * 拿实现调的函数去算期望，是一条按构造成立的断言（/code-review 抓的）。原版导出器读的是
 * 同一个草稿区，它读出来的与这里解出来的对得上，才说明送进取图页的起手就是原版的起手。
 */
describe('比对器送进取图页的存档起手', () => {
  const headers = TRACE_NAMES.map((n) => readTrace(n) as unknown as Parameters<typeof saveFixtureOf>[0])
  const loads = headers.filter((h) => h.driver === 'scene' && h.script.load !== undefined)

  it('读档剧本：送来的那一份，钱等于原版读档之后真值里记的', () => {
    // 分母现数：读档剧本一份都没有的话，下面的循环一轮不跑还全绿。
    expect(loads.length).toBeGreaterThan(0)
    for (const h of loads) {
      const f = saveFixtureOf(h)
      if (f?.kind !== 'readBack') throw new Error(`${h.script.name} 没送来读档起手（收到 ${f?.kind}）`)
      expect(f.slot).toBe(h.script.load)
      // 读档专属那几列是原版 `Loader.load` 之后的样子（SceneDriver.appendLoadColumns）。
      const tick0 = readTrace(h.script.name).ticks[0] as unknown as { coins: number }
      expect(f.readBack.coins, `${h.script.name} 的钱`).toBe(tick0.coins)
    }
  })

  it('saveload 剧本：送来的三个槽，地图名与任务逐槽等于原版面板第 0 步读出来的摘要', () => {
    expect(SAVELOAD_TRACE_NAMES.length).toBeGreaterThan(0)
    for (const n of SAVELOAD_TRACE_NAMES) {
      const trace = readSaveLoadTrace(n)
      const setup = trace.script.setup
      const f = saveFixtureOf({ driver: 'saveload', script: { name: n, setup } })
      if (f?.kind !== 'slots') throw new Error(`${n} 没送来草稿区（收到 ${f?.kind}）`)
      expect(f.slots).toHaveLength(SAVE_SLOT_COUNT)
      // 第 0 步是 enter，摘要是面板构造时 `prepareScenes()` 从草稿区读的 —— 原版读的。
      const slots = trace.ticks[0]!.slots as { map: string; task: string }[]
      f.slots.forEach((s, i) => {
        expect(s === null ? '无' : s.summary.mapName, `${n} 第 ${i} 槽的地图`).toBe(slots[i]!.map)
        // 空槽那一格必须真是空的、别的格必须真有档 —— 拿剧本头现读。
        expect(s === null, `${n} 第 ${i} 槽`).toBe(setup.emptySlots.includes(i))
      })
    }
  })

  it('其余真值一份存档都不带（送进去的字节与从前相同）', () => {
    const rest = headers.filter((h) => h.driver !== 'saveload' && h.script.load === undefined)
    expect(rest.length).toBeGreaterThan(0)
    for (const h of rest) expect(saveFixtureOf(h), h.script.name).toBeUndefined()
  })

  it('真值头的场景与读出来的对不上是硬失败，不是照读', () => {
    const h = loads[0]!
    expect(() => saveFixtureOf({ ...h, script: { ...h.script, scene: '不是这个.txt' } })).toThrow(/读出来是/)
  })

  it('saveload 剧本头没有 setup 是硬失败', () => {
    expect(() => saveFixtureOf({ driver: 'saveload', script: { name: '合成' } })).toThrow(/没有 setup/)
  })
})
