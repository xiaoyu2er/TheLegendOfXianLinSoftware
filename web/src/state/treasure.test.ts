import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import type { SceneScript } from '../data/types'
import { javaSource } from '../test/javaSource'
import { TICK_MS, createWorld, initiate, step } from './step'
import { readTrace } from './trace'
import {
  PRESENT_DX,
  PRESENT_EXIT_LIMIT,
  PRESENT_IMAGE_MS,
  PRESENT_START_X,
  PRESENT_STOP_X,
  PRESENT_WORDS_MS,
  checkBoxes,
  createTreasure,
  drawString,
  tickTreasureTimers,
  toTreasureDraft,
  treasureCount,
  treasureKeyPressed,
  treasureText,
} from './treasure'
import type { TreasureDraft } from './treasure'
import type { InputEvent, World } from './types'

/**
 * 宝箱那一层**真值盖不到的分支**，以及把几个常量回到 GBK 源码上取。
 *
 * 主判据是 `traceReplay.test.ts` 的 `treasure` × 11 格逐 tick 对齐。它看不见
 * 的有三类，这个文件一类一段：
 *
 * 1. **常量**。滑入的步长 / 起止位置 / 两个定时器的间隔，一律从
 *    `src/scene/EquipmentEvent.java` 现读 —— 票面没有这些数字，这里也不许手写。
 * 2. **时间轴**。导出器的冻结定时器模式把这两个定时器推成什么节拍，从真值里
 *    现量，再与源码里的间隔对上（读数写在 `state/treasure.ts` 的头注）。
 * 3. **真值一次都没走到的分支**：同一个箱子按第二下、同时挨着两个箱子、
 *    走开之后 `near` 还是真、换一次场景箱子重新装满、掷骰只在真开箱时读。
 *    maze-treasure 全程只按了一下空格（t=742）、只开了一个箱子，这几条它都
 *    分辨不出来。
 *
 * ## 篡改记录（2026-09-10，cp 备份 → 改 → 跑 → 还原后 cmp）
 *
 * 「旧」= `traceReplay.test.ts`（逐 tick 对齐），「新」= 本文件 +
 * `scene/presentLayout.test.ts` + `game/session.test.ts`。
 *
 * | 篡改 | 旧 | 新 |
 * |---|---|---|
 * | 滑动间隔 50→60 / 逐字间隔 100→90 | 红 | 红 |
 * | 退场那一支下界 352→384（退场头一拍只 +32） | 红 | 红 |
 * | `near` 走开就落回假 | 绿 | 红 |
 * | 开过的箱子照样再给 | 绿 | 红 |
 * | 掷骰挪到判空之前 | 绿 | 红 |
 * | 换场景不新建 EquipmentEvent | 红 | 红 |
 * | 答对答错不弹提示框 | 红 | 绿 |
 * | loop 不在开箱那拍停批 / session 不记进背包 | 绿 | 红 |
 * | 提示语少两个空格 | 红 | 红 |
 * | 提示框上边 288→290 / 宝箱镜头单位 8→16 | 绿 | 红 |
 * | **两个定时器组内次序对调** | 绿 | 绿 |
 * | **整组定时器挪到 NPC 之后** | 绿 | 绿 |
 *
 * 最后两条是「这一场观测不到」，不是判据失灵：两个定时器互相 `start()` 对方时
 * 被起的那个到期是 `此刻 + 间隔`，当拍不会触发；它们也只碰 `EquipmentEvent`
 * 自己的字段，与 NPC 那组互不相干（与 `select.ts` 的 `tickSelectTimers` 同形）。
 * 另有一条「第三个 `if` 改成 `else if`」头一轮两边都绿，追下去是**篡改本身
 * 等价**：那个 `else` 挂在了第二个 `if (x == 352)` 上，行为一个字没变 ——
 * 换成上面那条改下界的，两边都红。
 */

/** 一句 Java 语句在源码里可能折过行，比之前把空白挤掉。空文件是硬失败。 */
function javaStatements(file: string): string {
  const source = javaSource(file).replace(/\s+/g, ' ')
  if (source.length === 0) throw new Error(`${file} 读出来是空的`)
  return source
}

const EQUIPMENT_EVENT = 'src/scene/EquipmentEvent.java'
const TREASURE_BOX = 'src/scene/TreasureBox.java'

/** 正则在源码里取出唯一一处匹配的第一个捕获组。零处或多处都是硬失败。 */
function only(source: string, pattern: RegExp, what: string): string {
  const hits = [...source.matchAll(new RegExp(pattern.source, 'g'))]
  if (hits.length !== 1) throw new Error(`${what}：源码里匹配到 ${hits.length} 处，应为 1 处`)
  return hits[0]![1]!
}

describe('常量从 GBK 源码现读', () => {
  const src = javaStatements(EQUIPMENT_EVENT)

  it('两个定时器的间隔', () => {
    expect(
      Number(only(src, /new Timer\(tools\.Clock\.delay\((\d+)\), new PresentImage\(\)\)/, '滑动定时器')),
    ).toBe(PRESENT_IMAGE_MS)
    expect(
      Number(only(src, /new Timer\(tools\.Clock\.delay\((\d+)\), new WordsRun\(\)\)/, '逐字定时器')),
    ).toBe(PRESENT_WORDS_MS)
  })

  it('起点、停点、步长、退场上界', () => {
    expect(Number(only(src, /x_presentImage = (-?\d+);/, 'drawString 里的起点'))).toBe(
      PRESENT_START_X,
    )
    expect(Number(only(src, /if \(x_presentImage == (\d+)\)/, '停下起打字机的那一格'))).toBe(
      PRESENT_STOP_X,
    )
    // 进场与退场两句 `+= 32`，恰好两处，两处同一个数。
    const steps = [...src.matchAll(/x_presentImage \+= (\d+);/g)].map((m) => Number(m[1]))
    expect(steps).toEqual([PRESENT_DX, PRESENT_DX])
    // 第一个 `if` 的上界就是停点（`<= 352`），第三个 `if` 两头是停点与退场上界。
    expect(Number(only(src, /if \(x_presentImage <= (\d+)\) \{/, '进场那一支'))).toBe(PRESENT_STOP_X)
    const exit = src.match(/if \(x_presentImage > (\d+) && x_presentImage <= (\d+)\)/)
    expect(exit, '退场那一支的形状变了').not.toBeNull()
    expect([Number(exit![1]), Number(exit![2])]).toEqual([PRESENT_STOP_X, PRESENT_EXIT_LIMIT])
    expect(Number(only(src, /else if \(x_presentImage >= (\d+)\)/, '停下的那一支'))).toBe(
      PRESENT_EXIT_LIMIT,
    )
  })

  it('开箱给几个、提示语怎么拼', () => {
    const box = javaStatements(TREASURE_BOX)
    // `int i = 1 + (int) (2 * Math.random());` —— 从源码取出 1 与 2 两个数，
    // 再拿掷骰的两个极端核 `treasureCount`。
    const [, base, span] = box.match(/int i = (\d+) \+ \(int\) \((\d+) \* Math\.random\(\)\);/) ?? []
    expect(base, '掷骰那一句的形状变了').toBeDefined()
    expect(treasureCount(() => 0)).toBe(Number(base))
    expect(treasureCount(() => 0.999999)).toBe(Number(base) + Number(span) - 1)
    // 拼法：`"得到" + treasureName + " * " + i`。
    const [, head, mid] = box.match(/drawString\("([^"]*)" \+ treasureName \+ "([^"]*)" \+ i\)/) ?? []
    expect(head, '提示语那一句的形状变了').toBeDefined()
    expect(treasureText('金疮药', 2)).toBe(`${head}金疮药${mid}2`)
  })
})

describe('冻结定时器把滑入推成什么节拍 —— 从真值里量', () => {
  /**
   * 量的是 maze-treasure：开箱那一下之后 `x` 每隔几拍变一次、`wordNo` 每隔几拍
   * 变一次、第一格落在按键之后第几拍。分母是那条真值自己，不写死 tick 号。
   */
  const trace = readTrace('maze-treasure')
  const ticks = trace.ticks
  const press = ticks.findIndex((t) => t.input.some((e) => e.k === 'space') && t.treasure.presenting)

  /** 某个字段相邻两次变化之间隔了几拍（取全部间隔的集合）。 */
  function gaps(from: number, pick: (i: number) => number): { first: number; gaps: Set<number> } {
    const changes: number[] = []
    for (let i = from + 1; i < ticks.length; i++) if (pick(i) !== pick(i - 1)) changes.push(i)
    const set = new Set<number>()
    for (let k = 1; k < changes.length; k++) set.add(changes[k]! - changes[k - 1]!)
    return { first: (changes[0] ?? -1) - from, gaps: set }
  }

  it('开箱那一拍提示框就在 -320，第一格落在一个滑动间隔之后', () => {
    expect(press, 'maze-treasure 里找不到开箱那一下').toBeGreaterThan(0)
    expect(ticks[press]!.treasure.x).toBe(PRESENT_START_X)
    const x = gaps(press, (i) => ticks[i]!.treasure.x)
    // drawString 在输入那一段调，`start()` 把到期设成 此刻 + 50 —— 所以是 5 拍。
    expect(x.first).toBe(PRESENT_IMAGE_MS / trace.script.tickMs)
    // 进场与退场都是每 5 拍一格；中间停着打字的那一大段不是"一格"，要剔掉。
    const moveTicks = ticks
      .map((t, i) => ({ t, i }))
      .filter(({ t, i }) => i > press && t.treasure.x !== ticks[i - 1]!.treasure.x)
      .map(({ i }) => i)
    const moveGaps = new Set<number>()
    for (let k = 1; k < moveTicks.length; k++) {
      const g = moveTicks[k]! - moveTicks[k - 1]!
      if (ticks[moveTicks[k - 1]!]!.treasure.x !== PRESENT_STOP_X) moveGaps.add(g)
    }
    expect([...moveGaps]).toEqual([PRESENT_IMAGE_MS / trace.script.tickMs])
  })

  it('逐字每 10 拍一个，退场头一拍 +64，终点 1056', () => {
    const w = gaps(press, (i) => ticks[i]!.treasure.wordNo)
    expect(w.gaps.size, '一个字都没吐').toBeGreaterThan(0)
    expect([...w.gaps]).toEqual([PRESENT_WORDS_MS / trace.script.tickMs])
    // 退场：从停点起的第一格。
    const resume = ticks.findIndex(
      (t, i) => i > press && ticks[i - 1]!.treasure.x === PRESENT_STOP_X && t.treasure.x !== PRESENT_STOP_X,
    )
    expect(resume, '真值里没有退场').toBeGreaterThan(press)
    expect(ticks[resume]!.treasure.x - PRESENT_STOP_X).toBe(2 * PRESENT_DX)
    const last = ticks[ticks.length - 1]!.treasure
    expect(last.x).toBe(PRESENT_EXIT_LIMIT + PRESENT_DX)
    expect(last.moving).toBe(false)
    // 滑出去之后 `isDrawString` 仍然是真 —— 原版没有一句把它落回假。
    expect(last.presenting).toBe(true)
  })
})

/** 一份只含宝箱段的场景，给真值里不存在的摆法用。其余字段取迷宫1 的。 */
function withBoxes(rows: string[][]): SceneScript {
  return { ...getScene('迷宫1'), treasureBox: rows }
}

/** 把两个定时器一直跑到都停下来，返回停下的时刻。 */
function settle(d: TreasureDraft, from = 0): number {
  let now = from
  for (let i = 0; i < 10000; i++) {
    if (!d.presentImageMove.running && !d.wordsRun.running) return now
    now += TICK_MS
    tickTreasureTimers(d, now)
  }
  throw new Error('提示框一万拍还没停')
}

describe('真值走不到的分支', () => {
  it('同一个箱子按第二下：不给东西、不掷骰、提示框不重来', () => {
    const d = toTreasureDraft(createTreasure(withBoxes([['5/5', '金疮药']])))
    checkBoxes(d, 5, 4)
    let rolls = 0
    const random = (): number => {
      rolls++
      return 0.5
    }
    expect(treasureKeyPressed(d, 'space', 0, random)).toEqual([{ name: '金疮药', count: 2 }])
    expect(rolls).toBe(1)
    const end = settle(d)
    const before = { x: d.x, wordNo: d.wordNo, text: d.text }
    expect(treasureKeyPressed(d, 'space', end, random)).toEqual([])
    expect(rolls, '开过的箱子又掷了一次骰').toBe(1)
    expect({ x: d.x, wordNo: d.wordNo, text: d.text }).toEqual(before)
    expect(d.presentImageMove.running).toBe(false)
  })

  it('没挨着的箱子、别的键：一个都不开', () => {
    const d = toTreasureDraft(createTreasure(withBoxes([['5/5', '金疮药']])))
    // 对角线不算四邻。
    checkBoxes(d, 4, 4)
    expect(treasureKeyPressed(d, 'space', 0, () => 0)).toEqual([])
    checkBoxes(d, 6, 5)
    expect(treasureKeyPressed(d, 'enter', 0, () => 0)).toEqual([])
    expect(d.boxes![0]!.empty).toBe(false)
  })

  it('near 只置真不置回假：走开之后照样开得了', () => {
    const d = toTreasureDraft(createTreasure(withBoxes([['5/5', '金疮药']])))
    checkBoxes(d, 5, 6)
    checkBoxes(d, 20, 20)
    expect(d.boxes![0]!.near).toBe(true)
    expect(treasureKeyPressed(d, 'space', 0, () => 0)).toEqual([{ name: '金疮药', count: 1 }])
  })

  it('同时挨着两个箱子：一下空格两个都开，提示框是后一句', () => {
    const d = toTreasureDraft(createTreasure(withBoxes([['5/5', '金疮药'], ['7/5', '灵芝草']])))
    checkBoxes(d, 6, 5)
    const rolls = [0, 0.9]
    const gains = treasureKeyPressed(d, 'space', 0, () => rolls.shift()!)
    expect(gains).toEqual([
      { name: '金疮药', count: 1 },
      { name: '灵芝草', count: 2 },
    ])
    expect(d.text).toBe(treasureText('灵芝草', 2))
    expect(d.boxes!.map((b) => b.empty)).toEqual([true, true])
  })

  it('滑动中再弹一次：x 与游标从头来，定时器的到期时刻不变', () => {
    const d = toTreasureDraft(createTreasure(withBoxes([['5/5', '金疮药']])))
    drawString(d, '得到金疮药 * 1', 0)
    for (let now = TICK_MS; now <= 3 * PRESENT_IMAGE_MS; now += TICK_MS) tickTreasureTimers(d, now)
    const due = d.presentImageMove.dueMs
    drawString(d, '回答错误，扣掉600个金币', 3 * PRESENT_IMAGE_MS)
    expect(d.x).toBe(PRESENT_START_X)
    expect(d.wordNo).toBe(0)
    expect(d.presentImageMove.dueMs, 'start() 对在跑的定时器重新计时了').toBe(due)
  })

  it('换一次场景，箱子重新装满、提示框收掉 —— EquipmentEvent 跟着 initiation 新建', () => {
    let world: World = { ...createWorld(getScene('迷宫1'), false) }
    world = { ...world, role: { ...world.role, px: 4 * 32, py: 16 * 32 } }
    const space: InputEvent = { e: 'press', k: 'space', ctrl: false }
    world = step(world, [], TICK_MS)
    world = step(world, [space], TICK_MS, undefined, () => 0)
    expect(world.treasureRequest).toEqual([{ name: '金疮药', count: 1 }])
    expect(world.treasure.boxes!.some((b) => b.empty)).toBe(true)
    // 下一拍它就落回 null：只亮一拍。
    expect(step(world, [], TICK_MS).treasureRequest).toBeNull()

    const again = initiate(world, getScene('迷宫1'))
    expect(again.treasure.boxes!.every((b) => !b.empty && !b.near)).toBe(true)
    expect(again.treasure.presenting).toBe(false)
  })

  it('没有宝箱段的场景：boxes 是 null 不是 []，按空格什么都不开', () => {
    let world = createWorld(getScene('宿舍'), false)
    expect(getScene('宿舍').treasureBox).toBeNull()
    expect(world.treasure.boxes).toBeNull()
    let rolls = 0
    world = step(world, [{ e: 'press', k: 'space', ctrl: false }], TICK_MS, undefined, () => {
      rolls++
      return 0
    })
    expect(world.treasureRequest).toBeNull()
    expect(world.treasure.presenting).toBe(false)
    expect(rolls, '没有宝箱的场景按空格也掷了骰').toBe(0)
  })

  it('坐标写法不是原版 Integer.parseInt 认的整数：硬失败，不宽松解析', () => {
    expect(() => createTreasure(withBoxes([['5abc/4', '金疮药']]))).toThrow(/原版要的是/)
    expect(() => createTreasure(withBoxes([['5/4/1', '金疮药']]))).toThrow(/原版要的是/)
    expect(createTreasure(withBoxes([['+5/4', '金疮药']])).boxes![0]!.x).toBe(5)
  })
})
