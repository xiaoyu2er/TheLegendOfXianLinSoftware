import type { AssetId } from '../../assets/ids'
import {
  ANIMATION_FRAMES,
  COINS_X,
  COINS_Y,
  HELD_DX,
  ICON_X,
  ICON_Y,
  KEEPER_ANIMATION_X,
  KEEPER_ANIMATION_Y,
  LIST_COLOR,
  LIST_FONT_SIZE,
  LIST_X,
  LIST_Y0,
  MESSAGE_PLUS_Y,
  MESSAGE_X,
  MESSAGE_Y,
  PARTY_ANIMATION_X,
  PARTY_ANIMATION_Y,
  PRICE_DX,
  PURCHASE_DX_DRUG,
  PURCHASE_DX_EQUIP,
  PURSE_X,
  PURSE_Y,
  REMARK_X,
  REMARK_Y,
  SIGN_X,
  SIGN_Y,
  STAT_ICON_X,
  STAT_LINE_GAP,
  STAT_ROW_GAP,
  STAT_TEXT_X,
  STAT_Y0,
  STEP_ROW_H,
  STOCK_DX_DRUG,
  STOCK_DX_EQUIP,
} from '../layout'
import {
  KEEPER_ROLE,
  PARTY_ROLES,
  PURSE,
  SHOP_BACKGROUND,
  SIGN,
  STAT_ROWS,
  animationFrameId,
  buttonImages,
  mouseId,
  pictureTextureId,
} from './assets'
import { activePanel, currentHeld, currentRows } from '../world'
import type { ShopWorld } from '../types'

/**
 * **原版 `ShopPanel.paint()` / `EquipmentShopPanel.paint()` 那四层，摊成一份
 * 有序的绘制清单。**
 *
 * 这一层是纯函数：世界 → 一串「把哪张图贴在哪 / 把哪句话画在哪」。它**不碰
 * Pixi、不碰 DOM**，所以顺序、坐标、贴哪一张图全都能在 `pnpm test` 里逐条
 * 断言。真实像素由跨端逐帧比对兜底，而 **shop 那条流水线还没接上**
 * （`replay/implemented.ts` 的 `IMPLEMENTED_DRIVERS` 里没有 `shop`，
 * 归 xl-knp.10）—— 也就是说今天守着这一层的**只有** `drawList.test.ts`。
 *
 * ## 四层的次序就是 z 序
 *
 *     backgroundGraphics.drawImage(backgroundImage, 0, 0, this);  ← background
 *     drawIcon(backgroundGraphics);                               ← icon
 *     for (GameButton b : buttonlist) b.drawButton(…);            ← button
 *     backgroundGraphics.drawImage(mouse, currentX, currentY, …); ← mouse
 *
 * 两家店的 `paint()` 逐字相同，`drawIcon()` 只差三处（存货与 purchase 两列的
 * x、招牌那张图、第三行 `messageremark`），所以这里是**一份**实现按
 * `kind` 分流，不是两份。
 *
 * ## 动画帧号不在状态层里
 *
 * 原版那条 `while(true)` 线程用同一个 `i` 同时推鼠标图与四条人物动画，而
 * **真值一个都不记**（导出时它被冻在第一帧上）。所以帧号是这一层的参数，
 * 由渲染层自己数 —— 放进状态层的话会多出一个真值管不着的字段，而"它对不对"
 * 就再也没人答得出。
 */

export type ShopLayer = 'background' | 'icon' | 'button' | 'mouse'

export const SHOP_LAYERS: readonly ShopLayer[] = ['background', 'icon', 'button', 'mouse']

export type ShopDrawOp =
  /** `g.drawImage(img, x, y, panel)` —— 按原尺寸贴。 */
  | {
      readonly kind: 'image'
      readonly layer: ShopLayer
      readonly id: AssetId
      readonly x: number
      readonly y: number
    }
  /** `g.drawString(s, x, y)` —— **x/y 是基线**，不是行盒左上角。 */
  | {
      readonly kind: 'text'
      readonly layer: ShopLayer
      readonly text: string
      readonly x: number
      readonly y: number
      readonly size: number
      readonly color: string
    }

function image(layer: ShopLayer, id: AssetId, x: number, y: number): ShopDrawOp {
  return { kind: 'image', layer, id, x, y }
}

function text(layer: ShopLayer, s: string, x: number, y: number): ShopDrawOp {
  return { kind: 'text', layer, text: s, x, y, size: LIST_FONT_SIZE, color: LIST_COLOR }
}

/**
 * 一帧的绘制清单。`frame` 是那条动画线程走到第几格（0..7），鼠标图与四条
 * 人物动画**共用同一个** —— 原版那个 `for(int i=0;i<8;i++)` 一次赋值全部五处。
 */
export function shopDrawList(w: ShopWorld, frame: number): ShopDrawOp[] {
  if (!Number.isInteger(frame) || frame < 0 || frame >= ANIMATION_FRAMES) {
    // 空转要响：越界的帧号算出来的 ID 查不到，而"查不到"在渲染器那边是一句
    // 抛错，与"这一层写坏了"分不开。
    throw new Error(`动画帧号要在 0..${ANIMATION_FRAMES - 1}，收到 ${frame}`)
  }
  const p = activePanel(w)
  const ops: ShopDrawOp[] = [image('background', SHOP_BACKGROUND, 0, 0)]
  ops.push(...iconOps(w, frame))
  for (const b of p.buttons) {
    ops.push(image('button', buttonImages(b.label)[b.image], b.x, b.y))
  }
  ops.push(image('mouse', mouseId(frame), p.currentX, p.currentY))
  return ops
}

/** `drawIcon()`，逐句照抄它的次序。 */
function iconOps(w: ShopWorld, frame: number): ShopDrawOp[] {
  const p = activePanel(w)
  const drug = p.kind === 'drug'
  const ops: ShopDrawOp[] = []

  // 1. 图标框。⚠️ 原版这一句是无条件的 `g.drawImage(drugImage, …)`，而
  //    `drugImage` 开局是 null —— Java 的 drawImage 收 null 是**空操作**，
  //    所以开局那一步什么都没画。这里照做：没有就不出这一条 op。
  // ⚠️ 第二条 `null` 是**另一件事**：数据点名了而仓库里没有那张图，原版画的
  //    是一个宽度 −1 的空壳，同样什么都没画（`pictureTextureId`）。
  const icon = p.iconPicture === null ? null : pictureTextureId(p.iconPicture)
  if (icon !== null) ops.push(image('icon', icon, ICON_X, ICON_Y))

  // 2. 商品列表。六列的次序照抄那六句 drawString。
  const rows = currentRows(w)
  const held = currentHeld(w)
  const stockDx = drug ? STOCK_DX_DRUG : STOCK_DX_EQUIP
  const purchaseDx = drug ? PURCHASE_DX_DRUG : PURCHASE_DX_EQUIP
  rows.forEach((row, i) => {
    const y = LIST_Y0 + STEP_ROW_H * i
    ops.push(text('icon', row.name, LIST_X, y))
    ops.push(text('icon', ` ${row.price}`, LIST_X + PRICE_DX, y))
    ops.push(text('icon', ` ${row.stock}`, LIST_X + stockDx, y))
    ops.push(text('icon', ` ${held[i]!}`, LIST_X + HELD_DX, y))
    // ⚠️ **金钱那一句在循环体里** —— 原版每一行都把同一串字画在同一个
    // (900,20) 上。照抄：它是 20 条重叠的 op 而不是 1 条，改成 1 条画面上
    // 一样、清单不一样，而清单正是这一层唯一的判据。
    ops.push(text('icon', ` ${w.coins}`, COINS_X, COINS_Y))
    ops.push(text('icon', ` ${row.purchase}`, LIST_X + purchaseDx, y))
  })

  // 3. 出战的那几个人：动画一帧 + 四行属性。
  PARTY_ROLES.forEach(({ key, role }, i) => {
    if (!w.party[key]) return
    ops.push(image('icon', animationFrameId(role, frame), PARTY_ANIMATION_X, PARTY_ANIMATION_Y[i]!))
    STAT_ROWS.forEach((stat, j) => {
      const y = statBaseline(i, j)
      ops.push(text('icon', stat.text, STAT_TEXT_X, y))
      ops.push(image('icon', stat.icon, STAT_ICON_X, y))
    })
  })

  // 4. 店主 / 小妹，然后招牌、两三行话、钱袋。
  ops.push(
    image('icon', animationFrameId(KEEPER_ROLE[w.active], frame), KEEPER_ANIMATION_X, KEEPER_ANIMATION_Y),
  )
  ops.push(image('icon', SIGN[w.active], SIGN_X, SIGN_Y))
  // 三行都是 `if(x!=null)` 才画。
  if (p.message !== null) ops.push(text('icon', p.message, MESSAGE_X, MESSAGE_Y))
  if (p.messagePlus !== null) ops.push(text('icon', p.messagePlus, MESSAGE_X, MESSAGE_PLUS_Y))
  // 第三行只有装备店有。
  if (p.kind === 'equipment' && p.messageRemark !== null) {
    ops.push(text('icon', p.messageRemark, REMARK_X, REMARK_Y))
  }
  ops.push(image('icon', PURSE, PURSE_X, PURSE_Y))
  return ops
}

/** `30 + i*150 + j*20` —— 第 i 个人第 j 行属性的基线。 */
function statBaseline(person: number, line: number): number {
  return STAT_Y0 + STAT_ROW_GAP * person + STAT_LINE_GAP * line
}
