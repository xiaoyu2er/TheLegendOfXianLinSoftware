/**
 * 状态层的类型。**这一层不认识渲染**：没有 canvas、没有 Pixi、没有 DOM，
 * 只有一个纯函数 `step(world, input, dtMs) -> World`。
 *
 * 为什么非要这样：浏览器里把逐帧回调当时钟用，标签页一切后台回调就停摆，
 * 游戏冻住、切回来补跑几百帧。把时间与输入做成入参，推进就跟"谁在画、画不画
 * 得动"彻底无关了（见 `loop.ts`）。
 *
 * 原版**场景**面板确有一部分状态挂在绘制上：`ScenePanel.paint()` 调
 * `calOffset()` 算视口，`Dialogue.drawDialogue()` 遇到对话正文里的 `@` / `$`
 * 会写 `dialogueFight` / `gameOver`。⚠️ 但**不要把这条推广到战斗**——
 * "战斗状态机被渲染驱动"是一条曾经写在迁移计划里、2026-09-06 被实测推翻的
 * 结论（426 步 × 24 字段零行差异），见 `docs/trace-format.md`。
 */

import type { DialogueScript, DialogueState } from './dialogue'
import type { ExitTable } from './exit'
import type { BattleInfo, FightState } from './fight'
import type { NarratageState } from './narratage'
import type { NpcState } from './npc'
import type { PresentRequest, SelectRecord, SelectState } from './select'
import type { TreasureGain, TreasureState } from './treasure'

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
export interface World extends SceneRequests {
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
  /**
   * 当前脚本文件名（`ScenePanel.fileName`），如 `宿舍.txt`。**这是场景切换
   * 唯一可断言的事实**：只看主角坐标的话，"走出门进了大地图"与"在原地被瞬移
   * 到 (4,23)"分不开。trace 每一 tick 都记着它（xl-9bd.12）。
   */
  readonly scene: string
  /** 本场景的出口表（`Exit` 段）。`null` = 这个场景没有出口。 */
  readonly exit: ExitTable | null
  /**
   * 背景音乐（xl-9bd.12）。**它是一个声明值，不是"调用了 play()"**：
   * `MusicPlayer.currentPlayingBGM` 在原版里也是先赋值、再去开音频设备，
   * trace 记的就是这个字符串。播放器只是把它同步到实际输出的订阅者
   * （见 `audio/bgmPlayer.ts`），所以"该放哪首"永远是可测的。
   *
   * `null` = 这个场景的 `Music` 段是空的（原版会拿 null 去拼路径，
   * 抓异常打一行栈，什么都不放）。
   */
  readonly audio: AudioState
  /**
   * `ScenePanel.currentScript`：剧情进度的三元组 `[入口 "x/y", 场景, 脚本]`。
   * **它不属于任何一个场景**——是 `ScenePanel` 的字段，初值写死在构造函数里
   * （`7/7` / `宿舍.txt` / `脚本1.txt`），只有出口事件会动它。
   */
  readonly currentScript: readonly string[]
  /**
   * `ScenePanel.nextScript`：下一段剧情的三元组，来自脚本的 `NextScript` 段。
   * **换场景时是粘的**：原版 `initiation` 写的是
   * `if (reader.getNextScript() != null) nextScript = ...`，新场景没有这一段
   * 就留着上一个场景的那份。照抄，不"顺手清掉"。
   */
  readonly nextScript: readonly string[] | null
  /**
   * `ExitEvent.dialogueOrder`：走出去之前记下的主线对话进度，从大地图走回
   * 同一段剧情时用它还原。**每次 `initiation` 都跟着 `ExitEvent` 一起重建**，
   * 所以它的初值恒为 0。
   */
  readonly savedOrder: number
  /**
   * `ScenePanel.fightEvent`（xl-rh9.17）：计步战斗与剧情固定战的触发器。
   * 跟 `ExitEvent` 一样**每次 `initiation` 都重建**，所以 `battle1Over` 与
   * `countOfBattle1` 是每个场景各一份的。
   */
  readonly fight: FightState
  /**
   * 选择框 / 答题那套状态机（xl-yg6.8）。整个来自 `src/scene/SelectEvent.java`，
   * 真值按这一个对象整列记（`select`）。
   *
   * **它同时是一道闸**：`isSelect` 为真时方向键归光标、主角走不动
   * （`ScenePanel.keyPressed` 的 `if (!selectEvent.isSelect)`），所以
   * `applyInput` 要读它；渲染层也要读它（原版 `paint()` 的第 3 步）。
   */
  readonly select: SelectState
  /**
   * `SelectEvent.mapName` / `answeredRecorder` 那两张 **static** 表配成的
   * 记录：这一局游戏里哪个场景的哪几道题答过了。
   *
   * 它**不属于任何一个场景**，所以在这里而不在 `select` 里 —— 换场景时由
   * `initiate` 原样带过去，跟 `currentScript` / `nextScript` 同一个道理。
   * 真值里看得见（`question-memory` 走出去又走回来，`answered` 归零而
   * 这张表没有）。
   */
  readonly recorder: readonly SelectRecord[]
  /**
   * 宝箱与「得到物品」提示框（xl-yg6.10）。整个来自
   * `src/scene/EquipmentEvent.java` 与它持有的那批 `TreasureBox`，真值按这一个
   * 对象整列记（`treasure`）。每次 `initiate` 都新建 —— 提示框与"开过没"都
   * 不跨场景，原版就是这样。
   */
  readonly treasure: TreasureState
  /**
   * `GameLauncher.currentPanel == scenePanel`（xl-rh9.17）。
   *
   * **场景那条线程在战斗期间照跑不误**：`ScenePanel.run()` 是个
   * `while(true)`，切到战斗面板并不会停下它。唯一读这件事的是第 1 步
   * 检查旁白那道 `if`，所以这一层也只在那里读。
   *
   * 默认 `true`（原版开机后 `switchTo("scene")` 一进场就是它）；回放真值时
   * 也恒为 `true` —— 导出器驱动的就是场景面板本身。
   */
  readonly showing: boolean
  /**
   * `reader.getSceneMusic()`：这个场景**自己的**曲子（xl-yg6.11）。
   *
   * 与 `audio.bgm` 不是一回事：后者是"此刻在放哪首"，进战斗那一下会被
   * `BattlePanel.initial` 换成战斗曲（`MusicPlayer.currentPlayingBGM` 是全局的，
   * 真值 `battle-door` 那一列记着），而回到场景时原版要的是**这一首**
   * （见 `sceneSignal`）。只存 `audio` 的话，打完回来就没处取了。
   */
  readonly sceneMusic: string | null
  /**
   * `GameLauncher.SCENE_SIGNAL`（xl-yg6.11）：`switchTo("scene")` 置 1，
   * `ScenePanel.step()` 末尾读到就 `readBGM(reader.getSceneMusic())` 再清 0 ——
   * **从战斗 / 商店 / 菜单回到场景时把场景的曲子放回去**的就是它。
   *
   * 原版是一个 static，不属于任何场景，所以换场景时原样带过去。置它的是会话
   * （`game/session.ts`，面板翻回 `scene` 那一下），读它的只有 `step()`。
   * 回放真值时恒为 `false`：导出器从不 `switchTo("scene")`。
   */
  readonly sceneSignal: boolean
  /**
   * 原版 `Reader` 读脚本时**顺手写进静态字段**的那几样（xl-i06.9）：
   * `SaveAndLoad.mapName`（地图头第一行）、`Reader.task`（`Task` 段）、
   * `SaveAndLoad.zhang/lu/wen`（`Role` 段）。存档第 1 行就是这五样
   * （`Recorder.save` 的 `roleAndMapInfo`），存读档面板的槽位摘要画的也是它们。
   *
   * 全仓只有 `ScenePanel.initiation` 一处 `new Reader(...)`，所以它们恒等于
   * 「最近一次进的那个场景」读出来的值 —— **但 `Task` / `Role` 两段缺席时是粘的**：
   * 静态字段没人去清，留着上一个场景的。`mapName` 每个脚本都有，不粘。
   * 初值是原版字段初值：`task = null`、三个开关 `false`。
   */
  readonly readerStatics: ReaderStaticFields
}

/** 见 `World.readerStatics`。 */
export interface ReaderStaticFields {
  readonly mapName: string
  readonly task: string | null
  readonly zhang: boolean
  readonly lu: boolean
  readonly wen: boolean
}

/**
 * **只亮一拍的请求**那一族（xl-i06.3 收拢）：`step()` 的**输出**，不是常驻状态。
 * `null` = 这一拍没有。
 *
 * 它们共用三件事，收拢之后各只写在一处：
 *
 * - **每一拍都从全 `null` 起**：`step()` 起手铺一份 `NO_REQUESTS` 当草稿、
 *   返回时整个铺回世界上，所以上一拍亮过的这一拍一定熄；新建的世界
 *   （`initiate`）同样铺 `NO_REQUESTS`；
 * - **亮的那一拍停批**：`state/loop.ts` 只问 `hasRequest(world)`。一次 pump
 *   常常补跑好几拍，不停的话亮着的那一拍会被下一拍（全 `null`）覆盖掉；
 * - **会话层（`game/session.ts`）当拍接走**。
 *
 * 加一个新请求：在这里加一个字段 → `NO_REQUESTS` 补一个键（不补
 * `pnpm typecheck` 就红）→ `step()` 里在该亮的地方写 `req.<它> = …` →
 * 会话层去接。停批与每拍清零不用再碰。
 */
export interface SceneRequests {
  /**
   * **这一拍要起一场战斗**（xl-rh9.17）。
   *
   * 起战斗的那一拍是哪一拍在原版里看得见（`switchTo("battle")` 就发生在那一拍
   * 里），所以把它做成一个只亮一拍的字段，而不是让调用方去比较前后两个世界
   * 猜出来。
   *
   * 元组是 `Fight` 段那一行，原样递出去 —— 解它、建怪、切面板都在
   * `game/session.ts`。
   */
  readonly battleRequest: BattleInfo | null
  /**
   * **这一拍选择框要切到药店或装备超市**（`GameLauncher.switchTo(...)`）。
   *
   * 消费者是 `game/session.ts`（xl-yg6.11）：翻到 `shop` 面板、进
   * `SHOP_OF_DOOR` 那一家。它非发不可，是因为"选了是"与"选了否"在别处一模
   * 一样（`isSelect` 两条路上都留着，见 `docs/trace-format.md`），不发出来就
   * 没有任何东西分得开这两条路。
   */
  readonly selectPanelRequest: 'shop' | 'equipmentShop' | null
  /**
   * **这一拍答对或答错了**：加扣多少金币、"得到物品"提示框该吐哪句话。
   *
   * 两个消费者：钱包（`game/session.ts`，xl-yg6.9）读 `coins`；提示框在
   * `step()` 里当拍就接走了 `text`（`state/treasure.ts` 的 `drawString`，
   * xl-yg6.10）—— 那一半不必出这一层，它就是 `World.treasure`。
   */
  readonly presentRequest: PresentRequest | null
  /**
   * **这一拍开箱开出来的东西**（`DrugPack.addDrug(treasureName, i)`），由
   * `game/session.ts` 记进背包。
   *
   * 是数组而不是一件：原版 `EquipmentEvent.keyPressed` 对每一个宝箱都跑一遍，
   * 同时挨着两个没开过的箱子时，一下空格两个都开。
   */
  readonly treasureRequest: readonly TreasureGain[] | null
}

/**
 * 一个都不亮。类型是 `SceneRequests` 的键逐个映成 `null`，所以**给
 * `SceneRequests` 加了字段而这里没补，`pnpm typecheck` 当场红** —— 它因此
 * 同时是这一族的名单，`hasRequest` 与 `requests.test.ts` 都从它现读。
 */
export const NO_REQUESTS: { readonly [K in keyof SceneRequests]: null } = {
  battleRequest: null,
  selectPanelRequest: null,
  presentRequest: null,
  treasureRequest: null,
}

const REQUEST_KEYS = Object.keys(NO_REQUESTS) as readonly (keyof SceneRequests)[]

/** 这一拍有没有哪个请求亮着。`state/loop.ts` 靠它停批。 */
export function hasRequest(requests: SceneRequests): boolean {
  return REQUEST_KEYS.some((k) => requests[k] !== null)
}

/** 世界声明此刻该放的背景音乐。见 `World.audio`。 */
export interface AudioState {
  readonly bgm: string | null
}
