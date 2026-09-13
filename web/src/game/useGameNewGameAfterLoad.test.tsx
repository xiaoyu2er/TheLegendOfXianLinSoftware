import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareExits } from '../data/loadedScenes'
import { loadScene } from '../data/scenes'
import { getScene } from '../data/scenesEager'
import { resetDrugPack } from '../fakes/drugPack'
import { getParty, initialMember, resetParty } from '../fakes/party'
import { resetWallet } from '../fakes/wallet'
import type { MenuInput } from '../menu/step'
import type { SaveFile } from '../save/format'
import { createMemorySaveStore } from '../save/memoryStore'
import type { SaveStore } from '../save/store'
import type { SaveLoadInput } from '../saveload/step'
import { draftSlots } from '../saveload/test/replayTrace'
import { slotCenter } from '../saveload/world'
import type { SceneRenderer } from '../scene/sceneRenderer'
import { TICK_MS, createWorld } from '../state/step'
import { sceneSourceOf } from '../state/trace'
import type { World } from '../state/types'
import { buttonCenter } from '../test/menuClicks'
import { enemyNamesOf, prepareEnemySprites, resetEnemySprites } from './enemySprites'
import { NO_INPUT, advanceSession, createSession, enterScene, menuWorldOf, openMenu } from './session'
import { useGame } from './useGame'

/**
 * **读档 → 起：哪几样带进新局、哪几样回出厂**（xl-9rv 的裁定，走 `useGame` 那一层）。
 *
 * 原版「起」（`StartPanel.startLoadAction()` case 0）**一样都不清**：`GameLauncher.init()` 那句被
 * 注释掉（xl-lly），读档读回来的等级、身上的装备、剧情三元组、`isLoad` 全部活进「新局」（源码现读
 * 见 `save/test/loadResidueOriginal.test.ts`；JVM 读数只有 xl-i06.11 那一次探针，不入库）。
 * web 的「起」照 xl-lly 的例外回出厂，xl-9rv 裁定**连带的几样一起回**：
 *
 * | 样 | 新局 | 为什么 |
 * |---|---|---|
 * | 等级 / 血 / 经验 | 出厂 | xl-lly 的例外本身 |
 * | 身上的装备 | 默认 | 四项加成算在属性上，与等级绑着：只带装备不带属性，弃用那一下扣成负的 |
 * | 剧情三元组、`isLoad` | 开机值 | 队伍回了出厂，剧情却接着存档里的「比武第二阶段」走，是一局拼起来的游戏 |
 * | 钱 / 药 / 装备库存 / 答题记录 | **带**（照抄原版） | xl-i06.11 已复刻；这里顺带把 `useGame` 那根接线也钉住 |
 *
 * **判据的样子**：开机在宿舍先存一份（槽 2，出厂基线）→ 拨到食堂 → 读 存档0 → 读完立刻存一份
 * （槽 0，上一局）→ 照 `app/App.tsx` 的 `onNewGame` 拨回宿舍并 `restart()` → 新局再存一份（槽 1）。
 * 然后逐样比槽 1 该像槽 2 还是像槽 0。三份都是**产品侧自己存下来的档**，比的是玩家能从存档里读到的
 * 东西；每一样都先钉「槽 0 与槽 2 在这一样上确实不同」，否则「像谁」分不出来。
 *
 * 场景为什么这么挑：新局进**宿舍**、不进脚本1 —— 脚本1 开局就是旁白 + 对话，退出键被挡着开不了菜单
 * （`escGate.test.ts`），存不了档；「起」进的是脚本1 归 `app/appTitle.test.tsx`，与这里的裁定无关。
 * 读档之前拨到**食堂** —— 三份样例存档停的场景（脚本38 / 宿舍 / 商塔道馆一层）与宿舍都没有答题段，
 * 不经过一个有答题段的场景，上一局的答题表就是空的，「带没带进新局」分不出来（这条前提头一版就是
 * 这么红的）。食堂有答题段、开局没有旁白与对话。
 *
 * ⚠️ **弱在哪**：这里只证 web 这一半。原版那一半仍是源码现读 + 一次不入库的探针，要变成入库的
 * 行为真值得先有跨面板导出（xl-x0t）。
 *
 * 单独一个文件：`vi.mock` 按文件生效，`useGame` 的存档仓库是模块级常量（同 `useGameGrab.test.tsx`）。
 */
const rec = vi.hoisted(() => ({ store: null as SaveStore | null }))

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
        write: (i: number, save: Parameters<typeof store.write>[1]) => store.write(i, save),
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

// 仓库在 `useGame` 被 import 时就建了（模块级常量），比这里的顶层语句早，所以 存档0 在用例里写进去。
const [SLOT0] = draftSlots([]) as [SaveFile]

const worlds: World[] = []
const renderer = {
  showScene: async () => {},
  showWorld: (w: World) => {
    worlds.push(w)
  },
  destroy: () => {},
} satisfies SceneRenderer

/** 菜单按钮坐标从一份同样建出来的菜单世界上取（几何是静态的），不写死数字。 */
function menuGeometry() {
  let probe = openMenu(
    enterScene(
      createSession({ scenes: sceneSourceOf(getScene), sprite: () => ({ width: 1, height: 1 }), random: () => 0.5, saves: createMemorySaveStore() }),
      createWorld(getScene('宿舍')),
    ),
  )
  const funcTab = buttonCenter(menuWorldOf(probe)!.tabs.func)
  probe = advanceSession(probe, { ...NO_INPUT, menu: [{ e: 'press', x: funcTab[0], y: funcTab[1] }, { e: 'release', x: funcTab[0], y: funcTab[1] }] }, 0)
  const main = menuWorldOf(probe)!.panels.funcPanel.funcButtons!.main
  return { funcTab, save: buttonCenter(main.saveButton), read: buttonCenter(main.readButton) }
}

/** 场景 JSON、出口目标、怪物出场图都取到手 —— pump 在这三样到齐之前一拍都不推（见 `useGame.ts`）。 */
async function ready(scene: string): Promise<void> {
  const loaded = await loadScene(scene)
  await prepareExits(createWorld(loaded))
  await prepareEnemySprites(enemyNamesOf(loaded))
}

describe('读档 → 起（xl-9rv）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    worlds.length = 0
    resetParty()
    resetWallet()
    resetDrugPack()
    // 存档0 读进的场景有怪；jsdom 里 `Image.decode()` 永远等不到，会话就停在 `spritesReady` 那道门前
    // 一拍都不推（同 `useGame.test.tsx`「战斗里按 J」）。尺寸只影响战斗里的点击范围，这里一下都不点。
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        naturalWidth = 1
        naturalHeight = 1
        decode() {
          return Promise.resolve()
        }
      },
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetEnemySprites()
    vi.useRealTimers()
  })

  it('等级、身上的装备、剧情三元组、isLoad 回出厂；钱、药、装备库存、答题记录带进新局', async () => {
    const START = '宿舍'
    const QUIZ = '食堂'
    await ready(START)
    const { result, rerender } = renderHook(({ scene }) => useGame(renderer, scene), { initialProps: { scene: START } })
    await act(async () => {
      await ready(START)
    })
    expect(rec.store, '存档仓库不是这份记账仓库 —— mock 没生效').not.toBeNull()
    rec.store!.write(0, SLOT0)
    expect(rec.store!.read(0), '槽 0 没放进 存档0 —— 下面读的是空档').toEqual(SLOT0)

    const { funcTab, save, read } = menuGeometry()
    const tick = (n = 1) =>
      act(() => {
        vi.advanceTimersByTime(n * TICK_MS)
      })
    const at = ([x, y]: [number, number]) => ({ x, y })
    const click = (p: [number, number]) => {
      const inputs: MenuInput[] = [{ e: 'press', ...at(p) }, { e: 'release', ...at(p) }]
      for (const i of inputs) result.current.menuInput(i)
      tick()
    }
    const slot = (i: number) => {
      const inputs: SaveLoadInput[] = [{ e: 'press', ...slotCenter(i) }, { e: 'release', ...slotCenter(i) }]
      for (const x of inputs) result.current.lsInput(x)
      tick()
    }
    const escape = () => {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      })
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' }))
      })
      tick()
    }
    /** 场景里按 ESC 开菜单 → 天书页 → `button`，面板翻到存读档。 */
    const openLs = (button: [number, number]) => {
      expect(result.current.panel).toBe('scene')
      escape()
      expect(result.current.panel).toBe('menu')
      click(funcTab)
      click(button)
      expect(result.current.panel).toBe('ls')
    }
    /** 存进槽 `i`，ESC 回菜单。 */
    const saveTo = (i: number) => {
      openLs(save)
      slot(i)
      escape()
      expect(result.current.panel).toBe('menu')
    }
    /** 换场景：`sceneName` 一变，建会话的 effect 重跑（带着 `carryIntoNewGame`）。 */
    const goTo = async (scene: string, restart = false) => {
      act(() => {
        rerender({ scene })
        if (restart) result.current.restart()
      })
      await act(async () => {
        await ready(scene)
      })
      tick()
      expect(result.current.scene).toBe(scene)
      expect(result.current.panel).toBe('scene')
    }
    const lastWorld = () => worlds.at(-1)!

    // ——— 出厂基线：开机就在宿舍存一份（槽 2）———
    tick()
    saveTo(2)
    const boot = rec.store!.read(2)!
    const bootWorld = lastWorld()

    // ——— 拨到食堂，读 存档0 ———
    await goTo(QUIZ)
    openLs(read)
    slot(0)
    const notice = result.current.saveLoad
    expect(notice !== null && 'loadRequest' in notice ? notice.loadRequest : null, '点中的不是槽 0').toBe(0)
    // 点槽那一拍只记槽号；pump 下一拍才发起取场景（`.then(rememberScene)`），再下一拍才 `loadGame`。
    // 同步的 `tick` 冲不掉 promise，所以中间要 await 一次。
    tick()
    const target = SLOT0.scene.fileName.replace(/\.txt$/, '')
    await act(async () => {
      await ready(target)
    })
    tick(3)
    expect(result.current.scene, '读档没落地').toBe(target)
    expect(getParty().zhang.level, '读回来的等级').toBe(SLOT0.heroes.zhangXiaoFan.level)
    const loadedWorld = lastWorld()
    expect(loadedWorld.isLoad, '读档之后 isLoad 该是真的 —— 下面那条「回到假」就分不出来').toBe(true)

    // ——— 读完立刻存一份（槽 0 = 上一局）———
    saveTo(0)
    const prev = rec.store!.read(0)!

    // ——— 起：`app/App.tsx` 的 `onNewGame` 那两句，`setSceneName(START_SCENE)` + `restart()` ———
    await goTo(START, true)
    const newWorld = lastWorld()
    saveTo(1)
    const next = rec.store!.read(1)!

    // ——— 回出厂的那几样：槽 1 像槽 2，而槽 0 与槽 2 在这一样上确实不同 ———
    expect(prev.heroes, '前提：读回来的等级与出厂相同，「回出厂」分不出来').not.toEqual(boot.heroes)
    expect(next.heroes).toEqual(boot.heroes)
    expect(getParty().zhang).toEqual(initialMember('zhang'))

    expect(prev.worn, '前提：存档0 身上的装备与默认相同').not.toEqual(boot.worn)
    expect(next.worn, '身上的装备活过了「起」—— 属性却回了出厂，弃用会扣成负的').toEqual(boot.worn)

    expect(prev.scene.currentScript, '前提：存档0 的剧情三元组与开机相同').not.toEqual(boot.scene.currentScript)
    expect(next.scene.currentScript, '「新局」的剧情接着存档里的走').toEqual(boot.scene.currentScript)
    expect(newWorld.currentScript).toEqual(bootWorld.currentScript)

    expect(newWorld.isLoad, 'isLoad 活过了「起」').toBe(false)

    // ——— 带进新局的那几样：槽 1 像槽 0，而槽 0 与槽 2 在这一样上确实不同 ———
    expect(prev.coins, '前提：存档0 的钱与出厂相同').not.toBe(boot.coins)
    expect(next.coins).toBe(prev.coins)
    expect(prev.drugs, '前提：存档0 的药与出厂相同').not.toEqual(boot.drugs)
    expect(next.drugs).toEqual(prev.drugs)

    // 答题记录：读档不回填它（`NeverReadBack`），上一局那份是读档前的世界（食堂登记过的）。宿舍自己
    // 没有答题段，所以新局里有食堂那一条，只可能是 `useGame` 把 `carry.recorder` 交给了新世界。
    expect(prev.neverReadBack.questionMaps, '前提：上一局的答题表与开机相同').not.toEqual(boot.neverReadBack.questionMaps)
    expect(next.neverReadBack).toEqual(prev.neverReadBack)
  })
})
