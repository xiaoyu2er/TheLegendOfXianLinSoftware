import { describe, expect, it } from 'vitest'
import { SCENE_NAMES } from '../data/scenes'
import { getScene } from '../data/scenesEager'
import { createWorld, step } from './step'
import type { SceneGates } from './step'
import { roleMoving, roleTileX, roleTileY } from './role'
import { TRACE_NAMES, readTrace, sceneNameOf } from './trace'
import type { Trace, TraceTick } from './trace'
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
 * 喂给状态层的只有三样东西，都来自真值：
 *
 * - `input`：trace 里那一 tick 实际喂给原版的按键事件，照着回放；
 * - `script.isScript`：`ScenePanel.isScript`，旁白与主线对话的总开关；
 * - `dialogue`：`ScenePanel.step()` 第 3 步那道门里的 `isSpeaking`。主线对话
 *   本身是 xl-9bd.10，这一层不实现它，只从真值里读那道门。
 *
 * **NPC 与旁白都不再从真值里喂**（NPC 是 xl-9bd.9，旁白是 xl-9bd.11）。它们由
 * `state/npc.ts` 与 `state/narratage.ts` 自己推进，然后跟真值逐 tick 比对 ——
 * 喂进去再比对等于让真值给自己打分。
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
        world = step(world, tick.input, trace.script.tickMs, speakingBefore(trace, tick.t))
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
        world = step(world, tick.input, trace.script.tickMs, speakingBefore(trace, tick.t))
        expect(observedNpcs(tick.t, world)).toEqual(expectedNpcs(tick))
      }
    })

    it(`${name}：逐 tick 的旁白状态与真值一致`, () => {
      const trace = readTrace(name)
      const scene = getScene(sceneNameOf(trace))
      let world = createWorld(scene, trace.script.isScript)

      for (const tick of trace.ticks) {
        world = step(world, tick.input, trace.script.tickMs, speakingBefore(trace, tick.t))
        expect(observedNarratage(tick.t, world)).toEqual(expectedNarratage(tick))
      }
    })
  }

  /**
   * 旁白的覆盖：**分母从真值里数**，不写死"有一份剧本播了 6 句"。
   *
   * 没有这一条，上面那个逐 tick 用例在"所有剧本都没有旁白"时也是绿的 —— 一个
   * 恒为 `{active:false, over:true}` 的实现能通过它，而那正是本票之前的状态。
   */
  it('真值里确实有一段旁白从头播到尾', () => {
    let played = 0
    let finished = 0
    let lines = 0
    let bgFrames = 0
    for (const name of replayable) {
      const trace = readTrace(name)
      let prev = trace.ticks[0]!
      for (const tick of trace.ticks) {
        const n = tick.narratage
        if (n.active) played++
        if (prev.narratage.active && !n.active && n.over) finished++
        if (n.active && n.line !== prev.narratage.line) lines++
        if (n.bg !== prev.narratage.bg) bgFrames++
        prev = tick
      }
    }
    expect(played).toBeGreaterThan(0)
    // 播完那一下（active 落、over 起）必须在真值里出现过，否则"结束"这条
    // 分支从来没被跑到。
    expect(finished).toBeGreaterThan(0)
    // 换行与换背景帧也都要真的发生过。
    expect(lines).toBeGreaterThan(0)
    expect(bgFrames).toBeGreaterThan(0)
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
 * 第 `t` 个 tick 跑 `step()` 时，`isSpeaking` 是什么。
 *
 * 取**上一 tick 的快照**：导出器每 tick 的顺序是 `输入 → 定时器 → step() →
 * paint()`，快照写在 `paint()` 之后，所以第 t-1 行记的正是第 t 个 tick 开跑
 * 前的状态。第 0 个 tick 之前什么都没开始，是 false。
 *
 * 这不是精确值，精确值取不到：`paint()` 会推进对话，`step()` 自己的第 2 步
 * 也可能在第 3 步之前把这个标志翻过来，两次翻转都落在两个快照之间。
 *
 * **而今天的真值分辨不出这道门。** 实测：把它改成读当前 tick 的快照、或者
 * 干脆整个拿掉（恒为 false），上面那两个逐 tick 用例照样全绿。原因是
 * `checkNPCStop` 在没有 NPC 贴身时做的是无条件 `start()`，而对已经在跑的
 * 定时器那是空操作 —— 剧本里主角贴身的那几段都不在对话或旁白期间。所以这里
 * 照抄源码的那道门是**未经真值验证**的：它按 `ScenePanel.step()` 写，不是按
 * 测出来的差别写。要验证它得有一份"先把 NPC 停住、再开始对话"的剧本，那要等
 * xl-9bd.10 把对话接进来。
 *
 * 旁白那一半**不在这里了**：`world.narratage` 自己就知道（xl-9bd.11），
 * 而它是不是知道对了，由上面那个逐 tick 的旁白用例判。
 */
function speakingBefore(trace: Trace, t: number): SceneGates {
  const before = trace.ticks[t - 1]
  return { speaking: before?.dialogue.source === 'script' }
}

function observedNarratage(t: number, world: World) {
  const n = world.narratage
  return { t, active: n.active, over: n.over, line: n.line, cursor: n.cursor, row: n.row, bg: n.bg }
}

function expectedNarratage(tick: TraceTick) {
  const { active, over, line, cursor, row, bg } = tick.narratage
  return { t: tick.t, active, over, line, cursor, row, bg }
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
