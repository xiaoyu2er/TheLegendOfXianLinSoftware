import { menuButton, moveInButton, pressButton, releaseButton } from './buttons'
import type { PartyKey } from '../battle/units'
import type { MenuHero } from './heroes'
import type { MenuButtonState, ScollHero } from './types'

/**
 * 奇术页（`menu.MagicPanel` + `menu.MagicAnimation`）。
 *
 * 这一页在状态层上只有两样东西，而两样都会**悄悄地错**：
 *
 * 1. **哪几颗技能按钮画得出来**（真值 `magic.visible`）。它由
 *    `drawThisPanel()` **在绘制里现设**，按的是当前卷轴角色那个 `skillNumber`
 *    static 字段 —— 不是等级。等级高的角色技能按钮**一颗都不会多**。
 * 2. **技能动画走到第几帧**（真值 `magic.animation`）。它挂在
 *    `FatherPanel.run()` 那条循环上，**不管有没有输入都在走**，而且走完末帧
 *    之后会把帧号拨回起点、把动画整个撤下。
 *
 * ## 三处照抄的怪相
 *
 * - **开局就有一条动画在放，而且是文敏的第 5 技能。**`addMagicAnimation()`
 *   用同一个字段 `currentAnimation` 当临时变量建了 15 条动画，循环结束时它停
 *   在最后建的那一条上（`(4,5,41)`）。真值第 0 帧写着
 *   `{"hero":4,"skill":5,...,"length":41}` 就是这么来的 —— 不是"默认选中"，
 *   是一个没清掉的临时变量。
 * - **`drawThisPanel()` 那两个循环重叠了一格。**
 *   `for(i=0;i<skillNumber;i++) isDraw=1;` 紧接着
 *   `for(i=skillNumber-1;i<5;i++) isDraw=0;` —— 第二个循环从
 *   `skillNumber-1` 起，把第一个循环刚打开的最后一颗又关掉了。所以
 *   `skillNumber=2` 的张小凡在菜单上只有**一颗**按钮。这是原版的缺陷，
 *   ADR-0001 说照抄。
 * - **宋大仁那五颗按钮建了但 `isDraw=0`，而且他的动画一条都没建。**
 *   `buttonList3` 在 `addMagicButton()` 末尾被整组关掉，`song_animation`
 *   在 `addMagicAnimation()` 里一条都没 add（那个 `ArrayList` 是空的）。
 *   卷轴上也到不了 3 号（`types.ts` 的 `ScollHero`），所以这一层**不建
 *   宋大仁**：建出来的东西一帧都画不出、一次都点不着，而"建了但永远不动"
 *   与"根本没建"在真值里长得一模一样。真值 `visible` 记的也正是
 *   `buttonList1 / 2 / 4` 三组。
 */

/** `addMagicButton()` 开头那五个局部常量。 */
const X = 320 + 12
const Y = 180
const W = 220
const H = 50
const VGAP = 14

/** 每个人五颗按钮。第 i 颗的左上角 y。 */
export function magicButtonY(index: number): number {
  return Y + index * (H + VGAP)
}

export const MAGIC_BUTTON_X = X
export const MAGIC_BUTTON_W = W
export const MAGIC_BUTTON_H = H
/** 每个人恒有五颗按钮 —— `addMagicButton()` 里四组各写了五段，与等级无关。 */
export const MAGIC_BUTTON_COUNT = 5

/**
 * 奇术页认得的三个人：**卷轴编号 → 队伍键 → 真值 `magic.visible` 的键**。
 *
 * 三套写法又是三套（`ScollHero` 的 1/2/4、`SKILL_NUMBER` 的 zhang/lu/yu、
 * 真值的 zhangxiaofan/luxueqi/yujie），与 `types.ts` 的 `SCOLL_HEROES` 同理：
 * 散着写就要在四五个地方各答一遍"二号是陆还是玉"。
 *
 * `music` 那一列的三声也在这里 —— `checkAllButtonPressed` 里三个循环各带一句
 * `MusicReader.readmusic(...)`。⚠️ **玉洁那一声叫「文敏攻击(2).wav」**，
 * 和她在真值里的名字 `yujie` 对不上，照抄。
 */
export const MAGIC_HEROES: readonly {
  hero: ScollHero
  party: PartyKey
  /** 真值 `magic.visible` 里的键，与 `heroes[]` 那一列同名。 */
  name: string
  /** 点中技能按钮时出的那一声。 */
  sound: string
  /** `MagicAnimation.importImage()` 里拼出来的那一段目录名。 */
  animationStem: string
}[] = [
  { hero: 1, party: 'zhang', name: 'zhangxiaofan', sound: '张小凡攻击(2).wav', animationStem: '张小凡技能' },
  { hero: 2, party: 'lu', name: 'luxueqi', sound: '陆雪琪攻击(2).wav', animationStem: '陆雪琪技能' },
  { hero: 4, party: 'yu', name: 'yujie', sound: '文敏攻击(2).wav', animationStem: '文敏技能' },
]

/**
 * 十五条技能动画的**帧数**，`addMagicAnimation()` 里那三组 `new MagicAnimation`
 * 的第三个入参，逐个照抄。判据在 `magic.test.ts`（从 GBK 源码里现读）。
 *
 * ⚠️ 这些数**与战斗里那套技能动画不是一回事**：战斗那边的帧数写在
 * `<主角>.skill(i)` 的 `skillAnimation.set(...)` 里，菜单这边是另一处硬编码。
 * 拿 `battle/skills.ts` 的读数顶替，抄错了的表现是"动画早收一拍或晚收一拍"，
 * 而画面上完全正常。
 */
export const MAGIC_ANIMATION_LENGTHS: Readonly<Record<ScollHero, readonly number[]>> = {
  1: [37, 31, 31, 44, 42],
  2: [17, 23, 21, 29, 29],
  4: [39, 32, 28, 16, 41],
}

/** `MagicAnimation` 的可断言字段 —— 真值 `magic.animation` 那四个。 */
export interface MagicAnimationState {
  readonly hero: ScollHero
  /** `skillNumber` 字段：**1 基**，第几号技能。 */
  readonly skill: number
  /** 当前帧号，**1 基**。`update()` 推它，走到 `length` 时被拨回 1。 */
  code: number
  readonly length: number
}

export interface MagicState {
  /** 三个人各五颗技能按钮。键是卷轴编号。 */
  readonly buttons: Readonly<Record<ScollHero, MenuButtonState[]>>
  /**
   * 十五条动画。**是长期存在的对象，不是每次点击现造的** —— 原版
   * `addMagicAnimation()` 建好之后再没 new 过，`checkAllButtonPressed` 只是
   * 把 `currentAnimation` 指过去。于是**上一次没放完的帧号会留在里面**：
   * 一条动画放到一半被切走（`currentAnimation=null`），下次再点它是**接着
   * 上次那一帧往下走**的，不是从头。真值里看得见 —— `menu-magic` 开局那条
   * 玉洁第 5 技能被推到 `code=3` 才在第 2 步被清掉。
   */
  readonly animations: Readonly<Record<ScollHero, MagicAnimationState[]>>
  /** `currentAnimation`。**开局不是 null**，见文件头注第一条。 */
  current: MagicAnimationState | null
}

export function createMagicState(): MagicState {
  const buttons = {} as Record<ScollHero, MenuButtonState[]>
  const animations = {} as Record<ScollHero, MagicAnimationState[]>
  let last: MagicAnimationState | null = null
  for (const { hero } of MAGIC_HEROES) {
    buttons[hero] = Array.from({ length: MAGIC_BUTTON_COUNT }, (_, i) =>
      // `MenuButton` 的 `isDraw` 默认是 Yes，而 `addMagicButton()` 只把宋大仁
      // 那一组关掉（这一层不建他）。所以这三组开局全是画得出来的 ——
      // 真值第 0 帧的 `visible` 十五个全 true，正是这个。
      menuButton(MAGIC_BUTTON_X, magicButtonY(i), MAGIC_BUTTON_W, MAGIC_BUTTON_H, true),
    )
    animations[hero] = MAGIC_ANIMATION_LENGTHS[hero].map((length, i) => ({
      hero,
      skill: i + 1,
      code: 1,
      length,
    }))
  }
  // ⚠️ 建立次序就是结果：`addMagicAnimation()` 建完最后一条（文敏第 5 技能）
  // 之后 `currentAnimation` 就停在那儿。这里照着取"最后建的那一条"，
  // 而不是写死 `animations[4][4]` —— 写死的话，哪天顺序变了它还是绿的。
  for (const { hero } of MAGIC_HEROES) last = animations[hero][MAGIC_BUTTON_COUNT - 1]!
  return { buttons, animations, current: last }
}

/**
 * `drawThisPanel()` 里那个 `switch(scoll.whichHero)` —— **绘制的副作用**：
 * 按当前角色的 `skillNumber` 现设十五颗按钮的 `isDraw`。
 *
 * 放在状态层而不是绘制层，是因为 `isDraw` 是**真值记着的状态**
 * （`magic.visible` 那一列），而绘制层（`render/drawList.ts`）是纯函数。
 * 与 `drawScoll()` 那三句副作用的处置正相反：那三句只影响画不画、真值不记，
 * 所以折算进了绘制；这一处真值记，所以留在状态里。
 *
 * ⚠️ 两个循环**重叠一格**，见文件头注第二条。别"顺手修好"。
 *
 * `skillNumber` 是**当前卷轴角色此刻的格数**，调用方从菜单那三个人身上取（xl-03x.17）。
 * 这里原先直接读 `SKILL_NUMBER`（三个 static 的初值），等级怎么涨按钮都一颗不多。
 */
export function magicDrawThisPanel(magic: MagicState, whichHero: ScollHero, skillNumber: number): void {
  const n = skillNumber
  for (const { hero } of MAGIC_HEROES) {
    const list = magic.buttons[hero]
    if (hero !== whichHero) {
      // `for(MenuButton button:buttonListX){ button.isDraw=MenuButton.No; }`
      for (const b of list) b.isDraw = false
      continue
    }
    for (let i = 0; i < n; i++) list[i]!.isDraw = true
    for (let i = n - 1; i < MAGIC_BUTTON_COUNT; i++) list[i]!.isDraw = false
  }
}

/**
 * `MagicPanel.checkAllButtonPressed` 里 `scoll.checkPressed()` **之后**那一整段。
 *
 * 三步，顺序就是结果：
 *
 * 1. 只给**当前角色**那一组派命中判据（`switch(whichHero)`）；
 * 2. **无条件**把 `currentAnimation` 清空 —— 也就是说，**在奇术页上按下任何
 *    一处（包括从别的页切进来的那一次按下）都会把正在放的动画撤掉**。真值里
 *    `menu-magic` 第 2 步与 `menu-equip` 第 24 步都是这么变成 `null` 的：
 *    切页发生在 `command.checkPressed()`，紧接着的 `currentPanel.mousePressed`
 *    落在**新的**那一页上，于是这一句就跑了。
 * 3. 再按 1 / 2 / 4 的次序扫 `isclicked`，第一颗命中的那一组接上动画并出声。
 *
 * ⚠️ 第 3 步**三组各自 `break`，组与组之间没有**：原版写的是三个独立的
 * `for` 循环，各带一个 `break`。所以两组同时有 `isclicked` 时，**后一组赢**
 * （而且两声都会响）。今天观测不到 —— 一次按下只在当前角色那一组上派判据，
 * 而 `isclicked` 由松开清掉。照抄。
 */
export function magicCheckPressed(
  magic: MagicState,
  whichHero: ScollHero,
  x: number,
  y: number,
  music: string[],
): void {
  for (const b of magic.buttons[whichHero]) pressButton(b, x, y)

  magic.current = null

  for (const { hero, sound } of MAGIC_HEROES) {
    const list = magic.buttons[hero]
    for (let i = 0; i < MAGIC_BUTTON_COUNT; i++) {
      if (!list[i]!.isclicked) continue
      magic.current = magic.animations[hero][i]!
      music.push(sound)
      break
    }
  }
}

/**
 * `MagicPanel.checkAllButtonReleased` 的后半段：**四组全派一遍**，不看
 * `whichHero`，也不看 `isDraw`（`isRelesedButton` 原版没被 `MenuButton` 覆写）。
 *
 * 它是 `isclicked` 唯一的复位处 —— `isPressedButton` 没命中时只把贴图拨回常态，
 * **不清 `isclicked`**。少了这一句，下一次在这一页上按下就会把上一颗按钮
 * 重新认成"点中了"，动画凭空又放一遍。
 */
export function magicCheckReleased(magic: MagicState, x: number, y: number): void {
  for (const { hero } of MAGIC_HEROES) {
    for (const b of magic.buttons[hero]) releaseButton(b, x, y)
  }
}

/** `MagicPanel.checkAllButtonMoveIn` 的后半段：**只派当前角色那一组**。 */
export function magicCheckMoveIn(magic: MagicState, whichHero: ScollHero, x: number, y: number): void {
  for (const b of magic.buttons[whichHero]) moveInButton(b, x, y)
}

/**
 * `MagicPanel.update()`，逐行照抄：
 *
 *     if(currentAnimation!=null){
 *         currentAnimation.update();                  // if(code<length){ code++; }
 *         if(currentAnimation.code==currentAnimation.length){
 *             currentAnimation.code=1;
 *             currentAnimation=null;
 *         }
 *     }
 *
 * 三件事都是判据：
 *
 * - **一整条动画只占 `length-1` 拍**：`code` 从 1 起，走到 `length` 的那一拍
 *   动画同时被撤下，所以那一帧**画不出来**。37 帧的那条从按下算起第 36 拍
 *   收工（真值 `menu-magic` 第 43 步 `code=36`、第 44 步 `null`）。
 * - **撤下时帧号拨回 1**，而动画对象是长期存在的（见 `MagicState.animations`），
 *   所以下一次点同一条技能是从头放的。
 * - **`code==length` 那个判等在 `update()` 之后**：`update()` 自己有个
 *   `if(code<length)` 的门，所以 `code` 停在 `length` 不会再涨 —— 两处一起
 *   看才知道末帧只会命中一次。
 */
export function magicUpdate(magic: MagicState): void {
  const anim = magic.current
  if (!anim) return
  if (anim.code < anim.length) anim.code++
  if (anim.code === anim.length) {
    anim.code = 1
    magic.current = null
  }
}

/**
 * 卷轴编号 → 那一行。查不到是**抛**，不是返回 undefined —— 返回 undefined
 * 的话调用方多半会静静地少画一组按钮或少放一条动画。
 */
export function magicHero(hero: ScollHero): (typeof MAGIC_HEROES)[number] {
  const entry = MAGIC_HEROES.find((h) => h.hero === hero)
  if (!entry) throw new Error(`奇术页没有 ${hero} 号角色`)
  return entry
}

/**
 * 卷轴当前那个人**此刻**有几格技能 —— 菜单那三个人身上的 `skillNumber`（xl-03x.17）。
 * 按名字找，找不到是抛：返回一个缺省值的话，「这个人没建」会画成「这个人两格」。
 */
export function magicSkillNumber(heroes: readonly MenuHero[], whichHero: ScollHero): number {
  const { name } = magicHero(whichHero)
  const h = heroes.find((x) => x.name === name)
  if (h === undefined) throw new Error(`菜单里没有 ${name}，奇术页不知道画几颗`)
  return h.skillNumber
}

/** 真值 `magic` 那一列的形状。`snapshot.ts` 转手给它。 */
export function magicSnapshot(magic: MagicState): Record<string, unknown> {
  const visible: Record<string, boolean[]> = {}
  for (const { hero, name } of MAGIC_HEROES) {
    visible[name] = magic.buttons[hero].map((b) => b.isDraw)
  }
  const a = magic.current
  return {
    visible,
    animation: a ? { hero: a.hero, skill: a.skill, code: a.code, length: a.length } : null,
  }
}
