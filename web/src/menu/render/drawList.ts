import type { AssetId } from '../../assets/ids'
import { HEAD_POS, SCOLL_X, SCOLL_Y, TABS, TAB_Y } from '../layout'
import {
  MENU_BACKGROUND,
  COMMAND_BAR,
  LEVEL_LABEL,
  funcButtonId,
  headId,
  mouseId,
  scollId,
  tabId,
  useButtonId,
} from './assets'
import { FUNC_MAIN_ORDER, FUNC_SUB_ORDER } from '../funcButtons'
import { SCOLL_HEROES } from '../types'
import { DRUG_LIST_X, DRUG_LIST_Y, DRUG_ROW_H, heroIndexOnScoll, visibleDrugs } from '../drugPanel'
import { DRUGS } from '../../battle/drugs'
import type { MenuSubPanel, MenuWorld } from '../types'

/**
 * **原版 `FatherPanel.paint()` 那六层，摊成一份有序的绘制清单。**
 *
 * 这一层是纯函数：世界 → 一串「把哪张图贴在哪」。它**不碰 Pixi、不碰 DOM**，
 * 所以顺序、坐标、贴哪一张图全都能在 `pnpm test` 里逐条断言。真实像素由跨端
 * 逐帧比对兜底 —— 而 **menu 那条流水线今天还没接上**（`replay/implemented.ts`
 * 的 `IMPLEMENTED_DRIVERS` 里没有 menu），接线是 **xl-6lo.14**。也就是说
 * 这一层今天只有"顺序与坐标"这一半判据，像素那一半还欠着。
 *
 * ## 六层的次序就是 z 序
 *
 *     bufferedGraphics.drawImage(backgroundImage, 0, 0, this);   ← background
 *     drawSpecialImage(bufferedGraphics);                        ← special（各页自己的）
 *     menuPanel.command.drawCommand(bufferedGraphics);           ← command
 *     if (scoll != null) scoll.drawScoll(bufferedGraphics);      ← scoll
 *     drawThisPanel(bufferedGraphics);                           ← page（各页自己的）
 *     mouse.drawMouse(bufferedGraphics);                         ← mouse
 *
 * `special` 层这一层今天一条 op 都不出。⚠️ **四页里只有三页的
 * `drawSpecialImage()` 真是空的**（物品 / 装备 / 奇术）；`FuncPanel` 那个不是
 * —— 它贴 `sources/菜单/主人公4人2.png`，而**那个文件根本不在那个路径下**
 * （实际在 `天书/` 下，原版已知缺陷 **xl-a7m**），所以原版自己也画不出来。
 * 两件事分开记：三页是真空的，天书页那一张欠在 xl-a7m 上。
 * `page` 层里**物品页已经画上了**
 * （xl-6lo.10），装备页与奇术页仍空着，归 xl-6lo.9 / .11。空着而不是抛 ——
 * 骨架那一票的验收就是"四页的骨架画得出来"，抛会让它一帧都画不出来。
 * ⚠️ 代价是「这一页还没做」与「这一页本来就没有内容」在画面上长得一样，
 * 而分开它们的是逐帧比对那张表（xl-6lo.14 接）。
 *
 * **天书页那一层是例外，必须画**：出菜单唯一那条路（「返回」）就在上面，而
 * 菜单里的 ESC 是死代码 —— 不画等于玩家出不去。`func` 那一组的**状态**仍然
 * 挂在 xl-6lo.12 上（子菜单的展开收起没做），画的是骨架那一半。
 */

export type MenuLayer = 'background' | 'special' | 'command' | 'scoll' | 'page' | 'mouse'

export const MENU_LAYERS: readonly MenuLayer[] = [
  'background',
  'special',
  'command',
  'scoll',
  'page',
  'mouse',
]

export type MenuDrawOp =
  /** `g.drawImage(img, x, y, panel)` —— 按原尺寸贴。 */
  | { readonly kind: 'image'; readonly layer: MenuLayer; readonly id: AssetId; readonly x: number; readonly y: number }
  /** `g.drawString(s, x, y)` —— **x/y 是基线**，不是行盒左上角。 */
  | {
      readonly kind: 'text'
      readonly layer: MenuLayer
      readonly text: string
      readonly x: number
      readonly y: number
      /** `new Font("文鼎粗钢笔行楷", Font.BOLD, size)` 里那个字号。 */
      readonly size: number
      readonly color: string
    }

/** `Command.drawCommand` 里那两个常量：贴图的 y 与那行字的基线 y。 */
const TASK_TEXT_X = 10
const TASK_TEXT_Y = TAB_Y - 13
const TASK_FONT_SIZE = 25
const TASK_COLOR = '#ffffff'

/**
 * `DrugPanel` 里那几个绘制常量（几何那几个在 `drugPanel.ts`，与状态层共用）。
 *
 * ⚠️ **字号 24 那一句在 `if(currentDrug!=null)` 里面**：没选中药的时候，
 * 那三行说明文字沿用上面清单的 26 号字。原版就是这样，两个字号必须分开走。
 */
const DRUG_LIST_FONT_SIZE = 26
const DRUG_COUNT_DX = 180
const DRUG_TEXT_COLOR = '#ffffff'
const DRUG_MESSAGE_X = 510
const DRUG_MESSAGE_Y = 586
const DRUG_MESSAGE2_DX = 105
const DRUG_MESSAGE3_DX = 265
const DRUG_MESSAGE_FONT_SIZE = 24
/** `x_value` / `y_value`，第二行 `y_value+45`。`Color.blue`、20 号字。 */
const VALUE_BAR_X = 107
const VALUE_BAR_Y = 320
const VALUE_BAR_DY = 45
const VALUE_BAR_FONT_SIZE = 20
const VALUE_BAR_COLOR = '#0000ff'

/** `Scoll.drawScoll` 里那几个：`x_level=x_head+90`、`y_level=y_scoll+70`。 */
const LEVEL_X = HEAD_POS[0]!.x + 90
const LEVEL_Y = SCOLL_Y + 70
const LEVEL_NUM_X = LEVEL_X + 30
const LEVEL_NUM_Y = LEVEL_Y + 62
const LEVEL_FONT_SIZE = 30
const LEVEL_COLOR = '#ff0000'

/**
 * 画一帧。
 *
 * `task` 是 `tools.Reader.task`（顶栏那行「当前任务:」），**由调用方喂** ——
 * 原版读的是个全局，而这一层不该去认识场景。`null` 走原版的 else 分支，
 * 也就是「无」。
 */
export function menuDrawList(w: MenuWorld, task: string | null = null): MenuDrawOp[] {
  const ops: MenuDrawOp[] = []
  const panel = w.panels[w.panel]

  ops.push({ kind: 'image', layer: 'background', id: MENU_BACKGROUND[w.panel], x: 0, y: 0 })

  // `drawSpecialImage` —— 四页各自的。三页真是空的，天书页那一张是 xl-a7m
  // 的缺陷（见文件头注）。

  // `Command.drawCommand`
  ops.push({ kind: 'image', layer: 'command', id: COMMAND_BAR, x: 0, y: TAB_Y })
  ops.push({
    kind: 'text',
    layer: 'command',
    text: `当前任务:${task ?? '无'}`,
    x: TASK_TEXT_X,
    y: TASK_TEXT_Y,
    size: TASK_FONT_SIZE,
    color: TASK_COLOR,
  })
  for (const tab of TABS) {
    const button = w.tabs[tab.key]
    if (!button.isDraw) continue
    ops.push({ kind: 'image', layer: 'command', id: tabId(tab.key, button.image), x: button.x, y: button.y })
  }

  // `Scoll.drawScoll` —— 天书页没有卷轴，那一层整个没有。
  if (panel.scoll) {
    const s = panel.scoll
    ops.push({ kind: 'image', layer: 'scoll', id: scollId(s.whichHero), x: SCOLL_X, y: SCOLL_Y })
    ops.push({ kind: 'image', layer: 'scoll', id: LEVEL_LABEL, x: LEVEL_X, y: LEVEL_Y })
    ops.push({
      kind: 'text',
      layer: 'scoll',
      text: String(scollLevel(w, s)),
      x: LEVEL_NUM_X,
      y: LEVEL_NUM_Y,
      size: LEVEL_FONT_SIZE,
      color: LEVEL_COLOR,
    })
    for (const { hero, field, party } of SCOLL_HEROES) {
      const button = s[field]
      // ⚠️ `drawScoll()` 自己会把 `isDraw` 打开（`if(SaveAndLoad.lu){hero2.isDraw=Yes;}`
      // 那三句）—— 也就是说**原版的绘制有副作用**。这一层是纯函数，所以把那
      // 三句折算成"或上出战名单"：每一帧的结果与原版相同，而状态层不会被绘制
      // 偷偷改掉。
      if (!button.isDraw && !w.party[party]) continue
      ops.push({ kind: 'image', layer: 'scoll', id: headId(hero, button.image), x: button.x, y: button.y })
    }
  }

  // `drawThisPanel` —— 四页各自的。
  //
  // 装备页与奇术页仍空着（归 xl-6lo.9 / .11）；**天书页不能空**：出菜单唯一
  // 那条路（「返回」）就是这一层画出来的，空着的话 ESC 又是死代码，玩家一点
  // 出去的办法都没有。所以那一页照 `FuncButtons.drawFuncButtons()` 画：
  // 先五颗主按钮，再四组子按钮。物品页见下面的 `drawDrugPanel`。
  if (panel.drug) drawDrugPanel(ops, w, panel)
  if (panel.funcButtons) {
    const fb = panel.funcButtons
    for (const key of FUNC_MAIN_ORDER) {
      const b = fb.main[key]
      if (!b.isDraw) continue
      ops.push({ kind: 'image', layer: 'page', id: funcButtonId(key, b.image), x: b.x, y: b.y })
    }
    for (const key of FUNC_SUB_ORDER) {
      const b = fb.sub[key]
      if (!b.isDraw) continue
      ops.push({ kind: 'image', layer: 'page', id: funcButtonId(key, b.image), x: b.x, y: b.y })
    }
  }

  ops.push({ kind: 'image', layer: 'mouse', id: mouseId(panel.mouse.frame), x: panel.mouse.x, y: panel.mouse.y })
  return ops
}

/**
 * `DrugPanel.drawThisPanel()`，三句、按序：
 *
 *     use_button.drawButton(g);
 *     drawEquipment(g);
 *     drawValueBar(g);
 *
 * ⚠️ **少一样东西：选中那瓶药的插图。** 原版 `drawEquipment` 里那句
 * `g.drawImage(currentDrug.getPicture(), x_picture, y_picture, this)` 取的是
 * `sources/Shop/药品/回复类/<名字>.png` —— **那是商店素材，不在 `sources/菜单/`
 * 下**，整个烘焙管线（`menuAssets.ts` 那条边界、`bake.ts` 的现扫分母、
 * `bakeStamp` 的指纹）都以 `sources/菜单/` 为根。给它开一条新的素材根是另一
 * 张票的活（**xl-6lo.15**），不是顺手加一行。这里**不画一张占位图** ——
 * 占位图会让"图没接上"与"原版这里本来就是空的"长得一样。
 */
function drawDrugPanel(ops: MenuDrawOp[], w: MenuWorld, panel: MenuSubPanel): void {
  const d = panel.drug
  if (!d) return

  // `use_button.drawButton(g)` —— `MenuButton.drawButton` 里 `isDraw==No` 那
  // 一支是个空的 if 块，也就是不画。
  if (d.useButton.isDraw) {
    ops.push({
      kind: 'image',
      layer: 'page',
      id: useButtonId(d.useButton.image),
      x: d.useButton.x,
      y: d.useButton.y,
    })
  }

  // `drawEquipment`：清单。名字画在 x，数量画在 x+180，每行下移 32。
  let y = DRUG_LIST_Y
  for (const stock of visibleDrugs(w.drugPack)) {
    ops.push({
      kind: 'text',
      layer: 'page',
      text: stock.name,
      x: DRUG_LIST_X,
      y,
      size: DRUG_LIST_FONT_SIZE,
      color: DRUG_TEXT_COLOR,
    })
    ops.push({
      kind: 'text',
      layer: 'page',
      text: String(stock.count),
      x: DRUG_LIST_X + DRUG_COUNT_DX,
      y,
      size: DRUG_LIST_FONT_SIZE,
      color: DRUG_TEXT_COLOR,
    })
    y += DRUG_ROW_H
  }

  // 三行说明。⚠️ 字号跟着"有没有选中"走，见上面那两个常量的注释。
  const spec = d.currentDrug === null ? null : DRUGS.find((x) => x.name === d.currentDrug)
  if (d.currentDrug !== null && !spec) throw new Error(`药品表里没有 ${d.currentDrug}`)
  const messages = spec
    ? [spec.name, `: 生命 +${spec.addHp}`, `魔法 +${spec.addMp}`]
    : ['没药了...', '快去药店买点吧~', '']
  const size = spec ? DRUG_MESSAGE_FONT_SIZE : DRUG_LIST_FONT_SIZE
  const xs = [DRUG_MESSAGE_X, DRUG_MESSAGE_X + DRUG_MESSAGE2_DX, DRUG_MESSAGE_X + DRUG_MESSAGE3_DX]
  for (const [i, text] of messages.entries()) {
    ops.push({
      kind: 'text',
      layer: 'page',
      text,
      x: xs[i]!,
      y: DRUG_MESSAGE_Y,
      size,
      color: DRUG_TEXT_COLOR,
    })
  }

  // `drawValueBar`：卷轴上选中那个人的血与灵力。⚠️ 读的是**物品页自己那个
  // `Scoll`**，与状态层同一个理由 —— 所以这里调的就是状态层那个函数，不再
  // 抄一份（/code-review 的标准轴：Duplicated Code）。
  //
  // ⚠️ **那三句 `hero1/2/4.refreshValue()` 这一层有意不抄**：原版的
  // `drawValueBar()` 头上有它们，也就是**画一帧会改状态**。这一层是纯函数
  // （`drawScoll` 那个 isDraw 副作用也是同样处理的，见上面卷轴那一段），
  // 而喝药那条路上的三次刷新已经在 `drinkDrug` 里了。
  const index = heroIndexOnScoll(panel)
  const hero = w.heroes[index]
  if (!hero) throw new Error(`队伍里没有第 ${index} 个人`)
  for (const [i, text] of [
    `生命值:${hero.hp}/${hero.hpMax}`,
    `魔法值:${hero.mp}/${hero.mpMax}`,
  ].entries()) {
    ops.push({
      kind: 'text',
      layer: 'page',
      text,
      x: VALUE_BAR_X,
      y: VALUE_BAR_Y + i * VALUE_BAR_DY,
      size: VALUE_BAR_FONT_SIZE,
      color: VALUE_BAR_COLOR,
    })
  }
}

/**
 * 卷轴上那个等级数字。
 *
 * ⚠️ **张小凡在队里的话，这里永远是他的等级** —— 换成谁都一样。
 * `checkPressed()` 切人时把 `level` 设成那个人的，可紧接着的
 * `drawScoll()` 第一句就是 `if(SaveAndLoad.zhang){ … level=""+ZhangXiaoFan.level; }`
 * 又把它盖回去。原版就是这么坏的（ADR-0001：照抄），别"顺手修好"。
 */
function scollLevel(w: MenuWorld, scoll: NonNullable<MenuSubPanel['scoll']>): number {
  const index = SCOLL_HEROES.findIndex((h) => h.hero === scoll.whichHero)
  if (index < 0) throw new Error(`卷轴上没有 ${scoll.whichHero} 号`)
  // `MENU_HERO_ORDER` 与 `SCOLL_HEROES` 是同一个次序（张 / 陆 / 玉），
  // 判据在 `drawList.test.ts`。
  return w.heroes[w.party.zhang ? 0 : index]!.level
}
