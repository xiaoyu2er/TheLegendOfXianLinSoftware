import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { startAssetId, startFrameAssetId } from '../assets/ids'
import { resolveAsset } from '../assets/resolve'
import { javaSource } from '../test/javaSource'
import { StartPanel } from './StartPanel'
import { START_SEQUENCES } from './assets'
import {
  HIT_OFFSET_X,
  HIT_OFFSET_Y,
  INITIAL_START_BUTTONS,
  START_BUTTONS,
  START_BUTTON_WIRING,
  startButtonHitBox,
} from './buttons'
import { ABOUT_TICKS, ABOUT_WIDTH, LOAD_TICKS, START_TICK_MS } from './layout'

/**
 * 开始界面这一屏。摆位的数字对不对由 `buttons.test.ts` / `layout.test.ts` 对着
 * GBK 源码守着，帧序与拍数由 `panelState.test.ts` 守着，**这里守的是组件有没有
 * 用那些东西** —— 三件事，中间那一步没人验就等于没验（跟烘焙器那条「源文件在
 * ≠ 产物在」是同一个道理）。
 */
afterEach(cleanup)

/** 推进 `ticks` 拍。组件内部是 `setInterval(START_TICK_MS)` 加真实时间余量。 */
function tick(ticks: number): void {
  act(() => {
    vi.advanceTimersByTime(ticks * START_TICK_MS)
  })
}

describe('开始界面', () => {
  beforeEach(() => {
    // `useStartPanel` 数的是 `performance.now()` 的差（后台节流时按次数数拍会
    // 把时间数丢），所以假时钟必须**连 performance 一起**接管，不然每一次
    // 触发都算作"过去了 0 ms"，一拍都不会走。
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('背景图按原始尺寸画在 (0,0)，不缩', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const back = screen.getByTestId('start-panel').querySelector('.start-back') as HTMLImageElement
    expect(back).not.toBeNull()
    expect(back.getAttribute('src')).toBe(resolveAsset(startAssetId('back')))
    // 不带 width/height：带了就是缩放，而 back.png 是 1024×641，缩一下整张图
    // 纵向差半个像素，画面上看起来完全正常。多出来那一行由 overflow 裁掉。
    expect(back.hasAttribute('width')).toBe(false)
    expect(back.hasAttribute('height')).toBe(false)
  })

  it('开机四颗按钮，读屏读得到名字；禁用的两颗各带一句理由', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const buttons = screen.getAllByRole('button')
    // 分母是 `INITIAL_START_BUTTONS`，不是手写的 4 —— 那份名单本身由
    // `buttons.test.ts` 对着源码守着。
    const initial = START_BUTTONS.filter((b) => INITIAL_START_BUTTONS.includes(b.key))
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(initial.map((b) => b.label))
    // 上面那条**只验组件用了那份名单**，验不了名单本身写的是什么：把四个
    // `label` 一起改成乱码，两边一起变，它照绿。名字是给人读的，原版按钮上
    // 只有一个字、推不出这四个词，所以这是一份**手写的登记**，在这里签一次字。
    expect(START_BUTTONS.map((b) => b.label)).toEqual([
      '开始新游戏',
      '读取存档',
      '关于我们',
      '结束游戏',
      '返回标题',
    ])
    for (const spec of initial) {
      const element = screen.getByRole('button', { name: spec.label })
      expect(element.hasAttribute('disabled'), `${spec.key} 的启用状态`).toBe(
        !START_BUTTON_WIRING[spec.key].enabled,
      )
      expect(element.getAttribute('title')).toBe(START_BUTTON_WIRING[spec.key].disabledReason)
    }
    // **禁用而不是不画**：不画的话「这一版还没做」与「原版就只有三颗按钮」
    // 分不开，而后者是错的。
    expect(screen.getByRole('button', { name: '读取存档' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '结束游戏' })).toBeDisabled()
  })

  it('按钮元素占的是命中框，不是画出来那个矩形', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const initial = START_BUTTONS.filter((b) => INITIAL_START_BUTTONS.includes(b.key))
    const actual = initial.map((spec) => {
      const el = screen.getByRole('button', { name: spec.label })
      return { key: spec.key, left: el.style.left, top: el.style.top }
    })
    const expected = initial.map((spec) => {
      const box = startButtonHitBox(spec)
      return { key: spec.key, left: `${box.x}px`, top: `${box.y}px` }
    })
    // 拿绘制坐标当元素位置（`left: 200px`）会红：命中框是 185 / 144。
    expect(actual).toEqual(expected)
    expect(expected[0]).toEqual({ key: 'newGame', left: '185px', top: '144px' })
  })

  it('一颗按钮画两张图：那圈高亮 + 常态/悬停里的一张，都推回原版的绘制位置', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const el = screen.getByRole('button', { name: '开始新游戏' })
    const images = [...el.querySelectorAll('img')] as HTMLImageElement[]
    // **只画一张脸**（原版 `buttonImage` 就是一个字段），加一圈高亮 = 两张。
    expect(images).toHaveLength(2)
    // **次序照原版 `drawButton`：按钮图在前、高亮在后**（高亮盖在上面）。这里原先钉的是
    // 反过来的次序，逐帧比对（xl-whk）第 0 帧在四颗按钮左沿量到了差才发现 —— 所以次序
    // 从 GBK 源码现读，不再手写。
    const src = javaSource('src/start/StartButton.java').replace(/\s+/g, '')
    const body = src.slice(src.indexOf('publicvoiddrawButton(Graphicsg){'))
    const faceAt = body.indexOf('g.drawImage(buttonImage,x,y,mp);')
    const glowAt = body.indexOf('animation.drawAnimation(g);')
    expect(faceAt, 'drawButton 里没找到画按钮图那一句').toBeGreaterThan(0)
    expect(glowAt, 'drawButton 里没找到画高亮那一句').toBeGreaterThan(0)
    const faceFirst = faceAt < glowAt
    const glowSrc = resolveAsset(startFrameAssetId('buttonGlow', 0))
    const faceSrc = resolveAsset(startAssetId('newGame'))
    expect(images.map((f) => f.getAttribute('src'))).toEqual(faceFirst ? [faceSrc, glowSrc] : [glowSrc, faceSrc])
    // 命中框往左上挪了 (15,6)，这里推回去，于是图仍然画在原版的 (200,150)。
    for (const image of images) {
      expect({ left: image.style.left, top: image.style.top }).toEqual({
        left: `${-HIT_OFFSET_X}px`,
        top: `${-HIT_OFFSET_Y}px`,
      })
    }
    const spec = START_BUTTONS[0]!
    const box = startButtonHitBox(spec)
    expect([box.x - HIT_OFFSET_X, box.y - HIT_OFFSET_Y]).toEqual([spec.x, spec.y])
  })

  it('鼠标移进按钮：换成悬停图，那圈高亮开始转；移出去换回来并停在第 0 帧', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const el = screen.getByRole('button', { name: '开始新游戏' })
    const glow = () => (el.querySelector('.start-button-glow') as HTMLImageElement).src
    const face = () => (el.querySelector('.start-button-face') as HTMLImageElement).src

    tick(3)
    expect(glow()).toContain(resolveAsset(startFrameAssetId('buttonGlow', 0)))
    expect(face()).toContain(resolveAsset(startAssetId('newGame')))

    fireEvent.mouseEnter(el)
    expect(face()).toContain(resolveAsset(startAssetId('newGameHover')))
    tick(2)
    // 转起来了：第 2 拍画的是第 1 帧。
    expect(glow()).toContain(resolveAsset(startFrameAssetId('buttonGlow', 1)))

    fireEvent.mouseLeave(el)
    expect(face()).toContain(resolveAsset(startAssetId('newGame')))
    expect(glow()).toContain(resolveAsset(startFrameAssetId('buttonGlow', 0)))
  })

  it('悬停禁用的「结」：不换图、高亮不转 —— 原版会换（ADR-0001 的 start-exit-disabled，xl-r0x）', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const end = screen.getByRole('button', { name: '结束游戏' })
    const face = (el: HTMLElement) => (el.querySelector('.start-button-face') as HTMLImageElement).src
    const glow = (el: HTMLElement) => (el.querySelector('.start-button-glow') as HTMLImageElement).src

    // 与上面「鼠标移进按钮」那条同一套事件、同样的拍数。
    fireEvent.mouseEnter(end)
    fireEvent.mouseMove(end)
    tick(2)
    expect(face(end)).toContain(resolveAsset(startAssetId('end')))
    expect(face(end)).not.toContain(resolveAsset(startAssetId('endHover')))
    expect(glow(end)).toContain(resolveAsset(startFrameAssetId('buttonGlow', 0)))

    // 对照：同一套事件打在活着的「起」上会换。没有这一半的话，fireEvent 本身失效也是绿的。
    const start = screen.getByRole('button', { name: '开始新游戏' })
    fireEvent.mouseEnter(start)
    fireEvent.mouseMove(start)
    tick(2)
    expect(face(start)).toContain(resolveAsset(startAssetId('newGameHover')))
    expect(glow(start)).toContain(resolveAsset(startFrameAssetId('buttonGlow', 1)))
  })

  it('⚠️ 点完之后鼠标在框里动一下，高亮续播 —— 组件挂了 onMouseMove', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const el = screen.getByRole('button', { name: '关于我们' })
    const glow = () => (el.querySelector('.start-button-glow') as HTMLImageElement).src

    fireEvent.mouseEnter(el)
    tick(2)
    expect(glow()).toContain(resolveAsset(startFrameAssetId('buttonGlow', 1)))
    // 按一下 —— 原版 isPressedButton 把高亮停了。
    fireEvent.mouseDown(el, { buttons: 1 })
    fireEvent.mouseUp(el, { buttons: 0 })
    tick(3)
    expect(glow()).toContain(resolveAsset(startFrameAssetId('buttonGlow', 0)))
    // 鼠标没出框，只是动了一下。只挂 onMouseEnter 的话这里还是第 0 帧。
    fireEvent.mouseMove(el)
    tick(1)
    expect(glow()).not.toContain(resolveAsset(startFrameAssetId('buttonGlow', 0)))
  })

  it('按着键移进按钮不跑悬停 —— 原版 mouseDragged 只记坐标、不跑 isMoveIn（xl-vi8）', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const el = screen.getByRole('button', { name: '开始新游戏' })
    const glow = () => (el.querySelector('.start-button-glow') as HTMLImageElement).src
    const face = () => (el.querySelector('.start-button-face') as HTMLImageElement).src
    // 原版把 mouseMoved / mouseDragged 两个回调分开，判据就从 GBK 源码现读：
    // mouseDragged 那一支里一句 isMoveIn 都没有。
    const src = javaSource('src/start/StartPanel.java').replace(/\s+/g, '')
    const dragged = src.slice(src.indexOf('publicvoidmouseDragged('))
    // 截到监听器收尾的 `});` —— mouseDragged 是 MouseMotionAdapter 里最后一个方法。
    const end = dragged.indexOf('});')
    expect(end, '没找到 mouseDragged 或它的收尾').toBeGreaterThan(0)
    expect(dragged.slice(0, end)).toContain('currentX=ex.getX();')
    expect(dragged.slice(0, end)).not.toContain('isMoveIn')

    // 按着键（舞台外按下拖进来 / 面板上按下拖过来，两种在这里同形）移进、再动。
    fireEvent.mouseEnter(el, { buttons: 1 })
    fireEvent.mouseMove(el, { buttons: 1 })
    tick(2)
    expect(face()).toContain(resolveAsset(startAssetId('newGame')))
    expect(glow()).toContain(resolveAsset(startFrameAssetId('buttonGlow', 0)))

    // 对照：松开键之后头一下移动就是 mouseMoved，当场换。没有这一半，事件没带上 buttons 也是绿的。
    fireEvent.mouseMove(el, { buttons: 0 })
    tick(2)
    expect(face()).toContain(resolveAsset(startAssetId('newGameHover')))
    expect(glow()).toContain(resolveAsset(startFrameAssetId('buttonGlow', 1)))

    // 移出**也看键**（xl-4zo）：按着键拖出框，原版不跑 isMoveIn，图留着。松手那一下再按落点换回来，
    // 见下面「在按钮上按下、拖出框」那条。
    fireEvent.mouseLeave(el, { buttons: 1 })
    expect(face()).toContain(resolveAsset(startAssetId('newGameHover')))
    // 对照：没按着键移出，当场换回常态图。
    fireEvent.mouseEnter(el, { buttons: 0 })
    fireEvent.mouseLeave(el, { buttons: 0 })
    expect(face()).toContain(resolveAsset(startAssetId('newGame')))
    expect(glow()).toContain(resolveAsset(startFrameAssetId('buttonGlow', 0)))
  })

  /**
   * 以下几条是 xl-4zo：鼠标的按下 / 松手分成两下送，松手按下那一刻挂到 window 上。
   * 原版的读数在 `start-drag-out` 那份真值里（`startTrace.test.ts` 逐步对齐），这里守的是
   * **组件真的把 DOM 事件送成了那两下** —— 状态机对了、组件还是合成一次 `click` 的话，
   * 状态层判据照样全绿。
   */
  it('在按钮上按下、拖出框、在空处松手 —— 照样触发（原版 setButton 不看坐标，xl-4zo）', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    const el = screen.getByRole('button', { name: '关于我们' })
    const face = () => (el.querySelector('.start-button-face') as HTMLImageElement).src
    const glow = () => (el.querySelector('.start-button-glow') as HTMLImageElement).src
    const back = panel.querySelector('.start-back') as HTMLElement

    fireEvent.mouseEnter(el)
    tick(2)
    fireEvent.mouseDown(el, { buttons: 1 })
    // 按下图（= 悬停那张，原版两个实参是同一个文件）留着，高亮停了。
    fireEvent.mouseLeave(el, { buttons: 1 })
    fireEvent.mouseMove(back, { buttons: 1 })
    tick(2)
    expect(face()).toContain(resolveAsset(startAssetId('aboutHover')))
    expect(glow()).toContain(resolveAsset(startFrameAssetId('buttonGlow', 0)))
    expect(screen.queryByTestId('start-about')).toBeNull()

    // 松在背景上 —— 不在任何一颗按钮上，浏览器也不会派 click。
    fireEvent.mouseUp(back, { buttons: 0 })
    expect(face(), '框外松手：图换回常态').toContain(resolveAsset(startAssetId('about')))
    tick(1)
    expect(screen.getByTestId('start-about').dataset.width).toBe('0')
    tick(ABOUT_TICKS)
    expect(screen.getByRole('button', { name: '返回标题' })).toBeInTheDocument()
  })

  it('框外松手之后 isclicked 留着真：收起之后在空处按一下松一下，又展开一次（原版就这样）', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    const back = panel.querySelector('.start-back') as HTMLElement
    const about = () => screen.queryByTestId('start-about')

    fireEvent.mouseDown(screen.getByRole('button', { name: '关于我们' }), { buttons: 1 })
    fireEvent.mouseUp(back, { buttons: 0 })
    tick(ABOUT_TICKS + 1)
    const goBack = screen.getByRole('button', { name: '返回标题' })
    fireEvent.mouseDown(goBack, { buttons: 1 })
    fireEvent.mouseUp(goBack, { buttons: 0 })
    tick(ABOUT_TICKS + 1)
    expect(about(), '「回」收起来了').toBeNull()

    // 按下、松开都在空处。
    fireEvent.mouseDown(back, { buttons: 1 })
    fireEvent.mouseUp(back, { buttons: 0 })
    tick(1)
    expect(about(), '残留的 about.isclicked 让它又展开了').not.toBeNull()
  })

  it('没在面板上按下就松手（舞台外按下拖进来）：什么都不发生 —— 原版的 grab 不归这块面板', () => {
    const onNewGame = vi.fn()
    render(<StartPanel onNewGame={onNewGame} onLoad={() => {}} />)
    const el = screen.getByRole('button', { name: '开始新游戏' })
    fireEvent.mouseUp(el, { buttons: 0 })
    tick(10 + LOAD_TICKS)
    expect(onNewGame).not.toHaveBeenCalled()
    // 对照：先在面板上按下，同一个松手就触发。没有这一半，mouseUp 根本没送到也是绿的。
    fireEvent.mouseDown(el, { buttons: 1 })
    fireEvent.mouseUp(el, { buttons: 0 })
    tick(10 + LOAD_TICKS)
    expect(onNewGame).toHaveBeenCalledTimes(1)
  })

  it('鼠标的 click（detail ≥ 1）不再合成一次按下 + 松手；键盘的（detail 为 0）照旧', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const el = screen.getByRole('button', { name: '关于我们' })
    fireEvent.click(el, { detail: 1 })
    tick(1)
    expect(screen.queryByTestId('start-about'), '鼠标 click 自己触发了').toBeNull()
    fireEvent.click(el, { detail: 0 })
    tick(1)
    expect(screen.queryByTestId('start-about'), '键盘按不动了（xl-fqm）').not.toBeNull()
  })

  it('鼠标按下不给按钮焦点 —— 焦点 = 悬停，会把按下停掉的高亮当场又转起来', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const el = screen.getByRole('button', { name: '开始新游戏' })
    // fireEvent 的返回值是「默认动作没被取消」。
    expect(fireEvent.mouseDown(el, { buttons: 1 })).toBe(false)
    // 对照：面板背景上按下不拦（那里本来就没有焦点可给）。
    const back = screen.getByTestId('start-panel').querySelector('.start-back') as HTMLElement
    fireEvent.mouseUp(back, { buttons: 0 })
    expect(fireEvent.mouseDown(back, { buttons: 1 })).toBe(true)
  })

  it('松手丢了（窗口外 / 禁用的「结」上）：回来头一下没按着键的移动补上那一下松手', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    const back = panel.querySelector('.start-back') as HTMLElement
    fireEvent.mouseDown(screen.getByRole('button', { name: '关于我们' }), { buttons: 1 })
    // 按着键的移动不算。
    fireEvent.mouseMove(back, { buttons: 1 })
    tick(1)
    expect(screen.queryByTestId('start-about')).toBeNull()
    fireEvent.mouseMove(back, { buttons: 0 })
    tick(1)
    expect(screen.queryByTestId('start-about')).not.toBeNull()
  })

  it('松手丢了、回来没动就又按下：先补那一下松手，再送这次按下', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const back = screen.getByTestId('start-panel').querySelector('.start-back') as HTMLElement
    fireEvent.mouseDown(screen.getByRole('button', { name: '关于我们' }), { buttons: 1 })
    // 左键又按下，除它之外没按着别的键 —— 上一次的松手丢了。
    fireEvent.mouseDown(back, { button: 0, buttons: 1 })
    tick(1)
    expect(screen.queryByTestId('start-about'), '补上的松手让「转」触发了').not.toBeNull()
  })

  it('和弦：按着左键再按右键，不补松手 —— 那是第二个键，不是丢了松手', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const back = screen.getByTestId('start-panel').querySelector('.start-back') as HTMLElement
    fireEvent.mouseDown(screen.getByRole('button', { name: '关于我们' }), { buttons: 1 })
    fireEvent.mouseDown(back, { button: 2, buttons: 3 })
    tick(1)
    expect(screen.queryByTestId('start-about')).toBeNull()
  })

  it('卸载时把挂在 window 上的松手摘掉', () => {
    const onNewGame = vi.fn()
    const view = render(<StartPanel onNewGame={onNewGame} onLoad={() => {}} />)
    const remove = vi.spyOn(window, 'removeEventListener')
    fireEvent.mouseDown(screen.getByRole('button', { name: '开始新游戏' }), { buttons: 1 })
    view.unmount()
    // 连第三个参数一起比：`mousemove` 挂在捕获阶段，摘的时候漏写 `true` 就什么都没摘掉。
    expect(remove.mock.calls.map((c) => [c[0], c[2] ?? false]).sort()).toEqual([
      ['mousemove', true],
      ['mouseup', false],
    ])
    remove.mockRestore()
  })

  it('键盘 Tab 过来也换图、也转高亮 —— 原版没有这条，是这里补的无障碍', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const el = screen.getByRole('button', { name: '开始新游戏' })
    fireEvent.focus(el)
    expect((el.querySelector('.start-button-face') as HTMLImageElement).src).toContain(
      resolveAsset(startAssetId('newGameHover')),
    )
    tick(2)
    expect((el.querySelector('.start-button-glow') as HTMLImageElement).src).toContain(
      resolveAsset(startFrameAssetId('buttonGlow', 1)),
    )
  })

  it('云一直在飘，自绘鼠标 8 帧一直在转', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const cloud = () =>
      Number((screen.getByTestId('start-panel').querySelector('.start-cloud') as HTMLElement).style.top.replace('px', ''))
    const cursor = () =>
      screen.getByTestId('start-panel').querySelector('.start-cursor') as HTMLImageElement

    const first = cloud()
    tick(5)
    // 每拍 −10，五拍就是 −50。云不动的话这条红。
    expect(cloud()).toBe(first - 50)
    // 第 N 拍画的是第 N−1 帧：`updateImage` 先把 `currentImage` 设成 `array[i]`
    // 再自增，而 `i` 从 0 起。
    expect(cursor().dataset.frame).toBe('4')
    tick(4)
    // 8 帧循环：第 9 拍绕回第 0 帧。
    expect(cursor().dataset.frame).toBe('0')
    expect(START_SEQUENCES.cursor.count).toBe(8)
  })

  it('自绘鼠标跟着指针走，坐标按舞台缩放换算回逻辑坐标', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    // jsdom 里元素没有布局，`getBoundingClientRect` 全是 0 —— 那时组件应该
    // 什么都不做（除以 0 会得到 NaN，而 `left: NaNpx` 是一条被浏览器丢掉的
    // 声明，画面上看起来像"鼠标不见了"）。
    panel.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 512, height: 320 }) as DOMRect
    fireEvent.mouseMove(panel, { clientX: 128, clientY: 80 })
    const cursor = panel.querySelector('.start-cursor') as HTMLImageElement
    // 舞台被缩到一半，所以 (128,80) 在逻辑坐标里是 (256,160)。
    expect({ left: cursor.style.left, top: cursor.style.top }).toEqual({
      left: '256px',
      top: '160px',
    })
  })

  it('舞台外按下、按着键拖进来：自绘鼠标不动 —— 原版目标是 null，mouseDragged 一次都不派（xl-b98）', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    panel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 640 }) as DOMRect
    const cursor = panel.querySelector('.start-cursor') as HTMLImageElement
    fireEvent.mouseMove(panel, { clientX: 100, clientY: 100, buttons: 0 })
    expect({ left: cursor.style.left, top: cursor.style.top }).toEqual({ left: '100px', top: '100px' })
    // 按下不在面板上（没有 mousedown 落到它），按着键移进来。
    fireEvent.mouseMove(panel, { clientX: 300, clientY: 200, buttons: 1 })
    expect({ left: cursor.style.left, top: cursor.style.top }).toEqual({ left: '100px', top: '100px' })
    // 全松开之后头一下移动是 mouseMoved，照常记坐标。
    fireEvent.mouseMove(panel, { clientX: 320, clientY: 210, buttons: 0 })
    expect({ left: cursor.style.left, top: cursor.style.top }).toEqual({ left: '320px', top: '210px' })
  })

  /**
   * xl-m9q：舞台外按下左键、按着拖进来，再在面板上按右键。JDK 17 `LightweightDispatcher.isMouseGrab`
   * 对 MOUSE_PRESSED 只异或本键（右键），左键还在 → 为真，`mouseEventTarget` 不重设、仍是 null：
   * 这一下按下不派，之后的 `mouseDragged` 也不派（MOUSE_DRAGGED 在按着键时 `isMouseGrab` 恒真）。
   */
  it('舞台外按着左键拖进来再按右键：这一下按下不收，之后的拖动也不收（xl-m9q）', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    panel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 640 }) as DOMRect
    const cursor = panel.querySelector('.start-cursor') as HTMLImageElement
    const about = screen.getByRole('button', { name: '关于我们' })
    fireEvent.mouseMove(panel, { clientX: 100, clientY: 100, buttons: 0 })
    fireEvent.mouseDown(about, { button: 2, buttons: 3 })
    fireEvent.mouseMove(panel, { clientX: 300, clientY: 200, buttons: 3 })
    expect({ left: cursor.style.left, top: cursor.style.top }, '按下起了 grab，拖动跟着走了').toEqual({
      left: '100px',
      top: '100px',
    })
    fireEvent.mouseUp(about, { button: 2, buttons: 1 })
    fireEvent.mouseUp(about, { button: 0, buttons: 0 })
    tick(1)
    expect(screen.queryByTestId('start-about'), '按下被送进去了').toBeNull()
  })

  it('对照：只按着右键（之前没有别的键）在面板上按下，照常收、照常起 grab', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    panel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 640 }) as DOMRect
    const cursor = panel.querySelector('.start-cursor') as HTMLImageElement
    const about = screen.getByRole('button', { name: '关于我们' })
    fireEvent.mouseMove(panel, { clientX: 100, clientY: 100, buttons: 0 })
    fireEvent.mouseDown(about, { button: 2, buttons: 2 })
    fireEvent.mouseMove(panel, { clientX: 300, clientY: 200, buttons: 2 })
    expect({ left: cursor.style.left, top: cursor.style.top }).toEqual({ left: '300px', top: '200px' })
    fireEvent.mouseUp(about, { button: 2, buttons: 0 })
    tick(1)
    expect(screen.queryByTestId('start-about')).not.toBeNull()
  })

  it('对照：面板上按下再拖，grab 在这块面板上，mouseDragged 照样记坐标', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    panel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 640 }) as DOMRect
    const back = panel.querySelector('.start-back') as HTMLElement
    const cursor = panel.querySelector('.start-cursor') as HTMLImageElement
    // 动作之前先看一眼：初值恰好就是目标点的话，下面那句按构造成立。
    expect({ left: cursor.style.left, top: cursor.style.top }).not.toEqual({ left: '300px', top: '200px' })
    fireEvent.mouseDown(back, { button: 0, buttons: 1 })
    fireEvent.mouseMove(back, { clientX: 300, clientY: 200, buttons: 1 })
    expect({ left: cursor.style.left, top: cursor.style.top }).toEqual({ left: '300px', top: '200px' })
  })

  /**
   * xl-40m：原版 `mousePressed` / `mouseReleased` 头两句都是 `currentX = e.getX()`。grab 期间
   * JDK 17 `LightweightDispatcher.processMouseEvent` 不重设目标（PRESSED / RELEASED 的 `isMouseGrab`
   * 异或掉本键之后仍看得到按下前的状态），MOUSE_DRAGGED / MOUSE_RELEASED 照样 `retargetMouseEvent`
   * 给这块面板，坐标只减面板的偏移、**不裁** —— 拖出舞台就是负数或超过 1024×640。
   */
  it('按下记坐标：没先移动就在别处按下，自绘鼠标跳到按下的地方（原版 mousePressed 头一句）', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    panel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 640 }) as DOMRect
    const back = panel.querySelector('.start-back') as HTMLElement
    const cursor = panel.querySelector('.start-cursor') as HTMLImageElement
    fireEvent.mouseMove(panel, { clientX: 100, clientY: 100, buttons: 0 })
    expect({ left: cursor.style.left, top: cursor.style.top }).toEqual({ left: '100px', top: '100px' })
    fireEvent.mouseDown(back, { clientX: 300, clientY: 200, button: 0, buttons: 1 })
    expect({ left: cursor.style.left, top: cursor.style.top }).toEqual({ left: '300px', top: '200px' })
  })

  it('grab 期间拖出舞台、在舞台外松手：自绘鼠标跟到舞台外，坐标不裁（原版 mouseDragged / mouseReleased）', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    // 舞台缩到一半：舞台外的点也按同一个比例换算回逻辑坐标。
    panel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 512, height: 320 }) as DOMRect
    const back = panel.querySelector('.start-back') as HTMLElement
    const cursor = panel.querySelector('.start-cursor') as HTMLImageElement
    fireEvent.mouseDown(back, { clientX: 50, clientY: 50, button: 0, buttons: 1 })
    expect({ left: cursor.style.left, top: cursor.style.top }).toEqual({ left: '100px', top: '100px' })
    fireEvent.mouseMove(document.body, { clientX: -20, clientY: 350, buttons: 1 })
    expect({ left: cursor.style.left, top: cursor.style.top }, '拖出舞台停在了原处').toEqual({
      left: '-40px',
      top: '700px',
    })
    fireEvent.mouseUp(document.body, { clientX: 600, clientY: -15, button: 0, buttons: 0 })
    expect({ left: cursor.style.left, top: cursor.style.top }, '松手没记坐标').toEqual({
      left: '1200px',
      top: '-30px',
    })
  })

  it('对照：grab 不在这块面板上时，舞台外的移动 / 松手一概不记 —— 原版目标不是这块面板', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    panel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 640 }) as DOMRect
    const back = panel.querySelector('.start-back') as HTMLElement
    const cursor = panel.querySelector('.start-cursor') as HTMLImageElement
    fireEvent.mouseMove(panel, { clientX: 100, clientY: 100, buttons: 0 })
    fireEvent.mouseMove(document.body, { clientX: 1100, clientY: 700, buttons: 1 })
    fireEvent.mouseUp(document.body, { clientX: 1100, clientY: 700, button: 0, buttons: 0 })
    fireEvent.mouseMove(document.body, { clientX: 1200, clientY: 800, buttons: 0 })
    expect({ left: cursor.style.left, top: cursor.style.top }).toEqual({ left: '100px', top: '100px' })
    // 面板上按下、松开之后 grab 解除：再到舞台外按着键移动也不记。
    fireEvent.mouseDown(back, { clientX: 200, clientY: 200, button: 0, buttons: 1 })
    fireEvent.mouseUp(back, { clientX: 200, clientY: 200, button: 0, buttons: 0 })
    fireEvent.mouseMove(document.body, { clientX: 1100, clientY: 700, buttons: 1 })
    expect({ left: cursor.style.left, top: cursor.style.top }).toEqual({ left: '200px', top: '200px' })
  })

  it('外接矩形为 0 时一动不动 —— 不写出 `left: NaNpx`', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    const cursor = panel.querySelector('.start-cursor') as HTMLImageElement
    const before = { left: cursor.style.left, top: cursor.style.top }
    fireEvent.mouseMove(panel, { clientX: 128, clientY: 80 })
    expect({ left: cursor.style.left, top: cursor.style.top }).toEqual(before)
    expect(cursor.style.left).not.toContain('NaN')
  })

  it('点「起」：卷轴放完再等 30 拍才 onNewGame —— 不是立刻', () => {
    const onNewGame = vi.fn()
    render(<StartPanel onNewGame={onNewGame} onLoad={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '开始新游戏' }))
    // **点下去当场什么都不该发生**。xl-kaa 那一版是立刻换面板的，这条就是
    // 那处差别的判据。
    expect(onNewGame).not.toHaveBeenCalled()
    tick(10 + LOAD_TICKS - 1)
    expect(onNewGame).not.toHaveBeenCalled()
    tick(1)
    expect(onNewGame).toHaveBeenCalledTimes(1)
  })

  it('卷轴放完那一拍，载入动画当拍出现在原版那两个位置上', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    const loading = () => [...panel.querySelectorAll('.start-loading')] as HTMLImageElement[]
    expect(loading()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '开始新游戏' }))
    tick(9)
    expect(loading()).toHaveLength(0)
    tick(1)
    const shown = loading()
    expect(shown).toHaveLength(2)
    expect(shown.map((i) => [i.style.left, i.style.top])).toEqual([
      ['650px', '480px'],
      ['700px', '200px'],
    ])
  })

  /**
   * **登记与行为的对撞**（ADR-0005 那条「两个方向都会红」在这一屏的落点）。
   *
   * `START_BUTTON_WIRING` 说某颗按钮是活的，而组件那边没给它接线（或者状态机
   * 那条路根本不通），表现就是"点了没反应" —— 而那与"做完了"在截图上一模一样，
   * 正是票面 § Further notes 点名要避免的那件事。
   *
   * 判据是**屏幕签名**：屏幕上有哪几颗按钮、关于我们在不在、onNewGame 被调了
   * 几次。不拿整段 innerHTML 比，因为云和鼠标每一拍都在动，那样"什么都没发生"
   * 也会看起来变了 —— 那种检查的失败和成功长得一样。
   *
   * 两个方向：
   * - 把 `end`（或 `load`）翻成 `enabled: true` → 它成了可点的，点下去签名不变 → 红。
   * - 把某颗真活着的按钮的接线拆掉 → 同样红。
   */
  it('每一颗活着的按钮，点下去屏幕都得真的变', () => {
    const enabled = START_BUTTONS.filter(
      (b) => START_BUTTON_WIRING[b.key].enabled && INITIAL_START_BUTTONS.includes(b.key),
    )
    // 分母：开机那四颗里活着的有几颗。零颗的循环跑完看起来跟全过了一样。
    expect(enabled.map((b) => b.key)).toEqual(['newGame', 'load', 'about'])

    for (const spec of enabled) {
      const onNewGame = vi.fn()
      const onLoad = vi.fn()
      const signature = () => ({
        buttons: screen.getAllByRole('button').map((b) => b.getAttribute('aria-label')),
        about: screen.queryByTestId('start-about') !== null,
        newGame: onNewGame.mock.calls.length,
        load: onLoad.mock.calls.length,
      })
      const view = render(<StartPanel onNewGame={onNewGame} onLoad={onLoad} />)
      const before = signature()
      fireEvent.click(screen.getByRole('button', { name: spec.label }))
      // 卷轴 10 拍 + 载入表 30 拍，够走完最长的那条路。
      tick(10 + LOAD_TICKS)
      expect(signature(), `点「${spec.label}」之后屏幕没有任何变化`).not.toEqual(before)
      view.unmount()
    }
  })

  it('禁用的那两颗点下去屏幕纹丝不动 —— 与上一条同一个签名', () => {
    const disabled = START_BUTTONS.filter(
      (b) => !START_BUTTON_WIRING[b.key].enabled && INITIAL_START_BUTTONS.includes(b.key),
    )
    expect(disabled.map((b) => b.key)).toEqual(['end'])
    for (const spec of disabled) {
      const onNewGame = vi.fn()
      const onLoad = vi.fn()
      const signature = () => ({
        buttons: screen.getAllByRole('button').map((b) => b.getAttribute('aria-label')),
        about: screen.queryByTestId('start-about') !== null,
        newGame: onNewGame.mock.calls.length,
        load: onLoad.mock.calls.length,
      })
      const view = render(<StartPanel onNewGame={onNewGame} onLoad={onLoad} />)
      const before = signature()
      fireEvent.click(screen.getByRole('button', { name: spec.label }))
      tick(10 + LOAD_TICKS)
      expect(signature(), `禁用的「${spec.label}」竟然有反应`).toEqual(before)
      view.unmount()
    }
  })

  it('点「承」：载入表走完调一次 onLoad（进存读档面板，xl-i06.9），不调 onNewGame', () => {
    const onNewGame = vi.fn()
    const onLoad = vi.fn()
    render(<StartPanel onNewGame={onNewGame} onLoad={onLoad} />)
    fireEvent.click(screen.getByRole('button', { name: '读取存档' }))
    tick(10 + LOAD_TICKS - 1)
    expect(onLoad, '载入表还没走完就换了面板').not.toHaveBeenCalled()
    tick(1)
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(onNewGame).not.toHaveBeenCalled()
  })

  it('点「转」：关于我们逐段揭开，展开完出现「回」，点「回」又收回去', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    const about = () => panel.querySelector('.start-about') as HTMLElement | null
    expect(about()).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '关于我们' }))
    tick(1)
    // 第 1 拍露出 0 px —— 元素在，宽度为 0。原版那条式子就是从 0 起的。
    expect(about()?.dataset.width).toBe('0')
    tick(4)
    expect(about()?.dataset.width).toBe('400')
    expect(screen.queryByRole('button', { name: '返回标题' })).toBeNull()

    tick(5)
    // 第 10 拍展开完，「回」当拍出现。
    expect(screen.getByRole('button', { name: '返回标题' })).toBeInTheDocument()
    tick(1)
    // 整幅。
    expect(about()?.dataset.width).toBe(String(ABOUT_WIDTH))
    // 而且是**裁剪**不是缩放：里面那张图不带 width/height。
    const page = about()!.querySelector('img') as HTMLImageElement
    expect(page.hasAttribute('width')).toBe(false)
    expect(page.getAttribute('src')).toBe(resolveAsset(startAssetId('aboutPage')))

    fireEvent.click(screen.getByRole('button', { name: '返回标题' }))
    // 点下去当场就从屏幕上消失了（原版 setButton 里那句 buttons.remove）。
    expect(screen.queryByRole('button', { name: '返回标题' })).toBeNull()
    tick(1)
    expect(about()?.dataset.width).toBe('900')
    tick(ABOUT_TICKS - 1)
    // 第 10 拍收到 0 px —— 元素**还在**，宽度为 0。原版这一拍画的也是那条
    // 宽度为 0 的 drawImage：折叠是在同一拍的**之后**发生的（见 panelState.ts
    // 的两段式一拍）。差这一拍在画面上完全看不出来。
    expect(about()?.dataset.width).toBe('0')
    tick(1)
    expect(about()).toBeNull()
    expect(screen.getByRole('button', { name: '开始新游戏' })).toBeInTheDocument()
  })

  it('卷轴那一层始终在画，展开前后换的是哪一段', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    const scroll = () => panel.querySelector('.start-scroll') as HTMLImageElement
    expect(scroll().dataset).toMatchObject({ sequence: 'scroll', frame: '0' })
    // 位置照抄原版 `new StartAnimation(10, "卷轴", this, -320, -100)`。
    expect([scroll().style.left, scroll().style.top]).toEqual(['-320px', '-100px'])
    fireEvent.click(screen.getByRole('button', { name: '关于我们' }))
    tick(5)
    expect(scroll().dataset).toMatchObject({ sequence: 'scroll', frame: '4' })
    tick(5)
    tick(1)
    expect(scroll().dataset).toMatchObject({ sequence: 'backScroll', frame: '0' })
  })
})
