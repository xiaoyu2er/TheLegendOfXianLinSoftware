import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { startAssetId } from '../assets/ids'
import { resolveAsset } from '../assets/resolve'
import { StartPanel } from './StartPanel'
import { HIT_OFFSET_X, HIT_OFFSET_Y, START_BUTTONS, startButtonHitBox } from './buttons'

/**
 * 开始界面这一屏（xl-kaa）。摆位的数字对不对由 `buttons.test.ts` 对着 GBK
 * 源码守着，这里守的是**组件有没有用那些数字** —— 两件事，中间那一步没人验
 * 就等于没验（跟烘焙器那条「源文件在 ≠ 产物在」是同一个道理）。
 */
afterEach(cleanup)

describe('开始界面', () => {
  it('背景图按原始尺寸画在 (0,0)，不缩', () => {
    render(<StartPanel onNewGame={() => {}} />)
    const back = screen.getByTestId('start-panel').querySelector('.start-back') as HTMLImageElement
    expect(back).not.toBeNull()
    expect(back.getAttribute('src')).toBe(resolveAsset(startAssetId('back')))
    // 不带 width/height：带了就是缩放，而 back.png 是 1024×641，缩一下整张图
    // 纵向差半个像素，画面上看起来完全正常。多出来那一行由 overflow 裁掉。
    expect(back.hasAttribute('width')).toBe(false)
    expect(back.hasAttribute('height')).toBe(false)
  })

  it('两颗按钮，读屏读得到名字；读档那颗禁用（存档归 M6 / xl-i06.1）', () => {
    render(<StartPanel onNewGame={() => {}} />)
    const buttons = screen.getAllByRole('button')
    // 分母是 `START_BUTTONS`，不是手写的 2 —— 那份名单本身由 buttons.test.ts
    // 对着源码守着。
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(
      START_BUTTONS.map((b) => b.label),
    )
    expect(screen.getByRole('button', { name: '开始新游戏' })).not.toBeDisabled()
    // **禁用而不是不画**：不画的话「这一版还没做」与「原版就只有一颗按钮」
    // 分不开，而后者是错的。
    expect(screen.getByRole('button', { name: '读取存档' })).toBeDisabled()
  })

  it('按钮元素占的是命中框，不是画出来那个矩形', () => {
    render(<StartPanel onNewGame={() => {}} />)
    const actual = START_BUTTONS.map((spec) => {
      const el = screen.getByRole('button', { name: spec.label })
      return { key: spec.key, left: el.style.left, top: el.style.top }
    })
    const expected = START_BUTTONS.map((spec) => {
      const box = startButtonHitBox(spec)
      return { key: spec.key, left: `${box.x}px`, top: `${box.y}px` }
    })
    // 拿绘制坐标当元素位置（`left: 200px`）会红：命中框是 185 / 144。
    expect(actual).toEqual(expected)
    expect(expected[0]).toEqual({ key: 'newGame', left: '185px', top: '144px' })
  })

  it('两张图叠在同一个左上角，并从命中框推回原版的绘制位置', () => {
    render(<StartPanel onNewGame={() => {}} />)
    const el = screen.getByRole('button', { name: '开始新游戏' })
    const faces = [...el.querySelectorAll('img')] as HTMLImageElement[]
    expect(faces).toHaveLength(2)
    expect(faces.map((f) => f.getAttribute('src'))).toEqual([
      resolveAsset(startAssetId('newGame')),
      resolveAsset(startAssetId('newGameHover')),
    ])
    // 命中框往左上挪了 (15,6)，这里推回去，于是图仍然画在原版的 (200,150)。
    for (const face of faces) {
      expect({ left: face.style.left, top: face.style.top }).toEqual({
        left: `${-HIT_OFFSET_X}px`,
        top: `${-HIT_OFFSET_Y}px`,
      })
    }
    const spec = START_BUTTONS[0]!
    const box = startButtonHitBox(spec)
    expect([box.x - HIT_OFFSET_X, box.y - HIT_OFFSET_Y]).toEqual([spec.x, spec.y])
  })

  it('点「起」调 onNewGame；点禁用的「承」什么都不发生', () => {
    const onNewGame = vi.fn()
    render(<StartPanel onNewGame={onNewGame} />)
    fireEvent.click(screen.getByRole('button', { name: '开始新游戏' }))
    expect(onNewGame).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '读取存档' }))
    expect(onNewGame).toHaveBeenCalledTimes(1)
  })
})
