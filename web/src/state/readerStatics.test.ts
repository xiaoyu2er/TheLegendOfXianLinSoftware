import { describe, expect, it } from 'vitest'
import { READER_STATICS_SCRIPTS, readerStaticsFor } from '../data/readerStatics'
import { getScene } from '../data/scenesEager'
import { initiate } from './step'

/**
 * `World.readerStatics`（xl-i06.9）：原版 `Reader` 读脚本时写进的那几个静态字段。
 * 要守的是「粘」：`Task` / `Role` 两段缺席时留着上一个场景的值，`mapName` 不粘。
 *
 * 场景从烘焙产物里**现挑**，不写死名字：一个两段都有的、一个两段都没有的。
 */
const stem = (s: string) => s.replace(/\.txt$/, '')
const WITH = READER_STATICS_SCRIPTS.find((s) => {
  const r = readerStaticsFor(s)
  // 挑一个开关不全为真的，否则「粘住了」与「没粘、落回某个全真的默认」分不开。
  return r.task !== null && r.role !== null && r.role.includes(false)
})
const WITHOUT = READER_STATICS_SCRIPTS.find((s) => {
  const r = readerStaticsFor(s)
  return r.task === null && r.role === null && getScene(stem(s)).mapName !== undefined
})

describe('World.readerStatics', () => {
  it('两种脚本都挑得出来（否则下面两条对的是空气）', () => {
    expect(WITH).toBeDefined()
    expect(WITHOUT).toBeDefined()
  })

  it('开局就进一个两段都没有的场景：原版字段初值（task null、三个 false），mapName 取这个场景的', () => {
    const w = initiate(null, getScene(stem(WITHOUT!)))
    expect(w.readerStatics).toEqual({
      mapName: getScene(stem(WITHOUT!)).mapName,
      task: null,
      zhang: false,
      lu: false,
      wen: false,
    })
  })

  it('从两段都有的场景走进两段都没有的场景：task 与三个开关粘着上一个，mapName 换成新的', () => {
    const a = initiate(null, getScene(stem(WITH!)))
    const read = readerStaticsFor(WITH!)
    expect(a.readerStatics).toEqual({
      mapName: getScene(stem(WITH!)).mapName,
      task: read.task,
      zhang: read.role![0],
      lu: read.role![1],
      wen: read.role![2],
    })
    const b = initiate(a, getScene(stem(WITHOUT!)))
    expect(b.readerStatics).toEqual({ ...a.readerStatics, mapName: getScene(stem(WITHOUT!)).mapName })
    // 两个场景的地图确实不同，否则上面那句「换成新的」没被测到。
    expect(getScene(stem(WITHOUT!)).mapName).not.toBe(getScene(stem(WITH!)).mapName)
  })
})
