import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { createRole, isAllow, roleMoving, roleTileX, roleTileY } from './role'
import { TICK_MS, collisionOf, npcTilesOf, step } from './step'
import type { InputEvent, World } from './types'

/**
 * 结构性的几条。**逐 tick 的行为对齐在 `traceReplay.test.ts`**——那里的期望值
 * 全部来自原版跑出来的真值。这个文件只断言那些"定义即结论"的性质
 * （被挡住 = 坐标不变、纯函数 = 不改入参），一个数字都不是凭空写的：
 * 墙的位置从烘焙好的碰撞网格里现找，NPC 的位置从脚本里现读。
 */
const scene = getScene('宿舍')

function worldAt(tileX: number, tileY: number): World {
  return {
    timeMs: 0,
    collision: collisionOf(scene),
    npcs: npcTilesOf(scene),
    role: createRole(tileX, tileY),
  }
}

/** 按住某个方向键跑 `ticks` 个 tick，中途不松手。 */
function hold(world: World, key: 'left' | 'right' | 'up' | 'down', ticks: number, ctrl = false) {
  const press: InputEvent[] = [{ e: 'press', k: key, ctrl }]
  let w = world
  for (let i = 0; i < ticks; i++) w = step(w, i === 0 ? press : [], TICK_MS)
  return w
}

describe('碰撞', () => {
  it('网格的极性：0 可走、非 0 挡住（与 RoleEvent.isAllow 一致）', () => {
    const collision = collisionOf(scene)
    let walkable = 0
    let walls = 0
    for (let y = 0; y < collision.row; y++) {
      for (let x = 0; x < collision.col; x++) {
        if (isAllow(collision, [], x, y)) walkable++
        else if (collision.mapSet[y]![x] !== 0) walls++
      }
    }
    expect(walkable + walls).toBe(collision.col * collision.row)
    // 两边都得非空，否则下面的用例可能挑不到墙、也可能挑不到路。
    expect(walkable).toBeGreaterThan(0)
    expect(walls).toBeGreaterThan(0)
  })

  it('出界算挡住', () => {
    const collision = collisionOf(scene)
    expect(isAllow(collision, [], -1, 0)).toBe(false)
    expect(isAllow(collision, [], collision.col, 0)).toBe(false)
    expect(isAllow(collision, [], 0, -1)).toBe(false)
    expect(isAllow(collision, [], 0, collision.row)).toBe(false)
  })

  it('撞墙：按着方向键 1 秒，格子坐标一步都没动，但转过了身', () => {
    // 墙的位置现找，不写死：找一格可走的、它右边是墙。
    const collision = collisionOf(scene)
    let spot: { x: number; y: number } | null = null
    for (let y = 0; y < collision.row && !spot; y++) {
      for (let x = 0; x + 1 < collision.col; x++) {
        if (isAllow(collision, [], x, y) && !isAllow(collision, [], x + 1, y)) {
          spot = { x, y }
          break
        }
      }
    }
    expect(spot).not.toBeNull()

    const start = worldAt(spot!.x, spot!.y)
    const after = hold(start, 'right', 100)
    expect(after.role.px).toBe(start.role.px)
    expect(after.role.py).toBe(start.role.py)
    // 挡住只挡移动，不挡转身——原版 `Role.move` 的 `direction = …` 在 if 外面。
    expect(after.role.dir).toBe('right')
    // 松手条件永远不满足，所以定时器还在跑：撞墙不等于停下。
    expect(roleMoving(after.role)).toBe(true)
  })

  it('NPC 挡在脚下那一格：走不进去', () => {
    const npcs = npcTilesOf(scene)
    expect(npcs.length).toBeGreaterThan(0)
    const npc = npcs[0]!
    // 原版写的是 `y == npc.getY() + 1`：被占的是 NPC 下面那一格。
    expect(isAllow(collisionOf(scene), npcs, npc.x, npc.y + 1)).toBe(false)
    expect(isAllow(collisionOf(scene), [], npc.x, npc.y + 1)).toBe(
      collisionOf(scene).mapSet[npc.y + 1]![npc.x] === 0,
    )
  })

  it('没有墙也没有 NPC 的方向，走得动', () => {
    const start = worldAt(scene.roleX, scene.roleY)
    const after = hold(start, 'right', 40)
    expect(roleTileX(after.role)).toBeGreaterThan(roleTileX(start.role))
    expect(roleTileY(after.role)).toBe(roleTileY(start.role))
  })
})

describe('走与跑', () => {
  it('按住控制键按方向键 = 跑；同样的时长跑得比走远', () => {
    const start = worldAt(scene.roleX, scene.roleY)
    // 40 个 tick：走/跑各触发 4 次，跑步走 64 px 停在 (14, 8)，还没撞上
    // 宿舍里 (15, 8) 那面墙——撞了墙两边都会被截平，这条就白测了。
    const walked = hold(start, 'right', 40)
    const ran = hold(start, 'right', 40, true)
    expect(walked.role.running).toBe(false)
    expect(ran.role.running).toBe(true)
    expect(ran.role.px - start.role.px).toBeGreaterThan(walked.role.px - start.role.px)
  })

  it('松手不立刻停：置位之后还要走到下一个可停点，停下时正好在整格上', () => {
    let w = hold(worldAt(scene.roleX, scene.roleY), 'right', 20)
    expect(roleMoving(w.role)).toBe(true)
    w = step(w, [{ e: 'release', k: 'right' }], TICK_MS)
    expect(w.role.canStop).toBe(true)
    // 松手那一刻多半还在半格上，不会立刻停。
    let ticks = 0
    while (roleMoving(w.role) && ticks++ < 200) w = step(w, [], TICK_MS)
    expect(roleMoving(w.role)).toBe(false)
    expect(w.role.px % 32).toBe(0)
    expect(w.role.py % 32).toBe(0)
  })

  it('正在走的时候按别的方向键没反应（原版 setEvent 的两条分支都要求定时器没在跑）', () => {
    const w = hold(worldAt(scene.roleX, scene.roleY), 'right', 5)
    const turned = step(w, [{ e: 'press', k: 'down', ctrl: false }], TICK_MS)
    expect(turned.role.event).toBe('right')
  })
})

describe('step 是纯函数', () => {
  it('不改入参的世界', () => {
    const before = worldAt(scene.roleX, scene.roleY)
    const snapshot = structuredClone(before)
    let w = before
    for (let i = 0; i < 50; i++) {
      w = step(w, i === 0 ? [{ e: 'press', k: 'right', ctrl: false }] : [], TICK_MS)
    }
    expect(before).toEqual(snapshot)
    expect(w).not.toEqual(before)
  })

  it('同样的世界与输入，跑两遍结果相同', () => {
    const start = worldAt(scene.roleX, scene.roleY)
    expect(hold(start, 'down', 77)).toEqual(hold(start, 'down', 77))
  })

  it('时间按 dtMs 走，不去读时钟', () => {
    const w = step(worldAt(scene.roleX, scene.roleY), [], 37)
    expect(w.timeMs).toBe(37)
  })
})

describe('状态层不碰渲染', () => {
  /**
   * "状态推进的测试不启动渲染"这条验收标准的可执行形式：分母是 `src/state/`
   * 下的**每一个**文件，逐个查它的 import。谁哪天在这里 import 了 Pixi，
   * 状态推进就又跟绘制绑上了，这条会响。
   */
  it('src/state/ 下没有一个文件 import 渲染层', () => {
    const dir = resolve(dirname(fileURLToPath(import.meta.url)))
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(4)
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(resolve(dir, file), 'utf8')
      for (const banned of ['pixi.js', 'react', 'react-dom', '../scene/', '../stage/']) {
        if (new RegExp(`from ['"]${banned.replace(/[./]/g, '\\$&')}`).test(source)) {
          offenders.push(`${file} -> ${banned}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
