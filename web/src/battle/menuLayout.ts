/**
 * 技能菜单与药品菜单那几颗按钮的几何（xl-rh9.11）。
 *
 * 两个菜单的按钮是同一套尺寸 —— 原版 `SkillMenu.addButton` 与
 * `DrugMenu.addButton` 里那两行 `new GameButton(395, 226+i*10, 215, 28, …)`
 * 一字不差（`i` 每次跳 3，所以步距是 30），`SkillMenu.checkRound` 里现建的
 * 返回按钮也是这一套。
 *
 * **单独拿出来是因为它被三处读**：`world.ts` 建菜单、`step.ts` 建返回按钮、
 * `step.ts` 判介绍行。抄三份的话，改一个数要改五处，而漏掉一处的表现是
 * 「有一颗按钮画在别的地方」——画面上仍然是一排整齐的按钮。
 */
export const MENU_BUTTON_X = 395
export const MENU_BUTTON_TOP = 226
export const MENU_BUTTON_STRIDE = 30
export const MENU_BUTTON_W = 215
export const MENU_BUTTON_H = 28

/** 第 `index` 颗按钮的纵坐标（0 基）。返回按钮排在最后一颗的下一格。 */
export function menuButtonY(index: number): number {
  return MENU_BUTTON_TOP + MENU_BUTTON_STRIDE * index
}

/**
 * 菜单里那一列介绍区的命中判定，逐字照抄
 * `if(bp.currentX>395 && bp.currentX<610 && bp.currentY>226+i*30 && bp.currentY<226+(i+1)*30)`。
 *
 * ⚠️ **它不是按钮的命中框。** 按钮那个（`hitsButton`）左偏 15、上偏 6；
 * 这一个不偏，右边界是 `395+215=610`（也就是按钮的右边缘），四边都是严格
 * 不等号。两个矩形差 15 个像素，用错一个的表现是「介绍图在边上时出不来」。
 *
 * **这 15 个像素今天观测不到**（xl-rh9.11 篡改 T20：把右边界写成
 * `395+215-15`，逐字段比对全绿）。理由与 xl-rh9.7 记的那条一模一样：导出器
 * 点的是**命中框的中心** `395-15+215/2 = 487`，它离 595 与 610 都很远，
 * 两个矩形同时包住它。要观测到它，得有一条剧本点在按钮的右边缘上。
 */
export function inIntroRow(x: number, y: number, index: number): boolean {
  return (
    x > MENU_BUTTON_X &&
    x < MENU_BUTTON_X + MENU_BUTTON_W &&
    y > menuButtonY(index) &&
    y < menuButtonY(index + 1)
  )
}
