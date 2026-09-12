import type { AssetId } from '../../assets/ids'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../stage/constants'
import { fileFrame, restartFrame, trailingFrame } from './frames'
import type { PaintState } from './paint'
import { BAR_HEIGHT } from './paint'
import { enemyShowsSelected } from './hitBox'
import {
  ANGRY_BACK_ID,
  CLOUD_ID,
  DRUG_MENU_BACK_ID,
  GAME_OVER_LEFT_ID,
  GAME_OVER_RIGHT_ID,
  HP_BAR_ID,
  MP_BAR_ID,
  PET_HEAD_ID,
  PET_ID,
  PROGRESS_BAR_ID,
  SKILL_MENU_BACK_ID,
  angryId,
  backgroundAnimId,
  backgroundId,
  beAttackedId,
  commandButtonId,
  deadId,
  drugButtonId,
  drugPictureId,
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
  reminderId,
  skillAnimId,
  skillButtonId,
  skillIntroId,
  skillReturnId,
  stateIconId,
  victoryId,
  VICTORY_REMINDER,
  victoryReminderFaceId,
} from './assets'
import type { CommandButtonKey } from './assets'
import { DRUGS } from '../drugs'
import type { BattleState, BattleWorld, Enemy, Hero, MenuButton, Pet } from '../types'
import type { PartyKey } from '../units'
import { SHOW_ATTR_START, SHOW_EXP_INDEX } from '../victory'

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
 * ## 25 层现在一层不缺（xl-rh9.15）
 *
 * 药品菜单 / 技能菜单 / 提示图 / 敌我两层战斗状态图标由 xl-rh9.12 补上，第 22
 * 层胜利结算由 xl-rh9.13 补上，最后一层——第 11 层小精灵——由 xl-rh9.15 补上。
 * 随之删掉的是那个 `unimplemented()`：它已经没有调用者，而 `noUnusedLocals`
 * 不留死函数。
 *
 * **再有一层画不出来时，处置照旧：抛，不是"什么都不画"。** 后者会让"没实现"
 * 与"这一帧本来就没有它"在逐帧比对里长得一模一样 —— 而那正是这套判据要分开
 * 的两件事。抛的那句话要点名归哪张票（`drawList.test.ts` 会拿票号去撞
 * `expected.ts` 里那条剧本的 `unpainted` 表态），`expected.ts` 那条同时改成
 * `unpainted`。今天两处都是空的，空得是对的：判据仍在，只是没有对象。
 */

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type DrawOp =
  /**
   * `g.drawImage(img, x, y, panel)` —— 按原尺寸贴。
   *
   * `opaque` 只有背景图那一条带：贴的时候**忽略素材的 alpha**，理由见
   * `BACKGROUND_OPAQUE` 的注释（xl-84z）。
   */
  | {
      readonly kind: 'image'
      readonly layer: LayerName
      readonly id: AssetId
      readonly x: number
      readonly y: number
      readonly opaque?: true
    }
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
/**
 * `GameOver` 构造函数里的 `rsx2=512` —— 右半幅的源矩形右边界，也就是整幅的一半。
 * 画布尺寸本身用 `stage/constants.ts` 那一份，不在这里另写一个 1024/640。
 */
const GAME_OVER_HALF = 512

/**
 * **背景图贴的时候不看 alpha**（xl-84z）。这不是这边的发明，是原版离屏缓冲的
 * 三件事叠出来的，每一件都在源码里：
 *
 * 1. `bufferedPic = new BufferedImage(W, H, TYPE_INT_ARGB)` —— **非预乘**的
 *    ARGB，起始整张全透明；
 * 2. `paint()` 头一句就是 `drawImage(background)`，而 `bufferedGraphics` 在
 *    整个原版里**只被 `drawImage` 过**：没有 `fillRect` / `clearRect`、没有
 *    `setComposite`，也就是默认的 SrcOver、**从不清屏**；
 * 3. 非预乘 SrcOver 的颜色是 `(Cs·as + Cd·ad·(1−as)) / ao`。第一帧 `ad = 0`，
 *    结果**正好是素材自己的 RGB**（alpha 另记）；此后每帧底下就是上一帧的
 *    同一种颜色，结果仍是 `Cs`。于是半透明的边在原版的 RGB 里跟不透明一样亮；
 *    alpha 只在缓冲自己的 alpha 通道里，而那个通道不上屏（导出的 PNG 带着它，
 *    比对器照例不看 alpha）。
 *
 * 这边每帧先清成黑再贴，半透明的边就成了 `Cs·as` —— 「校园小道」那三条边
 * 实测只有原版的约 0.6 倍亮（alpha 最低 99）。原图 14 张背景里只有它有
 * alpha<255 的像素，所以别的战斗真值从没撞到。
 *
 * ⚠️ 忽略 alpha 是**近似**，不是逐位复刻：原版那一句的 `Cd` 是**上一帧**留下
 * 的东西，上一帧有别的精灵盖在那条边上时，这一帧的边会按 `1−as` 透出它的残影
 * （同一块 `BattlePanel` 在 `GameLauncher.init()` 之间跨场复用，所以一场的头几帧
 * 还可能透出上一场的末帧）。这边不留上一帧，这一项就是零。battle-script3 实测
 * 这一项在容差内看不见（见 `compare/expected.ts` 那条表态）。
 */
const BACKGROUND_OPAQUE = true

/**
 * 画这一帧。**只读**世界与 `PaintState`，一个字段都不写回去。
 */
export function battleDrawList(w: BattleWorld, p: PaintState): DrawOp[] {
  const ops: DrawOp[] = []
  const push = (op: DrawOp) => ops.push(op)

  // 1 背景图
  push({
    kind: 'image',
    layer: 'background',
    id: backgroundId(w.background),
    x: 0,
    y: 0,
    opaque: BACKGROUND_OPAQUE,
  })

  // 2 背景动画
  backgroundAnimOps(w, push)
  // 3 状态栏
  stateBlankOps(w, p, push)
  // 4 怒气槽：**读的是出战名单，不是 `bp.heroes`**。`angryBars` 在 `initial()`
  //   里按出战名单建好之后就再没动过，而 `bp.heroes` 在打输出口的末尾被清空
  //   （`GameOver.update()` 那句 `heroes.clear()`）。拿 heroes 画的话，全灭
  //   之后底下三个怒气槽会整排消失，而原版还画着。
  for (const h of w.party) angryBarOps(p, h, push)
  // 5 控制台
  commandOps(w, p, push)
  // 6 药品菜单
  drugMenuOps(w, push)

  // 7 我方走图 / 8 死亡动画 / 9 胜利动画 —— 原版是**三个独立的循环**，
  //   不是一个循环里画三样：所有人的走图先画完，才轮到所有人的死亡动画。
  for (const h of w.heroes) heroOps(h, push)
  for (const h of w.heroes) deadAnimOps(h, push)
  for (const h of w.heroes) victoryAnimOps(h, push)

  // 10 怪物走图（顺序是 `bp.enemies`：em2 → em1 → em3，原版靠它解决遮掩）
  for (const e of w.enemies) enemyOps(w, e, push)
  // 11 小精灵
  petOps(w.pet, push)

  // 12 行动条
  progressBarOps(w, push)
  // 13 技能菜单
  skillMenuOps(w, push)

  // 14 / 15 被击动画：怪物先、我方后
  for (const e of w.enemies) beAttackedOps(e, push)
  for (const h of w.heroes) heroBeAttackedOps(h, push)
  // 16 技能动画
  skillAnimOps(w, push)

  // 17 / 18 战斗状态图标：**两个独立的循环**，我方全画完才轮到怪物
  for (const h of w.heroes) stateIconOps(h.battleState, 'hero-state', push)
  for (const e of w.enemies) stateIconOps(e.battleState, 'enemy-state', push)

  // 19 伤害数字
  for (const hv of w.hurtValues) hurtValueOps(hv, push)
  // 20 指示图
  instructOps(w, push)
  // 21 提示图
  reminderOps(w, push)
  // 22 胜利结算
  victoryReminderOps(w, push)
  // 23 游标
  mouseOps(w, p, push)
  // 24 全灭图
  gameOverOps(w, push)
  // 25 开场云雾
  startAnimOps(w, push)

  return ops
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
function angryBarOps(p: PaintState, h: Hero, push: (op: DrawOp) => void): void {
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

// ===== `VictoryReminder` 构造函数里那些从头到尾不变的坐标 =====
/**
 * 结算画面上**从头到尾不变**的那些坐标，逐个对应原版 `VictoryReminder` 构造
 * 函数里的一句赋值。会动的八个（`dy2`/`sy2` 与物品框那六个）在真值里，不在
 * 这里。
 *
 * 导出来是为了让判据够得着：`victoryReminder.test.ts` 把原版构造函数的方法体
 * 解开，逐个字段与这张表对撞 —— 抄错一个数的表现是"某样东西画偏了几十像素"，
 * 而那在差异图上和"字形对不上"长得一样。
 */
export const VICTORY_REMINDER_LAYOUT = {
  /** 卷轴：目标矩形的左上角与右边界，源矩形的左上角与右边界。 */
  dx1: 412,
  dy1: 80,
  dx2: 612,
  sx1: 0,
  sy1: 0,
  sx2: 200,
  /** 升级小图（`levelUpX=412+75; levelUpY=80+60;`）。 */
  levelUpX: 412 + 75,
  levelUpY: 80 + 60,
  /** 「获得物品」那张图。 */
  thingX: 660,
  thingY: 80,
  /** 第一张人物图的落点；三个人纵向每人 +100。 */
  firstX: 412,
  firstY: 160,
  /** 「获得经验」那一行字。 */
  firstStringX: 532,
  firstStringY: 80 + 120,
  /** 四行属性数字（`secondStringX=412+90; secondStringY=80+100;`）。 */
  secondStringX: 412 + 90,
  secondStringY: 80 + 100,
  /** 掉落物清单与「金钱 N」。 */
  thirdStringX: 690,
  thirdStringY: 80 + 70,
} as const

/** 每人一行的纵向间距 —— 人物图、两行经验数字、四行属性数字共用这一个 100。 */
const VR_ROW_STRIDE = 100
/** 「还差多少经验」那一行比「获得经验」低 30。 */
const VR_EXP_LINE_GAP = 30
/** 四行属性数字与掉落物清单的行距，都是 20。 */
const VR_LINE_GAP = 20

/** 三个人在结算画面上的行号。原版是六句写死的 `if(bp.zxf!=null)` 之类。 */
const VR_ROWS: readonly { readonly key: PartyKey; readonly of: (w: BattleWorld) => Hero | null }[] = [
  { key: 'zhang', of: (w) => w.zxf },
  { key: 'yu', of: (w) => w.yj },
  { key: 'lu', of: (w) => w.lxq },
]

/**
 * 第 22 层：**打赢之后的结算画面**（`VictoryReminder.drawVictoryReminder`，xl-rh9.13）。
 *
 * 状态层那一整段（卷轴拉开、发物品与钱、经验滚下去、翻页、属性一项项加上去、
 * 回地图）已经由 xl-rh9.5 做完，在 `victory.ts` 里；这里只把它**画出来**，
 * 一个字段都不写回去。九样东西的次序就是原版那九个 `if` 的书写顺序：
 * 卷轴底 → 物品框 → 第一页三张人物图 → 第二页（只画升级了的人）→
 * 两行经验数字 → 四行属性数字 → 掉落物清单与金钱 → 升级小图 → 「获得物品」图。
 *
 * **两个矩形都是 1:1，而且都从零开始长。** 卷轴 `dy2`/`sy2` 每拍同时 +20，
 * 物品框八个坐标每拍 ±4 / ±5 —— 目标与源同步，所以拉伸不会出现。它们各有
 * 一拍是**零高 / 零面积**的（`sy2=0` 与 `thing_sx1=60` 的那一拍），Java2D 的
 * `drawImage` 遇到空的源矩形什么都不画，这里照抄成"这一条不推进清单"，而不是
 * 推一个高度为 0 的矩形下去 —— 后者会在 `clip()` 里除出 NaN。
 *
 * **谁画在第几行看的是身份，不是格位。** 原版是 `bp.zxf` / `bp.yj` / `bp.lxq`
 * 三个引用各判一次，缺席的那一行整行空着，后面的人不会往上挪 —— 与底部状态栏
 * 那三格是同一个道理。
 */
function victoryReminderOps(w: BattleWorld, push: (op: DrawOp) => void): void {
  const v = w.victoryReminder
  if (!v.isDraw) return
  // 逐字段对回原版构造函数的那张表（判据在 victoryReminder.test.ts）。
  const L = VICTORY_REMINDER_LAYOUT

  // 卷轴底：目标 (412,80)-(612,dy2)，源 (0,0)-(200,sy2)。
  cornersOp(
    push,
    'victory-reminder',
    VICTORY_REMINDER.back,
    { x1: L.dx1, y1: L.dy1, x2: L.dx2, y2: v.dy2 },
    { x1: L.sx1, y1: L.sy1, x2: L.sx2, y2: v.sy2 },
  )
  // 物品框：八个坐标全在真值里，从中心对开。
  cornersOp(
    push,
    'victory-reminder',
    VICTORY_REMINDER.thingBack,
    { x1: v.thingDx1, y1: v.thingDy1, x2: v.thingDx2, y2: v.thingDy2 },
    { x1: v.thingSx1, y1: v.thingSy1, x2: v.thingSx2, y2: v.thingSy2 },
  )

  if (v.firstIsDraw) {
    for (const [row, { key, of }] of VR_ROWS.entries()) {
      if (of(w) === null) continue
      push({
        kind: 'image',
        layer: 'victory-reminder',
        id: victoryReminderFaceId(key, 1),
        x: L.firstX,
        y: L.firstY + VR_ROW_STRIDE * row,
      })
    }
  }
  if (v.secondIsDraw) {
    // 第二页**只画升级了的人**。没升级的那一行空着。
    for (const [row, { key, of }] of VR_ROWS.entries()) {
      const h = of(w)
      if (h === null || !h.isLevelUp) continue
      push({
        kind: 'image',
        layer: 'victory-reminder',
        id: victoryReminderFaceId(key, 2),
        x: L.firstX,
        y: L.firstY + VR_ROW_STRIDE * row,
      })
    }
  }

  if (v.firstString) {
    for (const [row, { key, of }] of VR_ROWS.entries()) {
      if (of(w) === null) continue
      const y = L.firstStringY + VR_ROW_STRIDE * row
      // 上面一行是**这一场发了多少经验**（三个人同一个数，每人各拿全额），
      // 下面一行是这个人**还差多少**升级。两个数都在往下滚。
      push({ kind: 'text', layer: 'victory-reminder', text: `${v.expToGet}`, x: L.firstStringX, y })
      push({
        kind: 'text',
        layer: 'victory-reminder',
        text: `${showNum(v.showNums, SHOW_EXP_INDEX[key], key)}`,
        x: L.firstStringX,
        y: y + VR_EXP_LINE_GAP,
      })
    }
  }

  if (v.secondString) {
    for (const [row, { key, of }] of VR_ROWS.entries()) {
      const h = of(w)
      if (h === null || !h.isLevelUp) continue
      const at = SHOW_ATTR_START[key]
      for (let i = 0; i < 4; i++) {
        push({
          kind: 'text',
          layer: 'victory-reminder',
          text: `${showNum(v.showNums, at + i, key)}`,
          x: L.secondStringX,
          y: L.secondStringY + i * VR_LINE_GAP + VR_ROW_STRIDE * row,
        })
      }
    }
  }

  if (v.thirdString) {
    // 掉落物清单：`things.get(i).split("/")[0]` —— 斜杠后面那位是类型（1 药
    // 2 装备），不画。顺序是 `bp.enemies` 的顺序，不是槽位顺序。
    for (const [i, thing] of v.things.entries()) {
      push({
        kind: 'text',
        layer: 'victory-reminder',
        text: thing.split('/')[0]!,
        x: L.thirdStringX,
        y: L.thirdStringY + i * VR_LINE_GAP,
      })
    }
    push({
      kind: 'text',
      layer: 'victory-reminder',
      text: `金钱 ${v.moneyToGet}`,
      x: L.thirdStringX,
      y: L.thirdStringY + v.things.length * VR_LINE_GAP,
    })
  }

  if (v.levelUpIsDraw) {
    push({
      kind: 'image',
      layer: 'victory-reminder',
      id: VICTORY_REMINDER.levelUp,
      x: L.levelUpX,
      y: L.levelUpY,
    })
  }
  if (v.getThingIsDraw) {
    push({
      kind: 'image',
      layer: 'victory-reminder',
      id: VICTORY_REMINDER.getThing,
      x: L.thingX,
      y: L.thingY,
    })
  }
}

/**
 * `showNums` 那 15 项里的一项。**缺席的角色是 `null`**（见 `victory.ts`），
 * 而这里的每一个调用点都已经判过那个人在不在场 —— 所以读到 null 说明
 * `victoryInformation` 与出战名单对不上了，抛，不画一个 `null` 出去。
 */
function showNum(showNums: readonly (number | null)[], at: number, key: PartyKey): number {
  const n = showNums[at]
  if (n === null || n === undefined) {
    throw new Error(`showNums[${at}] 是空的，可 ${key} 正在出战 —— 结算画面读到了一个不该缺的数`)
  }
  return n
}

/**
 * 一个**用对角两点给出的**矩形 —— 原版 `drawImage` 那个八参版就是这么写的。
 *
 * 不摊成八个裸 number 参数：那八个数在调用点全是 `number`，传串了一对
 * （比如把源矩形的 y 传进目标矩形）编译期一声不出，而画出来只是"这张图
 * 位置有点怪"。分成两个具名对象之后，传串要先写错字段名。
 */
interface Corners {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

/**
 * 原版 `drawImage(img, dx1,dy1,dx2,dy2, sx1,sy1,sx2,sy2, …)` 那一支：**两个
 * 矩形都按对角两点给**。空的源矩形（宽或高 ≤ 0）什么都不画，与 Java2D 一致。
 */
function cornersOp(
  push: (op: DrawOp) => void,
  layer: LayerName,
  id: AssetId,
  dest: Corners,
  src: Corners,
): void {
  if (src.x2 - src.x1 <= 0 || src.y2 - src.y1 <= 0) return
  if (dest.x2 - dest.x1 <= 0 || dest.y2 - dest.y1 <= 0) return
  push({
    kind: 'rect',
    layer,
    id,
    dest: { x: dest.x1, y: dest.y1, width: dest.x2 - dest.x1, height: dest.y2 - dest.y1 },
    src: { x: src.x1, y: src.y1, width: src.x2 - src.x1, height: src.y2 - src.y1 },
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
 * 第 11 层小精灵（`Pet.drawPet`，xl-rh9.15）。
 *
 * 原版那三行就是全部：`if(isDraw) g.drawImage(petImage, x, y, bp)` —— 一张
 * 静止的图，**没有帧号**（`loadAnimation()` 是个空方法）。会动的只有 `y`：
 * `update()` 让 y 上下浮动，状态层已经把它推出来了；**那一轮到底几拍、原版
 * 那句注释为什么是错的，只在 `battle/step.ts` 的 `updatePet` 上写一份**
 * （xl-rh9.15 的评审收的一条：同一段话抄了三份，改的时候漏了一份）。
 *
 * ⚠️ **`pet.x` / `pet.y` / `pet.isDraw` 三个字段一个都不在行为真值里** ——
 * 导出器的 `snapshotState` 从没取过 `bp.pet`（见 `types.ts` 的 `Pet`）。所以
 * 这一层的正确性不是靠逐步 `toEqual` 兜的，是靠 `battle-mishu-lu` 的跨端逐帧
 * 比对：画错了位置、画错了浮动相位、该消失时没消失，都会在硬比区里露出来。
 */
function petOps(pet: Pet | null, push: (op: DrawOp) => void): void {
  if (pet === null || !pet.isDraw) return
  push({ kind: 'image', layer: 'pet', id: PET_ID, x: pet.x, y: pet.y })
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
  // 小精灵那一颗：原版判的是 `if(bp.pet!=null)`，**不是 `pet.isDraw`** ——
  // 小精灵出手那一拍 `attack()` 把 `isDraw` 关掉（本体从场上消失、换技能动画
  // 播），而行动条上这一颗照画不误。两个判据写成同一个的表现是那一颗头像在
  // 攻击动画期间闪一下，逐帧比对之外看不出来。
  if (w.pet) push({ kind: 'image', layer: 'progress-bar', id: PET_HEAD_ID, x: p.petX, y: BAR_Y })
  const enemyHead = (e: Enemy | null, x: number) => {
    if (!e) return
    push({ kind: 'image', layer: 'progress-bar', id: enemyHeadId(e.name), x, y: BAR_Y })
  }
  enemyHead(w.em1, p.enemy1X)
  enemyHead(w.em2, p.enemy2X)
  enemyHead(w.em3, p.enemy3X)
}

function beAttackedOps(e: Enemy, push: (op: DrawOp) => void): void {
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

/**
 * 技能菜单与药品菜单共用的落点。两个构造函数里各写了一遍 `x=340; y=200;`，
 * 一字不差 —— 与 `menuLayout.ts` 里那套按钮几何是同一种"抄了两份的常量"。
 */
const MENU_BACK_X = 340
const MENU_BACK_Y = 200

/** `SkillMenu` 的 `introX=160`，`DrugMenu` 的 `introX=220`。两者不同。 */
const SKILL_INTRO_X = 160
const DRUG_INTRO_X = 220

/**
 * 药品菜单里那一列存货数字：`drawString(numberGOT+"", 575, 246+i*30)`。
 *
 * 246 与 226 差 20、步距同样是 30 —— 但原版是**另写的一对字面量**，不是从
 * 按钮坐标算的。这里照抄成自己的常量：合并成 `menuButtonY(i)+20` 读起来更
 * 短，可那等于替原版声明了一个它没声明的关系，而关系一旦被当真，改按钮位置
 * 就会连带把数字挪走。
 */
const DRUG_STOCK_X = 575
const DRUG_STOCK_TOP = 246
const DRUG_STOCK_STRIDE = 30

/** `Reminder` 构造函数里那个源矩形 `(0,0)-(128,24)`，整场不变。 */
const REMINDER_SRC: Rect = { x: 0, y: 0, width: 128, height: 24 }

/**
 * 第 6 层，药品菜单（`DrugMenu.drawDrugMenu`）。
 *
 * 顺序照抄：背板 → 七颗按钮 → 六行存货数字 → 介绍图 → 介绍文字。
 * **存货数字无条件画六行**，与按钮是两个循环 —— 原版那个 `for(int i=0;i<=5;i++)`
 * 在按钮循环之后另起一段，所以七颗按钮全画完才轮到数字。
 */
function drugMenuOps(w: BattleWorld, push: (op: DrawOp) => void): void {
  const m = w.drugMenu
  if (!m.isDraw) return
  push({ kind: 'image', layer: 'drug-menu', id: DRUG_MENU_BACK_ID, x: MENU_BACK_X, y: MENU_BACK_Y })
  for (const [i, b] of m.buttons.entries()) {
    push({ kind: 'image', layer: 'drug-menu', id: drugButtonId(i, b.variant), x: b.x, y: b.y })
  }
  for (let i = 0; i < DRUGS.length; i++) {
    const stock = w.drugStock[i]
    if (stock === undefined) {
      // 存货表比药品表短 —— 原版是同一个 `DrugPack.drugList`，长度对不上说明
      // 这两张表分家了。静默少画一行的表现是"那一行没有数字"。
      throw new Error(`药品存货只有 ${w.drugStock.length} 条，而药品有 ${DRUGS.length} 种`)
    }
    push({
      kind: 'text',
      layer: 'drug-menu',
      text: `${stock}`,
      x: DRUG_STOCK_X,
      y: DRUG_STOCK_TOP + DRUG_STOCK_STRIDE * i,
    })
  }
  if (!m.isDrawIntro) return
  if (m.introDrug === null || m.introText === null) {
    // `checkMoveIn` 里 `isDrawIntro=true` 与那两样是同一句话里写的。少了一样
    // 说明状态层分家了 —— 原版此时会 `drawImage(null,…)`，什么都不画。
    throw new Error('药品菜单说要画介绍，可它不知道是哪一种药（introDrug/introText 是 null）')
  }
  push({
    kind: 'image',
    layer: 'drug-menu',
    id: drugPictureId(m.introDrug),
    x: DRUG_INTRO_X,
    y: m.introY,
  })
  push({
    kind: 'text',
    layer: 'drug-menu',
    text: m.introText,
    x: DRUG_INTRO_X + 10,
    y: m.introY + 20,
  })
}

/**
 * 第 13 层，技能菜单（`SkillMenu.drawSkillMenu`）。
 *
 * 画的是**当前那一组**（`skillButtons`），不是三组都画 —— 三组的按钮坐标
 * 完全重合，画错组的表现是"技能名对不上这个人"，而按钮排布看着毫无异常。
 *
 * 返回按钮**无条件画**：原版这里没有 null 判，也就是说菜单画得出来时它一定
 * 已经由 `checkRound()` 建好了。真是 null 就抛 —— 那说明有人在 `checkRound()`
 * 之前把 `isDraw` 置了真，原版在那种情形下是 NPE。
 */
function skillMenuOps(w: BattleWorld, push: (op: DrawOp) => void): void {
  const m = w.skillMenu
  if (!m.isDraw) return
  push({ kind: 'image', layer: 'skill-menu', id: SKILL_MENU_BACK_ID, x: MENU_BACK_X, y: MENU_BACK_Y })
  for (const [i, b] of m.groups[m.group].entries()) {
    push({
      kind: 'image',
      layer: 'skill-menu',
      id: skillButtonId(m.group, i, b.variant),
      x: b.x,
      y: b.y,
    })
  }
  const back: MenuButton | null = m.returnButton
  if (back === null) {
    throw new Error(
      '技能菜单画出来了，可返回按钮还是 null —— 原版 drawSkillMenu 无条件画它，' +
        '这一步在那边是 NullPointerException。checkRound() 没跑过。',
    )
  }
  push({ kind: 'image', layer: 'skill-menu', id: skillReturnId(back.variant), x: back.x, y: back.y })
  if (!m.isDrawIntro) return
  if (m.introImage === null) {
    throw new Error('技能菜单说要画说明图，可它不知道是哪一张（introImage 是 null）')
  }
  push({
    kind: 'image',
    layer: 'skill-menu',
    id: skillIntroId(m.introImage),
    x: SKILL_INTRO_X,
    y: m.introY,
  })
}

/**
 * 第 17 / 18 层，战斗状态图标（`BattleState.drawState`）。
 *
 * 一个人身上只有一份状态（原版 `Hero.battleState` 是单个对象，`set()` 会把
 * 上一份先 `Return()` 掉），所以这里最多一条绘制指令。落点 `x/y` 是 `set()`
 * 写死的那一对，此后不动 —— 它跟着人走的话，人一动图标就飞了。
 */
function stateIconOps(state: BattleState, layer: LayerName, push: (op: DrawOp) => void): void {
  if (!state.isUsable) return
  push({ kind: 'image', layer, id: stateIconId(state.type), x: state.x, y: state.y })
}

/**
 * 第 21 层，提示图（`Reminder.drawReminder`）。
 *
 * 这是战斗里**唯一真的在缩放**的一层：源矩形恒为 `(0,0)-(128,24)`，目标矩形
 * 由 `update()` 每拍朝两边张开（`dx1-=5; dx2+=5; dy1-=1; dy2+=1`）。
 * `show()` 那一拍两个角还重合，目标矩形宽高都是 0 —— 原版 `drawImage` 在那种
 * 情形下什么都不画，这边由渲染器的 `clip()` 得到同样的结果（宽 0 的精灵）。
 *
 * 缩放意味着采样方式在这一层看得见：Java2D 默认最近邻，Pixi 默认线性，
 * `battleRenderer` 已经把它改成最近邻（那里的第 1 条就是为这一层写的）。
 */
function reminderOps(w: BattleWorld, push: (op: DrawOp) => void): void {
  const r = w.reminder
  if (!r.isDraw) return
  if (r.image === null) {
    // `show(i)` 里 `currentImage=images.get(i)` 与 `isDraw=true` 是同一句话。
    throw new Error('提示图说要画，可它不知道是第几张（image 是 null）—— show() 没跑过')
  }
  push({
    kind: 'rect',
    layer: 'reminder',
    id: reminderId(r.image),
    dest: { x: r.dx1, y: r.dy1, width: r.dx2 - r.dx1, height: r.dy2 - r.dy1 },
    src: REMINDER_SRC,
  })
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
    dest: { x: 0, y: 0, width: g.ldx2, height: STAGE_HEIGHT },
    src: { x: 0, y: 0, width: g.lsx2, height: STAGE_HEIGHT },
  })
  // 右：目标 (rdx1,0)-(1024,640)，源 (rsx1,0)-(512,640)。
  push({
    kind: 'rect',
    layer: 'game-over',
    id: GAME_OVER_RIGHT_ID,
    dest: { x: g.rdx1, y: 0, width: STAGE_WIDTH - g.rdx1, height: STAGE_HEIGHT },
    src: { x: g.rsx1, y: 0, width: GAME_OVER_HALF - g.rsx1, height: STAGE_HEIGHT },
  })
}

/** 开场云雾：同一张图**对开**，左半幅每拍 +30、右半幅每拍 −30。 */
function startAnimOps(w: BattleWorld, push: (op: DrawOp) => void): void {
  const s = w.startAnimation
  if (!s.isDraw) return
  push({ kind: 'image', layer: 'start-anim', id: CLOUD_ID, x: s.leftX, y: 0 })
  push({ kind: 'image', layer: 'start-anim', id: CLOUD_ID, x: s.rightX, y: 0 })
}
