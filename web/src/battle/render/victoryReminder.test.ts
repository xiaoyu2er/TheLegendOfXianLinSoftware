import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../../compare/png'
import { resolveAsset } from '../../assets/resolve'
import { javaSource } from '../../test/javaSource'
import { repoPath } from '../../test/repoPath'
import { replayBattle } from '../replay'
import { stepBattle } from '../step'
import { readBattleTrace } from '../trace'
import type { BattleWorld } from '../types'
import { VICTORY_REMINDER_IDS, VICTORY_REMINDER, victoryReminderFaceId } from './assets'
import { battleDrawList, VICTORY_REMINDER_LAYOUT } from './drawList'
import type { DrawOp } from './drawList'
import { advancePaintState, applyPaintInput, createPaintState } from './paint'

/**
 * 第 22 层「胜利结算」（xl-rh9.13）。
 *
 * 三档判据，各自的失败长得都和通过不一样：
 *
 * 1. **素材那 12 张**：名单解自原版 `loadImage()`，分母是目录里的文件数。
 * 2. **坐标**：解自原版构造函数的方法体，逐字段对撞。
 * 3. **画出来的东西**：拿 `battle-victory` 的行为真值回放到结算走完，
 *    逐拍生成清单再断言。像素那一层归跨端逐帧比对（`docs/frame-compare.md`）。
 */

const VICTORY_DIR = 'image/战斗胜利'
const SOURCE = 'src/battle/VictoryReminder.java'

/** 怪物出场图的像素尺寸，与状态层的测试同一个来源（不从真值里读）。 */
function spriteSize(name: string): { width: number; height: number } {
  const png = decodePng(readFileSync(repoPath('image/怪物', name, '1.png')))
  return { width: png.width, height: png.height }
}

describe('结算画面的 12 张素材', () => {
  /** `loadImage()` 的方法体。界标写错 / 源码挪走了都会在下面第一条上响。 */
  const loadImage = (() => {
    const src = javaSource(SOURCE)
    const start = src.indexOf('public void loadImage(){')
    expect(start, `${SOURCE} 里找不到 loadImage() —— 解析器空转`).toBeGreaterThan(0)
    const end = src.indexOf('public void getInformation(){', start)
    expect(end, 'loadImage() 之后找不到 getInformation()').toBeGreaterThan(start)
    return src.slice(start, end)
  })()

  /** 四条写死路径的 `readImage("…")`。 */
  const literals = [...loadImage.matchAll(/readImage\("([^"]+)"\)/g)].map((m) => m[1]!)
  /** 那个 `for(int i=1;i<=N;i++)` 的上界 —— **不写死 8**，从源码里解。 */
  const loopBound = (() => {
    const m = /for\s*\(\s*int i\s*=\s*1\s*;\s*i\s*<=\s*(\d+)\s*;\s*i\+\+\s*\)/.exec(loadImage)
    expect(m, 'loadImage() 里找不到那个 for 循环').not.toBeNull()
    return Number(m![1])
  })()

  it('从源码里真的解出了 readImage —— 解析器空转要响', () => {
    expect(literals.length).toBe(4)
    expect(loopBound).toBeGreaterThan(0)
  })

  it('名单逐条等于 loadImage() 读的那些路径', () => {
    // 源码那边：四条写死的，加上循环那 N 条。顺序也是源码的顺序。
    const fromSource = [
      ...literals,
      ...Array.from({ length: loopBound }, (_, i) => `${VICTORY_DIR}/${i + 1}.png`),
    ]
    const fromCode = VICTORY_REMINDER_IDS.map((id) => id.replace(/^battle:/, VICTORY_DIR.slice(0, 0) + ''))
    expect(fromCode).toEqual(fromSource.map((p) => p.replace(/^image\//, '')))
  })

  it('目录里 13 个文件，被读到的 12 个 —— 多出来的那个正是 0.png', () => {
    // 分母是目录本身，不是抄来的数。
    const files = readdirSync(repoPath(VICTORY_DIR)).sort()
    const read = new Set(VICTORY_REMINDER_IDS.map((id) => id.slice(id.lastIndexOf('/') + 1)))
    expect(read.size, '名单里有重复项').toBe(VICTORY_REMINDER_IDS.length)
    const unread = files.filter((f) => !read.has(f))
    // 「照文件数硬凑」的写法在这里会红：0.png 一次都没有被 loadImage 读到，
    // 而它在烘焙产物里是查得到的（烘的是目录里的每一个文件），于是"多写了
    // 一条"与"写对了"在 resolveAsset 那一关上分不开。
    expect(unread, '除 0.png 之外还有文件没被引用').toEqual(['0.png'])
    expect(files.length - unread.length).toBe(VICTORY_REMINDER_IDS.length)
  })

  it('12 张都真的烘出来了 —— 逐条 resolveAsset', () => {
    for (const id of VICTORY_REMINDER_IDS) {
      expect(() => resolveAsset(id), `${id} 没有烘焙产物`).not.toThrow()
    }
  })

  it('第一页 / 第二页那六张，同一个人的两张相差正好 4', () => {
    // 原版 `zhang1=images.get(0); zhang2=images.get(4);` 那六句写死的赋值。
    for (const key of ['zhang', 'yu', 'lu'] as const) {
      const a = victoryReminderFaceId(key, 1)
      const b = victoryReminderFaceId(key, 2)
      const num = (id: string) => Number(/(\d+)\.png$/.exec(id)![1])
      expect(num(b) - num(a), `${key} 的第二页不是第一页 +4`).toBe(4)
    }
    expect((['zhang', 'yu', 'lu'] as const).map((k) => victoryReminderFaceId(k, 1))).toEqual(
      // 第一组就是 1/2/3.png，顺序是 zhang/wen/lu —— 原版那三句赋值的顺序。
      [1, 2, 3].map((n) => VICTORY_REMINDER_IDS[3 + n]),
    )
  })
})

describe('结算画面那些不动的坐标，对回原版构造函数', () => {
  /** 构造函数方法体里的每一句 `字段=表达式;`，解成一张表。 */
  const assigns = (() => {
    const src = javaSource(SOURCE)
    const start = src.indexOf('public VictoryReminder(BattlePanel bp){')
    expect(start, `${SOURCE} 里找不到构造函数 —— 解析器空转`).toBeGreaterThan(0)
    const end = src.indexOf('public void loadImage(){', start)
    expect(end, '构造函数之后找不到 loadImage()').toBeGreaterThan(start)
    const body = src.slice(start, end)
    const out = new Map<string, number>()
    for (const m of body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([0-9+\-*/ ]+);/gm)) {
      // 右边只允许整数四则运算（原版写的就是 `412+75` 这种）。
      const value = Number(new Function(`return (${m[2]!})`)())
      if (!Number.isInteger(value)) continue
      out.set(m[1]!, value)
    }
    return out
  })()

  it('从源码里真的解出了赋值 —— 解析器空转要响', () => {
    expect(assigns.size).toBeGreaterThan(10)
  })

  it('逐字段相等', () => {
    // 左边是这一层用的常量名，右边是原版构造函数里那个字段名。
    const PAIRS: readonly [keyof typeof VICTORY_REMINDER_LAYOUT, string][] = [
      ['dx1', 'dx1'],
      ['dy1', 'dy1'],
      ['dx2', 'dx2'],
      ['sx1', 'sx1'],
      ['sy1', 'sy1'],
      ['sx2', 'sx2'],
      ['levelUpX', 'levelUpX'],
      ['levelUpY', 'levelUpY'],
      ['thingX', 'thingX'],
      ['thingY', 'thingY'],
      ['firstX', 'firstX'],
      ['firstY', 'firstY'],
      ['firstStringX', 'firstStringX'],
      ['firstStringY', 'firstStringY'],
      ['secondStringX', 'secondStringX'],
      ['secondStringY', 'secondStringY'],
      ['thirdStringX', 'thirdStringX'],
      ['thirdStringY', 'thirdStringY'],
    ]
    // 分母：这张表要覆盖 VICTORY_REMINDER_LAYOUT 的每一个键，一个不许漏。
    expect(PAIRS.map(([k]) => k).sort()).toEqual(Object.keys(VICTORY_REMINDER_LAYOUT).sort())
    for (const [mine, theirs] of PAIRS) {
      expect(assigns.get(theirs), `原版构造函数里没有 ${theirs}=…`).toBeDefined()
      expect(VICTORY_REMINDER_LAYOUT[mine], `${mine} 与原版的 ${theirs} 对不上`).toBe(
        assigns.get(theirs),
      )
    }
  })

  it('那八个会动的坐标不在这张表里 —— 它们归真值', () => {
    // dy2 / sy2 与物品框那六个每拍都在变，抄成常量的话卷轴永远拉不开。
    for (const moving of ['dy2', 'sy2', 'thing_dx1', 'thing_sx1', 'thing_dy2', 'thing_sy2']) {
      expect(Object.keys(VICTORY_REMINDER_LAYOUT)).not.toContain(moving)
    }
  })
})

describe('battle-victory：结算画面逐拍画出来', () => {
  /**
   * 回放到真值末步。**输入照真值喂，状态一个字段都不喂**（同 drawList.test.ts）。
   */
  interface Frame {
    readonly t: number
    readonly ops: DrawOp[]
    /** 这一拍的结算状态**拷贝**。世界是一个会被就地改的对象 —— 存引用的话
     *  每一帧读到的都是末拍那份，而那种测试照样绿。 */
    readonly v: BattleWorld['victoryReminder']
    readonly levelUp: readonly boolean[]
    readonly exitPanel: BattleWorld['exitPanel']
  }
  const frames: Frame[] = (() => {
    const trace = readBattleTrace('battle-victory')
    const world = replayBattle(trace, spriteSize)
    const paint = createPaintState(world)
    const out: Frame[] = []
    for (const tick of trace.ticks) {
      for (const input of tick.input) applyPaintInput(world, paint, input)
      stepBattle(world, tick.input)
      advancePaintState(world, paint)
      const v = world.victoryReminder
      out.push({
        t: tick.t,
        ops: battleDrawList(world, paint),
        v: { ...v, showNums: [...v.showNums], things: [...v.things] },
        levelUp: world.party.map((h) => h.isLevelUp),
        exitPanel: world.exitPanel,
      })
    }
    return out
  })()

  /** 只看第 22 层。 */
  const vr = frames.map((f) => ({ ...f, ops: f.ops.filter((o) => o.layer === 'victory-reminder') }))
  const drawn = vr.filter((f) => f.ops.length > 0)

  it('这一条剧本真的走进了结算 —— 否则下面每一条都是空转的', () => {
    expect(frames.length).toBeGreaterThan(0)
    expect(drawn.length, 'victory-reminder 一拍都没画出来').toBeGreaterThan(0)
    // 结算跑完就回地图：末步 exitPanel 是 scenePanel，与剧本里 awaitExit 说的一致。
    expect(frames[frames.length - 1]!.exitPanel).toBe('scenePanel')
  })

  it('卷轴每拍拉开 20，目标与源同高（1:1，不拉伸）', () => {
    const heights: number[] = []
    for (const f of drawn) {
      const back = f.ops.find((o) => o.kind === 'rect' && o.id === VICTORY_REMINDER.back)
      if (!back || back.kind !== 'rect') continue
      expect(back.dest.width).toBe(back.src.width)
      expect(back.dest.height, `第 ${f.t} 拍卷轴被拉伸了`).toBe(back.src.height)
      expect(back.dest.x).toBe(VICTORY_REMINDER_LAYOUT.dx1)
      expect(back.dest.y).toBe(VICTORY_REMINDER_LAYOUT.dy1)
      heights.push(back.dest.height)
    }
    expect(heights.length, '卷轴一次都没画').toBeGreaterThan(0)
    // 从 20 一路 +20 到 480，然后钉住不动。
    expect(heights[0]).toBe(20)
    expect(Math.max(...heights)).toBe(480)
    for (const [i, h] of heights.entries()) {
      if (i === 0) continue
      const step = h - heights[i - 1]!
      expect(step === 0 || step === 20, `第 ${i} 拍卷轴走了 ${step}`).toBe(true)
    }
    expect(heights.filter((h) => h === 480).length, '卷轴拉满之后没有停住').toBeGreaterThan(1)
  })

  it('物品框从中心对开，横 ±4 纵 ±5，也是 1:1', () => {
    const boxes: { w: number; h: number; x: number; y: number }[] = []
    for (const f of drawn) {
      const box = f.ops.find((o) => o.kind === 'rect' && o.id === VICTORY_REMINDER.thingBack)
      if (!box || box.kind !== 'rect') continue
      expect(box.dest.width).toBe(box.src.width)
      expect(box.dest.height).toBe(box.src.height)
      boxes.push({ w: box.dest.width, h: box.dest.height, x: box.dest.x, y: box.dest.y })
    }
    expect(boxes.length, '物品框一次都没画').toBeGreaterThan(0)
    for (const [i, b] of boxes.entries()) {
      if (i === 0) continue
      const prev = boxes[i - 1]!
      // 每拍两边各 4 / 5，所以宽高各长 8 / 10，左上角各退 4 / 5。
      const dw = b.w - prev.w
      const dh = b.h - prev.h
      expect(dw === 0 || dw === 8, `第 ${i} 拍物品框宽走了 ${dw}`).toBe(true)
      expect(dh === 0 || dh === 10, `第 ${i} 拍物品框高走了 ${dh}`).toBe(true)
      expect(prev.x - b.x).toBe(dw / 2)
      expect(prev.y - b.y).toBe(dh / 2)
    }
    // 张开到底就是整张图：源矩形 (0,0)-(120,150)。
    expect(Math.max(...boxes.map((b) => b.w))).toBe(120)
    expect(Math.max(...boxes.map((b) => b.h))).toBe(150)
  })

  it('第一页三个人各一张，纵向每人 +100', () => {
    const page1 = (['zhang', 'yu', 'lu'] as const).map((k) => victoryReminderFaceId(k, 1))
    const f = drawn.find((x) => x.ops.some((o) => o.kind === 'image' && page1.includes(o.id)))
    expect(f, '第一页一次都没画出来').toBeDefined()
    const faces = f!.ops.filter((o) => o.kind === 'image' && page1.includes(o.id))
    expect(faces.map((o) => (o.kind === 'image' ? o.id : null))).toEqual(page1)
    expect(faces.map((o) => (o.kind === 'image' ? [o.x, o.y] : null))).toEqual([
      [412, 160],
      [412, 260],
      [412, 360],
    ])
  })

  it('第二页**只画升级了的那个人**，而这一场只有陆雪琪升了级', () => {
    const page2 = (['zhang', 'yu', 'lu'] as const).map((k) => victoryReminderFaceId(k, 2))
    const f = drawn.find((x) => x.ops.some((o) => o.kind === 'image' && page2.includes(o.id)))
    expect(f, '第二页一次都没画出来 —— 这一场没人升级？').toBeDefined()
    const faces = f!.ops.filter((o) => o.kind === 'image' && page2.includes(o.id))
    // 剧本把陆雪琪压到 1 级正是为了这一条：三个人拿同一笔经验，只有她够升级。
    expect(f!.levelUp).toEqual([false, false, true])
    expect(faces.length, '第二页画了不止一个人').toBe(1)
    const only = faces[0]!
    expect(only.kind === 'image' ? only.id : null).toBe(victoryReminderFaceId('lu', 2))
    // 陆雪琪是第三行 —— 上面两行空着，后面的人不往上挪。
    expect(only.kind === 'image' ? [only.x, only.y] : null).toEqual([412, 360])
  })

  it('属性四行只给升级了的人画，行距 20、第三行整体 +200', () => {
    const f = drawn.find((x) => x.v.secondString && x.ops.some((o) => o.kind === 'text'))
    expect(f, '第二页的数字一次都没画').toBeDefined()
    // 这一拍屏幕上还有掉落物那几行（thirdString 早就开着了），所以按落笔的
    // 横坐标把属性那一栏挑出来 —— 两栏的 x 差着 188 像素。
    const texts = f!.ops.filter(
      (o) => o.kind === 'text' && o.x === VICTORY_REMINDER_LAYOUT.secondStringX,
    )
    expect(texts.length, '第二页那一拍该只有陆雪琪的四行属性').toBe(4)
    expect(texts.map((o) => (o.kind === 'text' ? [o.x, o.y] : null))).toEqual([
      [502, 380],
      [502, 400],
      [502, 420],
      [502, 440],
    ])
    // 数字就是 showNums 的第 11..14 项，一个不落。
    expect(texts.map((o) => (o.kind === 'text' ? o.text : null))).toEqual(
      f!.v.showNums.slice(11, 15).map((n) => `${n}`),
    )
  })

  it('属性数字真的在往上滚 —— 35..54 那 20 拍', () => {
    const rows = drawn
      .filter((f) => f.v.secondString)
      .map((f) => f.v.showNums.slice(11, 15).join('/'))
    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(rows).size, '属性数字从头到尾一个样 —— 滚动动画没跑').toBeGreaterThan(1)
  })

  it('掉落物清单按 bp.enemies 的顺序，末行是「金钱 N」', () => {
    const f = drawn.find((x) => x.v.thirdString)
    expect(f, '掉落物清单一次都没画').toBeDefined()
    const v = f!.v
    const texts = f!.ops.filter((o) => o.kind === 'text').slice(-(v.things.length + 1))
    expect(texts.map((o) => (o.kind === 'text' ? o.text : null))).toEqual([
      // 斜杠后面那位是类型（1 药 / 2 装备），不画。
      ...v.things.map((t) => t.split('/')[0]),
      `金钱 ${v.moneyToGet}`,
    ])
    expect(texts.map((o) => (o.kind === 'text' ? [o.x, o.y] : null))).toEqual(
      texts.map((_, i) => [690, 150 + i * 20]),
    )
    expect(v.things.length, '这一场三只怪，掉落物该有三行').toBe(3)
  })

  it('升级小图与「获得物品」图，各自在自己那一拍出现', () => {
    const levelUp = drawn.filter((f) =>
      f.ops.some((o) => o.kind === 'image' && o.id === VICTORY_REMINDER.levelUp),
    )
    const getThing = drawn.filter((f) =>
      f.ops.some((o) => o.kind === 'image' && o.id === VICTORY_REMINDER.getThing),
    )
    expect(levelUp.length, '升级小图一次都没画').toBeGreaterThan(0)
    expect(getThing.length, '「获得物品」图一次都没画').toBeGreaterThan(0)
    // 两张图与状态层那两个开关**同进同出**，反方向也断言：开关关着就不许画。
    for (const f of frames) {
      const v = f.v
      const has = (id: string) => f.ops.some((o) => o.kind === 'image' && o.id === id)
      expect(has(VICTORY_REMINDER.levelUp), `第 ${f.t} 拍升级小图与 levelUpIsDraw 对不上`).toBe(
        v.isDraw && v.levelUpIsDraw,
      )
      expect(has(VICTORY_REMINDER.getThing), `第 ${f.t} 拍「获得物品」图与开关对不上`).toBe(
        v.isDraw && v.getThingIsDraw,
      )
    }
  })

  it('这一层只用得到那 12 张里的图', () => {
    const allowed = new Set<string>(VICTORY_REMINDER_IDS)
    for (const f of vr) {
      for (const op of f.ops) {
        if (op.kind === 'text') continue
        expect(allowed.has(op.id), `第 ${f.t} 拍画了名单外的 ${op.id}`).toBe(true)
      }
    }
  })

  it('一层之内的次序就是原版那九个 if 的书写顺序', () => {
    // 卷轴底 → 物品框 → 第一页 → 第二页 → 经验两行 → 属性四行 → 掉落物 →
    // 升级小图 → 「获得物品」图。抄错次序的表现是"某样东西被盖住了"。
    const RANK = (op: DrawOp, v: BattleWorld['victoryReminder']): number => {
      if (op.kind === 'rect') return op.id === VICTORY_REMINDER.back ? 0 : 1
      if (op.kind === 'image') {
        if (op.id === VICTORY_REMINDER.levelUp) return 7
        if (op.id === VICTORY_REMINDER.getThing) return 8
        const page2 = (['zhang', 'yu', 'lu'] as const).map((k) => victoryReminderFaceId(k, 2))
        return page2.includes(op.id) ? 3 : 2
      }
      if (op.x === VICTORY_REMINDER_LAYOUT.thirdStringX) return 6
      return op.x === VICTORY_REMINDER_LAYOUT.secondStringX && v.secondString ? 5 : 4
    }
    for (const f of frames) {
      const ops = f.ops.filter((o) => o.layer === 'victory-reminder')
      let last = -1
      for (const op of ops) {
        const r = RANK(op, f.v)
        expect(r, `第 ${f.t} 拍：结算画面里有一条排到了前面去`).toBeGreaterThanOrEqual(last)
        last = r
      }
    }
  })
})
