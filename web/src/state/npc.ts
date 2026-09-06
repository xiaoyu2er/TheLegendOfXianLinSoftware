/**
 * NPC 层：摆位、四种运动状态、以及"主角走近就停下"。
 *
 * 原版是 `scene/NPC.java`（一个 NPC 自己的两个定时器）加 `scene/NPCEvent.java`
 * 的 `checkNPCStop`（主循环每 10 ms 替所有 NPC 决定该不该停）。这里逐行照抄
 * 那两处，**不重新设计**：那些 `count` 的取值区间、方向码 1/5/9/13、以及
 * `length` 归零时的翻转，都是真值里逐 tick 看得见的行为。
 *
 * ## 四种运动状态
 *
 * `tools.Reader` 的注释写着 `0.静止 1.单向走动 2.原地运动 3.四向运动`，但它的
 * if/else 链**只有三个分支**：状态码 3 没有对应的构造函数，那样的 NPC 根本不会
 * 被创建。这里同样只建三种，第四种的"实现"就是不创建 —— 与原版逐字节一致。
 * 数据里今天有哪几种状态码不写死在代码里，由 `npc.test.ts` 现场扫一遍已烘焙
 * 的场景来数；哪天数据里真出现一个 3，那里会红。
 *
 * ## 帧号 `count` 的两套用法
 *
 * 同一个字段，两个监听器各用各的：
 *
 * - 原地运动（`action`）：`0 .. actionRate-1` 循环，就是第几张图；
 * - 单向走动（`walk`）：`0..3` 是"往 1/9 那个方向"的四帧，`4..7` 是回程的四帧。
 *   所以单向走动的素材必须有 8 张，首帧号就是方向码（`NPC.java:71`）。
 */
import { javaSplit } from '../data/javaSplit'
import type { SceneScript } from '../data/types'
import { TILE } from './role'
import { fireDue, startTimer, stopTimer } from './timer'
import type { MutableTimer } from './timer'
import type { TilePos, TimerState } from './types'

/** NPC 两个定时器的间隔。原版 `new Timer(Clock.delay(200), …)`，两个都是 200。 */
export const NPC_TIMER_MS = 200

/** 方向码。**这是脚本数据里的写法**，不翻译成主角那套 down/up/left/right。 */
export const NPC_LEFT = 1
export const NPC_RIGHT = 5
export const NPC_DOWN = 9
export const NPC_UP = 13

const STOPPED: TimerState = { running: false, dueMs: 0 }

/**
 * 一个 NPC。字段与原版 `scene.NPC` 一一对应：
 *
 * | 这里 | 原版 | trace |
 * |---|---|---|
 * | `px` / `py` | `x` / `y`（像素） | `npcs[].px` / `.py` |
 * | `x` / `y` | `getX()` / `getY()`（像素 ÷ 32） | `npcs[].x` / `.y` |
 * | `dir` | `direction`（1/5/9/13） | `npcs[].dir` |
 * | `frame` | `count` | `npcs[].frame` |
 * | `length` | `length`（还剩几格） | — |
 * | `span` | `temp`（来回的格数） | — |
 * | `images` | `image` / `images` 的**文件名** | — |
 * | `name` / `oral` | `name` / `oral` | — |
 *
 * `x`/`y` 是派生的（`Math.trunc(px / 32)`），跟着 `px`/`py` 一起算好存下来：
 * 碰撞（`RoleEvent.isAllow`）与绘制顺序（`ScenePanel.paint`）都按格子判，
 * 每次现算一遍只会让两处算法有机会分家。
 *
 * `images` 存的是**文件名**而不是纹理：状态层不认识渲染。拼法照抄
 * `NPC.java` 的三个构造函数，与 `assets/sceneAssets.ts` 扫出来的路径同源。
 */
export interface NpcState extends TilePos {
  readonly type: number
  readonly px: number
  readonly py: number
  readonly x: number
  readonly y: number
  readonly dir: number
  readonly frame: number
  readonly length: number
  readonly span: number
  readonly images: readonly string[]
  /**
   * 口头语与显示名。这一票不用它们（搭话是 xl-9bd.10），**存下来是因为
   * 不存就读不到那个字段** —— 而"读得到吗"正是原版在这里唯一会崩的地方：
   * `script/仙二205.txt` 的第 4 条 NPC 少一个字段（名字与口头语之间的空格写成
   * 了全角逗号），原版 `Reader` 取 `sg[7]` 时 ArrayIndexOutOfBoundsException，
   * 走进那个教室就是崩。不读这个字段，这一层就会比原版更宽容，而宽容的表现是
   * "那个场景在 Web 版能进、只是少个 NPC"，谁也发现不了。
   */
  readonly name: string
  readonly oral: readonly string[]
  readonly action: TimerState
  readonly walk: TimerState
}

/**
 * 从一份烘焙好的场景脚本建出这个场景的 NPC。
 *
 * 分支与字段下标照抄 `tools.Reader` 的 `case "NPC"`（`Reader.java:128-147`）：
 *
 * | 状态码 | 字段 |
 * |---|---|
 * | 0 静止     | `0 x y 文件名 口头语` |
 * | 1 单向走动 | `1 x y 方向 长度 帧数 目录名 口头语` |
 * | 2 原地运动 | `2 x y 帧数 目录名 口头语` |
 *
 * **字段少了就抛**，不跳过：原版在这里是 `ArrayIndexOutOfBoundsException`，
 * 走进那个场景直接崩。悄悄跳过会把"这个场景进不去"变成"这个 NPC 不见了"，
 * 而后者没人看得出来。已知的那处坏数据挂在 `assets/knownMissing.ts` 的
 * `KNOWN_DEFECTS` 上，`npc.test.ts` 用它当分母。
 */
export function createNpcs(scene: SceneScript): NpcState[] {
  const npcs: NpcState[] = []
  scene.npcList?.forEach((row, i) => {
    const where = `${scene.script} npcList[${i}]`
    const type = row[0]
    // 原版的 if/else 链没有第四个分支：状态码 3（四向运动）只写在注释里，
    // 那样的 NPC 不会被创建。这里的"跳过"就是它的忠实实现。
    if (type !== '0' && type !== '1' && type !== '2') return
    const at = (k: number) => field(row, k, where)
    const x = int(at(1), where)
    const y = int(at(2), where)
    if (type === '0') {
      const file = at(3)
      npcs.push(
        make({
          type: 0,
          px: x * TILE,
          py: y * TILE,
          images: [file],
          // `fileName.split("\\.")[0]`：按字面的点切，取第一段。
          name: file.split('.')[0] ?? file,
          oral: at(4),
        }),
      )
      return
    }
    if (type === '2') {
      const frames = int(at(3), where)
      const folder = at(4)
      npcs.push(
        make({
          type: 2,
          px: x * TILE,
          py: y * TILE,
          images: range(1, frames).map((n) => `${folder}/${n}.png`),
          name: folder,
          oral: at(5),
          action: { running: true, dueMs: NPC_TIMER_MS },
        }),
      )
      return
    }
    const dir = int(at(3), where)
    const length = int(at(4), where)
    const frames = int(at(5), where)
    const folder = at(6)
    npcs.push(
      make({
        type: 1,
        px: x * TILE,
        py: y * TILE,
        dir,
        length,
        span: length,
        // 首帧号就是方向码：图书馆管理员缺的是 9..16 而不是 1..8。
        images: range(0, frames - 1).map((n) => `${folder}/${n + dir}.png`),
        name: folder,
        oral: at(7),
        walk: { running: true, dueMs: NPC_TIMER_MS },
      }),
    )
  })
  return npcs
}

/**
 * 场景初始化时两个定时器的到期时刻都是 `0 + 200`：原版在**构造函数里**
 * `start()`，而构造发生在第 0 个 tick 之前。导出器也是这么装的
 * （`ExportTrace.installTimers` 在 `initiation` 之后、第一个 tick 之前）。
 */
function make(fields: {
  type: number
  px: number
  py: number
  images: readonly string[]
  name: string
  oral: string
  dir?: number
  length?: number
  span?: number
  action?: TimerState
  walk?: TimerState
}): NpcState {
  return {
    type: fields.type,
    px: fields.px,
    py: fields.py,
    x: tile(fields.px),
    y: tile(fields.py),
    // `direction` 的字段初值是 1（`NPC.java:28`）——静止与原地运动的 NPC
    // 在 trace 里 `dir` 恒为 1，就是这么来的，不是"没有方向"。
    dir: fields.dir ?? NPC_LEFT,
    frame: 0,
    length: fields.length ?? 0,
    span: fields.span ?? 0,
    images: fields.images,
    name: fields.name,
    // `oral.split(";")`。Java 的 split 会丢掉末尾的空串，`javaSplit` 就是为这
    // 条差异存在的（`data/javaSplit.ts`）。
    oral: javaSplit(fields.oral, ';'),
    action: fields.action ?? STOPPED,
    walk: fields.walk ?? STOPPED,
  }
}

/** `NPC.getX()` / `getY()`：Java 的 `int / int`，向零截断。 */
function tile(pixels: number): number {
  const q = Math.trunc(pixels / TILE)
  return q === 0 ? 0 : q
}

/** `npc.ts` 内部用的可变草稿，与 `RoleDraft` 同一套路。 */
export interface NpcDraft {
  type: number
  px: number
  py: number
  dir: number
  frame: number
  length: number
  span: number
  images: readonly string[]
  name: string
  oral: readonly string[]
  action: MutableTimer
  walk: MutableTimer
}

export function toNpcDraft(npc: NpcState): NpcDraft {
  return {
    type: npc.type,
    px: npc.px,
    py: npc.py,
    dir: npc.dir,
    frame: npc.frame,
    length: npc.length,
    span: npc.span,
    images: npc.images,
    name: npc.name,
    oral: npc.oral,
    action: { ...npc.action },
    walk: { ...npc.walk },
  }
}

export function fromNpcDraft(d: NpcDraft): NpcState {
  return {
    type: d.type,
    px: d.px,
    py: d.py,
    x: tile(d.px),
    y: tile(d.py),
    dir: d.dir,
    frame: d.frame,
    length: d.length,
    span: d.span,
    images: d.images,
    name: d.name,
    oral: d.oral,
    action: { running: d.action.running, dueMs: d.action.dueMs },
    walk: { running: d.walk.running, dueMs: d.walk.dueMs },
  }
}

/**
 * 原地运动的一拍（`NPC.action` 的 `actionPerformed`）。
 *
 * 三行照抄，包括那句写得很怪的 `else if (count == actionRate - 1)`：它与
 * `else` 只在 `count > actionRate-1` 时不同 —— 那时**什么也不做**，帧号卡住。
 * 静止与单向走动的 NPC 的 `actionRate` 是 Java 的字段默认值 0，所以哪怕它们的
 * `action` 定时器被谁误起了，也只会原地不动，不会去读一个不存在的下标。
 */
export function tickNpcAction(d: NpcDraft): void {
  const actionRate = d.type === 2 ? d.images.length : 0
  if (d.frame < actionRate - 1) {
    d.frame++
  } else if (d.frame === actionRate - 1) {
    d.frame = 0
  }
}

/**
 * 单向走动的一拍（`NPC.walk` 的 `actionPerformed`）。
 *
 * 一拍 8 px，四拍一格；`length` 是还剩几格，归零就掉头、`count` 跳到对面那组
 * 四帧的头上、`length` 复位成 `temp`。四个 case 的写法**不对称**，照抄：
 *
 * - 1（左）与 9（下）用 `count < 3` / `count == 3`，帧号跑 0..3；
 * - 5（右）与 13（上）用 `count < 7 && count >= 4` / `count == 7`，帧号跑 4..7。
 *
 * 这意味着一个**初始方向就是 5 或 13** 的 NPC 永远不会动：它的 `count` 初值是
 * 0，两个条件都不成立，每 200 ms 什么也不发生。这不是要修的 bug，是原版的
 * 行为；数据里有没有这样的 NPC 由 `npc.test.ts` 现场去数。
 */
export function tickNpcWalk(d: NpcDraft): void {
  switch (d.dir) {
    case NPC_LEFT:
      if (d.frame < 3) {
        d.frame++
        d.px -= 8
      } else if (d.frame === 3) {
        d.frame = 0
        d.px -= 8
        d.length--
      }
      if (d.length === 0) {
        d.dir = NPC_RIGHT
        d.frame = 4
        d.length = d.span
      }
      break
    case NPC_RIGHT:
      if (d.frame < 7 && d.frame >= 4) {
        d.frame++
        d.px += 8
      } else if (d.frame === 7) {
        d.frame = 4
        d.px += 8
        d.length--
      }
      if (d.length === 0) {
        d.dir = NPC_LEFT
        d.frame = 0
        d.length = d.span
      }
      break
    case NPC_DOWN:
      if (d.frame < 3) {
        d.frame++
        d.py += 8
      } else if (d.frame === 3) {
        d.frame = 0
        d.py += 8
        d.length--
      }
      if (d.length === 0) {
        d.dir = NPC_UP
        d.frame = 4
        d.length = d.span
      }
      break
    case NPC_UP:
      if (d.frame < 7 && d.frame >= 4) {
        d.frame++
        d.py -= 8
      } else if (d.frame === 7) {
        d.frame = 4
        d.py -= 8
        d.length--
      }
      if (d.length === 0) {
        d.dir = NPC_DOWN
        d.frame = 0
        d.length = d.span
      }
      break
  }
}

/**
 * 一个 NPC 的两个定时器在这一 tick 该触发几次。
 *
 * 次序是 `action` 再 `walk`：导出器按**字段名排序**装定时器
 * （`ExportTrace.sortedFields`），`NPC` 的两个字段就是这个次序。今天两者不会
 * 同时在跑，钉死它只是不留"万一"。
 */
export function tickNpcTimers(d: NpcDraft, now: number): void {
  fireDue(d.action, now, NPC_TIMER_MS, () => tickNpcAction(d), 'NPC 的原地动画定时器')
  fireDue(d.walk, now, NPC_TIMER_MS, () => tickNpcWalk(d), 'NPC 的走动定时器')
}

/**
 * `NPCEvent.checkNPCStop`：主角走到跟前就停下，走开就接着动。
 *
 * 主循环每 10 ms 调一次，所以这是**每 tick 都跑**的判定，不是事件。
 *
 * 单向走动按当前方向各有一条不同的贴身条件（照抄，四条各不相同）：
 *
 * | 方向 | 停下的条件 |
 * |---|---|
 * | 1 左  | `x1 == x2 && y1 == y2 - 1` |
 * | 5 右  | `x1 + 1 == x2 && y1 == y2 - 1` |
 * | 9 下  | `y1 + 2 == y2 && x1 == x2` |
 * | 13 上 | `y1 + 1 == y2 && x1 == x2` |
 *
 * 原地运动用的是另一组四选一的条件（跟 `checkNPCOral` 那组逐字相同）。
 *
 * **`start()` 是无条件调用的**（原地运动那一支连 `isRunning()` 都不问），
 * 靠的是 Swing "对已经在跑的定时器空操作"这条语义。写成重新计时，原地动画
 * 每 10 ms 被推远一次 200 ms，就再也播不动了 —— 见 `timer.ts`。
 */
export function checkNpcStop(
  npcs: readonly NpcDraft[],
  roleTileX: number,
  roleTileY: number,
  now: number,
): void {
  const x2 = roleTileX
  const y2 = roleTileY
  for (const npc of npcs) {
    const x1 = tile(npc.px)
    const y1 = tile(npc.py)
    if (npc.type === 1) {
      const adjacent =
        npc.dir === NPC_LEFT
          ? x1 === x2 && y1 === y2 - 1
          : npc.dir === NPC_RIGHT
            ? x1 + 1 === x2 && y1 === y2 - 1
            : npc.dir === NPC_DOWN
              ? y1 + 2 === y2 && x1 === x2
              : npc.dir === NPC_UP
                ? y1 + 1 === y2 && x1 === x2
                : null
      // 方向码不在这四个里时原版的 switch 一个 case 都不进：既不停也不起。
      if (adjacent === null) continue
      if (adjacent) stopTimer(npc.walk)
      else startTimer(npc.walk, now, NPC_TIMER_MS)
    } else if (npc.type === 2) {
      if (facing(x1, y1, x2, y2)) stopTimer(npc.action)
      else startTimer(npc.action, now, NPC_TIMER_MS)
    }
  }
}

/**
 * 主角是不是站在能跟这个 NPC 搭话的四个位置之一。
 * `NPCEvent` 里出现了两遍（`checkNPCOral` 的 type==0 支与 `checkNPCStop` 的
 * type==2 支），逐字相同，这里合成一处。
 */
export function facing(x1: number, y1: number, x2: number, y2: number): boolean {
  return (
    (x1 - 1 === x2 && y1 === y2 - 1) ||
    (x1 + 1 === x2 && y1 === y2 - 1) ||
    (x1 === x2 && y1 === y2) ||
    (x1 === x2 && y1 + 2 === y2)
  )
}

function range(from: number, to: number): number[] {
  const out: number[] = []
  for (let n = from; n <= to; n++) out.push(n)
  return out
}

function field(row: readonly string[], k: number, where: string): string {
  const value = row[k]
  if (value === undefined) {
    // 原版：ArrayIndexOutOfBoundsException，走进这个场景直接崩。
    throw new Error(
      `${where} 只有 ${row.length} 个字段，取不到第 ${k} 个：${row.join(' ')}。` +
        `原版在这里是 ArrayIndexOutOfBoundsException。`,
    )
  }
  return value
}

function int(text: string, where: string): number {
  if (!/^[+-]?\d+$/.test(text)) {
    throw new Error(`${where} 的 ${JSON.stringify(text)} 不是整数（原版：NumberFormatException）。`)
  }
  return Number.parseInt(text, 10)
}
