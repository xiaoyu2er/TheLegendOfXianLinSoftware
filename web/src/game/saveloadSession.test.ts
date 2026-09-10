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
import {
  NO_INPUT,
  advanceSession,
  createSession,
  enterSaveLoad,
  enterScene,
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
