import { describe, expect, it } from 'vitest'
import { bgmAssetId } from '../assets/ids'
import { resolveBgmOrNull } from '../assets/resolve'
import { getScene } from '../data/scenesEager'
import { SCENE_TRACE_NAMES, readTrace } from '../state/trace'
import { createBgmPlayer } from './bgmPlayer'
import type { Sound } from './bgmPlayer'

/** 一个假的 `HTMLAudioElement`，把每一次操作按顺序记下来。 */
function fakeSound(log: string[], onPlay: () => Promise<void> | void = () => undefined): Sound {
  let src = ''
  return {
    loop: false,
    get src(): string {
      return src
    },
    set src(v: string) {
      src = v
      log.push(`src=${v}`)
    },
    play() {
      log.push('play')
      return onPlay()
    },
    pause() {
      log.push('pause')
    },
  }
}

describe('背景音乐播放器', () => {
  function make(log: string[], created: Sound[] = []) {
    return createBgmPlayer({
      create: () => {
        const s = fakeSound(log)
        created.push(s)
        return s
      },
      resolve: (bgm) => `/${bgm}.m4a`,
      gestures: null,
    })
  }

  it('跟着声明值换曲子，而且从头到尾只有一个播放对象', () => {
    const log: string[] = []
    const created: Sound[] = []
    const player = make(log, created)

    player.sync('舒缓.mp3')
    player.sync('大地图.mp3')
    player.sync('欢乐的宿舍.mp3')

    // **一个**播放对象：不重叠是结构性的，不是靠"记得停掉上一个"。
    expect(created).toHaveLength(1)
    expect(created[0]!.loop).toBe(true)
    expect(log).toEqual([
      'src=/舒缓.mp3.m4a',
      'play',
      'src=/大地图.mp3.m4a',
      'play',
      'src=/欢乐的宿舍.mp3.m4a',
      'play',
    ])
    expect(player.playing()).toBe('欢乐的宿舍.mp3')
  })

  it('同一个值反复同步是空操作 —— 它每 tick 都会被调一次', () => {
    const log: string[] = []
    const player = make(log)
    for (let i = 0; i < 100; i++) player.sync('舒缓.mp3')
    expect(log).toEqual(['src=/舒缓.mp3.m4a', 'play'])
  })

  it('声明值为 null 就停下，不是继续放上一首', () => {
    const log: string[] = []
    const player = make(log)
    player.sync('舒缓.mp3')
    player.sync(null)
    expect(log).toEqual(['src=/舒缓.mp3.m4a', 'play', 'pause'])
    expect(player.playing()).toBeNull()
  })

  it('还没转码的那些静音，并且把上一首停掉', () => {
    const log: string[] = []
    const player = createBgmPlayer({
      create: () => fakeSound(log),
      // 第二首在"故意还没转码"的名单上。
      resolve: (bgm) => (bgm === '舒缓.mp3' ? '/舒缓.m4a' : null),
      gestures: null,
    })
    player.sync('舒缓.mp3')
    player.sync('紧张1.mp3')
    expect(log).toEqual(['src=/舒缓.m4a', 'play', 'pause'])
    // 声明值照样跟着世界走 —— 静音的是输出，不是那个可断言的值。
    expect(player.playing()).toBe('紧张1.mp3')
  })

  it('自动播放被浏览器挡下来时，等一次用户手势再试', async () => {
    const log: string[] = []
    const listeners = new Map<string, EventListener>()
    let allow = false
    const player = createBgmPlayer({
      create: () =>
        fakeSound(log, () => (allow ? Promise.resolve() : Promise.reject(new Error('NotAllowed')))),
      resolve: (bgm) => `/${bgm}.m4a`,
      gestures: {
        addEventListener: (type, l) => listeners.set(type, l as EventListener),
        removeEventListener: (type) => listeners.delete(type),
      },
    })

    player.sync('舒缓.mp3')
    await Promise.resolve()
    await Promise.resolve()
    expect(player.blocked()).toBe(true)
    expect(listeners.has('pointerdown')).toBe(true)

    allow = true
    listeners.get('pointerdown')!(new Event('pointerdown'))
    await Promise.resolve()
    await Promise.resolve()
    expect(player.blocked()).toBe(false)
    // 重试放的是**当前**声明的那一首，不是被挡下来的那一刻的那一首。
    expect(log.filter((l) => l === 'play')).toHaveLength(2)
    player.destroy()
  })
})

/**
 * "M1 用到的音频已转码"这条验收，**分母从真值里数**：把已导出的每一份 trace
 * 里出现过的每一个背景音乐声明值收起来，逐个去映射表里解。
 *
 * 这比"数一数 bgm/ 下有几个文件"强的地方：剧本走到哪首曲子是数据说了算，
 * 将来剧本改了、场景换了音乐，这里立刻就知道，而不是等玩家发现某个场景是
 * 哑的。
 */
describe('M1 用到的背景音乐', () => {
  const declared = new Set<string>()
  for (const name of SCENE_TRACE_NAMES) {
    for (const tick of readTrace(name).ticks) {
      if (tick.audio.bgm !== null) declared.add(tick.audio.bgm)
    }
  }

  it('真值里确实声明过背景音乐，而且不止一首（否则下面这条是空转）', () => {
    expect(declared.size).toBeGreaterThan(1)
  })

  it.each([...declared].sort())('%s 解析得到一个产物 URL', (bgm) => {
    const url = resolveBgmOrNull(bgmAssetId(bgm))
    expect(url).not.toBeNull()
    expect(decodeURIComponent(url!)).toContain(`bgm/${bgm.replace(/\.[^.]+$/, '')}.m4a`)
  })

  it('每一份 trace 的起手音乐就是那个场景 Music 段里写的那首', () => {
    for (const name of SCENE_TRACE_NAMES) {
      const trace = readTrace(name)
      const first = trace.ticks[0]!
      expect({ name, bgm: first.audio.bgm }).toEqual({
        name,
        bgm: getScene(first.scene.replace(/\.txt$/, '')).sceneMusic,
      })
    }
  })
})
