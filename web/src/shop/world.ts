import { DRUGS } from '../battle/drugs'
import { drugPictureAssetId, equipPictureAssetId } from '../assets/ids'
import { JavaRandom } from '../game/javaRandom'
import { EQUIPMENT_LISTS, SLOT_FILE } from '../menu/equipment'
import type { EquipSlot } from '../menu/equipment'
import { shopButton } from './buttons'
import type { ShopButtonState } from './buttons'
import {
  BACK_BOX,
  BUY_BOX,
  FIRST_CATEGORY,
  SELL_BOX,
  SHOP_CATEGORIES,
  categoryBox,
  stepBox,
} from './layout'
import type { ShopKind } from './layout'
import type {
  DrugShopState,
  EquipShopState,
  ShopPack,
  ShopRow,
  ShopWorld,
} from './types'

/**
 * 建一份商店世界。参数就是**商店剧本**里 `setup` 那五行
 * （`tools/src/devtools/ShopScript.java`），一个字段都不从行为真值里读状态。
 */
export interface ShopConfig {
  /**
   * **队伍名单** —— 剧本 `Role` 那一行三个数，`Reader` 把它们置进
   * `SaveAndLoad.zhang/lu/wen`（`ShopScript.java` 写作「已入队的角色」）。
   *
   * ⚠️ **不是出战名单。** 出战名单是 `Fight` 那一行的第 1/2/3 列
   * （`FightEvent.fight` 里的 `zhang` / `yu` / `lu`，见 `state/fight.ts` 的
   * `COL_PARTY`），一场战斗一份；这一份是"谁在队里"，一个存档一份。两份
   * 都是三个位置、第一位都叫 `zhang`，**第二三位不同** —— 所以第三位的键是
   * `wen` 不是 `lu`，第二位是 `lu` 不是 `yu`。店里画谁读的是这一份。
   * 判据在 `render/animation.test.ts`（两份名单各自解回源码再对撞）。
   */
  readonly party: readonly string[]
  /** `Money.setCoins(...)`。原版那个 static 的初值是 10000。 */
  readonly coins: number
  /**
   * 掷存货用的种子。原版没有这个东西 —— 存货是 `Math.random()` 现摇的，
   * 而导出真值时驱动器把 `java.lang.Math` 那个全局 `Random`
   * `setSeed(seed)` 播回一个已知起点（`ShopDriver.seedRandom()`）。
   * 这一层照做，用的是 ADR-0004 那份逐位对齐的 {@link JavaRandom}。
   */
  readonly seed: number
  /** 开局背包里的药（`DrugPack.addDrug`）。 */
  readonly drugs?: readonly { readonly name: string; readonly count: number }[] | undefined
  /** 开局背包里的装备（`EquipmentPack.addEqupment`）。 */
  readonly equipment?: readonly { readonly name: string; readonly count: number }[] | undefined
}

/**
 * ⚠️ **掷骰的次数与顺序就是规格。**
 *
 * 原版是 `GameLauncher` 先 `new ShopPanel()` 再 `new EquipmentShopPanel()`，
 * 两个构造函数各自逐件 `setNumber((int)(Math.random()*10))`：
 *
 *     药店      drug.txt            6 次
 *     装备店    头 / 盔甲 / 手 /
 *               脚 / 饰品 / 武器   6+6+6+6+12+20 = 56 次
 *
 * 合计 62 次，共用**同一条**随机数流。少一次、多一次或换个顺序，后面每一栏
 * 的存货全部错位 —— 而错位之后每个数仍然是 0..9 的合法值，肉眼看不出来。
 * 守着它的是 `shopTrace.test.ts` 里 `list` 那一组：真值里那一排存货是原版
 * 自己跑出来的（`shop-categories` 六栏全走了一遍，正是为此）。
 *
 * ⚠️ **这个次序不是 `SHOP_CATEGORIES`**（那一份是分类栏按钮的左右次序，
 * weapon 排头）。它是 `EquipmentShopPanel` 构造函数里六段 `readEquipment`
 * 的先后，武器**在最后**。两份名单是同一个集合、不同的序。
 */
export const STOCK_ROLL_ORDER: readonly EquipSlot[] = [
  'helmet',
  'armor',
  'glove',
  'shoe',
  'decoration',
  'weapon',
]

/** `(int)(Math.random()*10)`。上界写在这里，只此一处。 */
const STOCK_BOUND = 10

function drugRows(rng: JavaRandom): ShopRow[] {
  return DRUGS.map((d) => ({
    name: d.name,
    price: d.reduceMoney,
    picture: drugPictureAssetId(d.picture),
    stock: rng.scaledInt(STOCK_BOUND),
    purchase: 0,
  }))
}

function equipRows(rng: JavaRandom): Record<EquipSlot, ShopRow[]> {
  const rows = {} as Record<EquipSlot, ShopRow[]>
  for (const slot of STOCK_ROLL_ORDER) {
    rows[slot] = EQUIPMENT_LISTS[slot].map((e) => ({
      name: e.name,
      price: e.reduceMoney,
      picture: equipPictureAssetId(SLOT_FILE[slot], e.picture),
      stock: rng.scaledInt(STOCK_BOUND),
      purchase: 0,
    }))
  }
  return rows
}

/**
 * 药店的按钮表，**次序照抄构造函数**：`buy` / `sell` / `back`，然后逐行
 * `decrease` / `increase`。真值 `pressed` 里那几个名字与
 * `ShopDriver.buttonLabel(i)` 算出来的是同一套。
 */
export function drugShopButtons(rows: number): ShopButtonState[] {
  const buttons = [
    shopButton('buy', BUY_BOX),
    shopButton('sell', SELL_BOX),
    shopButton('back', BACK_BOX),
  ]
  buttons.push(...stepButtons(rows))
  return buttons
}

/**
 * 装备店的按钮表。⚠️ **头三颗是 `sell` / `buy` / `back`** —— 与药店的
 * `buy` / `sell` / `back` **前两颗对调了**。原版两个构造函数就是这么写的
 * （复制粘贴时换了序），而按钮表下标是 `pressed` 那一列的来源，抄错的表现是
 * "点了购买，真值里写着卖出"。
 */
export function equipShopButtons(rows: number): ShopButtonState[] {
  const buttons = [
    shopButton('sell', SELL_BOX),
    shopButton('buy', BUY_BOX),
    shopButton('back', BACK_BOX),
  ]
  for (const category of SHOP_CATEGORIES) {
    buttons.push(shopButton(`category:${category}`, categoryBox(category)))
  }
  buttons.push(...stepButtons(rows))
  return buttons
}

/** 逐行那两颗，**减在前加在后**（`buttonlist.add(decrease); buttonlist.add(increase);`）。 */
export function stepButtons(rows: number): ShopButtonState[] {
  const out: ShopButtonState[] = []
  for (let i = 0; i < rows; i++) {
    out.push(shopButton(`minus:${i}`, stepBox(i, false)))
    out.push(shopButton(`plus:${i}`, stepBox(i, true)))
  }
  return out
}

/** 固定按钮的颗数：`stepButtons` 从第几颗起。药店 3，装备店 3+6。 */
export function stepBase(kind: ShopKind): number {
  return kind === 'drug' ? 3 : 3 + SHOP_CATEGORIES.length
}

function emptyPack(): ShopPack {
  const equipment = {} as Record<EquipSlot, number[]>
  for (const slot of SHOP_CATEGORIES) equipment[slot] = EQUIPMENT_LISTS[slot].map(() => 0)
  return { drugs: DRUGS.map(() => 0), equipment }
}

/**
 * `DrugPack.addDrug(name, n)`。⚠️ **原版名字对不上时一声不响什么都不做**，
 * 这里改成抛：喂进来的名字来自剧本，而导出器那一侧已经当场核过
 * （`ShopDriver.addDrug` 加完核数量）。安静地丢掉一行 setup 的表现是
 * "开局背包空了"，而它与"剧本本来就没给东西"长得一模一样。
 */
function addDrug(pack: ShopPack, name: string, count: number): void {
  const i = DRUGS.findIndex((d) => d.name === name)
  if (i < 0) throw new Error(`sources/Shop/drug.txt 里没有叫 ${name} 的药品`)
  pack.drugs[i]! += count
}

/** `EquipmentPack.addEqupment(name, n)`。同上，名字对不上是硬失败。 */
function addEquipment(pack: ShopPack, name: string, count: number): void {
  let found = false
  // 原版那六个 for **没有 break**，同名的话六栏里每一栏都会加。照抄形状。
  for (const slot of SHOP_CATEGORIES) {
    EQUIPMENT_LISTS[slot].forEach((e, i) => {
      if (e.name !== name) return
      pack.equipment[slot]![i]! += count
      found = true
    })
  }
  if (!found) throw new Error(`sources/Shop 里没有叫 ${name} 的装备`)
}

export function createShopWorld(config: ShopConfig): ShopWorld {
  // ⚠️ **一条流，顺序就是规格**（见 `STOCK_ROLL_ORDER` 的头注）。
  const rng = new JavaRandom(config.seed)
  const drugStock = drugRows(rng)
  const equipStock = equipRows(rng)

  const drug: DrugShopState = {
    kind: 'drug',
    currentX: 0,
    currentY: 0,
    message: '欢迎来到金陵大学医院',
    messagePlus: null,
    iconPicture: null,
    buttons: drugShopButtons(drugStock.length),
    rows: drugStock,
  }
  const equipment: EquipShopState = {
    kind: 'equipment',
    currentX: 0,
    currentY: 0,
    message: '欢迎来到金陵大学装备自选超市',
    messagePlus: null,
    messageRemark: null,
    iconPicture: null,
    buttons: equipShopButtons(equipStock[FIRST_CATEGORY].length),
    category: FIRST_CATEGORY,
    rows: equipStock,
  }

  const pack = emptyPack()
  for (const it of config.drugs ?? []) addDrug(pack, it.name, it.count)
  for (const it of config.equipment ?? []) addEquipment(pack, it.name, it.count)

  return {
    // 原版两个面板一起活着，"现在开着哪一家"是外面那一层的事；剧本第一条
    // 指令必定是 `open`，所以开局停在哪一家都会被它换掉。停在药店是
    // `GameLauncher` 建面板的次序。
    active: 'drug',
    drug,
    equipment,
    coins: config.coins,
    pack,
    party: {
      zhang: config.party.includes('zhang'),
      lu: config.party.includes('lu'),
      wen: config.party.includes('wen'),
    },
    music: [],
    leaving: false,
    tick: 0,
  }
}

/** 当前开着的那一家。 */
export function activePanel(w: ShopWorld): DrugShopState | EquipShopState {
  return w.active === 'drug' ? w.drug : w.equipment
}

/** 当前这一列商品（药店永远是那六种，装备店按 `category`）。 */
export function currentRows(w: ShopWorld): ShopRow[] {
  return w.active === 'drug' ? w.drug.rows : w.equipment.rows[w.equipment.category]
}

/** 背包里与当前这一列**逐下标对齐**的那一列。 */
export function currentHeld(w: ShopWorld): number[] {
  return w.active === 'drug' ? w.pack.drugs : w.pack.equipment[w.equipment.category]
}
