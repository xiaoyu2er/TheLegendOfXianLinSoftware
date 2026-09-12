import { bgmAssetId } from '../assets/ids'
import { resolveBgmOrNull } from '../assets/resolve'

/**
 * 背景音乐播放器：**把世界声明的那个值同步到实际输出的订阅者**。
 *
 * 这一票的规格写得很明白：`world.audio.bgm` 是一个可断言的字符串，不是一次
 * 副作用。所以"该放哪首"归状态层（它逐 tick 对齐真值，见
 * `state/traceReplay.test.ts`），这里只负责"让实际输出等于它"，除此之外
 * 一个决定都不做。
 *
 * 不重叠是**结构性**的，不是靠时序保证的：整个播放器只有一个 `Sound`，
 * 换曲子是给同一个对象换 `src`。两个对象加上"记得停掉上一个"的写法，
 * 漏一次就是两首一起响，而那要靠耳朵才发现。
 */

/** 播放器要用到的那点 `HTMLAudioElement`。测试拿一个假的进来。 */
export interface Sound {
  src: string
  loop: boolean
  play(): Promise<void> | void
  pause(): void
}

export interface BgmPlayer {
  /**
   * 把播放同步到世界声明的这个值（`world.audio.bgm`，如 `舒缓.mp3`）。
   * **同一个值反复调是空操作**——它每 tick 都会被调一次。
   *
   * `fromStart` = 就算是同一首也从头放（xl-6zf）：原版 `MusicPlayer.play(name)`
   * 不看同名，停掉播放线程、把文件从头打开。回标题那一句 `readBGM("主题曲.mp3")`
   * 在标题 → 存读档 → 标题这条路上换的就是同一首。它只管「同一首」那一种情况：
   * 换了曲子本来就从头放，声明值是 `null` 本来就只停。
   */
  sync(bgm: string | null, fromStart?: boolean): void
  /** 此刻实际在放的那个声明值。`null` = 什么都没放。 */
  playing(): string | null
  /** 浏览器把自动播放挡下来了、正等一次用户手势。诊断用。 */
  blocked(): boolean
  destroy(): void
}

export interface BgmPlayerOptions {
  /** 建那唯一一个播放对象。默认是 `new Audio()`。 */
  create?: () => Sound
  /**
   * 声明值 → 可以喂给播放器的 URL。`null` = 这首**故意还没转码**
   * （见 `assets/resolve.ts` 的 `resolveBgmOrNull`），静音。
   */
  resolve?: (bgm: string) => string | null
  /**
   * 自动播放被挡下来时，等哪个事件源上的一次用户手势。默认是 `window`。
   * `null` = 不等（测试与非浏览器环境）。
   */
  gestures?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null
}

/** 浏览器拦下自动播放之后，这几个事件里的任意一个都算"用户来过了"。 */
const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const

export function createBgmPlayer(options: BgmPlayerOptions = {}): BgmPlayer {
  const create = options.create ?? (() => new Audio() as Sound)
  const resolve = options.resolve ?? ((bgm: string) => resolveBgmOrNull(bgmAssetId(bgm)))
  const gestures =
    options.gestures === undefined
      ? typeof window === 'undefined'
        ? null
        : window
      : options.gestures

  let sound: Sound | null = null
  let current: string | null = null
  let blocked = false
  let armed = false

  function disarm(): void {
    if (!armed || !gestures) return
    armed = false
    for (const type of GESTURES) gestures.removeEventListener(type, onGesture)
  }

  function onGesture(): void {
    disarm()
    if (current !== null) start(current)
  }

  /**
   * 自动播放被挡下来了。浏览器在用户跟页面交互之前不让出声，`play()` 返回的
   * Promise 会 reject —— 这不是错误，是策略。等一次手势再试一次。
   *
   * **不静默吞掉**：`blocked()` 是读得到的。
   */
  function arm(): void {
    blocked = true
    if (!gestures || armed) return
    armed = true
    for (const type of GESTURES) gestures.addEventListener(type, onGesture, { once: true })
  }

  function start(bgm: string): void {
    const url = resolve(bgm)
    if (url === null) {
      // 这首故意还没转码。停掉上一首：原版换场景就是换曲子，留着上一个场景的
      // 音乐继续放，比静音更不像原版。
      sound?.pause()
      return
    }
    if (!sound) sound = create()
    sound.loop = true
    sound.src = url
    // `play()` 有两种失败法：返回一个 reject 的 Promise（浏览器的自动播放
    // 策略，实测 headless Chrome 上就是 NotAllowedError），或者当场抛
    // （jsdom 的 HTMLMediaElement 根本没实现它）。两种都当"被挡下来了"处理 ——
    // 让一次放不出声去掀翻整个游戏循环，是这里最不该有的事。
    try {
      const started = sound.play()
      if (started && typeof started.then === 'function') {
        started.then(
          () => {
            blocked = false
          },
          () => arm(),
        )
      }
    } catch {
      arm()
    }
  }

  return {
    sync(bgm: string | null, fromStart = false): void {
      // 从头放靠的是 `start` 里那句重新赋 `src`：HTML 规范里给媒体元素的 src
      // 「设值或改值」都会跑一遍载入算法，播放位置回到开头 —— 同一个值也算。
      if (bgm === current && !fromStart) return
      current = bgm
      if (bgm === null) {
        sound?.pause()
        return
      }
      start(bgm)
    },
    playing(): string | null {
      return current
    },
    blocked(): boolean {
      return blocked
    },
    destroy(): void {
      disarm()
      sound?.pause()
      sound = null
      current = null
    },
  }
}
