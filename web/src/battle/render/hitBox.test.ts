import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../../compare/png'
import { repoPath } from '../../test/repoPath'
import { stepBattle } from '../step'
import type { BattleWorld, GameButton } from '../types'
import { createBattle } from '../world'
import { hitsButton, hitsEnemy } from './hitBox'

/**
 * 按钮命中框那个 **−15 / −6** 的偏移（ADR-0001，原版缺陷照抄）。
 *
 * 三条判据，一条比一条硬：
 *
 * 1. **边界四条**：矩形的四条边在哪、是开是闭 —— 直接扫过去，不手写坐标。
 * 2. **与状态层交叉验证**：同一批点真的喂给 `stepBattle`，看它认不认。
 *    `step.ts` 里那个 `hit()` 是另一份实现（没导出），两份互为判据；哪天
 *    有人只改了一边，这一条立刻红。
 * 3. **偏移不是装饰**：真的存在一批点，抹掉偏移之后判定会翻。把那批点数
 *    出来 —— 数不出来的话，前两条就都是在验一件不存在的事。
 */

function spriteSize(name: string): { width: number; height: number } {
  const png = decodePng(readFileSync(repoPath('image/怪物', name, '1.png')))
  return { width: png.width, height: png.height }
}

/** 一场干净的 battle-min，用来当命中判定的靶子。 */
function freshWorld(): BattleWorld {
  return createBattle({
    background: 'image/背景图/伏魔山树林.png',
    party: ['zhang', 'yu', 'lu'],
    levels: { zhang: 5, yu: 5, lu: 5 },
    enemies: ['怪物1/5', '怪物2/6', '怪物2/7'],
    seed: 20260906,
    sprite: spriteSize,
  })
}

/** 没有偏移的那个版本 —— 只在这个文件里存在，用来量"偏移改变了什么"。 */
function hitsWithoutOffset(b: GameButton, x: number, y: number): boolean {
  return x > b.x && x < b.x + b.width && y > b.y && y < b.y + b.height
}

describe('按钮命中框：左偏 15、上偏 6，四边严格不等号', () => {
  const button = freshWorld().command.attack

  it('按钮就是画在 (500,300) 的 58×62', () => {
    // 下面每一条边界都从这四个数算出来。它们变了，这个文件里其它断言的
    // 意义也就变了，所以先钉住。
    expect([button.x, button.y, button.width, button.height]).toEqual([500, 300, 58, 62])
  })

  it('横向：命中区间是 (x−15, x+width−15) 的开区间', () => {
    const y = button.y + 10 // 纵向落在里面，只扫横向
    const inside = []
    for (let x = button.x - 40; x <= button.x + button.width + 10; x++) {
      if (hitsButton(button, x, y)) inside.push(x)
    }
    // 开区间：左端 x−15 本身不算命中，x−15+1 才算；右端同理。
    expect(inside[0]).toBe(button.x - 15 + 1)
    expect(inside[inside.length - 1]).toBe(button.x + button.width - 15 - 1)
    expect(inside.length).toBe(button.width - 1)
  })

  it('纵向：命中区间是 (y−6, y+height−6) 的开区间', () => {
    const x = button.x + 10 - 15
    const inside = []
    for (let y = button.y - 30; y <= button.y + button.height + 10; y++) {
      if (hitsButton(button, x, y)) inside.push(y)
    }
    expect(inside[0]).toBe(button.y - 6 + 1)
    expect(inside[inside.length - 1]).toBe(button.y + button.height - 6 - 1)
    expect(inside.length).toBe(button.height - 1)
  })

  it('偏移不是装饰：真的有一批点因为它而判反 —— 抹掉偏移这条立刻变 0', () => {
    // 分母数得出来：把画出来的矩形往外放 20 圈，逐点比两个版本。
    let differ = 0
    let same = 0
    for (let x = button.x - 20; x <= button.x + button.width + 20; x++) {
      for (let y = button.y - 20; y <= button.y + button.height + 20; y++) {
        if (hitsButton(button, x, y) === hitsWithoutOffset(button, x, y)) same++
        else differ++
      }
    }
    // 具体的数不重要，重要的是它**不是 0**：为 0 就意味着这条偏移在任何一个
    // 点上都观测不到，那么"照抄了"与"抹掉了"长得一模一样。
    expect(differ).toBeGreaterThan(0)
    expect(same).toBeGreaterThan(0)
    // 偏移把矩形整个平移，重叠之外的那一圈就是差集：
    // 横向差 15 列 × 高 61 行 × 2 边 + 纵向差 6 行 × 重叠宽 (57−15) × 2 边。
    expect(differ).toBe(15 * (button.height - 1) * 2 + 6 * (button.width - 1 - 15) * 2)
  })

  it('导出器点的那个点 (514,325) 偏移前后都命中 —— 状态层看不见这件事', () => {
    // xl-rh9.7 记的那条"篡改了却是绿的"，在这里变成一条正面的断言：
    // 行为真值里唯一那个点同时落在两个矩形里，所以状态那一侧永远分不开。
    // 分得开的是画面 —— 见 drawList.test.ts 第 200 拍那一条。
    expect(hitsButton(button, 514, 325)).toBe(true)
    expect(hitsWithoutOffset(button, 514, 325)).toBe(true)
  })
})

describe('与状态层交叉验证：同一批点喂给 stepBattle', () => {
  /**
   * 把点真的点下去，看状态层认不认。
   *
   * `command.isDraw` 为真时点中「击」的后果是 `currentPattern=1` 且
   * `selector.isSlectable=true`（`Command.checkReleased`）。拿它当"认了"的
   * 判据 —— 那是状态层自己说的话，不是这个文件说的。
   */
  function stateLayerAccepts(x: number, y: number): boolean {
    const w = freshWorld()
    w.command.isDraw = true
    stepBattle(w, [{ e: 'click', x, y, target: 'command:attack' }])
    return w.currentPattern === 1 && w.selector.isSlectable
  }

  it('边界上逐点相等 —— 两份实现哪天分家，这里就红', () => {
    const w0 = freshWorld()
    const b = w0.command.attack
    // 探针只扫**只可能命中「击」**的两条线。四颗按钮是贴着的（技就在击正
    // 上方，两个矩形共用 y=294 那条边），扫到别人身上会让 `stepBattle` 抛
    // 「技 / 物 / 防 还没实现」—— 那是另一件事，会把这条判据变成一场误会。
    const points: [number, number][] = []
    // 横向：y=325 落在击的纵向区间里，而防/物要 y>334、技要 y<294。
    for (let x = b.x - 40; x <= b.x + b.width + 20; x++) points.push([x, 325])
    // 纵向：x=514 落在击的横向区间里，而防/物在左右两侧。上端从 294 起 ——
    // 那正是击与技共用的那条边，两边都是开区间，谁都不算命中。
    for (let y = 294; y <= b.y + b.height + 25; y++) points.push([514, y])

    // 前置条件写成断言：这批点一个都碰不到另外三颗按钮。按钮位置哪天挪了，
    // 这一条先红，而不是让上面那个 throw 冒出来。
    const others = [w0.command.skill, w0.command.defend, w0.command.thing]
    expect(
      points.filter(([x, y]) => others.some((o) => hitsButton(o, x, y))).length,
      '探针扫到了别的按钮上',
    ).toBe(0)

    const disagreed = points.filter(([x, y]) => hitsButton(b, x, y) !== stateLayerAccepts(x, y))
    expect(disagreed, '渲染这一份与 step.ts 那一份判得不一样').toEqual([])
    // **两种结果都得出现过** —— 全是"没命中"的话这条检查是空转的
    // （"找不到东西"当成了通过条件）。分母与两边的个数都印出来。
    const hit = points.filter(([x, y]) => hitsButton(b, x, y))
    expect(points.length).toBeGreaterThan(150)
    expect(hit.length).toBeGreaterThan(0)
    expect(points.length - hit.length).toBeGreaterThan(0)
  })
})

describe('怪物选择框：不偏、闭区间，第三槽的高借用第一只（xl-1dv.8）', () => {
  it('四边都是闭区间，且不带那 15/6 的偏移', () => {
    const w = freshWorld()
    const s = w.selector
    w.selector.isSlectable = true
    expect(hitsEnemy(w, 1, s.x1, s.y1)).toBe(true)
    expect(hitsEnemy(w, 1, s.x1 + s.width1, s.y1 + s.height1)).toBe(true)
    expect(hitsEnemy(w, 1, s.x1 - 1, s.y1)).toBe(false)
    expect(hitsEnemy(w, 1, s.x1, s.y1 - 1)).toBe(false)
    expect(hitsEnemy(w, 1, s.x1 + s.width1 + 1, s.y1)).toBe(false)
    expect(hitsEnemy(w, 1, s.x1, s.y1 + s.height1 + 1)).toBe(false)
  })

  it('第三槽用的是 height1，不是 height3', () => {
    const w = freshWorld()
    const s = w.selector
    // 先确认这一场里两者相等（三只怪的图都是 172 高），也就是**这一场看不见
    // 这条缺陷** —— 与 battleTrace.test.ts 里那条登记是同一件事。
    expect(s.height1).toBe(s.height3)
    // 再人为把它们分开，验这一层读的确实是 height1。这不是伪造真值：
    // 改的是这个测试自己手里的一份世界，验的是 `hitsEnemy` 读哪个字段。
    s.height1 = 10
    s.height3 = 500
    expect(hitsEnemy(w, 3, s.x3, s.y3 + 300)).toBe(false)
    expect(hitsEnemy(w, 3, s.x3, s.y3 + 5)).toBe(true)
  })
})
