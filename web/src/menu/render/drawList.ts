import type { AssetId } from '../../assets/ids'
import { HEAD_POS, SCOLL_X, SCOLL_Y, TABS, TAB_Y } from '../layout'
import { MENU_BACKGROUND, COMMAND_BAR, LEVEL_LABEL, headId, mouseId, scollId, tabId } from './assets'
import type { MenuButtonState, MenuSubPanel, MenuWorld } from '../types'

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
 * `special` 与 `page` 两层**这一票是空的**：那是四页各自的内容，归 xl-6lo.9 /
 * .10 / .11 / .12。空着而不是抛 —— 骨架这一票的验收就是"四页的骨架画得出来"，
 * 抛会让它一帧都画不出来。⚠️ 代价是「这一页还没做」与「这一页本来就没有内容」
 * 在画面上长得一样，而分开它们的是逐帧比对那张表（xl-6lo.14 接）。
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

  // `drawSpecialImage` —— 四页各自的，骨架这一票空着（见文件头注）。

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
      text: String(scollLevel(w, panel)),
      x: LEVEL_NUM_X,
      y: LEVEL_NUM_Y,
      size: LEVEL_FONT_SIZE,
      color: LEVEL_COLOR,
    })
    for (const { hero, button } of headButtons(s)) {
      if (!drawnHead(w, hero, button)) continue
      ops.push({ kind: 'image', layer: 'scoll', id: headId(hero, button.image), x: button.x, y: button.y })
    }
  }

  // `drawThisPanel` —— 四页各自的，骨架这一票空着（见文件头注）。

  ops.push({ kind: 'image', layer: 'mouse', id: mouseId(panel.mouse.frame), x: panel.mouse.x, y: panel.mouse.y })
  return ops
}

function headButtons(s: NonNullable<MenuSubPanel['scoll']>) {
  return [
    { hero: 1, button: s.hero1 },
    { hero: 2, button: s.hero2 },
    { hero: 4, button: s.hero4 },
  ]
}

/**
 * 一颗头像这一帧画不画得出来。
 *
 * ⚠️ **`drawScoll()` 自己会把 `isDraw` 打开**（`if(SaveAndLoad.lu){hero2.isDraw=Yes;}`
 * 那三句）—— 也就是说原版的**绘制有副作用**。这一层是纯函数，所以把那三句
 * 折算成"或上出战名单"：结果与原版每一帧相同，而状态层不会被绘制偷偷改掉。
 */
function drawnHead(w: MenuWorld, hero: number, button: MenuButtonState): boolean {
  if (button.isDraw) return true
  if (hero === 1) return w.party.zhang
  if (hero === 2) return w.party.lu
  return w.party.wen
}

/**
 * 卷轴上那个等级数字。
 *
 * ⚠️ **张小凡在队里的话，这里永远是他的等级** —— 换成谁都一样。
 * `checkPressed()` 切人时把 `level` 设成那个人的，可紧接着的
 * `drawScoll()` 第一句就是 `if(SaveAndLoad.zhang){ … level=""+ZhangXiaoFan.level; }`
 * 又把它盖回去。原版就是这么坏的（ADR-0001：照抄），别"顺手修好"。
 */
function scollLevel(w: MenuWorld, panel: MenuSubPanel): number {
  const byHero: Record<number, number> = { 1: 0, 2: 1, 4: 2 }
  const index = byHero[panel.scoll?.whichHero ?? 1] ?? 0
  const shown = w.party.zhang ? 0 : index
  return w.heroes[shown]!.level
}
