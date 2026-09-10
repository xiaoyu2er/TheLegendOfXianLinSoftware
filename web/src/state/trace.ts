import { readFileSync, readdirSync } from 'node:fs'
import { repoPath } from '../test/repoPath'
import type { SceneScript } from '../data/types'
import { initiate } from './step'
import type { SceneSource } from './step'
import type { InputEvent, TilePos, World } from './types'

/**
 * `tools/traces/out/*.trace.json` 的形状——**只声明已经有人对齐的字段**。
 * 今天是主角、NPC、对话框、旁白、视口与绘制顺序。
 *
 * 这是**测试与开发工具用的读取器**，跑在 Node 上（`node:fs`），不进浏览器包。
 */
export interface Trace {
  readonly format: string
  /**
   * **驱动器判别名**（xl-1vu.2）：这份真值是原版哪一个面板导出来的
   * （场景 = `scene`，将来还有战斗 / 菜单 / 商店）。由导出侧的
   * `TraceDriver.kind()` 写入，回放端照它决定装配哪一套。
   *
   * 没有它，回放端只能猜；而猜错的表现是"装出来的东西不对"，不是"读不出来"。
   */
  readonly driver: string
  readonly script: {
    readonly name: string
    /**
     * 先加载一遍的脚本，可为 `null`。96 个场景里有 20 个没有 `Dialogue` 段，
     * 依赖前一个场景残留的 `dialogueEvent` 对象才能跑（见 `docs/trace-format.md`）。
     * **回放时必须照做**：`initiate` 把那份残留原样带过来，而出口的分支正是
     * 靠它分开的（见 `state/step.ts` 的 `carryDialogue`）。
     */
    readonly warmup: string | null
    readonly scene: string
    readonly tickMs: number
    /**
     * `ScenePanel.isScript`：false 时旁白与主线对话的轮询整个跳过。
     * 见 `docs/trace-format.md` 的剧本字段表。
     */
    readonly isScript: boolean
  }
  readonly tickCount: number
  readonly ticks: readonly TraceTick[]
}

/**
 * trace 里一个 NPC 的快照。`dir` 用的是**原版的方向码**（1 左 / 5 右 / 9 下 /
 * 13 上），不是主角那套 `down/up/left/right` —— 脚本数据里就是这么写的，
 * 翻译一道只会多一个错位的机会。
 */
export interface TraceNpc extends TilePos {
  readonly px: number
  readonly py: number
  readonly type: number
  readonly dir: number
  readonly frame: number
}

export interface TraceTick {
  readonly t: number
  readonly vt: number
  readonly ip: number
  readonly input: readonly InputEvent[]
  readonly role: {
    readonly x: number
    readonly y: number
    readonly px: number
    readonly py: number
    readonly dir: 'down' | 'up' | 'left' | 'right'
    readonly frame: number
    /** `Role.count2`，跑步图的帧号（xl-u39）。走动时它不变，跑动时 0→3 循环。 */
    readonly runFrame: number
    readonly running: boolean
    readonly moving: boolean
  }
  readonly npcs: readonly TraceNpc[]
  /**
   * 对话框的**全部**可断言字段（xl-9bd.10 起）。字段名与 `state/dialogue.ts`
   * 的 `DialogueState` 一一对应，逐 tick 比对时不必翻译一道。
   *
   * `source` 为 `script` 才是 `dialogueEvent.isSpeaking`；`npc` 走的是
   * `npcEvent.isOral`。两者共用同一个 `Dialogue` 对象，所以下面那十个字段
   * 两种来源都有效。
   */
  readonly dialogue: {
    readonly active: boolean
    readonly source: 'npc' | 'script' | 'none'
    readonly type: number
    readonly head: number
    readonly name: string | null
    readonly sentence: string | null
    /** `count_sentence`：整句的游标，**翻页不清零**。 */
    readonly cursor: number
    readonly row: number
    readonly col: number
    /** `isPrint`：弹出动画播完、开始打字。 */
    readonly printing: boolean
    readonly sentenceOver: boolean
    /** `isBufferedTextOver`：一屏 4×20 打满，等翻页。 */
    readonly pageOver: boolean
  }
  /**
   * 旁白的整个状态机（xl-9bd.11）。六个字段与 `state/narratage.ts` 的
   * `NarratageState` 逐字段对应，`traceReplay.test.ts` 逐 tick 比对它们 ——
   * 只比 `active` 的话，逐字游标整个写错也照样是绿的。
   */
  readonly narratage: {
    readonly active: boolean
    readonly over: boolean
    readonly line: number
    readonly cursor: number
    readonly row: number
    readonly bg: number
  }
  /**
   * 这一 tick 走的是哪个脚本（`ScenePanel.fileName`）与 `ScenePanel.isScript`
   * （xl-9bd.12）。出口生效的那一 tick 两者一起变 —— 只比主角坐标的话，
   * "切到了大地图"与"在原地被瞬移"分不开。
   */
  readonly scene: string
  readonly isScript: boolean
  /**
   * 选择框 / 答题那套状态机（xl-yg6.6 加的列，xl-yg6.8 对齐）。整列来自
   * `src/scene/SelectEvent.java` 一个对象。
   *
   * 与 `state/select.ts` 的 `SelectState` **有四处名字不一样**
   * （`active` / `boxMoving` / `qBoxMoving` / `printing`），逐条列在那边的
   * 类型注释里；翻译只发生在 `traceReplay.test.ts` 的 `OBSERVERS.select` 一处。
   *
   * 逐条字段对应源码里的哪一个，见 `docs/trace-format.md` 的字段表。
   */
  readonly select: {
    readonly active: boolean
    readonly shop: boolean
    readonly equipShop: boolean
    readonly battle: boolean
    readonly question: boolean
    readonly asking: boolean
    readonly answering: boolean
    /** `count_selectYesNo`。**取值是 2 和 3**，不是 0/1。 */
    readonly yesNo: number
    readonly abcd: number
    readonly battleNo: number
    readonly questionNo: number
    readonly boxW: number
    readonly boxH: number
    readonly qx1: number
    readonly qy1: number
    readonly qx2: number
    readonly qy2: number
    /** `count_sentence`，**初值 1**。 */
    readonly sentenceNo: number
    readonly wordNo: number
    readonly lineNo: number
    readonly maxLength: number
    readonly boxMoving: boolean
    readonly qBoxMoving: boolean
    readonly printing: boolean
    readonly answered: readonly boolean[]
    readonly fought: readonly boolean[]
    readonly sceneNo: number
    /** 那两张 static 表配成的记录，见 `state/select.ts` 的 `SelectRecord`。 */
    readonly recorder: readonly { readonly scene: string; readonly answered: readonly boolean[] }[]
  }
  /** `MusicPlayer.currentPlayingBGM`：**一个可断言的字符串**，不是"调用了 play()"。 */
  readonly audio: { readonly bgm: string | null }
  /** `OtherEvent.calOffset()` 的六元组，见 `scene/viewport.ts`。 */
  readonly viewport: {
    readonly offsetX: number
    readonly offsetY: number
    readonly firstTileX: number
    readonly lastTileX: number
    readonly firstTileY: number
    readonly lastTileY: number
  }
  /**
   * `ScenePanel.paint()` 里主角与 NPC 的先后。**旁白期间是 `null`**——那些帧
   * 原版一个精灵都不画，没有绘制顺序这回事（`dorm-intro` 开头就有一大段）。
   * 类型里保留这个 `null` 是有意的：收窄成两个字面量，回放时就会在旁白帧上
   * 断言一个原版根本没有的值。
   */
  readonly drawOrder: 'npcs-first' | 'hero-first' | null
}

/**
 * 已导出的 trace，**从磁盘现数**（`tools/traces/out/*.trace.json`），
 * 不抄一份名单。
 *
 * 抄名单的代价是真实的：并行的票随时会加剧本，而写死的名单加上写死的条数
 * （`toHaveLength(3)` 那种）合并时必然冲突，还会让新剧本"加了却没人回放"——
 * 这两件事看起来都跟"一切正常"一模一样。从目录数就都躲开了：少导出一份，
 * 名单立刻短一截；多一份，回放用例立刻多一组。
 */
export const TRACE_NAMES: readonly string[] = readdirSync(repoPath('tools/traces/out'))
  .filter((f) => f.endsWith('.trace.json'))
  .map((f) => f.replace(/\.trace\.json$/, ''))
  .sort()

export function readTrace(name: string): Trace {
  const path = repoPath('tools/traces/out', `${name}.trace.json`)
  return parseTrace(readFileSync(path, 'utf8'), path)
}

/**
 * `TRACE_NAMES` 里属于某个驱动器的那几份（xl-1vu.5）。
 *
 * 为什么需要它：`tools/traces/out/` 从 xl-1vu.5 起不再只有场景真值。这个模块
 * 下面的 `replayWorld` / `sceneNameOf` 以及一大批测试读的都是 `script.scene`、
 * `tick.role`、`tick.audio` 这些**只有场景真值才有**的字段，把菜单真值喂进去
 * 只会得到一句 `Cannot read properties of undefined`。所以按判别名分组，
 * 场景那几条测试只吃 `scene`。
 *
 * **分组为空是硬失败**，不是返回空数组：一条 `for (const name of [])` 的循环
 * 一个断言都不跑，还是全绿的 —— 而"场景真值一份都没导出来"与"全都对上了"
 * 长得一模一样，正是这个项目最贵的那类坑。
 */
export function traceNamesOf(driver: string): readonly string[] {
  const names = TRACE_NAMES.filter((name) => readTrace(name).driver === driver)
  if (names.length === 0) {
    const seen = [...new Set(TRACE_NAMES.map((name) => readTrace(name).driver))].sort()
    throw new Error(
      `tools/traces/out/ 里没有一份 driver=${driver} 的真值（现有的是：${seen.join('、')}）。` +
        `空名单会让照它循环的测试一条断言都不跑、还全绿，所以这里直接抛。`,
    )
  }
  return names
}

/**
 * 场景驱动器导出的那几份真值。逐 tick 回放、视口、NPC、对话、BGM 都只吃这些。
 *
 * **筛子是 `driver`，不是名字**（xl-1vu.4 提的，值得留着）：判别名由导出侧的
 * 驱动器自己报（xl-1vu.2），而按名字前缀猜"这份大概是战斗的"就又是一份会和
 * 实现分家的名单。一份场景真值要是哪天报错了判别名，它会从这里掉出去 ——
 * 所以 `traceHeader.test.ts` 盯着"这个列表不许空、且掉出去的那些确实不是 scene"。
 */
export const SCENE_TRACE_NAMES: readonly string[] = traceNamesOf('scene')

/**
 * 读一份 trace 的头并校验它。**独立成函数是为了能拿篡改过的 JSON 直接测它**——
 * 校验只在读磁盘那条路上存在的话，"它到底拦不拦得住"就没有办法验证。
 *
 * 校的是两件事：格式版本，以及驱动器判别名**在场且形状对**。判别名缺失时不许
 * 有默认值 —— 默认成 `scene` 等于把一份来路不明的真值当场景真值回放，而那种
 * 失败长得和成功一模一样。这里不校名单：认哪些驱动器是回放端的事
 * （见 `src/replay/drivers.ts`），读取器替它记一份就会和实现分家。
 */
export function parseTrace(json: string, path: string): Trace {
  const trace = JSON.parse(json) as Trace
  if (trace.format !== 'xianlin-trace/1') {
    throw new Error(`${path} 的 format 是 ${trace.format}，本读取器只认 xianlin-trace/1。`)
  }
  if (typeof trace.driver !== 'string' || !/^[a-z][a-z0-9-]*$/.test(trace.driver)) {
    throw new Error(
      `${path} 的 driver 是 ${JSON.stringify(trace.driver)}，` +
        `真值必须自报驱动器判别名（形如 scene），否则回放端只能猜。`,
    )
  }
  return trace
}

/** trace 里的场景文件名 `宿舍.txt` → 烘焙注册表里的场景名 `宿舍`。 */
export function sceneNameOf(trace: Trace): string {
  return stemOf(trace.script.scene)
}

/**
 * 照剧本头把世界建出来：**先 `warmup`，再进 `scene`**，最后按剧本的
 * `isScript` 表态。
 *
 * 为什么非要照做 `warmup`：原版的 `initiation` 只在新场景**有** `Dialogue` 段
 * 时才换掉 `DialogueEvent`，所以宿舍与大地图跑的是预热脚本留下的那一份，
 * `dialogueEventOver` 是 `false` 而不是 `true`。而出口的三条分支正是靠这个
 * 字段分开的（见 `state/step.ts` 的 `applyExit`）——不预热就会走错分支，
 * 而画面上只表现为"走回宿舍时进的场景不对"。
 *
 * `getScene` 由调用方给：**这个模块不能 import `scenesEager`**，那会把
 * 96 份场景 JSON 的 eager glob 带进来，而"谁在 import 它"是有测试盯着的
 * （`data/sceneLoading.test.ts`）。
 */
export function replayWorld(trace: Trace, getScene: (name: string) => SceneScript): World {
  const { warmup, scene, isScript } = trace.script
  const warm = warmup === null ? null : initiate(null, getScene(stemOf(warmup)))
  return { ...initiate(warm, getScene(stemOf(scene))), isScript }
}

/**
 * 回放时 `step()` 用的场景来源：出口指的是脚本**文件名**（`大地图.txt`），
 * 烘焙注册表用的是场景名（`大地图`），差的这一层扩展名在这里抹平。
 */
export function sceneSourceOf(getScene: (name: string) => SceneScript): SceneSource {
  return (file) => getScene(stemOf(file))
}

/** trace 里某一 tick 所在场景的注册表名（`宿舍.txt` → `宿舍`）。出口切换之后
 * 一份 trace 会横跨几个场景，**要取哪个场景的数据得逐 tick 问**，不能拿剧本头
 * 那个了事（`scene/viewport.test.ts` 正是这么用的）。 */
export function tickSceneName(tick: TraceTick): string {
  return stemOf(tick.scene)
}

/** `宿舍.txt` → `宿舍`。 */
function stemOf(file: string): string {
  return file.replace(/\.txt$/, '')
}
