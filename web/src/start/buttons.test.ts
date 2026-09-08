import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { START_IMAGES } from './assets'
import {
  HIT_OFFSET_X,
  HIT_OFFSET_Y,
  START_BUTTONS,
  hitsStartButton,
  startButtonHitBox,
} from './buttons'
import type { StartButtonSpec } from './buttons'

/**
 * 按钮的坐标、尺寸、用哪张图、点得着哪一块 —— 四样全部对着原版 GBK 源码现读
 * 出来比（`test/javaSource.ts`，不显式按 GBK 解码就是满屏乱码，而**乱码与
 * 「源码里没有这一行」在正则下长得一模一样**，都是零匹配）。
 *
 * 所以每一条都先断言「解出来的条数」，那是这几条检查的分母：正则被源码的
 * 排版带偏时，`for (const m of [])` 一声不吭地跑完，看起来跟全过了一样。
 */

const START_PANEL = javaSource('src/start/StartPanel.java')
const START_BUTTON = javaSource('src/start/StartButton.java')

/**
 * `initialButtons()` 里那五句 `new StartButton(...)`，逐句解开。
 *
 * 五个实参：`x, y, width, height` 加三张图（常态 / 悬停 / 按下）。
 */
interface JavaButton {
  name: string
  x: number
  y: number
  width: number
  height: number
  images: string[]
}

function javaButtons(): JavaButton[] {
  const pattern =
    /(\w+)\s*=\s*new StartButton\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*Reader\.readImage\("([^"]+)"\),\s*Reader\.readImage\("([^"]+)"\),\s*Reader\.readImage\("([^"]+)"\)/g
  return [...START_PANEL.matchAll(pattern)].map((m) => ({
    name: m[1]!,
    x: Number(m[2]),
    y: Number(m[3]),
    width: Number(m[4]),
    height: Number(m[5]),
    images: [m[6]!, m[7]!, m[8]!],
  }))
}

describe('开始界面的按钮', () => {
  it('原版一共五颗，这一票复刻其中两颗（分母现读，名单手写）', () => {
    const found = javaButtons()
    // 分母：源码里到底有几句 `new StartButton(...)`。原版加一颗按钮而这里
    // 不动，这条红 —— 那正是该有人来重新签一次名单的时刻。
    expect(found.map((b) => b.name)).toEqual(['start', 'load', 'about', 'end', 'back'])

    // 名单是**手写的登记**，不是从上面那份现扫推出来的：推出来的话
    // 「哪几颗已经复刻了」就成了自己给自己签字（见 docs/agents/dispatch.md
    // 纪律 3 那条被记录过的误用）。
    //
    // 没复刻的三颗与理由：
    //   about（转）—— 关于我们那一屏，连卷轴动画一起归 xl-4si
    //   end  （结）—— `System.exit(0)`，浏览器里没有对应物
    //   back （回）—— 只在关于我们那一屏里出现，跟着 about 一起
    expect(START_BUTTONS.map((b) => b.key)).toEqual(['newGame', 'load'])
  })

  it('坐标与尺寸逐个数照抄 initialButtons()', () => {
    const java = new Map(javaButtons().map((b) => [b.name, b]))
    // 逻辑名 → 原版的变量名。这一层映射是手写的，因为原版那两个名字
    // （start / load）本身不说明它们是干什么的。
    const named: Record<string, string> = { newGame: 'start', load: 'load' }
    const actual: Record<string, unknown> = {}
    const expected: Record<string, unknown> = {}
    for (const button of START_BUTTONS) {
      const source = java.get(named[button.key]!)
      expect(source, `源码里没有 ${named[button.key]}`).toBeDefined()
      actual[button.key] = { x: button.x, y: button.y, width: button.width, height: button.height }
      expected[button.key] = {
        x: source!.x,
        y: source!.y,
        width: source!.width,
        height: source!.height,
      }
    }
    // 整块比一次而不是四条断言：偏了一个数就整块红，一眼看得出偏在哪。
    expect(actual).toEqual(expected)
  })

  it('一颗按钮只有两张图 —— 原版的「悬停」与「按下」传的是同一个文件', () => {
    const java = new Map(javaButtons().map((b) => [b.name, b]))
    const pairs = [
      { key: 'newGame', java: 'start', normal: START_IMAGES.newGame, hover: START_IMAGES.newGameHover },
      { key: 'load', java: 'load', normal: START_IMAGES.load, hover: START_IMAGES.loadHover },
    ]
    for (const pair of pairs) {
      const source = java.get(pair.java)!
      expect({ key: pair.key, images: [pair.normal, pair.hover, pair.hover] }).toEqual({
        key: pair.key,
        images: source.images,
      })
    }
    // 分母：上面这个循环真的跑过两轮。
    expect(pairs).toHaveLength(START_BUTTONS.length)
  })

  it('命中框的 −15 / −6 来自 StartButton 的三处判定，而且三处一致', () => {
    const pattern =
      /currentX>x-(\d+)&&currentX<\(x\+width-(\d+)\)&&currentY>\(y-(\d+)\)&&currentY<\(y\+height-(\d+)\)/g
    const found = [...START_BUTTON.matchAll(pattern)].map((m) => m.slice(1, 5).map(Number))
    // 三处：isMoveIn / isPressedButton / isRelesedButton。少一处说明源码的
    // 写法变了（或者正则被排版带偏了），那时下面那条比对就是拿空集在比。
    expect(found).toHaveLength(3)
    // 三处逐字一致，所以「命中框」是一个概念，不是三个。
    expect(new Set(found.map((f) => f.join(',')))).toEqual(new Set([found[0]!.join(',')]))
    // 四个数就是这一对偏移：x 用两次、y 用两次。
    expect(found[0]).toEqual([-HIT_OFFSET_X, -HIT_OFFSET_X, -HIT_OFFSET_Y, -HIT_OFFSET_Y])
  })

  it('命中框整个往左上挪，画出来那个矩形不是点得着的那个', () => {
    const newGame = START_BUTTONS[0]!
    expect(startButtonHitBox(newGame)).toEqual({ x: 185, y: 144, width: 50, height: 50 })
    // 两个矩形有重叠，所以「点在按钮图上」并**不**等于「点不着」——
    // 分得开的是各自那两条边角。挑的两个点各在一侧：
    //   (240,150) 在画出来的 50×50 里（200..250 / 150..200），却在命中框
    //             右边（185..235）外面 —— 看得见、点不着；
    //   (190,146) 反过来 —— 看不见图，却点得着。
    expect({
      画上但点不着: hitsStartButton(newGame, 240, 150),
      点得着但图外: hitsStartButton(newGame, 190, 146),
    }).toEqual({ 画上但点不着: false, 点得着但图外: true })
    // 而命中框的中心点当然在里面。
    expect(hitsStartButton(newGame, 185 + 25, 144 + 25)).toBe(true)
  })

  it('四个不等号都是严格的：四条边本身不算命中', () => {
    const b: StartButtonSpec = START_BUTTONS[0]!
    const box = startButtonHitBox(b)
    const inside = { x: box.x + 1, y: box.y + 1 }
    expect(hitsStartButton(b, inside.x, inside.y)).toBe(true)
    // 左边、上边、右边、下边各取一个点，全都不算。写成一个对象比一次，
    // 哪条边改成了 `>=` 就整块红。
    expect({
      left: hitsStartButton(b, box.x, inside.y),
      top: hitsStartButton(b, inside.x, box.y),
      right: hitsStartButton(b, box.x + box.width, inside.y),
      bottom: hitsStartButton(b, inside.x, box.y + box.height),
    }).toEqual({ left: false, top: false, right: false, bottom: false })
  })

  it('两颗按钮的命中框不重叠 —— 不然点一次会同时命中两颗', () => {
    const [a, c] = [START_BUTTONS[0]!, START_BUTTONS[1]!]
    const boxA = startButtonHitBox(a)
    const boxC = startButtonHitBox(c)
    expect(boxA.y + boxA.height).toBeLessThanOrEqual(boxC.y)
  })
})
