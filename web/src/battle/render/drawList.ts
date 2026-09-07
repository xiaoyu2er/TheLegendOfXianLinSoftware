import type { AssetId } from '../../assets/ids'
import { fileFrame, restartFrame, trailingFrame } from './frames'
import type { PaintState } from './paint'
import { BAR_HEIGHT } from './paint'
import { enemyShowsSelected } from './hitBox'
import {
  ANGRY_BACK_ID,
  CLOUD_ID,
  GAME_OVER_LEFT_ID,
  GAME_OVER_RIGHT_ID,
  HP_BAR_ID,
  MP_BAR_ID,
  PROGRESS_BAR_ID,
  angryId,
  backgroundAnimId,
  backgroundId,
  beAttackedId,
  commandButtonId,
  deadId,
  enemyHeadId,
  enemySelectedId,
  enemyWalkId,
  heroHeadId,
  heroName,
  heroPanelId,
  heroWalkId,
  hurtDigitId,
  instructId,
  mouseId,
  skillAnimId,
  victoryId,
} from './assets'
import type { CommandButtonKey } from './assets'
import type { BattleWorld, Enemy, Hero } from '../types'

/**
 * **原版 `BattlePanel.paint()` 那 25 层，摊成一份有序的绘制清单**（xl-rh9.9）。
 *
 * 这一层是纯函数：世界 + 那点只有画面看得见的状态（`PaintState`）→ 一串
 * 「把哪张图贴在哪」。它**不碰 Pixi、不碰 DOM**，所以顺序、坐标、贴哪一张图
 * 全都能在 `pnpm test` 里逐条断言，而不必开浏览器。真正的像素由跨端逐帧比对
 * 兜底（`docs/frame-compare.md`）。
 *
 * ## 顺序就是 z 序，而顺序是从原版源码里解出来的
 *
 * `BATTLE_LAYERS` 那 25 个名字不是手抄的清单 —— `drawList.test.ts` 打开
 * `src/battle/BattlePanel.java`（GBK）把 `paint()` 里的 25 个 `drawXxx` 调用
 * **按出现顺序解出来**，逐个与这里对。手抄一份清单，抄错一层的表现是"某个
 * 精灵被别的盖住了"，画面看起来完全正常。
 *
 * ## 还没实现的层：抛，不静默
 *
 * 25 层里有 5 层今天画不出来（药品菜单 / 技能菜单 / 提示图 / 战斗状态图标 /
 * 胜利结算），因为它们要么归别的票、要么状态层根本没有那几个字段（提示图
 * 只记了"画没画"、状态图标只记了"生没生效"，都画不出是哪一张、在哪儿）。
 * 小精灵是第六种情况：世界里**根本没有那个字段**，结构性缺席。
 * 这些层的处置**不是"什么都不画"** —— 那样"没实现"和"这一帧本来就没有它"
 * 长得一模一样。处置是：那一层**真的要画**的时候当场抛，并点名归哪张票。
 * 四份战斗真值今天一次都触发不到它们（判据见 `drawList.test.ts` 的
 * 「这一场碰不到的层」那几条）。
 */

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type DrawOp =
  /** `g.drawImage(img, x, y, panel)` —— 按原尺寸贴。 */
  | { readonly kind: 'image'; readonly layer: LayerName; readonly id: AssetId; readonly x: number; readonly y: number }
  /** `g.drawImage(img, dx1,dy1,dx2,dy2, sx1,sy1,sx2,sy2, panel)` —— 目标矩形 + 源矩形。 */
  | { readonly kind: 'rect'; readonly layer: LayerName; readonly id: AssetId; readonly dest: Rect; readonly src: Rect }
  /** `g.drawString(s, x, y)` —— **x/y 是基线**，不是行盒左上角。 */
  | { readonly kind: 'text'; readonly layer: LayerName; readonly text: string; readonly x: number; readonly y: number }

/**
 * 25 层的名字与次序，逐个对应 `BattlePanel.paint()` 里的一次 `drawXxx` 调用。
 * 判据在 `drawList.test.ts`：它从原版源码里把那 25 个调用解出来再对。
 */
export const BATTLE_LAYERS = [
  'background',
  'background-anim',
  'state-blank',
  'angry-bar',
  'command',
  'drug-menu',
  'hero',
  'dead-anim',
  'victory-anim',
  'enemy',
  'pet',
  'progress-bar',
  'skill-menu',
  'enemy-be-attacked',
  'hero-be-attacked',
  'skill-anim',
  'hero-state',
  'enemy-state',
  'hurt-value',
  'instruct',
  'reminder',
  'victory-reminder',
  'mouse',
  'game-over',
  'start-anim',
] as const

export type LayerName = (typeof BATTLE_LAYERS)[number]

// ===== `StateBlank` 与 `AngryBar` 构造函数里那几个写死的坐标 =====
/** 状态栏背板左上角，三格间距 322。 */
const PANEL_Y = 510
const PANEL_STRIDE = 322
const HP_X = 90
const HP_Y = 580
const MP_X = 90
const MP_Y = 600
/** 怒气槽底图的左上角（`backX=170+322k`，`backY=510-96/2+20`）。 */
const ANGRY_X = 170
const ANGRY_Y = PANEL_Y - 96 / 2 + 20
/** 怒气槽里那张图的宽，以及"满"对应的高。 */
const ANGRY_W = 80
const ANGRY_H = 80
/** 行动条的纵坐标（`new ProgressBar(300, 50, this)`）。 */
const BAR_Y = 50
/** 三个人在状态栏 / 怒气槽里的格位。原版按 `roleCode` 分的 switch。 */
const SLOT: Readonly<Record<1 | 2 | 3, number>> = { 1: 0, 2: 1, 3: 2 }
/** 画布尺寸，与全灭图那两个源矩形里写死的 640 / 1024 / 512 一致。 */
const STAGE_W = 1024
const STAGE_H = 640
/** `GameOver` 构造函数里的 `rsx2=512` —— 右半幅的源矩形右边界。 */
const GAME_OVER_HALF = 512

/**
 * 画这一帧。**只读**世界与 `PaintState`，一个字段都不写回去。
 */
export function battleDrawList(w: BattleWorld, p: PaintState): DrawOp[] {
  const ops: DrawOp[] = []
  const push = (op: DrawOp) => ops.push(op)

  // 1 背景图
  push({ kind: 'image', layer: 'background', id: backgroundId(w.background), x: 0, y: 0 })

  // 2 背景动画
  backgroundAnimOps(w, push)
  // 3 状态栏
  stateBlankOps(w, p, push)
  // 4 怒气槽：**读的是出战名单，不是 `bp.heroes`**。`angryBars` 在 `initial()`
  //   里按出战名单建好之后就再没动过，而 `bp.heroes` 在打输出口的末尾被清空
  //   （`GameOver.update()` 那句 `heroes.clear()`）。拿 heroes 画的话，全灭
  //   之后底下三个怒气槽会整排消失，而原版还画着。
  for (const h of w.party) angryBarOps(w, p, h, push)
  // 5 控制台
  commandOps(w, p, push)
  // 6 药品菜单
  if (w.drugMenuDrawn) unimplemented('drug-menu', '药品菜单（点「物」才打开）', 'xl-rh9.9')

  // 7 我方走图 / 8 死亡动画 / 9 胜利动画 —— 原版是**三个独立的循环**，
  //   不是一个循环里画三样：所有人的走图先画完，才轮到所有人的死亡动画。
  for (const h of w.heroes) heroOps(h, push)
  for (const h of w.heroes) deadAnimOps(h, push)
  for (const h of w.heroes) victoryAnimOps(h, push)

  // 10 怪物走图（顺序是 `bp.enemies`：em2 → em1 → em3，原版靠它解决遮掩）
  for (const e of w.enemies) enemyOps(w, e, push)
  // 11 小精灵
  // `BattleWorld` 里根本没有这个字段 —— 原版 `initial()` 把 `pet` 置 null，
  // 只有陆雪琪的秘术召得出来，而秘术归 xl-rh9.9 的后续（四份真值一次都没召过）。
  // 没有字段可读就没有"画错"的可能，所以这一层今天是结构性缺席，不是静默跳过。

  // 12 行动条
  progressBarOps(w, push)
  // 13 技能菜单
  if (w.skillMenuDrawn) unimplemented('skill-menu', '技能菜单（点「技」才打开）', 'xl-rh9.9')

  // 14 / 15 被击动画：怪物先、我方后
  for (const e of w.enemies) beAttackedOps(w, e, push)
  for (const h of w.heroes) heroBeAttackedOps(h, push)
  // 16 技能动画
  skillAnimOps(w, push)

  // 17 / 18 战斗状态图标
  for (const h of w.heroes) stateIconGuard(h.battleState.isUsable, 'hero-state', '我方')
  for (const e of w.enemies) stateIconGuard(e.battleState.isUsable, 'enemy-state', '怪物')

  // 19 伤害数字
  for (const hv of w.hurtValues) hurtValueOps(hv, push)
  // 20 指示图
  instructOps(w, push)
  // 21 提示图
  if (w.reminder.isDraw) {
    // 提示只由「怒气不够却点了防」与技能那几路打出来（`Reminder.show(21)`），
    // 而 `show()` 传的那个下标不在真值里 —— 状态层记的只有 `ui.reminder`
    // 这个布尔。画不出是哪一张，所以这里抛。
    unimplemented('reminder', '提示图（真值只记了它画没画，没记是第几张）', 'xl-rh9.9')
  }
  // 22 胜利结算
  if (w.victoryDrawn) {
    unimplemented('victory-reminder', '胜利结算（经验 / 物品 / 钱 / 升级 / 回地图）', 'xl-rh9.5')
  }
  // 23 游标
  mouseOps(w, p, push)
  // 24 全灭图
  gameOverOps(w, push)
  // 25 开场云雾
  startAnimOps(w, push)

  return ops
}

function unimplemented(layer: LayerName, what: string, issue: string): never {
  throw new Error(
    `第 ${BATTLE_LAYERS.indexOf(layer) + 1} 层「${layer}」这一帧要画${what}，` +
      `而 web 侧还没有它 —— 归 ${issue}。` +
      `这里抛而不是"什么都不画"：不画的话，「没实现」与「这一帧本来就没有它」` +
      `在逐帧比对里长得一模一样。`,
  )
}

function stateIconGuard(isUsable: boolean, layer: LayerName, who: string): void {
  if (!isUsable) return
  unimplemented(
    layer,
    `${who}身上的战斗状态图标（真值没记它的坐标，状态也只由技能挂得上）`,
    'xl-rh9.9',
  )
}

// ===== 各层 =====

function backgroundAnimOps(w: BattleWorld, push: (op: DrawOp) => void): void {
  const b = w.backgroundAnimation
  if (!b.isDraw || b.name === null) return
  const frame = fileFrame(b.code, b.length)
  // `code` 为 0 时原版的 `currentImage` 是 null（`set()` 不预读第一帧，
  // 与技能动画那边不同），`drawImage(null,…)` 什么都不画。
  if (frame === null) return
  push({ kind: 'image', layer: 'background-anim', id: backgroundAnimId(b.name, frame), x: 0, y: 0 })
}

/**
 * 底部状态栏：三张背板 + 每人一条血、一条灵力 + 三行字。
 *
 * 背板**按格位画**（`x+322*k`），k 由 `roleCode` 定 —— 缺席的人那一格原版是
 * `drawImage(null,…)`，也就是整格空着，而不是后面的人往前挪。
 */
function stateBlankOps(w: BattleWorld, p: PaintState, push: (op: DrawOp) => void): void {
  // 同怒气槽：`StateBlank` 读的是 `bp.zxf/yj/lxq`，那三个引用在整场战斗里
  // 都不变，与 `bp.heroes` 的清空无关。
  for (const h of w.party) {
    const k = SLOT[h.roleCode]
    push({ kind: 'image', layer: 'state-blank', id: heroPanelId(h.spec.key), x: PANEL_STRIDE * k, y: PANEL_Y })
  }
  for (const h of w.party) {
    const k = SLOT[h.roleCode]
    const bar = p.bars.get(h.spec.key)
    if (!bar) throw new Error(`${h.spec.key} 不在这份 PaintState 里`)
    bandOp(push, HP_BAR_ID, HP_X + PANEL_STRIDE * k, HP_Y, bar.hp)
    bandOp(push, MP_BAR_ID, MP_X + PANEL_STRIDE * k, MP_Y, bar.mp)
    // 三行字：等级、血、灵力。坐标是**基线**。
    push({ kind: 'text', layer: 'state-blank', text: `当前等级 :${h.level}`, x: HP_X + PANEL_STRIDE * k, y: HP_Y - 20 })
    push({ kind: 'text', layer: 'state-blank', text: `${h.hp}/${h.hpMax}`, x: HP_X + 150 + PANEL_STRIDE * k, y: HP_Y + 10 })
    push({ kind: 'text', layer: 'state-blank', text: `${h.mp}/${h.mpMax}`, x: MP_X + 150 + PANEL_STRIDE * k, y: MP_Y + 10 })
  }
}

/** 一条血 / 灵力：从图的左上角裁 `width×8` 贴过去，1:1。宽度为 0 就整条不画。 */
function bandOp(push: (op: DrawOp) => void, id: AssetId, x: number, y: number, width: number): void {
  if (width <= 0) return
  push({
    kind: 'rect',
    layer: 'state-blank',
    id,
    dest: { x, y, width, height: BAR_HEIGHT },
    src: { x: 0, y: 0, width, height: BAR_HEIGHT },
  })
}

/**
 * 怒气槽：一张底图，加上里面那条按怒气值现算高度的芯。
 *
 * 高度是 `(angryValue/hpMax)*100` 向零截尾（**分母是 100 不是 80**，而图只有
 * 80 高 —— 原版就是这么写的，怒气满时源矩形会伸到图外面去。照抄，见
 * `battleRenderer` 里对越界源矩形的裁法）。
 */
function angryBarOps(w: BattleWorld, p: PaintState, h: Hero, push: (op: DrawOp) => void): void {
  void w
  const k = SLOT[h.roleCode]
  const backX = ANGRY_X + PANEL_STRIDE * k
  const backY = ANGRY_Y
  push({ kind: 'image', layer: 'angry-bar', id: ANGRY_BACK_ID, x: backX, y: backY })
  const a = p.angry.get(h.spec.key)
  if (!a) throw new Error(`${h.spec.key} 不在这份 PaintState 的怒气槽里`)
  const height = Math.trunc((h.angryValue / h.hpMax) * 100)
  if (height <= 0) return
  push({
    kind: 'rect',
    layer: 'angry-bar',
    id: angryId(a.frame),
    dest: { x: backX + 8, y: backY + 8 + ANGRY_H - height, width: ANGRY_W, height },
    src: { x: 0, y: ANGRY_H - height, width: ANGRY_W, height },
  })
}

const COMMAND_ORDER: readonly CommandButtonKey[] = ['attack', 'skill', 'defend', 'thing']

function commandOps(w: BattleWorld, p: PaintState, push: (op: DrawOp) => void): void {
  if (!w.command.isDraw) return
  // 顺序是 `Command` 构造函数往 `gameButtons` 里加的顺序：击 → 技 → 防 → 物。
  for (const key of COMMAND_ORDER) {
    const b = w.command[key]
    push({ kind: 'image', layer: 'command', id: commandButtonId(key, p.buttons[key]), x: b.x, y: b.y })
  }
}

function heroOps(h: Hero, push: (op: DrawOp) => void): void {
  if (!h.isDraw) return
  push({
    kind: 'image',
    layer: 'hero',
    id: heroWalkId(h.roleCode, trailingFrame(h.code, h.spec.frames)),
    x: h.x,
    y: h.y,
  })
}

/** 死亡动画的落点是每个人各自写死的（`new DeadAnimation(650, 260, …)`）。 */
const DEAD_POS: Readonly<Record<1 | 2 | 3, { x: number; y: number }>> = {
  1: { x: 650, y: 260 },
  2: { x: 400, y: -70 },
  3: { x: 720, y: 360 },
}
/** 胜利动画同上（`new VictoryAnimation(550, 160, …)`）。 */
const VICTORY_POS: Readonly<Record<1 | 2 | 3, { x: number; y: number }>> = {
  1: { x: 550, y: 160 },
  2: { x: 120, y: -80 },
  3: { x: 120, y: 135 },
}

function deadAnimOps(h: Hero, push: (op: DrawOp) => void): void {
  const a = h.deadAnimation
  if (!a.isDraw) return
  const pos = DEAD_POS[h.roleCode]
  push({
    kind: 'image',
    layer: 'dead-anim',
    id: deadId(h.spec.key, restartFrame(a.code, a.length)),
    x: pos.x,
    y: pos.y,
  })
}

function victoryAnimOps(h: Hero, push: (op: DrawOp) => void): void {
  const a = h.victoryAnimation
  if (!a.isDraw) return
  const pos = VICTORY_POS[h.roleCode]
  push({
    kind: 'image',
    layer: 'victory-anim',
    id: victoryId(h.spec.key, restartFrame(a.code, a.length)),
    x: pos.x,
    y: pos.y,
  })
}

function enemyOps(w: BattleWorld, e: Enemy, push: (op: DrawOp) => void): void {
  if (!e.isDraw) return
  const id = enemyShowsSelected(w, e)
    ? enemySelectedId(e.name)
    : enemyWalkId(e.name, trailingFrame(e.code, e.spec.length))
  push({ kind: 'image', layer: 'enemy', id, x: e.x, y: e.y })
}

/**
 * 行动条：一条底图 + 七颗小头像，每颗的横坐标就是它跑到哪了。
 *
 * **顺序照抄 `drawProgressBar`**：底图 → 张 → 文 → 陆 → 小精灵 → 怪 1/2/3。
 * 判的是 `bp.zxf!=null` 之类，也就是**出战了就画**，死了照样画（死掉的人
 * 行动条不再涨，但头像还在）。
 */
function progressBarOps(w: BattleWorld, push: (op: DrawOp) => void): void {
  const p = w.progressBar
  if (!p.isDraw) return
  push({ kind: 'image', layer: 'progress-bar', id: PROGRESS_BAR_ID, x: p.barX, y: BAR_Y })
  const head = (h: Hero | null, x: number) => {
    if (!h) return
    push({ kind: 'image', layer: 'progress-bar', id: heroHeadId(h.roleCode), x, y: BAR_Y })
  }
  head(w.zxf, p.zhangX)
  head(w.yj, p.yuX)
  head(w.lxq, p.luX)
  // 小精灵那一颗：`if(bp.pet!=null)`，而 `pet` 恒为 null（见上面第 11 层）。
  const enemyHead = (e: Enemy | null, x: number) => {
    if (!e) return
    push({ kind: 'image', layer: 'progress-bar', id: enemyHeadId(e.name), x, y: BAR_Y })
  }
  enemyHead(w.em1, p.enemy1X)
  enemyHead(w.em2, p.enemy2X)
  enemyHead(w.em3, p.enemy3X)
}

function beAttackedOps(w: BattleWorld, e: Enemy, push: (op: DrawOp) => void): void {
  void w
  const a = e.beAttackedAnimation
  if (!a.isDraw) return
  push({
    kind: 'image',
    layer: 'enemy-be-attacked',
    id: beAttackedId(e.name, restartFrame(a.code, a.length)),
    x: e.x + e.spec.beAttackedOffsetX,
    y: e.y + e.spec.beAttackedOffsetY,
  })
}

/** 我方的被击动画画在 `showX/showY` 上 —— 与伤害数字同一个落点。 */
function heroBeAttackedOps(h: Hero, push: (op: DrawOp) => void): void {
  const a = h.beAttackedAnimation
  if (!a.isDraw) return
  push({
    kind: 'image',
    layer: 'hero-be-attacked',
    id: beAttackedId(heroName(h.spec.key), restartFrame(a.code, a.length)),
    x: h.showX,
    y: h.showY,
  })
}

/**
 * 技能动画。**这一层有一个 `code` 反推不出来的特例**：`set()` 会在 `code`
 * 还是 0 的时候把图预读成第 1 帧（`readImage(name+"/1.png")`），而
 * `set()` 与 `isDraw=true` 是同一句话里发生的。所以 `isDraw` 为真而
 * `code` 为 0 那一拍画的是第 1 帧，不是"没有图"。
 *
 * 这一拍在 `battle-min` 里真的被采样到了：t=300 的真值是
 * `skillDrawn: true, skillFrame: 0`。
 */
function skillAnimOps(w: BattleWorld, push: (op: DrawOp) => void): void {
  const a = w.skillAnimation
  if (!a.isDraw || !a.named) return
  const frame = fileFrame(a.code, a.length) ?? 1
  push({ kind: 'image', layer: 'skill-anim', id: skillAnimId(a.name, frame), x: a.x, y: a.y })
}

/**
 * 伤害数字：几位数就贴几张图，横向每位挪 16 px。
 *
 * 前导零**不画**，个位无论如何都画（`getCurrentImages` 里那个 `firstNum`
 * 信号）。所以 0 点伤害画的是一张 `0`，不是四张。
 */
function hurtValueOps(hv: BattleWorld['hurtValues'][number], push: (op: DrawOp) => void): void {
  if (!hv.isDraw) return
  for (const [i, digit] of hurtDigits(hv.hurt).entries()) {
    push({
      kind: 'image',
      layer: 'hurt-value',
      id: hurtDigitId(hv.type, digit),
      x: hv.x + 16 * i,
      y: hv.y,
    })
  }
}

/**
 * `HurtValue.calcalate()` + `getCurrentImages()`：千百十个四位，去掉前导零。
 *
 * 四位是上限 —— 原版 `thousand=(int)(hurt/1000)`，五位数会把万位一起塞进
 * 千位那一张（画出个位数 > 9 的下标，`images.get` 越界抛）。今天的伤害到不了
 * 四位数以上（我方最高 strength*10 加零头），到得了就说明有人改了伤害公式，
 * 那件事必须响 —— 所以这里也抛，而不是悄悄截断。
 */
export function hurtDigits(hurt: number): number[] {
  if (!Number.isInteger(hurt) || hurt < 0) {
    throw new Error(`伤害数字要是非负整数，实际 ${hurt}`)
  }
  if (hurt > 9999) {
    throw new Error(
      `伤害 ${hurt} 是五位数，而原版只算到千位（thousand=hurt/1000 会得到 >9 的下标，` +
        `Images.get 当场越界）。伤害公式被改过了。`,
    )
  }
  const thousand = Math.trunc(hurt / 1000)
  const hundred = Math.trunc((hurt % 1000) / 100)
  const ten = Math.trunc((hurt % 100) / 10)
  const unit = hurt % 10
  const out: number[] = []
  let first = false
  if (thousand !== 0) {
    first = true
    out.push(thousand)
  }
  if (first || hundred !== 0) {
    first = true
    out.push(hundred)
  }
  if (first || ten !== 0) out.push(ten)
  out.push(unit)
  return out
}

function instructOps(w: BattleWorld, push: (op: DrawOp) => void): void {
  const i = w.instruct
  if (!i.isDraw) return
  push({ kind: 'image', layer: 'instruct', id: instructId(trailingFrame(i.code, 5)), x: i.x, y: i.y })
}

function mouseOps(w: BattleWorld, p: PaintState, push: (op: DrawOp) => void): void {
  // 原版的游标图在第一次 `update()` 之前是 null，什么都不画。
  if (p.mouse.frame === null) return
  push({ kind: 'image', layer: 'mouse', id: mouseId(p.mouse.frame), x: w.currentX, y: w.currentY })
}

/**
 * 全灭图：两张半幅从左右**对开**（`GameOver.drawGameOver`）。
 *
 * 十六个坐标里只有四个会动，状态层记的就是那四个（xl-rh9.8 的 `GameOverAnim`）；
 * 另外十二个是构造函数里写死的常量，抄在下面。两边都是 1:1（目标与源同时
 * 每拍加/减 8），所以拉伸不会出现。
 */
function gameOverOps(w: BattleWorld, push: (op: DrawOp) => void): void {
  const g = w.gameOver
  if (!g.isDraw) return
  // 左：目标 (0,0)-(ldx2,640)，源 (0,0)-(lsx2,640)。
  push({
    kind: 'rect',
    layer: 'game-over',
    id: GAME_OVER_LEFT_ID,
    dest: { x: 0, y: 0, width: g.ldx2, height: STAGE_H },
    src: { x: 0, y: 0, width: g.lsx2, height: STAGE_H },
  })
  // 右：目标 (rdx1,0)-(1024,640)，源 (rsx1,0)-(512,640)。
  push({
    kind: 'rect',
    layer: 'game-over',
    id: GAME_OVER_RIGHT_ID,
    dest: { x: g.rdx1, y: 0, width: STAGE_W - g.rdx1, height: STAGE_H },
    src: { x: g.rsx1, y: 0, width: GAME_OVER_HALF - g.rsx1, height: STAGE_H },
  })
}

/** 开场云雾：同一张图**对开**，左半幅每拍 +30、右半幅每拍 −30。 */
function startAnimOps(w: BattleWorld, push: (op: DrawOp) => void): void {
  const s = w.startAnimation
  if (!s.isDraw) return
  push({ kind: 'image', layer: 'start-anim', id: CLOUD_ID, x: s.leftX, y: 0 })
  push({ kind: 'image', layer: 'start-anim', id: CLOUD_ID, x: s.rightX, y: 0 })
}
