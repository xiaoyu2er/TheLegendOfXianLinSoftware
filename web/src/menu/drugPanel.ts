import { pressButton, releaseButton, moveInButton, menuButton } from './buttons'
import { DRUGS } from '../battle/drugs'
import type { DrugSpec } from '../battle/drugs'
import type { MenuHero } from './heroes'
import { derive } from '../battle/units'
import { DRUG_LIST_BOX, clampScroll, inListBox, rowBandTop, trackPress } from './scroll'
import type { ListViewport } from './scroll'
import { SCOLL_HEROES } from './types'
import type { DrugPanelState, DrugStock, MenuSubPanel, MenuWorld } from './types'

/**
 * 物品页（`menu/DrugPanel.java`）的状态层：**药品清单 / 选中 / 给指定的人
 * 喝下**（xl-6lo.10）。
 *
 * 三样东西在这里，因为原版把它们摆在三个不同的地方，而合并任何两样都会改结果：
 *
 * 1. **存货是全局的**（`shop.DrugPack.drugList` 是 `static`），所以它挂在
 *    `MenuWorld` 上而不是物品页上 —— 药店（M4）与战斗里的药品菜单读的是同一份。
 * 2. **选中的那一瓶与「使用」按钮是物品页的**（`currentDrug` / `use_button`）。
 * 3. **喝下去改的是卷轴上选中的那个人**，而卷轴是**物品页自己的那一个**
 *    （四个子面板各有一个 `Scoll`，`whichHero` 各走各的）。
 */

/** `x_start_point` / `y_start_point`：清单第一行的**基线**位置。 */
export const DRUG_LIST_X = 448
export const DRUG_LIST_Y = 190

/** 行高。`isMoveIn` 的命中带与 `drawEquipment` 的 `y += 32` 是同一个数。 */
export const DRUG_ROW_H = 32

/**
 * 命中带的宽度：`currentX < x_start_point+130`。
 *
 * ⚠️ **它比画出来的那一行窄** —— 数量那一列画在 `x + 180`，落在命中带外面。
 * 原版就是这样，别"顺手对齐"它。
 */
export const DRUG_HIT_W = 130

/**
 * 物品页那处列表的全部几何 —— 前四项是原版的常量，`box` 是从 `物品3.png`
 * 上量出来的（`scroll.ts` 的 `LIST_BOX_MEASUREMENT`）。
 *
 * ⚠️ **这一页在原版的数据下撑不满**：框里放得下 11 行，而 `drug.txt` 一共
 * 只有 6 种药。滚动条因此**画不出来**，`menu-scroll` 里守的正是这一侧 ——
 * 只验撑过的那一侧的话，"装得下时不画"与"这条代码根本没跑"长得一样。
 */
export const DRUG_LIST_VIEW: ListViewport = {
  firstBaseline: DRUG_LIST_Y,
  rowHeight: DRUG_ROW_H,
  hitLeft: DRUG_LIST_X,
  hitRight: DRUG_LIST_X + DRUG_HIT_W,
  box: DRUG_LIST_BOX,
}

/** `x_picture` / `y_picture`：选中那瓶药的插图左上角。 */
export const DRUG_PICTURE_X = 820
export const DRUG_PICTURE_Y = 178

/** 「使用」按钮。`x_button=x_picture`、`y_button=y_picture+240`、120×40。 */
export const USE_BUTTON_X = DRUG_PICTURE_X
export const USE_BUTTON_Y = DRUG_PICTURE_Y + 240
export const USE_BUTTON_W = 120
export const USE_BUTTON_H = 40

/**
 * 建物品页那一份状态。`use_button.isDraw` 开局是 **No** —— 构造函数最后一句
 * 就是 `use_button.isDraw=MenuButton.No;`，把 `MenuButton` 构造器刚设上的
 * `Yes` 又按了回去。真值第 0 帧的 `useDraw:false` 就是它。
 */
export function createDrugPanelState(): DrugPanelState {
  return {
    currentDrug: null,
    scroll: 0,
    useButton: menuButton(USE_BUTTON_X, USE_BUTTON_Y, USE_BUTTON_W, USE_BUTTON_H, false),
  }
}

/**
 * 建一份存货。**六种药全在里面**，没有的那几种 `count` 是 0 ——
 * `DrugPack.drugList` 就是整张表，`numberGOT` 默认 0（`ShopReader.readDrug`
 * 一个字都不给它赋）。清单是**画的时候**才按 `>0` 过滤的。
 *
 * 次序是 `sources/Shop/drug.txt` 的行序（`DRUGS` 抄的就是它，判据在
 * `battle/drugs.test.ts`）—— 而次序就是真值 `drug.selected` 那个下标的含义。
 *
 * 名字对不上一律抛，不静默跳过：剧本里写错一个药名，静默跳过之后
 * 「这一局没有那种药」与「打错了字」长得一模一样（`MenuDriver.addDrug` 那边
 * 也是 `die`）。
 */
export function createDrugPack(drugs: readonly Readonly<DrugStock>[] = []): DrugStock[] {
  const pack: DrugStock[] = DRUGS.map((d) => ({ name: d.name, count: 0 }))
  for (const want of drugs) {
    const stock = pack.find((s) => s.name === want.name)
    if (!stock) {
      throw new Error(`sources/Shop/drug.txt 里没有叫 ${want.name} 的药品`)
    }
    // `DrugPack.addDrug` 是**累加**，不是赋值。
    stock.count += want.count
  }
  return pack
}

/**
 * `DrugPanel.upDateDrugList()`：存货里 `numberGOT>0` 的那几种，按表序。
 *
 * ⚠️ 原版还有一个 `showDrug()`（"包里有东西就选中第一件、把按钮打开"），
 * **这里一个字都没抄，因为它是死代码** —— 全仓 88 个 `.java` 里只有
 * `DrugPanel.java` 自身那一处定义，零调用者。判据在 `drugPanel.test.ts`
 * 那条「`showDrug()` 至今零调用者」：哪天有人把它接上，这条会红，那时才
 * 该抄它。不登记的话「有意不抄」与「漏了」长得一样。
 */
export function visibleDrugs(pack: readonly DrugStock[]): DrugStock[] {
  return pack.filter((s) => s.count > 0)
}

/** 药品表里那一行。名字对不上一律抛 —— 存货的名字全部来自那张表。 */
function specOf(name: string): DrugSpec {
  const spec = DRUGS.find((d) => d.name === name)
  if (!spec) throw new Error(`药品表里没有 ${name}`)
  return spec
}

/**
 * `DrugPanel.isMoveIn()`，逐行照抄：
 *
 *     int originalY=y_start_point-32;
 *     upDateDrugList();
 *     if(list.size()!=0){
 *       for(int i=0;i<list.size();i++){
 *         if(currentX>x_start_point && currentX<x_start_point+130
 *            && currentY>originalY && currentY<(originalY+32)){
 *           currentDrug=list.get(i); y_button=originalY+5;
 *           use_button.isDraw=MenuButton.Yes;
 *         }
 *         originalY += 32;
 *       }
 *     }else{ use_button.isDraw=MenuButton.No; }
 *
 * 三件事照抄，三件都会悄悄地错：
 *
 * - **命中带从 `y_start_point-32` 起步**，也就是第 0 行的带子在那行基线**上面**
 *   一整行。差一行在真值里长得跟选对了一样（`MenuDriver.move` 的落点也是按
 *   这个算的，所以它自己核了一遍选中的名字）。
 * - **没命中任何一行时什么都不做** —— 既不清 `currentDrug`，也不关
 *   `use_button.isDraw`。移开鼠标不会取消选中。
 * - **`y_button=originalY+5` 是一句死代码**：按钮的 y 在 `new MenuButton(...)`
 *   那一刻就拷进对象里了，之后改这个字段一个像素都不动。所以这里不建模它 ——
 *   建了反倒像是"按钮会跟着行走"。
 */
export function drugCheckMoveIn(w: MenuWorld, p: MenuSubPanel): void {
  const d = p.drug
  if (!d) return
  const list = visibleDrugs(w.drugPack)
  if (list.length !== 0) {
    // 滚动位置（xl-6lo.13）：整排带子往上挪 `offset` 行，卷上去的行不参与。
    // `offset == 0` 时与原版逐字相同，而原版永远是 0。
    const offset = clampScroll(DRUG_LIST_VIEW, list.length, d.scroll)
    for (let i = offset; i < list.length; i++) {
      const originalY = rowBandTop(DRUG_LIST_VIEW, i, offset)
      if (
        p.currentX > DRUG_LIST_X &&
        p.currentX < DRUG_LIST_X + DRUG_HIT_W &&
        p.currentY > originalY &&
        p.currentY < originalY + DRUG_ROW_H
      ) {
        d.currentDrug = list[i]!.name
        d.useButton.isDraw = true
      }
    }
  } else {
    d.useButton.isDraw = false
  }
}

/**
 * 滚轮在物品页上转了一格。与装备页那个同形（`equipWheel`），**只认落在列表框
 * 里的那一下**。
 *
 * ⚠️ 原版的数据下它永远返回 `false`：六种药装得下 11 行的框。这不是死代码 ——
 * 药品表是从 `sources/Shop/drug.txt` 读的，那张表长出第 12 行的那天它就动了。
 */
export function drugWheel(w: MenuWorld, p: MenuSubPanel, x: number, y: number, rows: number): boolean {
  const d = p.drug
  if (!d) return false
  if (!inListBox(DRUG_LIST_VIEW, x, y)) return false
  const length = visibleDrugs(w.drugPack).length
  const before = clampScroll(DRUG_LIST_VIEW, length, d.scroll)
  d.scroll = clampScroll(DRUG_LIST_VIEW, length, before + rows)
  return d.scroll !== before
}

/** 在物品页滚动条的槽里按了一下。**这一下不在槽里时什么都不做**。 */
export function drugTrackPress(w: MenuWorld, p: MenuSubPanel, x: number, y: number): void {
  const d = p.drug
  if (!d) return
  const next = trackPress(DRUG_LIST_VIEW, visibleDrugs(w.drugPack).length, d.scroll, x, y)
  if (next !== null) d.scroll = next
}

/**
 * `DrugPanel.checkAllButtonMoveIn()` 里属于本页的那两句 ——
 * `use_button.isMoveIn(...)` 与 `isMoveIn()`。`scoll.checkMoveIn()` 那一句是
 * 四页共有的，留在 `step.ts` 里。
 */
export function drugPanelMoveIn(w: MenuWorld, p: MenuSubPanel): void {
  const d = p.drug
  if (!d) return
  moveInButton(d.useButton, p.currentX, p.currentY)
  drugCheckMoveIn(w, p)
}

/** `DrugPanel.checkAllButtonReleased()` 里属于本页的那一句。 */
export function drugPanelReleased(p: MenuSubPanel): void {
  const d = p.drug
  if (!d) return
  // ⚠️ `isRelesedButton` **不看 `isDraw`**（`MenuButton` 没覆写它）——
  // 按钮"不画"的时候松手照样会把 `isclicked` 清掉。照抄。
  releaseButton(d.useButton, p.currentX, p.currentY)
}

/**
 * `DrugPanel.checkAllButtonPressed()` 里属于本页的那一段：
 *
 *     use_button.isPressedButton(currentX, currentY);
 *     if(use_button.isclicked){
 *       if(currentDrug!=null){
 *         currentDrug.setNumberGOT(currentDrug.getNumberGOT()-1);
 *         playMusic(); addValue();
 *         if(currentDrug.getNumberGOT()==0){ currentDrug=null; use_button.isDraw=No; }
 *       }
 *       upDateDrugList();
 *     }
 *
 * ⚠️ **判的是 `isclicked` 这个字段，不是"这一下按在按钮上"**，而那个字段是
 * **粘的**：`isPressedButton` 没命中时只把贴图拨回常态，`isclicked` 留着不动
 * （`GameButton.java`）。于是"按下使用 → 在别处松手（也没命中）→ 再在别处
 * 按一下"会**再喝一瓶**。这是原版的缺陷，照抄（ADR-0001）。
 *
 * ⚠️ **数量先减、再算加血**，而 `playMusic()` 夹在两者中间 —— 音效读的是
 * 药性不是数量，所以次序今天看不出差别；照抄是因为将来 `music` 那一列要跟
 * 真值逐步对，一步之差就是一行之差。
 */
export function drugPanelPressed(w: MenuWorld, p: MenuSubPanel): void {
  const d = p.drug
  if (!d) return
  pressButton(d.useButton, p.currentX, p.currentY)
  if (!d.useButton.isclicked) return
  if (d.currentDrug !== null) {
    const stock = w.drugPack.find((s) => s.name === d.currentDrug)
    if (!stock) throw new Error(`存货里没有 ${d.currentDrug}`)
    const spec = specOf(stock.name)
    stock.count -= 1
    drugMusic(w, spec)
    drinkDrug(w.heroes, heroIndexOnScoll(p), spec)
    if (stock.count === 0) {
      d.currentDrug = null
      d.useButton.isDraw = false
    }
  }
  // `upDateDrugList()` —— 这一层的清单是现算的（`visibleDrugs`），没有要缓存的
  // 副本可更新。原版那句话的全部作用就是让 `list` 跟上 `drugList`。
}

/**
 * `DrugPanel.playMusic()`，四条**并列的 if**（不是 if-else），逐条照抄。
 * 加血与加蓝相等时**一声都不响** —— 四条的头一半都是严格大于。
 */
function drugMusic(w: MenuWorld, spec: DrugSpec): void {
  if (spec.addHp > spec.addMp && spec.addHp < 2100) w.music.push('命+.wav')
  if (spec.addHp > spec.addMp && spec.addHp >= 2100) w.music.push('命++.wav')
  if (spec.addMp > spec.addHp && spec.addMp < 2000) w.music.push('魔+.wav')
  if (spec.addMp > spec.addHp && spec.addMp >= 2000) w.music.push('魔++.wav')
}

/**
 * 卷轴上选中的那个人在 `w.heroes` 里的下标。⚠️ 读的是**物品页自己那个
 * `Scoll`** —— 四个子面板各建一个，`whichHero` 各走各的，拿当前页的那一个
 * 会在"在装备页换了人再回物品页"时喝错人。
 *
 * `addValue()` 的 switch 只有 1 / 2 / 4 三支（`drawValueBar` 那个多一支
 * `case 3: hero=hero3`，而 `hero3` 从头到尾是 `null`）。`ScollHero` 这个类型
 * 已经把取值域钉死成这三个，所以这里找不到人就是类型层漏了，抛。
 *
 * ⚠️ `SCOLL_HEROES` 与 `MENU_HERO_ORDER` 是**同一个次序**（张 / 陆 / 玉），
 * 靠下标对上 —— 而"同一个次序"这件事自己也是判据（`drugPanel.test.ts`，
 * `drawList.test.ts` 里也有一条）。两张表的键名不是一套（`wen` vs `yu`），
 * 按名字对会把后两个对调。
 *
 * 绘制层的血条读的是同一个人，所以它也调这个函数（原先那边抄了一份一模一样
 * 的四行，连异常文案都一样 —— /code-review 的标准轴提的 Duplicated Code）。
 */
export function heroIndexOnScoll(p: MenuSubPanel): number {
  const which = p.scoll?.whichHero
  const index = SCOLL_HEROES.findIndex((h) => h.hero === which)
  if (index < 0) throw new Error(`物品页的卷轴上没有 ${which} 号`)
  return index
}

/** 同上，顺手把人取出来。取不到就是 `heroes` 与卷轴不同长，抛。 */
export function heroOnScoll(w: MenuWorld, p: MenuSubPanel): MenuHero {
  const index = heroIndexOnScoll(p)
  const hero = w.heroes[index]
  if (!hero) throw new Error(`队伍里没有第 ${index} 个人`)
  return hero
}

/**
 * `DrugPanel.addValue()`：喝下去。**整个方法**，三句 `refreshValue()` 在内：
 *
 *     hero1.refreshValue(); hero2.refreshValue(); hero4.refreshValue();
 *     h=hero.getHp()+currentDrug.getAddHp();
 *     m=hero.getMp()+currentDrug.getAddMp();
 *     if(h>=hero.getHpMax()) hero.setHp(hero.getHpMax()); else hero.setHp(h);
 *     if(m>=hero.getMpMax()) hero.setMp(hero.getMpMax()); else hero.setMp(m);
 *
 * ⚠️ **刷的是三个人，不是喝药那一个** —— 所以这个函数收的是整队加一个下标，
 * 不是一个人。今天三句全是空操作（属性一个字节都没变），而装备页
 * （xl-6lo.9）一旦在同一个世界里改了属性，"只刷喝药那一个"与"三个都刷"
 * 就是两组数了，另外两人会少这一次夹紧。第一版就是只刷了一个 ——
 * /code-review 的规格轴找回来的。
 */
export function drinkDrug(heroes: MenuHero[], index: number, spec: DrugSpec): void {
  for (const h of heroes) refreshMenuHero(h)
  const hero = heroes[index]
  if (!hero) throw new Error(`队伍里没有第 ${index} 个人`)
  const h = hero.hp + spec.addHp
  const m = hero.mp + spec.addMp
  hero.hp = h >= hero.hpMax ? hero.hpMax : h
  hero.mp = m >= hero.mpMax ? hero.mpMax : m
}

/**
 * `Hero.refreshValue()` 在菜单这一层记得到的那一半：四个派生值重算，再把
 * hp / mp 夹回上限。`battle/units.ts` 那个 `refreshValue` 收的是战斗单位
 * （字段名是原版拼错的 `sprit`，还带 hurt / speed 那几个菜单不记的），
 * 所以这里按 `MenuHero` 的字段名转一道。
 */
export function refreshMenuHero(hero: MenuHero): void {
  const d = derive({
    physicalPower: hero.physicalPower,
    agile: hero.agile,
    strength: hero.strength,
    sprit: hero.spirit,
  })
  hero.hpMax = d.hpMax
  hero.mpMax = d.mpMax
  hero.defense = d.defense
  hero.skillDefense = d.skillDefense
  if (hero.hp >= hero.hpMax) hero.hp = hero.hpMax
  if (hero.mp >= hero.mpMax) hero.mp = hero.mpMax
}
