import { describe, expect, it } from 'vitest'
import { bgmAssetId } from '../assets/ids'
import { resolveBgmOrNull } from '../assets/resolve'
import { BGM_BY_BACKGROUND } from '../battle/units'
import { getScene } from '../data/scenesEager'
import { SCENE_TRACE_NAMES, readTrace } from '../state/trace'
import { TITLE_BGM } from '../start/assets'
import { javaSource } from '../test/javaSource'
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

  /**
   * 切到标题那一屏，播放器**真的换曲子**（xl-kaa）。
   *
   * 走的是**真的映射表**，不是上面那些用例里的假 `resolve` —— 这一条要验的
   * 正是"标题曲查得到"这件事本身。标题曲不在任何一个场景的 `Music` 段里
   * （它写在 `GameLauncher.switchTo("start")` 那句上），所以烘焙器那两份现扫
   * 的名单谁都罩不住它，得显式加一首；不加不是静音而是 `resolveAsset` 抛，
   * 而抛的地方在游戏循环里。
   */
  it('从场景切到标题：换 src 并重新 play，URL 指向真的产物', () => {
    const log: string[] = []
    const player = createBgmPlayer({
      create: () => fakeSound(log),
      resolve: (bgm) => resolveBgmOrNull(bgmAssetId(bgm)),
      gestures: null,
    })
    // 起手是一首**真烘过**的场景曲（大地图在真值里走到过），不然下面那句
    // "换过了"就分不清是"从静音换过来"还是"从上一首换过来"。
    const sceneBgm = getScene('大地图').sceneMusic!
    expect(resolveBgmOrNull(bgmAssetId(sceneBgm))).not.toBeNull()
    player.sync(sceneBgm)
    player.sync(TITLE_BGM)

    expect(player.playing()).toBe(TITLE_BGM)
    // 两次 src + 两次 play：第二首真的送进播放器了，不是被 `null` 静音掉。
    expect(log.filter((l) => l === 'play')).toHaveLength(2)
    expect(decodeURIComponent(log.at(-2)!)).toContain('bgm/主题曲.m4a')
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

/**
 * 战斗那几首背景音乐**真的放得出来**（xl-19z）。
 *
 * 上面那一组的分母是场景真值里的 `audio.bgm`，而战斗真值不在那份分母里 ——
 * 于是「状态层声明了该放哪首」一路是绿的，产品侧的映射表里却一首都没有：
 * 进战斗那一拍 `resolveBgmOrNull` 抛（映射表里没有、也不在故意没烘的名单上）。
 *
 * **分母从原版源码现读**，不从 `BGM_BY_BACKGROUND` 抄：那张表是被守的一方
 * （它自己对回源码是 `battle/units.test.ts` 的事）。这里扫 `BattlePanel.java`
 * 里**每一处** `MusicReader.readBGM(...)`，不限于那个 switch —— 源码哪天在
 * 别处多放一首，这里也跟着多一条。两份名单再取并集：表里有而源码里扫不到
 * 的，同样得放得出来。
 *
 * ⚠️ 这条证的是「映射表里有、URL 指向真产物」，**不是**「玩家真的听到了」——
 * 自动播放策略、解码失败它都看不见（与 SPEC 里音效判据写下的弱点同一句）。
 */
describe('战斗背景音乐', () => {
  const source = javaSource('src/battle/BattlePanel.java')
  const fromSource = [...source.matchAll(/MusicReader\.readBGM\("([^"]+)"\)/g)].map((m) => m[1]!)
  const battleBgm = [...new Set([...fromSource, ...Object.values(BGM_BY_BACKGROUND)])].sort()

  it('源码里扫到了不止一首（否则下面几条是空转）', () => {
    // GBK 没解对、正则写错，都会让这里是零 —— 而零条的逐首检查恒真。
    expect(new Set(fromSource).size).toBeGreaterThan(1)
  })

  /**
   * 这里、烘焙器 `battleBgmFromSource()`、`assets/resolve.test.ts` 三处都只认
   * **字面量**实参。原版哪天写成 `readBGM(name)`，三处会一起漏掉那一首，而
   * 漏掉与「源码里没有」长得一样（/code-review Spec 轴提的）。所以把全部调用
   * 点数一遍，与字面量那几处对上。
   */
  it('BattlePanel.java 里每一处 readBGM 都是字面量实参 —— 否则上面的扫描会漏', () => {
    expect(fromSource.length).toBe([...source.matchAll(/\breadBGM\s*\(/g)].length)
  })

  it.each(battleBgm)('%s 解析得到一个产物 URL，不是抛、也不是故意静音', (bgm) => {
    const url = resolveBgmOrNull(bgmAssetId(bgm))
    expect(url).not.toBeNull()
    expect(decodeURIComponent(url!)).toContain(`bgm/${bgm.replace(/\.[^.]+$/, '')}.m4a`)
  })

  /**
   * 走**真映射表**的播放器，逐首 `sync`：不抛，而且每一首都真的换了 `src`。
   *
   * 修之前的读数（2026-09-11，`脚本22` 进战斗，jsdom + 假定时器）：抛只发生
   * **一次** —— `sync` 先记下声明值再去解析，于是后面每一拍都是「同一个值」
   * 的空操作。代价是**那一拍的绘制被跳过**，以及**上一首场景曲接着放**
   * （`start` 在换 `src` 之前就抛了），而 `playing()` 报的已经是战斗曲。
   */
  it('真播放器逐首切过去：一首都不抛，每一首都送进了播放对象', () => {
    const log: string[] = []
    const player = createBgmPlayer({
      create: () => fakeSound(log),
      resolve: (bgm) => resolveBgmOrNull(bgmAssetId(bgm)),
      gestures: null,
    })
    for (const bgm of battleBgm) {
      expect(() => player.sync(bgm), bgm).not.toThrow()
      expect(player.playing()).toBe(bgm)
    }
    expect(log.filter((l) => l === 'play')).toHaveLength(battleBgm.length)
  })
})

/**
 * 回标题那一下**同一首也从头放**（xl-6zf）。原版 `switchTo("start")` 每次都
 * `readBGM("主题曲.mp3")`，而 `MusicPlayer.play(name)` 不看是不是同一首：先停掉
 * 播放线程、再把文件从头打开。标题 →「承」→ 存读档 → Esc 回标题，曲子一直是
 * 主题曲，于是「同值是空操作」那条规矩会把这一下吞掉。
 */
describe('背景音乐播放器 · 从头放', () => {
  function make(log: string[]) {
    return createBgmPlayer({ create: () => fakeSound(log), resolve: (bgm) => `/${bgm}.m4a`, gestures: null })
  }

  it('同一首、要求从头放：重新赋 src 再 play（HTML 规范里赋 src 就是重新载入、回到开头）', () => {
    const log: string[] = []
    const player = make(log)
    player.sync(TITLE_BGM)
    log.length = 0
    player.sync(TITLE_BGM, true)
    expect(log).toEqual([`src=/${TITLE_BGM}.m4a`, 'play'])
    expect(player.playing()).toBe(TITLE_BGM)
  })

  it('同一首、不要求从头放：仍是空操作（每一拍都会被调一次）', () => {
    const log: string[] = []
    const player = make(log)
    player.sync(TITLE_BGM)
    log.length = 0
    player.sync(TITLE_BGM)
    player.sync(TITLE_BGM, false)
    expect(log).toEqual([])
  })

  it('要求从头放、但声明值是 null：照样只停，不重放', () => {
    const log: string[] = []
    const player = make(log)
    player.sync(TITLE_BGM)
    log.length = 0
    player.sync(null, true)
    expect(log).toEqual(['pause'])
  })
})
