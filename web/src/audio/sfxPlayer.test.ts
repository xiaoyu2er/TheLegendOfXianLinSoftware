import { readdirSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bgmAssetId, sfxAssetId } from '../assets/ids'
import { resolveAsset, resolveBgmOrNull } from '../assets/resolve'
import { SFX_ROOT, sfxProductPath } from '../assets/sfxAssets'
import { getScene } from '../data/scenesEager'
import { repoPath } from '../test/repoPath'
import { createBgmPlayer } from './bgmPlayer'
import { createSfxPlayer } from './sfxPlayer'
import type { SfxSound } from './sfxPlayer'

/**
 * 一个假的 `HTMLAudioElement`，把每一次操作按顺序记进 `log`，前面加上 `tag`
 * —— 两个播放器共用一份 log 时，分得清是谁的对象被动了。
 */
function fakeSound(log: string[], tag: string): SfxSound {
  let src = ''
  return {
    loop: false,
    onended: null,
    get src(): string {
      return src
    },
    set src(v: string) {
      src = v
      log.push(`${tag} src=${v}`)
    },
    play() {
      log.push(`${tag} play`)
    },
    pause() {
      log.push(`${tag} pause`)
    },
  }
}

function make(log: string[], created: SfxSound[] = []) {
  return createSfxPlayer({
    create: () => {
      const s = fakeSound(log, 'sfx')
      created.push(s)
      return s
    },
    resolve: (name) => `/${name}.m4a`,
  })
}

/**
 * 原版的读数（xl-03x.6，贴在 bd comments xl-03x.6）：`MusicReader` 里
 * `background` 与 `music` 是**两个实例**，`CAN_PLAY_BGM` 与 `CAN_PLAY_MUSIC`
 * 是**两个开关**，各自只被自己那条播放线程读。放着背景音乐时 `readmusic`，
 * 两条线程都活着；关掉音效之后 1.5 秒里音效流一个字节都没再读、背景音乐线程
 * 照活；反过来关掉背景音乐，音效流 1.5 秒里照样读走 129920 字节。
 */
describe('音效与背景音乐：两个独立播放器、两个独立开关', () => {
  /**
   * 这一组**走两个播放器的默认 `create`**（`new Audio()`），全局 `Audio` 换成
   * 一个把每次操作记进同一份 log 的假类，每个实例一个编号。
   *
   * 为什么不像下面那些用例一样注入 `create`：注入的话两个播放器按构造就拿到
   * 两个对象，「共用一个播放对象」这种回归在这里**根本写不出来**，判据恒真。
   * 要守的正是默认路径上两边各建各的。
   */
  const log: string[] = []
  let made = 0
  class FakeAudio {
    readonly tag = `audio#${++made}`
    loop = false
    onended: (() => void) | null = null
    #src = ''
    get src(): string {
      return this.#src
    }
    set src(v: string) {
      this.#src = v
      log.push(`${this.tag} src=${decodeURIComponent(v)}`)
    }
    play(): void {
      log.push(`${this.tag} play`)
    }
    pause(): void {
      log.push(`${this.tag} pause`)
    }
  }
  beforeEach(() => {
    log.length = 0
    made = 0
    vi.stubGlobal('Audio', FakeAudio)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** 一首真烘过的场景曲，走真的映射表（`resolveBgmOrNull` 不会给 null 的那种）。 */
  const BGM = getScene('大地图').sceneMusic!

  function both() {
    const bgm = createBgmPlayer({ gestures: null })
    const sfx = createSfxPlayer()
    bgm.sync(BGM)
    sfx.play(['战斗失败.MP3'])
    return { bgm, sfx }
  }

  it('放着背景音乐时来一声音效：两个对象各响各的，背景音乐那个一下都没被碰', () => {
    expect(resolveBgmOrNull(bgmAssetId(BGM))).not.toBeNull()
    const { bgm, sfx } = both()
    sfx.play(['click.wav'])
    expect(made).toBe(2)
    const bgmOps = log.filter((l) => l.startsWith('audio#1 '))
    expect(bgmOps).toHaveLength(2)
    expect(bgmOps[0]).toContain(`bgm/${BGM.replace(/\.[^.]+$/, '')}.m4a`)
    expect(bgmOps[1]).toBe('audio#1 play')
    expect(log.filter((l) => l.startsWith('audio#2 ')).at(-2)).toContain('sfx/click.m4a')
    expect(bgm.playing()).toBe(BGM)
    expect(sfx.playing()).toBe('click.wav')
  })

  it('关掉音效：正在响的那声停下，背景音乐不受影响', () => {
    const { bgm, sfx } = both()
    log.length = 0
    sfx.setEnabled(false)
    expect(log).toEqual(['audio#2 pause'])
    expect(sfx.playing()).toBeNull()
    expect(bgm.playing()).toBe(BGM)
  })

  it('关掉背景音乐：正在响的音效不受影响', () => {
    const { bgm, sfx } = both()
    log.length = 0
    bgm.sync(null)
    expect(log).toEqual(['audio#1 pause'])
    expect(sfx.playing()).toBe('战斗失败.MP3')
    expect(sfx.enabled()).toBe(true)
  })
})

describe('音效播放器', () => {
  /**
   * **后一声顶掉前一声**，不是两声一起响（原版读数，xl-03x.6）：放着
   * `战斗失败.wav` 时 `readmusic("伏虎冲天.wav")`，之后 500ms **第一声的流
   * 一个字节都没再被读**（两声收完后还剩 732248 字节）。成因是音效只有
   * `music` 这一个实例，`playmusic` 覆写同一组实例字段。
   *
   * 所以尺子是「旧的那声在新声起来之后还有没有继续被喂」，落到这一层就是：
   * **只有一个播放对象，新的一声是给它换 `src`**（`src` 一换，
   * `HTMLAudioElement` 就丢掉旧的那段重新载入）。
   */
  it('后一声顶掉前一声：从头到尾只有一个播放对象，新声给它换 src', () => {
    const log: string[] = []
    const created: SfxSound[] = []
    const player = make(log, created)
    player.play(['战斗失败.MP3'])
    player.play(['伏虎冲天.wav'])
    expect(created).toHaveLength(1)
    expect(created[0]!.loop).toBe(false)
    expect(created[0]!.src).toBe('/伏虎冲天.wav.m4a')
    expect(player.playing()).toBe('伏虎冲天.wav')
  })

  it('同一步里请求两声：按先后都交出去，最后留下的是后一声', () => {
    const log: string[] = []
    const player = make(log)
    player.play(['换头像.wav', 'click.wav'])
    expect(log).toEqual([
      'sfx src=/换头像.wav.m4a',
      'sfx play',
      'sfx src=/click.wav.m4a',
      'sfx play',
    ])
    expect(player.playing()).toBe('click.wav')
  })

  /**
   * **瞬时量，不是当前值** —— 这一条就是规格警告的「照抄背景音乐那种同步语义
   * 会错」。菜单与商店真值的 `music` 是**每一步清空**的（menu-func：t0 按下
   * → `['换list.wav']`、t1 → `[]`，见 bd comments xl-03x.7），所以连着两步
   * 都是同一声，就是**响两次**；背景音乐的 `sync` 在这里会把第二次当空操作。
   */
  it('连着两步同一声就响两次 —— 不是「同一个值反复同步是空操作」', () => {
    const log: string[] = []
    const player = make(log)
    player.play(['click.wav'])
    player.play(['click.wav'])
    expect(log.filter((l) => l === 'sfx play')).toHaveLength(2)
  })

  it('空的一步什么都不做 —— 不是「声明值为空就停」', () => {
    const log: string[] = []
    const player = make(log)
    player.play(['战斗失败.MP3'])
    player.play([])
    player.play([])
    expect(log).toEqual(['sfx src=/战斗失败.MP3.m4a', 'sfx play'])
    expect(player.playing()).toBe('战斗失败.MP3')
  })

  it('一声自己放完了，playing() 回到 null', () => {
    const log: string[] = []
    const created: SfxSound[] = []
    const player = make(log, created)
    player.play(['click.wav'])
    created[0]!.onended!()
    expect(player.playing()).toBeNull()
  })

  /**
   * 原版读数：音效关着时 `readmusic` 一声，播放线程一条都没起；再
   * `openMusic()`，300ms 后仍然一条都没有 —— **关着时的请求直接丢，不补放**。
   */
  it('关着时的请求直接丢，重新打开也不补放', () => {
    const log: string[] = []
    const player = make(log)
    player.setEnabled(false)
    player.play(['click.wav'])
    expect(log).toEqual([])
    expect(player.playing()).toBeNull()
    player.setEnabled(true)
    expect(log).toEqual([])
    expect(player.playing()).toBeNull()
    player.play(['click.wav'])
    expect(log).toEqual(['sfx src=/click.wav.m4a', 'sfx play'])
  })

  it('起手是开着的 —— 原版 CAN_PLAY_MUSIC 初值是 YES', () => {
    expect(make([]).enabled()).toBe(true)
  })

  /**
   * 原版读数：正在响时 `readmusic("不存在的文件.wav")`，`getAudioInputStream`
   * 先抛了，字段还是原来那个流，上一声 500ms 里照样读走 46080 字节 ——
   * **查不到的那一声不顶掉上一声**。（游戏里点过名的都查得到，见
   * `assets/sfxAssets.test.ts`；这一支只在注入的 `resolve` 返回 null 时走到。）
   */
  it('查不到 URL 的那一声不顶掉正在响的那声', () => {
    const log: string[] = []
    const player = createSfxPlayer({
      create: () => fakeSound(log, 'sfx'),
      resolve: (n) => (n === 'click.wav' ? '/click.m4a' : null),
    })
    player.play(['click.wav'])
    player.play(['不存在的文件.wav'])
    expect(log).toEqual(['sfx src=/click.m4a', 'sfx play'])
    expect(player.playing()).toBe('click.wav')
  })

  it('浏览器拦下 play() 时不抛，记成 blocked()', async () => {
    const player = createSfxPlayer({
      create: () => ({ ...fakeSound([], 'sfx'), play: () => Promise.reject(new Error('NotAllowed')) }),
      resolve: (n) => `/${n}.m4a`,
    })
    expect(() => player.play(['click.wav'])).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(player.blocked()).toBe(true)
  })

  it('destroy 停下正在响的那声', () => {
    const log: string[] = []
    const player = make(log)
    player.play(['click.wav'])
    player.destroy()
    expect(log.at(-1)).toBe('sfx pause')
    expect(player.playing()).toBeNull()
  })
})

/**
 * 默认的 `resolve` 走**真的映射表**：`sources/music/` 里每一个文件都解得到一个
 * 指向它自己产物的 URL。分母现扫目录（与 `bakeSfx` 同口径，跳过点文件）。
 */
describe('音效播放器的默认 URL', () => {
  const files = readdirSync(repoPath(SFX_ROOT))
    .filter((f) => !f.startsWith('.'))
    .sort()

  it('源目录不是空的（否则下面这条是空转）', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s 交给播放器的是它自己的产物 URL', (file) => {
    const log: string[] = []
    const player = createSfxPlayer({ create: () => fakeSound(log, 'sfx') })
    player.play([file])
    expect(log[0]).toBe(`sfx src=${resolveAsset(sfxAssetId(file))}`)
    expect(decodeURIComponent(log[0]!)).toContain(sfxProductPath(file))
  })
})
