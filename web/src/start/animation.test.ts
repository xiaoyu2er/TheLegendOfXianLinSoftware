import { describe, expect, it } from 'vitest'
import {
  createCountdown,
  createFrameAnimation,
  startAnimation,
  startCountdown,
  stopButtonAnimation,
  stopScrollAnimation,
  updateCloud,
  updateCountdown,
  updateImage,
} from './animation'
import type { CloudDrift } from './animation'
import {
  CLOUD_FLOOR,
  CLOUD_HIGH_Y,
  CLOUD_IMAGE_HEIGHT,
  CLOUD_LOW_Y,
  CLOUD_MOVE,
  CLOUD_START_Y,
} from './layout'

/**
 * `StartAnimation` / `CloudAnimation` / `StartTimer` 三个类的移植。
 *
 * 每一条都**把它跑出来数**，不抄期望值：这三个类各带一处怪癖（见
 * `animation.ts` 的头注），而怪癖抄错了的表现全都是"动画差一拍" ——
 * 在截图上、在 `--check` 的可复现性上，都跟对的一模一样。
 */

/** 把一段动画跑 `ticks` 拍，把每一拍**画出来的帧**记下来。 */
function play(length: number, ticks: number, start = true): number[] {
  let a = createFrameAnimation(length)
  if (start) a = startAnimation(a)
  const frames: number[] = []
  for (let i = 0; i < ticks; i++) {
    a = updateImage(a)
    frames.push(a.frame)
  }
  return frames
}

describe('StartAnimation', () => {
  it('构造完是停着的、停在第 0 帧、还没播完一循环', () => {
    expect(createFrameAnimation(4)).toEqual({
      length: 4,
      frame: 0,
      next: 0,
      isStop: true,
      isLoop: false,
    })
  })

  it('停着的时候一拍也不走 —— 原版 updateImage 的 if (!isStop)', () => {
    // 分母：真的跑了 20 拍，而不是循环体一次都没进。
    const frames = play(4, 20, false)
    expect(frames).toHaveLength(20)
    expect(new Set(frames)).toEqual(new Set([0]))
  })

  it('播起来就 0,1,2,3,0,1,… 循环', () => {
    expect(play(4, 9)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0])
  })

  it('isLoop 在**画出最后一帧的那一拍**置真，不是下一拍', () => {
    let a = startAnimation(createFrameAnimation(10))
    const loopAt: number[] = []
    for (let tick = 1; tick <= 10; tick++) {
      a = updateImage(a)
      if (a.isLoop) loopAt.push(tick)
    }
    // 十帧的卷轴：第 10 拍才播完一循环，而那一拍画的正是第 9 帧（最后一帧）。
    expect(loopAt).toEqual([10])
    expect(a.frame).toBe(9)
    // 而且 next 已经绕回 0 —— 卷轴收尾时不必再复位它。
    expect(a.next).toBe(0)
  })

  it('⚠️ 停着的动画照样会把 isLoop 置真（原版那一行在 if (!isStop) 外面）', () => {
    // 让它停在最后一帧的下标上：播 9 拍 next 到 9，再停。
    let a = startAnimation(createFrameAnimation(10))
    for (let i = 0; i < 9; i++) a = updateImage(a)
    expect(a.next).toBe(9)
    expect(a.isLoop).toBe(false)
    a = stopButtonAnimation(a)
    expect(a.isStop).toBe(true)
    // 停着，可是这一拍照样置真。把那一行挪进 if 里，这条就红。
    expect(updateImage(a).isLoop).toBe(true)
  })

  it('⚠️ stopButtonAnimation 把画面拨回第 0 帧，却**不动** next', () => {
    let a = startAnimation(createFrameAnimation(4))
    a = updateImage(a)
    a = updateImage(a)
    expect({ frame: a.frame, next: a.next }).toEqual({ frame: 1, next: 2 })
    a = stopButtonAnimation(a)
    expect({ frame: a.frame, next: a.next }).toEqual({ frame: 0, next: 2 })
    // 再播起来是从 2 接着走的 —— 不是从 0 重来。高亮动画因此"接着转"。
    expect(updateImage(startAnimation(a)).frame).toBe(2)
  })

  it('stopScrollAnimation 清 isLoop 但不动 frame；两个 stop 连起来才是卷轴的收尾', () => {
    let a = startAnimation(createFrameAnimation(10))
    for (let i = 0; i < 10; i++) a = updateImage(a)
    expect({ frame: a.frame, isLoop: a.isLoop }).toEqual({ frame: 9, isLoop: true })
    const onlyScroll = stopScrollAnimation(a)
    expect({ frame: onlyScroll.frame, isLoop: onlyScroll.isLoop }).toEqual({
      frame: 9,
      isLoop: false,
    })
    const both = stopButtonAnimation(onlyScroll)
    expect({ frame: both.frame, isLoop: both.isLoop, isStop: both.isStop }).toEqual({
      frame: 0,
      isLoop: false,
      isStop: true,
    })
  })

  it('帧数不合法当场抛 —— 0 帧的动画会让 length-1 变成 −1，然后永远播不完', () => {
    expect(() => createFrameAnimation(0)).toThrow()
    expect(() => createFrameAnimation(2.5)).toThrow()
  })
})

const CLOUD_OPTIONS = {
  move: CLOUD_MOVE,
  imageHeight: CLOUD_IMAGE_HEIGHT,
  floor: CLOUD_FLOOR,
  startY: CLOUD_START_Y,
}

function drift(ticks: number): CloudDrift[] {
  let cloud: CloudDrift = { y: CLOUD_START_Y, isChange: false }
  const path: CloudDrift[] = []
  for (let i = 0; i < ticks; i++) {
    cloud = updateCloud(cloud, CLOUD_OPTIONS)
    path.push(cloud)
  }
  return path
}

describe('CloudAnimation', () => {
  it('每拍 ±10，方向由 isChange 决定', () => {
    const path = drift(3)
    expect(path.map((c) => c.y)).toEqual([350, 340, 330])
  })

  it('⚠️ 真正的端点是 −390 与 370，不是票面上写的 −384 与 360', () => {
    // 跑到底数出来，不抄。两个判定都在移动**之后**，所以都会过头一步。
    const path = drift(400)
    const ys = path.map((c) => c.y)
    expect(Math.min(...ys)).toBe(CLOUD_LOW_Y)
    expect(Math.max(...ys)).toBe(CLOUD_HIGH_Y)
    // 票面推出来的那两个数**踩不到**：−384 不是 10 的倍数偏移，360 只在起点
    // 出现过一次（起点不在 path 里）。这一条就是"别人的数字要自己再量"的实例。
    expect(ys).not.toContain(-384)
    expect(ys).not.toContain(360)
  })

  it('第一程 75 拍，此后每一轮 152 拍 —— 因为起点 360 比此后的上端点 370 低一格', () => {
    const path = drift(500)
    // 掉头的那几拍：isChange 变了值的下标。
    const turns: number[] = []
    let previous = false
    path.forEach((c, i) => {
      if (c.isChange !== previous) turns.push(i + 1)
      previous = c.isChange
    })
    // 分母：真的掉过几次头。一次都没掉的话下面那两条差值是空的。
    expect(turns.length).toBeGreaterThan(3)
    expect(turns[0]).toBe(75)
    const gaps = turns.slice(1).map((t, i) => t - turns[i]!)
    expect(new Set(gaps)).toEqual(new Set([76]))
    // 一整轮（下去再上来）因此是 152 拍。
    expect(gaps[0]! + gaps[1]!).toBe(152)
  })
})

describe('StartTimer', () => {
  it('没 start 过就一拍也不走', () => {
    let t = createCountdown()
    for (let i = 0; i < 5; i++) t = updateCountdown(t)
    expect(t).toEqual({ timeLeft: 0, isCompleted: false, isStarted: false })
  })

  it('start(10) 之后第 10 拍到点', () => {
    let t = startCountdown(createCountdown(), 10)
    const completedAt: number[] = []
    for (let tick = 1; tick <= 12; tick++) {
      t = updateCountdown(t)
      if (t.isCompleted) completedAt.push(tick)
    }
    expect(completedAt).toEqual([10, 11, 12])
  })

  it('⚠️ 到点之后 timeLeft 接着往负数走 —— 「关于我们」那条式子靠的就是它', () => {
    let t = startCountdown(createCountdown(), 10)
    const left: number[] = []
    for (let tick = 1; tick <= 13; tick++) {
      t = updateCountdown(t)
      left.push(t.timeLeft)
    }
    expect(left).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, -1, -2, -3])
  })
})
