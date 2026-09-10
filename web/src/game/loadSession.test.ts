import { describe, expect, it } from 'vitest'
import { DRUGS } from '../battle/drugs'
import { getScene } from '../data/scenesEager'
import { drugCount, resetDrugPack } from '../fakes/drugPack'
import { getParty, resetParty } from '../fakes/party'
import { getCoins, resetWallet } from '../fakes/wallet'
import { createMemorySaveStore } from '../save/memoryStore'
import type { SaveStore } from '../save/store'
import { draftSlots } from '../saveload/test/replayTrace'
import type { SaveLoadInput } from '../saveload/step'
import { slotCenter } from '../saveload/world'
import { roleTileX, roleTileY } from '../state/role'
import { createWorld } from '../state/step'
import { sceneSourceOf } from '../state/trace'
import { buttonCenter } from '../test/menuClicks'
import type { MenuInput } from '../menu/step'
import {
  NO_INPUT,
  advanceSession,
  applyReadBack,
  createSession,
  enterSaveLoad,
  enterScene,
  loadGame,
  loadTargetOf,
  menuWorldOf,
  openMenu,
  saveLoadViewOf,
} from './session'
import type { RunningSession, Session } from './session'

/**
 * 读档那条重建路径接进会话（xl-i06.10）。
 *
 * 读进来之后**逐 tick 对齐真值**的那一半在 `state/traceReplay.test.ts`（`load-slot*` 三份，
 * 走的就是这里的 `applyReadBack`）。这里守的是真值看不见的接线：面板那一下与 `loadGame`
 * 之间的空当、读档前的值从哪来、读一半到底读了哪一半。
 *
 * ⚠️ 这些用例弱在哪：它们证明的是「我们的会话这么做」，原版那一头靠上面那份真值与
 * `save/test/loaderReadBack.test.ts` 的源码现读。
 */
const SAMPLE = draftSlots([])[0]!

function deps(saves: SaveStore) {
  return { scenes: sceneSourceOf(getScene), sprite: () => ({ width: 1, height: 1 }), random: () => 0.5, saves }
}

function fresh(): void {
  resetParty()
  resetWallet()
  resetDrugPack()
}

const slotClick = (i: number): SaveLoadInput[] => [
  { e: 'press', ...slotCenter(i) },
  { e: 'release', ...slotCenter(i) },
]
const ESC: SaveLoadInput[] = [{ e: 'key', key: 'escape' }]
const menuClick = (x: number, y: number): MenuInput[] => [
  { e: 'press', x, y },
  { e: 'release', x, y },
]

function ls<S extends Session>(s: S, input: readonly SaveLoadInput[]): S {
  return advanceSession(s, { ...NO_INPUT, saveload: input }, 0) as S
}

/** 标题「承」→ 点槽 0。 */
function pickedFromTitle(): Session {
  fresh()
  return ls(enterSaveLoad(createSession(deps(createMemorySaveStore([SAMPLE]))), 'load', 'start'), slotClick(0))
}

/** 开了一局（脚本1），从菜单天书页「提取」进面板，点槽 0。 */
function pickedFromMenu(world = createWorld(getScene('脚本1'))): RunningSession {
  fresh()
  let s = enterScene(createSession(deps(createMemorySaveStore([SAMPLE]))), world)
  s = openMenu(s)
  s = advanceSession(s, { ...NO_INPUT, menu: menuClick(...buttonCenter(menuWorldOf(s)!.tabs.func)) }, 0)
  const b = menuWorldOf(s)!.panels.funcPanel.funcButtons!.main.readButton
  s = advanceSession(s, { ...NO_INPUT, menu: menuClick(...buttonCenter(b)) }, 0)
  return ls(s, slotClick(0))
}

describe('面板那一下与 loadGame 之间', () => {
  it('点非空槽：面板先不切，loadTargetOf 说要读进哪个场景', () => {
    const s = pickedFromTitle()
    expect(s.panel).toBe('ls')
    expect(s.loadRequest).toBe(0)
    expect(loadTargetOf(s)).toBe(SAMPLE.scene.fileName)
    expect(saveLoadViewOf(s)).toMatchObject({ status: 'ready', loadRequest: 0 })
  })

  it('空当里面板不再收输入：原版那一下已经在场景里了，退出键回不去标题', () => {
    const s = ls(pickedFromTitle(), ESC)
    expect(s.panel).toBe('ls')
    expect(s.loadRequest).toBe(0)
  })

  it('没有待读的档时 loadTargetOf 是 null，loadGame 是抛', () => {
    fresh()
    const s = createSession(deps(createMemorySaveStore([SAMPLE])))
    expect(loadTargetOf(s)).toBeNull()
    expect(() => loadGame(s)).toThrow(/loadRequest/)
  })

  it('场景没取到手就读档是抛，不是建一个空世界', () => {
    const s = pickedFromTitle()
    const blind = { ...s, deps: { ...s.deps, scenes: () => undefined } }
    expect(() => loadGame(blind)).toThrow(/还没取到手/)
  })
})

describe('loadGame：进度真的回来了', () => {
  it('开机读档：回到存档时那个场景、那一格，面板切到场景，悬着的槽号清掉', () => {
    const s = loadGame(pickedFromTitle())
    expect(s.panel).toBe('scene')
    expect(s.loadRequest).toBeNull()
    expect(s.scene.world.scene).toBe(SAMPLE.scene.fileName)
    expect([roleTileX(s.scene.world.role), roleTileY(s.scene.world.role)]).toEqual([SAMPLE.scene.x, SAMPLE.scene.y])
    expect(s.scene.world.narratage.over).toBe(true)
    expect(s.scene.world.sceneSignal).toBe(true)
  })

  it('三个角色的等级、血、灵力、怒气与经验，身上的武器，药与钱，都是存档里的', () => {
    const s = loadGame(pickedFromTitle())
    const party = getParty()
    expect(party.zhang).toMatchObject({ ...SAMPLE.heroes.zhangXiaoFan })
    expect(party.lu.level).toBe(SAMPLE.heroes.luXueQi.level)
    expect(party.yu.exp).toBe(SAMPLE.heroes.yuJie.exp)
    const packs = s.menu.world.panels.equipPanel.equip!.packs
    expect([packs[1].weapon, packs[2].weapon, packs[4].weapon]).toEqual(SAMPLE.worn.map((w) => w.weapon))
    expect(DRUGS.map((d) => drugCount(d.name))).toEqual(SAMPLE.drugs)
    expect(getCoins()).toBe(SAMPLE.coins)
    // 前提：这些值与出厂值确实不同 —— 否则「回来了」与「本来就这样」分不开。
    fresh()
    expect(getCoins()).not.toBe(SAMPLE.coins)
    expect(getParty().zhang.level).not.toBe(SAMPLE.heroes.zhangXiaoFan.level)
  })

  it('读档之后场景照常推：下一拍走的是场景那条线', () => {
    const s = advanceSession(loadGame(pickedFromTitle()), NO_INPUT, 10)
    expect(s.panel).toBe('scene')
    expect(s.scene.world.timeMs).toBe(10)
  })
})

describe('读一半：原版读不回来的那三组取读档前的值', () => {
  it('装备库存：存档里有非零的格子，读档后全局背包一格都没变', () => {
    // 前提：这份档的装备库存确实非空，否则「没读回来」观测不到。
    const stock = SAMPLE.neverReadBack.equipmentStock
    expect(Object.values(stock).flat().some((n) => n > 0)).toBe(true)
    const picked = pickedFromMenu()
    const owned = picked.menu.world.panels.equipPanel.equip!.owned
    owned.helmet[0] = 77
    const before = JSON.stringify(owned)
    const s = loadGame(picked)
    expect(JSON.stringify(s.menu.world.panels.equipPanel.equip!.owned)).toBe(before)
  })

  it('答题记录：中途读档时留着读档前的那一份（开机读档时那一份就是初值）', () => {
    const world = { ...createWorld(getScene('脚本1')), recorder: [{ scene: '探针.txt', answered: [true, false] }] }
    const s = loadGame(pickedFromMenu(world))
    expect(s.scene.world.recorder[0]).toEqual({ scene: '探针.txt', answered: [true, false] })
    expect(SAMPLE.neverReadBack.questionMaps).not.toContain('探针.txt')
  })

  it('applyReadBack 的入参里没有那三组 —— 类型上就交不进去', () => {
    const s = pickedFromTitle()
    const { neverReadBack: _dropped, ...half } = { ...SAMPLE }
    // @ts-expect-error —— neverReadBack 不在 applyReadBack 的入参类型里
    const typed: Parameters<typeof applyReadBack>[1] = { ...half, neverReadBack: SAMPLE.neverReadBack }
    expect(typed).toBeDefined()
    expect(applyReadBack(s, half).panel).toBe('scene')
  })
})
