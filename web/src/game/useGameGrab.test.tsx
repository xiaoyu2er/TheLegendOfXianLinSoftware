import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareExits } from '../data/loadedScenes'
import { loadScene } from '../data/scenes'
import { getScene } from '../data/scenesEager'
import type { MenuInput } from '../menu/step'
import { createMemorySaveStore } from '../save/memoryStore'
import type { SaveStore } from '../save/store'
import type { SaveLoadInput } from '../saveload/step'
import { draftSlots } from '../saveload/test/replayTrace'
import { slotCenter } from '../saveload/world'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { TICK_MS, createWorld } from '../state/step'
import { sceneSourceOf } from '../state/trace'
import { buttonCenter } from '../test/menuClicks'
import { NO_INPUT, advanceSession, createSession, enterScene, menuWorldOf, openMenu } from './session'
import { useGame } from './useGame'

/**
 * `useGame` 那一层的 mouse grab（xl-o9z）：**松手按「按下时那个面板」派，不按当前面板**。
 *
 * 会话层的判据（`saveloadSession.test.ts`）证的是「送到了就办」；这里证的是 pump 真的
 * 把它送到了、而且只送给该送的那个。两个方向，后果都落在**存档仓库写了哪几个槽**上 ——
 * 这是玩家看得见的那一层，所以仓库换成一份记账的内存仓库。
 *
 * 单独一个文件：`vi.mock` 按文件生效，`useGame` 的仓库又是模块级常量（开机就建），
 * 混进 `useGame.test.tsx` 会让那边每条用例共用这一份记账仓库。
 */
const rec = vi.hoisted(() => ({ writes: [] as number[], store: null as SaveStore | null }))

vi.mock('../save/browserStore', async () => {
  const { createMemorySaveStore: memory } = await import('../save/memoryStore')
  return {
    indexedDbBackend: () => ({}),
    createBrowserSaveStore: () => {
      const store = memory()
      rec.store = store
      return {
        status: () => store.status(),
        error: () => store.error(),
        read: (i: number) => store.read(i),
        write: (i: number, save: Parameters<typeof store.write>[1]) => {
          rec.writes.push(i)
          store.write(i, save)
        },
        persistError: () => store.persistError(),
        whenLoaded: async () => {},
        flush: async () => {},
      }
    },
  }
})

vi.mock('../audio/bgmPlayer', () => ({
  createBgmPlayer: () => ({ sync: () => {}, playing: () => null, blocked: () => false, destroy: () => {} }),
}))

const renderer = { showScene: async () => {}, showWorld: () => {}, destroy: () => {} } satisfies SceneRenderer

/** 菜单按钮坐标从一份同样建出来的菜单世界上取（几何是静态的），不写死数字。 */
function menuGeometry() {
  let probe = openMenu(
    enterScene(
      createSession({
        scenes: sceneSourceOf(getScene),
        sprite: () => ({ width: 1, height: 1 }),
        random: () => 0.5,
        saves: createMemorySaveStore(),
      }),
      createWorld(getScene('宿舍')),
    ),
  )
  const funcTab = buttonCenter(menuWorldOf(probe)!.tabs.func)
  probe = advanceSession(probe, { ...NO_INPUT, menu: [{ e: 'press', x: funcTab[0], y: funcTab[1] }, { e: 'release', x: funcTab[0], y: funcTab[1] }] }, 0)
  return { funcTab, save: buttonCenter(menuWorldOf(probe)!.panels.funcPanel.funcButtons!.main.saveButton) }
}

describe('useGame 的 mouse grab（xl-o9z）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('按着槽位按退出键回菜单，下一拍的松手照样送回存读档面板；菜单上按下「存档」的松手不送给存读档面板', async () => {
    await prepareExits(createWorld(await loadScene('宿舍')))
    const { result } = renderHook(() => useGame(renderer, '宿舍'))
    await act(async () => {
      await loadScene('宿舍')
    })
    const { funcTab, save } = menuGeometry()
    const tick = () =>
      act(() => {
        vi.advanceTimersByTime(TICK_MS)
      })
    const menu = (...inputs: MenuInput[]) => {
      for (const i of inputs) result.current.menuInput(i)
      tick()
    }
    const ls = (...inputs: SaveLoadInput[]) => {
      for (const i of inputs) result.current.lsInput(i)
      tick()
    }
    const escape = () => {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      })
      tick()
    }
    const at = ([x, y]: [number, number]) => ({ x, y })
    const openSave = () => {
      menu({ e: 'press', ...at(save) }, { e: 'release', ...at(save) })
      expect(result.current.panel).toBe('ls')
    }
    rec.writes.length = 0

    escape()
    menu({ e: 'press', ...at(funcTab) }, { e: 'release', ...at(funcTab) })
    openSave()

    // ——— 方向一：在存读档面板上按下，面板被退出键切走，松手落在下一拍 ———
    ls({ e: 'press', ...slotCenter(0) })
    escape()
    expect(result.current.panel).toBe('menu')
    expect(rec.writes, '只按下就存了 —— 下面那条恒真').toEqual([])
    ls({ e: 'release', ...slotCenter(0) })
    expect(rec.writes, '下一拍的松手没送回存读档面板 —— 原版这一下当场存进槽 0').toEqual([0])

    // ——— 方向二：菜单上按下「存档」，面板翻到存读档，松手归菜单 ———
    // 先照原版造一颗粘着的槽：在槽 1 上按下、拖出去再松手 —— `setButton()` 存了，
    // 而松手不在框里，`isclicked` 清不掉（`saveload/step.ts` 的 release 注释）。存几遍
    // 不写死：每进一次面板多挂一对监听器（`changeStateTo` 里的 `setMouse()`），每一对
    // 各存一遍，那是照抄的原版。
    openSave()
    ls({ e: 'press', ...slotCenter(1) }, { e: 'release', x: 0, y: 0 })
    const sticky = [...rec.writes]
    expect(sticky.slice(0, 1)).toEqual([0])
    expect(sticky.slice(1).length, '拖出去松手一遍都没存').toBeGreaterThan(0)
    expect(new Set(sticky.slice(1))).toEqual(new Set([1]))
    escape()
    expect(result.current.panel).toBe('menu')

    menu({ e: 'press', ...at(save) })
    expect(result.current.panel, '按下「存档」那一拍就该进存读档面板').toBe('ls')
    // 松手落在刚露出来的存读档宿主上。grab 属于菜单：两个入口都送一遍，只许菜单收。
    result.current.lsInput({ e: 'release', ...at(save) })
    result.current.menuInput({ e: 'release', ...at(save) })
    tick()
    expect(rec.writes, '菜单上按下的松手送给了存读档面板 —— 粘着的槽 1 被多存了').toEqual(sticky)

    // 反向控制：槽 1 真的粘着 —— 在槽 2 上点一下，原版 `setButton()` 连带把槽 1 再存一遍。
    // 不然上面那条「没多存」与「根本没粘住」长得一样。
    ls({ e: 'press', ...slotCenter(2) }, { e: 'release', ...slotCenter(2) })
    const after = rec.writes.slice(sticky.length)
    expect(after, '槽 2 没点着').toContain(2)
    expect(after, '槽 1 根本没粘住，上面那条恒真').toContain(1)

    // ——— 和弦（xl-4xi）：两次按下、两次松手，第二次松手也归存读档面板 ———
    // 在槽 2 上按下两次（左键再右键），两次松手都在框外。槽 1 还粘着（上面刚证过），
    // 每一次送到这块面板的松手都会让 `setButton()` 连带把它再存一遍 —— grab 在第一次
    // 松手就解除的话，第二次被丢掉，一遍都不多存。
    const beforeChord = rec.writes.length
    ls({ e: 'press', ...slotCenter(2) }, { e: 'press', ...slotCenter(2) }, { e: 'release', x: 0, y: 0 })
    const afterFirst = rec.writes.length
    expect(rec.writes.slice(beforeChord), '和弦里第一次松手一遍都没存').toContain(1)
    ls({ e: 'release', x: 0, y: 0 })
    expect(rec.writes.slice(afterFirst), '和弦里的第二次松手没送到存读档面板').toContain(1)
    // 两次都松完了，grab 解除：再来一次松手不归任何人。
    const settled = rec.writes.length
    ls({ e: 'release', x: 0, y: 0 })
    expect(rec.writes.length, 'grab 该解除了，多出来的松手还是送到了').toBe(settled)
  })

  /**
   * 没开局的那条路：标题「承」进来的存读档面板，按着槽位按退出键回标题，松手落在下一拍。
   * 这时 pump 走的是「还没开局」那一段 —— 它原先只在面板是 `ls` 时推，藏着就一拍都不推，
   * 那一下松手于是在队列里躺到下次进面板。原版这一下当场读档、`switchTo("scene")`。
   */
  it('没开局：标题「承」进来、按着槽位按退出键回标题，下一拍的松手照样读档进场景', async () => {
    const sample = draftSlots([])[0]!
    const { result } = renderHook(() => useGame(renderer, null))
    rec.store!.write(0, sample)
    const tick = () =>
      act(() => {
        vi.advanceTimersByTime(TICK_MS)
      })
    const ls = (...inputs: SaveLoadInput[]) => {
      for (const i of inputs) result.current.lsInput(i)
      tick()
    }

    act(() => result.current.openLoad())
    tick()
    expect(result.current.panel).toBe('ls')
    ls({ e: 'press', ...slotCenter(0) })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    tick()
    tick()
    expect(result.current.panel, '只按下就读了 —— 下面那条恒真').toBe('start')
    expect(result.current.scene).toBeNull()

    ls({ e: 'release', ...slotCenter(0) })
    // 读档先把要进的场景取到手，取到的那一拍才 `loadGame`（`Session.loadRequest`）：
    // 松手那一拍只记了槽号，下一拍 pump 才开始取，等它取完再推一拍。
    // 看的是**场景名**而不是 `panel`：`loadGame` 之后 pump 还要等新场景的出口邻居到齐
    // 才 `syncPanel`，而 `setScene` 在那道门之前 —— 它变了就是这一下读进去了。
    const name = sample.scene.fileName.replace(/\.txt$/, '')
    tick()
    await act(async () => {
      await loadScene(name)
    })
    tick()
    expect(result.current.scene, '回到标题之后的松手没送回存读档面板 —— 原版这一下当场读档进场景').toBe(name)
  })
})
