import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../compare/png'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import { BATTLE_TICK_MS, advanceBattle, createBattleTicker } from './loop'
import { createBufferPlan } from './render/bufferPlan'
import { battleDrawList } from './render/drawList'
import type { BattleTicker } from './loop'
import { replayBattle } from './replay'
import { snapshotBattle } from './snapshot'
import { BattleThreadDied, checkEnemyDead } from './step'
import { readBattleTrace } from './trace'
import type { BattleWorld } from './types'

/**
 * 全灭时第一槽的怪已先被打死（xl-9go）：原版在 `GameOver.update()` 里读
 * `bp.em1.name`，而 `Check.checkEnemyDead()` 早把死掉的 em1 置空了 → NPE。
 *
 * NPE 之后原版是什么样子，由 `BattlePanel.run()` 的形状决定：try/catch **只包着
 * `Clock.sleep(100)`**，循环体其余部分在 try 外，所以异常直接冲出 `run()`，
 * **战斗那条线程死掉**。面板还是战斗面板（没人 `switchTo`），`repaint()` 再也没人
 * 调，画面停在全灭图对开满的那一帧；场景那条线程是另一条，照跑。
 *
 * web 这边照这个样子：`step.ts` 在那一句抛 `BattleThreadDied`，`advanceBattle`
 * **只接这一类**，从此这一场一拍都不再推。别的抛照旧冒泡 —— 那些是移植层自己的
 * 守卫，吞掉等于把「没移植」伪装成「原版就这样」。
 */

function spriteSize(name: string): { width: number; height: number } {
  const png = decodePng(readFileSync(repoPath('image/怪物', name, '1.png')))
  return { width: png.width, height: png.height }
}

/**
 * `battle-defeat-start` 推到全灭图刚起头那一拍，再把第一槽的怪按
 * `Check.java:19-23` 逐句摘掉 —— 等于「它在全灭之前先被打死了」。
 * 这份真值一条输入都没有（178 拍全是空的），所以空推就是照真值推。
 */
function defeatWithEmptySlot1(): BattleTicker {
  const trace = readBattleTrace('battle-defeat-start')
  let t = createBattleTicker(replayBattle(trace, spriteSize))
  for (let i = 0; i < trace.tickCount && !t.world.gameOver.isDraw; i++) t = advanceBattle(t, [], BATTLE_TICK_MS)
  const w = t.world
  expect(w.gameOver.isDraw).toBe(true)
  expect(w.gameOver.code).toBe(0)
  killSlot1(w)
  return t
}

/** 第一槽的怪在全灭之前先被打死：血置 0，交给 `Check.checkEnemyDead` 的移植去摘。 */
function killSlot1(w: BattleWorld): void {
  const em1 = w.em1
  if (em1 === null) throw new Error('全灭时第一槽本来就有怪 —— 前提变了')
  em1.hp = 0
  checkEnemyDead(w)
  if (w.em1 !== null || w.em2 === null) throw new Error('摘完应当只空第一槽 —— 前提变了')
}

/** 全灭图 64 拍对开满、再数 10 下：一共 73 次 update（见 `updateGameOver`）。多给一截。 */
const PAST_GAME_OVER_MS = 100 * BATTLE_TICK_MS

describe('全灭时第一槽已空：战斗线程死掉，画面停住', () => {
  it('原版的形状：run() 的 try 只包着 sleep，gameOver.update() 在 try 外；GameOver 读 em1.name 不判空', () => {
    const src = javaSource('src/battle/BattlePanel.java').replace(/\r/g, '')
    const runAt = src.indexOf('public void run()')
    expect(runAt).toBeGreaterThanOrEqual(0)
    const run = src.slice(runAt)
    const tryAt = run.indexOf('try {')
    const catchAt = run.indexOf('} catch (Exception e) {')
    const updateAt = run.indexOf('gameOver.update();')
    expect([tryAt, catchAt, updateAt].every((i) => i >= 0)).toBe(true)
    // try 块里除了注释只有那一句 sleep。
    const body = run
      .slice(tryAt + 'try {'.length, catchAt)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('//'))
    expect(body).toEqual(['Clock.sleep(100);'])
    // gameOver.update() 在那个 catch 之后；从 run() 到文件末尾只有这一个 catch
    // （run() 是最后一个方法，所以这等于 run() 里只有这一个）。
    expect(updateAt).toBeGreaterThan(catchAt)
    expect(run.split('catch').length - 1).toBe(1)

    const go = javaSource('src/battle/GameOver.java')
    expect(go).toContain('if(bp.em1.name.equals("罹年居士")){')
  })

  it('不抛；死因记在推进器上，面板哪儿都不去', () => {
    const t = advanceBattle(defeatWithEmptySlot1(), [], PAST_GAME_OVER_MS)
    expect(t.died).toBeInstanceOf(BattleThreadDied)
    expect(t.died?.message).toMatch(/GameOver/)
    expect(t.world.exitPanel).toBeNull()
    // 死在数到 10 的那一下：之前那几句（code++）已经落了，之后那几句一句没跑。
    expect(t.world.gameOver.code).toBe(10)
    expect(t.world.gameOver.isStop).toBe(false)
  })

  it('死了之后空推：世界、画面状态、拍号一个字都不动', () => {
    const dead = advanceBattle(defeatWithEmptySlot1(), [], PAST_GAME_OVER_MS)
    const world = snapshotBattle(dead.world)
    const tick = dead.world.tick
    const paint = JSON.stringify([...dead.paint.bars, ...dead.paint.angry, dead.paint.mouse, dead.paint.buttons])
    const later = advanceBattle(dead, [], 50 * BATTLE_TICK_MS)
    expect(later.died).toBe(dead.died)
    expect(snapshotBattle(later.world)).toEqual(world)
    expect(later.world.tick).toBe(tick)
    expect(JSON.stringify([...later.paint.bars, ...later.paint.angry, later.paint.mouse, later.paint.buttons])).toBe(
      paint,
    )
    expect(later.pending).toEqual([])
    expect(later.sfx).toEqual([])
    expect(later.carryMs).toBe(dead.carryMs)
  })

  /**
   * 原版的键鼠监听挂在 Swing 事件线程上（xl-jkt），战斗线程死了它们照样跑：
   * `GameLauncher.keyPressed` 把 J 转给 `BattlePanel.keyPressed` → `Check.checkEnemyDead()`，
   * 三个槽全空、`heroes.clear()` 死在它前面没跑到 —— 于是每个英雄一声「战斗胜利」，经验与升级照改。
   * 画面不动：`repaint()` 在循环体末尾，再没人调。
   */
  it('死了之后按 J：照原版改状态、每个英雄一声胜利；拍号不动，画面不再合成', () => {
    const dead = advanceBattle(defeatWithEmptySlot1(), [], PAST_GAME_OVER_MS)
    const w = dead.world
    const heroes = w.heroes.length
    expect(heroes, '全灭时英雄名单是空的 —— 下面几条测不到东西').toBeGreaterThan(0)
    const get = w.victoryReminder.expToGet
    expect(get, '这一场没有经验可发 —— 经验那条恒真').toBeGreaterThan(0)
    // 期望值在按之前记下来（`Check.checkEnemyDead`：先加经验，够了就升一级、扣掉那一级的门槛）。
    const expected = w.heroes.map((h) => {
      const exp = h.exp + get
      return exp >= h.expToLevelUp ? { level: h.level + 1, exp: exp - h.expToLevelUp } : { level: h.level, exp }
    })
    const code = w.gameOver.code
    const tick = w.tick
    const before = battleDrawList(w, dead.paint)
    // 死之前最后一次合成的就是这个拍号（死的那一拍抛在 `w.tick++` 之前）。
    const plan = createBufferPlan()
    plan.next(tick)

    const pressed = advanceBattle(dead, [{ e: 'key', key: 'j' }], BATTLE_TICK_MS)
    expect(pressed.sfx).toEqual(Array.from({ length: heroes }, () => '战斗胜利.MP3'))
    expect(w.heroes.map((h) => ({ level: h.level, exp: h.exp }))).toEqual(expected)
    // 循环体一句没跑：全灭图的计数器、拍号都停在死的那一刻。
    expect(w.gameOver.code).toBe(code)
    expect(w.tick).toBe(tick)
    // 这一下真把画面该画的东西改了（英雄换成胜利动画）—— 所以「不合成」是承重的：
    expect(battleDrawList(w, pressed.paint)).not.toEqual(before)
    expect(plan.next(w.tick)).toBe('skip')

    // 原版没有门：再按一次，胜利那一段再跑一遍、再响一轮。
    const again = advanceBattle(pressed, [{ e: 'key', key: 'j' }], 0)
    expect(again.sfx).toHaveLength(heroes)
    // 空推一次，音效不重播。
    expect(advanceBattle(again, [], BATTLE_TICK_MS).sfx).toEqual([])
  })

  it('死了之后移鼠标：监听器照样记下坐标', () => {
    const dead = advanceBattle(defeatWithEmptySlot1(), [], PAST_GAME_OVER_MS)
    const at = { x: dead.world.currentX + 37, y: dead.world.currentY + 11 }
    advanceBattle(dead, [{ e: 'move', ...at }], 0)
    expect({ x: dead.world.currentX, y: dead.world.currentY }).toEqual(at)
  })

  it('死的是那一拍，不是那一批：同一批里它之前的几拍照常算', () => {
    // 一口气推一大段与逐拍推，死的那一刻世界相同 —— 抛在哪一拍就停在哪一拍。
    let fine = defeatWithEmptySlot1()
    while (fine.died === null) fine = advanceBattle(fine, [], BATTLE_TICK_MS)
    const bulk = advanceBattle(defeatWithEmptySlot1(), [], PAST_GAME_OVER_MS)
    expect(snapshotBattle(bulk.world)).toEqual(snapshotBattle(fine.world))
    expect(bulk.world.tick).toBe(fine.world.tick)
  })

  it('只接这一类：移植层自己的守卫照旧抛', () => {
    const t = defeatWithEmptySlot1()
    expect(() => advanceBattle(t, [{ e: 'key', key: 'x' as 'j' }], BATTLE_TICK_MS)).toThrow(/只认 J/)
  })
})
