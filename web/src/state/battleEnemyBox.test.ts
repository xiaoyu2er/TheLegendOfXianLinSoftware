import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../compare/png'
import { repoPath } from '../test/repoPath'
import { readTrace, traceNamesOf } from './trace'

/**
 * 怪物选择框（`EnemySlector`）在战斗真值里长什么样，以及 **xl-1dv.8 在真值里
 * 到底看不看得见**。
 *
 * 原版的 `EnemySlector` 给三个槽位各量了一份图片尺寸，可 `checkMoveIn` 与
 * `checkClick` 判第三只怪时写的是 `height1` —— 第一只怪图片的高。所以第三个
 * 槽位的命中框，高取的是**别人的**高。
 *
 * 这个缺陷在 `battle-min` 那一场里是**潜伏的**：剧情1 的三只怪（怪物1 / 怪物2
 * ×2）图片都是 172 高，`height1` 恰好等于 `height3`，写错了和写对了导出来的
 * 数一模一样。所以 xl-1vu.10 又导了一场 em1 与 em3 高度不同的遭遇
 * （`battle-em3-box`，取自 `script/脚本20.txt` 第 3 行的 Fight 数据）。
 *
 * 下面的判据是**双向**的：
 *
 * - 第三个槽位的框高不等于 `height1` → 红（真值不再忠实于原版，或者有人"顺手
 *   改对了"导出器 —— 真值的职责是记录原版做了什么）；
 * - **一份都没有**这种 em1≠em3 的真值 → 也红，因为那说明缺陷又变回不可观测的
 *   了，而"缺陷不存在"与"缺陷看不见"长得一模一样。
 *
 * 尺寸不写死：现从 `image/怪物/<名字>/1.png` 的 IHDR 里读 —— `EnemySlector`
 * 量的就是 `Images.get(0)`，也就是这张图。
 *
 * **空槽位是 `null`。** 原版的 Fight 数据一行可以只写一只怪（`脚本22` 的
 * 罹年居士就是独自一只），真值里那两个槽位写的是 `null` —— 对象根本没建，
 * 没有名字也没有框。所以下面每一条都先滤掉 `null` 再断言：分母仍然是「三个
 * 槽位」，被断言的只是站着人的那些。
 */

interface BattleEnemy {
  readonly slot: number
  readonly name: string
  /** `[x, y, width, height]` —— `EnemySlector` 那一组字段，第三槽的高是 `height1`。 */
  readonly box: readonly [number, number, number, number]
}

interface BattleTick {
  /** 三项，一项一个槽位；空槽位是 `null`。 */
  readonly enemies: readonly (BattleEnemy | null)[]
}

const BATTLE_TRACE_NAMES = traceNamesOf('battle')

/** 怪物出场那张图（`Images.get(0)`）的像素尺寸。 */
function spriteSize(name: string): { width: number; height: number } {
  const png = decodePng(readFileSync(repoPath('image/怪物', name, '1.png')))
  return { width: png.width, height: png.height }
}

function enemiesOf(traceName: string): readonly (BattleEnemy | null)[] {
  const trace = readTrace(traceName)
  const ticks = trace.ticks as unknown as readonly BattleTick[]
  const first = ticks[0]
  if (!first) throw new Error(`${traceName} 一个 tick 都没有`)
  return first.enemies
}

/** 第 slot 槽（1/2/3）上站着的怪物；空槽位返回 null。 */
function at(enemies: readonly (BattleEnemy | null)[], slot: number): BattleEnemy | null {
  return enemies[slot - 1] ?? null
}

describe('战斗真值里的怪物选择框', () => {
  it('每一场都是三个槽位，且框的 x/y/宽 与出场图逐个对上', () => {
    // 分母从磁盘现数（driver=battle 的真值有几份就跑几份），一份都没有时
    // traceNamesOf 会抛，而不是让这一整个 describe 静静地全绿。
    expect(BATTLE_TRACE_NAMES.length).toBeGreaterThan(0)
    for (const name of BATTLE_TRACE_NAMES) {
      const enemies = enemiesOf(name)
      // 槽位数一律是 3（空槽位写 null），槽位号按位置对上。
      expect(enemies.length, `${name} 的槽位数`).toBe(3)
      expect(
        enemies.map((e, i) => e?.slot ?? i + 1),
        `${name} 的槽位号`,
      ).toEqual([1, 2, 3])
      for (const e of enemies) {
        if (!e) continue
        // 宽是三个槽位各量各的，没有 xl-1dv.8 那个错位，所以它必须严格相等。
        expect(e.box[2], `${name} 第 ${e.slot} 槽（${e.name}）的框宽`).toBe(spriteSize(e.name).width)
      }
    }
  })

  it('前两个槽位的框高等于自己的图高，第三个槽位等于第一只怪的图高（xl-1dv.8）', () => {
    for (const name of BATTLE_TRACE_NAMES) {
      const enemies = enemiesOf(name)
      const em1 = at(enemies, 1)
      if (!em1) throw new Error(`${name} 第 1 槽是空的 —— 原版的 height1 就无从谈起`)
      const h1 = spriteSize(em1.name).height
      for (const e of enemies) {
        if (!e) continue
        // 原版 EnemySlector.checkMoveIn / checkClick 判第三只怪时用的是 height1。
        const expected = e.slot === 3 ? h1 : spriteSize(e.name).height
        expect(e.box[3], `${name} 第 ${e.slot} 槽（${e.name}）的框高`).toBe(expected)
      }
    }
  })

  it('选择框在整场战斗里一动不动 —— 所以上面按第 0 tick 读是够的', () => {
    for (const name of BATTLE_TRACE_NAMES) {
      const ticks = readTrace(name).ticks as unknown as readonly BattleTick[]
      const boxes = (tick: BattleTick) => JSON.stringify(tick.enemies.map((e) => e?.box ?? null))
      const first = boxes(ticks[0]!)
      for (let t = 1; t < ticks.length; t++) {
        expect(boxes(ticks[t]!), `${name} 第 ${t} tick`).toBe(first)
      }
    }
  })

  it('至少有一份真值里第三个槽位的框高与它自己的图高不相等 —— 否则 xl-1dv.8 又看不见了', () => {
    const observable = BATTLE_TRACE_NAMES.filter((name) => {
      const enemies = enemiesOf(name)
      const em1 = at(enemies, 1)
      const em3 = at(enemies, 3)
      // 第 3 槽空着的那些场次（如 battle-defeat-scene，罹年居士独自一只）
      // 观测不到这条缺陷 —— 它们不算进分子，也不该让这条判据报错。
      if (!em1 || !em3) return false
      return spriteSize(em1.name).height !== spriteSize(em3.name).height
    })
    expect(
      observable.length,
      'driver=battle 的真值里，em1 与 em3 的图高全都一样 —— ' +
        'EnemySlector 用 height1 判 em3 这件事在真值里没有一处观测得到，' +
        '写对了和写错了导出来的数完全相同。要么补一场 em1≠em3 的遭遇，要么这条判据作废。',
    ).toBeGreaterThan(0)

    for (const name of observable) {
      const enemies = enemiesOf(name)
      const em1 = at(enemies, 1)!
      const em3 = at(enemies, 3)!
      const h1 = spriteSize(em1.name).height
      const h3 = spriteSize(em3.name).height
      // 差值是可核的：框高比真实图高多出来（或少掉）的正是 height1 - height3。
      expect(em3.box[3] - h3, `${name} 第 3 槽的框高偏差`).toBe(h1 - h3)
      expect(em3.box[3], `${name} 第 3 槽的框高`).not.toBe(h3)
    }
  })
})
