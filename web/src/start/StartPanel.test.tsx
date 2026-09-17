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

  it('和弦中途在舞台外松开一个键：那一下松手也记坐标（RELEASED 照样派给 grab）', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    panel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 640 }) as DOMRect
    const back = panel.querySelector('.start-back') as HTMLElement
    const cursor = panel.querySelector('.start-cursor') as HTMLImageElement
    fireEvent.mouseDown(back, { clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.mouseDown(back, { clientX: 100, clientY: 100, button: 2, buttons: 3 })
    expect({ left: cursor.style.left, top: cursor.style.top }).toEqual({ left: '100px', top: '100px' })
    fireEvent.mouseUp(document.body, { clientX: 1100, clientY: 50, button: 2, buttons: 1 })
    expect({ left: cursor.style.left, top: cursor.style.top }).toEqual({ left: '1100px', top: '50px' })
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

  /**
   * xl-zs6：接着上面那条 xl-m9q 往下一步 —— **全松开那一下**，票面原本担心 web 少收了一下。
   * ⚠️ 那张票的关票理由把 JDK 那一半写反了（xl-bg3 逐行重读 `Container.java:4531` 发现）：`isMouseGrab`
   * 对 RELEASED 是把本键异或**回去**（`getModifiersEx()` 那时已经不含它了），读到的是「按下之前」的状态
   * —— JDK 自己的注释就叫 `wasAMouseButtonDownBeforeThisEvent`。所以最后一只键松开时它仍为**真**、
   * 目标**不**重设，不是「异或后为 0、为假、重设成落点」。结论没变（面板一下都不收），成因是第三条。
   * macOS 实测（openjdk 17，CGEvent 合成整段序列，
   * 「窗口外」是另一个 app 的空白窗口，三轮读数一致）：**左键那一下松手根本到不了 Java 窗口** ——
   * 左键按在别的窗口上，整段拖动与它的松手都归那个窗口；右键那两下**到得了**窗口，但停在 `main.GameLauncher`
   * 上、没被转派给 `start.StartPanel`（`isMouseGrab` 为真）。两条路各自的原因不同，结果一样：面板一下都不收。
   *
   * ⚠️ 下面左键那一下 `mouseUp` 在 web 侧照样发给面板（浏览器里舞台外仍在同一个页面内），所以这是比真机
   * **更严**的形状：连「事件真的来了」都不许把它当成一次松手。
   *
   * ⚠️ **换落点量过一支了（xl-g9w）**：把「窗口外」换成**同一个 app 的另一块窗口**（原版那个 JVM 自己
   * 多开的一块 `JFrame`，位置尺寸与驱动器那块一样），对**原版那块窗口**来说读数**逐字相同** —— 左键的
   * 按下 / 松手 / `DRAGGED` 照样一下都不到，右键那两下照样停在 `main.GameLauncher`。不同的只有那块
   * `JFrame` 自己收到了那几下。**桌面那一支仍没量过**（主屏被最大化窗口铺满时探针硬失败，要人先露出
   * 一块桌面）；原生全屏那一支**构造上量不了**（它在自己的 Space，原版窗口同时不在屏上）—— 这一句是推理。
   * 复跑：`tools/mouse-dispatch-probe.sh --where same-app-window`。
   */
  it('舞台外按着左键拖进来再按右键，全松开那两下面板都不收 —— 左键那一下原版根本收不到，右键那两下收到了也不转派（xl-zs6 实测）', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    panel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 640 }) as DOMRect
    const cursor = panel.querySelector('.start-cursor') as HTMLImageElement
    const about = screen.getByRole('button', { name: '关于我们' })
    fireEvent.mouseMove(panel, { clientX: 100, clientY: 100, buttons: 0 })
    // 舞台外按着左键拖进来，再在「转」上按右键（xl-m9q：这一下不收、不起 grab）。
    fireEvent.mouseMove(panel, { clientX: 200, clientY: 150, buttons: 1 })
    fireEvent.mouseDown(about, { button: 2, buttons: 3 })
    // 全松开：先松右键，再松左键，两下都落在离刚才远的地方 —— 收了的话自绘鼠标会跟过去。
    fireEvent.mouseUp(about, { button: 2, buttons: 1, clientX: 500, clientY: 300 })
    fireEvent.mouseUp(panel, { button: 0, buttons: 0, clientX: 700, clientY: 400 })
    tick(1)
    expect({ left: cursor.style.left, top: cursor.style.top }, '松手被收下了：自绘鼠标跟到了松手的落点').toEqual({
      left: '100px',
      top: '100px',
    })
    expect(screen.queryByTestId('start-about'), '按下 + 松手被当成一次点击送了进去').toBeNull()
    // 全松开之后头一下没按着键的移动照常记 —— 原版那时目标已经重设回面板（`mouseMoved`）。
    fireEvent.mouseMove(panel, { clientX: 320, clientY: 210, buttons: 0 })
    expect({ left: cursor.style.left, top: cursor.style.top }).toEqual({ left: '320px', top: '210px' })
  })
})

describe('开始界面：图片的原生拖放（xl-qzx）', () => {
  // 无头 Chrome 153（CDP 派输入）里量的（`scripts/measureStartInput.ts` 的 2c）：在背景图上按下拖一段，浏览器起了
  // `<img>` 的原生拖放 —— `dragstart` 之后是 `pointercancel`，mousemove 与 mouseup 一下都不再派，
  // 自绘光标冻在拖放起来那一刻，松手丢了。原版 Swing 没有拖放，`mouseDragged` 一路记坐标、
  // `mouseReleased` 照收。jsdom 不执行默认动作，拖放起不来，这里只能守「默认动作被取消了」这一层。
  it('面板上任何一处的 dragstart 都取消 —— 背景、云、按钮里的图', () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    for (const selector of ['.start-back', '.start-cloud', '.start-button-face', '.start-cursor']) {
      const img = panel.querySelector(selector) as HTMLElement
      expect(img, selector).not.toBeNull()
      // fireEvent 的返回值是「默认动作没被取消」。
      expect(fireEvent.dragStart(img), `${selector} 上的拖放没被取消`).toBe(false)
    }
  })
})

describe('开始界面：grab 期间在舞台外按下的第二个键（xl-bg3）', () => {
  /**
   * 面板上按下左键起 grab，拖到舞台外，再在那里按下第二个键。
   *
   * 票面（xl-40m 带出来的）照 JDK 17 `LightweightDispatcher` 推的是「原版派 `mousePressed`」：
   * `isMouseGrab` 对 MOUSE_PRESSED 异或掉本键之后左键还在 → 为真，`mouseEventTarget` 不重设、
   * 仍是面板，`retargetMouseEvent` 把按下派给 `StartPanel.mousePressed`。**那一半只有在事件先到得了
   * Java 窗口时才成立**，而票面自己标了「窗口外那一下操作系统送不送，平台相关，未验证」。
   *
   * macOS 实测（24.6.0 + openjdk 17，探针挂 `Toolkit.addAWTEventListener`，CGEvent 按 HID tap 合成
   * 整段序列，「窗口外」是另一个 app 的空白窗口，三轮读数逐字一致）：**那一下按下一次都不到 Java**
   * —— 它按在别的窗口上，归那个窗口。同一轮里的对照 F（拖回窗口内再按右键）读到
   * `PRESSED btn=3 mex=0x1400 src=start.StartPanel`，所以「零」不是探针瞎了。
   *
   * 于是票面推断不成立，而同一次操作里有一条**票面没提的**真差异：那只键的**松手**原版也一下都收不到
   * （D 组先松右、D2 组先松左，两种顺序下 `btn=3` 的 RELEASED 都没出现在 Java 侧），而 web 挂在 window
   * 上的 `mouseup` 不看是哪只键，照送一次 `release`。这个 describe 守的就是它。
   *
   * ⚠️ **换落点量过一支了（xl-g9w）**：把「窗口外」换成**同一个 app 的另一块窗口**（原版那个 JVM 自己
   * 多开的一块 `JFrame`，位置尺寸与驱动器那块一样），对**原版那块窗口**来说读数**逐字相同** —— 左键的
   * 按下 / 松手 / `DRAGGED` 照样一下都不到，右键那两下照样停在 `main.GameLauncher`。不同的只有那块
   * `JFrame` 自己收到了那几下。**桌面那一支仍没量过**（主屏被最大化窗口铺满时探针硬失败，要人先露出
   * 一块桌面）；原生全屏那一支**构造上量不了**（它在自己的 Space，原版窗口同时不在屏上）—— 这一句是推理。
   * 复跑：`tools/mouse-dispatch-probe.sh --where same-app-window`。
   *
   * 起 grab 那只键的松手不受影响：实测两种顺序下它都 `src=start.StartPanel`（`isMouseGrab` 把本键
   * 异或**回去**，读到的是「按下之前」的状态，所以最后一只键松开时它仍为真、目标不重设）。
   */
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  const setup = () => {
    render(<StartPanel onNewGame={() => {}} onLoad={() => {}} />)
    const panel = screen.getByTestId('start-panel')
    panel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 640 }) as DOMRect
    return {
      panel,
      back: panel.querySelector('.start-back') as HTMLElement,
      cursor: panel.querySelector('.start-cursor') as HTMLImageElement,
    }
  }
  const at = (cursor: HTMLImageElement) => ({ left: cursor.style.left, top: cursor.style.top })

  it('舞台外按下第二个键：按下与松手都不收，起 grab 那只键的松手照收（先松舞台外那只）', () => {
    const { back, cursor } = setup()
    fireEvent.mouseDown(back, { clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.mouseMove(document.body, { clientX: 1100, clientY: 700, buttons: 1 })
    expect(at(cursor), '拖出舞台照记坐标（xl-40m）').toEqual({ left: '1100px', top: '700px' })
    // 舞台外按下右键 —— 原版一下都收不到，自绘鼠标不该跟过去。
    // ⚠️ 这一条的期望值等于上一行的读数，**当前实现下没有任何删法能让它红**（window 上根本没挂
    // `mousedown`）。它守的是「别加」那个方向：照 `App.tsx` 的 `grabRelease` 在 window 上补一个捕获
    // 阶段的 `mousedown` 并记坐标（票面给的头一个候选），它当场红 —— 实跑过。
    fireEvent.mouseDown(document.body, { clientX: 1200, clientY: 800, button: 2, buttons: 3 })
    expect(at(cursor), '舞台外按下的第二个键被当成一次 mousePressed 收了').toEqual({
      left: '1100px',
      top: '700px',
    })
    // 松开它 —— 同样一下都收不到。
    fireEvent.mouseUp(document.body, { clientX: 1300, clientY: 900, button: 2, buttons: 1 })
    expect(at(cursor), '舞台外按下的那只键的松手被收了').toEqual({ left: '1100px', top: '700px' })
    // 再松起 grab 那只 —— 它照收（实测 `RELEASED btn=1 src=start.StartPanel`）。
    fireEvent.mouseUp(document.body, { clientX: 300, clientY: 500, button: 0, buttons: 0 })
    expect(at(cursor), '起 grab 那只键的松手没收').toEqual({ left: '300px', top: '500px' })
  })

  it('先松起 grab 那只键、再松舞台外那只：前者记坐标，后者不记（实测 D2 的顺序）', () => {
    const { back, cursor } = setup()
    fireEvent.mouseDown(back, { clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.mouseMove(document.body, { clientX: 1100, clientY: 700, buttons: 1 })
    fireEvent.mouseDown(document.body, { clientX: 1200, clientY: 800, button: 2, buttons: 3 })
    fireEvent.mouseUp(document.body, { clientX: 400, clientY: 250, button: 0, buttons: 2 })
    expect(at(cursor), '起 grab 那只键的松手没收').toEqual({ left: '400px', top: '250px' })
    fireEvent.mouseUp(document.body, { clientX: 900, clientY: 600, button: 2, buttons: 0 })
    expect(at(cursor), '舞台外按下的那只键的松手被收了').toEqual({ left: '400px', top: '250px' })
    // 全松开之后 grab 解除：舞台外按着键再动就不记了（`mouseDragged` 的目标不再是这块面板）。
    fireEvent.mouseMove(document.body, { clientX: 1100, clientY: 700, buttons: 1 })
    expect(at(cursor), 'grab 没解除').toEqual({ left: '400px', top: '250px' })
  })

  it('对照：第二个键按在面板上（只是松在舞台外），按下与松手都照收 —— 实测 F 组', () => {
    const { back, cursor } = setup()
    fireEvent.mouseDown(back, { clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.mouseMove(document.body, { clientX: 1100, clientY: 700, buttons: 1 })
    // 拖回面板上再按右键：实测 `PRESSED btn=3 mex=0x1400 src=start.StartPanel`，按下记坐标。
    fireEvent.mouseDown(back, { clientX: 500, clientY: 300, button: 2, buttons: 3 })
    expect(at(cursor), '面板上按下的第二个键没记坐标').toEqual({ left: '500px', top: '300px' })
    fireEvent.mouseUp(document.body, { clientX: 1300, clientY: 900, button: 2, buttons: 1 })
    expect(at(cursor), '面板上按下的那只键的松手没记坐标').toEqual({ left: '1300px', top: '900px' })
  })

  it('舞台外按下第二个键之后继续拖：照记坐标 —— 原版 DRAGGED 一路派给面板，不裁', () => {
    const { back, cursor } = setup()
    fireEvent.mouseDown(back, { clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.mouseMove(document.body, { clientX: 1100, clientY: 700, buttons: 1 })
    fireEvent.mouseDown(document.body, { clientX: 1200, clientY: 800, button: 2, buttons: 3 })
    // 实测 D / D2 段：按下第二个键前后，DRAGGED 一路 `src=start.StartPanel`，x 到 1254。
    fireEvent.mouseMove(document.body, { clientX: 1254, clientY: 303, buttons: 3 })
    expect(at(cursor), '第二个键按下之后拖动就不记了').toEqual({ left: '1254px', top: '303px' })
  })

  /**
   * 两条**补松手**通路（窗口外丢了 `mouseup`，回来头一下无键移动 / 新按下当场补上，xl-4zo）也要过这张
   * 位图：丢掉的那一下若是舞台外按下的键，原版压根没有它，补上就又造出一处残余差异。
   */
  it('丢在窗口外的那一下是舞台外按下的键：回来头一下移动只解除 grab，不补松手', () => {
    const { back, cursor } = setup()
    const newGame = screen.getByRole('button', { name: '开始新游戏' })
    const face = () => (newGame.querySelector('.start-button-face') as HTMLImageElement).src
    // 面板上按左键起 grab，拖到舞台外按右键，再松左键 —— 左键是收下过的，这一下照送。位图到此清空，
    // 而 grab 还挂着（右键还按着）。
    fireEvent.mouseDown(back, { clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.mouseMove(document.body, { clientX: 1100, clientY: 700, buttons: 1 })
    fireEvent.mouseDown(document.body, { clientX: 1200, clientY: 800, button: 2, buttons: 3 })
    fireEvent.mouseUp(document.body, { clientX: 1150, clientY: 720, button: 0, buttons: 2 })
    // 拿键盘焦点把「起」点亮 —— 一次松手会按落点重设每一颗的悬停（`releaseStartButton` 里那句
    // `hover[active] = active === key`），落在空处就是全灭。动作之前先确认它此刻真是亮的。
    fireEvent.focus(newGame)
    expect(face(), '「起」没被点亮，下面那条就按构造成立了').toContain(resolveAsset(startAssetId('newGameHover')))
    // 右键的松手丢在窗口外了（注释里「窗口外松手按可能不派写」那条自设模型）。回来头一下没按着键的
    // 移动：位图已经空了，只解除 grab，不补松手 —— 原版这一下压根没有。补了的话「起」当场灭掉。
    fireEvent.mouseMove(document.body, { clientX: 400, clientY: 250, buttons: 0 })
    expect(at(cursor), '补松手那一路连坐标都没记').toEqual({ left: '400px', top: '250px' })
    expect(face(), '位图空着还补了一次松手：「起」被那一下按落点灭掉了').toContain(
      resolveAsset(startAssetId('newGameHover')),
    )
  })

  it('丢在窗口外的那一下是舞台外按下的键：回来头一下**按下**也只解除 grab，不补松手', () => {
    const { back } = setup()
    const about = () => screen.queryByTestId('start-about')
    // 在「关于」上按下（`clicked.about` 留着真），拖到舞台外按右键，再松左键 —— 左键收下过，这一下
    // 照送：`setButton()` 把 `aboutTimer` 起到 ABOUT_TICKS。位图到此清空，而 grab 还挂着。
    fireEvent.mouseDown(screen.getByRole('button', { name: '关于我们' }), { clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.mouseMove(document.body, { clientX: 1100, clientY: 700, buttons: 1 })
    fireEvent.mouseDown(document.body, { clientX: 1200, clientY: 800, button: 2, buttons: 3 })
    fireEvent.mouseUp(document.body, { clientX: 1150, clientY: 720, button: 0, buttons: 2 })
    tick(4)
    const width = () => Number(about()?.dataset.width ?? -1)
    const before = width()
    expect(before, '「关于」还没揭开，下面那条就没有分辨力了').toBeGreaterThan(0)
    // 右键的松手丢在窗口外了。回来没动就又按下（`onMouseDown` 那条补松手的通路）：位图已经空了，
    // 只解除 grab、不补 —— 补了的话 `setButton()` 又读一次仍然为真的 `clicked.about`，把 `aboutTimer`
    // **从头起**，揭开的那一列当场退回去。
    fireEvent.mouseDown(back, { clientX: 300, clientY: 300, button: 0, buttons: 1 })
    tick(1)
    expect(width(), '位图空着还补了一次松手：表被重起，揭开的那一列退回去了').toBeGreaterThan(before)
  })

  it('grab 解除时位图清空：上一轮没收到松手的键，不该让下一轮的同一只键蒙混过关', () => {
    const { back, cursor } = setup()
    // 第一轮：左键在面板上按下（收下了），松手丢在窗口外，回来头一下移动补掉 —— 这一路会 end()。
    fireEvent.mouseDown(back, { clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.mouseMove(document.body, { clientX: 200, clientY: 150, buttons: 0 })
    // 第二轮：右键在面板上起 grab，左键这次按在舞台外 —— 它的松手不该被送。
    fireEvent.mouseDown(back, { clientX: 300, clientY: 300, button: 2, buttons: 2 })
    fireEvent.mouseDown(document.body, { clientX: 1100, clientY: 700, button: 0, buttons: 3 })
    fireEvent.mouseUp(document.body, { clientX: 900, clientY: 600, button: 0, buttons: 2 })
    expect(at(cursor), '上一轮的陈旧位让舞台外那只键的松手被收了').toEqual({ left: '300px', top: '300px' })
  })
})
