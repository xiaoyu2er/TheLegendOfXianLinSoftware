import { expToLevelUp, refreshValue } from './units'
import type { PartyKey, SkillSpec } from './units'
import { DRUGS, drugIntroText } from './drugs'
import { SKILLS, SKILL_INTRO_DIR, SKILL_MENU } from './skills'
import type { SkillEntry } from './skills'
import {
  MENU_BUTTON_H,
  MENU_BUTTON_W,
  MENU_BUTTON_X,
  inIntroRow,
  menuButtonY,
} from './menuLayout'
import type {
  BattleState,
  BattleWorld,
  BeAttackedAnim,
  Enemy,
  Hero,
  HurtValue,
  MenuButton,
} from './types'

/**
 * 推进一步 = 原版 `BattlePanel.run()` 的**一次循环体**，顺序
 * **输入 → 循环体**（`docs/trace-format.md` §一步是什么）。绘制不在这一层。
 *
 * 下面每个函数对应原版的一个 `update()` / `check()`，**调用顺序逐行照抄
 * `run()`**。顺序本身就是规格：同一拍里 `progressBar.updateProgress()` 在
 * `launchAttack.check()` 之前，所以"行动条跑满"与"这一招打出去"永远隔着一拍；
 * 换个顺序，404 步里的每一次交手都会错开一拍，而每一拍看上去都很正常。
 *
 * 状态是**就地改**的（返回的就是传进来的那个 world），理由见 `types.ts`。
 */

/** 真值里 `input` 那一项。战斗的输入只有鼠标。 */
export interface BattleInput {
  readonly e: string
  readonly x: number
  readonly y: number
  /** `command:<按钮>` 或 `enemy:<槽位>`，由导出器写入。 */
  readonly target: string
}

export function stepBattle(w: BattleWorld, inputs: readonly BattleInput[] = []): BattleWorld {
  for (const input of inputs) applyInput(w, input)

  // ↓↓↓ 以下顺序逐行对应 BattlePanel.run() 的循环体 ↓↓↓
  // mouse.update()：只更新游标坐标与游标图帧号，两者都不在真值里，也不被任何
  // 状态读到（`Mouse` 只被 `paint()` 用）。这一层不实现它。
  updateBackgroundAnimation(w)
  for (const h of w.heroes) heroDoAction(h)
  for (const h of w.heroes) updateVictoryAnimation(h)
  for (const h of w.heroes) updateDeadAnimation(h)
  for (const e of w.enemies) enemyDoAction(e)
  updateProgress(w)
  updateSkillAnimation(w)
  for (const e of w.enemies) updateBeAttacked(w, e.beAttackedAnimation)
  for (const h of w.heroes) updateBeAttacked(w, h.beAttackedAnimation)
  // pet：小精灵由陆雪琪的秘术召唤，battle-min 一场都没召过。归 xl-rh9.9。
  for (const hv of w.hurtValues) updateHurtValue(hv)
  updateInstruct(w)
  updateReminder(w)
  for (const e of w.enemies) checkEnemyState(w, e)
  launchAttackCheck(w)
  // stateBlank.update() 与 angryBar.update() 只改血条/怒气槽的**像素宽度**，
  // 一个字段都不在这份真值里（导出器 snapshotState 没取它们）。归渲染那张票。
  updateVictoryReminder(w)
  for (const h of w.heroes) checkHeroState(w, h)
  updateGameOver(w)
  updateStartAnimation(w)

  w.tick++
  return w
}

// ================= 输入 =================

/**
 * 回放一次点击。**press/release 的配法照抄导出器**：点按钮是
 * 移入 + 按下 + 松开，点怪物只有移入 + 按下（`BattleDriver.clickButton` /
 * `clickEnemy`）。`target` 是真值里记着的那一列，不是状态。
 */
function applyInput(w: BattleWorld, input: BattleInput): void {
  if (input.e !== 'click') throw new Error(`战斗只认 click 输入，实际 ${input.e}`)
  mouseMoved(w, input.x, input.y)
  mousePressed(w, input.x, input.y)
  // 点按钮（控制台与两个菜单）是移入 + 按下 + 松开，点怪物只有移入 + 按下。
  const clicksButton =
    input.target.startsWith('command:') ||
    input.target.startsWith('skillMenu:') ||
    input.target.startsWith('drugMenu:')
  if (clicksButton) mouseReleased(w, input.x, input.y)
  else if (!input.target.startsWith('enemy:')) {
    throw new Error(`没见过的点击目标 ${input.target}`)
  }
}

function mouseMoved(w: BattleWorld, x: number, y: number): void {
  w.currentX = x
  w.currentY = y
  // 控制台那四颗的 `GameButton.isMoveIn` 只换按钮贴图，而那张贴图不在行为真值
  // 里 —— 它存在渲染层的 `PaintState` 里（`render/paint.ts`）。两个菜单不一样：
  // 它们的贴图 xl-rh9.11 补进了真值，所以在这里推。
  if (w.skillMenu.isDraw) skillMenuMoveIn(w, x, y)
  if (w.drugMenu.isDraw) drugMenuMoveIn(w, x, y)
  selectorMoveIn(w, x, y)
}

function mousePressed(w: BattleWorld, x: number, y: number): void {
  w.currentX = x
  w.currentY = y
  // 顺序照抄 `BattlePanel.setMouse()` 里那个 mousePressed：控制台 → 技能菜单
  // → 药品菜单 → 怪物选择器。
  if (w.command.isDraw) {
    for (const b of commandButtons(w)) if (hit(b, x, y)) b.isclicked = true
  }
  if (w.skillMenu.isDraw) {
    for (const b of skillMenuButtons(w)) pressMenuButton(b, x, y)
  }
  if (w.drugMenu.isDraw) {
    for (const b of w.drugMenu.buttons) pressMenuButton(b, x, y)
  }
  if (w.selector.isSlectable) selectorClick(w, x, y)
}

/**
 * 松开鼠标。**三个 `if` 是顺序执行的，而前一个会把后一个的条件打开** ——
 * 原版 `BattlePanel.setMouse()` 里那三句就是并列的三条 `if`，不是 else-if：
 *
 *     if(command.isDraw){ command.checkReleased(); }   // 点「技」→ skillMenu.isDraw=true
 *     if(skillMenu.isDraw){ skillMenu.checkReleased(); } // ← 同一次事件里就为真了
 *     if(drugMenu.isDraw){ drugMenu.checkReleased(); }
 *
 * 后果看得见：点「技」那一下，坐标 (514,263) 同时落在技能菜单第 2 颗按钮的
 * 命中框里（那几颗的框是 x∈(380,595)、y∈(220+30k, 248+30k)），于是菜单一画
 * 出来，第 2 颗就已经是**待点态**了。写成 else-if 的话它是常态 —— 而两种
 * 都"看起来正常"。这一条由 battle-menus 的真值钉住。
 */
function mouseReleased(w: BattleWorld, x: number, y: number): void {
  w.currentX = x
  w.currentY = y
  if (w.command.isDraw) commandReleased(w, x, y)
  if (w.skillMenu.isDraw) skillMenuReleased(w, x, y)
  if (w.drugMenu.isDraw) drugMenuReleased(w, x, y)
}

/** `Command.checkReleased()`：击 → 技 → 物 → 防，最后统一走一遍松开。 */
function commandReleased(w: BattleWorld, x: number, y: number): void {
  const c = w.command
  if (c.attack.isclicked) {
    c.isDraw = false
    w.currentPattern = 1
    w.selector.isSlectable = true
  }
  if (c.skill.isclicked) {
    c.isDraw = false
    skillMenuCheckRound(w)
    w.skillMenu.isDraw = true
  }
  if (c.thing.isclicked) {
    c.isDraw = false
    // `DrugMenu.checkHero()`：把「这一回合谁在用药」定下来。
    w.drugMenu.currentHero = w.currentRound
    w.drugMenu.isDraw = true
  }
  if (c.defend.isclicked) {
    throw new Error(
      '「防」（秘术）还没实现：battle-menus 那条真值只点过「技」与「物」，' +
        '而秘术那一路（张小凡全体金钟罩 / 文敏潜能爆发 / 陆雪琪召小精灵）' +
        '一次都没走过 —— 归 xl-rh9.14。',
    )
  }
  for (const b of commandButtons(w)) if (hit(b, x, y)) b.isclicked = false
}

function commandButtons(w: BattleWorld) {
  return [w.command.attack, w.command.skill, w.command.defend, w.command.thing]
}

// ================= 技能菜单 / 药品菜单（xl-rh9.11） =================
//
// 三个 check（moveIn / pressed / released）逐句照抄 `SkillMenu` 与 `DrugMenu`。
// 它们改的东西有两类：**按钮贴图**（`variant`）与**状态后果**（选了哪一招、
// 用不用得起药）。前者以前只被 `paint()` 读、不在真值里，xl-rh9.11 把它补进去
// 之后就归这一层了。

/** `GameButton.isMoveIn`：在框里换待点态，不在就换回常态。 */
function moveInButton(b: MenuButton, x: number, y: number): void {
  b.variant = hit(b, x, y) ? 2 : 1
}

/** `GameButton.isPressedButton`：在框里换按下态并置 `isclicked`；不在只换回常态。 */
function pressMenuButton(b: MenuButton, x: number, y: number): void {
  if (hit(b, x, y)) {
    b.variant = 3
    b.isclicked = true
  } else {
    b.variant = 1
  }
}

/**
 * `GameButton.isRelesedButton`：在框里换回待点态并清 `isclicked`。
 *
 * ⚠️ **不在框里时它不清 `isclicked`** —— 原版那个 `else` 只有一句
 * `buttonImage=normalImage`。按下之后把鼠标挪开再松手，那颗按钮的
 * `isclicked` 会一直挂着，下一次任何一个 `checkReleased` 都会把它当成
 * 「刚被点过」。照抄。
 *
 * **这一条今天观测不到**（xl-rh9.11 篡改 T3：在 `else` 里补上
 * `b.isclicked = false`，逐字段比对全绿）。理由是结构性的：导出器的
 * `clickMenuButton` 按下与松开用的是**同一个坐标**，于是命中与否两次相同 ——
 * 落在框里的那颗两种写法都会被清，框外的那几颗 `isclicked` 本来就是 false。
 * 要观测到它，得有一条剧本在按钮上按下、把游标挪开、再松手，而今天没有这种
 * 指令。照抄它是因为它是原版真的会走的一支，不是因为有判据盖得住。
 */
function releaseMenuButton(b: MenuButton, x: number, y: number): void {
  if (hit(b, x, y)) {
    b.variant = 2
    b.isclicked = false
  } else {
    b.variant = 1
  }
}

/** `skillButtons` —— 当前指着的那一组。 */
function skillMenuButtons(w: BattleWorld): MenuButton[] {
  return w.skillMenu.groups[w.skillMenu.group]
}

/** 当前回合是谁；不是我方三人的回合就是 null。 */
function roundKey(w: BattleWorld): PartyKey | null {
  if (w.currentRound === 1) return 'zhang'
  if (w.currentRound === 2) return 'yu'
  if (w.currentRound === 3) return 'lu'
  return null
}

/**
 * `SkillMenu.checkRound()`：把 `skillButtons` 指到当前回合那一组，并**现 new
 * 一颗返回按钮**，落在 `226 + 这一组的按钮数 × 30` 上。
 *
 * 返回按钮每次点「技」都重建一颗（原版就是 `new GameButton(...)`），所以它的
 * `isclicked` 与贴图每一轮都从头开始。
 */
function skillMenuCheckRound(w: BattleWorld): void {
  const key = roundKey(w)
  if (key === null) {
    // 原版这个三路 switch 没有 default —— 不是我方回合时 `skillButtons` 与
    // `returnButton` 都不动，而 `returnButton` 可能还是 null，紧接着的
    // `checkMoveIn` 就是一发 NPE。控制台只在我方回合画出来，所以走不到。
    throw new Error(
      `点「技」时 currentRound 是 ${w.currentRound} —— 原版 SkillMenu.checkRound() ` +
        '那个三路 switch 没有 default，返回按钮会停在上一轮（或者还是 null）。',
    )
  }
  const m = w.skillMenu
  m.group = key
  // 返回按钮排在最后一颗技能按钮的下一格（`226 + 按钮数×30`）。
  m.returnButton = {
    x: MENU_BUTTON_X,
    y: menuButtonY(m.groups[key].length),
    width: MENU_BUTTON_W,
    height: MENU_BUTTON_H,
    isclicked: false,
    variant: 1,
  }
}

/**
 * `SkillMenu.checkMoveIn()`。
 *
 * ⚠️ 介绍图那一段翻的是**当前回合那个人**的按钮数，而 `skillButtons` 指的也
 * 是那一组，两者今天恒等；但 `isDrawIntro` 一旦置真**原版再也没清过它**，
 * 所以介绍图会一直画着（连菜单关掉再开也还在）。照抄。
 */
function skillMenuMoveIn(w: BattleWorld, x: number, y: number): void {
  const m = w.skillMenu
  for (const b of skillMenuButtons(w)) moveInButton(b, x, y)
  if (m.returnButton === null) {
    throw new Error('技能菜单画着而返回按钮是 null —— 原版这里是一发 NPE')
  }
  moveInButton(m.returnButton, x, y)
  const key = roundKey(w)
  if (key === null) return
  const buttons = m.groups[key]
  for (let i = 0; i < buttons.length; i++) {
    if (!inIntroRow(x, y, i)) continue
    m.introImage = `${SKILL_INTRO_DIR[key]}/${i + 1}`
    m.introY = menuButtonY(i)
    m.isDrawIntro = true
  }
}

/**
 * `SkillMenu.checkReleased()`：先看返回，再按回合逐颗看「点了哪一招」，
 * 最后统一走一遍松开。
 */
function skillMenuReleased(w: BattleWorld, x: number, y: number): void {
  const m = w.skillMenu
  if (m.returnButton === null) {
    throw new Error('技能菜单画着而返回按钮是 null —— 原版这里是一发 NPE')
  }
  if (m.returnButton.isclicked) {
    m.isDraw = false
    w.command.isDraw = true
  }
  const key = roundKey(w)
  if (key !== null) {
    const buttons = m.groups[key]
    for (let i = 0; i < buttons.length; i++) {
      if (!buttons[i]!.isclicked) continue
      const entry = SKILL_MENU[key][i]
      if (!entry) throw new Error(`${key} 的第 ${i + 1} 颗技能按钮不在 SKILL_MENU 里`)
      // `afterClicked(currentPattern, isSlectable, currentBeAttacked)`
      m.isDraw = false
      w.currentPattern = entry.pattern
      w.selector.isSlectable = entry.selectable
      w.currentBeAttacked = entry.beAttacked
      w.instruct.isDraw = false
      w.instruct.isStop = true
    }
  }
  for (const b of skillMenuButtons(w)) releaseMenuButton(b, x, y)
  releaseMenuButton(m.returnButton, x, y)
}

/** `DrugMenu.checkMoveIn()`：七颗按钮换贴图，六行介绍区判一遍。 */
function drugMenuMoveIn(w: BattleWorld, x: number, y: number): void {
  const m = w.drugMenu
  for (const b of m.buttons) moveInButton(b, x, y)
  for (let i = 0; i < DRUGS.length; i++) {
    if (!inIntroRow(x, y, i)) continue
    m.introDrug = i
    m.introText = drugIntroText(DRUGS[i]!)
    m.introY = menuButtonY(i)
    m.isDrawIntro = true
  }
}

/**
 * `DrugMenu.checkReleased()`。
 *
 * 原版那六个 `if` 各自还带一个 **type**（1 回血 / 2 回蓝，顺序 1,2,1,2,1,2），
 * 那个数**只被「真的用药」那一路读**（决定加 hp 还是加 mp），而那一路今天
 * 一次都走不到（存货恒为 0）。所以这里不把它抄进来：一张抄了却没人读的表
 * 抄错一位和抄对了长得一模一样，而它下面那个 `throw` 已经把这件事归给
 * xl-rh9.14 了。
 */
function drugMenuReleased(w: BattleWorld, x: number, y: number): void {
  const m = w.drugMenu
  for (let i = 0; i < DRUGS.length; i++) {
    if (m.buttons[i]!.isclicked) checkDrugNumber(w, i)
  }
  // 返回是第七颗。
  if (m.buttons[DRUGS.length]!.isclicked) {
    m.isDraw = false
    w.command.isDraw = true
  }
  for (const b of m.buttons) releaseMenuButton(b, x, y)
}

/**
 * `DrugMenu.checkDrugNumber(drug, type)`。
 *
 * **存货那一路今天走不到**：`ShopReader.readDrug()` 不给 `numberGOT` 赋值，
 * 数据文件里也没有那一列，所以一份没读过存档的进程里六种药全是 0，
 * `battle-menus` 点下去走的是 else 那一支。用得起药那一路要连
 * `progressGo()` 与回血/回蓝一起做，而它一次都没有真值 —— 抛并点名。
 */
function checkDrugNumber(w: BattleWorld, index: number): void {
  if (w.drugStock[index]! > 0) {
    throw new Error(
      `药品菜单上第 ${index + 1} 种药还剩 ${w.drugStock[index]} 个 —— 真的用药那一路` +
        '还没实现：回血还是回蓝（原版那六个 if 各带一个 type，顺序 1,2,1,2,1,2）、' +
        '伤害数字、扣存货、progressGo，一样都没有。战斗真值里存货全是 0，' +
        '这一路一次都没走到。归 xl-rh9.14。',
    )
  }
  showReminder(w, 19)
}

/**
 * `Reminder.show(i)`：把图指到 `images.get(i)` 上再放动画。
 *
 * **`+1` 只在这里做一次**：`images` 装的是 `1.png`..`22.png`，所以
 * `show(19)` 画的是 `20.png`。真值记的是文件号（`reminder.image`）。
 */
function showReminder(w: BattleWorld, i: number): void {
  const r = w.reminder
  r.image = i + 1
  r.isDraw = true
  r.isStop = false
}

/**
 * `GameButton` 判命中用的那个矩形：比绘制位置**左偏 15、上偏 6**，
 * 而且四边都是严格不等号。这是原版缺陷清单里的一条，照抄（ADR-0001）。
 */
function hit(b: { x: number; y: number; width: number; height: number }, x: number, y: number) {
  return x > b.x - 15 && x < b.x + b.width - 15 && y > b.y - 6 && y < b.y + b.height - 6
}

/** `EnemySlector.checkMoveIn`。第三槽的高用的是 `height1` —— xl-1dv.8。 */
function selectorMoveIn(w: BattleWorld, x: number, y: number): void {
  const s = w.selector
  if (!s.isSlectable) return
  if (w.em1) w.em1.isStop = inBox(x, y, s.x1, s.y1, s.width1, s.height1)
  if (w.em2) w.em2.isStop = inBox(x, y, s.x2, s.y2, s.width2, s.height2)
  if (w.em3) w.em3.isStop = inBox(x, y, s.x3, s.y3, s.width3, s.height1)
}

/** `EnemySlector.checkClick`。第三槽同样用 `height1`。 */
function selectorClick(w: BattleWorld, x: number, y: number): void {
  const s = w.selector
  const pick = (e: Enemy | null, bx: number, by: number, bw: number, bh: number, code: number) => {
    if (!e || !inBox(x, y, bx, by, bw, bh)) return
    w.currentBeAttacked = code
    s.isSlectable = false
    e.isDraw = true
    e.isStop = false
  }
  pick(w.em1, s.x1, s.y1, s.width1, s.height1, 5)
  pick(w.em2, s.x2, s.y2, s.width2, s.height2, 6)
  pick(w.em3, s.x3, s.y3, s.width3, s.height1, 7)
}

function inBox(x: number, y: number, bx: number, by: number, w_: number, h: number) {
  return x >= bx && x <= bx + w_ && y >= by && y <= by + h
}

// ================= 各个 update =================

function heroDoAction(h: Hero): void {
  if (!h.isStop && h.code < h.spec.frames) h.code++
  else if (h.code === h.spec.frames) h.code = 0
}

function enemyDoAction(e: Enemy): void {
  if (!e.isStop && e.code < e.spec.length) e.code++
  else if (e.code === e.spec.length) e.code = 0
}

function updateVictoryAnimation(h: Hero): void {
  const a = h.victoryAnimation
  if (a.isStop) return
  if (a.code < a.length) a.code++
  if (a.code === a.length) {
    a.code = 0
    a.isStop = true
    a.isDraw = false
    h.isDraw = true
  }
}

function updateDeadAnimation(h: Hero): void {
  const a = h.deadAnimation
  if (a.isStop) return
  if (a.code < a.length) a.code++
  // 死亡动画播到底就停在最后一帧循环回 0 —— 它**不会**自己收摊，人是躺着的。
  if (a.code === a.length) a.code = 0
}

/**
 * 行动条的终点：`ProgressBar.updateProgress` 里那个 400，**同一个数出现在
 * 两处判断上**（"七个都还没跑满" 与 "谁跑满了"）。抽成常量是因为篡改验证
 * 量出来它们必须一起改：只改我方那一支、而并行守卫还是 400，`battle-min`
 * 在张小凡那一格上照样对得上（他的行动条一步跨 9 像素，落不到 400..419 之间）。
 */
const ACTION_BAR_GOAL = 400

function updateProgress(w: BattleWorld): void {
  const p = w.progressBar
  if (p.isStop || !p.isDraw) return
  const behind = (v: number) => v - p.barX < ACTION_BAR_GOAL
  if (
    behind(p.zhangX) &&
    behind(p.yuX) &&
    behind(p.luX) &&
    behind(p.enemy1X) &&
    behind(p.enemy2X) &&
    behind(p.enemy3X) &&
    behind(p.petX)
  ) {
    if (w.zxf && !w.zxf.isDead) p.zhangX += w.zxf.speed
    if (w.yj && !w.yj.isDead) p.yuX += w.yj.speed
    if (w.lxq && !w.lxq.isDead) p.luX += w.lxq.speed
    // 原版这里还有一行 `if(bp.pet!=null){petX+=bp.pet.speed;}`。小精灵只由
    // 陆雪琪的秘术召得出来，这一层还没有秘术，`pet` 恒为 null —— 那一行恒不
    // 执行，所以这里是**不写**而不是漏写。召得出小精灵那天（xl-rh9.9）连同
    // `startEnemyRound` 上头那个 throw 一起补。
    if (w.em1) p.enemy1X += w.em1.speed
    if (w.em2) p.enemy2X += w.em2.speed
    if (w.em3) p.enemy3X += w.em3.speed
    return
  }
  const startHeroRound = (round: number) => {
    p.isStop = true
    w.currentRound = round
    w.command.isDraw = true
    instructStart(w)
  }
  const startEnemyRound = (round: number, e: Enemy) => {
    p.isStop = true
    w.currentRound = round
    skillToUse(w, e)
    if (w.currentBeAttacked !== 4) heroToAttack(w)
  }
  if (p.zhangX - p.barX >= ACTION_BAR_GOAL) startHeroRound(1)
  else if (p.yuX - p.barX >= ACTION_BAR_GOAL) startHeroRound(2)
  else if (p.luX - p.barX >= ACTION_BAR_GOAL) startHeroRound(3)
  else if (p.petX - p.barX >= ACTION_BAR_GOAL) {
    throw new Error('小精灵的回合还没实现（陆雪琪的秘术才召得出它）—— 归 xl-rh9.9')
  } else if (w.em1 && p.enemy1X - p.barX >= ACTION_BAR_GOAL) startEnemyRound(5, w.em1)
  else if (w.em2 && p.enemy2X - p.barX >= ACTION_BAR_GOAL) startEnemyRound(6, w.em2)
  else if (w.em3 && p.enemy3X - p.barX >= ACTION_BAR_GOAL) startEnemyRound(7, w.em3)
}

/** `EnemyAI.skillToUse`：掷一次，2 号招式是群攻，目标直接定成"我方全体"。 */
function skillToUse(w: BattleWorld, e: Enemy): void {
  w.currentPattern = w.random.scaledInt(e.spec.skillNum) + 1
  if (w.currentPattern === 2) w.currentBeAttacked = 4
}

/**
 * `EnemyAI.heroToAttack`：拒绝采样，**消耗不定次数随机数**。
 * 这正是 ADR-0004 说的"调用顺序也是规格"——少掷一次，之后每一发伤害都错。
 */
function heroToAttack(w: BattleWorld): void {
  for (let guard = 0; guard < 100000; guard++) {
    const i = w.random.scaledInt(3) + 1
    if (i === 1 && w.zxf && !w.zxf.isDead) {
      w.currentBeAttacked = 1
      return
    }
    if (i === 2 && w.yj && !w.yj.isDead) {
      w.currentBeAttacked = 2
      return
    }
    if (i === 3 && w.lxq && !w.lxq.isDead) {
      w.currentBeAttacked = 3
      return
    }
  }
  // 原版在这里是死循环（我方全灭而怪物还在选目标）。挂死看起来只是"跑得慢"，
  // 所以这里响亮地断掉。
  throw new Error('heroToAttack 掷了十万次都没有活着的目标 —— 原版在这里会死循环')
}

function updateSkillAnimation(w: BattleWorld): void {
  const a = w.skillAnimation
  if (a.isStop) return
  const target = w.currentBeAttacked
  let offset: number
  if (target === 5 || target === 1) offset = a.offsetTo1
  else if (target === 6 || target === 2) offset = a.offsetTo2
  else if (target === 7 || target === 3) offset = a.offsetTo3
  else if (target === 8 || target === 4) offset = a.offsetTo1
  // currentBeAttacked 为 0 时原版四个分支一个都不进：动画就停在原地不动。
  else return

  if (a.code < a.length) a.code++
  if (a.code === a.beAttackedCode) {
    showBeAttacked(w, target, a.beAttackedTimes)
    a.code++
  }
  // Java 是两个 int 相除再 Math.round —— 整除已经把小数丢了，向零截尾。
  if (a.code < a.runCode) a.y -= Math.trunc(offset / a.runCode)
  if (a.attackCode <= a.code && a.code < a.withdrawCode) {
    a.y += Math.trunc(offset / (a.withdrawCode - a.attackCode))
  }
  if (a.code === a.length) {
    a.code = 0
    a.x = a.initialX
    a.y = a.initialY
    a.isStop = true
    a.isDraw = false
    a.isOver = true
  }
}

function showBeAttacked(w: BattleWorld, target: number, times: number): void {
  const start = (unit: { isDraw: boolean; beAttackedAnimation: BeAttackedAnim }) => {
    unit.isDraw = false
    unit.beAttackedAnimation.times = times
    unit.beAttackedAnimation.isDraw = true
    unit.beAttackedAnimation.isStop = false
  }
  if (target === 1 && w.zxf) start(w.zxf)
  if (target === 2 && w.yj) start(w.yj)
  if (target === 3 && w.lxq) start(w.lxq)
  if (target === 4) for (const h of w.heroes) if (!h.isDead) start(h)
  if (target === 5 && w.em1) start(w.em1)
  if (target === 6 && w.em2) start(w.em2)
  if (target === 7 && w.em3) start(w.em3)
  if (target === 8) for (const e of w.enemies) start(e)
}

function updateBeAttacked(w: BattleWorld, a: BeAttackedAnim): void {
  if (!a.isStop && a.code < a.length) {
    a.code++
    return
  }
  if (a.code !== a.length) return
  a.code = 0
  if (a.currentTime !== a.times) {
    a.currentTime++
    return
  }
  a.isStop = true
  a.isDraw = false
  a.currentTime = 1
  // 挨打的那一位重新画出来。判的是**当前**的 currentBeAttacked，不是开打时的
  // 那个 —— 原版就是这么写的。
  const t = w.currentBeAttacked
  if (t === 1 && w.zxf) w.zxf.isDraw = true
  if (t === 2 && w.yj) w.yj.isDraw = true
  if (t === 3 && w.lxq) w.lxq.isDraw = true
  if (t === 4) for (const h of w.heroes) if (!h.isDead) h.isDraw = true
  if (t === 5 && w.em1) w.em1.isDraw = true
  if (t === 6 && w.em2) w.em2.isDraw = true
  if (t === 7 && w.em3) w.em3.isDraw = true
  if (t === 8) for (const e of w.enemies) e.isDraw = true
}

function updateHurtValue(hv: HurtValue): void {
  if (hv.isStop) return
  if (hv.code <= 5) {
    hv.y -= 2
    hv.code++
  } else if (hv.code <= 10) {
    hv.y += 1
    hv.code++
  } else {
    hv.isStop = true
    hv.isDraw = false
    hv.code = 1
  }
}

/**
 * `Instruct.start()`：按当前回合把指示图标放到那个人头上。
 *
 * 三路 switch 里没有「怪物的回合」那几支 —— 原版就没写，所以怪物行动时
 * 指示器停在**上一个我方单位**留下的坐标上。那也是照抄的一部分。
 * 坐标不在这份真值里（只记 `ui.instruct` 这个布尔），渲染那张票会用到。
 */
function instructStart(w: BattleWorld): void {
  const i = w.instruct
  if (w.currentRound === 1 && w.zxf) {
    i.x = w.zxf.x + 210
    i.y = w.zxf.y + 75
  } else if (w.currentRound === 2 && w.yj) {
    i.x = w.yj.x + 85
    i.y = w.yj.y - 20
  } else if (w.currentRound === 3 && w.lxq) {
    i.x = w.lxq.x + 45
    i.y = w.lxq.y - 20
  }
  i.isDraw = true
  i.isStop = false
}

function updateInstruct(w: BattleWorld): void {
  const i = w.instruct
  if (!i.isStop && i.code < 5) i.code++
  else if (i.code === 5) i.code = 0
}

function updateReminder(w: BattleWorld): void {
  const r = w.reminder
  if (r.isStop) return
  if (r.dx1 > r.centreX - 60) {
    r.dx1 -= 5
    r.dx2 += 5
    r.dy1 -= 1
    r.dy2 += 1
    return
  }
  r.code++
  if (r.code === 10) {
    r.isDraw = false
    r.isStop = true
    r.code = 0
    r.dx1 = r.centreX
    r.dx2 = r.centreX
    r.dy1 = r.centreY
    r.dy2 = r.centreY
  }
}

function updateBackgroundAnimation(w: BattleWorld): void {
  const b = w.backgroundAnimation
  if (b.isStop) return
  if (b.code < b.length) b.code++
  if (b.code === b.length) {
    b.code = 0
    b.isDraw = false
    b.isStop = true
    b.isOver = true
  }
}

function updateStartAnimation(w: BattleWorld): void {
  const s = w.startAnimation
  if (s.isStop) return
  if (s.leftX < 1024) {
    s.leftX += 30
    s.rightX -= 30
  } else {
    s.isDraw = false
    s.isStop = true
  }
}

/**
 * `VictoryReminder.update()` —— 结算、发经验、属性滚动、回地图，整段归
 * **xl-rh9.5**。`battle-min` 正正停在"胜利"第一次出现的那一刻，所以它在这份
 * 真值里**只跑一次**，而那一次改的字段（`sy2` / `timeCode` 那些）一个都不在
 * 真值里。跑到第二次就说明有人把真值往后接了，那时候这里必须响。
 */
function updateVictoryReminder(w: BattleWorld): void {
  if (w.victoryStopped) return
  w.victoryUpdates++
  if (w.victoryUpdates > 1) {
    throw new Error(
      'VictoryReminder.update() 跑到了第二拍 —— 胜利之后的结算（经验、物品、钱、' +
        '升级、回地图）还没有实现，归 xl-rh9.5。battle-min 停在胜利出现的那一刻，' +
        '第一拍改的字段一个都不在真值里，第二拍起就不是了。',
    )
  }
}

/**
 * `GameOver.update()` —— 全灭图对开，开满之后再数十下，然后**按第一只怪的
 * 名字**分岔：叫「罹年居士」就切回地图（scenePanel），其余一律切回标题
 * （startPanel）。
 *
 * 计时全靠 `lsx2`：每拍 +8，64 拍到 512，此后 `code` 每拍 +1 到 10 —— 第 64
 * 拍那一次里两件事发生在同一个 `update()` 里（`lsx2` 刚好等于 512 就接着数
 * 第一下），所以从全灭到切面板一共 73 次 `update()`。第一次与 `defeat` 置位
 * 落在同一拍，真值上是 72 步。
 *
 * ## 那句字符串比较是**逐字相等，且只看第一只**
 *
 * 原版写的是 `bp.em1.name.equals("罹年居士")`。三份打输真值各自堵住一种写错法：
 *
 * - 写成「三个槽位里有没有」→ `battle-defeat-slot2` 红（罹年居士在第 2 槽，
 *   原版走的仍是回标题那条）；
 * - 写成 `startsWith` / `includes` → `battle-defeat-start` 红
 *   （「罹年居士分身」以「罹年居士」开头）；
 * - 整条分支走反 → 三份两两对照都红。
 *
 * ## 两条出口清的东西不一样，这也是判据
 *
 * 回地图只摘掉 `em1`、只把张小凡与文敏复位成**半血**（陆雪琪一个字段都不碰）；
 * 回标题把三个槽位全摘掉、三个人都只把绘制标志翻回来、谁的血都不回。
 */
function updateGameOver(w: BattleWorld): void {
  const g = w.gameOver
  if (g.isStop) return
  if (g.lsx2 < 512) {
    g.lsx2 += 8
    g.ldx2 += 8
    g.rsx1 -= 8
    g.rdx1 -= 8
  }
  if (g.lsx2 !== 512) return
  if (g.code < 10) g.code++
  if (g.code !== 10) return

  const em1 = w.em1
  if (em1 === null) {
    // 原版这一句是 `bp.em1.name.equals(...)`，em1 为 null 时当场 NPE。
    // 这里也不给它兜底：兜底等于替原版决定了一个它没有的行为。
    throw new Error(
      '全灭结算时第一个槽位已经空了 —— 原版 GameOver.update() 在这里读的是 ' +
        '`bp.em1.name`，会抛 NullPointerException。这一层不替它选一条出口。',
    )
  }
  // 逐字相等，且只看第一只 —— 见上面那张写错法对照表。
  if (em1.name === '罹年居士') {
    exitToScene(w)
  } else {
    exitToStart(w)
  }
  g.isStop = true
}

/** 回地图那条出口。原版**不判空**地读 `bp.zxf` / `bp.yj`，也不碰陆雪琪。 */
function exitToScene(w: BattleWorld): void {
  // 原版这一支还有一句 `GameLauncher.SCENE_SIGNAL=1`。那是**场景面板**的字段，
  // 不属于战斗世界，也不在战斗真值里 —— 回地图之后场景那边怎么接，归 xl-rh9.5。
  w.exitPanel = 'scenePanel'
  w.em1 = null
  w.enemies.length = 0
  const revive = (h: Hero | null, who: string): void => {
    if (h === null) {
      throw new Error(
        `回地图那条出口要把${who}复位，可他/她没有出战 —— 原版这一句 ` +
          '（`bp.zxf.deadAnimation.isDraw=false`）在这里会抛 NullPointerException。',
      )
    }
    h.deadAnimation.isDraw = false
    h.isDraw = true
    // `ZhangXiaoFan.hp=ZhangXiaoFan.hpMax/2` —— Java 的整数除法，向零截尾。
    h.hp = Math.trunc(h.hpMax / 2)
  }
  revive(w.zxf, '张小凡')
  revive(w.yj, '文敏')
  // 陆雪琪不在这条分支里，连 isDraw 都不翻回来（原版就是这么写的）。
  w.heroes.length = 0
}

/**
 * 回标题那条出口。三个槽位全摘掉，三个人都判空，谁的血都不回。
 *
 * **还换歌**：`GameLauncher.switchTo("start")` 那一支里多一句
 * `MusicReader.readBGM("主题曲.mp3")`，回地图那一支没有。所以两条出口在
 * `audio.bgm` 上也分得开 —— 这一条是真值自己给出来的，不是补的判据。
 */
function exitToStart(w: BattleWorld): void {
  w.exitPanel = 'startPanel'
  w.bgm = '主题曲.mp3'
  w.em1 = null
  w.em2 = null
  w.em3 = null
  w.enemies.length = 0
  for (const h of [w.zxf, w.yj, w.lxq]) {
    if (h === null) continue
    h.deadAnimation.isDraw = false
    h.isDraw = true
  }
  w.heroes.length = 0
}

// ================= 战斗状态 =================

/**
 * `BattleState.check()`，我方那一份。回合轮到自己时数一下，数完就恢复。
 *
 * `roundNum` 与 `isCheck` 的配合是原版的防重入：同一个回合里循环体会跑很多拍，
 * `isCheck` 保证只结算一次，回合一换回来才置真。
 */
function checkHeroState(w: BattleWorld, h: Hero): void {
  checkStateCommon(w, h.battleState, () => excuteState(h.battleState, '我方'), () =>
    returnHeroState(h),
  )
}

/** `BattleState.check()`，怪物那一份。 */
function checkEnemyState(w: BattleWorld, e: Enemy): void {
  checkStateCommon(w, e.battleState, () => excuteState(e.battleState, '怪物'), () =>
    returnEnemyState(e),
  )
}

function checkStateCommon(
  w: BattleWorld,
  s: BattleState,
  excute: () => void,
  returnFrom: () => void,
): void {
  if (!s.isUsable) return
  if (w.currentRound === s.roleCode && s.isCheck) {
    s.isCheck = false
    if (s.roundNum > 0) {
      s.roundNum--
      excute()
    } else {
      returnFrom()
      clearState(s)
    }
  }
  if (w.currentRound !== s.roleCode) s.isCheck = true
}

/**
 * `BattleState.set(...)`。**先掷一个随机数**，掷中了才挂 —— 掷不中也已经消耗掉
 * 那一个数了，所以它必须在这一层出现，哪怕成功率是 100。
 *
 * `successRate` 不写回字段：原版的 `set()` 只把它当入参读，那个字段从头到尾
 * 是 0（真值里也没有这一列）。
 */
function setBattleState(
  w: BattleWorld,
  s: BattleState,
  spec: { rounds: number; type: number; successRate: number },
  roleCode: number,
  x: number,
  y: number,
  returnFrom: () => void,
): void {
  const p = w.random.nextDouble() * 100
  if (p >= spec.successRate) return
  // 之前那个状态还没结算完就被顶掉了 —— 先把它的加成退回去（退的是**旧**
  // type，所以这一句必须在下面那几行覆盖之前）。
  if (s.isUsable) returnFrom()
  s.isUsable = true
  s.roundNum = spec.rounds
  s.x = x
  s.y = y
  s.type = spec.type
  s.roleCode = roleCode
  s.isCheck = true
}

/**
 * `<主角>.checkState()`：把状态的加成**挂上去**（三个主角这段代码一模一样）。
 *
 * 只有 type 1 移植了 —— `battle-menus` 里文敏技能2 挂的就是它。其余的抛并
 * 点名：一条没有真值的加成公式，抄错了和抄对了推出来的战斗过程都"很正常"。
 */
function heroApplyState(h: Hero): void {
  // 原版那个 switch **没有 case 0**，所以「没挂上任何状态」时它什么都不做。
  // 掷不中的时候原版照样会调这个方法（`set()` 之后那句 `checkState()` 是
  // 无条件的），读到的是**上一个**状态的 type —— 也就是说加成会被重复挂一次。
  // 那是原版的行为，照抄（ADR-0001）；今天两条路的成功率都是 100，掷不中
  // 这件事观测不到。
  if (h.battleState.type === 0) return
  if (h.battleState.type === 1) {
    h.agile += 2
    h.speed = Math.trunc(h.agile / 2)
    return
  }
  throw new Error(
    `我方战斗状态 ${h.battleState.type} 的加成还没实现 —— battle-menus 只挂过 type 1` +
      '（敏捷提升，文敏技能2）。归 xl-rh9.14。',
  )
}

/** `<主角>.returnFromState()`：把加成退回去。type 1 与上面严格互逆。 */
function returnHeroState(h: Hero): void {
  if (h.battleState.type === 1) {
    h.agile -= 2
    h.speed = Math.trunc(h.agile / 2)
    return
  }
  throw new Error(
    `我方战斗状态 ${h.battleState.type} 的恢复还没实现 —— 归 xl-rh9.14。`,
  )
}

/**
 * `<主角>.excuteState()` 与 `Enemy.excuteState()`。
 *
 * 两边的 switch 只有 case 9（中毒）有动作，其余什么都不做 —— 而中毒只由
 * 文敏技能1 与陆雪琪的两条技能挂得上，一条都没移植。合成一个函数是因为
 * 「这一支还没实现」这件事两边一模一样；等 case 9 真的做出来时它会自然分家
 * （我方扣的是 `hp*0.05` 画在 showX/showY，怪物扣的也是 5% 但画在 x/y）。
 */
function excuteState(s: BattleState, who: string): void {
  if (s.type === 9) {
    throw new Error(`${who}中毒（type 9）的每回合结算还没实现 —— 归 xl-rh9.14`)
  }
}

/** `Enemy.checkState()`。只有 type 8 移植了（张小凡技能2 挂的体力下降）。 */
function enemyApplyState(e: Enemy): void {
  // 同 `heroApplyState`：原版那个 switch 没有 case 0。
  if (e.battleState.type === 0) return
  if (e.battleState.type === 8) {
    e.defense -= 40
    return
  }
  throw new Error(
    `怪物战斗状态 ${e.battleState.type} 的加成还没实现 —— battle-menus 只挂过 type 8` +
      '（体力下降，张小凡技能2）。归 xl-rh9.14。',
  )
}

/**
 * `Enemy.returnFromState()`。
 *
 * ⚠️ **今天一次都走不到**：`battle-menus` 里那个 type 8 挂在第 3 槽那只怪身上，
 * `roundNum` 到收工都还是 2 —— 打赢的时候它一次都没轮到过。也就是说这一支
 * 与「我方那一支」不一样，它没有正面判据；写在这里是为了让走到的那一天**响**，
 * 而不是悄悄少退一次 40 点防御。
 */
function returnEnemyState(e: Enemy): void {
  throw new Error(
    `怪物战斗状态 ${e.battleState.type} 的恢复还没实现 —— battle-menus 里那个 type 8 ` +
      '到收工都没到期（rounds 一直是 2），这一支没有真值。归 xl-rh9.14。',
  )
}



/**
 * `BattleState.clear()`。**`x` / `y` 不在里面** —— 原版那六行只清了六个字段，
 * 坐标留着上一次的值。真值记着它们，所以这里也不许"顺手清干净"。
 */
function clearState(s: BattleState): void {
  s.isUsable = false
  s.isCheck = false
  s.type = 0
  s.roundNum = 0
  s.roleCode = 0
  s.successRate = 0
}

// ================= 攻击发动器 =================

function launchAttackCheck(w: BattleWorld): void {
  if (w.currentBeAttacked === 0) return
  switch (w.currentRound) {
    case 1:
      if (w.zxf) checkHeroTurn(w, w.zxf)
      break
    case 2:
      if (w.yj) checkHeroTurn(w, w.yj)
      break
    case 3:
      if (w.lxq) checkHeroTurn(w, w.lxq)
      break
    case 4:
      throw new Error('小精灵的回合还没实现 —— 归 xl-rh9.9')
    case 5:
      if (w.em1) checkEnemyTurn(w, w.em1, 1)
      break
    case 6:
      if (w.em2) checkEnemyTurn(w, w.em2, 2)
      break
    case 7:
      if (w.em3) checkEnemyTurn(w, w.em3, 3)
      break
  }
}

function checkHeroTurn(w: BattleWorld, h: Hero): void {
  if (w.currentPattern === 1) {
    w.hurtValues.length = 0
    heroCalDamage(w, h)
    w.instruct.isDraw = false
    w.instruct.isStop = true
    setSkillAnimation(w, h.spec.attack)
    h.isDraw = false
    w.currentPattern = 0
  }
  // 原版这几支是**并列的 if**，不是 else-if；上面那一支把 currentPattern 归零，
  // 所以同一拍里不会两支都走。
  if (w.currentPattern >= 2 && w.currentPattern <= 6) skillAttack(w, h)
  if (w.currentPattern === 7) {
    throw new Error(
      '秘术（pattern 7）还没实现：张小凡全体金钟罩 / 文敏潜能爆发 / 陆雪琪召小精灵，' +
        '五份战斗真值一次都没用过。归 xl-rh9.14。',
    )
  }

  const finish = (): void => {
    for (const hv of w.hurtValues) {
      hv.isDraw = true
      hv.isStop = false
    }
    checkEnemyDead(w)
    if (h.roleCode === 1) w.progressBar.zhangX = w.progressBar.barX
    if (h.roleCode === 2) w.progressBar.yuX = w.progressBar.barX
    if (h.roleCode === 3) w.progressBar.luX = w.progressBar.barX
    resume(w)
  }
  if (w.skillAnimation.isOver) {
    w.skillAnimation.isOver = false
    h.isDraw = true
    if (!w.backgroundAnimation.isDraw) finish()
  }
  if (w.backgroundAnimation.isOver) {
    w.backgroundAnimation.isOver = false
    finish()
  }
}

function checkEnemyTurn(w: BattleWorld, e: Enemy, slot: 1 | 2 | 3): void {
  if (w.currentPattern === 1 || w.currentPattern === 2) {
    // 怪物出手前那 5 拍前摇。整个发动器共用一个 code，原版就是这样。
    if (w.launchCode < 5) w.launchCode++
    else {
      w.hurtValues.length = 0
      enemyCalDamage(w, e)
      w.currentPattern = 0
      setSkillAnimation(w, e.skill)
      e.isDraw = false
      w.launchCode = 0
    }
  }
  if (w.skillAnimation.isOver) {
    w.skillAnimation.isOver = false
    for (const hv of w.hurtValues) {
      hv.isDraw = true
      hv.isStop = false
    }
    checkHeroDead(w)
    e.isDraw = true
    if (slot === 1) w.progressBar.enemy1X = w.progressBar.barX
    if (slot === 2) w.progressBar.enemy2X = w.progressBar.barX
    if (slot === 3) w.progressBar.enemy3X = w.progressBar.barX
    resume(w)
  }
}

/** `SkillAnimation.set(...)`：**不重置 `code`**，照抄原版。 */
/**
 * `LaunchAttack.skillAttack(mpUse, reminderCode, skillCode, hero)`。
 *
 * 灵力够不够是**两条完全不同的路**，而两条都要有：不够的时候原版把控制台放
 * 回来、弹 20 号提示（也就是 `21.png`），一招都没出。少写那一支的表现是
 * "灵力不够却照样打出去了"，画面上完全正常。
 *
 * ⚠️ 顺序与普通攻击那一支不一样：普攻是 clear → calDamage → instruct.end →
 * attack() → currentPattern=0，这里是 clear → calDamage → **currentPattern=0**
 * → instruct.end → reminder.show → skill()。`calDamage` 读的正是
 * `currentPattern`，所以归零那一句必须排在它之后。
 */
function skillAttack(w: BattleWorld, h: Hero): void {
  const entry = SKILLS[h.spec.key][w.currentPattern]
  if (!entry) {
    throw new Error(
      `${h.spec.key} 的第 ${w.currentPattern} 号招式不在 skills.ts 的表里 —— ` +
        '陆雪琪那五条一条都没抄（她的技能菜单在 battle-menus 里没被点过）。归 xl-rh9.14。',
    )
  }
  if (h.mp >= entry.mpUse) {
    w.hurtValues.length = 0
    heroCalDamage(w, h)
    w.currentPattern = 0
    w.instruct.isDraw = false
    w.instruct.isStop = true
    showReminder(w, entry.reminderCode)
    heroSkill(w, h, entry)
  } else {
    // `bp.reminder.show(20)` —— 也就是 `21.png`「灵力不足」。
    showReminder(w, 20)
    w.command.isDraw = true
    w.currentPattern = 0
    w.currentBeAttacked = 0
  }
}

/** `<主角>.skill(i)`：人物收起来，背景动画与技能动画一起开。 */
function heroSkill(w: BattleWorld, h: Hero, entry: SkillEntry): void {
  h.isDraw = false
  const b = w.backgroundAnimation
  // `BackgroundAnimation.set` 只写 name 与 length，**不重置 code** —— 与
  // `SkillAnimation.set` 一样，照抄。
  b.name = entry.background.name
  b.length = entry.background.length
  setSkillAnimation(w, entry.animation)
  b.isDraw = true
  b.isStop = false
}

function setSkillAnimation(w: BattleWorld, spec: SkillSpec): void {
  const a = w.skillAnimation
  Object.assign(a, spec)
  a.initialX = spec.x
  a.initialY = spec.y
  a.named = true
  a.isDraw = true
  a.isStop = false
}

function resume(w: BattleWorld): void {
  w.currentRound = 0
  w.currentBeAttacked = 0
  w.currentPattern = 0
  w.progressBar.isStop = false
}

// ================= 伤害 =================

function pushHurt(w: BattleWorld, hurt: number, type: number, x: number, y: number): void {
  w.hurtValues.push({ hurt, type, x, y, code: 1, isDraw: false, isStop: true })
}

/**
 * `ZhangXiaoFan/YuJie/LuXueQi.calDamage()`：先按 `currentBeAttacked` 选目标，
 * 再按 `currentPattern` 分招。
 */
function heroCalDamage(w: BattleWorld, h: Hero): void {
  const targets = heroTargets(w)
  if (w.currentPattern === 1) {
    for (const e of targets) {
      let damage = h.hurt - e.defense + w.random.scaledInt(15)
      if (damage < 0) damage = 0
      // xl-1dv.9：怪物血量**不夹到 0**，致命一击打过头就是负的。
      e.hp -= damage
      pushHurt(w, damage, 1, e.x, e.y)
    }
    return
  }
  const entry = SKILLS[h.spec.key][w.currentPattern]
  const d = entry?.damage
  if (!d) {
    throw new Error(
      `${h.spec.key} 的第 ${w.currentPattern} 号招式的伤害公式还没移植 —— ` +
        'battle-menus 只走过张小凡技能2 与文敏技能2（都是 pattern 3）。归 xl-rh9.14。',
    )
  }
  // `attackSkill(baseHurt, offsetHurt, mpUse)`：**每个目标各掷一次**随机数，
  // 全部打完之后才扣一次灵力。取数顺序本身就是规格（ADR-0004）。
  for (const e of targets) {
    let damage = h.skillHurt - e.defense + w.random.scaledInt(d.offsetHurt) + d.baseHurt
    if (damage < 0) damage = 0
    e.hp -= damage
    pushHurt(w, damage, 1, e.x, e.y)
  }
  h.mp -= d.mpUse
  // 状态附加排在扣灵力之后（原版 `calDamage` 里 `attackSkill(...)` 那一句
  // 返回之后才轮到那个 for），而 `set()` 每次都掷一个随机数。
  if (d.enemyState) {
    for (const e of targets) {
      setBattleState(w, e.battleState, d.enemyState, e.roleCode, e.x, e.y, () => returnEnemyState(e))
      // 原版 `e.checkState()` 是**无条件**的（掷不中也调），所以这里也不加
      // `isUsable` 的门 —— 加了门就是替原版补了一个它没有的判断。
      enemyApplyState(e)
    }
  }
  if (d.selfState) {
    setBattleState(w, h.battleState, d.selfState, h.roleCode, h.showX, h.showY, () =>
      returnHeroState(h),
    )
    heroApplyState(h)
  }
}

/** `calDamage()` 开头那个 `switch(bp.currentBeAttacked)`。 */
function heroTargets(w: BattleWorld): Enemy[] {
  // 原版 `case 5/6/7` 是 `currentEnemies.add(bp.em1)` —— **没有判空**
  // （只有打全体的 `case 8` 有）。槽位空着时它是一发 NPE。这里不"顺手补上
  // 判空"（那是 ADR-0001 明令不许的"把缺陷修好"），也不静默跳过 —— 静默跳过
  // 会导出一份"打过了、一切正常、可就是没人挨打"的 trace。照抄的是**它会炸**
  // 这件事，只是把炸法换成一句说得清的话。
  const targets: Enemy[] = []
  const aimed = (e: Enemy | null, slot: number): Enemy => {
    if (!e) {
      throw new Error(
        `currentBeAttacked 指着第 ${slot} 槽，而那一槽已经空了 —— ` +
          '原版 Hero.calDamage 的 case 5/6/7 没有判空，这里是一发 NPE。',
      )
    }
    return e
  }
  if (w.currentBeAttacked === 5) targets.push(aimed(w.em1, 1))
  if (w.currentBeAttacked === 6) targets.push(aimed(w.em2, 2))
  if (w.currentBeAttacked === 7) targets.push(aimed(w.em3, 3))
  if (w.currentBeAttacked === 8) for (const e of [w.em1, w.em2, w.em3]) if (e) targets.push(e)
  return targets
}

/** `Enemy.calDamage()`：1 号普攻、2 号群攻（伤害打六折）。 */
function enemyCalDamage(w: BattleWorld, e: Enemy): void {
  const targets: Hero[] = []
  if (w.currentBeAttacked === 1 && w.zxf) targets.push(w.zxf)
  if (w.currentBeAttacked === 2 && w.yj) targets.push(w.yj)
  if (w.currentBeAttacked === 3 && w.lxq) targets.push(w.lxq)
  if (w.currentBeAttacked === 4) for (const h of w.heroes) if (!h.isDead) targets.push(h)
  const base = w.currentPattern === 2 ? Math.trunc(e.hurt * 0.6) : e.hurt
  for (const h of targets) {
    let damage = base - h.defense + w.random.scaledInt(5)
    if (damage < 0) damage = 0
    if (!h.isAngry) h.angryValue += damage
    if (h.angryValue >= Math.trunc(h.hpMax * 0.8)) h.isAngry = true
    h.hp -= damage
    // 我方的血**夹到 0**（怪物的不夹 —— 那不对称正是原版本来的样子）。
    if (h.hp < 0) h.hp = 0
    pushHurt(w, damage, 1, h.showX, h.showY)
  }
}

// ================= 检查器 =================

/** `Check.checkEnemyDead()`：摘掉死掉的怪，全摘光就是胜利。 */
function checkEnemyDead(w: BattleWorld): void {
  const drop = (e: Enemy | null, clear: () => void) => {
    if (!e || e.hp > 0) return
    const at = w.enemies.indexOf(e)
    if (at >= 0) w.enemies.splice(at, 1)
    clear()
  }
  drop(w.em1, () => {
    w.em1 = null
    w.progressBar.enemy1X = 0
  })
  drop(w.em2, () => {
    w.em2 = null
    w.progressBar.enemy2X = 0
  })
  drop(w.em3, () => {
    w.em3 = null
    w.progressBar.enemy3X = 0
  })
  if (w.em1 || w.em2 || w.em3) return

  for (const h of w.heroes) h.exp += w.expToGet
  for (const h of w.heroes) {
    if (h.battleState.isUsable) {
      returnHeroState(h)
      clearState(h.battleState)
    }
  }
  for (const h of w.heroes) if (h.exp >= h.expToLevelUp) levelUp(h)
  for (const h of w.heroes) {
    // VictoryAnimation.start()
    h.isDraw = false
    h.deadAnimation.isDraw = false
    h.deadAnimation.isStop = true
    h.victoryAnimation.isDraw = true
    h.victoryAnimation.isStop = false
  }
  w.progressBar.isDraw = false
  w.victoryDrawn = true
  w.victoryStopped = false
}

/** `Check.checkHeroDead()`：怪物的技能播完之后检查我方。 */
function checkHeroDead(w: BattleWorld): void {
  for (const h of w.heroes) {
    if (h.hp > 0) continue
    h.isDead = true
    if (h.battleState.isUsable) {
      returnHeroState(h)
      clearState(h.battleState)
    }
    // DeadAnimation.start()
    h.isDraw = false
    h.deadAnimation.isDraw = true
    h.deadAnimation.isStop = false
  }
  if (!w.heroes.every((h) => h.isDead)) return
  // 原版这里还有一句 `MusicReader.readmusic("战斗失败.wav")`。**不实现，也不
  // 在真值里**：`readmusic` 走的是另一个 MusicPlayer，碰不到 `currentPlayingBGM`
  // ——而导出器的 `audio.bgm` 取的正是后者（音效有自己的观察点 tools.MusicLog，
  // 战斗驱动器没取它，归 xl-1vu.8）。这一句归渲染/音频那张票。
  w.progressBar.isDraw = false
  w.gameOver.isDraw = true
  w.gameOver.isStop = false
}

function levelUp(h: Hero): void {
  h.isLevelUp = true
  h.level++
  const d = h.spec.levelUpDelta
  h.physicalPower += d.physicalPower
  h.sprit += d.sprit
  h.agile += d.agile
  h.strength += d.strength
  h.exp -= h.expToLevelUp
  refreshValue(h)
  h.hp = h.hpMax
  h.mp = h.mpMax
  h.expToLevelUp = expToLevelUp(h.level)
}
