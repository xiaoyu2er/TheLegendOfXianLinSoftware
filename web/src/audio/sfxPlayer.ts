import { sfxAssetId } from '../assets/ids'
import { resolveAsset } from '../assets/resolve'
import type { Sound } from './bgmPlayer'

/**
 * 音效播放器（xl-03x.6）—— 原版 `MusicReader.music` 那个实例的对应物。
 *
 * 与 `bgmPlayer.ts` **接口同形**（同一种 `create` / `resolve` 注入，同样的
 * `playing()` / `blocked()` / `destroy()`），但主方法的语义**故意不同**，
 * 下面两条都是原版读数定的（读数全文贴在 bd comments xl-03x.6）。
 *
 * ## 喂进来的是瞬时量，不是当前值
 *
 * 菜单与商店真值的 `music` 是**这一步请求了哪几声**，每步清空。所以
 * `play(names)` 一步调一次：连着两步同一声就是响两次；空数组是「这一步没
 * 出声」，**不是**「该静音了」。照抄 `bgmPlayer.sync` 的「同值空操作、null
 * 就停」两条，这里两条都错。
 *
 * ## 与背景音乐并发，音效之间后顶前
 *
 * 原版 `background` 与 `music` 是两个实例、两个开关：放着背景音乐来一声
 * 音效，两条播放线程都活着；关掉一个，另一个的流照读不误。这一层照做 ——
 * 与背景音乐是**两个播放器、两个对象**，互相拿不到对方。
 *
 * 音效**之间**不重叠：放着一声时再来一声，旧的那声的流在新声起来之后一个
 * 字节都没再被读（成因是 `playmusic` 覆写同一组实例字段）。这一层照做的方式
 * 与背景音乐那边一样是**结构性**的：整个播放器只有一个 `Sound`，新的一声是给
 * 它换 `src`，旧的那段随之丢掉。单元测试守的是「只有一个对象、新声换它的
 * `src`」；「换 `src` 就不再喂旧的那段」是 `HTMLAudioElement` 的行为（HTML
 * 规范的媒体载入算法），⚠️ **未在真浏览器里验证过**。
 *
 * ## 开关
 *
 * `setEnabled` 是 `CAN_PLAY_MUSIC` 的落点：关掉时正在响的那声停下，关着时的
 * 请求直接丢，重新打开不补放。**设定页接到这里是 xl-03x.8 的事**，这一层只管
 * 把开关本身做对。
 *
 * ⚠️ 这一层的判据证的是「交给了播放对象、参数对」，**证不了玩家真的听到了**
 * —— 自动播放策略、解码失败、音量为零都在它外面。
 */

/** 音效还要知道一声什么时候自己放完了（`HTMLAudioElement.onended`）。 */
export interface SfxSound extends Sound {
  onended: (() => void) | null
}

export interface SfxPlayer {
  /**
   * 这一步原版请求的音效文件名（如 `换list.wav`），按请求先后。
   * **一步调一次**：同一声连着两步就响两次；空数组什么都不做。
   */
  play(names: readonly string[]): void
  /** 此刻还在响的那一声。`null` = 没有在响的（放完了、被关了、从没响过）。 */
  playing(): string | null
  /** `CAN_PLAY_MUSIC`。关掉时停下正在响的那声；打开不补放。 */
  setEnabled(on: boolean): void
  enabled(): boolean
  /** 浏览器把最近一次 `play()` 挡下来了。诊断用。 */
  blocked(): boolean
  destroy(): void
}

export interface SfxPlayerOptions {
  /** 建那唯一一个播放对象。默认是 `new Audio()`。 */
  create?: () => SfxSound
  /**
   * 文件名 → 可以喂给播放器的 URL。`null` = 查不到，这一声不出、**也不顶掉**
   * 正在响的那声（原版读数：找不到文件时先抛，字段没被覆写，上一声照响）。
   *
   * 默认走真的映射表，查不到就抛 —— 游戏里点过名的每一声都查得到
   * （`assets/sfxAssets.test.ts` 从 GBK 源码现读核对），查不到只能是烘焙漏了，
   * 静音会把它藏起来。
   */
  resolve?: (name: string) => string | null
}

export function createSfxPlayer(options: SfxPlayerOptions = {}): SfxPlayer {
  const create = options.create ?? (() => new Audio() as SfxSound)
  const resolve = options.resolve ?? ((name: string) => resolveAsset(sfxAssetId(name)))

  let sound: SfxSound | null = null
  let current: string | null = null
  let on = true
  let blocked = false

  function stop(): void {
    sound?.pause()
    current = null
  }

  function start(name: string): void {
    const url = resolve(name)
    if (url === null) return
    if (!sound) {
      const s = create()
      s.loop = false
      // 不核是哪一声放完：只有一个对象，换过 src 之后被顶掉的那段不会再来
      // ended（HTML 规范的媒体载入算法；⚠️ 未在真浏览器里验证过），所以来的
      // ended 只可能属于最后交出去的那一声。
      s.onended = () => {
        current = null
      }
      sound = s
    }
    current = name
    sound.src = url
    // 与 bgmPlayer 同理：两种失败法（reject / 当场抛）都只记下来，不掀翻游戏循环。
    // 与它不同的是**不等手势重试**：音效是那一拍的事，等一次点击再补响就错拍了。
    try {
      const started = sound.play()
      if (started && typeof started.then === 'function') {
        started.then(
          () => {
            blocked = false
          },
          (err: unknown) => {
            // 换 src 或 pause() 会让上一次还没兑现的 play() 以 AbortError 拒掉
            // —— 那是「被后一声顶掉 / 被关掉」，不是浏览器挡了自动播放。
            if ((err as { name?: unknown } | null)?.name !== 'AbortError') blocked = true
          },
        )
      }
    } catch {
      blocked = true
    }
  }

  return {
    play(names: readonly string[]): void {
      if (!on) return
      for (const name of names) start(name)
    },
    playing(): string | null {
      return current
    },
    setEnabled(next: boolean): void {
      if (next === on) return
      on = next
      if (!on) stop()
    },
    enabled(): boolean {
      return on
    },
    blocked(): boolean {
      return blocked
    },
    destroy(): void {
      stop()
      if (sound) sound.onended = null
      sound = null
    },
  }
}
