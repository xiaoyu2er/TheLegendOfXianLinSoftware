import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../compare/png'
import { repoPath } from '../test/repoPath'
import { BATTLE_TICK_MS, advanceBattle, createBattleTicker } from './loop'
import { snapshotBattle } from './snapshot'
import type { BattleInput } from './step'
import { createBattle } from './world'
import type { PaintState } from './render/paint'

/**
 * 「切到别的标签页再切回来，战斗不补跑」的可执行形式（xl-rh9.9 的验收标准之一）。
 *
 * 与场景那一侧（`state/loop.test.ts`）同一条不变量：**同样的总时长、同样的
 * 输入，分成几段喂进来，世界一模一样**。切后台无非是"某一段特别长"，切回来
 * 无非是"后面几段特别短"。
 *
 * 它挡住的是两种写法：把推进挂回逐帧回调（后台完全不触发，切回来一次爆发），
 * 或者给推进加一个"最多补跑 N 拍"的上限（后台跑出来的世界与前台不同）。
 * 后者会让下面第一条立刻红。
 *
 * ⚠️ 比的**不只是世界**：`PaintState` 里有自由跑的相位（游标、怒气槽的轮播）
 * 和带惯性的量（血条每拍走 1 px）。只比世界的话，一个"补跑时跳过血条动画"的
 * 实现照样绿，而它的表现是切回来血条与血量对不上。
 */

function spriteSize(name: string): { width: number; height: number } {
  const png = decodePng(readFileSync(repoPath('image/怪物', name, '1.png')))
  return { width: png.width, height: png.height }
}

/** battle-min 那一场：三人对三怪，种子照剧本。 */
function freshTicker() {
  return createBattleTicker(
    createBattle({
      background: 'image/背景图/伏魔山树林.png',
      party: ['zhang', 'yu', 'lu'],
      levels: { zhang: 5, yu: 5, lu: 5 },
      enemies: ['怪物1/5', '怪物2/6', '怪物2/7'],
      seed: 20260906,
      sprite: spriteSize,
    }),
  )
}

/** `PaintState` 里有 `Map`，`toEqual` 比得了，但转成普通对象读起来清楚得多。 */
function paintOf(p: PaintState) {
  return {
    bars: [...p.bars].sort(),
    angry: [...p.angry].sort(),
    mouse: p.mouse,
    buttons: p.buttons,
  }
}

/** 点「击」那一下 —— 与导出器点的是同一个点（真值里那 8 次点击都在这儿）。 */
const clickAttack: BattleInput[] = [{ e: 'click', x: 514, y: 325, target: 'command:attack' }]

function run(chunks: readonly number[], input: readonly BattleInput[]) {
  let ticker = freshTicker()
  let first = true
  for (const ms of chunks) {
    ticker = advanceBattle(ticker, first ? input : [], ms)
    first = false
  }
  return ticker
}

describe('战斗的定步长推进器', () => {
  it('一口气推进 20 秒，与 200 拍逐拍喂完全一致', () => {
    const burst = run([20000], [])
    const paced = run(Array(200).fill(BATTLE_TICK_MS), [])
    expect(snapshotBattle(burst.world)).toEqual(snapshotBattle(paced.world))
    expect(paintOf(burst.paint)).toEqual(paintOf(paced.paint))
  })

  it('60 Hz 的不规则帧长与"切后台再切回来"一次补齐一致', () => {
    // 16.7 ms 凑不满一拍（100 ms），余量必须攒着；攒漏了行动条就会差好几格。
    const frames: number[] = []
    for (let ms = 0; ms < 20000; ms += 16.7) frames.push(16.7)
    const half = Math.floor(frames.length / 2)
    // 前台跑一半 → 切后台（那一段特别长）→ 总时长与全程前台相同。
    const backgrounded = [...frames.slice(0, half), frames.slice(half).reduce((a, b) => a + b, 0)]
    expect(backgrounded.reduce((a, b) => a + b, 0)).toBeCloseTo(
      frames.reduce((a, b) => a + b, 0),
      6,
    )
    const bg = run(backgrounded, [])
    const fg = run(frames, [])
    expect(snapshotBattle(bg.world)).toEqual(snapshotBattle(fg.world))
    expect(paintOf(bg.paint)).toEqual(paintOf(fg.paint))
  })

  it('这 20 秒里战斗确实推进了 —— 否则上面两条比的是两个静止的世界', () => {
    const after = run([20000], []).world
    const before = freshTicker().world
    expect(after.tick).toBe(200)
    // 行动条真的在涨，而且已经有人跑满过（控制台弹出来过）。
    expect(after.progressBar.zhangX).not.toBe(before.progressBar.zhangX)
    expect(after.currentRound).not.toBe(0)
    // 血条那个带惯性的量也真的动过 —— 开场云雾播完之后怪物已经打过我方。
    expect(run([20000], []).paint.mouse.frame).not.toBeNull()
  })

  it('不满一拍的那一下点击不会丢', () => {
    let ticker = advanceBattle(freshTicker(), clickAttack, 40)
    // 40 ms 不到一拍：世界一拍都没走，点击攒着。
    expect(ticker.world.tick).toBe(0)
    expect(ticker.pending).toHaveLength(1)
    ticker = advanceBattle(ticker, [], 60)
    expect(ticker.world.tick).toBe(1)
    expect(ticker.pending).toHaveLength(0)
    // 那一下点击真的被施加了：游标坐标被写成了点击处。拿它当判据而不是按钮
    // 贴图 —— 开场第 1 拍控制台还没弹出来（`command.isDraw` 为假），而三个
    // 鼠标监听器都套着那个判断，所以贴图**本来就该不动**。拿贴图当判据的话
    // 这条会红在一件正确的事情上。
    expect([ticker.world.currentX, ticker.world.currentY]).toEqual([514, 325])
  })

  it('时间倍率乘在真实毫秒上：2× 跑 T 与 1× 跑 2T 逐字段相同', () => {
    // 与 `state/loop.test.ts` 同一条判据。乘在**步长**上是最顺手的写法，
    // 而那会跳过定时器的触发时刻 —— 这里的表现是行动条一步跨两格。
    let fast = createBattleTicker(freshTicker().world, 2)
    let slow = freshTicker()
    for (let i = 0; i < 100; i++) {
      fast = advanceBattle(fast, [], 100)
      slow = advanceBattle(slow, [], 200)
    }
    expect(snapshotBattle(fast.world)).toEqual(snapshotBattle(slow.world))
  })

  it('倍率非正 —— 抛，不当成 1', () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(() => createBattleTicker(freshTicker().world, bad)).toThrow(/时间倍率/)
    }
  })
})
