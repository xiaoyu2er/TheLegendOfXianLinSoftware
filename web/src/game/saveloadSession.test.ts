import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { resetParty } from '../fakes/party'
import { createBrowserSaveStore } from '../save/browserStore'
import type { SaveBackend } from '../save/browserStore'
import { serializeSave } from '../save/format'
import { createMemorySaveStore } from '../save/memoryStore'
import type { SaveStore } from '../save/store'
import { draftSlots } from '../saveload/test/replayTrace'
import type { SaveLoadInput } from '../saveload/step'
import { slotCenter } from '../saveload/world'
import { createWorld } from '../state/step'
import { sceneSourceOf } from '../state/trace'
import { buttonCenter } from '../test/menuClicks'
import type { MenuInput } from '../menu/step'
import { getAudioSettings, rememberAudioSettings, resetAudioSettings } from './audioSettings'
import {
  NO_INPUT,
  advanceSession,
  createSession,
  enterSaveLoad,
  enterScene,
  loadGame,
  menuWorldOf,
  openMenu,
  saveLoadViewOf,
} from './session'
import type { RunningSession, Session } from './session'

/**
 * 存读档面板接进会话（xl-i06.9）：三个入口、退出键、存进去、读档交棒、就绪标志。
 *
 * ⚠️ 这一段**没有行为真值**：saveload 真值从 `enter` 起、到读档那一下为止，
 * 「菜单上哪颗按钮通到这里」「退出之后落在哪个会话状态上」都不在里面。面板内部
 * 的行为逐步对着真值（`saveload/saveloadTrace.test.ts`），这里只守接线。
 */
const SAMPLE = draftSlots([])[0]!

function deps(saves: SaveStore) {
  return { scenes: sceneSourceOf(getScene), sprite: () => ({ width: 1, height: 1 }), random: () => 0.5, saves }
}

function inScene(saves: SaveStore): RunningSession {
  resetParty()
  return enterScene(createSession(deps(saves)), createWorld(getScene('脚本1')))
}

const menuClick = (x: number, y: number): MenuInput[] => [
  { e: 'press', x, y },
  { e: 'release', x, y },
]

const slot = slotCenter
const slotClick = (i: number): SaveLoadInput[] => [
  { e: 'press', ...slot(i) },
  { e: 'release', ...slot(i) },
]
const ESC: SaveLoadInput[] = [{ e: 'key', key: 'escape' }]

function ls<S extends Session>(s: S, input: readonly SaveLoadInput[]): S {
  return advanceSession(s, { ...NO_INPUT, saveload: input }, 0) as S
}

/** 从场景按 ESC 进菜单、翻到天书页、点 `which` 那颗。 */
function viaMenu(s: RunningSession, which: 'saveButton' | 'readButton'): RunningSession {
  s = openMenu(s)
  s = advanceSession(s, { ...NO_INPUT, menu: menuClick(...buttonCenter(menuWorldOf(s)!.tabs.func)) }, 0)
  const b = menuWorldOf(s)!.panels.funcPanel.funcButtons!.main[which]
  return advanceSession(s, { ...NO_INPUT, menu: menuClick(...buttonCenter(b)) }, 0)
}

/** 照原样转给 `store`，另外按先后记下写过哪几个槽 —— 「连带多存了一个槽」只有这里看得见。 */
function recording(store: SaveStore): { store: SaveStore; writes: number[] } {
  const writes: number[] = []
  return {
    writes,
    store: {
      status: () => store.status(),
      error: () => store.error(),
      read: (i) => store.read(i),
      write: (i, save) => {
        writes.push(i)
        store.write(i, save)
      },
      persistError: () => store.persistError(),
    },
  }
}

function ready(s: Session) {
  const v = saveLoadViewOf(s)
  if (v?.status !== 'ready') throw new Error(`存读档面板不是 ready：${JSON.stringify(v)}`)
  return v
}

describe('菜单 → 存读档面板 → 菜单', () => {
  it('「存档」进来：mode=save、lastPanel=menu；点空槽 1 存进去，摘要当场是这一局的地图', () => {
    const store = createMemorySaveStore()
    let s = viaMenu(inScene(store), 'saveButton')
    expect(s.panel).toBe('ls')
    expect(ready(s).world).toMatchObject({ mode: 'save', lastPanel: 'menu', maps: ['无', '无', '无'] })

    s = ls(s, slotClick(1))
    expect(store.read(1)).not.toBeNull()
    expect(ready(s).world.maps[1]).toBe(s.scene.world.readerStatics.mapName)
    expect(ready(s).world.maps[1]).not.toBe('无')

    s = ls(s, ESC)
    expect(s.panel).toBe('menu')
    // 信号收掉了：再推一拍菜单不会自己又跳回存读档面板。
    s = advanceSession(s, NO_INPUT, 0)
    expect(s.panel).toBe('menu')
  })

  it('再点「提取」：面板世界不重建（只置不清的那份记忆活着），点非空槽只记下槽号、面板先不切（读进来见 loadSession.test.ts）', () => {
    const store = createMemorySaveStore()
    let s = viaMenu(inScene(store), 'saveButton')
    const first = s.saveload
    s = ls(s, slotClick(0))
    s = ls(s, ESC)
    s = advanceSession(s, { ...NO_INPUT, menu: menuClick(...buttonCenter(menuWorldOf(s)!.panels.funcPanel.funcButtons!.main.readButton)) }, 0)
    expect(s.panel).toBe('ls')
    expect(s.saveload).toBe(first)
    expect(ready(s).world).toMatchObject({ mode: 'load', listeners: 3 })

    s = ls(s, slotClick(2)) // 空槽：什么都不发生
    expect(s.loadRequest).toBeNull()
    s = ls(s, slotClick(0))
    expect(s.loadRequest).toBe(0)
    expect(s.panel).toBe('ls')
  })
})

describe('标题「承」→ 存读档面板（还没开局）', () => {
  it('进来 mode=load、lastPanel=start；退出键回标题，场景仍然没建', () => {
    let s: Session = enterSaveLoad(createSession(deps(createMemorySaveStore([SAMPLE]))), 'load', 'start')
    expect(s.panel).toBe('ls')
    expect(ready(s).world).toMatchObject({ mode: 'load', lastPanel: 'start' })
    s = ls(s, ESC)
    expect(s.panel).toBe('start')
    expect(s.scene).toBeNull()
  })

  it('点非空槽只记下槽号（读进来见 loadSession.test.ts）', () => {
    const s = ls(enterSaveLoad(createSession(deps(createMemorySaveStore([SAMPLE]))), 'load', 'start'), slotClick(0))
    expect(s.loadRequest).toBe(0)
    expect(s.panel).toBe('ls')
  })
})

describe('就绪标志：没读上来时不画三个空槽', () => {
  function gated(disk: (string | null)[]) {
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    const backend: SaveBackend = {
      async loadAll() {
        await gate
        return [...disk]
      },
      async save() {},
    }
    return { store: createBrowserSaveStore(backend), open }
  }

  it('盘上有档但还没读上来：视图是 loading，与「读上来了、确实是空的」不同；点击不算、就绪那一拍补上', async () => {
    const { store, open } = gated([serializeSave(SAMPLE), null, null])
    let s: Session = enterSaveLoad(createSession(deps(store)), 'load', 'start')
    expect(s.panel).toBe('ls')
    expect(saveLoadViewOf(s)).toEqual({ status: 'loading' })
    s = ls(s, slotClick(0))
    expect(s.loadRequest).toBeNull()

    const empty = enterSaveLoad(createSession(deps(createMemorySaveStore())), 'load', 'start')
    expect(saveLoadViewOf(empty)!.status).toBe('ready')
    expect(saveLoadViewOf(s)).not.toEqual(saveLoadViewOf(empty))

    open()
    await store.whenLoaded()
    s = ls(s, [])
    expect(ready(s).world).toMatchObject({ mode: 'load', lastPanel: 'start' })
    expect(ready(s).world.maps[0]).toBe(SAMPLE.summary.mapName)
  })

  it('没读上来时退出键照样回得去', () => {
    const { store } = gated([])
    let s: Session = enterSaveLoad(createSession(deps(store)), 'load', 'start')
    s = ls(s, ESC)
    expect(s.panel).toBe('start')
    expect(s.lsEntry).toBeNull()
  })

  /**
   * 退出键回标题走的是 `returnToLastPanel()` → `switchTo(lastPanel)`，`lastPanel` 是
   * `"start"` 时就是那一支 —— 末尾那句 `MusicReader.openBGM()` 照样执行（xl-03x.21）。
   *
   * ⚠️ 玩家今天走不到「标题上开关是关着的」：回标题的每一条路都会把它拨开。这里直接
   * 改开关，守的是**这一支也是 `switchTo("start")`**，不是一条玩家走得到的路。
   * 就绪与没就绪两支各走一遍 —— 它们在 `stepSaveLoad` 里是两段代码。
   */
  it('退出键回标题也把背景音乐开关拨回「开」（就绪、没就绪两支）', () => {
    const seen: Record<string, unknown> = {}
    try {
      for (const [name, store] of [
        ['ready', createMemorySaveStore([SAMPLE])],
        ['loading', gated([]).store],
      ] as const) {
        rememberAudioSettings({ bgm: false, sfx: false })
        let s: Session = enterSaveLoad(createSession(deps(store)), 'load', 'start')
        s = ls(s, ESC)
        seen[name] = { panel: s.panel, audio: getAudioSettings() }
      }
    } finally {
      resetAudioSettings()
    }
    const back = { panel: 'start', audio: { bgm: true, sfx: false } }
    expect(seen).toEqual({ ready: back, loading: back })
  })

  it('从菜单进来、退出键回菜单：不拨背景音乐开关（`switchTo("menu")` 没有那一句）', () => {
    try {
      const store = createMemorySaveStore()
      let s = viaMenu(inScene(store), 'readButton')
      rememberAudioSettings({ bgm: false, sfx: true })
      s = ls(s, ESC)
      expect(s.panel).toBe('menu')
      expect(getAudioSettings()).toEqual({ bgm: false, sfx: true })
    } finally {
      resetAudioSettings()
    }
  })

  it('读不上来（failed）：视图说 failed 并带着原因，点击不抛、不算，退出键回得去', async () => {
    const store = createBrowserSaveStore({
      loadAll: () => Promise.reject(new Error('这个环境没有 IndexedDB')),
      save: async () => {},
    })
    await store.whenLoaded()
    let s: Session = enterSaveLoad(createSession(deps(store)), 'load', 'start')
    const v = saveLoadViewOf(s)
    expect(v).toMatchObject({ status: 'failed' })
    expect(v?.status === 'failed' && v.error?.message).toMatch(/IndexedDB/)
    s = ls(s, slotClick(0))
    expect(s.panel).toBe('ls')
    expect(s.loadRequest).toBeNull()
    s = ls(s, ESC)
    expect(s.panel).toBe('start')
  })

  it('落盘失败（persistError）面板上读得到：快照已经是新的，浏览器存储没写进去', async () => {
    const store = createBrowserSaveStore({
      loadAll: async () => [],
      save: () => Promise.reject(new Error('QuotaExceededError')),
    })
    await store.whenLoaded()
    let s = viaMenu(inScene(store), 'saveButton')
    expect(ready(s).persistError).toBeNull()
    s = ls(s, slotClick(1))
    await store.flush()
    expect(ready(s).world.maps[1]).not.toBe('无')
    expect(ready(s).persistError?.message).toMatch(/QuotaExceeded/)
  })
})

/**
 * 按住一个槽不放、按退出键切走面板、再松手（xl-o9z，xl-z4f 的同形）。
 *
 * 原版的松手按 Swing 的 grab 派给**按下时**那个组件，不看它还显不显示（读数在
 * `session.ts` 菜单那一段）。`LoadAndSavePanel.mouseReleased` 于是照样跑：先
 * `setButton()`（存档就当场存、读档就当场读并 `switchTo("scene")`），再
 * `isRelesedButton` 把 `isclicked` 清掉。丢了这一下，那颗槽的 `isclicked` 就粘着 ——
 * 下次进面板随便在哪松一次手，`setButton()` 都会连带把它再存 / 读一遍。
 *
 * 会话层只管「收到了就交给那一份面板世界」；哪些事件归它，由送的人按 grab 定
 * （`useGame` 的 `grabRef`），这里不猜。
 */
describe('按着槽位退出面板，松手落在面板藏起来之后（xl-o9z）', () => {
  const press = (i: number): SaveLoadInput[] => [{ e: 'press', ...slot(i) }]
  const release = (i: number): SaveLoadInput[] => [{ e: 'release', ...slot(i) }]

  it('存档：松手照样交给藏着的面板 —— 当场存进去、isclicked 清掉；再进来点别的槽不连带', () => {
    const { store, writes } = recording(createMemorySaveStore())
    let s = viaMenu(inScene(store), 'saveButton')
    s = ls(s, press(0))
    s = ls(s, ESC)
    expect(s.panel).toBe('menu')
    // 反向控制：松手之前真的按着、而且还没存 —— 否则下面两条恒真。
    expect(s.saveload!.buttons[0]!.isclicked, '按下没按着槽 0').toBe(true)
    expect(writes, '只按下就存了').toEqual([])

    s = ls(s, release(0))
    expect(s.panel, '藏着的面板收了松手，面板却切了').toBe('menu')
    expect(writes, '松手没交给藏着的存读档面板 —— 原版这一下当场存进槽 0').toEqual([0])
    expect(s.saveload!.buttons[0]!.isclicked, '槽 0 的 isclicked 粘着').toBe(false)

    s = advanceSession(
      s,
      { ...NO_INPUT, menu: menuClick(...buttonCenter(menuWorldOf(s)!.panels.funcPanel.funcButtons!.main.saveButton)) },
      0,
    )
    expect(s.panel).toBe('ls')
    s = ls(s, slotClick(1))
    expect(writes, '点槽 1 连带又存了一遍槽 0').toEqual([0, 1])
  })

  it('读档：松手照样交给藏着的面板 —— 原版当场读档、switchTo("scene")', () => {
    let s = viaMenu(inScene(createMemorySaveStore([SAMPLE])), 'readButton')
    s = ls(s, press(0))
    s = ls(s, ESC)
    expect(s.panel).toBe('menu')
    expect(s.loadRequest, '只按下就读了').toBeNull()

    s = ls(s, release(0))
    expect(s.loadRequest, '松手没交给藏着的存读档面板 —— 原版这一下当场读槽 0').toBe(0)
    expect(loadGame(s).panel).toBe('scene')
  })

  it('标题「承」进来、退回标题之后松手 —— 还没开局也送得到', () => {
    let s: Session = enterSaveLoad(createSession(deps(createMemorySaveStore([SAMPLE]))), 'load', 'start')
    s = ls(s, press(0))
    s = ls(s, ESC)
    expect(s.panel).toBe('start')
    expect(s.loadRequest).toBeNull()

    s = ls(s, release(0))
    expect(s.loadRequest, '没开局时藏着的存读档面板收不到松手').toBe(0)
  })
})
