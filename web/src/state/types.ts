/**
 * 状态层的类型。**这一层不认识渲染**：没有 canvas、没有 Pixi、没有 DOM，
 * 只有一个纯函数 `step(world, input, dtMs) -> World`。
 *
 * 为什么非要这样：原版的状态推进挂在绘制上（`ScenePanel.paint()` 有副作用，
 * 不画就不推进），照抄到浏览器里就是"标签页切后台 → 逐帧回调停摆 → 游戏冻住
 * → 切回来补跑几百帧"。把时间与输入做成入参，推进就跟"谁在画、画不画得动"
 * 彻底无关了（见 `loop.ts`）。
 */

import type { DialogueScript, DialogueState } from './dialogue'
import type { NarratageState } from './narratage'
import type { NpcState } from './npc'

/** 主角朝向。原版是 `Role.DOWN/UP/LEFT/RIGHT` = 0/8/16/24。 */
export type Direction = 'down' | 'up' | 'left' | 'right'

/** trace 里 `role.dir` 的取值，就是上面四个词——两端用同一套名字。 */
export const DIRECTIONS: readonly Direction[] = ['down', 'up', 'left', 'right']

/** 原版的方向常量，`Role.move()` 与跑步落格的判定都按它取模。 */
export const DIRECTION_CODE: Readonly<Record<Direction, number>> = {
  down: 0,
  up: 8,
  left: 16,
  right: 24,
}

export type ArrowKey = 'left' | 'right' | 'up' | 'down'

/**
 * 一个输入事件。字段名与 trace 里 `ticks[].input` 的**逐字段一致**——
 * 回放真值时不必再翻译一道，翻译层是错位的常见来源。
 *
 * `k` 故意是宽的 `string`：trace 里还有 `space`（搭话、推进对话），
 * 那些键属于别的票。**收窄成 `ArrowKey` 是危险的**——回放时就得先过滤一道，
 * 而漏掉过滤不会有类型错误，只会让空格键被当成方向键去起走路定时器
 * （本实现第一版正是这么错的：dorm-walk 的 t=391 一按空格主角就又走了起来）。
 * 所以过滤放在 `step()` 里，用 `isArrowKey` 显式判，走不了漏。
 */
export type InputEvent =
  | { readonly e: 'press'; readonly k: string; readonly ctrl: boolean }
  | { readonly e: 'release'; readonly k: string }

export function isArrowKey(k: string): k is ArrowKey {
  return k === 'left' || k === 'right' || k === 'up' || k === 'down'
}

/**
 * 一个 `javax.swing.Timer` 的替身状态。
 *
 * `dueMs` 是绝对虚拟时刻。**`start()` 对已经在跑的定时器是空操作**
 * （Swing 的 `TimerQueue.addTimer` 直接忽略已入队的定时器），`restart()`
 * 才重新计时——这条区别在 `tools/src/devtools/VirtualTimer.java` 里害过一次，
 * 这里照抄它的语义，不重新发明。
 */
export interface TimerState {
  readonly running: boolean
  readonly dueMs: number
}

/** 碰撞层：格子尺寸的网格加边界。来自 `SceneScript` 的 `col/row/mapSet`。 */
export interface CollisionMap {
  readonly col: number
  readonly row: number
  /** `mapSet[y][x]`：**0 = 可走，非 0 = 挡住**（见 `RoleEvent.isAllow`）。 */
  readonly mapSet: readonly (readonly number[])[]
}

/** 一个格子坐标。NPC 的占位用它。 */
export interface TilePos {
  readonly x: number
  readonly y: number
}

/**
 * 主角。字段与原版 `scene.Role` 一一对应，命名换成 trace 里的说法：
 *
 * | 这里 | 原版 | trace |
 * |---|---|---|
 * | `px` / `py` | `Role.x` / `Role.y`（像素） | `role.px` / `role.py` |
 * | `dir` | `direction` | `role.dir` |
 * | `frame` | `count`（0..7） | `role.frame` |
 * | `runFrame` | `count2`（0..3） | —（跑步图靠它选帧） |
 * | `nextStep` | `nextStep` | — |
 * | `running` | `isRun` | `role.running` |
 * | `canStop` | `canStop` | — |
 * | `event` | `event` | — |
 */
export interface RoleState {
  readonly px: number
  readonly py: number
  readonly dir: Direction
  readonly frame: number
  readonly runFrame: number
  readonly nextStep: boolean
  readonly running: boolean
  readonly canStop: boolean
  /** 当前定时器正在执行的移动方向。按下方向键时**只在定时器没跑时**才更新。 */
  readonly event: Direction
  readonly walk: TimerState
  readonly run: TimerState
}

/**
 * 世界。**渲染只读它，永不写它。**
 *
 * `timeMs` 是"已经推进过的虚拟毫秒总量"，也就是**下一个** tick 的时刻：
 * 本 tick 的输入与定时器都发生在进入 `step()` 时的 `timeMs`，返回的世界里
 * 它已经加上了 `dtMs`。所以 `step()` 返回的世界就是 trace 里 `vt == 入参
 * 的 timeMs` 那一行的快照。
 *
 * `dialogue` 是对话框、逐字游标与头像（xl-9bd.10），`script` 是它要用的那几段
 * 脚本数据加上 `ScenePanel.isScript`。它们在这里而不是在渲染层，是因为逐字
 * 游标**是可断言的世界状态**：trace 每一 tick 都记着原版此刻打到第几个字，
 * 两端只能对齐，不能协商。
 *
 * `npcs` 参与两件事：碰撞（`RoleEvent.isAllow` 里那条 `y == npc.y + 1`）与
 * 绘制顺序（`ScenePanel.paint` 里那个全局翻转）。它们**自己会动** —— 四种运动
 * 状态与"主角走近就停下"都在 `state/npc.ts` 里，由 `step()` 逐 tick 推进
 * （xl-9bd.9）。`NpcState` 带着派生的格子坐标 `x`/`y`，所以它同时是一个
 * `TilePos`，上面那两处照读不误。
 */
export interface World {
  readonly timeMs: number
  readonly collision: CollisionMap
  readonly npcs: readonly NpcState[]
  readonly role: RoleState
  readonly script: DialogueScript
  readonly dialogue: DialogueState
  /**
   * 旁白（xl-9bd.11）。逐字打印、背景动画、以及"播完就再也不起"这三件事都在
   * `state/narratage.ts` 里，由 `step()` 逐 tick 推进。
   *
   * **它同时是一道绘制开关**：旁白进行中原版一个精灵都不画（`ScenePanel.paint()`
   * 里主角、NPC、地图整个在 `if (!narratage.isNarratage)` 里面），所以渲染层
   * 也要读它。
   */
  readonly narratage: NarratageState
  /**
   * `ScenePanel.isScript`。旁白与主线对话的轮询只在它为真时进行——从大地图走
   * 进宿舍时原版把它置成 false，那时进场脚本不该再播一遍。
   *
   * 原版的字段初值是 `true`，这里同样默认 `true`（见 `createWorld`）。
   */
  readonly isScript: boolean
}
