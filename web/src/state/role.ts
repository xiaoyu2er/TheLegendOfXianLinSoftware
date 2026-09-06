import { startTimer } from './timer'
import type { CollisionMap, Direction, RoleState, TilePos, TimerState } from './types'

/** 一个瓦片的边长。原版 `scene.Map.CS = 32`。 */
export const TILE = 32

/** 走/跑两个定时器的间隔。原版 `new Timer(Clock.delay(80), …)`，两个都是 80。 */
export const ROLE_TIMER_MS = 80

const STOPPED: TimerState = { running: false, dueMs: 0 }

/**
 * 主角的初始状态。原版 `ScenePanel.initiation()`：
 * `new Role(reader.getRoleX() * 32, reader.getRoleY() * 32, this)`，
 * 而 `Reader.roleX/roleY` 是**硬编码的 12 / 8**（96 个脚本无一处赋值，
 * 实测 96 份真值全是 (12, 8)）。其余字段都是 Java 的字段默认值：
 * `direction = 0` 即 `DOWN`，`count = 0`，`nextStep = false`，两个定时器未启动。
 */
export function createRole(tileX: number, tileY: number): RoleState {
  return {
    px: tileX * TILE,
    py: tileY * TILE,
    dir: 'down',
    frame: 0,
    runFrame: 0,
    nextStep: false,
    running: false,
    canStop: false,
    event: 'down',
    walk: STOPPED,
    run: STOPPED,
  }
}

/** 格子坐标。原版 `Role.getX()` 就是 `x / 32` 的整数除法。 */
export function roleTileX(role: RoleState): number {
  return Math.trunc(role.px / TILE)
}

export function roleTileY(role: RoleState): number {
  return Math.trunc(role.py / TILE)
}

/** 走或跑的定时器是否在跑。trace 里的 `role.moving`。 */
export function roleMoving(role: RoleState): boolean {
  return role.walk.running || role.run.running
}

/**
 * `RoleEvent.isAllow`：目标格能不能站人。
 *
 * 三条，顺序照抄：出界 → 网格非 0 → 有 NPC 站在**下面一格**（原版写的是
 * `y == npc.getY() + 1`，也就是主角脚下那一格被 NPC 的身位占了）。
 *
 * 注意网格的极性：`mapSet[y][x] != 0` 就**不许走**。所以 0 是可走、1 是墙，
 * 跟"1 表示可以"的直觉正好相反。
 */
export function isAllow(
  collision: CollisionMap,
  npcs: readonly TilePos[],
  x: number,
  y: number,
): boolean {
  if (x < 0 || x >= collision.col || y < 0 || y >= collision.row) return false
  if (collision.mapSet[y]?.[x] !== 0) return false
  for (const npc of npcs) {
    if (x === npc.x && y === npc.y + 1) return false
  }
  return true
}

/** `role.ts` 内部用的可变草稿。`step()` 拿它改，改完再冻成新的 `RoleState`。 */
export interface RoleDraft {
  px: number
  py: number
  dir: Direction
  frame: number
  runFrame: number
  nextStep: boolean
  running: boolean
  canStop: boolean
  event: Direction
  walk: { running: boolean; dueMs: number }
  run: { running: boolean; dueMs: number }
}

export function toDraft(role: RoleState): RoleDraft {
  return {
    px: role.px,
    py: role.py,
    dir: role.dir,
    frame: role.frame,
    runFrame: role.runFrame,
    nextStep: role.nextStep,
    running: role.running,
    canStop: role.canStop,
    event: role.event,
    walk: { ...role.walk },
    run: { ...role.run },
  }
}

export function fromDraft(d: RoleDraft): RoleState {
  return {
    px: d.px,
    py: d.py,
    dir: d.dir,
    frame: d.frame,
    runFrame: d.runFrame,
    nextStep: d.nextStep,
    running: d.running,
    canStop: d.canStop,
    event: d.event,
    walk: { running: d.walk.running, dueMs: d.walk.dueMs },
    run: { running: d.run.running, dueMs: d.run.dueMs },
  }
}

/**
 * `Role.move(event)`：往 `event` 方向挪一步，挪不动就只转身。
 *
 * 四个分支的取整方式**不对称**，这不是笔误，是原版的原文：向左/上/下用
 * `ceil`，向右用 `floor`；每个分支的另一根轴一律 `ceil`。半格状态下
 * （px 不是 32 的倍数）这决定了"脚下算哪一格"，改了就会在拐角处偏一格。
 *
 * 步长：走 8 px、跑 16 px。**朝向永远更新**，哪怕被挡住——原地转身就是这么
 * 来的。
 */
export function move(
  d: RoleDraft,
  collision: CollisionMap,
  npcs: readonly TilePos[],
  event: Direction,
): void {
  const stride = d.running ? 16 : 8
  switch (event) {
    case 'left':
      if (isAllow(collision, npcs, Math.ceil(d.px / TILE) - 1, Math.ceil(d.py / TILE))) {
        d.px -= stride
      }
      d.dir = 'left'
      break
    case 'right':
      if (isAllow(collision, npcs, Math.floor(d.px / TILE) + 1, Math.ceil(d.py / TILE))) {
        d.px += stride
      }
      d.dir = 'right'
      break
    case 'up':
      if (isAllow(collision, npcs, Math.ceil(d.px / TILE), Math.ceil(d.py / TILE) - 1)) {
        d.py -= stride
      }
      d.dir = 'up'
      break
    case 'down':
      if (isAllow(collision, npcs, Math.ceil(d.px / TILE), Math.floor(d.py / TILE) + 1)) {
        d.py += stride
      }
      d.dir = 'down'
      break
  }
}

/**
 * 走路定时器的一拍（`Role.walk` 的 `actionPerformed`）。
 *
 * 两条分支交替：`nextStep` 为真时计数 0→4（5 拍），为假时 0→7（8 拍）。
 * 每拍挪 8 px，所以**一个可停点 = 4 拍 = 32 px = 恰好一格**……除了刚构造出来
 * 的 `Role`：`count = 0`、`nextStep = false`，第一段走的是 0→7 那条 8 拍的
 * 分支，要 64 px（两格）才遇到第一个可停点。这一条在 trace 里看得见
 * （`dorm-walk` 的 t=0..98 是一次过冲加一次回退），不是 bug，是要对齐的行为。
 *
 * 松手（`canStop`）不立刻停：走到可停点才吸附到整格并停表。
 */
export function tickWalk(
  d: RoleDraft,
  collision: CollisionMap,
  npcs: readonly TilePos[],
): void {
  if (d.nextStep) {
    if (d.frame < 3) {
      move(d, collision, npcs, d.event)
      d.frame++
    } else {
      d.frame = 4
      move(d, collision, npcs, d.event)
      d.nextStep = !d.nextStep
      if (d.canStop) snapWalk(d)
    }
  } else {
    if (d.frame < 7) {
      d.frame++
      move(d, collision, npcs, d.event)
    } else {
      d.frame = 0
      move(d, collision, npcs, d.event)
      d.nextStep = !d.nextStep
      if (d.canStop) snapWalk(d)
    }
  }
}

function snapWalk(d: RoleDraft): void {
  d.px = TILE * Math.trunc(d.px / TILE)
  d.py = TILE * Math.trunc(d.py / TILE)
  d.canStop = false
  d.walk.running = false
}

/**
 * 跑步定时器的一拍（`Role.run`）。
 *
 * 计数 0→3 循环，每拍挪 16 px，**一个可停点 = 4 拍 = 64 px = 两格**。
 * 落格的取整方向按朝向分：向下/向右 `floor`，向左/向上 `ceil` ——
 * 都是"往回退到刚离开的那一格"。停下时 `isRun` 一并清掉。
 */
export function tickRun(
  d: RoleDraft,
  collision: CollisionMap,
  npcs: readonly TilePos[],
): void {
  if (d.runFrame < 3) {
    d.runFrame++
    move(d, collision, npcs, d.event)
  } else {
    d.runFrame = 0
    move(d, collision, npcs, d.event)
    if (d.canStop) {
      if (d.dir === 'down' || d.dir === 'right') {
        d.px = TILE * Math.floor(d.px / TILE)
        d.py = TILE * Math.floor(d.py / TILE)
      } else {
        d.px = TILE * Math.ceil(d.px / TILE)
        d.py = TILE * Math.ceil(d.py / TILE)
      }
      d.canStop = false
      d.running = false
      d.run.running = false
    }
  }
}

/**
 * `Role.setEvent(int)`：方向键按下。
 *
 * **两条分支都要求两个定时器都没在跑**——按住方向键连按不会改方向，也不会
 * 重新计时；正在走的时候按另一个方向是没反应的，要等这一格走完。
 */
export function pressDirection(d: RoleDraft, dir: Direction, now: number): void {
  if (d.running) {
    if (!d.run.running && !d.walk.running) {
      d.walk.running = false
      d.event = dir
      startTimer(d.run, now, ROLE_TIMER_MS)
    }
  } else {
    if (!d.walk.running && !d.run.running) {
      d.event = dir
      startTimer(d.walk, now, ROLE_TIMER_MS)
    }
  }
}
