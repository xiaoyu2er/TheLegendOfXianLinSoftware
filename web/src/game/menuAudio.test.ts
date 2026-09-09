import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import { getScene } from '../data/scenesEager'
import { resetParty } from '../fakes/party'
import { sceneSourceOf } from '../state/trace'
import { createWorld } from '../state/step'
import { createBgmPlayer } from '../audio/bgmPlayer'
import type { Sound } from '../audio/bgmPlayer'
import { getAudioSettings, resetAudioSettings } from './audioSettings'
import {
  NO_INPUT,
  advanceSession,
  createSession,
  currentBgm,
  enterScene,
  menuWorldOf,
  openMenu,
} from './session'
import type { RunningSession, SessionDeps } from './session'
import type { MenuInput } from '../menu/step'
import type { MenuButtonState } from '../menu/types'

/**
 * 「点天书页那颗『背景音乐 关』，声音真的停」这一整条 —— 从鼠标落点一路走到
 * 播放器上（xl-6lo.12 的验收标准之一）。
 *
 * ## 为什么这一条必须走到播放器，不能只看状态字段
 *
 * 状态层那一半（`isDraw` 怎么变、`audio.bgm` 怎么变）由
 * `menu/funcButtons.test.ts` 从 GBK 源码里解出来的参照模型守着。可那一层证得
 * 再干净，也证不到"**声音真的停了**" —— 会话没把那个开关读走、`currentBgm()`
 * 没理它、播放器没收到 `null`，任何一处漏掉，状态字段照样是对的，而背景音乐
 * 照旧在响。这三处正是这个文件走的三步。
 *
 * ⚠️ **这一段没有行为真值**：menu 真值不记 `CAN_PLAY_BGM`（`MenuDriver`
 * 的九列里没有它），而 scene 真值那五份没有一次进过菜单。所以判据是"环路真的
 * 跑一遍、两端都是真东西"：真场景建的世界、按几何算出来的落点、真的
 * `createBgmPlayer`。
 */

const DEPS: SessionDeps = {
  scenes: sceneSourceOf(getScene),
  sprite: () => ({ width: 1, height: 1 }),
  random: () => 0.5,
}

function inScene(name: string): RunningSession {
  resetParty()
  return enterScene(createSession(DEPS), createWorld(getScene(name)))
}

/** 与导出器 `MenuDriver.center()` 同一条公式（命中框偏左 15、偏上 6）。 */
function centerOf(b: MenuButtonState) {
  return { x: b.x - 15 + Math.floor(b.width / 2), y: b.y - 6 + Math.floor(b.height / 2) }
}

function click(b: MenuButtonState): MenuInput[] {
  const { x, y } = centerOf(b)
  return [
    { e: 'press', x, y },
    { e: 'release', x, y },
  ]
}

/** 点一颗按钮并推 0 毫秒 —— 输入是当场派发的，不等下一拍（`menu/loop.ts`）。 */
function tap(session: RunningSession, pick: (w: NonNullable<ReturnType<typeof menuWorldOf>>) => MenuButtonState): RunningSession {
  const w = menuWorldOf(session)
  if (!w) throw new Error('菜单没开着')
  const button = pick(w)
  expect(button.isDraw, '这颗按钮画不出来，点不着').toBe(true)
  return advanceSession(session, { ...NO_INPUT, menu: click(button) }, 0)
}

/** 走到「设定 → 背景音乐」那一层，两颗开 / 关都画得出来。 */
function openBgmSubmenu(): RunningSession {
  let s = openMenu(inScene('宿舍'))
  s = tap(s, (w) => w.tabs.func)
  expect(menuWorldOf(s)!.panel).toBe('funcPanel')
  const fb = () => menuWorldOf(s)!.panels.funcPanel.funcButtons!
  s = tap(s, () => fb().main.setButton)
  s = tap(s, () => fb().sub.setBGM)
  return s
}

beforeEach(() => {
  resetAudioSettings()
})
afterEach(() => {
  resetAudioSettings()
})

describe('天书页的「背景音乐 开 / 关」真的开关背景音乐', () => {
  it('原版关的是播放线程，不是"该放哪首" —— 判据从源码现读', () => {
    // `closeBGM()` 只把 `CAN_PLAY_BGM` 拨成 NO，而 `PlayThread` 每读一个缓冲块
    // 都看它一眼、看见就 break；`openBGM()` 把**同一首**（`currentPlayingBGM`）
    // 重新放上去。所以这一层的对应物是让**声明值**变成 null，而不是去改
    // 场景那边的 `audio.bgm`。抄成后者的话，回到场景会变成"这个场景没有曲子"，
    // 再开一次菜单也放不回来。
    const reader = javaSource('src/media/MusicReader.java')
    expect(reader).toContain('MusicPlayer.CAN_PLAY_BGM=MusicPlayer.NO')
    expect(reader).toContain('background.play(background.currentPlayingBGM)')
    const player = javaSource('src/media/MusicPlayer.java')
    expect(player).toContain('if (CAN_PLAY_BGM == NO)')
  })

  it('点「关」→ 声明值当场变 null；点「开」→ 变回场景那首', () => {
    let s = openBgmSubmenu()
    const scene = currentBgm(s)
    // 空转要响：这个场景本来就没曲子的话，下面那句 `not.toBeNull()` 之外的
    // 每一条都会在 null === null 上恒真。
    expect(scene, '宿舍这一场没有背景音乐，这条用例证不了任何东西').not.toBeNull()

    s = tap(s, () => menuWorldOf(s)!.panels.funcPanel.funcButtons!.sub.off_BGM)
    expect(menuWorldOf(s)!.audio.bgm).toBe(false)
    expect(getAudioSettings().bgm, '会话没把那个开关记回去').toBe(false)
    expect(currentBgm(s), '关掉之后还在声明要放曲子').toBeNull()
    // 场景那边**一个字没变** —— 关的是播放，不是"该放哪首"。
    expect(s.scene.world.audio.bgm).toBe(scene)

    s = tap(s, () => menuWorldOf(s)!.panels.funcPanel.funcButtons!.sub.on_BGM)
    expect(currentBgm(s), '重新打开之后没放回同一首').toBe(scene)
  })

  it('关掉之后回场景照样是关的 —— 原版那两个开关是 static，活得比菜单久', () => {
    let s = openBgmSubmenu()
    s = tap(s, () => menuWorldOf(s)!.panels.funcPanel.funcButtons!.sub.off_BGM)
    s = tap(s, () => menuWorldOf(s)!.panels.funcPanel.funcButtons!.main.returnButton)
    expect(s.panel, '「返回」没回到场景').toBe('scene')
    expect(currentBgm(s), '回了场景曲子自己又响了').toBeNull()

    // 再开一次菜单：新建的那份菜单世界要带着关着的那个开关，否则玩家一开菜单
    // 就看见「开 / 关」回到了默认位置。
    s = openMenu(s)
    expect(menuWorldOf(s)!.audio.bgm).toBe(false)
  })

  it('播放器真的停了 —— 一路走到 `pause()`', () => {
    // 假的 `Sound`：`bgmPlayer` 唯一碰的外界。记下每一次 play / pause。
    const calls: string[] = []
    const sound: Sound = {
      src: '',
      loop: false,
      play() {
        calls.push('play')
      },
      pause() {
        calls.push('pause')
      },
    }
    // `resolve` 直接给个 URL：真正的那一份对没转码的曲子返回 null，而"故意
    // 没转码"与"被关掉了"都表现为不出声 —— 两者混在一起就分不开了。
    const player = createBgmPlayer({ create: () => sound, resolve: (bgm) => `/${bgm}`, gestures: null })

    let s = openBgmSubmenu()
    player.sync(currentBgm(s))
    expect(player.playing(), '开着的时候没在放').not.toBeNull()
    expect(calls).toEqual(['play'])

    s = tap(s, () => menuWorldOf(s)!.panels.funcPanel.funcButtons!.sub.off_BGM)
    player.sync(currentBgm(s))
    expect(calls, '点了「关」播放器没停').toEqual(['play', 'pause'])
    expect(player.playing()).toBeNull()

    s = tap(s, () => menuWorldOf(s)!.panels.funcPanel.funcButtons!.sub.on_BGM)
    player.sync(currentBgm(s))
    expect(calls, '点了「开」播放器没放回来').toEqual(['play', 'pause', 'play'])
    player.destroy()
  })

  it('「特殊音效 关」不碰背景音乐 —— 两个开关是两个字段', () => {
    let s = openMenu(inScene('宿舍'))
    s = tap(s, (w) => w.tabs.func)
    const fb = () => menuWorldOf(s)!.panels.funcPanel.funcButtons!
    s = tap(s, () => fb().main.setButton)
    s = tap(s, () => fb().sub.setClick)
    s = tap(s, () => fb().sub.off_click)
    expect(menuWorldOf(s)!.audio.sfx).toBe(false)
    expect(menuWorldOf(s)!.audio.bgm, '关音效把背景音乐一起关了').toBe(true)
    expect(currentBgm(s)).not.toBeNull()
  })
})
