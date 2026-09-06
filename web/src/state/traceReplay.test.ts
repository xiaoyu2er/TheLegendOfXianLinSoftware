import { describe, expect, it } from 'vitest'
import { SCENE_NAMES } from '../data/scenes'
import { getScene } from '../data/scenesEager'
import { createWorld, step } from './step'
import type { SceneGates } from './step'
import { roleMoving, roleTileX, roleTileY } from './role'
import { TRACE_NAMES, readTrace, sceneNameOf } from './trace'
import type { TraceTick } from './trace'
import type { World } from './types'

/**
 * 逐 tick 对齐行为真值。
 *
 * 这是这一层唯一有分量的测试，也是它存在的理由：写实现和写期望值的是同一个
 * agent、在同一个上下文窗口里，手写期望的测试会绿、而且是错的。这里的期望值
 * 一个都不是手写的——全部来自 `tools/traces/out/`，由原版 Java 程序自己跑出来
 * （见 `docs/trace-format.md`）。
 *
 * **不启动渲染**：整个文件没有 canvas、没有 Pixi、没有 React、没有 DOM。
 *
 * 喂给状态层的只有两样东西，都来自真值：
 *
 * - `input`：trace 里那一 tick 实际喂给原版的按键事件，照着回放；
 * - `narratage.active`：`ScenePanel.step()` 那几道门里旁白那一半。旁白是
 *   xl-9bd.11，这一层还不实现它。
 *
 * **NPC 不再从真值里喂**（xl-9bd.9 之前是喂的），**对话也不再喂**
 * （xl-9bd.10 之前那道门的 `isSpeaking` 是喂的）。两者都由状态层自己推进，
 * 然后跟真值逐 tick 比对 —— 喂进去再比对等于让真值给自己打分。
 */
describe('回放行为真值', () => {
  /**
   * 能回放的是**场景已烘焙**的那几份。这里把可回放与不可回放的名单都写死：
   * 少回放了一份要响。"跳过了所以没报错"是这个项目的招牌坑。
   */
  const replayable = TRACE_NAMES.filter((name) =>
    SCENE_NAMES.includes(sceneNameOf(readTrace(name))),
  )

  it('xl-9bd.4 之后 96 个场景全部烘焙，三份 trace 因此全部可回放', () => {
    // 分母是 TRACE_NAMES 本身：将来加了 trace 而场景没烘出来，这里会响。
    expect(TRACE_NAMES).toHaveLength(3)
    expect(replayable).toEqual([...TRACE_NAMES])
    // dorm-intro 走的是 脚本1，它在 xl-9bd.4 之前不在烘焙名单里。
    expect(sceneNameOf(readTrace('dorm-intro'))).toBe('脚本1')
  })

  for (const name of replayable) {
    it(`${name}：逐 tick 的主角坐标、朝向、走跑状态与真值一致`, () => {
      const trace = readTrace(name)
      const scene = getScene(sceneNameOf(trace))
      expect(trace.script.tickMs).toBe(10)
      expect(trace.ticks).toHaveLength(trace.tickCount)
      expect(trace.tickCount).toBeGreaterThan(0)

      let world = createWorld(scene, trace.script.isScript)
      // 起点也是真值：原版第 0 tick 之前主角就在 (roleX, roleY)。
      expect(roleTileX(world.role)).toBe(trace.ticks[0]!.role.x)
      expect(roleTileY(world.role)).toBe(trace.ticks[0]!.role.y)

      for (const tick of trace.ticks) {
        expect(world.timeMs).toBe(tick.vt)
        world = step(world, tick.input, trace.script.tickMs, gatesAt(tick))
        // 带上 t：比对失败时要一眼看得出是第几个 tick 开始偏的。
        expect(observed(tick.t, world)).toEqual(expected(tick))
      }
    })

    it(`${name}：逐 tick 的 NPC 坐标、方向、帧号与真值一致`, () => {
      const trace = readTrace(name)
      const scene = getScene(sceneNameOf(trace))
      let world = createWorld(scene, trace.script.isScript)
      // NPC 的条数就是分母：原版建不出来的条目会被跳过，少建一个要在这里响，
      // 而不是表现为"那个 NPC 的比对压根没跑"。
      expect(world.npcs).toHaveLength(trace.ticks[0]!.npcs.length)

      for (const tick of trace.ticks) {
        world = step(world, tick.input, trace.script.tickMs, gatesAt(tick))
        expect(observedNpcs(tick.t, world)).toEqual(expectedNpcs(tick))
      }
    })

    it(`${name}：逐 tick 的对话框、逐字游标与头像与真值一致`, () => {
      const trace = readTrace(name)
      const scene = getScene(sceneNameOf(trace))
      let world = createWorld(scene, trace.script.isScript)

      for (const tick of trace.ticks) {
        world = step(world, tick.input, trace.script.tickMs, gatesAt(tick))
        expect(observedDialogue(tick.t, world)).toEqual(expectedDialogue(tick))
      }
    })
  }

  /**
   * 对话这条线在三份真值里到底被走到了多少。
   *
   * 上面那个逐 tick 用例是"相等"，它对一份**从头到尾没有对话**的真值同样会
   * 全绿 —— 全 false 等于全 false。所以这里数一遍真值里实际发生过的事，
   * 分母全部从真值现数，不写死数量（并行的票随时会加剧本）。
   */
  it('真值覆盖了两种来源、两种对话框样式、逐字打印、翻页与结束', () => {
    const sources = new Set<string>()
    const types = new Set<number>()
    let printedChars = 0
    let pageTurns = 0
    let ended = 0
    for (const name of replayable) {
      const trace = readTrace(name)
      let prev = trace.ticks[0]!
      for (const tick of trace.ticks) {
        const d = tick.dialogue
        if (d.active) {
          sources.add(d.source)
          types.add(d.type)
        }
        if (d.cursor > prev.dialogue.cursor) printedChars++
        if (d.pageOver && !prev.dialogue.pageOver) pageTurns++
        if (!d.active && prev.dialogue.active) ended++
        prev = tick
      }
    }
    // 口头语与主线对话都出现过；头像式（0）与名字式（1）两种对话框都出现过。
    expect([...sources].sort()).toEqual(['npc', 'script'])
    expect([...types].sort()).toEqual([0, 1])
    expect(printedChars).toBeGreaterThan(0)
    // 一屏 4×20 打满、等玩家翻页：dorm-intro 里有一句长到要翻页。
    expect(pageTurns).toBeGreaterThan(0)
    // 对话真的收过框，不是"开了就一直开着到剧本结束"。
    expect(ended).toBeGreaterThan(0)
  })

  /**
   * 三份真值合起来，四种运动状态各覆盖到了什么。
   *
   * 分母从真值里数出来，不写死数量：并行的票随时可能加剧本、改剧本，写死的
   * 数字合并时一定冲突，而"覆盖没了"这件事又必须还能响。
   */
  it('真值覆盖了数据里存在的每一种运动状态，以及停走的两个方向', () => {
    const types = new Set<number>()
    const dirs = new Set<number>()
    let framesAdvanced = 0
    let walked = 0
    let stopped = 0
    for (const name of replayable) {
      const trace = readTrace(name)
      let prev = trace.ticks[0]!
      for (const tick of trace.ticks) {
        for (let i = 0; i < tick.npcs.length; i++) {
          const npc = tick.npcs[i]!
          const was = prev.npcs[i]!
          types.add(npc.type)
          dirs.add(npc.dir)
          if (npc.frame !== was.frame) framesAdvanced++
          if (npc.px !== was.px || npc.py !== was.py) walked++
          // 该触发的那一刻什么都没变 = 这个 NPC 被 checkNPCStop 停住了。
          else if (npc.type !== 0 && tick.vt % 200 === 0 && tick.vt > 0 && npc.frame === was.frame) {
            stopped++
          }
        }
        prev = tick
      }
    }
    // 静止 / 单向走动 / 原地运动三种状态码在数据里都有（状态码 3 原版建不出来，
    // 见 state/npc.ts），走动的两根轴（左右 1/5、上下 9/13）也都覆盖到了。
    expect([...types].sort()).toEqual([0, 1, 2])
    expect([...dirs].sort((a, b) => a - b)).toEqual([1, 5, 9, 13])
    expect(framesAdvanced).toBeGreaterThan(0)
    expect(walked).toBeGreaterThan(0)
    expect(stopped).toBeGreaterThan(0)
  })

  it('主角至少有一次是被 NPC 挡住的，不只是被墙挡住', () => {
    let blockedByNpc = 0
    for (const name of replayable) {
      const trace = readTrace(name)
      let prev = trace.ticks[0]!
      for (const tick of trace.ticks) {
        const r = tick.role
        if (r.moving && r.px === prev.role.px && r.py === prev.role.py) {
          const dx = r.dir === 'left' ? -1 : r.dir === 'right' ? 1 : 0
          const dy = r.dir === 'up' ? -1 : r.dir === 'down' ? 1 : 0
          for (const npc of prev.npcs) {
            if (r.x + dx === npc.x && r.y + dy === npc.y + 1) blockedByNpc++
          }
        }
        prev = tick
      }
    }
    // `RoleEvent.isAllow` 那条 `y == npc.getY() + 1` 在真值里真的被踩到过。
    // 没踩到的话，上面那两个逐 tick 用例即使把 NPC 碰撞整个删掉也还是绿的。
    expect(blockedByNpc).toBeGreaterThan(0)
  })

  it('两份可回放的 trace 合起来覆盖了走、跑、四向与被挡住', () => {
    let walked = 0
    let ran = 0
    let blocked = 0
    const dirs = new Set<string>()
    for (const name of replayable) {
      const trace = readTrace(name)
      let prev = trace.ticks[0]!
      for (const tick of trace.ticks) {
        if (tick.role.running) ran++
        else if (tick.role.moving) walked++
        dirs.add(tick.role.dir)
        if (tick.role.moving && tick.role.px === prev.role.px && tick.role.py === prev.role.py) {
          blocked++
        }
        prev = tick
      }
    }
    // 这四条覆盖是上面那两个用例的前提。真值换了而覆盖掉了，要在这里响，
    // 而不是表现为"测试还是绿的，只是不再测碰撞了"。
    expect(walked).toBeGreaterThan(0)
    expect(ran).toBeGreaterThan(0)
    expect([...dirs].sort()).toEqual(['down', 'left', 'right', 'up'])
    expect(blocked).toBeGreaterThan(0)
  })
})

/**
 * 第 `t` 个 tick 跑 `step()` 时，`isNarratage` 是什么。
 *
 * **取当前这一 tick 的快照**（xl-9bd.10 之前取的是上一 tick 的）。理由写在
 * `state/step.ts` 的 `SceneGates` 上，一句话是：`isNarratage` 只被旁白自己的
 * 定时器与 `ScenePanel.step()` 第 1 步改写，`paint()` 不碰它，所以写在
 * `paint()` 之后的第 t 行快照正是第 2/3/5 步当时看到的值。
 *
 * `isSpeaking` **不再从这里喂** —— 对话就在状态层里，喂进去再比对等于让真值
 * 给自己打分。
 */
function gatesAt(tick: TraceTick): SceneGates {
  return { narratage: tick.narratage.active }
}

function observedNpcs(t: number, world: World) {
  return {
    t,
    npcs: world.npcs.map((n) => ({
      x: n.x,
      y: n.y,
      px: n.px,
      py: n.py,
      type: n.type,
      dir: n.dir,
      frame: n.frame,
    })),
  }
}

function expectedNpcs(tick: TraceTick) {
  return {
    t: tick.t,
    npcs: tick.npcs.map((n) => ({
      x: n.x,
      y: n.y,
      px: n.px,
      py: n.py,
      type: n.type,
      dir: n.dir,
      frame: n.frame,
    })),
  }
}

function observedDialogue(t: number, world: World) {
  const d = world.dialogue
  return {
    t,
    active: d.speaking || d.oral,
    source: d.oral ? 'npc' : d.speaking ? 'script' : 'none',
    type: d.type,
    head: d.headNo,
    name: d.name,
    sentence: d.sentence,
    cursor: d.cursor,
    row: d.row,
    col: d.col,
    printing: d.printing,
    sentenceOver: d.sentenceOver,
    pageOver: d.pageOver,
  }
}

function expectedDialogue(tick: TraceTick) {
  const { active, source, type, head, name, sentence, cursor, row, col } = tick.dialogue
  const { printing, sentenceOver, pageOver } = tick.dialogue
  return {
    t: tick.t,
    active,
    source,
    type,
    head,
    name,
    sentence,
    cursor,
    row,
    col,
    printing,
    sentenceOver,
    pageOver,
  }
}

function observed(t: number, world: World) {
  return {
    t,
    x: roleTileX(world.role),
    y: roleTileY(world.role),
    px: world.role.px,
    py: world.role.py,
    dir: world.role.dir,
    frame: world.role.frame,
    running: world.role.running,
    moving: roleMoving(world.role),
  }
}

function expected(tick: TraceTick) {
  const { x, y, px, py, dir, frame, running, moving } = tick.role
  return { t: tick.t, x, y, px, py, dir, frame, running, moving }
}
