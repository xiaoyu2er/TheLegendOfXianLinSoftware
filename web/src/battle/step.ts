import { expToLevelUp, refreshValue } from './units'
import type {
  BattleState,
  BattleWorld,
  BeAttackedAnim,
  Enemy,
  Hero,
  HurtValue,
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
  for (const e of w.enemies) checkState(w, e.battleState)
  launchAttackCheck(w)
  // stateBlank.update() 与 angryBar.update() 只改血条/怒气槽的**像素宽度**，
  // 一个字段都不在这份真值里（导出器 snapshotState 没取它们）。归渲染那张票。
  updateVictoryReminder(w)
  for (const h of w.heroes) checkState(w, h.battleState)
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
  if (input.target.startsWith('command:')) mouseReleased(w, input.x, input.y)
  else if (!input.target.startsWith('enemy:')) {
    throw new Error(`没见过的点击目标 ${input.target}`)
  }
}

function mouseMoved(w: BattleWorld, x: number, y: number): void {
  w.currentX = x
  w.currentY = y
  // GameButton.isMoveIn 只换按钮贴图，没有任何状态后果，这一层不实现。
  selectorMoveIn(w, x, y)
}

function mousePressed(w: BattleWorld, x: number, y: number): void {
  w.currentX = x
  w.currentY = y
  if (w.command.isDraw) {
    for (const b of commandButtons(w)) if (hit(b, x, y)) b.isclicked = true
  }
  if (w.selector.isSlectable) selectorClick(w, x, y)
}

function mouseReleased(w: BattleWorld, x: number, y: number): void {
  w.currentX = x
  w.currentY = y
  if (!w.command.isDraw) return
  const c = w.command
  if (c.attack.isclicked) {
    c.isDraw = false
    w.currentPattern = 1
    w.selector.isSlectable = true
  }
  if (c.skill.isclicked || c.thing.isclicked || c.defend.isclicked) {
    throw new Error(
      '技 / 物 / 防 三个按钮还没实现：技能菜单、药品菜单与秘术都不在 battle-min ' +
        '这一场里，四份战斗真值一份都没点过它们。归 xl-rh9.9。',
    )
  }
  for (const b of commandButtons(w)) if (hit(b, x, y)) b.isclicked = false
}

function commandButtons(w: BattleWorld) {
  return [w.command.attack, w.command.skill, w.command.defend, w.command.thing]
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

function updateProgress(w: BattleWorld): void {
  const p = w.progressBar
  if (p.isStop || !p.isDraw) return
  const behind = (v: number) => v - p.barX < 400
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
  if (p.zhangX - p.barX >= 400) startHeroRound(1)
  else if (p.yuX - p.barX >= 400) startHeroRound(2)
  else if (p.luX - p.barX >= 400) startHeroRound(3)
  else if (p.petX - p.barX >= 400) {
    throw new Error('小精灵的回合还没实现（陆雪琪的秘术才召得出它）—— 归 xl-rh9.9')
  } else if (w.em1 && p.enemy1X - p.barX >= 400) startEnemyRound(5, w.em1)
  else if (w.em2 && p.enemy2X - p.barX >= 400) startEnemyRound(6, w.em2)
  else if (w.em3 && p.enemy3X - p.barX >= 400) startEnemyRound(7, w.em3)
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

function instructStart(w: BattleWorld): void {
  w.instruct.isDraw = true
  w.instruct.isStop = false
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
    r.dy1 = 120
    r.dy2 = 120
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
  if (s.leftX < 1024) s.leftX += 30
  else {
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
 * `GameOver.update()` —— 全灭图对开、72 步之后按第一只怪的名字分岔（回地图 /
 * 回标题）。两条出口各有一份行为真值，归 **xl-rh9.8**。同上，第一拍改的
 * （`lsx2` 那几个像素）不在真值里，第二拍起就是了。
 */
function updateGameOver(w: BattleWorld): void {
  if (w.gameOverStopped) return
  w.gameOverUpdates++
  if (w.gameOverUpdates > 1) {
    throw new Error(
      'GameOver.update() 跑到了第二拍 —— 打输的两条出口（罹年居士回地图 / 其余回标题）' +
        '还没有实现，归 xl-rh9.8。',
    )
  }
}

// ================= 战斗状态 =================

function checkState(w: BattleWorld, s: BattleState): void {
  if (!s.isUsable) return
  if (w.currentRound === s.roleCode && s.isCheck) {
    s.isCheck = false
    if (s.roundNum > 0) {
      s.roundNum--
      // excuteState 只对中毒（type 9）有动作，而中毒只由技能挂上。
      if (s.type === 9) throw new Error('中毒状态的每回合结算还没实现（只有技能挂得上）—— 归 xl-rh9.9')
    } else {
      returnFromState(w, s)
      clearState(s)
    }
  }
  if (w.currentRound !== s.roleCode) s.isCheck = true
}

function returnFromState(w: BattleWorld, s: BattleState): void {
  if (s.type !== 0) {
    throw new Error(`战斗状态 ${s.type} 的恢复还没实现（状态只由技能挂得上）—— 归 xl-rh9.9`)
  }
  void w
}

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
  } else if (w.currentPattern !== 0) {
    throw new Error(
      `我方的第 ${w.currentPattern} 号招式（技能 / 秘术）还没实现 —— ` +
        '四份战斗真值一次都没用过它们，归 xl-rh9.9。',
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
function setSkillAnimation(
  w: BattleWorld,
  spec: {
    name: string
    length: number
    x: number
    y: number
    beAttackedCode: number
    beAttackedTimes: number
    runCode: number
    attackCode: number
    withdrawCode: number
    offsetTo1: number
    offsetTo2: number
    offsetTo3: number
  },
): void {
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

/** `ZhangXiaoFan/YuJie/LuXueQi.calDamage()` 的普通攻击那一路。 */
function heroCalDamage(w: BattleWorld, h: Hero): void {
  const targets: Enemy[] = []
  if (w.currentBeAttacked === 5 && w.em1) targets.push(w.em1)
  if (w.currentBeAttacked === 6 && w.em2) targets.push(w.em2)
  if (w.currentBeAttacked === 7 && w.em3) targets.push(w.em3)
  if (w.currentBeAttacked === 8) for (const e of [w.em1, w.em2, w.em3]) if (e) targets.push(e)
  for (const e of targets) {
    let damage = h.hurt - e.defense + w.random.scaledInt(15)
    if (damage < 0) damage = 0
    // xl-1dv.9：怪物血量**不夹到 0**，致命一击打过头就是负的。
    e.hp -= damage
    pushHurt(w, damage, 1, e.x, e.y)
  }
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
      returnFromState(w, h.battleState)
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
      returnFromState(w, h.battleState)
      clearState(h.battleState)
    }
    // DeadAnimation.start()
    h.isDraw = false
    h.deadAnimation.isDraw = true
    h.deadAnimation.isStop = false
  }
  if (!w.heroes.every((h) => h.isDead)) return
  w.progressBar.isDraw = false
  w.gameOverDrawn = true
  w.gameOverStopped = false
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
  Object.assign(h, refreshValue(h))
  h.hp = h.hpMax
  h.mp = h.mpMax
  h.expToLevelUp = expToLevelUp(h.level)
}
