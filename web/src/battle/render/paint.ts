import type { BattleInput } from '../step'
import type { BattleWorld, GameButton, Hero } from '../types'
import type { PartyKey } from '../units'
import type { CommandButtonKey } from './assets'
import { hitsButton } from './hitBox'

/**
 * **只有画面看得见、状态层不记的那点东西**（xl-rh9.9）。
 *
 * 原版 `BattlePanel.run()` 的循环体里有三个 `update()`，改的字段一个都没有进
 * 行为真值 —— 导出器的 `snapshotState` 没取它们，所以状态层（xl-rh9.7）
 * 明写「归渲染那张票」：
 *
 * - `StateBlank.update()` —— 血条 / 灵力条的**像素宽度**，每拍朝目标走 1 px；
 * - `AngryBar.update()` —— 怒气槽那四张图的轮播计数器；
 * - `Mouse.update()` —— 游标图的轮播计数器。
 *
 * 还有第四样，不在循环体里而在**鼠标事件**里：`GameButton.buttonImage`
 * （常态 / 待点 / 按下三张）。它同样只被 `paint()` 读，所以也存在这里，
 * 由 `applyPaintInput` 在每一条输入上推一次。
 *
 * 它们**不是**可以从世界现算出来的：血条宽度是个带惯性的量（掉了 300 血，
 * 条子要走 33 拍才追上），轮播计数器是个自由跑的相位。所以这里存下来，
 * 每拍推一次，顺序与原版 `run()` 一致。
 *
 * ## 为什么写在渲染这一层而不是状态层
 *
 * 两条。一是判据：这些字段在行为真值里**一个都没有**，放进状态层等于给
 * `battleTrace.test.ts` 加一批没人核的字段。二是并行：xl-rh9.8 正在改
 * `step.ts`，这一票往那里加东西必然冲突。
 *
 * ## 指针是照抄的，不是反推的
 *
 * `frames.ts` 那三条规则是**从 `code` 反推**画哪一张 —— 那是给状态层已经记了
 * `code` 的那些动画用的。这里的三样东西状态层没记，所以反过来：直接把原版那句
 * 「先指图、再动 code」照抄下来存着。反推需要一个已知的 `code`，而这里的 `code`
 * 正是要自己维护的东西 —— 反推它自己是循环论证。
 */

/** 血条 / 灵力条的满宽（原版写死的 140），高 8。 */
export const BAR_FULL_WIDTH = 140
export const BAR_HEIGHT = 8

/** 怒气槽那四张图。 */
const ANGRY_FRAMES = 4
/** 游标图八张。 */
const MOUSE_FRAMES = 8

export interface BarWidths {
  hp: number
  mp: number
}

/** 按钮贴图：1 常态、2 待点、3 按下。 */
export type ButtonVariant = 1 | 2 | 3

export interface PaintState {
  /** 三个人各自的血条 / 灵力条宽度。**只有出战的人有** —— 没出战的那一格不画。 */
  readonly bars: Map<PartyKey, BarWidths>
  /** 怒气槽：计数器与它当前指着的那张图（0 基）。 */
  readonly angry: Map<PartyKey, { code: number; frame: number }>
  /** 游标：计数器与它当前指着的那张图。`null` = 还没 update 过，原版那时是 null。 */
  mouse: { code: number; frame: number | null }
  /** 四个指令按钮各自现在贴的是哪一张（`GameButton.buttonImage`）。 */
  readonly buttons: Record<CommandButtonKey, ButtonVariant>
}

/** `(hp/hpMax)*140` 向零截尾 —— 原版是 `(int)(((double)hp/hpMax)*140)`。 */
export function barWidth(value: number, max: number): number {
  if (max <= 0) {
    // 原版这里是除以 0：`double` 得到 Infinity/NaN，`(int)` 再把它压成
    // Integer.MAX_VALUE 或 0。哪一种都不是"画一条正常的条子"，而它在今天
    // 任何一场里都到不了（hpMax 恒为体力×70 > 0）。到得了就说明有人把
    // 属性公式改了，那件事必须响。
    throw new Error(`血条的分母是 ${max} —— 原版在这里是除以 0，不是一条正常的条子`)
  }
  return Math.trunc((value / max) * BAR_FULL_WIDTH)
}

/**
 * 开局那一份（`StateBlank` 的构造函数 + `AngryBar` / `Mouse` 的构造函数）。
 *
 * 条子的初值是**按当时的血算出来的**，不是 0 —— 原版构造函数里就是满的，
 * 所以开场第一帧血条不会从零涨上去。
 */
export function createPaintState(w: BattleWorld): PaintState {
  const bars = new Map<PartyKey, BarWidths>()
  const angry = new Map<PartyKey, { code: number; frame: number }>()
  for (const h of w.heroes) {
    bars.set(h.spec.key, { hp: barWidth(h.hp, h.hpMax), mp: barWidth(h.mp, h.mpMax) })
    // `AngryBar` 的构造函数：`currentImage=images.get(0)`，code 还是 0。
    angry.set(h.spec.key, { code: 0, frame: 0 })
  }
  return {
    bars,
    angry,
    mouse: { code: 0, frame: null },
    // `GameButton` 的构造函数：`buttonImage=normalImage`。
    buttons: { attack: 1, skill: 1, defend: 1, thing: 1 },
  }
}

/**
 * 一条输入对**按钮贴图**的影响，照抄 `BattlePanel.setMouse()` 里那三个监听器。
 *
 * 三处都套着 `if(command.isDraw)` —— 控制台没画出来时鼠标怎么动都不换贴图，
 * 于是贴图会**停在上一次的样子**。这就是它必须存起来、不能从当前游标位置现算
 * 的原因：打完一轮之后游标停在怪物身上（四个按钮的框外），而原版四颗按钮里
 * 有一颗还亮着 —— 那是上一轮点「击」松手时留下的。现算会把它算成常态，
 * 而下一个我方回合控制台一画出来，那一颗就少亮了一片。
 *
 * **必须在 `stepBattle` 之前调**：原版的事件处理器跑在循环体之前，读的是
 * 这一拍**开头**的 `command.isDraw`。放到后面调，点「击」那一拍的
 * `isDraw` 已经被 `checkReleased` 置假了，三个 check 一个都不会跑。
 */
export function applyPaintInput(w: BattleWorld, p: PaintState, input: BattleInput): void {
  // 三个监听器都先判 `command.isDraw`，不画就整段跳过。
  if (!w.command.isDraw) return
  const buttons: [CommandButtonKey, GameButton][] = [
    ['attack', w.command.attack],
    ['skill', w.command.skill],
    ['defend', w.command.defend],
    ['thing', w.command.thing],
  ]
  const set = (variant: ButtonVariant, miss: ButtonVariant) => {
    for (const [key, b] of buttons) p.buttons[key] = hitsButton(b, input.x, input.y) ? variant : miss
  }
  // mouseMoved → checkMoveIn：命中换「待点」，落空换回常态。
  set(2, 1)
  // mousePressed → checkPressed：命中换「按下」。
  set(3, 1)
  // mouseReleased → checkReleased：只有点按钮那一路会松手（点怪物不会），
  // 与 `step.ts` 的 `applyInput` 配法一致。
  if (input.target.startsWith('command:')) set(2, 1)
}

/**
 * 推一拍。**在 `stepBattle` 之后调用**。
 *
 * 顺序与原版 `run()` 对得上吗：`stateBlank.update()` 与 `angryBar.update()`
 * 排在 `launchAttack.check()`（唯一改血的地方）**之后**，所以它们看到的就是
 * 这一拍改完的血 —— 与"整拍跑完再调这里"是同一个读数。`mouse.update()` 排在
 * 循环体最前面，读的是 `currentX/currentY`，而那两个由这一拍的输入在循环体
 * **之前**写好，所以放到最后调也是同一个读数。
 *
 * ⚠️ 一处已知的不等价：`GameOver.update()` 排在 `stateBlank.update()` **之后**，
 * 而打输回地图那条出口会在那里把两个人复位成半血（`ZhangXiaoFan.hp=hpMax/2`）。
 * 原版的条子要到**下一拍**才看见那个血，这里同一拍就看见了，差一拍。三条打输
 * 剧本今天在 web 侧还跑不完（归 xl-rh9.8），等它们跑得起来、真的进了逐帧比对，
 * 这一处要么被比出来、要么就得在这里拆成两段调用。**先记着，不先猜。**
 */
export function advancePaintState(w: BattleWorld, p: PaintState): void {
  updateMouse(p)
  updateBars(w, p)
  updateAngry(w, p)
}

/** `Mouse.update()`：坐标每拍抄一次，图轮播 8 张。 */
function updateMouse(p: PaintState): void {
  const m = p.mouse
  if (m.code < MOUSE_FRAMES) {
    m.frame = m.code
    m.code++
  } else if (m.code === MOUSE_FRAMES) {
    // 原版这里**只把 code 归零，不动图** —— 于是有一拍会重复画第 8 张。
    m.code = 0
  }
}

/**
 * `StateBlank.update()`：六个宽度各自朝目标走 **1 px**。
 *
 * 原版是两条独立的 `if`（大了减一、小了加一），不是 `Math.sign` —— 等值时
 * 两条都不成立，条子不动。这里照写成两条，好让它和原版逐行对得上。
 */
function updateBars(w: BattleWorld, p: PaintState): void {
  for (const h of w.heroes) {
    const bar = p.bars.get(h.spec.key)
    if (!bar) {
      // 出战名单在一场战斗里不变（`BattlePanel.initial` 建完就不动了）。
      // 对不上说明这份 PaintState 不是这场战斗的 —— 静默补一格的话，条子会
      // 从 0 涨上来，看起来只是"开场动画多了一下"。
      throw new Error(`${h.spec.key} 不在这份 PaintState 里 —— 它建自另一场战斗`)
    }
    step1(bar, 'hp', barWidth(h.hp, h.hpMax))
    step1(bar, 'mp', barWidth(h.mp, h.mpMax))
  }
}

function step1(bar: BarWidths, key: keyof BarWidths, target: number): void {
  if (bar[key] > target) bar[key]--
  if (bar[key] < target) bar[key]++
}

/**
 * `AngryBar.update()`：**只有那个人在怒气状态里，四张图才轮播**；不然停在
 * 当前这张。槽子的高度不在这里 —— 它每拍从 `angryValue` 现算，见
 * `drawList.ts` 的 `angryBarOps`。
 */
function updateAngry(w: BattleWorld, p: PaintState): void {
  for (const h of w.heroes) {
    const a = p.angry.get(h.spec.key)
    if (!a) throw new Error(`${h.spec.key} 不在这份 PaintState 的怒气槽里`)
    if (!isAngry(h)) continue
    if (a.code < ANGRY_FRAMES) {
      a.frame = a.code
      a.code++
    }
    if (a.code === ANGRY_FRAMES) {
      a.code = 0
      a.frame = 0
    }
  }
}

/** `Hero.wheatherAngry()`。 */
function isAngry(h: Hero): boolean {
  return h.isAngry
}
