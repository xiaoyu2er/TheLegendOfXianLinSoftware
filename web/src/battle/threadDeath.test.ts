import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../compare/png'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import { BATTLE_TICK_MS, advanceBattle, createBattleTicker } from './loop'
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

  // ⚠️ 「输入也不收」**不是**原版：原版的键鼠监听在 Swing 事件线程上，线程死了照样改状态
  // （按 J 还会出胜利音效、涨经验）。没做、不是故意不复刻 —— 见 xl-jkt。
  it('死了之后再推：世界、画面状态、拍号一个字都不动，输入也不收', () => {
    const dead = advanceBattle(defeatWithEmptySlot1(), [], PAST_GAME_OVER_MS)
    const world = snapshotBattle(dead.world)
    const tick = dead.world.tick
    const paint = JSON.stringify([...dead.paint.bars, ...dead.paint.angry, dead.paint.mouse, dead.paint.buttons])
    const later = advanceBattle(dead, [{ e: 'move', x: 300, y: 200 }], 50 * BATTLE_TICK_MS)
    expect(later.died).toBe(dead.died)
    expect(snapshotBattle(later.world)).toEqual(world)
    expect(later.world.tick).toBe(tick)
    expect(JSON.stringify([...later.paint.bars, ...later.paint.angry, later.paint.mouse, later.paint.buttons])).toBe(
      paint,
    )
    expect(later.pending).toEqual([])
    expect(later.sfx).toEqual([])
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
