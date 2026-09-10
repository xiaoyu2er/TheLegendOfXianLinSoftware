import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SCENE_NAMES } from '../data/scenes'
import { getScene } from '../data/scenesEager'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import { step } from './step'
import { roleMoving, roleTileX, roleTileY } from './role'
import { SCENE_TRACE_NAMES, readTrace, replayWorld, sceneNameOf, sceneSourceOf } from './trace'
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
 * **不启动渲染**：整个文件没有 canvas、没有 Pixi、没有 React、没有 DOM ——
 * 而这句话有一条判据管着（`state/step.test.ts` 的「状态层不碰渲染」，它现扫
 * `src/state/` 每一个文件的 import）。⚠️ 那条判据这一票**真红过一次**：
 * `viewport` / `drawOrder` 两组本来打算在这里签，从 scene/viewport 里 import 了
 * 那两个纯函数，当场被它拦下 —— 于是那两组改走下面 `ALIGNED_ELSEWHERE` 那张表。
 *
 * ⚠️ 这一段与下面那张表的注释都**故意不把那句 import 写成源码形态**：那条
 * 判据是按**文本**扫的（`new RegExp("from ['\"]../scene/")`），写成源码形态
 * 连注释也会被它算成一次违规 —— 实测如此，删掉 import 之后它还红着，红的是
 * 这两行注释。
 *
 * 喂给状态层的只有三样东西，都来自真值：
 *
 * - `input`：trace 里那一 tick 实际喂给原版的按键事件，照着回放；
 * - `script.isScript`：`ScenePanel.isScript`，旁白与主线对话的总开关。
 *
 * **状态字段一个都不喂**：NPC（xl-9bd.9）、主线对话（xl-9bd.10）、旁白
 * （xl-9bd.11）都由状态层自己推进，然后跟真值逐 tick 比对 —— 喂进去再比对
 * 等于让真值给自己打分。`ScenePanel.step()` 那几道门也一样：两张票各自留过
 * 一个"另一半先从真值喂"的临时口子，两半到齐之后一起关掉了（xl-4rx）。
 *
 * ## 登记按**（字段组 × 剧本）的格子**（xl-yg6.4）
 *
 * 这条缝是 M1 建的，比菜单（`menu/menuTrace.test.ts`）与商店
 * （`shop/shopTrace.test.ts`）那两条早，所以原先**没有**那张登记表：九组
 * 字段各写一个 `it`，哪一组还没做就干脆没有那个 `it`，哪个字段还没做就干脆
 * 不写进那个 `it` 的 `expect` —— 于是"这一组还没做"与"这一组做完了"在这条
 * 缝里长得一模一样。M5 要往它里面加好几组新列（xl-yg6.6 的场景快照加列），
 * 没有登记表就没有一条会红的判据。
 *
 * ⚠️ **补上表之后当场逮到一个**：原先那五个 `it` 手挑了主角的九个字段比对，
 * 而真值的 `role` 有**十个** —— 多出来的 `stepNum` 从来没有人比过，也没有
 * 任何地方写着它没被比过。它现在登记在 `DEAD_SUBFIELDS` 里，带着两条判据。
 *
 * 形状与菜单、商店那两份同构（它们是同一套东西的第二、三份实现）：
 *
 * - 登记成"已对齐"的格子，逐 tick `toEqual` 必须真的过；
 * - 登记成"还欠着"的格子，逐 tick `toEqual` 必须真的**不过** —— 否则那一格
 *   已经做完了却还挂着票号，而"做完了"与"没人对"就又长得一样了。
 *
 * ⚠️ **这张票只加登记这一层**，逐 tick 对齐的做法一个字没改：还是
 * `replayWorld` 起手、`step()` 一 tick 一步、逐 tick `toEqual` 真值那一列。
 * 变的是那些断言按格子生成，而不是按手写的 `it` 排列。
 */

/**
 * 真值一行里**不属于状态**的那几列。剩下的每一列都是一个字段组，都要有人登记。
 *
 * 这是**登记**不是分母：哪几列不算状态要人来读 `SceneDriver.snapshotState`
 * 才答得出（`t` 是 tick 序号、`vt` 是虚拟时钟、`ip` 是输入指针、`input` 是
 * 喂进去的那批事件 —— 后两者是**输入**，拿它比对等于让真值给自己打分）。
 * 分母（一共有哪几列、有哪几条剧本）在下面全部从磁盘现数。
 */
const NON_STATE_COLUMNS: readonly string[] = ['t', 'vt', 'ip', 'input']

/**
 * 一个字段组从**世界状态**里怎么取。⚠️ 这是**实现**，不是登记：它取错了、
 * 少取一个字段，下面那批逐格用例就红。
 *
 * 每个观察函数返回的形状必须与真值那一列**逐字段一致**（除掉
 * `DEAD_SUBFIELDS` 里登记过的），多一个少一个都红 —— 下面「子字段也对撞」
 * 那条用例盯着它，而 `toEqual` 比的是整个对象。
 */
const OBSERVERS: Readonly<Record<string, (world: World) => unknown>> = {
  role: (w) => ({
    x: roleTileX(w.role),
    y: roleTileY(w.role),
    px: w.role.px,
    py: w.role.py,
    dir: w.role.dir,
    frame: w.role.frame,
    runFrame: w.role.runFrame,
    running: w.role.running,
    moving: roleMoving(w.role),
  }),
  npcs: (w) =>
    w.npcs.map((n) => ({
      x: n.x,
      y: n.y,
      px: n.px,
      py: n.py,
      type: n.type,
      dir: n.dir,
      frame: n.frame,
    })),
  dialogue: (w) => {
    const d = w.dialogue
    return {
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
  },
  /** `NarratageState` 的六个字段。只比 `active` 的话逐字游标整个写错也绿。 */
  narratage: (w) => {
    const n = w.narratage
    return { active: n.active, over: n.over, line: n.line, cursor: n.cursor, row: n.row, bg: n.bg }
  },
  scene: (w) => w.scene,
  isScript: (w) => w.isScript,
  audio: (w) => ({ bgm: w.audio.bgm }),
}

/**
 * **已经对齐的格子 —— 手写登记。**
 *
 * ⚠️ 这张表**必须手写**。写成"跟着磁盘走"（`Object.keys(OBSERVERS)` 或
 * `SCENE_TRACE_NAMES`）时，下面那条对撞用例的每一段都变成恒真：未登记的格子
 * 必空、`PENDING` 那个循环零轮、交集必空 —— 于是"真值目录里冒出一份没人回放
 * 的剧本"会被**自动算作已对齐**，而那正是这一整套对撞要拦的东西。这是
 * `xl-rh9.8` 真栽过的坑（`docs/agents/dispatch.md` 纪律 3 的那条 ⚠️）。
 *
 * 这不违反纪律 3「别把『目前只有 X』写死」：那一条禁的是把**分母**写死。
 * 这里分母仍然是磁盘上的 `SCENE_TRACE_NAMES` 与真值自己的列名，写死的是
 * "谁已经有人对齐了"这份需要人签字的登记。
 *
 * ⚠️ **这份「全满」是跑出来的，不是宣布的**：xl-yg6.4 把格子全填进来跑了
 * 一遍，红的两样当场登记到了别的表里（`viewport`/`drawOrder` 归
 * `ALIGNED_ELSEWHERE`，`role.stepNum` 归 `DEAD_SUBFIELDS`），剩下 7 组 ×
 * 5 条剧本一条都没红。别把「全满」读成「这张表没用了」—— 它现在守的是两件事：
 *   1. 新真值或新列进来时先红一次 —— **xl-yg6.6 加 `select` / `treasure` 两列时
 *      它真的红了**（十个格子一起掉进"没人登记"），那两列现在挂在 `PENDING` 上；
 *   2. 谁把某一组改回去时那一格立刻红。
 */
const ALIGNED: Readonly<Record<string, readonly string[]>> = {
  // 主角九个字段（格子坐标 / 像素坐标 / 朝向 / 走跑两套帧号 / 走跑两个旗标），
  // M1 的 xl-9bd.6 与 xl-u39。第十个 `stepNum` 见 `DEAD_SUBFIELDS`。
  role: [
    'bigmap-walk',
    'dorm-exit',
    'dorm-intro',
    'dorm-walk',
    'maze-treasure',
    'milestone',
  ],
  // NPC 七个字段，xl-9bd.9。⚠️ `dorm-walk` / `dorm-exit` 那几条里 NPC 动得少，
  // 守的是"别凭空动起来"；真的走动与被 checkNPCStop 停住在下面那条覆盖用例里
  // 有分母兜底。
  npcs: [
    'battle-door',
    'bigmap-walk',
    'dorm-exit',
    'dorm-intro',
    'dorm-walk',
    'equipshop-door',
    'maze-treasure',
    'milestone',
    'question-answer',
    'question-memory',
    'shop-door',
  ],
  // 对话框十二个字段，xl-9bd.10。⚠️ 五条里只有几条真的开过口；一份从头到尾
  // 没有对话的真值上这一格是"全 false 等于全 false"，覆盖靠下面那条数出来的
  // 用例兜。
  dialogue: [
    'bigmap-walk',
    'dorm-exit',
    'dorm-intro',
    'dorm-walk',
    'equipshop-door',
    'maze-treasure',
    'milestone',
    'question-answer',
    'question-memory',
    'shop-door',
  ],
  // 旁白六个字段，xl-9bd.11。⚠️ 只有 `dorm-intro` 与 `milestone` 真的播过旁白
  // （实测 810 / 1070 个 tick），另三条守的是"没有旁白的剧本里它不许自己起来"。
  narratage: [
    'battle-door',
    'bigmap-walk',
    'dorm-exit',
    'dorm-intro',
    'dorm-walk',
    'equipshop-door',
    'maze-treasure',
    'milestone',
    'question-answer',
    'question-memory',
    'shop-door',
  ],
  // 场景文件名与 isScript，xl-9bd.12（出口切换）。
  scene: [
    'battle-door',
    'bigmap-walk',
    'dorm-exit',
    'dorm-intro',
    'dorm-walk',
    'equipshop-door',
    'maze-treasure',
    'milestone',
    'question-answer',
    'question-memory',
    'shop-door',
  ],
  isScript: [
    'battle-door',
    'bigmap-walk',
    'dorm-exit',
    'dorm-intro',
    'dorm-walk',
    'equipshop-door',
    'maze-treasure',
    'milestone',
    'question-answer',
    'question-memory',
    'shop-door',
  ],
  // `MusicPlayer.currentPlayingBGM`，xl-9bd.12。
  audio: [
    'bigmap-walk',
    'dorm-exit',
    'dorm-intro',
    'dorm-walk',
    'equipshop-door',
    'maze-treasure',
    'milestone',
    'question-answer',
    'question-memory',
    'shop-door',
  ],
}

/**
 * **签在别处的字段组 —— 手写登记，写明签在哪个文件、为什么不在这里签。**
 *
 * 这一张表是这条缝独有的（菜单与商店那两层没有分层问题）：真值的 `viewport`
 * 与 `drawOrder` 两列**不是** `World` 的字段，是 `scene/viewport.ts` 那两个
 * 纯函数从世界算出来的，而 `state/step.test.ts` 的「状态层不碰渲染」明令
 * `src/state/` 下不许出现指向 ../scene/ 的 import。
 *
 * ⚠️ **这不是绕开，是那条判据实测拦下来的**：xl-yg6.4 头一版真的在这里
 * 从 scene/viewport 里 import 了 computeViewport 与 computeDrawOrder，把两组
 * 签成了 ALIGNED，`pnpm test` 给的是
 * `expected [ 'traceReplay.test.ts -> ../scene/' ] to deeply equal []`。
 *
 * 没有这张表的话，那两列会掉进"没人登记"里 —— 而"另一条缝在守它"与"谁都
 * 没在守它"长得一模一样。所以指针要留，并且**指针本身要被跑一遍**：下面那条
 * 用例去读被指的那个文件，核它确实按磁盘上的真值名单逐 tick 比对着那一列。
 */
interface AlignedElsewhere {
  /** 签在哪个文件（仓库相对路径）。 */
  readonly file: string
  /** 为什么不能在这里签，一句话。 */
  readonly why: string
}

const ALIGNED_ELSEWHERE: Readonly<Record<string, AlignedElsewhere>> = {
  viewport: {
    file: 'web/src/scene/viewport.test.ts',
    why: '视口六元组是 scene/viewport.ts 的 computeViewport 算的，状态层不许 import 它',
  },
  drawOrder: {
    file: 'web/src/scene/viewport.test.ts',
    why: '绘制顺序是 scene/viewport.ts 的 computeDrawOrder 算的，同上',
  },
}

/**
 * **原版声明了却从来不动的子字段 —— 手写登记，每一条写明在哪份源码里。**
 *
 * 为什么需要这一张表：真值的 `role` 有十个字段，而这一层的 `World` 只答得出
 * 九个。原先那五个手写 `it` 是**手挑字段**比对的，于是第十个从来没被比过，
 * 也没有任何地方写着它没被比过 —— xl-yg6.4 把整列丢进 `toEqual` 才逮到。
 *
 * 拿常量 0 去比它是**按构造成立**的装饰（dispatch.md 纪律 3 的第二族恒真
 * 判据），所以这里登记它、并且**把判据回到 GBK 源码上取**（同一份文档
 * §「真值盖不到那个分支」的第二条出路）。下面那条用例核两件事：
 *
 * 1. 真值里这个字段**从头到尾就那一个值**（分母是磁盘上每一条真值的每一个
 *    tick）—— 原版哪天真让它动起来，这里立刻红；
 * 2. 那份 GBK 源码里这个名字**只出现一次**（就是它的声明）—— 谁哪天写下
 *    第二处（`stepNum += 7` 那句注释许诺过的加法），也立刻红。
 */
interface DeadSubfield {
  /** 哪一列。 */
  readonly column: string
  /** 那一列里的哪个子字段。 */
  readonly field: string
  /** 声明它的那份原版源码（GBK，用 `javaSource` 读）。 */
  readonly source: string
  /** 真值里它恒为这个值。 */
  readonly constant: unknown
  readonly why: string
}

const DEAD_SUBFIELDS: readonly DeadSubfield[] = [
  {
    column: 'role',
    field: 'stepNum',
    source: 'src/scene/Role.java',
    constant: 0,
    why: '计步器：注释写着"每进行一次行走 计步器+7"，而原版从头到尾没有那句 +7',
  },
]

/**
 * **还欠着的格子 —— 手写登记，每一格写明归哪张票。**
 *
 * 这两张表是**对撞**的：真值目录里冒出一份两边都没有的剧本，或者真值多出
 * 一列没人登记，下面第一条用例立刻红。
 *
 * ⚠️ **xl-yg6.6 起它不再是空的。** 那张票给场景快照加了 `select` 与 `treasure`
 * 两列（选择框 / 答题 / 宝箱那几样会变的游标与旗标），而状态层这一头一个字都
 * 还没写 —— 于是十个格子全落在这里。**这正是这张表存在的理由**：没有它，
 * 那两列会掉进"没人登记"里，而"这一列还没做"与"这一列没人对"就长得一样了。
 *
 * ⚠️ 五条剧本名是**手写**的，不是 `SCENE_TRACE_NAMES` 摊出来的 —— 摊出来的话
 * 新真值进目录时会被自动算作"已登记还欠着"，那条对撞就白设了（同上，xl-rh9.8
 * 的坑）。分母仍然是磁盘：少写一条，上面那条 `unaccounted` 立刻红。
 */
const PENDING: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // 选择框那套状态机（`src/scene/SelectEvent.java` 一整个对象）。骨架那张票
  // （选择框 UI + 新列落地）把它翻成已对齐。
  select: {
    'battle-door': 'xl-yg6.8',
    'bigmap-walk': 'xl-yg6.8',
    'dorm-exit': 'xl-yg6.8',
    'dorm-intro': 'xl-yg6.8',
    'dorm-walk': 'xl-yg6.8',
    'equipshop-door': 'xl-yg6.8',
    'maze-treasure': 'xl-yg6.8',
    milestone: 'xl-yg6.8',
    'question-answer': 'xl-yg6.8',
    'question-memory': 'xl-yg6.8',
    'shop-door': 'xl-yg6.8',
  },
  // 宝箱与"得到物品"提示框（`src/scene/EquipmentEvent.java` +
  // `src/scene/TreasureBox.java`）。归宝箱那张票。
  treasure: {
    'battle-door': 'xl-yg6.10',
    'bigmap-walk': 'xl-yg6.10',
    'dorm-exit': 'xl-yg6.10',
    'dorm-intro': 'xl-yg6.10',
    'dorm-walk': 'xl-yg6.10',
    'equipshop-door': 'xl-yg6.10',
    'maze-treasure': 'xl-yg6.10',
    milestone: 'xl-yg6.10',
    'question-answer': 'xl-yg6.10',
    'question-memory': 'xl-yg6.10',
    'shop-door': 'xl-yg6.10',
  },
  // ⚠️ **xl-yg6.7 起，早就对齐的那几组也开始有欠账了**，而这是新真值该有的
  // 样子：那五条新剧本走的是选择框开着时的按键，而"选择框开着就走不动"
  // （`ScenePanel.keyPressed` 的 `if (!selectEvent.isSelect)`）在状态层一个字
  // 都还没写。于是同一下方向键，原版拿去挪光标、这一层拿去挪主角。
  //
  // 逐格实测（xl-yg6.7 把十一条剧本 × 七组全填进 ALIGNED 跑了一遍，红的挪到
  // 这里）：`role` 五条红、`dialogue` 与 `audio` 各一条，其余全绿 —— 包括
  // `maze-treasure` 整条七组（开宝箱按的是空格，不碰方向键），以及
  // `question-memory` 的 `scene` 与 `audio`（它出门进大地图又走回来，
  // 两次场景切换与三次背景音乐切换这一层已经对齐）。
  role: {
    'battle-door': 'xl-yg6.8',
    'equipshop-door': 'xl-yg6.8',
    'question-answer': 'xl-yg6.8',
    'question-memory': 'xl-yg6.8',
    'shop-door': 'xl-yg6.8',
  },
  // 主角**朝向**变了（`RoleEvent.switchWalk` 里那一句 `role.setEvent(方向)`
  // 在挡不挡得住之前就跑了），所以 `checkNPCOral` 那一路跟着变。
  // ⚠️ `npcs` 这一格**不在这里** —— 这条剧本挪光标用的是上键，正上方那一格
  // 被 NPC 占着，主角一步都没挪，十三个 NPC 的走停判据（`checkNPCStop` 看的是
  // 主角**坐标**）因此没受影响，实测逐 tick 全对。
  dialogue: {
    'battle-door': 'xl-yg6.8',
  },
  // 这一格不是连带的，是**战斗那扇门自己的**：选「是」的一下原版先跑
  // `FightEvent.fight(...)`，`BattlePanel.initial` 按背景图把 BGM 换成
  // `B6.mp3`（真值这一列记着），而这一层还没有那条线。归三扇门那张票。
  audio: {
    'battle-door': 'xl-yg6.11',
  },
}

/**
 * **`PENDING` 里那些「前半截已经对上了」的格子 —— 手写登记，写明卡在哪。**
 *
 * 光有 `PENDING` 的话，"第一个 tick 就开始错"与"一直对到走出门那一下、卡在
 * 别人那张票上"长得一模一样：两者都只是"还没对上"。
 *
 * 卡住的那一 tick **不写 tick 号**，写成一句真值自己认得出的话（"在宿舍里
 * 松开方向键的第一 tick"）—— tick 号会随着剧本改动整体平移，而那种失效是
 * 安静的。
 */
interface BlockedAt {
  /** 那一 tick 走的是哪个脚本（`ScenePanel.fileName`，如 `宿舍.txt`）。 */
  readonly scene: string
  /** 那一 tick 的输入事件与它按的键。 */
  readonly event: 'press' | 'release'
  readonly key: string
  /** 卡住的原因，一句话。 */
  readonly why: string
}

/**
 * xl-yg6.4 那一趟是空的（填满格子跑了一遍，一格都没停在半截上）；xl-yg6.7 起
 * 有了一条 —— `shop-door` 的主角一路对到**选择框开着时按下的那一下下键**才分岔，
 * 那正是这张表的形状：前半截全对，卡在别人那张票上。
 *
 * 只登记了这一格，不是挑着写：另外三条 `role` 的分岔点同样是"选择框开着时的
 * 那一下方向键"，但它们的剧本里**走路阶段也按过同一个键**，而这张表认那一 tick
 * 靠的是「第一条 (场景, 事件, 键) 命中」—— 认到的会是走路那一下，登记就成了
 * 一句错话。`shop-door` 从头到尾只按过一次下键，所以只有它认得准。
 */
const BLOCKED_AT: Readonly<Record<string, Readonly<Record<string, BlockedAt>>>> = {
  role: {
    'shop-door': {
      scene: '金陵大学医院.txt',
      event: 'press',
      key: 'down',
      why:
        '选择框开着时原版把方向键交给光标（ScenePanel.keyPressed 的 if (!selectEvent.isSelect)），' +
        '这一层还没有那道闸，同一下键被拿去挪主角 —— 归 xl-yg6.8',
    },
  },
}

/**
 * **整条真值上这一列都是空数组的格子 —— 手写登记，写明为什么空。**
 *
 * 只影响下面那条**子字段对撞**：一列 `npcs` 要是每一 tick 都是 `[]`，
 * 两边的子字段并集都是 `[]`，"两边对上了"与"两边都没东西可对"长得一模一样。
 * 那条用例本来直接 `toBeGreaterThan(0)` 拦死，注释里还写着「今天五条真值的
 * NPC 条数是 13/2/3/2/3（实测），观测不到」—— xl-yg6.7 的 `maze-treasure`
 * 走的是迷宫1，那份脚本**没有 NPC 段**，于是它当场红了。
 *
 * 空不是错，所以不能拦死；但空也不能静悄悄地放过去，否则哪天导出器把某一列
 * 整个写成空数组，这条对撞会一路绿。**折中是让它必须被人签**：签了的格子
 * 免掉子字段对撞（逐 tick 的 `toEqual` 照跑 —— 那一格仍然在守"这一层不许
 * 凭空造一个 NPC 出来"），没签的照旧红。
 *
 * 反方向也红：签了却其实不空，说明这条登记过期了（见下面那条用例）。
 */
interface EmptyColumn {
  /** 空的原因，一句话，指得到原版数据。 */
  readonly why: string
}

const EMPTY_COLUMNS: Readonly<Record<string, Readonly<Record<string, EmptyColumn>>>> = {
  npcs: {
    'maze-treasure': {
      why: 'script/迷宫1.txt 没有 NPC 段 —— 五份带 TreasureBox 的脚本全都没有',
    },
  },
}

/** 同名只读一次 —— 下面每个格子都要把整条真值跑一遍。 */
const traceCache = new Map<string, Trace>()
function traceOf(name: string): Trace {
  let trace = traceCache.get(name)
  if (!trace) {
    trace = readTrace(name)
    traceCache.set(name, trace)
  }
  return trace
}

/** 出口要换场景，`step()` 就得能同步取到下一个场景（见 `state/step.ts`）。 */
const scenes = sceneSourceOf(getScene)

/**
 * 一条真值上**有哪几个字段组** —— 从真值第一行的列名现数，减去那几列非状态列。
 *
 * 这是分母：真值多一列（原版又多记了一样东西），这里立刻多一格，而那一格
 * 三张登记表里都没有 → 红。
 */
function groupsOf(trace: Trace): readonly string[] {
  return Object.keys(columnsOf(trace.ticks[0]!))
    .filter((k) => !NON_STATE_COLUMNS.includes(k))
    .sort()
}

/** 真值一行当成一张按列名索引的表来读。`TraceTick` 是强类型的，索引要过一道。 */
function columnsOf(tick: TraceTick): Record<string, unknown> {
  return tick as unknown as Record<string, unknown>
}

/**
 * 一列里有哪几个**子字段**。对象取键名，数组取所有元素键名的并集，标量返回
 * `null`（`scene` 与 `isScript` 是标量列，没有子字段这回事）。
 *
 * 数组取并集而不是取第一个元素：一条真值里的 NPC 条目要是形状不齐，"取第一个"
 * 会静静漏掉后面那些。
 */
function subKeysOf(value: unknown): readonly string[] | null {
  if (Array.isArray(value)) {
    const keys = new Set<string>()
    for (const item of value) {
      if (item === null || typeof item !== 'object') return null
      for (const k of Object.keys(item as object)) keys.add(k)
    }
    return [...keys].sort()
  }
  if (value !== null && typeof value === 'object') return Object.keys(value).sort()
  return null
}

/**
 * 一列**在整条真值上**出现过的子字段并集。
 *
 * ⚠️ **不能只看 `ticks[0]`**（/code-review 的 Spec 轴提的）：某个子字段只在
 * 后段的 tick 才冒出来时，只读第一行的话那条对撞是绿的，而用例名宣称的是
 * 「真值多一个字段，就得有人签它」。这与 a9a236f 自己学到的那条同形，只是
 * 轴从「剧本」换成了「tick」。
 *
 * 一列在任何一个 tick 上是标量，整列就当标量（`scene` / `isScript`）。
 */
function unionSubKeys(values: readonly unknown[]): readonly string[] | null {
  let keys: Set<string> | null = null
  for (const value of values) {
    const own = subKeysOf(value)
    if (own === null) return null
    keys ??= new Set<string>()
    for (const k of own) keys.add(k)
  }
  return keys === null ? null : [...keys].sort()
}

/** 这一列上登记为"原版不动"的那几个子字段。 */
function deadFieldsOf(column: string): readonly string[] {
  return DEAD_SUBFIELDS.filter((d) => d.column === column)
    .map((d) => d.field)
    .sort()
}

/**
 * 比对前把登记过的死字段从真值那一侧摘掉。摘的是**登记表里那几个**，不是
 * "两边不一样的那几个" —— 后者等于让被守的东西自己给自己签字。
 */
function stripDead(column: string, value: unknown): unknown {
  const dead = deadFieldsOf(column)
  if (dead.length === 0) return value
  if (Array.isArray(value)) return value.map((item) => stripDead(column, item))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([k]) => !dead.includes(k)))
}

/** 把一条真值从头跑到尾，返回每一 tick 的快照。**不做任何比对。** */
function runAll(name: string): Record<string, unknown>[] {
  const trace = traceOf(name)
  let world = replayWorld(trace, getScene)
  return trace.ticks.map((tick) => {
    world = step(world, tick.input, trace.script.tickMs, scenes)
    return Object.fromEntries(Object.entries(OBSERVERS).map(([group, take]) => [group, take(world)]))
  })
}

const snapshotCache = new Map<string, Record<string, unknown>[]>()
function snapshotsOf(name: string): Record<string, unknown>[] {
  let snaps = snapshotCache.get(name)
  if (!snaps) {
    snaps = runAll(name)
    snapshotCache.set(name, snaps)
  }
  return snaps
}

/** 这一格**第一处**对不上的那一 tick；全对上时返回 `ticks.length`。 */
function firstDivergence(name: string, group: string): number {
  const trace = traceOf(name)
  const snaps = snapshotsOf(name)
  const at = trace.ticks.findIndex((tick, i) => {
    const got = snaps[i]![group]
    if (got === undefined) return true
    try {
      expect(got).toEqual(stripDead(group, columnsOf(tick)[group]))
      return false
    } catch {
      return true
    }
  })
  return at === -1 ? trace.ticks.length : at
}

/** 这一格逐 tick 全对上了吗。给"还欠着"那半边用 —— 它要的是**不对上**。 */
function cellMatches(name: string, group: string): boolean {
  return firstDivergence(name, group) === traceOf(name).ticks.length
}

describe('回放行为真值', () => {
  /**
   * 能回放的是**场景已烘焙**的那几份。这里把可回放与不可回放的名单都写死：
   * 少回放了一份要响。"跳过了所以没报错"是这个项目的招牌坑。
   */
  const replayable = SCENE_TRACE_NAMES.filter((name) =>
    SCENE_NAMES.includes(sceneNameOf(readTrace(name))),
  )

  it('xl-9bd.4 之后 96 个场景全部烘焙，每一份 trace 因此都可回放', () => {
    // 分母是 SCENE_TRACE_NAMES 本身（它从 tools/traces/out/ 现数）：将来加了场景 trace
    // 而场景没烘出来，这里会响；而"一份都没有"也会响，不会静静地全绿。
    expect(SCENE_TRACE_NAMES.length).toBeGreaterThan(0)
    expect(replayable).toEqual([...SCENE_TRACE_NAMES])
    // dorm-intro 走的是 脚本1，它在 xl-9bd.4 之前不在烘焙名单里。
    expect(sceneNameOf(readTrace('dorm-intro'))).toBe('脚本1')
  })

  it('每一个（字段组 × 剧本）的格子要么已对齐、要么签在别处、要么记着归谁 —— 没有第四种', () => {
    // 分母两头都从磁盘现数。一份都没有时 `traceNamesOf` 已经抛过了，这条
    // 是给"目录还在但空了"留的。
    expect(SCENE_TRACE_NAMES.length).toBeGreaterThan(0)

    // 每条真值的列名必须一致 —— 不一致说明导出器对两条剧本记的东西不一样，
    // 那时"这一格不存在"与"这一格没人登记"就分不开了。
    const groups = groupsOf(traceOf(SCENE_TRACE_NAMES[0]!))
    expect(groups.length).toBeGreaterThan(0)
    for (const name of SCENE_TRACE_NAMES) {
      expect(groupsOf(traceOf(name)), `${name} 的字段组与其他真值不一致`).toEqual(groups)
    }

    const unaccounted: string[] = []
    const both: string[] = []
    for (const group of groups) {
      if (group in ALIGNED_ELSEWHERE) {
        // 签在别处的组不许同时在这里签 —— 两处都说自己在守，等于两处都可以
        // 指着对方。
        expect(
          group in ALIGNED || group in PENDING,
          `${group} 既登记在 ALIGNED_ELSEWHERE，又出现在 ALIGNED / PENDING 里`,
        ).toBe(false)
        continue
      }
      for (const name of SCENE_TRACE_NAMES) {
        const aligned = (ALIGNED[group] ?? []).includes(name)
        const pending = name in (PENDING[group] ?? {})
        if (!aligned && !pending) unaccounted.push(`${group} × ${name}`)
        if (aligned && pending) both.push(`${group} × ${name}`)
      }
    }
    expect(
      unaccounted,
      '新的场景真值或新的字段组：要么在这里对齐它，要么写明归哪张票',
    ).toEqual([])
    // 同一格同时写进两边时，上面那条过得去 —— "已经对齐了"与"还欠着"就又
    // 长得一样了。
    expect(both, '同一个格子同时登记在 ALIGNED 与 PENDING 里').toEqual([])

    // 反方向：三张登记表里不许有磁盘上没有的组名或剧本名，否则表在骗人。
    for (const [group, names] of Object.entries(ALIGNED)) {
      expect(groups, `ALIGNED 里的 ${group} 不是真值的字段组`).toContain(group)
      for (const name of names) {
        expect(SCENE_TRACE_NAMES, `ALIGNED[${group}] 里的 ${name} 不在真值目录里`).toContain(name)
      }
    }
    for (const group of Object.keys(ALIGNED_ELSEWHERE)) {
      expect(groups, `ALIGNED_ELSEWHERE 里的 ${group} 不是真值的字段组`).toContain(group)
    }
    for (const [group, byTrace] of Object.entries(PENDING)) {
      expect(groups, `PENDING 里的 ${group} 不是真值的字段组`).toContain(group)
      for (const [name, issue] of Object.entries(byTrace)) {
        expect(SCENE_TRACE_NAMES, `PENDING[${group}] 里的 ${name} 不在真值目录里`).toContain(name)
        // 票号是登记的一半：没有票号的"还欠着"等于"忘了"。
        expect(issue, `PENDING[${group}][${name}] 没写票号`).toMatch(/^xl-[\w.]+$/)
      }
    }

    // 观察函数那张表也要跟磁盘对撞：多一个组名说明它守着一列真值里没有的
    // 东西（那一格的 `toEqual` 会拿 undefined 比 undefined，恒真）。
    for (const group of Object.keys(OBSERVERS)) {
      expect(groups, `OBSERVERS 里的 ${group} 不是真值的字段组`).toContain(group)
    }
    // 而登记成"已对齐"的组必须真有人取得出来 —— 没有观察函数的话，快照里
    // 那一列是 undefined，逐格用例会红；这一条把那种红提前到这里，说得清楚
    // 一点。
    for (const group of Object.keys(ALIGNED)) {
      expect(Object.keys(OBSERVERS), `ALIGNED 里的 ${group} 没有观察函数`).toContain(group)
    }
  })

  it('每一列的子字段也对撞 —— 真值多一个字段，就得有人签它或登记它是死的', () => {
    // 分母是真值那一列自己的键名（现读），减去登记过的死字段；对面是观察
    // 函数实际取出来的键名。多一个少一个都红 —— 这一条是这张票逮到
    // `role.stepNum` 的那一条。
    //
    // ⚠️ **每一条真值都要读**，不是只读名单里的第一条：头一版只读了
    // `SCENE_TRACE_NAMES[0]`，往 `dorm-walk` 的 `role` 里塞一个子字段那次
    // 它是绿的（红的只有那一格的逐 tick 用例）—— 而导出器给某一条剧本多记
    // 一列的时候，红在哪一条上是没法预先知道的。
    let compared = 0
    for (const name of SCENE_TRACE_NAMES) {
      const trace = traceOf(name)
      const snaps = snapshotsOf(name)
      for (const group of Object.keys(ALIGNED)) {
        const truth = unionSubKeys(trace.ticks.map((tick) => columnsOf(tick)[group]))
        const got = unionSubKeys(snaps.map((snap) => snap[group]))
        if (truth === null) {
          // 标量列：两边都不许有子字段，否则一边是对象一边是标量。
          expect(got, `${name} 的 ${group} 在真值里是标量，观察函数却给了对象`).toBeNull()
          continue
        }
        compared++
        expect(got, `${name} 的 ${group} 在真值里是对象/数组，观察函数却给了标量`).not.toBeNull()
        // ⚠️ 空的键名表两边都是 `[]`，那一格**恒真**（/code-review 的 Standards
        // 轴提的）：一列 `npcs` 要是空数组，`subKeysOf` 给的就是 `[]`，
        // "两边都没有子字段"与"两边的子字段都对上了"长得一样。今天五条真值的
        // NPC 条数是 13/2/3/2/3（实测），观测不到 —— 所以这条明写出来。
        if (truth.length === 0) {
          // 空列必须被签过；签了就跳过这一格的子字段对撞（理由见 EMPTY_COLUMNS）。
          expect(
            EMPTY_COLUMNS[group]?.[name],
            `${name} 的 ${group} 一个子字段都没读到 —— 整条真值上它都是空的话，` +
              `去 EMPTY_COLUMNS 里签一句为什么；不是的话这是真的漏了`,
          ).toBeTruthy()
          expect(got, `${name} 的 ${group} 真值是空的，观察函数却读出了子字段`).toEqual([])
          continue
        }
        expect(truth.length, `${name} 的 ${group} 一个子字段都没读到`).toBeGreaterThan(0)
        expect(
          [...(got ?? []), ...deadFieldsOf(group)].sort(),
          `${name} 的 ${group} 子字段与真值不一致：真值有 ${truth.join('/')}`,
        ).toEqual([...truth])
      }
    }
    // 空转要响：一列都没比到与"每一列都齐"长得一样。
    expect(compared).toBeGreaterThan(0)
  })

  it('登记成「整列都空」的格子：真值里每一 tick 都真的是空数组', () => {
    // 空转要响：这张表空了的时候这条用例什么也没核。
    const cells = Object.entries(EMPTY_COLUMNS).flatMap(([group, byTrace]) =>
      Object.keys(byTrace).map((name) => [group, name] as const),
    )
    expect(cells.length).toBeGreaterThan(0)
    for (const [group, name] of cells) {
      expect(SCENE_TRACE_NAMES, `EMPTY_COLUMNS[${group}] 里的 ${name} 不在真值目录里`).toContain(
        name,
      )
      const sizes = new Set(
        traceOf(name).ticks.map((tick) => {
          const column = columnsOf(tick)[group]
          return Array.isArray(column) ? column.length : -1
        }),
      )
      // 分母是这条真值的每一 tick：原版哪天在这个场景里放一个 NPC，或者这一列
      // 根本不是数组，这里立刻红 —— 那时这条登记就该撤掉。
      expect(
        [...sizes],
        `${name} 的 ${group} 并不是每一 tick 都空（读到的长度：${[...sizes].join('/')}）`,
      ).toEqual([0])
    }
  })

  it('登记成「原版不动」的子字段：真值里恒定，且源码里只有那一处声明', () => {
    // 空转要响：这张表空了的时候这条用例就什么也没核 —— 而它现在非空。
    expect(DEAD_SUBFIELDS.length).toBeGreaterThan(0)
    for (const dead of DEAD_SUBFIELDS) {
      // 1. 分母是磁盘上每一条真值的每一个 tick：原版哪天真让它动起来，这里红。
      let seen = 0
      const values = new Set<unknown>()
      for (const name of SCENE_TRACE_NAMES) {
        for (const tick of traceOf(name).ticks) {
          const column = columnsOf(tick)[dead.column]
          for (const item of Array.isArray(column) ? column : [column]) {
            values.add((item as Record<string, unknown>)[dead.field])
            seen++
          }
        }
      }
      // 一个 tick 都没读到与"全都是那个常量"长得一样。
      expect(seen, `${dead.column}.${dead.field} 一个 tick 都没读到`).toBeGreaterThan(0)
      expect([...values], `${dead.column}.${dead.field} 在真值里动过了`).toEqual([dead.constant])

      // 2. 判据回到 GBK 源码上取：那个名字只出现一次，就是它的声明。
      //    ⚠️ 必须按 GBK 解码 —— 乱码与"源码里没这一行"在正则下都是零匹配。
      const source = javaSource(dead.source)
      expect(source.length, `${dead.source} 读出来是空的`).toBeGreaterThan(0)
      const hits = source.split('\n').filter((line) => line.includes(dead.field))
      expect(
        hits.length,
        `${dead.source} 里 ${dead.field} 出现了 ${hits.length} 处：` +
          `${hits.map((l) => l.trim()).join(' | ')} —— 原版动它了，这条登记要撤`,
      ).toBe(1)
      expect(hits[0], `${dead.field} 那一处不是声明`).toMatch(
        new RegExp(`\\b${dead.field}\\s*=`),
      )
    }
  })

  it('签在别处的字段组：被指的那个文件真的按磁盘名单逐 tick 比对着那一列', () => {
    // 空转要响：这张表空了的时候这条用例什么也没核。
    expect(Object.keys(ALIGNED_ELSEWHERE).length).toBeGreaterThan(0)
    for (const [group, where] of Object.entries(ALIGNED_ELSEWHERE)) {
      // 指针指的是仓库相对路径，按 UTF-8 读（`web/` 下的源码都是 UTF-8；
      // GBK 那一族走 javaSource）。
      const source = readFileSync(repoPath(where.file), 'utf8')
      // 指针的三种失效方式，一条一条核：文件没了 / 分母不再是磁盘名单 /
      // 那一列不再被比对。三条都做不到的话，"另一条缝在守它"就是一句注释。
      expect(source.length, `${where.file} 读出来是空的 —— 指针指向一个不存在的文件`).toBeGreaterThan(0)
      expect(source, `${where.file} 的分母不是 SCENE_TRACE_NAMES`).toContain('SCENE_TRACE_NAMES')
      // ⚠️ **按词边界数行，不要 `toContain`**：`toContain` 是子串匹配，把那个
      // 文件里的 `tick.viewport` 全改成 `tick.viewportZZ` 之后它照样过 ——
      // 实测如此，这一版是被那条篡改逼出来的（原来的写法 9 处全改掉还是绿的）。
      const hits = source.split('\n').filter((line) => new RegExp(`tick\\.${group}\\b`).test(line))
      expect(
        hits.length,
        `${where.file} 里没有一处比对 tick.${group} —— 指针在骗人`,
      ).toBeGreaterThan(0)
    }
  })

  it('每一条剧本都至少签下了一格 —— 否则那条剧本整条一个断言都不跑，还全绿', () => {
    // 分母是磁盘上的真值名单，所以新加一份真值而它一格都没签时这条就红 ——
    // 那正是「加了却没人回放」与「全都对上了」之间的差别。
    for (const name of SCENE_TRACE_NAMES) {
      const signed = Object.entries(ALIGNED).filter(([, names]) => names.includes(name))
      expect(
        signed.map(([group]) => group),
        `${name} 一格都没签 —— 它下面那批逐格用例一条都不会生成`,
      ).not.toEqual([])
    }
  })

  for (const name of SCENE_TRACE_NAMES) {
    it(`${name}：剧本头、起点与虚拟时钟自洽`, () => {
      const trace = traceOf(name)
      expect(trace.script.tickMs).toBe(10)
      expect(trace.ticks).toHaveLength(trace.tickCount)
      expect(trace.tickCount).toBeGreaterThan(0)

      let world = replayWorld(trace, getScene)
      // 起点也是真值：原版第 0 tick 之前主角就在 (roleX, roleY)，场景与背景
      // 音乐也已经是这些了。
      expect(roleTileX(world.role)).toBe(trace.ticks[0]!.role.x)
      expect(roleTileY(world.role)).toBe(trace.ticks[0]!.role.y)
      expect(world.scene).toBe(trace.ticks[0]!.scene)
      expect(world.audio.bgm).toBe(trace.ticks[0]!.audio.bgm)
      // NPC 的条数就是分母：原版建不出来的条目会被跳过，少建一个要在这里响，
      // 而不是表现为"那个 NPC 的比对压根没跑"。
      expect(world.npcs).toHaveLength(trace.ticks[0]!.npcs.length)

      for (const tick of trace.ticks) {
        expect(world.timeMs, `${name} 第 ${tick.t} tick`).toBe(tick.vt)
        world = step(world, tick.input, trace.script.tickMs, scenes)
      }
      expect(world.timeMs).toBe(trace.tickCount * trace.script.tickMs)
    })
  }

  describe('逐格：登记成「已对齐」的格子逐 tick 与真值相等', () => {
    // ⚠️ `ALIGNED` 空掉的时候这一批用例**静静消失**（实测：54 条 → 19 条），
    // 而「一条都没生成」与「都过了」在测试报告里长得一样。对撞用例那边会
    // 间接红（35 个格子全变成"没人登记"），但**间接红不是明写读数**，所以
    // 这里也放一条：今天非空，它自己就没了。
    if (Object.keys(ALIGNED).length === 0) {
      it('今天 ALIGNED 一格都没签 —— 下面那批逐格用例一条都不会生成', () => {
        expect(ALIGNED).not.toEqual({})
      })
    }
    for (const name of SCENE_TRACE_NAMES) {
      for (const group of Object.keys(ALIGNED)) {
        if (!ALIGNED[group]!.includes(name)) continue
        it(`${name} · ${group}：逐 tick 与真值相等`, () => {
          const trace = traceOf(name)
          expect(trace.tickCount).toBeGreaterThan(0)
          const snaps = snapshotsOf(name)
          for (const [i, tick] of trace.ticks.entries()) {
            // 带上 t：比对失败时要一眼看得出是第几个 tick 开始偏的。
            expect({ t: tick.t, [group]: snaps[i]![group] }).toEqual({
              t: tick.t,
              [group]: stripDead(group, columnsOf(tick)[group]),
            })
          }
        })
      }
    }
  })

  describe('「前半截已经对上了」的格子：卡住的那一 tick 就是登记里写的那一下', () => {
    // ⚠️ `BLOCKED_AT` 空着的时候这个 describe 一条用例都不生成，而
    // **「一条都没生成」与「都过了」在测试报告里长得一样**（vitest 会为空 suite
    // 报错，那是它替我们兜的底，别指望它一直兜）。所以放一条明写当前读数的
    // 用例在这里：今天是空的，非空时它自己就没了。
    if (Object.keys(BLOCKED_AT).length === 0) {
      it('今天没有「只对到半截」的格子 —— 这是读数，不是这张表的形状', () => {
        expect(BLOCKED_AT).toEqual({})
      })
    }
    for (const [group, byTrace] of Object.entries(BLOCKED_AT)) {
      for (const [name, blocked] of Object.entries(byTrace)) {
        it(`${name} · ${group}：一路对到「${blocked.scene} 里 ${blocked.event} ${blocked.key}」那一 tick`, () => {
          // 先核这一格确实还挂在 PENDING 上 —— 两张表说的必须是同一件事。
          expect(
            PENDING[group]?.[name],
            `BLOCKED_AT 里有 ${group} × ${name}，PENDING 里却没有`,
          ).toBeTruthy()

          // 卡住的那一 tick **从真值里认**，不写 tick 号：tick 号会随剧本
          // 改动整体平移。
          const trace = traceOf(name)
          const want = trace.ticks.findIndex(
            (tick) =>
              tick.scene === blocked.scene &&
              tick.input.some((e) => e.e === blocked.event && e.k === blocked.key),
          )
          // ⚠️ 两件事分开断言：`findIndex` 的 -1（找不到）与命中第 0 个 tick
          // 是两回事，并成一档 `toBeGreaterThan(0)` 的话，报错文案只说得出
          // 其中一件。
          expect(
            want,
            `${name} 里找不到「${blocked.scene} 里 ${blocked.event} ${blocked.key}」这一 tick ——` +
              ` 剧本改了，这条登记要跟着改`,
          ).not.toBe(-1)
          expect(
            want,
            `${name} 卡在第 0 个 tick —— 那等于前半截一格都没对上，这条登记就没有意义了`,
          ).toBeGreaterThan(0)

          // 正题：第一处分歧**恰好**是那一 tick。早一 tick → 这一票自己做错了；
          // 晚一 tick 或没有 → 已经全对上了，该挪进 ALIGNED。
          expect(firstDivergence(name, group), `${blocked.why}`).toBe(want)
        })
      }
    }
  })

  describe('反方向：登记成「还欠着」的格子必须真的还没对上', () => {
    // 同上：`PENDING` 空着时这个 describe 也是零用例。
    if (Object.keys(PENDING).length === 0) {
      it('今天没有「还欠着」的格子 —— 这是读数，不是这张表的形状', () => {
        expect(PENDING).toEqual({})
      })
    }
    for (const [group, byTrace] of Object.entries(PENDING)) {
      for (const [name, issue] of Object.entries(byTrace)) {
        it(`${name} · ${group}（${issue}）还没对上`, () => {
          expect(
            cellMatches(name, group),
            `${name} 的 ${group} 已经逐 tick 对上了，把它从 PENDING 挪进 ALIGNED —— ` +
              `留在 PENDING 里的话，"做完了"与"没人对"长得一样`,
          ).toBe(false)
        })
      }
    }
  })

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
   * 旁白的覆盖：**分母从真值里数**，不写死"有一份剧本播了 6 句"。
   *
   * 没有这一条，上面那个逐 tick 用例在"所有剧本都没有旁白"时也是绿的 —— 一个
   * 恒为 `{active:false, over:true}` 的实现能通过它，而那正是 xl-9bd.11 之前
   * 的状态。
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
        // 换了场景，两份 NPC 名单就没有可比性了（条数都不同）——逐下标比会
        // 读到 undefined。跨场景的那一 tick 跳过，其余照数。
        if (tick.scene !== prev.scene) {
          prev = tick
          continue
        }
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

  /**
   * 出口切换的覆盖（xl-9bd.12）。**分母从真值里数**，不写死"有一份剧本切了
   * 三次场景"——并行的票随时会加剧本。
   *
   * 没有这一条，上面那个逐 tick 用例在"所有剧本都待在同一个场景里"时也是绿的：
   * 一个把出口整个删掉的实现能通过它，而那正是这张票之前的状态。
   */
  it('真值里确实有人走出过门：场景、入口坐标、isScript 与背景音乐都跟着变了', () => {
    let switches = 0
    let bgmChanges = 0
    let bgmFollowedScene = 0
    let teleports = 0
    const isScriptSeen = new Set<boolean>()
    for (const name of replayable) {
      const trace = readTrace(name)
      let prev = trace.ticks[0]!
      for (const tick of trace.ticks) {
        if (tick.scene !== prev.scene) {
          switches++
          // 换场景必然把主角挪到入口格上——原地换场景说明入口坐标没生效。
          if (tick.role.x !== prev.role.x || tick.role.y !== prev.role.y) teleports++
          if (tick.audio.bgm !== prev.audio.bgm) bgmChanges++
          // 判据是"换过去之后声明的就是新场景 Music 段里写的那首"，**不是
          // "每换一次场景音乐就换一首"**：原版的数据里 脚本1 与 脚本2 写的
          // 是同一首（欢乐的宿舍.mp3），milestone 那条剧本就走过这么一次
          // 换了场景不换曲的门。按"必换"断言会把原版的行为判成 bug。
          if (tick.audio.bgm === getScene(tick.scene.replace(/\.txt$/, '')).sceneMusic) bgmFollowedScene++
          isScriptSeen.add(tick.isScript)
        }
        prev = tick
      }
    }
    expect(switches).toBeGreaterThan(0)
    expect(teleports).toBe(switches)
    expect(bgmFollowedScene).toBe(switches)
    // 而"曲子换过"至少要发生过一次，否则上面那条在一个从不换曲的实现下也是绿的。
    expect(bgmChanges).toBeGreaterThan(0)
    // 出口的两条分支：进普通场景置假、走回剧情脚本置真。两条都要被走到过，
    // 否则只实现其中一条也是绿的。
    expect([...isScriptSeen].sort()).toEqual([false, true])
  })

  it('主角至少有一次是被 NPC 挡住的，不只是被墙挡住', () => {
    let blockedByNpc = 0
    for (const name of replayable) {
      const trace = readTrace(name)
      let prev = trace.ticks[0]!
      for (const tick of trace.ticks) {
        const r = tick.role
        if (tick.scene !== prev.scene) {
          prev = tick
          continue
        }
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
