import { describe, expect, it } from 'vitest'
import { START_SEQUENCES } from './assets'
import { INITIAL_START_BUTTONS } from './buttons'
import type { StartButtonKey } from './buttons'
import { ABOUT_TICKS, ABOUT_WIDTH, CLOUD_START_Y, LOAD_TICKS } from './layout'
import {
  createStartPanelState,
  hoverStartButton,
  moveStartCursor,
  pressStartButton,
  releaseStartButton,
  startView,
  tickStartPanel,
} from './panelState'
import type { StartEffect, StartPanelState, StartView } from './panelState'

/**
 * 开始界面那一屏的状态机（xl-4si）。
 *
 * 验收标准第二条要的是「五段动画的帧序与拍数对着原版，判据不是截图而是可断言
 * 的状态（第几帧、播没播完一循环）」—— 下面每一条都是**跑出来数的**，
 * 一个期望值都不是从原版注释里抄的。
 *
 * 拍数在这里是硬判据：卷轴 10 拍、载入表 30 拍、「关于我们」揭开 10 段，
 * 三个数各自由 `layout.test.ts` 对着 GBK 源码守着，这里守的是**它们被怎么用**。
 */

interface Run {
  readonly state: StartPanelState
  /** 每一拍画出来的那一帧，`views[0]` 是第 1 拍。 */
  readonly views: readonly StartView[]
  /** 第几拍推出了什么动作（拍号从 1 起）。 */
  readonly effects: readonly { tick: number; effect: StartEffect }[]
}

function run(state: StartPanelState, ticks: number): Run {
  const views: StartView[] = []
  const effects: { tick: number; effect: StartEffect }[] = []
  let current = state
  for (let tick = 1; tick <= ticks; tick++) {
    const step = tickStartPanel(current)
    current = step.state
    views.push(step.view)
    if (step.effect !== null) effects.push({ tick, effect: step.effect })
  }
  return { state: current, views, effects }
}

/** 点一颗按钮 = 原版的 mousePressed + mouseReleased。 */
function click(
  state: StartPanelState,
  key: StartButtonKey,
): { state: StartPanelState; effect: StartEffect | null } {
  return releaseStartButton(pressStartButton(state, key), key)
}

describe('开机那一屏', () => {
  it('四颗按钮，「回」不在里面', () => {
    const state = createStartPanelState()
    expect(state.buttons).toEqual(INITIAL_START_BUTTONS)
    expect(state.buttons).not.toContain('goBack')
    expect(startView(state).goBack).toBeNull()
    expect(startView(state).buttons.map((b) => b.key)).toEqual(INITIAL_START_BUTTONS)
  })

  it('卷轴停在第 0 帧、载入不画、关于我们不画', () => {
    const view = startView(createStartPanelState())
    expect(view.scroll).toEqual({ sequence: 'scroll', frame: 0 })
    expect(view.loadingFrame).toBeNull()
    expect(view.loading2Frame).toBeNull()
    expect(view.aboutWidth).toBeNull()
    expect(view.cloudY).toBe(CLOUD_START_Y)
  })

  it('⚠️ signal 的初值是 0（原版 `int BUTTON_SIGNAL;` 的默认值），不是 −1', () => {
    expect(createStartPanelState().signal).toBe(0)
  })

  it('startView 不推进 —— 开机那一帧不该因为"被画了一次"就往前走', () => {
    const state = createStartPanelState()
    const before = JSON.stringify(state)
    startView(state)
    startView(state)
    expect(JSON.stringify(state)).toBe(before)
    // 而且这一帧确实什么过场都触发不了：两条卷轴都还没播完一循环。
    expect({ scroll: state.scroll.isLoop, back: state.backScroll.isLoop }).toEqual({
      scroll: false,
      back: false,
    })
    // 换句话说：这一拍就算真按原版那样"画一次"，状态也不会变。
    expect(tickStartPanel(state).effect).toBeNull()
  })

  it('一颗按钮都不碰，跑 300 拍什么都不会发生 —— 但云一直在飘', () => {
    const result = run(createStartPanelState(), 300)
    expect(result.effects).toEqual([])
    expect(result.state.isUnfolded).toBe(false)
    // 分母：真的跑了 300 拍。
    expect(result.views).toHaveLength(300)
    // 云飘过的高度不止一个值 —— 这条要是只剩一个值，说明 updateCloud 没被调。
    expect(new Set(result.views.map((v) => v.cloudY)).size).toBeGreaterThan(50)
  })
})

describe('自绘鼠标', () => {
  it('8 帧永远在转 —— 原版每一拍都先 startMouseAnimation()', () => {
    const frames = run(createStartPanelState(), 17).views.map((v) => v.cursorFrame)
    const count = START_SEQUENCES.cursor.count
    expect(count).toBe(8)
    expect(frames).toEqual(Array.from({ length: 17 }, (_, i) => i % count))
  })

  it('跟着指针走', () => {
    const moved = moveStartCursor(createStartPanelState(), 512, 320)
    expect(startView(moved)).toMatchObject({ cursorX: 512, cursorY: 320 })
  })
})

describe('按钮高亮', () => {
  it('没进按钮时无条件画第 0 帧 —— 原版 drawButton 里那句是没有 if 的', () => {
    const frames = run(createStartPanelState(), 10).views.map((v) => v.buttons[0]!.glowFrame)
    expect(frames).toEqual(Array(10).fill(0))
  })

  it('鼠标移进去才转，移出去停回第 0 帧', () => {
    const inside = hoverStartButton(createStartPanelState(), 'newGame')
    const playing = run(inside, 6)
    const count = START_SEQUENCES.buttonGlow.count
    expect(count).toBe(4)
    expect(playing.views.map((v) => v.buttons[0]!.glowFrame)).toEqual(
      Array.from({ length: 6 }, (_, i) => i % count),
    )
    // 别的按钮一动不动 —— 原版那圈循环把没进的每一颗都 stopButtonAnimation。
    expect(new Set(playing.views.map((v) => v.buttons[1]!.glowFrame))).toEqual(new Set([0]))

    const outside = hoverStartButton(playing.state, null)
    expect(startView(outside).buttons[0]!.glowFrame).toBe(0)
  })

  it('⚠️ 再进来是**接着转**的，不是从头 —— stopButtonAnimation 不动 next', () => {
    let state = hoverStartButton(createStartPanelState(), 'newGame')
    state = run(state, 2).state // 画到第 1 帧，next = 2
    state = hoverStartButton(state, null)
    state = hoverStartButton(state, 'newGame')
    expect(run(state, 1).views[0]!.buttons[0]!.glowFrame).toBe(2)
  })

  it('按下去会把高亮停掉（原版 isPressedButton 里那句）', () => {
    let state = hoverStartButton(createStartPanelState(), 'about')
    state = run(state, 2).state
    const pressed = pressStartButton(state, 'about')
    expect(startView(pressed).buttons[2]!.glowFrame).toBe(0)
    // 而且按住之后再跑几拍也不转 —— 它是真的停了，不只是画面回到第 0 帧。
    expect(new Set(run(pressed, 5).views.map((v) => v.buttons[2]!.glowFrame))).toEqual(
      new Set([0]),
    )
  })

  it('悬停换的是图，而且只画一张 —— 原版 buttonImage 就是一个字段', () => {
    const view = startView(hoverStartButton(createStartPanelState(), 'newGame'))
    expect(view.buttons.map((b) => b.hover)).toEqual([true, false, false, false])
  })
})

describe('点「起」：卷轴 10 拍 + 载入表 30 拍', () => {
  const clicked = () => click(createStartPanelState(), 'newGame').state

  it('第 10 拍卷轴播完一循环、当拍展开，之前每一拍都没展开', () => {
    const result = run(clicked(), 12)
    const unfoldAt: number[] = []
    let state = clicked()
    for (let tick = 1; tick <= 12; tick++) {
      state = tickStartPanel(state).state
      if (state.isUnfolded) unfoldAt.push(tick)
    }
    expect(unfoldAt).toEqual([10, 11, 12])
    // 卷轴那 10 帧逐拍走完，第 10 拍画的正是最后一帧。
    expect(result.views.slice(0, 10).map((v) => v.scroll)).toEqual(
      Array.from({ length: 10 }, (_, i) => ({ sequence: 'scroll' as const, frame: i })),
    )
    // 第 11 拍起画的是反向卷轴的第 0 帧（展开着的那张）。
    expect(result.views[10]!.scroll).toEqual({ sequence: 'backScroll', frame: 0 })
  })

  it('⚠️ 载入动画在**卷轴播完的那一拍**就出现 —— 原版画它的那几行排在 drawScroll() 之后', () => {
    const result = run(clicked(), 12)
    // 前 9 拍不画，第 10 拍当拍第 0 帧。把 composeView 改成两段都用同一个
    // 状态，这一条立刻红（第 10 拍会变成 null）。
    expect(result.views.slice(0, 9).map((v) => v.loadingFrame)).toEqual(Array(9).fill(null))
    expect(result.views[9]!.loadingFrame).toBe(0)
    expect(result.views[9]!.loading2Frame).toBe(0)
    // ⚠️ 第 11 拍**还是**第 0 帧，不是第 1 帧：`startAnimation()` 只放开闸门，
    // 下一拍的 `updateImage` 才把 `currentImage` 设成 `array[0]` 并把 `i` 推到
    // 1。所以第 0 帧出现两拍 —— 原版就是这样，而"第一帧多停一拍"在画面上
    // 完全看不出来。
    expect(result.views[10]!.loadingFrame).toBe(0)
    expect(result.views[11]!.loadingFrame).toBe(1)
  })

  it('展开之后再等 30 拍才换面板，一共 40 拍', () => {
    const result = run(clicked(), 60)
    expect(result.effects).toEqual([{ tick: 10 + LOAD_TICKS, effect: 'newGame' }])
  })

  it('换面板那一拍，载入动画当拍就消失', () => {
    const result = run(clicked(), 41)
    const at = 10 + LOAD_TICKS
    expect(result.views[at - 2]!.loadingFrame).not.toBeNull()
    expect(result.views[at - 1]!.loadingFrame).toBeNull()
    expect(result.views[at - 1]!.loading2Frame).toBeNull()
  })

  it('两段载入各按自己的帧数循环（10 帧与 3 帧）', () => {
    const result = run(clicked(), 22)
    // 第 10 拍是第 0 帧，第 11 拍还是第 0 帧（见上一条那个怪癖），此后逐拍。
    const loading = result.views.slice(9, 22).map((v) => v.loadingFrame)
    const loading2 = result.views.slice(9, 22).map((v) => v.loading2Frame)
    expect(loading).toEqual([0, ...Array.from({ length: 12 }, (_, i) => i % 10)])
    expect(loading2).toEqual([0, ...Array.from({ length: 12 }, (_, i) => i % 3)])
    expect({ a: START_SEQUENCES.loading.count, b: START_SEQUENCES.loading2.count }).toEqual({
      a: 10,
      b: 3,
    })
  })
})

describe('点「转」：关于我们逐段揭开，再点「回」逐段收回', () => {
  const opened = () => click(createStartPanelState(), 'about').state

  it('揭开是 0, 100, …, 900 —— 每拍一段，10 拍走完', () => {
    const result = run(opened(), ABOUT_TICKS)
    expect(result.views.map((v) => v.aboutWidth)).toEqual([
      0, 100, 200, 300, 400, 500, 600, 700, 800, 900,
    ])
  })

  it('第 10 拍展开完，「回」当拍就出现；第 11 拍起画整幅', () => {
    const result = run(opened(), 12)
    expect(result.views.slice(0, 9).map((v) => v.goBack)).toEqual(Array(9).fill(null))
    expect(result.views[9]!.goBack).toEqual({ key: 'goBack', hover: false, glowFrame: 0 })
    expect(result.views[10]!.aboutWidth).toBe(ABOUT_WIDTH)
    expect(result.views[11]!.aboutWidth).toBe(ABOUT_WIDTH)
    // 「转」这条路**不换面板** —— 40 拍下来一个动作都没有。
    expect(run(opened(), 60).effects).toEqual([])
  })

  it('点「回」：收回是 900, 800, …, 0，第 10 拍回到标题', () => {
    const state = run(opened(), 12).state
    expect(state.isUnfolded).toBe(true)
    const back = click(state, 'goBack')
    expect(back.effect).toBeNull()
    // 「回」当场就从名单里去掉了 —— 原版 setButton 里那句 buttons.remove(back)。
    expect(back.state.buttons).not.toContain('goBack')
    const result = run(back.state, ABOUT_TICKS)
    expect(result.views.map((v) => v.aboutWidth)).toEqual([
      900, 800, 700, 600, 500, 400, 300, 200, 100, 0,
    ])
    // 反向卷轴 10 帧逐拍走完。
    expect(result.views.map((v) => v.scroll.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(result.state.isUnfolded).toBe(false)
    expect(result.state.signal).toBe(-1)
    // 回到标题之后关于我们整个不画了。
    expect(run(result.state, 1).views[0]!.aboutWidth).toBeNull()
  })

  it('回到标题之后还能再点「转」一次 —— 状态真的复位了', () => {
    let state = run(opened(), 12).state
    state = run(click(state, 'goBack').state, ABOUT_TICKS).state
    const again = run(click(state, 'about').state, ABOUT_TICKS)
    expect(again.views.map((v) => v.aboutWidth)).toEqual([
      0, 100, 200, 300, 400, 500, 600, 700, 800, 900,
    ])
    expect(again.state.buttons).toContain('goBack')
  })
})

describe('两条今天走不到、但照原版实现了的路', () => {
  it('「承」跟「起」一样走 40 拍，推出来的是 loadPanel', () => {
    const result = run(click(createStartPanelState(), 'load').state, 60)
    expect(result.effects).toEqual([{ tick: 10 + LOAD_TICKS, effect: 'loadPanel' }])
  })

  it('「结」当场退出，**不走**卷轴过场', () => {
    const clicked = click(createStartPanelState(), 'end')
    expect(clicked.effect).toBe('exit')
    // 卷轴一拍都没动 —— 原版 setButton 里 end 那支直接 System.exit(0)。
    expect(clicked.state.scroll.isStop).toBe(true)
    expect(run(clicked.state, 60).state.isUnfolded).toBe(false)
  })
})

describe('输入的次序', () => {
  it('先 setButton 再清 isclicked —— 反过来就什么都不会发生', () => {
    const pressed = pressStartButton(createStartPanelState(), 'newGame')
    expect(pressed.clicked.newGame).toBe(true)
    const released = releaseStartButton(pressed, 'newGame')
    // 松手之后 isclicked 清掉了，可卷轴已经播起来了。
    expect(released.state.clicked.newGame).toBe(false)
    expect(released.state.scroll.isStop).toBe(false)
  })

  it('没按下就松手，什么都不会发生', () => {
    const released = releaseStartButton(createStartPanelState(), 'newGame')
    expect(released.effect).toBeNull()
    expect(released.state.scroll.isStop).toBe(true)
    expect(run(released.state, 60).effects).toEqual([])
  })

  it('卷轴已经在播的时候再点一次「转」，signal 会被改掉（原版就这样）', () => {
    // 原版 setButton 只看 `!isUnfolded`，不看卷轴在不在播 —— 所以过场中途
    // 换一颗按钮是能改主意的。这是复刻，不是设计。
    let state = click(createStartPanelState(), 'newGame').state
    state = run(state, 3).state
    state = click(state, 'about').state
    expect(state.signal).toBe(2)
    // 于是卷轴接着往下播（不重头），播完走的是「转」那条路。
    const result = run(state, 10)
    expect(result.state.buttons).toContain('goBack')
    expect(result.effects).toEqual([])
  })
})
