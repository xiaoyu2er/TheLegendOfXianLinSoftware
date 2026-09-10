import { describe, expect, it } from 'vitest'
import { javaSource } from '../../test/javaSource'
import {
  HERO_FIELDS,
  JavaNumberFormatException,
  LOAD_PARSERS,
  SCENE_FIELDS,
  equipmentShopReads,
  fromRecorderText,
  javaReadLines,
  loaderReadBack,
  readSample,
  sampleNames,
} from './originalSave'
import type { LoadParser } from './originalSave'

/**
 * 原版读档回填的**解法**（xl-i06.10）：哪一项用 `Integer.parseInt`、哪一项用
 * `Boolean.parseBoolean`、哪一项用**手写的** `equals("true")`。三方对撞：
 *
 * 1. 手写登记 `LOAD_PARSERS` ↔ GBK 源码现读；
 * 2. 手写登记 ↔ `loaderReadBack` 的实际行为 —— 把样例里那一项改成一个**两种写法会给出
 *    不同答案**的值（`TRUE`、`+7`、` 7`），看它解出来是什么。
 *
 * 为什么非要第 2 条：三份样例里全是原版自己写出来的 `true` / `false`，`equals` 与
 * `parseBoolean` 在它们身上结果一样 —— 逐 tick 的真值分辨不出「照抄了」与「顺手统一了」。
 */

/** 一个方法体：从签名到下一个方法签名（或文件尾）。 */
function methodBody(file: string, signature: string): string {
  const src = javaSource(file).replace(/\r/g, '')
  const from = src.indexOf(signature)
  if (from < 0) throw new Error(`${file} 里找不到 ${signature}`)
  const next = src.slice(from + signature.length).search(/\n\t(public|private|protected|boolean|void)\b/)
  return next < 0 ? src.slice(from) : src.slice(from, from + signature.length + next)
}

/**
 * 在方法体里认出 `<receiver>.get(N)` 的每一处用法，按 N 归成一种解法。认不出的用法
 * 与同一项被两种写法解都是**抛**，不是跳过 —— 跳过就会让「多出一种写法」安安静静地绿。
 */
function parsersIn(body: string, receiver: string): LoadParser[] {
  const out: LoadParser[] = []
  const flat = body.replace(/\s+/g, '')
  const re = new RegExp(`${receiver}\\.get\\((\\d+)\\)`, 'g')
  let seen = 0
  for (const m of flat.matchAll(re)) {
    seen++
    const before = flat.slice(0, m.index)
    const after = flat.slice(m.index! + m[0].length)
    const p: LoadParser | null = before.endsWith('Integer.parseInt(')
      ? 'parseInt'
      : before.endsWith('Boolean.parseBoolean(')
        ? 'parseBoolean'
        : after.startsWith('.equals("true")')
          ? 'equalsTrue'
          : after.startsWith('.split("")')
            ? 'split'
            : before.endsWith('.initiation(')
              ? 'raw'
              : null
    if (p === null) throw new Error(`认不出这一处用法：…${before.slice(-30)}【${m[0]}】${after.slice(0, 30)}…`)
    const i = Number(m[1])
    if (out[i] !== undefined && out[i] !== p) throw new Error(`第 ${i} 项被解了两种写法：${out[i]} 与 ${p}`)
    out[i] = p
  }
  if (seen === 0) throw new Error(`方法体里一处 ${receiver}.get(N) 都没认出来 —— 不是「一项都不解」`)
  return out
}

describe('哪一项用哪种解法：手写登记与 GBK 源码现读', () => {
  it('场景那一行（SaveAndLoad.loadSceneInfo）', () => {
    const body = methodBody('src/scene/SaveAndLoad.java', 'public void loadSceneInfo')
    expect(parsersIn(body, 'sceneInfo')).toEqual([...LOAD_PARSERS.scene])
  })

  it('三个英雄（intialFromInfo ×3，三个类逐个现读）', () => {
    for (const file of ['src/battle/ZhangXiaoFan.java', 'src/battle/LuXueQi.java', 'src/battle/YuJie.java']) {
      const body = methodBody(file, 'public void intialFromInfo()')
      expect(parsersIn(body, 'roleInfo'), file).toEqual([...LOAD_PARSERS.hero])
    }
  })

  it('队伍三开关（Loader.load 末三行）', () => {
    const body = methodBody('src/start/Loader.java', 'public void load(int textcode)')
    expect(parsersIn(body, 'getTextInfo\\(textcode\\)')).toEqual([...LOAD_PARSERS.party])
  })

  it('三种写法今天真的都在用 —— 登记里每一种至少出现一次', () => {
    const all = new Set([...LOAD_PARSERS.scene, ...LOAD_PARSERS.hero, ...LOAD_PARSERS.party])
    expect([...all].sort()).toEqual(['equalsTrue', 'parseBoolean', 'parseInt', 'raw', 'split'])
  })
})

/** 把样例第 `line` 行（从 1 数）第 `i` 项换成 `token`，其余一个字节不动。 */
function patch(text: string, line: number, i: number, token: string): string {
  const lines = javaReadLines(text)
  const parts = lines[line - 1]!.split('A')
  if (i >= parts.length - 1) throw new Error(`第 ${line} 行没有第 ${i} 项`)
  parts[i] = token
  lines[line - 1] = parts.join('A')
  return lines.join('\r\n') + '\r\n'
}

/** 一种解法在「分得开的值」上各该给出什么。`throws` = 抛 NumberFormatException。 */
const PROBES: Readonly<Record<LoadParser, readonly (readonly [string, unknown])[]>> = {
  // 原版写出来的是 `true`；大小写不对，手写比较就不认。
  equalsTrue: [
    ['true', true],
    ['TRUE', false],
    ['True', false],
  ],
  // parseBoolean 不分大小写、且从不抛。
  parseBoolean: [
    ['true', true],
    ['TRUE', true],
    ['yes', false],
  ],
  // parseInt 认一个前导 + 号，不认空格。
  parseInt: [
    ['+7', 7],
    ['-7', -7],
    [' 7', 'throws'],
    ['7.0', 'throws'],
  ],
  raw: [['别的.txt', '别的.txt']],
  split: [['a b c', ['a', 'b', 'c']]],
}

describe('loaderReadBack 真的按登记的写法解（逐项篡改样例）', () => {
  const base = readSample('存档1.txt')

  function check(line: number, i: number, parser: LoadParser, pick: (r: ReturnType<typeof loaderReadBack>) => unknown) {
    for (const [token, want] of PROBES[parser]) {
      const text = patch(base, line, i, token)
      if (want === 'throws') {
        expect(() => loaderReadBack(text), `第 ${line} 行第 ${i} 项 ${JSON.stringify(token)}`).toThrow(JavaNumberFormatException)
      } else {
        expect(pick(loaderReadBack(text)), `第 ${line} 行第 ${i} 项 ${JSON.stringify(token)}`).toEqual(want)
      }
    }
  }

  it('场景那一行的十项', () => {
    LOAD_PARSERS.scene.forEach((parser, i) => {
      const key = SCENE_FIELDS[i]![0]
      check(5, i, parser, (r) => r.scene[key])
    })
  })

  it('三个英雄各七项', () => {
    const keys = ['zhangXiaoFan', 'luXueQi', 'yuJie'] as const
    keys.forEach((hero, h) => {
      LOAD_PARSERS.hero.forEach((parser, i) => check(2 + h, i, parser, (r) => r.heroes[hero][HERO_FIELDS[i]!]))
    })
  })

  it('队伍三开关', () => {
    const keys = ['zhang', 'lu', 'wen'] as const
    LOAD_PARSERS.party.forEach((parser, i) => check(1, i, parser, (r) => r.party[keys[i]!]))
  })
})

describe('三份样例：原版读取器的读法与写档装置的写法读出来的是同一回事', () => {
  it('分母现数；读得回来的那一半逐字段相等', () => {
    const names = sampleNames()
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      const text = readSample(name)
      const written = fromRecorderText(text)
      const { party, heroes, scene, worn, drugs, coins } = written
      expect(loaderReadBack(text), name).toEqual({ party, heroes, scene, worn, drugs, coins })
    }
  })
})

describe('装备店那一行：解是解了，下标是跳着走的（xl-1dv.32）', () => {
  it('与 xl-1dv.32 的真 JVM 读数一致：偶数下标 0..10 与 12..38', () => {
    const even = (from: number, to: number) => Array.from({ length: (to - from) / 2 + 1 }, (_, k) => from + 2 * k)
    expect(equipmentShopReads()).toEqual([...even(0, 10), ...even(12, 38)])
  })

  it('读到的下标上放一个不是整数的值，整个读档抛；没读到的下标上放，照样读得回来', () => {
    const base = readSample('存档1.txt')
    expect(() => loaderReadBack(patch(base, 8, 12, 'x'))).toThrow(JavaNumberFormatException)
    expect(() => loaderReadBack(patch(base, 8, 1, 'x'))).not.toThrow()
    expect(() => loaderReadBack(patch(base, 8, 40, 'x'))).not.toThrow()
  })
})
