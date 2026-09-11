/**
 * 宝箱与「得到物品」提示框 —— `src/scene/EquipmentEvent.java` 与它持有的那批
 * `src/scene/TreasureBox.java` 的移植（xl-yg6.10）。
 *
 * 两个原版对象放在一个模块里，因为它们本来就是一个：`EquipmentEvent` 构造
 * 那批 `TreasureBox`，而宝箱开出东西之后唯一的出口是 `EquipmentEvent.drawString`
 * 那个提示框。**答对答错的加扣金币走的也是同一个提示框**（`SelectEvent.keyPressed`
 * 里那两句 `scene.equipmentEvent.drawString(...)`），所以 question-answer /
 * question-memory 两条真值里 `treasure.presenting` 会翻真，而那两个场景一个
 * 宝箱都没有。真值按这一个对象整列记（`treasure` 那一列，见
 * `docs/trace-format.md` 的字段表）。
 *
 * ## 提示框的滑入是定时器驱动的 —— 导出器怎么推进它，量过了
 *
 * 两个 `javax.swing.Timer`：`presentImageMove`（`Clock.delay(50)`）与
 * `wordsRun`（`Clock.delay(100)`）。导出器的「冻结定时器」模式
 * （`tools.Clock.freezeTimers`）让 `Clock.delay(x)` 返回 `24h + x`，真实
 * `TimerQueue` 永不触发，再由 `SceneDriver.installTimers` 把每个 `Timer`
 * 换成 `devtools.VirtualTimer`、按 `getDelay() - 冻结基数` 反算回 50 / 100。
 *
 * **量法**：读 `tools/src/devtools/SceneDriver.java` 的 `step()` 定出一拍里的
 * 次序，再拿 `maze-treasure` / `question-answer` / `question-memory` 三份真值
 * 逐 tick 打出 `treasure` 那一列变化的那几拍，对着源码里的步长核。读数
 * （2026-09-10，这三份真值原样，未重导）：
 *
 * 1. **一拍的次序是 输入 → 定时器 → `step()` → `paint()` → 重装定时器**。
 *    `drawString` 发生在输入那一段（空格开箱 / 回车交卷），这时
 *    `VirtualTimer.start()` 把到期时刻设成 `此刻 + 50`，所以**第一格 +32
 *    落在按键之后第 5 拍**：maze-treasure 按空格在 t=742（x=-320），
 *    x=-288 在 t=747；question-answer 回车在 t=1009、x=-288 在 t=1014。
 * 2. 进场 21 格（-320 + 21×32 = 352），每 5 拍一格，t=847 到 352、同一拍
 *    停下滑动起打字机；**每 10 拍一个字**，9 个字吐到 t=937。
 * 3. 吐完那一拍（t=947）`wordsRun` 停、`presentImageMove` 重起，到期又是
 *    `此刻 + 50`，**退场头一拍是 +64**（t=952，352 → 416：三个 `if` 的第一个
 *    与第三个在同一拍都成立），此后 +32，t=1052 到 1056，t=1057 停下。
 *    `isDrawString` **此后一直是真**（原版没有一句把它落回假），提示框停在屏幕
 *    右外 1056 处；只有换场景（`initiation` 里 `new EquipmentEvent`）才让它回到
 *    假 —— question-memory 的 t=1616 就是这么落回去的。
 * 4. **换场景之后的新定时器同一拍接管**：`installTimers()` 在 `paint()` 之后、
 *    时钟前进之前跑，新 `EquipmentEvent` 的两个定时器构造时没有 `start()`，
 *    所以不存在「晚一拍到期」那种错位。
 *
 * **与位图那一层是不是同一条时间轴**：是，而且这是读代码 + 读真值两头核的，
 * 不是假设。原版侧 `sp.paint(sink)` 就在同一拍的 `fireTimers()` 与
 * `sp.step()` 之后，`drawPresentation` 只读 `x_presentImage` 与 `bufferedText`
 * 两样，两样都只由这两个定时器改；web 取图页（`replay/main.ts` 的 `seek`）
 * 同样是先 `step()` 到那一拍再 `showWorld`。所以第 t 帧画的 x 就是真值第 t 拍
 * 记的 x。
 *
 * **这一票没有碰时钟**：不改 `tools.Clock`、不改导出器、不重导真值。商店那边
 * 量出过「确定性判据只盖 trace.json 不盖位图」，而这里用不着冒那个险 —— 上面
 * 的读数说明冻结模式已经把这两个定时器逐拍推得和 web 的 `fireDue` 一模一样。
 *
 * ## 照抄的几处原版行为
 *
 * - `TreasureBox.AroundHero` **只置真、从不置回假**（`checkHero` 没有 else）：
 *   走到旁边一次，之后在哪儿按空格都能把它开了。真值记着（`boxes[].near`）。
 * - 开过的箱子不再给（`isEmpty`），但**换一次场景就全部重新装满** ——
 *   `TreasureBox` 是 `initiation` 里跟着 `EquipmentEvent` 新建的，`isEmpty`
 *   不跨场景。这是原版的行为，照抄。
 * - `keyPressed` 对**每一个**宝箱都跑一遍：同时挨着两个、都没开过，一下空格
 *   两个都开，第二个的 `drawString` 把第一个的提示框从头重来。
 * - `drawString` 在滑动定时器已经在跑时调，`start()` 是空操作、到期时刻不变
 *   （Swing 的语义，见 `state/timer.ts`）。
 */
import type { SceneScript } from '../data/types'
import { fireDue, startTimer, stopTimer } from './timer'
import type { MutableTimer } from './timer'
import type { TimerState } from './types'

/** 两个定时器的间隔，照抄那两句 `new Timer(tools.Clock.delay(x), ...)`。 */
export const PRESENT_IMAGE_MS = 50
export const PRESENT_WORDS_MS = 100

/** `drawString` 里那句 `x_presentImage = -320`：提示框从屏幕左外起滑。 */
export const PRESENT_START_X = -320
/** 滑到这里停下起打字机（`if (x_presentImage == 352)`）。 */
export const PRESENT_STOP_X = 352
/** 每一拍挪的格数（`x_presentImage += 32`，进场退场两句都是它）。 */
export const PRESENT_DX = 32
/** 退场那一支的上界（`x_presentImage <= 1024` / `>= 1024`）。 */
export const PRESENT_EXIT_LIMIT = 1024

/**
 * `TreasureBox.keyPressed` 那句 `1 + (int) (2 * Math.random())`：一次给
 * 1 或 2 个。
 */
export function treasureCount(random: () => number): number {
  return 1 + Math.trunc(2 * random())
}

/** `"得到" + treasureName + " * " + i`，逐字照抄原版的拼法（含两个半角空格）。 */
export function treasureText(name: string, count: number): string {
  return `得到${name} * ${count}`
}

/** 一个宝箱。`x`/`y` 是格子坐标，来自脚本的 `TreasureBox` 段（静态）。 */
export interface TreasureBoxState {
  readonly x: number
  readonly y: number
  /** `treasureName`：进背包的那样东西的名字。 */
  readonly name: string
  /** `isEmpty`：开过没。开过就画 `emptyBox.png`，而且不再给东西。 */
  readonly empty: boolean
  /** `AroundHero`：主角到过它四邻没。⚠️ 只置真、从不置回假。 */
  readonly near: boolean
}

/**
 * `EquipmentEvent` 的全部状态。字段名跟 trace 的 `treasure` 那一列对齐，
 * **有两处不一样**（真值只记定时器跑没跑，这里要存整个定时器）：
 *
 * | 这里 | trace |
 * |---|---|
 * | `presentImageMove.running` | `moving` |
 * | `wordsRun.running` | `printing` |
 *
 * 翻译只在 `traceReplay.test.ts` 的 `OBSERVERS.treasure` 一处。
 *
 * `text` / `bufferedText` **不在真值里**：物品名归数据层，而数量与金额是
 * `Math.random()` 现掷的（记进真值会让 `--check` 当场红）。它们在这里是因为
 * 打字机要读（`WordsRun` 比的是 `text.length()`）、绘制要画。
 */
export interface TreasureState {
  /** `isDrawString`：提示框在不在场。 */
  readonly presenting: boolean
  /** `x_presentImage`：提示框左边缘的横坐标。进场与退场共用这一个游标。 */
  readonly x: number
  /** `count_word`：那句话吐到第几个字。 */
  readonly wordNo: number
  /** `text`：那句话。`null` = 这个场景里还没弹过（原版字段的初值）。 */
  readonly text: string | null
  /** `bufferedText`：已经吐出来的那一截。`null` = 一个字都还没吐。 */
  readonly bufferedText: string | null
  readonly presentImageMove: TimerState
  readonly wordsRun: TimerState
  /**
   * 这个场景的宝箱。**`null` = 这个场景没有 `TreasureBox` 段**，不是 `[]`：
   * 原版 `treasureBoxes` 只在 `treasureBox != null` 时才建，"没有宝箱段"与
   * "有宝箱段但一个都没建出来"要分得开（真值也照记 `null`）。
   */
  readonly boxes: readonly TreasureBoxState[] | null
}

const STOPPED: TimerState = { running: false, dueMs: 0 }

/**
 * `new EquipmentEvent(scene, reader.getTreasureBox())`。每次 `initiation` 都
 * 新建，所以提示框与"开过没"都不跨场景。
 *
 * 坐标写法是 `"x/y"`（`TreasureBox` 构造函数里那两句 `split("/")` +
 * `Integer.parseInt`）。**解不出来就抛**，照抄原版的 `NumberFormatException`：
 * 给一个不命中的坐标只会让这个箱子永远开不了，而那与"这里本来就没箱子"
 * 长得一样。
 */
export function createTreasure(scene: SceneScript): TreasureState {
  const rows = scene.treasureBox
  return {
    presenting: false,
    x: 0,
    wordNo: 0,
    text: null,
    bufferedText: null,
    presentImageMove: STOPPED,
    wordsRun: STOPPED,
    boxes:
      rows === null
        ? null
        : rows.map((row, i) => {
            const [location, name] = row
            const parts = (location ?? '').split('/')
            // `Integer.parseInt` 只认 `[+-]?\d+`，`Number.parseInt` 会把 "5abc"
            // 解成 5 —— 那样就不是"照抄那条异常"了，所以先按原版的字面规则筛。
            const strict = (s: string | undefined): number =>
              s !== undefined && /^[+-]?\d+$/.test(s) ? Number.parseInt(s, 10) : Number.NaN
            const x = strict(parts[0])
            const y = strict(parts[1])
            if (parts.length !== 2 || !Number.isInteger(x) || !Number.isInteger(y) || name === undefined) {
              throw new Error(
                `${scene.script} 的第 ${i} 个宝箱写成了 ${JSON.stringify(row)}，` +
                  '原版要的是 ["x/y", 物品名]',
              )
            }
            return { x, y, name, empty: false, near: false }
          }),
  }
}

/** 逐 tick 就地改的草稿，与 `role` / `select` 那几份同一个形状。 */
export interface TreasureDraft {
  presenting: boolean
  x: number
  wordNo: number
  text: string | null
  bufferedText: string | null
  presentImageMove: MutableTimer
  wordsRun: MutableTimer
  boxes: { -readonly [K in keyof TreasureBoxState]: TreasureBoxState[K] }[] | null
}

export function toTreasureDraft(t: TreasureState): TreasureDraft {
  return {
    presenting: t.presenting,
    x: t.x,
    wordNo: t.wordNo,
    text: t.text,
    bufferedText: t.bufferedText,
    presentImageMove: { ...t.presentImageMove },
    wordsRun: { ...t.wordsRun },
    boxes: t.boxes === null ? null : t.boxes.map((b) => ({ ...b })),
  }
}

export function fromTreasureDraft(d: TreasureDraft): TreasureState {
  return {
    presenting: d.presenting,
    x: d.x,
    wordNo: d.wordNo,
    text: d.text,
    bufferedText: d.bufferedText,
    presentImageMove: { ...d.presentImageMove },
    wordsRun: { ...d.wordsRun },
    boxes: d.boxes === null ? null : d.boxes.map((b) => ({ ...b })),
  }
}

/**
 * `EquipmentEvent.drawString(s)`：弹出提示框。
 *
 * 五句照抄。**不停 `wordsRun`**：打字机正吐着的时候再弹一次，它接着按新的
 * `text` 从第 0 个字吐起（`count_word` 清零了），而滑动定时器同时从 -320
 * 重来 —— 两个一起跑，原版就是这样。`MusicReader.readmusic("Clip750.wav")`
 * 那句音效**还没做，不是故意不复刻**（所以不带 `@exception` 标记）：`SceneDriver`
 * 没接音效观察点，场景真值里没有音效列可对。连同真值归 xl-b36（xl-03x.7 只接了
 * 菜单与商店）。
 */
export function drawString(d: TreasureDraft, s: string, now: number): void {
  d.x = PRESENT_START_X
  d.bufferedText = null
  d.wordNo = 0
  d.text = s
  d.presenting = true
  startTimer(d.presentImageMove, now, PRESENT_IMAGE_MS)
}

/**
 * `EquipmentEvent.checBoxes(x, y)` → 每个 `TreasureBox.checkHero`：
 * 主角在上下左右四邻之一就置真。**没有 else**，走开了也不落回假。
 * 开过的箱子不再看（`if (!isEmpty)`）。
 */
export function checkBoxes(d: TreasureDraft, heroX: number, heroY: number): void {
  if (d.boxes === null) return
  for (const box of d.boxes) {
    if (box.empty) continue
    if (
      (box.x - 1 === heroX && box.y === heroY) ||
      (box.x + 1 === heroX && box.y === heroY) ||
      (box.x === heroX && box.y - 1 === heroY) ||
      (box.x === heroX && box.y + 1 === heroY)
    ) {
      box.near = true
    }
  }
}

/** 开箱开出来的一样东西：`DrugPack.addDrug(treasureName, i)` 的两个实参。 */
export interface TreasureGain {
  readonly name: string
  readonly count: number
}

/**
 * `EquipmentEvent.keyPressed(keyCode)` → 每个 `TreasureBox.keyPressed`。
 *
 * 返回这一下开出来的东西（按宝箱的次序），**进背包那一步交给调用方** ——
 * `DrugPack` 是原版的 static 背包，不属于场景，这一层不碰它（见
 * `World.treasureRequest`）。
 *
 * `random` 是 `Math.random()` 的替身。只在真的开箱时才读它：原版那句
 * `Math.random()` 在 `if (!isEmpty)` 里面，多读一次会让同一批里后面的掷骰
 * 全部错位。
 */
export function treasureKeyPressed(
  d: TreasureDraft,
  key: string,
  now: number,
  random: () => number,
): TreasureGain[] {
  const gains: TreasureGain[] = []
  if (d.boxes === null) return gains
  for (const box of d.boxes) {
    if (!(box.near && key === 'space')) continue
    if (box.empty) continue
    box.empty = true
    const count = treasureCount(random)
    gains.push({ name: box.name, count })
    drawString(d, treasureText(box.name, count), now)
  }
  return gains
}

/**
 * `PresentImage.actionPerformed`：提示框挪一格。三个 `if` 逐句照抄 ——
 * 第三个是独立的 `if`，**不是**第一个的 else，所以从 352 重起的那一拍两句
 * `+= 32` 都跑，退场头一拍是 +64（真值 t=952 看得见）。
 */
export function tickPresentImage(d: TreasureDraft, now: number): void {
  if (d.x <= PRESENT_STOP_X) d.x += PRESENT_DX
  if (d.x === PRESENT_STOP_X) {
    startTimer(d.wordsRun, now, PRESENT_WORDS_MS)
    stopTimer(d.presentImageMove)
  }
  if (d.x > PRESENT_STOP_X && d.x <= PRESENT_EXIT_LIMIT) d.x += PRESENT_DX
  else if (d.x >= PRESENT_EXIT_LIMIT) stopTimer(d.presentImageMove)
}

/** `WordsRun.actionPerformed`：吐一个字；吐完了就停下、让提示框接着往右滑走。 */
export function tickPresentWords(d: TreasureDraft, now: number): void {
  const text = d.text ?? ''
  if (d.wordNo < text.length) {
    d.wordNo++
    d.bufferedText = text.slice(0, d.wordNo)
  } else {
    stopTimer(d.wordsRun)
    startTimer(d.presentImageMove, now, PRESENT_IMAGE_MS)
  }
}

/**
 * 这一 tick 到期的两个定时器。
 *
 * **次序照抄导出器**：`installTimers` 按字段名排序装表，`EquipmentEvent` 的两个
 * `Timer` 字段排下来是 `presentImageMove` → `wordsRun`；这一组整体排在
 * `sp.selectEvent` 之后、`sp.sal` 与 `sp.npcs` 之前，落点在 `state/step.ts`。
 *
 * ⚠️ 组内次序**今天分辨不出来**，这是推出来的、再由篡改核过的（见
 * `treasure.test.ts` 头注里的篡改记录）：两个定时器互相 `start()` 对方时，
 * 被起的那个到期时刻是 `此刻 + 间隔`，不论它这一拍轮过没有都不会当拍触发。
 * 钉死次序照做，理由与 `select.ts` 的 `tickSelectTimers` 同一条。
 */
export function tickTreasureTimers(d: TreasureDraft, now: number): void {
  fireDue(
    d.presentImageMove,
    now,
    PRESENT_IMAGE_MS,
    () => tickPresentImage(d, now),
    '提示框的滑动定时器',
  )
  fireDue(d.wordsRun, now, PRESENT_WORDS_MS, () => tickPresentWords(d, now), '提示框的逐字定时器')
}
