import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBgmPlayer } from '../audio/bgmPlayer'
import { createSfxPlayer } from '../audio/sfxPlayer'
import type { SfxSound } from '../audio/sfxPlayer'
import { getScene } from '../data/scenesEager'
import { resetParty } from '../fakes/party'
import type { FuncButtonsState } from '../menu/funcButtons'
import type { MenuInput } from '../menu/step'
import type { MenuButtonState } from '../menu/types'
import { createMemorySaveStore } from '../save/memoryStore'
import { createWorld } from '../state/step'
import { sceneSourceOf } from '../state/trace'
import { javaSource } from '../test/javaSource'
import { menuHitCenter } from '../test/menuHit'
import { resetAudioSettings } from './audioSettings'
import { NO_INPUT, advanceSession, createSession, currentBgm, enterScene, menuWorldOf, openMenu, playSfx } from './session'
import type { RunningSession, SessionDeps } from './session'

/**
 * 天书页「特殊音效 开 / 关」的落点（xl-03x.8）：拨到关，音效不响、背景音乐照响；
 * 拨回开，又响。
 *
 * ## 原版读数（xl-03x.8 自己跑的，全文贴在 bd comments xl-03x.8）
 *
 * 反射读 `MusicReader` 的两个实例，不改 `src/`：`background == music` 为 false；
 * 放着背景音乐时来一声音效，两条播放线程各活一条；`closeMusic()` 之后 1.5 秒里
 * 音效线程死了、音效流只多读走 320 字节（循环体先读一块再看开关，恰好一块）、
 * 背景音乐线程照活；关着时 `readmusic` 一声，音效线程不起，再 `openMusic()`
 * 300 ms 仍然不起（不补放）；放着音效 `closeBGM()`，背景音乐线程死了、音效流
 * 1.5 秒里照读走 68160 字节。⇒ **两个开关各管各的**。
 *
 * ## 这一条为什么要走到两个真播放器上
 *
 * 状态层那一半（点「关」之后 `audio.sfx` 变 false、不碰 `audio.bgm`）
 * `menuAudio.test.ts` 已经守着，可那一层证不到"**声音真的停了**"：接线层没把
 * 开关交给音效播放器、或者交错了播放器，状态字段照样是对的。所以这里是
 * 真场景 → 真会话 → `currentBgm` / `playSfx`（`useGame` 的 pump 调的就是这两句，
 * 同一个次序）→ 两个**真**播放器，只把最外面那一层 `HTMLAudioElement` 换成记账的。
 *
 * ⚠️ 与音效链其余几张同一句：证的是「交没交给播放对象」，**证不了玩家真的听到了**。
 */

const DEPS: SessionDeps = {
  scenes: sceneSourceOf(getScene),
  sprite: () => ({ width: 1, height: 1 }),
  random: () => 0.5,
  saves: createMemorySaveStore(),
}

/** 两个播放器共用一份 log，每条前面标明是谁的对象被动了。 */
function rig() {
  const log: string[] = []
  const sound = (tag: string): SfxSound => ({
    src: '',
    loop: true,
    onended: null,
    play() {
      log.push(`${tag} play ${decodeURIComponent(this.src)}`)
    },
    pause() {
      log.push(`${tag} pause`)
    },
  })
  const bgm = createBgmPlayer({ create: () => sound('bgm'), resolve: (b) => `/${b}`, gestures: null })
  const sfx = createSfxPlayer({ create: () => sound('sfx'), resolve: (n) => `/${n}` })
  /** 一拍推完之后 pump 做的那两句。 */
  const pump = (s: RunningSession): RunningSession => {
    bgm.sync(currentBgm(s))
    playSfx(sfx, s)
    return s
  }
  /** 取走到此为止 `who` 那一边的 log（另一边的留着）。 */
  const take = (who: 'bgm' | 'sfx'): string[] => {
    const mine = (l: string) => l.startsWith(`${who} `)
    const got = log.filter(mine)
    const rest = log.filter((l) => !mine(l))
    log.length = 0
    log.push(...rest)
    return got
  }
  return { bgm, sfx, pump, take, log }
}

function click(b: MenuButtonState): MenuInput[] {
  const { x, y } = menuHitCenter(b)
  return [
    { e: 'press', x, y },
    { e: 'release', x, y },
  ]
}

function funcButtonsOf(s: RunningSession): FuncButtonsState {
  const fb = menuWorldOf(s)?.panels.funcPanel.funcButtons
  if (!fb) throw new Error('天书页没开着')
  return fb
}

beforeEach(() => {
  resetParty()
  resetAudioSettings()
})
afterEach(() => {
  resetAudioSettings()
})

/** 开菜单 → 天书页 → 设定 → 特殊音效，「开 / 关」两颗都画得出来。每一拍都照 pump 交给播放器。 */
function toSfxSubmenu(r: ReturnType<typeof rig>) {
  const tap = (s: RunningSession, pick: (s: RunningSession) => MenuButtonState): RunningSession => {
    const b = pick(s)
    expect(b.isDraw, '这颗按钮画不出来，点不着').toBe(true)
    return r.pump(advanceSession(s, { ...NO_INPUT, menu: click(b) }, 0))
  }
  let s = r.pump(openMenu(enterScene(createSession(DEPS), createWorld(getScene('宿舍')))))
  s = tap(s, (s) => menuWorldOf(s)!.tabs.func)
  s = tap(s, (s) => funcButtonsOf(s).main.setButton)
  s = tap(s, (s) => funcButtonsOf(s).sub.setClick)
  return { s, tap }
}

describe('天书页「特殊音效 开 / 关」真的开关音效', () => {
  it('原版的开关是音效那条播放线程自己读的，关着时的请求在入口就丢 —— 从源码现读', () => {
    const reader = javaSource('src/media/MusicReader.java')
    expect(reader).toContain('MusicPlayer.CAN_PLAY_MUSIC=MusicPlayer.NO')
    expect(reader).toContain('static MusicPlayer music= new MusicPlayer("sources/music")')
    const player = javaSource('src/media/MusicPlayer.java')
    // 入口一道（关着时 `playmusic` 整个不进）、线程里一道（正在响的那声下一块就停）。
    expect(player).toMatch(/if \(CAN_PLAY_MUSIC == YES\)\s*\{/)
    // 两个开关是 static、两个实例共用 —— 「各管各的」靠的是**哪条线程读哪个**：
    // 背景音乐那条（`PlayThread`）只读 `CAN_PLAY_BGM`，音效那条（`PlayThread2`）只读
    // `CAN_PLAY_MUSIC`。按类体切开再核，只核「字符串在不在」的话，给背景音乐那条
    // 线程加一道 `CAN_PLAY_MUSIC` 判断照样绿。
    const bgmThread = player.slice(player.indexOf('class PlayThread extends'), player.indexOf('class PlayThread2'))
    const sfxThread = player.slice(player.indexOf('class PlayThread2'))
    expect(bgmThread).toMatch(/if \(CAN_PLAY_BGM == NO\)/)
    expect(bgmThread).not.toContain('CAN_PLAY_MUSIC')
    expect(sfxThread).toMatch(/if \(CAN_PLAY_MUSIC == NO\)/)
    expect(sfxThread).not.toContain('CAN_PLAY_BGM')
  })

  it('关掉之后音效不响：正在响的那声停下，之后请求的一声都交不到播放对象上；拨回开又响', () => {
    const r = rig()
    let { s, tap } = toSfxSubmenu(r)
    // 空转要响：点「特殊音效」那一下本身出一声，播放器此刻在响它。
    expect(r.sfx.playing(), '开着的时候点按钮没出声，下面的「不响」恒真').toBe('换list.wav')
    r.take('sfx')

    s = tap(s, (s) => funcButtonsOf(s).sub.off_click)
    expect(r.take('sfx'), '点了「关」，正在响的那声没停').toEqual(['sfx pause'])
    expect(r.sfx.playing()).toBeNull()

    // 关着再点一颗会出声的按钮：状态层**照样请求**那一声（原版 `readmusic` 照调，
    // 挡在 `playmusic` 里），所以这里的「不响」是开关挡下的，不是本来就没请求。
    s = tap(s, (s) => funcButtonsOf(s).main.setButton)
    expect(s.sfx, '这一步状态层没请求音效，「关着不响」证不了什么').toEqual(['换list.wav'])
    expect(r.take('sfx'), '关着还是交给了播放对象').toEqual([])
    expect(r.sfx.playing()).toBeNull()

    // 拨回开：原版 `openMusic()` 在前、`readmusic` 在后，所以那一声当场响。
    s = tap(s, (s) => funcButtonsOf(s).sub.setClick)
    expect(r.take('sfx'), '关着时点「特殊音效」也不该响').toEqual([])
    s = tap(s, (s) => funcButtonsOf(s).sub.on_click)
    expect(r.take('sfx'), '拨回开，那一声没响').toEqual(['sfx play /换list.wav'])
    expect(r.sfx.playing()).toBe('换list.wav')
  })

  it('关掉音效背景音乐不受影响；反过来关掉背景音乐，音效照响', () => {
    const r = rig()
    let { s, tap } = toSfxSubmenu(r)
    const scene = currentBgm(s)
    expect(scene, '宿舍这一场没有背景音乐，这条用例证不了任何东西').not.toBeNull()
    expect(r.bgm.playing()).toBe(scene)
    r.take('bgm')

    s = tap(s, (s) => funcButtonsOf(s).sub.off_click)
    s = tap(s, (s) => funcButtonsOf(s).main.setButton)
    expect(r.take('bgm'), '关音效碰了背景音乐的播放对象').toEqual([])
    expect(r.bgm.playing(), '关音效把背景音乐停了').toBe(scene)

    // 反过来：音效开着、背景音乐关掉。
    s = tap(s, (s) => funcButtonsOf(s).sub.setClick)
    s = tap(s, (s) => funcButtonsOf(s).sub.on_click)
    s = tap(s, (s) => funcButtonsOf(s).sub.setBGM)
    r.take('sfx')
    s = tap(s, (s) => funcButtonsOf(s).sub.off_BGM)
    expect(r.take('bgm'), '点了「背景音乐 关」背景音乐没停').toEqual(['bgm pause'])
    expect(r.take('sfx'), '关背景音乐那一下的音效没响').toEqual(['sfx play /换list.wav'])
    expect(r.sfx.enabled(), '关背景音乐把音效也关了').toBe(true)
  })
})
