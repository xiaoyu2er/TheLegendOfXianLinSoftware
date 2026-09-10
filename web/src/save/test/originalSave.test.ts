import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { javaSource } from '../../test/javaSource'
import { repoPath } from '../../test/repoPath'
import {
  CODECS,
  NEVER_READ_BACK_SOURCE,
  derivedNeverReadBack,
  HERO_FIELDS,
  ROLE_AND_MAP_EXPRS,
  SCENE_FIELDS,
  SEPARATOR,
  STOCK_ORDER,
  WORN_ORDER,
  fromRecorderText,
  javaReadLines,
  javaSplitExact,
  loaderLine,
  loaderRequestedLines,
  readSample,
  readTruth,
  recorderLayout,
  sampleNames,
  toRecorderText,
} from './originalSave'

const SAMPLES = sampleNames()

describe('原版存档解析器 —— 按原版读取器的实际读法', () => {
  it('真值目录里有样例（分母现扫，零份就红）', () => {
    expect(SAMPLES.length).toBeGreaterThan(0)
  })

  it('读取器请求的行号（源码现读）与每份真值记下的行号相同', () => {
    const lines = loaderRequestedLines()
    for (const name of SAMPLES) expect(readTruth(name).reads.map((r) => r.line), name).toEqual(lines)
  })

  it('每份样例、读取器请求的每一行，逐字段等于数据层真值', () => {
    let compared = 0
    for (const name of SAMPLES) {
      const text = readSample(name)
      const truth = readTruth(name)
      expect(javaReadLines(text).length, `${name} 物理行数`).toBe(truth.physicalLines)
      for (const r of truth.reads) {
        expect(loaderLine(text, r.line), `${name} 第 ${r.line} 行（${r.readBy.join('/')}）`).toEqual(r.fields)
        compared += r.fields.length
      }
    }
    // 「一个字段都没比」不许读成「全部相等」。
    expect(compared).toBeGreaterThan(0)
  })

  it('分隔符与 Loader.java 里那句 split 是同一个（xl-1dv.22：含 A 的值会劈开，今天数据零处，回到源码上守）', () => {
    const src = javaSource('src/start/Loader.java')
    const seps = [...src.matchAll(/line\.split\("([^"]*)"\)/g)].map((m) => m[1])
    expect(seps).toEqual([SEPARATOR])
  })

  it('split 照抄 Java 的完整语义：无匹配原样一项、有匹配丢末尾空串（xl-1dv.22 现跑的读数）', () => {
    expect(javaSplitExact('', 'A')).toEqual([''])
    expect(javaSplitExact('A', 'A')).toEqual([])
    expect(javaSplitExact('任务A文本A', 'A')).toEqual(['任务', '文本'])
    expect(javaSplitExact('aAAbAA', 'A')).toEqual(['a', '', 'b'])
  })
})

describe('「写了但从不读回」的名单从源码现推', () => {
  it('源码现推的名单与 NeverReadBack 的手签登记相同', () => {
    expect(derivedNeverReadBack()).toEqual(Object.values(NEVER_READ_BACK_SOURCE).sort())
  })

  it('答题记录的两个回填方法全仓零调用点（xl-1dv.20）', () => {
    const files = (readdirSync(repoPath('src'), { recursive: true }) as string[]).filter((f) => f.endsWith('.java'))
    const all = files.map((f) => javaSource(`src/${f}`)).join('\n')
    // 分母：声明恰好两处 —— 正则认得出这两个名字，零调用点才不是「搜不到」。
    expect([...all.matchAll(/void\s+(loadQuestion|loadAnswer)\s*\(/g)].length).toBe(2)
    expect([...all.matchAll(/\.(loadQuestion|loadAnswer)\s*\(/g)].map((m) => m[0])).toEqual([])
  })
})

describe('我们的格式装得下原版写档装置存的每一个字段', () => {
  it('写档装置写的列表（源码现读）与 CODECS 的登记双向相等', () => {
    const written = recorderLayout().flat().sort()
    expect(written.length).toBeGreaterThan(0)
    expect(Object.keys(CODECS).sort()).toEqual(written)
  })

  it('每份样例：按写法解析成 SaveFile，再按写法写回，与样例逐字符相同', () => {
    for (const name of SAMPLES) {
      const text = readSample(name)
      // 原版行尾跟平台走（BufferedWriter.newLine）；样例是 Windows 上存的。
      const eol = text.includes('\r\n') ? '\r\n' : '\n'
      expect(toRecorderText(fromRecorderText(text), eol), name).toBe(text)
    }
  })

  it('Recorder.save 里 roleAndMapInfo 那几项与登记同序', () => {
    const src = javaSource('src/start/Recorder.java')
    const exprs = [...src.matchAll(/roleAndMapInfo\.add\((.*?)\);/g)].map((m) => m[1]!.replace(/\s|""\+/g, ''))
    expect(exprs).toEqual([...ROLE_AND_MAP_EXPRS])
  })

  it('三个英雄的 saveRoleInfo 与登记同序', () => {
    for (const hero of ['ZhangXiaoFan', 'LuXueQi', 'YuJie']) {
      const src = javaSource(`src/battle/${hero}.java`)
      const body = src.slice(src.indexOf('saveRoleInfo()'), src.indexOf('return roleInfo'))
      const fields = [...body.matchAll(/roleInfo\.add\((\w+)\s*\+\s*""\)/g)].map((m) => m[1])
      expect(fields, hero).toEqual([...HERO_FIELDS])
    }
  })

  it('saveSceneInfo 与登记同序（连表达式）', () => {
    const src = javaSource('src/scene/SaveAndLoad.java')
    // 只收 `+` 两侧的空白（表达式跨行）；`" "` 引号里那个空格是字段值的一部分，不能吃。
    const exprs = [...src.matchAll(/sceneInfo\.add\(([\s\S]*?)\);/g)].map((m) =>
      m[1]!.replace(/\s*\+\s*/g, '+').trim().replace(/\+""$/, ''),
    )
    expect(exprs).toEqual(SCENE_FIELDS.map(([, e]) => e))
  })

  it('saveEquipInfo 每个英雄六格的次序与登记同序', () => {
    const src = javaSource('src/menu/EquipPanel.java')
    const body = src.slice(src.indexOf('saveEquipInfo()'), src.indexOf('return equipInfo'))
    expect([...body.matchAll(/if\s*\(\s*ep\.(\w+)\s*!=\s*null\s*\)/g)].map((m) => m[1])).toEqual([...WORN_ORDER])
  })

  it('saveEquipmentShopInfo 遍历六张表的次序与登记同序', () => {
    const src = javaSource('src/shop/EquipmentShopPanel.java')
    const body = src.slice(src.indexOf('saveEquipmentShopInfo()'), src.indexOf('return equipmentShopInfo'))
    expect([...body.matchAll(/EquipmentPack\.(\w+)List/g)].map((m) => m[1])).toEqual([...STOCK_ORDER])
  })
})
