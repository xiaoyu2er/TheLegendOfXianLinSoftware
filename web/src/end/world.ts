/**
 * 结局面板的状态层（xl-czb.6）—— `start.EndPanel` 里**改状态的那一半**。画的那一半在
 * `render/drawList.ts`。
 *
 * 原版这个面板**没有任何键鼠监听**，唯一的时间驱动是 `start()` 起的那条线程：
 *
 *     while (true) { Clock.sleep(100); update(); }
 *
 * 所以这一层只有三件事：构造（{@link createEndWorld}）、`start()`（{@link startEnd}）、
 * `update()`（{@link updateEnd}）。那条线程怎么被时间推着走在 {@link EndLoop}。
 *
 * ## 「有进无出」三样，这一层管其中两样
 *
 * - **线程永不退出**：`run()` 是 `while(true)`，循环体里没有 break / return，`isStop`
 *   只挡住 `update()` 的**内容**。这里对应的是 {@link advanceEnd} 在 `isStop` 之后照样
 *   一圈圈走（`iterations` 照涨），会话也从不把这条循环摘掉；
 * - **画面冻在最后一帧**：`isStop` 之后 `update()` 一个字段都不改、不再 `repaint()`，
 *   而 `isDraw` 没有人复位 —— 任何一次重绘都画出同一张。
 *
 * 第三样（按键）不在这个面板里：`switchTo("end")` 不更新 `currentPanel`，按键照旧交给
 * 场景面板。那一半在 `game/session.ts` 的 `keyReceiver`。
 *
 * 判据都在 `endTrace.test.ts`（逐拍对真值、三样各一条会红的）。
 */
export interface EndWorld {
  /** 字幕 `结束字幕.png` 的纵坐标。构造 640，每拍 −5，到 −1280 为止。 */
  wordY: number
  /** 侧栏 `结束侧栏.png` 的纵坐标。构造 −1920，与字幕同一拍 +5。 */
  blankY: number
  /** 下一拍要读第几张过场画（`sources/End/<code>.jpg`）。 */
  code: number
  /**
   * `currentImage` 是第几张过场画；还没读过是 `null`（`drawImage(null, …)` 什么都不画）。
   * 真值 `picture` 那一列按缓存对象的引用认出来的就是这个数。
   */
  picture: number | null
  isDraw: boolean
  isStop: boolean
}

/**
 * `EndPanel` 构造函数里摆的那几个数，与 `update()` 里的步长、上界、过场画张数。
 * 与 GBK 源码的对撞见 `world.test.ts`。两条横坐标（`wordX = 0` / `blankX = 700`）构造
 * 之后没人写，归绘制层（`render/drawList.ts`）。
 */
export const END_INITIAL = { wordY: 640, blankY: -1920, code: 1 } as const
/** `wordY -= 5; blankY += 5`。 */
export const END_STEP = 5
/** `if (wordY > -1280) …; if (wordY == -1280) isStop = true`。 */
export const END_WORD_STOP = -1280
/** `if (code < 25) …; if (code == 25) …` —— 过场画一共 25 张。 */
export const END_PICTURE_COUNT = 25
/** `Clock.sleep(100)`：那条线程一圈的虚拟毫秒数。 */
export const END_TICK_MS = 100

/** 构造函数：`isDraw = false`、`isStop = true`，一张过场画都还没读。 */
export function createEndWorld(): EndWorld {
  return {
    wordY: END_INITIAL.wordY,
    blankY: END_INITIAL.blankY,
    code: END_INITIAL.code,
    picture: null,
    isDraw: false,
    isStop: true,
  }
}

/**
 * `start()`：起线程（归 {@link EndLoop}）、`isDraw = true`、`isStop = false`。
 * **不复位任何位置**：第二次进来接着上一次停下的地方。
 */
export function startEnd(w: EndWorld): void {
  w.isDraw = true
  w.isStop = false
}

/**
 * `update()` 逐句照抄。返回这一拍有没有调 `repaint()`（真值 `repainted` 那一列）。
 *
 * ⚠️ 两个 `if` 是**并列**的：`code == 24` 那一拍第一个读 24.jpg、把 code 推成 25，
 * 第二个当场成立、读 25.jpg、拨回 1 —— **24.jpg 从来没被画出来过**，一轮 24 拍
 * （xl-czb.5 在真值里量到的）。写成 `else if` 就会把 25.jpg 挪到下一拍。
 */
export function updateEnd(w: EndWorld): boolean {
  if (w.isStop) return false
  if (w.code < END_PICTURE_COUNT) {
    w.picture = w.code
    w.code++
  }
  if (w.code === END_PICTURE_COUNT) {
    w.picture = w.code
    w.code = 1
  }
  if (w.wordY > END_WORD_STOP) {
    w.wordY -= END_STEP
    w.blankY += END_STEP
  }
  if (w.wordY === END_WORD_STOP) w.isStop = true
  return true
}

/**
 * 那条 `while(true){ sleep(100); update(); }` 线程。**只有一条、永不退出**：会话把它
 * 建出来之后再也不摘（`game/session.ts`），`isStop` 之后它照样每 100 ms 走一圈，只是
 * `update()` 什么都不做。
 */
export interface EndLoop {
  readonly world: EndWorld
  /** 上次没凑够一圈的余量。 */
  carryMs: number
  /** 这条线程走过几圈循环体（sleep 醒来 + 一次 `update()`）。 */
  iterations: number
  /** 其中调过几次 `repaint()`。 */
  repaints: number
}

/** `start()` 那一句 `new Thread(this).start()`：线程从一次 sleep 开始。 */
export function createEndLoop(world: EndWorld): EndLoop {
  return { world, carryMs: 0, iterations: 0, repaints: 0 }
}

/** 一圈循环体：`update()`。叫醒（真值的 `wake`）与睡满 100 ms 走的都是这一圈。 */
export function loopOnce(loop: EndLoop): void {
  loop.iterations++
  if (updateEnd(loop.world)) loop.repaints++
}

/** 推 `elapsedMs` 虚拟毫秒：凑够几个 100 ms 就走几圈。 */
export function advanceEnd(loop: EndLoop, elapsedMs: number): void {
  let budget = loop.carryMs + Math.max(0, elapsedMs)
  while (budget >= END_TICK_MS) {
    budget -= END_TICK_MS
    loopOnce(loop)
  }
  loop.carryMs = budget
}
