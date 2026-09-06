import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { dialogueScriptOf } from './dialogue'
import { TICK_MS, createWorld, step } from './step'
import { readTrace, sceneNameOf } from './trace'
import type { World } from './types'

/**
 * 对话层里**真值管不到的那几条**。
 *
 * 逐字打印本身、对话的推进与结束、头像与名字，全部由
 * `traceReplay.test.ts` 逐 tick 对着原版跑出来的 trace 断言 —— 那才是这一层
 * 的主判据，这里不重复。这个文件只装两样东西：
 *
 * 1. **原版没有、这一票加出来的**跳过逐字打印（真值里的空格永远只在句子打完
 *    之后才按，所以它一次都踩不到）；
 * 2. **原版有、但三份真值恰好没走到的**分支：选择框会截胡 NPC 的口头语。
 *
 * 两样都尽量把期望值挂回真值或挂回数据，不手写"应该是 5"这种数字。
 */
describe('跳过逐字打印（原版没有的加法）', () => {
  /**
   * 判据不是"跳完看着差不多"，而是**跳过之后的状态与等它自己打完完全一致**。
   *
   * 期望值来自真值：拿 dorm-walk 回放到那句口头语正打到一半，分两条路走 ——
   * 一条按跳过键，一条照着真值继续喂 tick 直到原版自己打完 —— 然后比游标。
   * 手写期望在这里是没有意义的：整句多长、要打多少拍，都是原版说了算。
   */
  it('跳过之后的游标与"等它自己打完"逐字段相同', () => {
    const trace = readTrace('dorm-walk')
    const scene = getScene(sceneNameOf(trace))
    let world = createWorld(scene, trace.script.isScript)

    // 走到"正在逐字打印、但还没打完"的第一个 tick。
    let t = 0
    for (; t < trace.ticks.length; t++) {
      const tick = trace.ticks[t]!
      world = step(world, tick.input, trace.script.tickMs, { narratage: tick.narratage.active })
      const d = world.dialogue
      if (d.printing && d.cursor > 0 && !d.sentenceOver && !d.pageOver) break
    }
    // 找不到这样的 tick 就不是"没什么可测的"，是这份真值不再覆盖逐字打印了。
    expect(t).toBeLessThan(trace.ticks.length)

    // 一条路：按一下跳过键。
    const skipped = step(world, [{ e: 'press', k: 'skip', ctrl: false }], TICK_MS, {
      narratage: false,
    })

    // 另一条路：照着真值继续喂，直到原版自己把这一句打完。
    let waited = world
    for (let i = t + 1; i < trace.ticks.length; i++) {
      const tick = trace.ticks[i]!
      waited = step(waited, tick.input, trace.script.tickMs, { narratage: tick.narratage.active })
      if (waited.dialogue.sentenceOver || waited.dialogue.pageOver) break
    }

    expect(cursorOf(skipped)).toEqual(cursorOf(waited))
    // 而且真的跳过了 —— 不是"两条路都还没开始打"。
    expect(skipped.dialogue.cursor).toBeGreaterThan(world.dialogue.cursor)
    expect(skipped.dialogue.sentenceOver || skipped.dialogue.pageOver).toBe(true)
  })

  it('对话框还在滑入（还没开始打字）时按跳过键什么都不会发生', () => {
    const trace = readTrace('dorm-walk')
    const scene = getScene(sceneNameOf(trace))
    let world = createWorld(scene, trace.script.isScript)
    let t = 0
    for (; t < trace.ticks.length; t++) {
      const tick = trace.ticks[t]!
      world = step(world, tick.input, trace.script.tickMs, { narratage: tick.narratage.active })
      // 对话开了、但弹出动画还没播完。
      if (world.dialogue.oral && !world.dialogue.printing) break
    }
    expect(t).toBeLessThan(trace.ticks.length)

    const skipped = step(world, [{ e: 'press', k: 'skip', ctrl: false }], TICK_MS, {
      narratage: false,
    })
    const idle = step(world, [], TICK_MS, { narratage: false })
    // 跳过键不能把弹出动画一起跳掉：那会让 isPrint 提前变真，而 isPrint 什么
    // 时候变真是逐 tick 对着真值断言的。
    expect(cursorOf(skipped)).toEqual(cursorOf(idle))
  })
})

describe('选择框会截胡 NPC 的口头语', () => {
  /**
   * `NPCEvent.checkNPCOral` 里那句 `if (!selectEvent.checkSelectEvent(i))`。
   *
   * 选择框本身是别的票，但漏掉这道拦截**不会表现为"少了个面板"，而是"多了句
   * 口头语"** —— 走到药店大夫跟前按空格，原版弹的是"要不要进医院"，
   * Web 版会弹一句"我的药，你放心！！！"。两者都是一个对话框，肉眼分不出谁对。
   *
   * 三份真值走不到这里（宿舍与大地图都没有选择数据），所以只能这么测。
   * 两头都验：截胡的那个 NPC 不说话，**而同一个夹具在没有选择数据时会说话**
   * —— 否则"拦住了"和"这个 NPC 本来就说不了话"长得一模一样。
   */
  const SCENE = '金陵大学医院'

  /** 主角站到 NPC 那一格（原版四个贴身位里的 `x1 == x2 && y1 == y2` 那个）。 */
  function facingTheDoctor(world: World): World {
    const npc = world.npcs[0]!
    return { ...world, role: { ...world.role, px: npc.x * 32, py: npc.y * 32 } }
  }

  it('挂着选择框的 NPC 按空格不说口头语', () => {
    const scene = getScene(SCENE)
    // 夹具本身先验一遍：这个场景确实把 0 号 NPC 挂在了商店选择框上。
    expect(scene.selectShopPanel?.[0]).toBe('0')
    const world = facingTheDoctor(createWorld(scene))
    expect(world.script.selectNpcs).toContain(0)

    const after = step(world, [{ e: 'press', k: 'space', ctrl: false }], TICK_MS)
    expect(after.dialogue.oral).toBe(false)
  })

  it('同一个夹具去掉选择数据之后，他就说话了', () => {
    const scene = getScene(SCENE)
    const bare = { ...createWorld(scene), script: { ...dialogueScriptOf(scene, true), selectNpcs: [] } }
    const world = facingTheDoctor(bare)

    const after = step(world, [{ e: 'press', k: 'space', ctrl: false }], TICK_MS)
    expect(after.dialogue.oral).toBe(true)
    // 名字与正文都来自脚本数据，不手写。
    expect(after.dialogue.name).toBe(world.npcs[0]!.name)
    expect(after.dialogue.sentence).toBe(world.npcs[0]!.oral[0])
  })
})

function cursorOf(world: World) {
  const d = world.dialogue
  return {
    cursor: d.cursor,
    row: d.row,
    col: d.col,
    printing: d.printing,
    sentenceOver: d.sentenceOver,
    pageOver: d.pageOver,
    text: d.text.map((row) => row.map((c) => c ?? ' ').join('')),
  }
}
