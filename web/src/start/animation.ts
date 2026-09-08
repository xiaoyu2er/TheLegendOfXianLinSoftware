/**
 * `start.StartAnimation` / `start.CloudAnimation` / `start.StartTimer` 三个类的
 * 纯函数移植（xl-4si）。
 *
 * 三个都只有几个字段和一个 `update`，但**每一个都带着一处会咬人的怪癖**，
 * 而怪癖正是"复刻完了"与"看起来一样"的分界。三处都在下面各自的头注里，
 * 并且都由 `animation.test.ts` 里一条**跑出来数**的用例钉着 —— 不是抄一个
 * 期望值，是把原版那几行的语义跑一遍。
 *
 * 全部写成"入参不改、返回新值"，与 `state/step.ts` 那条线同一个路子：
 * 状态推进是纯的，谁在驱动、驱动得快不快，跟它怎么演化无关。
 */

/**
 * 一段逐帧动画的状态。对应 `StartAnimation` 的 `i` / `currentImage` /
 * `isStop` / `isLoop` 四个字段。
 *
 * ## 为什么 `frame` 和 `next` 是两个字段
 *
 * 原版是 `currentImage`（正在画的那张）与 `i`（下一张的下标）两个独立的东西，
 * 而且**两者会分家**：`stopButtonAnimation()` 把 `currentImage` 拨回第 0 张
 * 却**不动** `i`，于是下次 `startAnimation()` 是从上次停的地方接着播的，
 * 画面上却先闪一下第 0 帧。压成一个字段就抹掉了这件事。
 */
export interface FrameAnimation {
  /** 共几帧。`START_SEQUENCES` 里那个 `count`。 */
  readonly length: number
  /** 正在画的那一帧的下标 —— 原版的 `currentImage`。 */
  readonly frame: number
  /** 下一次 `updateImage` 要画哪一帧 —— 原版的 `i`。 */
  readonly next: number
  /** `true` = 停着（原版的 `isStop`，构造完就是 `true`）。 */
  readonly isStop: boolean
  /** 播到最后一帧了 —— 原版的 `isLoop`，卷轴过场就是靠它收尾的。 */
  readonly isLoop: boolean
}

export function createFrameAnimation(length: number): FrameAnimation {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`帧数必须是正整数，收到 ${length}`)
  }
  return { length, frame: 0, next: 0, isStop: true, isLoop: false }
}

/**
 * 一拍。原版：
 *
 *     if (i == array.length - 1) isLoop = true;
 *     if (!isStop) { currentImage = array[i]; if (i < array.length-1) i++; else i = 0; }
 *
 * ## ⚠️ 怪癖一：`isLoop` 是在 `isStop` **外面**判的
 *
 * 也就是说**停着的动画照样会把 `isLoop` 置真**，只要它的 `i` 恰好停在最后
 * 一帧上。开始界面里这件事没有后果（卷轴每次收尾都顺手把 `i` 归了 0），
 * 但把这一行挪进 `if (!isStop)` 里就不是复刻了。
 *
 * ## ⚠️ 怪癖二：`isLoop` 置真的那一拍**就是**最后一帧被画出来的那一拍
 *
 * 判定在自增之前，所以 `i === length-1` 这一拍先置 `isLoop`，再把最后一帧
 * 画出来、把 `i` 绕回 0。于是"播完一循环"与"最后一帧正在屏幕上"是同一拍 ——
 * 卷轴展开的那一帧和面板切过去的那一拍因此重合。
 */
export function updateImage(a: FrameAnimation): FrameAnimation {
  const isLoop = a.next === a.length - 1 ? true : a.isLoop
  if (a.isStop) return isLoop === a.isLoop ? a : { ...a, isLoop }
  return {
    ...a,
    isLoop,
    frame: a.next,
    next: a.next < a.length - 1 ? a.next + 1 : 0,
  }
}

/** 原版 `startAnimation()`：只放开闸门，`i` 与 `currentImage` 都不动。 */
export function startAnimation(a: FrameAnimation): FrameAnimation {
  return a.isStop ? { ...a, isStop: false } : a
}

/**
 * 原版 `stopButtonAnimation()`：停下，并把**正在画的那张**拨回第 0 帧 ——
 * 但 `next` 不动（怪癖，见 `FrameAnimation` 的头注）。
 */
export function stopButtonAnimation(a: FrameAnimation): FrameAnimation {
  return { ...a, isStop: true, frame: 0 }
}

/**
 * 原版 `stopScorllAnimation()`（原版就是这么拼的）：停下并清掉 `isLoop`，
 * 但**不动** `frame`。卷轴收尾时两个 stop 是连着调的，所以净效果是
 * 「停下 + 回第 0 帧 + 清 isLoop」。
 */
export function stopScrollAnimation(a: FrameAnimation): FrameAnimation {
  return { ...a, isStop: true, isLoop: false }
}

/** 云的位置与方向。对应 `CloudAnimation` 的 `y` / `isChange`（`direction` 恒为 0）。 */
export interface CloudDrift {
  readonly y: number
  /** `true` = 正在往下飘（原版的 `isChange`，构造完是 `false` = 往上）。 */
  readonly isChange: boolean
}

/**
 * 一拍。原版 `updateCoordinate()` 的 `case 0`：
 *
 *     if (!isChange) { y -= move; if (y + 1024 < 640) isChange = true; }
 *     else           { y += move; if (y > 360)        isChange = false; }
 *
 * ## ⚠️ 怪癖三：掉头是**过了头才掉**，所以上下端点不对称
 *
 * 两个判定都在移动**之后**，而且都是严格不等号，于是真正踩到的端点是
 * −390 与 370，不是 −384 与 360（见 `layout.ts` 的 `CLOUD_LOW_Y` /
 * `CLOUD_HIGH_Y`）。第一程比此后每一程短一拍，因为它是从 360 起步而不是 370。
 */
export function updateCloud(
  cloud: CloudDrift,
  options: {
    readonly move: number
    readonly imageHeight: number
    readonly floor: number
    readonly startY: number
  },
): CloudDrift {
  if (!cloud.isChange) {
    const y = cloud.y - options.move
    return { y, isChange: y + options.imageHeight < options.floor }
  }
  const y = cloud.y + options.move
  return { y, isChange: !(y > options.startY) }
}

/** 对应 `StartTimer` 的三个字段。 */
export interface CountdownTimer {
  readonly timeLeft: number
  readonly isCompleted: boolean
  readonly isStarted: boolean
}

export function createCountdown(): CountdownTimer {
  return { timeLeft: 0, isCompleted: false, isStarted: false }
}

/** 原版 `initial()` —— 与刚构造出来完全一样。 */
export const resetCountdown = createCountdown

/** 原版 `start(interval)`：**不**清 `isCompleted`。 */
export function startCountdown(t: CountdownTimer, interval: number): CountdownTimer {
  return { ...t, isStarted: true, timeLeft: interval }
}

/**
 * 一拍。原版：
 *
 *     if (isStarted) timeLeft--;
 *     if (timeLeft == 0 && isStarted) isCompleted = true;
 *
 * ## ⚠️ 怪癖四：数到 0 之后它**接着往下数**
 *
 * `isStarted` 一直是真，所以 `timeLeft` 会变成 −1、−2……而 `isCompleted`
 * 一旦置真就再也不会被这里清掉（只有 `initial()` 清）。这不是无关紧要的：
 * 「关于我们」那条揭开的式子 `100 * (9 - timeLeft)` 直接读 `timeLeft`，
 * 要是让它停在 0，展开就会卡在 900 px 上。
 */
export function updateCountdown(t: CountdownTimer): CountdownTimer {
  if (!t.isStarted) return t
  const timeLeft = t.timeLeft - 1
  return { ...t, timeLeft, isCompleted: timeLeft === 0 ? true : t.isCompleted }
}
