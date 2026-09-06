import { describe, expect, it } from 'vitest'
import { SCENE_NAMES } from '../data/scenes'
import { getScene } from '../data/scenesEager'
import { createWorld, npcTilesOf, step } from './step'
import { roleMoving, roleTileX, roleTileY } from './role'
import { TRACE_NAMES, readTrace, sceneNameOf } from './trace'
import type { TraceTick } from './trace'
import type { TilePos, World } from './types'

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
 * - NPC 的格子坐标：取**上一 tick** 的快照。导出器按根对象的顺序安装定时器，
 *   `sp.role` 排在 `sp.npcs` 前面，所以主角在第 t tick 判碰撞时看到的是 NPC
 *   在第 t-1 tick 末的位置。第 0 tick 谁都还没动，用脚本里的初始坐标。
 *   （NPC 自己怎么动是 xl-9bd.9，这一层不实现它。）
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

      let world = createWorld(scene)
      // 起点也是真值：原版第 0 tick 之前主角就在 (roleX, roleY)。
      expect(roleTileX(world.role)).toBe(trace.ticks[0]!.role.x)
      expect(roleTileY(world.role)).toBe(trace.ticks[0]!.role.y)

      let npcs: readonly TilePos[] = npcTilesOf(scene)
      for (const tick of trace.ticks) {
        expect(world.timeMs).toBe(tick.vt)
        world = step({ ...world, npcs }, tick.input, trace.script.tickMs)
        // 带上 t：比对失败时要一眼看得出是第几个 tick 开始偏的。
        expect(observed(tick.t, world)).toEqual(expected(tick))
        npcs = tick.npcs.map((n) => ({ x: n.x, y: n.y }))
      }
    })
  }

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
