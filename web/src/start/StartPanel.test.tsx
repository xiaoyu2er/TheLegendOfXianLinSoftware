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
    fireEvent.mouseDown(el)
    fireEvent.click(el)
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

    // 移出**不看键**（与原版不逐拍相同，欠账 xl-4zo）：按下 / 松手在这里合成一次 `click`，
    // 移出也看键的话，拖出框松手之后悬停会卡住。这一段守的是「别把移出改成看键」。
    fireEvent.mouseLeave(el, { buttons: 1 })
    expect(face()).toContain(resolveAsset(startAssetId('newGame')))
    expect(glow()).toContain(resolveAsset(startFrameAssetId('buttonGlow', 0)))
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
