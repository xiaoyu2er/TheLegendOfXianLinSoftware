import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { decodePng } from '../compare/png'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/constants'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import { START_IMAGES } from './assets'
import type { StartImageName } from './assets'
import {
  DISABLED_REASON,
  HIT_OFFSET_X,
  HIT_OFFSET_Y,
  INITIAL_START_BUTTONS,
  START_BUTTONS,
  START_BUTTON_ENABLED,
  startButtonHitBox,
} from './buttons'

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
  it('原版一共五颗，五颗全在（分母现读，名单手写）', () => {
    const found = javaButtons()
    // 分母：源码里到底有几句 `new StartButton(...)`。原版加一颗按钮而这里
    // 不动，这条红 —— 那正是该有人来重新签一次名单的时刻。
    expect(found.map((b) => b.name)).toEqual(['start', 'load', 'about', 'end', 'back'])

    // 名单是**手写的登记**，不是从上面那份现扫推出来的：推出来的话
    // 「哪几颗已经复刻了」就成了自己给自己签字（见 docs/agents/dispatch.md
    // 纪律 3 那条被记录过的误用）。xl-kaa 那一版这里只有两颗，xl-4si 补齐。
    expect(START_BUTTONS.map((b) => b.key)).toEqual([
      'newGame',
      'load',
      'about',
      'end',
      'goBack',
    ])
    // 开机在屏幕上的只有前四颗 —— 原版构造函数末尾那四句 `buttons.add(...)`，
    // 「回」是点了「转」之后才加进去的。
    const adds = [...START_PANEL.matchAll(/buttons\.add\((\w+)\);/g)].map((m) => m[1])
    expect(adds).toEqual(['start', 'load', 'about', 'end', 'back'])
    // 前四句在构造函数里、第五句在 `startButtonAction()` 里 —— 名单只取前四。
    expect(INITIAL_START_BUTTONS).toEqual(['newGame', 'load', 'about', 'end'])
  })

  it('五颗里有两颗是**明写不做**的，理由逐字签在这里', () => {
    // 这是一份手写的登记（见 `START_BUTTON_ENABLED` 的头注）。把它改成
    // 从别处推出来的，"有没有人悄悄画了一颗点了没反应的按钮"就没人问了。
    expect(START_BUTTON_ENABLED).toEqual({
      newGame: true,
      about: true,
      goBack: true,
      load: false,
      end: false,
    })
    // 禁用的那两颗必须各自带一句理由，活的那三颗必须没有 —— 一颗按钮"禁用
    // 了但没说为什么"与"忘了接线"长得一模一样。
    for (const button of START_BUTTONS) {
      expect(
        DISABLED_REASON[button.key] === null,
        `${button.key} 的 title 与它的启用状态对不上`,
      ).toBe(START_BUTTON_ENABLED[button.key])
    }
    // 分母：真的检查了五颗，而不是循环一次都没进。
    expect(START_BUTTONS).toHaveLength(5)
  })

  it('坐标与尺寸逐个数照抄 initialButtons()', () => {
    const java = new Map(javaButtons().map((b) => [b.name, b]))
    // 逻辑名 → 原版的变量名。这一层映射是手写的，因为原版那几个名字本身
    // 不说明它们是干什么的（尤其 `back` —— 它是「回」按钮，不是背景图）。
    const named: Record<string, string> = {
      newGame: 'start',
      load: 'load',
      about: 'about',
      end: 'end',
      goBack: 'back',
    }
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
      { key: 'about', java: 'about', normal: START_IMAGES.about, hover: START_IMAGES.aboutHover },
      { key: 'end', java: 'end', normal: START_IMAGES.end, hover: START_IMAGES.endHover },
      // ⚠️ 「回」的图叫 `goBack` 而不是 `back` —— 后者在 START_IMAGES 里是
      // **背景图**。抄成 `back` 会让这颗按钮画成一整屏底图。
      { key: 'goBack', java: 'back', normal: START_IMAGES.goBack, hover: START_IMAGES.goBackHover },
    ]
    for (const pair of pairs) {
      const source = java.get(pair.java)!
      expect({ key: pair.key, images: [pair.normal, pair.hover, pair.hover] }).toEqual({
        key: pair.key,
        images: source.images,
      })
    }
    // 分母：上面这个循环真的跑满了五轮。
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

  it('命中框整个往左上挪，跟画出来那个矩形不是同一个', () => {
    const newGame = START_BUTTONS[0]!
    expect(startButtonHitBox(newGame)).toEqual({ x: 185, y: 144, width: 50, height: 50 })
    // 两个矩形**有重叠**，所以「点在按钮图上」并不等于「点得着」。分得开的
    // 是各自那两条边角：(240,150) 在画出来的 50×50 里（200..250）却在命中框
    // 右边（185..235）外面；(190,146) 反过来。
    const box = startButtonHitBox(newGame)
    expect(box.x + box.width).toBeLessThan(newGame.x + newGame.width)
    expect(box.x).toBeLessThan(newGame.x)
  })

  /**
   * 两条 CSS 规则**依赖素材的实际尺寸**，而那两个数原本只以注释存在：
   *
   * - `.start-panel { overflow: hidden }` —— 只有当 `back.png` 比舞台高，
   *   「裁掉多出来那行」才是一件真的在发生的事；
   * - `.start-button { overflow: visible }` —— 只有当悬停图比按钮宽，
   *   「让它溢出」才是一件真的在发生的事。
   *
   * 素材哪天换了，这两条规则会静静变成空操作 —— 而画面上看起来完全正常。
   * 所以在这里**量真的文件**，不是抄一个数。
   */
  it('素材的实际尺寸撑着那两条 overflow 规则', () => {
    const size = (name: StartImageName) => {
      const png = decodePng(readFileSync(repoPath(START_IMAGES[name])))
      return { width: png.width, height: png.height }
    }
    // 背景图比舞台高 —— 原版画进一张 1024×640 的缓冲图，多出来的被裁掉。
    const back = size('back')
    expect(back.width).toBe(STAGE_WIDTH)
    expect(back.height).toBeGreaterThan(STAGE_HEIGHT)

    // 常态图正好是按钮声明的 50×50。
    for (const button of START_BUTTONS) {
      const normal = size(button.key)
      expect({ key: button.key, ...normal }).toEqual({
        key: button.key,
        width: button.width,
        height: button.height,
      })
    }
    // 悬停图比常态图宽的**只有四颗** —— 「回」那颗的 回2.png 实测也是 50×50，
    // 所以"悬停图一定更宽"不是一条规律，是四颗的巧合。写成对五颗都断言会红；
    // 写成一条都不断言，`overflow: visible` 就成了空操作而没人知道。
    const wider = START_BUTTONS.filter((b) => size(`${b.key}Hover`).width > size(b.key).width)
    expect(wider.map((b) => b.key)).toEqual(['newGame', 'load', 'about', 'end'])
  })

  it('五颗按钮的命中框两两不重叠 —— 不然点一次会同时命中两颗', () => {
    const boxes = START_BUTTONS.map((b) => ({ key: b.key, ...startButtonHitBox(b) }))
    const overlapping: string[] = []
    let pairs = 0
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        pairs++
        const a = boxes[i]!
        const b = boxes[j]!
        const apart =
          a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
        if (!apart) overlapping.push(`${a.key}×${b.key}`)
      }
    }
    // 分母：五颗两两一共 10 对。零对的循环跑完看起来跟全过了一样。
    expect(pairs).toBe(10)
    expect(overlapping).toEqual([])
  })
})
