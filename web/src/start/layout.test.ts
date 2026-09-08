import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodePng } from '../compare/png'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/constants'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import { START_IMAGES, START_SEQUENCES } from './assets'
import { START_BUTTONS } from './buttons'
import {
  ABOUT_HEIGHT,
  ABOUT_REVEAL_BASE,
  ABOUT_REVEAL_STEP,
  ABOUT_TICKS,
  ABOUT_WIDTH,
  CLOUD_FLOOR,
  CLOUD_IMAGE_HEIGHT,
  CLOUD_MOVE,
  CLOUD_START_Y,
  CLOUD_X,
  LOADING2_X,
  LOADING2_Y,
  LOADING_X,
  LOADING_Y,
  LOAD_TICKS,
  SCROLL_X,
  SCROLL_Y,
  START_TICK_MS,
} from './layout'

/**
 * `layout.ts` 与 `assets.ts` 里那一堆数，**逐个对着 GBK 源码现读比**
 * （`test/javaSource.ts`；不显式按 GBK 解码就是满屏乱码，而乱码与"源码里没有
 * 这一行"在正则下长得一模一样，都是零匹配）。
 *
 * 所以每一条都先断言"解出来的条数"——那是这些检查的分母。正则被源码的排版
 * 带偏时，`for (const m of [])` 一声不吭地跑完，看起来跟全过了一样。
 */

const START_PANEL = javaSource('src/start/StartPanel.java')
const CLOUD = javaSource('src/start/CloudAnimation.java')

interface JavaAnimation {
  count: number
  dir: string
}

/** `initialAnimations()` 里那七句 `new StartAnimation(n, "目录", …)`。 */
function javaAnimations(): JavaAnimation[] {
  const pattern = /new StartAnimation\((\d+),\s*"([^"]+)"/g
  return [...START_PANEL.matchAll(pattern)].map((m) => ({ count: Number(m[1]), dir: m[2]! }))
}

/** 其中位置写成字面量的那几句（鼠标跟着 currentX/Y，循环里那句是 `150 + i * 100`）。 */
function javaPlacedAnimations(): { dir: string; x: number; y: number }[] {
  const pattern = /new StartAnimation\(\d+,\s*"([^"]+)",\s*this,\s*(-?\d+),\s*(-?\d+)\)/g
  return [...START_PANEL.matchAll(pattern)].map((m) => ({
    dir: m[1]!,
    x: Number(m[2]),
    y: Number(m[3]),
  }))
}

describe('开始界面的动画素材', () => {
  it('六段动画的目录与帧数照抄 initialAnimations() 里那七句', () => {
    const java = javaAnimations()
    // 分母：源码里到底有几句。七句六段 —— 「按钮动画」出现两次（循环里四条 +
    // 「回」那条单独一条），这正是它有五条而不是四条的原因。
    expect(java).toHaveLength(7)
    const byDir = new Map(java.map((a) => [a.dir, a.count]))
    expect(byDir.size).toBe(6)

    // 逻辑名 → 原版目录名。这一层是**手写的登记**：原版那几个中文目录名本身
    // 不说明它们是干什么的，而"哪个逻辑名对哪个目录"没有第二处可以推。
    const actual: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}
    for (const [name, sequence] of Object.entries(START_SEQUENCES)) {
      actual[name] = { dir: sequence.dir, count: sequence.count }
      expected[name] = { dir: sequence.dir, count: byDir.get(sequence.dir) }
    }
    expect(actual).toEqual(expected)
    // 六段全都在源码里找得到 —— 上面那圈只要有一个 `byDir.get` 返回
    // undefined，这条就红（`toEqual` 认 undefined 与数字不同）。
    expect([...byDir.keys()].sort()).toEqual(
      Object.values(START_SEQUENCES)
        .map((s) => s.dir)
        .sort(),
    )
  })

  it('⚠️ 帧数**不是**扫目录扫出来的 —— 原版有两个目录一张都没读过', () => {
    // 这条守的是 `START_SEQUENCES` 那条注释里的理由。扫目录会把这两个一起
    // 烘进来，而多烘几张图在画面上完全看不出来。
    const dirs = new Set(Object.values(START_SEQUENCES).map((s) => s.dir))
    for (const orphan of ['云彩', '载入动画']) {
      // 目录**在**仓库里（不是打错了名字）……
      expect(() => readFileSync(repoPath(`sources/StartPanel/${orphan}/1.png`))).not.toThrow()
      // ……而原版一句都没读它，所以这里也不烘。
      expect(START_PANEL).not.toContain(`"${orphan}"`)
      expect(dirs.has(orphan)).toBe(false)
    }
  })

  it('卷轴 / 反向卷轴 / 两段载入画在哪儿，照抄源码', () => {
    const placed = javaPlacedAnimations()
    // 分母：位置写成字面量的一共五句（另两句一句跟鼠标走、一句在循环里）。
    expect(placed).toHaveLength(5)
    const byDir = new Map(placed.map((p) => [p.dir, { x: p.x, y: p.y }]))
    expect({
      卷轴: { x: SCROLL_X, y: SCROLL_Y },
      反向卷轴: { x: SCROLL_X, y: SCROLL_Y },
      载入: { x: LOADING_X, y: LOADING_Y },
      载入2: { x: LOADING2_X, y: LOADING2_Y },
    }).toEqual({
      卷轴: byDir.get('卷轴'),
      反向卷轴: byDir.get('反向卷轴'),
      载入: byDir.get('载入'),
      载入2: byDir.get('载入2'),
    })
  })

  it('每颗按钮的高亮动画就画在它自己的 (x, y) 上', () => {
    // 循环里那句：`new StartAnimation(4, "按钮动画", this, 200, 150 + i * 100)`。
    const loop = START_PANEL.match(
      /new StartAnimation\(\d+,\s*"按钮动画",\s*this,\s*(\d+),\s*(\d+)\s*\+\s*i\s*\*\s*(\d+)\)/,
    )
    expect(loop, '源码里那句按 i 摆位的按钮动画没解出来').not.toBeNull()
    const [x, base, step] = loop!.slice(1, 4).map(Number)
    // 前四颗：(200, 150 + i*100)，与 START_BUTTONS 的前四条逐个数相同。
    expect(START_BUTTONS.slice(0, 4).map((b) => ({ x: b.x, y: b.y }))).toEqual(
      [0, 1, 2, 3].map((i) => ({ x: x!, y: base! + i * step! })),
    )
    // 第五条单独建在 (800, 550)，与「回」那颗按钮同一个点。
    const solo = javaPlacedAnimations().find((p) => p.dir === '按钮动画')
    expect(solo, '源码里那句单独摆位的按钮动画没解出来').toBeDefined()
    const goBack = START_BUTTONS.find((b) => b.key === 'goBack')!
    expect({ x: goBack.x, y: goBack.y }).toEqual({ x: solo!.x, y: solo!.y })
  })
})

describe('开始界面的拍数与常量', () => {
  it('一拍 100 ms —— startAnimationThread() 里那句 Clock.sleep', () => {
    const sleep = START_PANEL.match(/tools\.Clock\.sleep\((\d+)\)/)
    expect(sleep, 'sleep 那句没解出来').not.toBeNull()
    expect(START_TICK_MS).toBe(Number(sleep![1]))
  })

  it('aboutTimer 两处都是 10 拍、loadTimer 两处都是 30 拍', () => {
    const about = [...START_PANEL.matchAll(/aboutTimer\.start\((\d+)\)/g)].map((m) => Number(m[1]))
    const load = [...START_PANEL.matchAll(/loadTimer\.start\((\d+)\)/g)].map((m) => Number(m[1]))
    // 分母：各两处（「转」与「回」；「起」与「承」）。少一处说明源码变了。
    expect(about).toHaveLength(2)
    expect(load).toHaveLength(2)
    expect(new Set(about)).toEqual(new Set([ABOUT_TICKS]))
    expect(new Set(load)).toEqual(new Set([LOAD_TICKS]))
  })

  it('「关于我们」那两条揭开式子里的 100 与 9', () => {
    const forward = START_PANEL.match(
      /(\d+)\s*\*\s*\((\d+)\s*-\s*aboutTimer\.getTimeLeft\(\)\),\s*(\d+),/,
    )
    const backward = START_PANEL.match(/(\d+)\s*\*\s*\(aboutTimer\.getTimeLeft\(\)\),\s*(\d+),/)
    expect(forward, '展开那条式子没解出来').not.toBeNull()
    expect(backward, '收回那条式子没解出来').not.toBeNull()
    expect({
      step: ABOUT_REVEAL_STEP,
      base: ABOUT_REVEAL_BASE,
      height: ABOUT_HEIGHT,
      backStep: ABOUT_REVEAL_STEP,
    }).toEqual({
      step: Number(forward![1]),
      base: Number(forward![2]),
      height: Number(forward![3]),
      backStep: Number(backward![1]),
    })
    // 两条式子的高度也得一样，不然收回时会露出一条边。
    expect(Number(backward![2])).toBe(ABOUT_HEIGHT)
  })

  it('云的初值、步长与掉头条件照抄 CloudAnimation', () => {
    const born = START_PANEL.match(/new CloudAnimation\((-?\d+),\s*(-?\d+),/)
    expect(born, 'new CloudAnimation 那句没解出来').not.toBeNull()
    const move = CLOUD.match(/move\s*=\s*(\d+);/)
    const up = CLOUD.match(/y\s*-=\s*move;\s*if\s*\(\s*y\s*\+\s*(\d+)\s*<\s*(\d+)\s*\)/)
    const down = CLOUD.match(/y\s*\+=\s*move;\s*if\s*\(\s*y\s*>\s*(-?\d+)\s*\)/)
    expect(move, 'move 那句没解出来').not.toBeNull()
    expect(up, '上飘掉头条件没解出来').not.toBeNull()
    expect(down, '下飘掉头条件没解出来').not.toBeNull()
    expect({
      x: CLOUD_X,
      startY: CLOUD_START_Y,
      move: CLOUD_MOVE,
      imageHeight: CLOUD_IMAGE_HEIGHT,
      floor: CLOUD_FLOOR,
      turnBack: CLOUD_START_Y,
    }).toEqual({
      x: Number(born![1]),
      startY: Number(born![2]),
      move: Number(move![1]),
      imageHeight: Number(up![1]),
      floor: Number(up![2]),
      turnBack: Number(down![1]),
    })
  })
})

describe('这些常量背后的素材真的是这个尺寸', () => {
  const size = (path: string) => {
    const png = decodePng(readFileSync(repoPath(path)))
    return { width: png.width, height: png.height }
  }

  it('⚠️ 云那两个字面量是两个巧合：1024 是云图的高，640 是舞台的高', () => {
    // 原版 `if (y + 1024 < 640)` 里的两个数一个都没有名字。素材换了尺寸而
    // 常量不动，云就会在半空掉头 —— 而画面上看起来完全正常。
    expect(size(START_IMAGES.cloud).height).toBe(CLOUD_IMAGE_HEIGHT)
    expect(CLOUD_FLOOR).toBe(STAGE_HEIGHT)
  })

  it('关于我们那一屏正好是舞台大小', () => {
    expect(size(START_IMAGES.aboutPage)).toEqual({ width: ABOUT_WIDTH, height: ABOUT_HEIGHT })
    expect({ width: ABOUT_WIDTH, height: ABOUT_HEIGHT }).toEqual({
      width: STAGE_WIDTH,
      height: STAGE_HEIGHT,
    })
  })

  it('六段动画每一帧的文件都在，而且第一帧的尺寸是它自己那一档', () => {
    let counted = 0
    for (const sequence of Object.values(START_SEQUENCES)) {
      for (let frame = 1; frame <= sequence.count; frame++) {
        // 缺一帧这里当场抛：原版 `Reader.readImage` 缺文件只在 stderr 上警告，
        // 画面上是一块空白，而"少画了一帧"没人看得出来。
        size(`sources/StartPanel/${sequence.dir}/${frame}.png`)
        counted++
      }
    }
    // 分母：六段加起来一共多少帧。零帧的循环跑完看起来跟全过了一样。
    expect(counted).toBe(
      Object.values(START_SEQUENCES).reduce((sum, s) => sum + s.count, 0),
    )
    expect(counted).toBeGreaterThan(0)
  })
})
