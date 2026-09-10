import { describe, expect, it } from 'vitest'
import { EQUIP_SLOTS, EQUIPMENT_LISTS, type EquipSlot } from '../menu/equipment'
import {
  HERO_KEYS,
  SAVE_VERSION,
  SaveFormatError,
  parseSave,
  readBack,
  serializeSave,
  type NeverReadBack,
  type SaveFile,
} from './format'
import {
  EQUIPMENT_TOTAL,
  encodeHero,
  encodeScene,
  encodeShop,
  encodeWorn,
  fromRecorderText,
  readSample,
  readTruth,
  sampleNames,
} from './test/originalSave'

/**
 * **今天认识哪些版本 —— 手写登记。** 加一个版本号就得来这里签一笔；
 * `SAVE_VERSION` 变了而这里没签，下面第一条就红。
 */
const KNOWN_VERSIONS: readonly number[] = [1]

/** 样例按原版写档装置解析出来的 SaveFile —— 真值来自原版真的存出来的档，不是我们造的。 */
const SAMPLES = sampleNames().map((name) => ({ name, save: fromRecorderText(readSample(name)) }))

function withVersion(v: unknown): string {
  return JSON.stringify({ ...SAMPLES[0]!.save, version: v })
}

describe('版本号', () => {
  it('当前版本号在手写登记里，且登记里每个版本都读得进来', () => {
    expect(KNOWN_VERSIONS).toContain(SAVE_VERSION)
    for (const v of KNOWN_VERSIONS) expect(parseSave(withVersion(v)).version).toBe(v)
  })

  it('登记之外的版本号一律抛，不许默认', () => {
    const unknown = [0, Math.max(...KNOWN_VERSIONS) + 1, -1, 1.5, '1', null, true]
    for (const v of unknown) {
      expect(KNOWN_VERSIONS).not.toContain(v)
      expect(() => parseSave(withVersion(v)), JSON.stringify(v)).toThrow(SaveFormatError)
    }
    expect(() => parseSave(withVersion(2))).toThrow(/不认识的存档版本号 2：这一版只认 1/)
  })

  it('版本号缺失也抛（缺失不是「默认当前版」）', () => {
    const { version: _v, ...rest } = SAMPLES[0]!.save
    expect(() => parseSave(JSON.stringify(rest))).toThrow(/不认识的存档版本号 undefined/)
  })
})

describe('形状不对就抛，不修补', () => {
  it.each([
    ['不是 JSON', '{', /不是合法的 JSON/],
    ['顶层是数组', '[]', /顶层不是对象/],
  ])('%s', (_what, text, re) => {
    expect(() => parseSave(text)).toThrow(re)
  })

  it.each([
    ['英雄等级是字符串', (s: any) => (s.heroes.yuJie.level = '8'), /heroes\.yuJie\.level 不是整数/],
    ['少一个英雄', (s: any) => delete s.heroes.luXueQi, /heroes\.luXueQi 不是对象/],
    ['剧情三元组只有两段', (s: any) => (s.scene.currentScript = ['a', 'b']), /scene\.currentScript 不是三个字符串/],
    ['装备格子是数', (s: any) => (s.worn[1].glove = 0), /worn\[1\]\.glove 不是字符串或 null/],
    ['少了答题记录', (s: any) => delete s.neverReadBack.answers, /neverReadBack\.answers 不是布尔数组的数组/],
  ])('%s', (_what, mutate, re) => {
    const s = JSON.parse(serializeSave(SAMPLES[0]!.save))
    mutate(s)
    expect(() => parseSave(JSON.stringify(s))).toThrow(re)
  })
})

/** 开机那一刻的值：答题记录是空表，装备库存全 0（EquipmentPack 里各件 numberGOT 的初值）。 */
const BOOT: NeverReadBack = {
  equipmentStock: Object.fromEntries(EQUIP_SLOTS.map((s) => [s, EQUIPMENT_LISTS[s].map(() => 0)])) as Record<EquipSlot, number[]>,
  questionMaps: [],
  answers: [],
}

/** 与任何样例都不同的「读档前的值」—— 中途读档时手上那一局的残留。 */
const MIDGAME: NeverReadBack = {
  equipmentStock: Object.fromEntries(EQUIP_SLOTS.map((s) => [s, EQUIPMENT_LISTS[s].map(() => 77)])) as Record<EquipSlot, number[]>,
  questionMaps: ['探针地图.txt'],
  answers: [[true, true]],
}

const nonZero = (n: NeverReadBack): number => EQUIP_SLOTS.reduce((k, s) => k + n.equipmentStock[s].filter((x) => x !== 0).length, 0)

describe('存全套：存出去的内容里，原版读不回来的那几组确实非空', () => {
  // 期望值取自数据层真值（原版 Loader 读出来的第 8 / 9 行），不取自我们自己的解析。
  const expected = SAMPLES.map(({ name }) => {
    const reads = readTruth(name).reads
    const line = (n: number) => reads.find((r) => r.line === n)!.fields
    return {
      name,
      stockNonZero: line(8).slice(0, EQUIPMENT_TOTAL).filter((f) => f !== '0').length,
      questionMaps: line(8).slice(EQUIPMENT_TOTAL),
      answerCount: line(9).filter((f) => f !== '').length,
    }
  })

  it('三组各至少有一份样例是非空的（否则这一段什么都没验）', () => {
    expect(expected.some((e) => e.stockNonZero > 0)).toBe(true)
    expect(expected.some((e) => e.questionMaps.length > 0)).toBe(true)
    expect(expected.some((e) => e.answerCount > 0)).toBe(true)
  })

  it.each(SAMPLES)('$name：序列化之后的文本里那几组与原版读出来的一致', ({ name, save }) => {
    const e = expected.find((x) => x.name === name)!
    // 直接读序列化出来的 JSON，不经 parseSave —— 验的是「存出去了」，不是往返。
    const written = JSON.parse(serializeSave(save)).neverReadBack as NeverReadBack
    expect(nonZero(written)).toBe(e.stockNonZero)
    expect(written.questionMaps).toEqual(e.questionMaps)
    expect(written.answers.length).toBe(e.answerCount)
  })
})

describe('读一半：读回来之后，那几组是读档前的值，一个字都不取自存档', () => {
  const rich = SAMPLES.filter(({ save }) => nonZero(save.neverReadBack) > 0 || save.neverReadBack.questionMaps.length > 0)

  it('有样例的那几组非空（否则「没取自存档」与「存档里本来就是空的」分不开）', () => {
    expect(rich.length).toBeGreaterThan(0)
  })

  it.each(rich)('$name：开机读档 → 回到初值', ({ save }) => {
    const back = readBack(parseSave(serializeSave(save)), BOOT)
    expect(back.neverReadBack).toEqual(BOOT)
    expect(back.neverReadBack).not.toEqual(save.neverReadBack)
  })

  it.each(rich)('$name：中途读档 → 保持读档前的值（原版那几份是 static，读档不回填也不清空）', ({ save }) => {
    const back = readBack(parseSave(serializeSave(save)), MIDGAME)
    expect(back.neverReadBack).toEqual(MIDGAME)
  })

  it('摘要那两项（地图名、任务）不进读回的状态', () => {
    const back = readBack(SAMPLES[0]!.save, BOOT) as unknown as Record<string, unknown>
    expect(Object.keys(back).sort()).toEqual(['coins', 'drugs', 'heroes', 'neverReadBack', 'party', 'scene', 'worn'])
  })
})

describe('读回来的那一半与原版读取器读到的逐字段相同', () => {
  it.each(SAMPLES)('$name', ({ name, save }) => {
    const reads = readTruth(name).reads
    const by = (who: string) => reads.find((r) => r.readBy.includes(who))!.fields
    const back = readBack(parseSave(serializeSave(save)), BOOT)
    const heroLists = ['zhangXiaoFanInfo', 'luXueQiInfo', 'yuJieInfo']
    HERO_KEYS.forEach((k, i) => expect(encodeHero(back.heroes[k]), k).toEqual(by(heroLists[i]!)))
    expect(encodeScene(back.scene)).toEqual(by('sceneInfo'))
    expect(encodeWorn(back.worn)).toEqual(by('menuInfo'))
    expect(encodeShop(back.drugs, back.coins)).toEqual(by('shopInfo'))
    // 第 1 行只取前三项进状态（Loader.load 末三行 parseBoolean）。
    expect([back.party.zhang, back.party.lu, back.party.wen].map(String)).toEqual(by('getTextInfo()').slice(0, 3))
  })
})

describe('往返', () => {
  // 按构造成立（我存什么就读回什么），只防序列化本身出错；不是对齐原版的判据。
  it.each(SAMPLES)('$name', ({ save }) => {
    expect(parseSave(serializeSave(save))).toEqual(save satisfies SaveFile)
  })
})
