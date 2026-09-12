import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareExits } from '../data/loadedScenes'
import { loadScene } from '../data/scenes'
import { getScene } from '../data/scenesEager'
import type { MenuInput } from '../menu/step'
import { createMemorySaveStore } from '../save/memoryStore'
import type { SaveLoadInput } from '../saveload/step'
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
const rec = vi.hoisted(() => ({ writes: [] as number[] }))

vi.mock('../save/browserStore', async () => {
  const { createMemorySaveStore: memory } = await import('../save/memoryStore')
  return {
    indexedDbBackend: () => ({}),
    createBrowserSaveStore: () => {
      const store = memory()
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
  })
})
