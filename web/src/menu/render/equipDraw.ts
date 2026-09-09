import { EQUIP_SLOTS } from '../equipment'
import type { EquipSlot, EquipmentSpec } from '../equipment'
import {
  CURRENT_IMAGE_X,
  CURRENT_IMAGE_Y,
  EQUIP_LIST_VIEW,
  EQUIP_X_START,
  WORN_IMAGE_X,
  equipCount,
  equipList,
  menuHeroOf,
  specOf,
} from '../equipPanel'
import type { EquipPanelState } from '../equipPanel'
import { rowBaseline, visibleRange } from '../scroll'
import type { MenuHero } from '../heroes'
import type { ScollHero } from '../types'
import { equipPictureId } from '../equipmentPictures'
import { equipButtonId, showValueArrowId, showValueDigitId, warningId } from './assets'
import { scrollbarOps } from './scrollbar'
import type { MenuDrawOp } from './drawList'
import type { AssetId } from '../../assets/ids'

/**
 * 装备页的 `drawThisPanel()`，摊成绘制清单。
 *
 * 五段，**次序就是 z 序**，逐行照抄 `EquipPanel.drawThisPanel()`：
 *
 *     for(MenuButton button:buttonlist) button.drawButton(g);   ← 六颗槽位
 *     for(MenuButton button:useButtonList) button.drawButton(g);← 使用 / 弃用
 *     drawEquipment(g);    ← 背包列表 + 四个升降数字 + 两行说明
 *     drawWarning(g);      ← 两张拒绝提示图
 *     drawHeroStuff(g);    ← 身上那件的图 + 六个槽位的名字
 *     drawValueBar(g);     ← 当前那个人的四项属性
 *
 * ## 两张装备图（xl-234）
 *
 * `drawEquipment()` 那句 `g.drawImage(currentEquipment.getPicture(), …)` 与
 * `drawHeroStuff()` 那句 `g.drawImage(heroEquipment.getPicture(), …)` 取的是
 * `Equipment.picture`，路径是 **`sources/Shop/装备/<类>/<文件名>`**。
 * 那一批素材已经进了烘焙管线（`equip:` 前缀，进主包），
 * ID 与三张已知缺失的登记在 `menu/equipmentPictures.ts`。
 *
 * ⚠️ **两句 `drawImage` 各自的条件不同，而它们又长得很像。**
 * 选中那张在 `if(signal==1)` 那一支里、画在四个升降数字**之后**；
 * 身上那张在 `drawHeroStuff()` 的 `if(heroEquipment!=null)` 里、画在六行
 * 槽位名字**之前**。两段隔着 `drawWarning()`，所以 z 序不能合并。
 */

/** `Color.white / red / blue`。 */
const WHITE = '#ffffff'
const RED = '#ff0000'
const BLUE = '#0000ff'

/** `drawEquipment()` 里那两个字号：列表 20，两行说明 19。 */
const LIST_FONT = 20
const MESSAGE_FONT = 19
/** `drawHeroStuff()` 21、`drawValueBar()` 22。 */
const SLOT_NAME_FONT = 21
const VALUE_FONT = 22

/** `drawEquipment()`：数量画在名字右边 150。 */
const COUNT_DX = 150
/** `x_message=x_start_point-3`、`y_message=578`。 */
const MESSAGE_X = EQUIP_X_START - 3
const MESSAGE_Y = 578
/** 身上那件的说明画在左边：`g.drawString(message1, 57, y_message)`。 */
const WORN_MESSAGE_X = 57
/** `x_value=125`、`y_value=410`；`drawHeroStuff` 的 `vgap=20`。 */
const VALUE_X = 125
const VALUE_Y = 410
const SLOT_NAME_VGAP = 20
/** `drawValueBar` 四行的行距（`y_value`、`+26`、`+52`、`+78`）。 */
const VALUE_VGAP = 26
/** `drawWarning()` 两张提示图的落点。 */
const WARNING_X = 800
const WARNING_Y = 330
/** `showValueDifference()`：`gap=80`、`gap2=25`、`y=388`。 */
const SHOW_VALUE_X = VALUE_X + 80
const SHOW_VALUE_Y = 388
const SHOW_VALUE_VGAP = 25
/** `drawShowValue()`：箭头画在 `x-20`，第 i 位数字画在 `x+18*i`。 */
const SHOW_VALUE_ARROW_DX = -20
const SHOW_VALUE_DIGIT_DX = 18

/** 六个槽位名在 `drawHeroStuff()` 里的两种写法。**标点与空格照抄，别对齐它们。** */
const SLOT_LABEL: Readonly<Record<EquipSlot, { readonly some: string; readonly none: string }>> = {
  weapon: { some: '武器：', none: '武器: 无' },
  armor: { some: '盔甲：', none: '盔甲: 无' },
  helmet: { some: '头盔:', none: '头盔: 无 ' },
  shoe: { some: '战靴:', none: '战靴: 无 ' },
  glove: { some: '护臂:', none: '护臂: 无' },
  decoration: { some: '饰品:', none: '饰品: 无' },
}

/** `drawValueBar()` 那四行的标签。 */
const VALUE_LABEL: readonly { readonly label: string; readonly of: (h: MenuHero) => number }[] = [
  { label: '体力：', of: (h) => h.physicalPower },
  { label: '敏捷：', of: (h) => h.agile },
  { label: '武力：', of: (h) => h.strength },
  { label: '精气：', of: (h) => h.spirit },
]

function text(text: string, x: number, y: number, size: number, color: string): MenuDrawOp {
  return { kind: 'text', layer: 'page', text, x, y, size, color }
}

function image(id: AssetId, x: number, y: number): MenuDrawOp {
  return { kind: 'image', layer: 'page', id, x, y }
}

/**
 * 一件装备那行说明的后半截。**格式照抄**（冒号前后各一个空格、四个加号）：
 * `" : 体力+"+pp+" 敏捷+"+ag+" 武力+"+st+" 精气+"+sp`。
 */
export function equipIntroText(spec: EquipmentSpec): string {
  return (
    ` : 体力+${spec.addPhysicalPower}` +
    ` 敏捷+${spec.addAgile}` +
    ` 武力+${spec.addStrength}` +
    ` 精气+${spec.addSpirit}`
  )
}

/**
 * `ShowValue.getCurrentImages()` 的 case 1 / case 2：从千位起，前导零不画，
 * 个位无论如何都画。返回的是要画的那几位数字（高位在前）。
 *
 * ⚠️ 个位那一段**没有 firstNum 判断** —— 差值是 0 时画的是一个孤零零的 `0`，
 * 不是什么都不画。
 */
export function showValueDigits(value: number): number[] {
  const v = Math.abs(value)
  const digits: number[] = []
  let first = false
  for (const place of [1000, 100, 10]) {
    const d = Math.trunc((v % (place * 10)) / place)
    if (!first && d === 0) continue
    first = true
    digits.push(d)
  }
  digits.push(v % 10)
  return digits
}

/** 一格升降数字：一个箭头加几位数。`type` 由正负决定（0 也算「上升」）。 */
function showValueOps(value: number, y: number): MenuDrawOp[] {
  // `ShowValue.show(int,int,int)`：`value<0` 记成 type=2（下降），否则 type=1。
  const down = value < 0
  const ops: MenuDrawOp[] = [
    image(showValueArrowId(down), SHOW_VALUE_X + SHOW_VALUE_ARROW_DX, y),
  ]
  // 第 0 张是箭头，数字从下标 1 起，第 i 张画在 `x+18*i`。
  showValueDigits(value).forEach((digit, i) => {
    ops.push(image(showValueDigitId(digit, down), SHOW_VALUE_X + SHOW_VALUE_DIGIT_DX * (i + 1), y))
  })
  return ops
}

/** 装备页那一层的全部绘制。`whichHero` 是卷轴上选中的那个人。 */
export function equipDrawOps(
  e: EquipPanelState,
  heroes: MenuHero[],
  whichHero: ScollHero,
): MenuDrawOp[] {
  const ops: MenuDrawOp[] = []

  // 1. 六颗槽位按钮。⚠️ 它们只有两张图：`new MenuButton(…, image1, image2, image1, …)`
  //    —— **按下时贴的是常态图**。三态各一张是「使用 / 弃用」那两颗才有的。
  for (const slot of EQUIP_SLOTS) {
    const b = e.slots[slot]
    if (!b.isDraw) continue
    ops.push(image(equipButtonId(slot, b.image), b.x, b.y))
  }
  // 2. 使用 / 弃用。
  //
  // ⚠️ 「弃用」读的是 `abandonDrawn`，**不是** `abandon.isDraw` —— 原版在这
  // 两颗按钮画完之后才在 `drawHeroStuff()` 里改后者，于是画面比状态**晚一帧**。
  // 理由与实测读数见 `equipPanel.ts` 里 `abandonDrawn` 那个字段的注释。
  if (e.use.isDraw) ops.push(image(equipButtonId('use', e.use.image), e.use.x, e.use.y))
  if (e.abandonDrawn) {
    ops.push(image(equipButtonId('abandon', e.abandon.image), e.abandon.x, e.abandon.y))
  }

  // 3. drawEquipment()
  //
  // ⚠️ **只画滚动窗口里的那几行**，原版不裁剪（xl-6lo.13，理由见
  // `menu/scroll.ts` 的文件头注）。`menu-scroll` 那份真值量的就是这件事：
  // 20 件武器撑过列表框 4 行，第 17..20 行原版照画、画到框外去。
  const list = equipList(e)
  const window = visibleRange(EQUIP_LIST_VIEW, list.length, e.scroll)
  for (let i = window.from; i < window.to; i++) {
    const item = list[i]!
    const y = rowBaseline(EQUIP_LIST_VIEW, i, window.from)
    const count = equipCount(e, e.currentList, item.name)
    ops.push(text(item.name, EQUIP_X_START, y, LIST_FONT, WHITE))
    // `g.drawString("   "+e.getNumberGOT(), x+150, y)` —— 三个空格照抄。
    ops.push(text(`   ${count}`, EQUIP_X_START + COUNT_DX, y, LIST_FONT, WHITE))
  }
  ops.push(...scrollbarOps(EQUIP_LIST_VIEW, list.length, e.scroll))

  let message1: string
  let message2: string
  if (e.signal === 1 && e.diff !== null && e.currentEquipment !== null) {
    const d = e.diff
    for (const [i, value] of [d.physicalPower, d.agile, d.strength, d.spirit].entries()) {
      ops.push(...showValueOps(value, SHOW_VALUE_Y + SHOW_VALUE_VGAP * i))
    }
    // `g.drawImage(currentEquipment.getPicture(), x_currentImage, y_currentImage, this)`
    // —— 升降数字那四行之后，两行说明之前。
    const spec = specOf(e.currentList, e.currentEquipment)
    const currentPicture = equipPictureId(e.currentList, spec.picture)
    if (currentPicture !== null) {
      ops.push(image(currentPicture, CURRENT_PICTURE_ANCHOR.x, CURRENT_PICTURE_ANCHOR.y))
    }
    message1 = spec.name
    message2 = equipIntroText(spec)
  } else {
    message1 = '无装备'
    message2 = '快去装备店购买吧~！'
  }
  ops.push(text(message1, MESSAGE_X, MESSAGE_Y, MESSAGE_FONT, WHITE))
  ops.push(text(message2, MESSAGE_X + 75, MESSAGE_Y, MESSAGE_FONT, WHITE))
  if (e.heroEquipment !== null) {
    const worn = specOf(e.currentList, e.heroEquipment)
    ops.push(text(worn.name, WORN_MESSAGE_X, MESSAGE_Y, MESSAGE_FONT, WHITE))
    // `g.drawString(message2, 61+75, y_message)` —— 左边这一半的起点是 61 不是 57。
    ops.push(text(equipIntroText(worn), 61 + 75, MESSAGE_Y, MESSAGE_FONT, WHITE))
  }

  // 4. drawWarning()：两条拒绝各自一张图，落点相同。
  if (e.warnEquipped) ops.push(image(warningId('equipped'), WARNING_X, WARNING_Y))
  if (e.warnCannotUse) ops.push(image(warningId('cannotUse'), WARNING_X, WARNING_Y))

  // 5. drawHeroStuff()：身上那件的图（(332,180)）+ 六行名字。
  //    ⚠️ 六行的次序是 武器 / 盔甲 / 头盔 / 战靴 / 护臂 / 饰品，与 `EQUIP_SLOTS`
  //    同序；y 从 `y_value-7*vgap` 起，每行 `vgap`。
  //    图画在六行之前，因为原版那句 `drawImage` 就在方法开头。
  if (e.heroEquipment !== null) {
    const wornPicture = equipPictureId(e.currentList, specOf(e.currentList, e.heroEquipment).picture)
    if (wornPicture !== null) {
      ops.push(image(wornPicture, WORN_PICTURE_ANCHOR.x, WORN_PICTURE_ANCHOR.y))
    }
  }
  const pack = e.packs[e.currentPackHero]
  EQUIP_SLOTS.forEach((slot, i) => {
    const worn = pack[slot]
    const label = SLOT_LABEL[slot]
    ops.push(
      text(
        worn === null ? label.none : `${label.some}${worn}`,
        VALUE_X,
        VALUE_Y - (7 - i) * SLOT_NAME_VGAP,
        SLOT_NAME_FONT,
        RED,
      ),
    )
  })

  // 6. drawValueBar()：当前那个人的四项属性。
  const hero = menuHeroOf(heroes, whichHero)
  VALUE_LABEL.forEach((row, i) => {
    ops.push(
      text(`${row.label}${row.of(hero)}`, VALUE_X, VALUE_Y + VALUE_VGAP * i, VALUE_FONT, BLUE),
    )
  })

  return ops
}

/**
 * 两张装备图的落点（xl-234 接上了真的贴图）。
 *
 * 原版那两句 `g.drawImage(<Equipment>.getPicture(), …)` 就画在这两处。
 * 它们导出，是因为 `equipDraw.test.ts` 拿它们当分母：判据从原版那两句
 * 现解出变量名，再对回 `EquipPanel` 里那三个坐标常量。
 */
export const CURRENT_PICTURE_ANCHOR = { x: CURRENT_IMAGE_X, y: CURRENT_IMAGE_Y } as const
export const WORN_PICTURE_ANCHOR = { x: WORN_IMAGE_X, y: CURRENT_IMAGE_Y } as const
