import type { BattleWorld, Enemy, Hero } from './types'

/**
 * 把世界快照成**行为真值那一行的形状**（`docs/trace-format.md` §trace 的每一步
 * 记什么）。字段名、字段个数、嵌套层级全部与
 * `tools/src/devtools/BattleDriver.snapshotState` 逐字对应 —— 逐字段比对时
 * `toEqual` 直接就能对上，不必在测试里翻译一道。
 *
 * 快照是**只读拷贝**：它把 `hp` 之类的数抄出来，不共享引用。
 */

export interface StateSnapshot {
  type: number
  rounds: number
  usable: boolean
  role: number
}

export interface HeroSnapshot {
  code: number
  hp: number
  hpMax: number
  mp: number
  mpMax: number
  angry: number
  isAngry: boolean
  dead: boolean
  speed: number
  drawn: boolean
  frame: number
  state: StateSnapshot
}

export interface EnemySnapshot {
  slot: number
  name: string
  hp: number
  speed: number
  onField: boolean
  dead: boolean
  drawn: boolean
  frame: number
  state: StateSnapshot
  box: [number, number, number, number]
}

export interface HurtSnapshot {
  value: number
  type: number
  x: number
  y: number
  drawn: boolean
  frame: number
}

export interface BattleSnapshot {
  outcome: 'undecided' | 'victory' | 'defeat'
  round: number
  pattern: number
  beAttacked: number
  bar: {
    origin: number
    zhang: number
    yu: number
    lu: number
    pet: number
    e1: number
    e2: number
    e3: number
    stopped: boolean
    drawn: boolean
  }
  heroes: HeroSnapshot[]
  /** 三项，空槽位是 `null`。 */
  enemies: (EnemySnapshot | null)[]
  hurts: HurtSnapshot[]
  ui: {
    command: boolean
    skillMenu: boolean
    drugMenu: boolean
    selectable: boolean
    instruct: boolean
    reminder: boolean
    victory: boolean
    gameOver: boolean
    startAnim: boolean
  }
  anim: {
    skill: string | null
    skillFrame: number
    skillDrawn: boolean
    skillX: number
    skillY: number
    bg: string | null
    bgFrame: number
    bgDrawn: boolean
  }
  audio: { bgm: string | null }
}

/**
 * 胜负。**先判失败**：两个标志由不同的检查置位，判反了会让一场输掉的仗被记成
 * 赢（同 `BattleDriver.outcome()`）。
 */
export function outcomeOf(w: BattleWorld): BattleSnapshot['outcome'] {
  if (w.gameOver.isDraw) return 'defeat'
  if (w.victoryDrawn) return 'victory'
  return 'undecided'
}

function stateOf(s: { type: number; roundNum: number; isUsable: boolean; roleCode: number }) {
  return { type: s.type, rounds: s.roundNum, usable: s.isUsable, role: s.roleCode }
}

function heroOf(h: Hero): HeroSnapshot {
  return {
    code: h.roleCode,
    hp: h.hp,
    hpMax: h.hpMax,
    mp: h.mp,
    mpMax: h.mpMax,
    angry: h.angryValue,
    isAngry: h.isAngry,
    dead: h.isDead,
    speed: h.speed,
    drawn: h.isDraw,
    frame: h.code,
    state: stateOf(h.battleState),
  }
}

/**
 * 第三个槽位的框高取的是**第一只怪**图片的高（`height1`）—— xl-1dv.8，
 * 这里不"顺手改成 height3"。判据在 `state/battleEnemyBox.test.ts`（它验的是**真值**忠不忠于原版）
 * 与 `battle/battleTrace.test.ts`（它验的是**这一层**推出来的框）。
 */
function boxOf(w: BattleWorld, slot: number): [number, number, number, number] {
  const s = w.selector
  if (slot === 1) return [s.x1, s.y1, s.width1, s.height1]
  if (slot === 2) return [s.x2, s.y2, s.width2, s.height2]
  return [s.x3, s.y3, s.width3, s.height1]
}

function enemyOf(w: BattleWorld, e: Enemy, slot: number): EnemySnapshot {
  const live = [w.em1, w.em2, w.em3][slot - 1]
  return {
    slot,
    name: e.name,
    hp: e.hp,
    speed: e.speed,
    // 还在场上 = 还没被 `Check.checkEnemyDead` 从 `em1/em2/em3` 摘掉。
    onField: live === e,
    dead: e.isDead,
    drawn: e.isDraw,
    frame: e.code,
    state: stateOf(e.battleState),
    box: boxOf(w, slot),
  }
}

export function snapshotBattle(w: BattleWorld): BattleSnapshot {
  const p = w.progressBar
  return {
    outcome: outcomeOf(w),
    round: w.currentRound,
    pattern: w.currentPattern,
    beAttacked: w.currentBeAttacked,
    bar: {
      origin: p.barX,
      zhang: p.zhangX,
      yu: p.yuX,
      lu: p.luX,
      pet: p.petX,
      e1: p.enemy1X,
      e2: p.enemy2X,
      e3: p.enemy3X,
      stopped: p.isStop,
      drawn: p.isDraw,
    },
    // 快照读的是**出战名单**，不是 `bp.heroes` —— 后者在打输出口的末尾被清空。
    heroes: w.party.map(heroOf),
    enemies: w.slots.map((e, i) => (e === null ? null : enemyOf(w, e, i + 1))),
    hurts: w.hurtValues.map((h) => ({
      value: h.hurt,
      type: h.type,
      x: h.x,
      y: h.y,
      drawn: h.isDraw,
      frame: h.code,
    })),
    ui: {
      command: w.command.isDraw,
      skillMenu: w.skillMenuDrawn,
      drugMenu: w.drugMenuDrawn,
      selectable: w.selector.isSlectable,
      instruct: w.instruct.isDraw,
      reminder: w.reminder.isDraw,
      victory: w.victoryDrawn,
      gameOver: w.gameOver.isDraw,
      startAnim: w.startAnimation.isDraw,
    },
    anim: {
      skill: w.skillAnimation.named ? w.skillAnimation.name : null,
      skillFrame: w.skillAnimation.code,
      skillDrawn: w.skillAnimation.isDraw,
      skillX: w.skillAnimation.x,
      skillY: w.skillAnimation.y,
      bg: w.backgroundAnimation.name,
      bgFrame: w.backgroundAnimation.code,
      bgDrawn: w.backgroundAnimation.isDraw,
    },
    audio: { bgm: w.bgm },
  }
}
