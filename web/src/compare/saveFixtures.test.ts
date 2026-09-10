import { describe, expect, it } from 'vitest'
import { loaderReadBack, readSample } from '../save/test/originalSave'
import { SAVE_SLOT_COUNT } from '../save/store'
import { SAVELOAD_TRACE_NAMES, draftSlots, readSaveLoadTrace } from '../saveload/test/replayTrace'
import { TRACE_NAMES, readTrace } from '../state/trace'
import { saveFixtureOf } from './saveFixtures'

/**
 * 取图页起手要的原版存档（xl-i06.12）。分母是磁盘上的真值，逐份过一遍：
 * 该带存档的每一份都带上了、带的是**状态层判据用的那一份**；不该带的一份都没带。
 */
describe('比对器送进取图页的存档起手', () => {
  const headers = TRACE_NAMES.map((n) => readTrace(n) as unknown as Parameters<typeof saveFixtureOf>[0])
  const loads = headers.filter((h) => h.driver === 'scene' && h.script.load !== undefined)

  it('读档剧本：送的是原版读取器对那一份档的实际读法，读进的场景就是真值头那个', () => {
    // 分母现数：读档剧本一份都没有的话，下面的循环一轮不跑还全绿。
    expect(loads.length).toBeGreaterThan(0)
    for (const h of loads) {
      const f = saveFixtureOf(h)
      expect(f, h.script.name).toEqual({
        kind: 'readBack',
        slot: h.script.load,
        readBack: loaderReadBack(readSample(`存档${h.script.load}.txt`)),
      })
      if (f?.kind !== 'readBack') throw new Error('上一句已断言')
      expect(f.readBack.scene.fileName).toBe(h.script.scene)
    }
  })

  it('saveload 剧本：送的是草稿区三个槽，空槽是 null —— 与状态层回放同一个函数', () => {
    expect(SAVELOAD_TRACE_NAMES.length).toBeGreaterThan(0)
    for (const n of SAVELOAD_TRACE_NAMES) {
      const setup = readSaveLoadTrace(n).script.setup
      const f = saveFixtureOf({ driver: 'saveload', script: { name: n, setup } })
      expect(f, n).toEqual({ kind: 'slots', slots: draftSlots(setup.emptySlots) })
      if (f?.kind !== 'slots') throw new Error('上一句已断言')
      expect(f.slots).toHaveLength(SAVE_SLOT_COUNT)
      // 空槽那一格必须真是空的、别的格必须真有档 —— 两个方向都拿剧本头现读。
      f.slots.forEach((s, i) => expect(s === null, `${n} 第 ${i} 槽`).toBe(setup.emptySlots.includes(i)))
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
