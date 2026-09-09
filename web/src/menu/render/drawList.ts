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
import { equipDrawOps } from './equipDraw'
import { FUNC_MAIN_ORDER, FUNC_SUB_ORDER } from '../funcButtons'
import { MAGIC_HEROES } from '../magic'
import {
  MAGIC_SKILL_DESCRIPTIONS,
  magicAnimationFrameId,
  magicSkillButtonId,
} from './magicSkills'
import { SCOLL_HEROES } from '../types'
import {
  DRUG_LIST_VIEW,
  DRUG_LIST_X,
  heroIndexOnScoll,
  visibleDrugs,
} from '../drugPanel'
import { rowBaseline, visibleRange } from '../scroll'
import { scrollbarOps } from './scrollbar'
import { DRUGS } from '../../battle/drugs'
import type { MenuSubPanel, MenuWorld } from '../types'

/**
 * **原版 `FatherPanel.paint()` 那六层，摊成一份有序的绘制清单。**
 *
 * 这一层是纯函数：世界 → 一串「把哪张图贴在哪」。它**不碰 Pixi、不碰 DOM**，
 * 所以顺序、坐标、贴哪一张图全都能在 `pnpm test` 里逐条断言。真实像素由跨端
 * 逐帧比对兜底 —— **menu 那条流水线已经接上了**（xl-6lo.14：`menu` 进了
 * `replay/implemented.ts` 的 `IMPLEMENTED_DRIVERS`，五条 menu 剧本在
 * `compare/expected.ts` 里各有一份实测的分区表态）。也就是说这一层现在两半
 * 判据都有：顺序与坐标在 `pnpm test` 里，像素在缺口区之外**逐像素**相等。
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
 * `page` 层**四页现在都画上了**：物品 xl-6lo.10 / 装备 xl-6lo.9 /
 * 奇术 xl-6lo.11 / 天书 xl-6lo.8+.12。
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
  /**
   * 一块纯色矩形。**原版一条这样的绘制都没有** —— 它是给滚动条用的
   * （xl-6lo.13），原版没有滚动条。所以看见它就等于"这一块是 web 侧加的"，
   * 逐帧比对接上以后它**真的单独表态了**（xl-6lo.14）：`menu-scroll` 的
   * `scrollbar` 那个缺口区，实测 (770,155)-(777,506)。
   */
  | {
      readonly kind: 'rect'
      readonly layer: MenuLayer
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      readonly color: string
      /** 0..1。槽是半透的，滑块是实的。 */
      readonly alpha: number
    }
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
  // 四页现在都画得出来：物品见下面 `drawDrugPanel`、奇术见 `magicOps`、
  // 装备由 `equipDraw.ts` 接（xl-6lo.9）；**天书页尤其不能空**：出菜单唯一
  // 那条路（「返回」）就是这一层画出来的，空着的话 ESC 又是死代码，玩家一点
  // 出去的办法都没有。所以那一页照 `FuncButtons.drawFuncButtons()` 画：
  // 先五颗主按钮，再四组子按钮。
  if (panel.drug) drawDrugPanel(ops, w, panel)
  if (panel.magic) ops.push(...magicOps(panel.magic))
  if (panel.equip && panel.scoll) {
    ops.push(...equipDrawOps(panel.equip, w.heroes, panel.scoll.whichHero))
  }
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
  //
  // ⚠️ **只画滚动窗口里的那几行** —— 原版不裁剪，一路画到框外去
  // （xl-6lo.13，理由见 `menu/scroll.ts` 的文件头注）。今天的药品表只有 6 种、
  // 框里放得下 11 行，所以这条裁剪在原版数据下**裁不掉任何一行**，而滚动条
  // 整个不画：这正是「装得下的那一侧」，判据在 `scroll.test.ts`。
  const drugs = visibleDrugs(w.drugPack)
  const window = visibleRange(DRUG_LIST_VIEW, drugs.length, d.scroll)
  for (let i = window.from; i < window.to; i++) {
    const stock = drugs[i]!
    const y = rowBaseline(DRUG_LIST_VIEW, i, window.from)
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
  }
  ops.push(...scrollbarOps(DRUG_LIST_VIEW, drugs.length, d.scroll))

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

/**
 * 奇术页那条动画的几何与字体。**四个数在 `MagicPanel.addMagicAnimation()` 的
 * 局部变量里（`x`/`y`/`a`/`b`/`vgap`），三个在 `MagicAnimation
 * .drawMagicAnimation()` 里（字号 27、第二行 +34、白色）** —— 两处，不是一处。
 *
 * 导出是为了给判据用：`drawList.test.ts` 从 GBK 源码里把这七个现读出来对。
 * 不导出的话期望值那一侧只能重抄一遍同样的字面量，**两侧都是这一次的转写，
 * 抄错了两边一起错**（/code-review 的 Standards 轴提的；顶栏那行字的判据
 * 一直是这么写的，这里漏了）。
 */
export const MAGIC_LAYOUT = {
  /** `new MagicAnimation(..., x, y, ...)` 的 `int x=70+32,y=10;` —— 动画贴图的左上角。 */
  animX: 70 + 32,
  animY: 10,
  /** `a` —— 说明两行的 x（`drawString` 的起点）。 */
  textX: 538,
  /** `b` —— 第一招说明的基线 y。 */
  textY: 202,
  /** `vgap` —— 招与招之间说明差多少。 */
  textVgap: 64,
  /** `y_discription+34` —— 第二行比第一行低多少。 */
  textLine: 34,
  /** `new Font("文鼎粗钢笔行楷", Font.BOLD, 27)`。 */
  fontSize: 27,
  /** `g.setColor(Color.white)`。 */
  color: '#ffffff',
} as const

/**
 * `MagicPanel.drawThisPanel()` 的后半段：**先十五颗按钮，再那条动画**。
 *
 * 前半段（那个 `switch(whichHero)` 现设 `isDraw`）**不在这里** —— 它改的是
 * 真值记着的状态，已经跑在状态层的 paint 相里（`menu/step.ts`）。这一层只读
 * `isDraw`，所以它仍然是纯函数。
 *
 * ⚠️ **说明那两行画在动画里，不是画在按钮上**：原版 `drawMagicAnimation()`
 * 先 `drawString` 两行再 `drawImage`，三条都挂在 `currentAnimation` 上。
 * 也就是说**没有动画在放时，说明文字一个字都不画**，而不是"画当前选中那一招
 * 的说明"。两者在有动画时长得一模一样。
 *
 * ⚠️ 说明的落点由**招号**决定（`b + (招号-1)*64`），不是由"第几颗按钮亮着"
 * 决定 —— 张小凡菜单上只有一颗按钮，点它出来的说明照样画在第一行的位置上。
 */
function magicOps(magic: NonNullable<MenuSubPanel['magic']>): MenuDrawOp[] {
  const ops: MenuDrawOp[] = []
  for (const { hero } of MAGIC_HEROES) {
    magic.buttons[hero].forEach((b, i) => {
      if (!b.isDraw) return
      ops.push({
        kind: 'image',
        layer: 'page',
        id: magicSkillButtonId(hero, i + 1, b.image),
        x: b.x,
        y: b.y,
      })
    })
  }
  const anim = magic.current
  if (!anim) return ops
  const lines = MAGIC_SKILL_DESCRIPTIONS[anim.hero][anim.skill - 1]
  if (!lines) throw new Error(`${anim.hero} 号没有第 ${anim.skill} 招的说明`)
  const y = MAGIC_LAYOUT.textY + (anim.skill - 1) * MAGIC_LAYOUT.textVgap
  lines.forEach((text, line) => {
    ops.push({
      kind: 'text',
      layer: 'page',
      text,
      x: MAGIC_LAYOUT.textX,
      y: y + line * MAGIC_LAYOUT.textLine,
      size: MAGIC_LAYOUT.fontSize,
      color: MAGIC_LAYOUT.color,
    })
  })
  ops.push({
    kind: 'image',
    layer: 'page',
    id: magicAnimationFrameId(anim.hero, anim.skill, anim.code),
    x: MAGIC_LAYOUT.animX,
    y: MAGIC_LAYOUT.animY,
  })
  return ops
}
