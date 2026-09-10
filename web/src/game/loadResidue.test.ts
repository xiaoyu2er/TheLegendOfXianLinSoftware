import { describe, expect, it } from 'vitest'
import { DRUGS } from '../battle/drugs'
import { getScene } from '../data/scenesEager'
import { drugCount, resetDrugPack } from '../fakes/drugPack'
import { resetParty } from '../fakes/party'
import { getCoins, resetWallet } from '../fakes/wallet'
import type { MenuInput } from '../menu/step'
import { createMemorySaveStore } from '../save/memoryStore'
import type { SaveFile } from '../save/format'
import type { SaveStore } from '../save/store'
import type { SaveLoadInput } from '../saveload/step'
import { draftSlots } from '../saveload/test/replayTrace'
import { slotCenter } from '../saveload/world'
import { createDialogue } from '../state/dialogue'
import { createWorld, initiate } from '../state/step'
import { sceneSourceOf } from '../state/trace'
import type { World } from '../state/types'
import { buttonCenter } from '../test/menuClicks'
import {
  NO_INPUT,
  advanceSession,
  captureSession,
  carryIntoNewGame,
  createSession,
  currentBgm,
  enterSaveLoad,
  enterScene,
  loadGame,
  menuWorldOf,
  openMenu,
} from './session'
import type { RunningSession, Session } from './session'

/**
 * **读档之后的残留，会话层那一半**（xl-i06.11）。原版那一半在 `save/test/loadResidueOriginal.test.ts`。
 *
 * 每条先在真 JVM 上跑出读数（2026-09-10，openjdk 17，一次性探针直接调原版的
 * `Loader.load` / `ScenePanel.initiation` / `LoadAndSavePanel.setButton`），读数抄在各条的注释里，
 * 然后才写成断言。**残留清单是现查的**，与 spec 那份对不上的两处：
 *
 * - spec 说「背景音乐：中途读档沿用上一局的曲子」—— **不成立**。`loadSceneInfo` 里的
 *   `initiation` 末句就是 `readBGM(reader.getSceneMusic())`，JVM 读数 脚本1 的 欢乐的宿舍 →
 *   读 存档0 之后 紧张1（脚本38 的）。所以这里断言的是**换了**；
 * - spec 没点名、跑出来成立的：`isLoad` 只在无对话编号的场景里清（xl-1dv.33）、菜单装备页
 *   `heroEquipment` 不刷新、任务文本读档后留着上一个场景的（读进无 `Task` 段的场景时）、
 *   以及「起」之后 `currentScript` 也带进新局（这一条归 xl-9rv 裁，这里不复刻，见最后一组）。
 *
 * ⚠️ **这些用例弱在哪**：它们证明的是「我们的会话这么做」。原版这么做，只有探针那一次读数与
 * 源码现读那份文件作证 —— 探针不入库，今天没有一份跨面板的行为真值（那要把 `GameLauncher`
 * 在导出器里立起来，是单立的后续票）。「读档 → 回标题 → 起」那一组还多弱一层：`useGame` 的
 * `restart()` 是 React 那一侧的接线，这里照它的三句拼出来（`carryIntoNewGame` → `createSession`
 * → `createWorld(…, carry.recorder)`），拼法与 `useGame.ts` 对不对得上靠读。
 */
const [SLOT0, SLOT1, SLOT2] = draftSlots([]) as [SaveFile, SaveFile, SaveFile]

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
const menuClick = (x: number, y: number): MenuInput[] => [
  { e: 'press', x, y },
  { e: 'release', x, y },
]

/** 开了一局（默认脚本1），从菜单天书页「提取」进面板，点槽 `slot`。 */
function pickedFromMenu(saves: (SaveFile | null)[], slot = 0, world = createWorld(getScene('脚本1'))): RunningSession {
  let s = enterScene(createSession(deps(createMemorySaveStore(saves))), world)
  s = openMenu(s)
  s = advanceSession(s, { ...NO_INPUT, menu: menuClick(...buttonCenter(menuWorldOf(s)!.tabs.func)) }, 0)
  const b = menuWorldOf(s)!.panels.funcPanel.funcButtons!.main.readButton
  s = advanceSession(s, { ...NO_INPUT, menu: menuClick(...buttonCenter(b)) }, 0)
  return advanceSession(s, { ...NO_INPUT, saveload: slotClick(slot) }, 0)
}

/** 标题「承」→ 点槽 `slot`。 */
function pickedFromTitle(saves: (SaveFile | null)[], slot: number): Session {
  const s = enterSaveLoad(createSession(deps(createMemorySaveStore(saves))), 'load', 'start')
  return advanceSession(s, { ...NO_INPUT, saveload: slotClick(slot) }, 0)
}

/** 换一个场景 —— 出口那一下调的就是它（`state/step.ts` 的 `enter`）。 */
const walkInto = (w: World, name: string): World => initiate(w, getScene(name))

describe('isLoad 只在无对话编号的场景里清（xl-1dv.33）', () => {
  /**
   * JVM 读数（`initiation` 之后读 `sal.isLoad` 与 `dialogueEvent` 的对象身份）：
   *
   * - 对照（没读过档）：脚本38 → 宿舍，`dialogueEvent` **同一个对象**带过去；
   * - 读 存档0（脚本38，有 Dialogue）→ `isLoad = true`；把那份对话事件标成 over=true order=9，
   *   → 宿舍（无 Dialogue）：**新对象**，over=true order=0，`isLoad = false`；
   *   → 再进大地图（无 Dialogue）：同一个对象带过去；
   * - 读 存档2（脚本20，无 Dialogue）→ 读完当场 `isLoad = false`；
   * - 开机读 存档1（脚本1，有 Dialogue）→ `isLoad = true`。
   */
  it('读进有 Dialogue 段的场景：标志留着', () => {
    fresh()
    const s = loadGame(pickedFromMenu([SLOT0]))
    expect(s.scene.world.script.code).not.toBeNull()
    expect(s.scene.world.isLoad).toBe(true)
  })

  it('开机读进有 Dialogue 段的场景：同样留着', () => {
    fresh()
    const s = loadGame(pickedFromTitle([null, SLOT1], 1))
    expect(s.scene.world.scene).toBe('脚本1.txt')
    expect(s.scene.world.isLoad).toBe(true)
  })

  it('读进无 Dialogue 段的场景：读完当场就清掉', () => {
    fresh()
    const s = loadGame(pickedFromTitle([null, null, SLOT2], 2))
    expect(s.scene.world.script.code).toBeNull()
    expect(s.scene.world.isLoad).toBe(false)
  })

  it('之后第一个无 Dialogue 段的场景换一份新的对话事件并清掉标志；再下一个照常带', () => {
    fresh()
    const loaded = loadGame(pickedFromMenu([SLOT0])).scene.world
    // 把读档之后那份对话进度弄脏：新的那份（over=true order=0）与带过来的这份分得开。
    const dirty: World = { ...loaded, dialogue: { ...loaded.dialogue, eventOver: true, groupOrder: 9 } }
    const dorm = walkInto(dirty, '宿舍')
    expect(dorm.script.code).toBeNull()
    expect(dorm.dialogue).toEqual(createDialogue(dorm.script))
    expect(dorm.dialogue.groupOrder).toBe(0)
    expect(dorm.isLoad).toBe(false)
    // 标志清掉之后回到「沿用」那一支。
    const map = walkInto({ ...dorm, dialogue: { ...dorm.dialogue, groupOrder: 5 } }, '大地图')
    expect(map.dialogue.groupOrder).toBe(5)
  })

  /**
   * 篡改矩阵里逮到的洞：上面几条都是从读档那个场景**直接**走进无对话场景，「中间经过一个有
   * 对话的场景标志仍留着」这一支一条都没走到（把 `initiate` 里的 isLoad 写死成 false，全绿）。
   * JVM 读数：读 存档0 → 再 `initiation("脚本1.txt")`（有 Dialogue）→ `isLoad` 仍为 true。
   */
  it('中间隔一个有 Dialogue 段的场景：标志一路留着，到第一个无 Dialogue 段的场景才换', () => {
    fresh()
    const loaded = loadGame(pickedFromMenu([SLOT0])).scene.world
    const via = walkInto(loaded, '脚本1')
    expect(via.script.code).not.toBeNull()
    expect(via.isLoad).toBe(true)
    const dirty: World = { ...via, dialogue: { ...via.dialogue, eventOver: true, groupOrder: 9 } }
    const dorm = walkInto(dirty, '宿舍')
    expect(dorm.dialogue).toEqual(createDialogue(dorm.script))
    expect(dorm.isLoad).toBe(false)
  })

  it('对照：没读过档时，同一条路上无 Dialogue 段的场景沿用上一份', () => {
    const w = createWorld(getScene('脚本38'))
    const dirty: World = { ...w, dialogue: { ...w.dialogue, eventOver: true, groupOrder: 9 } }
    const dorm = walkInto(dirty, '宿舍')
    expect(w.isLoad).toBe(false)
    expect(dorm.dialogue.groupOrder).toBe(9)
    expect(dorm.dialogue.eventOver).toBe(true)
  })
})

describe('菜单装备页的 heroEquipment 读档不刷新', () => {
  /**
   * JVM 读数：读 存档0 之后 `currentPack.weapon = 千月星痕`、`heroEquipment = 月苗刀`（读档前那件）。
   * 打开菜单那一下（`switchTo("menu")`）只调三句 `refreshValue()`，也不碰它。
   */
  it('身上的装备换成存档里的，装备页那一格仍是读档前那件；开菜单也不刷', () => {
    fresh()
    const picked = pickedFromMenu([SLOT0])
    const before = picked.menu.world.panels.equipPanel.equip!
    const stale = before.heroEquipment
    const s = loadGame(picked)
    const e = s.menu.world.panels.equipPanel.equip!
    // 前提：存档里那件与读档前那件确实不同 —— 否则「没刷」与「刷了」分不开。
    expect(e.packs[e.currentPackHero]!.weapon).not.toBe(stale)
    expect(e.packs[e.currentPackHero]!.weapon).toBe(SLOT0.worn[0]!.weapon)
    expect(e.heroEquipment).toBe(stale)
    const reopened = openMenu(advanceSession(s, NO_INPUT, 10))
    expect(reopened.menu.world.panels.equipPanel.equip!.heroEquipment).toBe(stale)
  })
})

describe('读档不碰菜单与战斗面板', () => {
  /**
   * 原版 `Loader.load` 不给 `GameLauncher` 的任何面板赋值（源码现读在原版那一半）。
   *
   * 战斗那一侧这里**不断言**：这一层能读档的时刻（菜单或标题上）`session.battle` 恒为 `null`，
   * 「读档前后都是 null」是按构造成立的。战斗面板活过读档只有原版那一半的源码现读作证。
   */
  it('菜单是读档前那一份、停在读档前那一页', () => {
    fresh()
    const picked = pickedFromMenu([SLOT0])
    const menu = picked.menu
    const page = picked.menu.world.panel
    const s = loadGame(picked)
    expect(s.menu).toBe(menu)
    expect(s.menu.world.panel).toBe(page)
  })
})

describe('任务文本：读进无 Task 段的场景，留着上一个场景的', () => {
  /**
   * `Reader.task` 是 static，`Task` 段缺席时没人去清。三份入库样例的场景都带 `Task` 段，于是
   * 这条分支样例走不到 —— 探针造了一份读进 `宿舍.txt` 的档（存档0 那一行只改场景名）：
   * JVM 读数 读档前 脚本38 的「现在要去练武场一决胜负了」，读进宿舍之后**仍是它**，
   * 接着存进槽 1，第 1 行写的也是它（上一局的任务写进了新槽）。
   */
  it('读档前的任务留着，下一次存档写进去的也是它', () => {
    fresh()
    const toDorm: SaveFile = { ...SLOT0, scene: { ...SLOT0.scene, fileName: '宿舍.txt' } }
    // 读档前站在脚本1（不是探针那次的脚本38）：这样「留着读档前的」与「取了存档摘要里记的那句」
    // 分得开 —— 存档0 摘要里记的是脚本38 那句。机制是同一个（static 没人清）。
    const before = createWorld(getScene('脚本1'))
    const task = before.readerStatics.task
    // 前提：宿舍确实没有 Task 段，而读档前的任务与存档自己记的那句不同。
    expect(createWorld(getScene('宿舍')).readerStatics.task).toBeNull()
    expect(task).not.toBeNull()
    expect(task).not.toBe(SLOT0.summary.task)
    const s = loadGame(pickedFromMenu([toDorm], 0, before))
    expect(s.scene.world.scene).toBe('宿舍.txt')
    expect(s.scene.world.readerStatics.task).toBe(task)
    expect(captureSession(s).summary.task).toBe(task)
  })
})

describe('背景音乐：读档之后是读进的那个场景的曲子（spec 那条「沿用上一局」不成立）', () => {
  /** JVM 读数：`currentPlayingBGM` 脚本1 的 欢乐的宿舍.mp3 → 读 存档0 之后 紧张1.mp3。 */
  it('中途读档之后放的是读进的场景的曲子，不是读档前那首', () => {
    fresh()
    const picked = pickedFromMenu([SLOT0])
    const s = advanceSession(loadGame(picked), NO_INPUT, 10)
    expect(currentBgm(s)).toBe(getScene('脚本38').sceneMusic)
    expect(currentBgm(s)).not.toBe(getScene('脚本1').sceneMusic)
  })
})

describe('那条不复刻的例外：读档之后场景不是双倍速（ADR-0001 例外表）', () => {
  /**
   * 原版中途读档多起一条场景循环（JVM 读数：step() 85.5 → 169.5 次/秒），这一层不复刻：
   * 状态层没有线程模型，场景一拍一个 `advance`。判据：读档前后，同样推一秒，场景时钟都只走一秒、
   * 主角按住方向键走的格数也一样。
   */
  it('读档前后各推一秒：世界时间都只走 1000 ms', () => {
    fresh()
    const picked = pickedFromMenu([SLOT0])
    const t0 = picked.scene.world.timeMs
    const loaded = loadGame(picked)
    const t1 = loaded.scene.world.timeMs
    const after = advanceSession(loaded, NO_INPUT, 1000)
    expect(after.scene.world.timeMs - t1).toBe(1000)
    // 对照：读档之前同样推一秒，走的也是 1000（不是说「读档之后恰好快了一半」也算过）。
    const control = advanceSession({ ...picked, panel: 'scene', loadRequest: null }, NO_INPUT, 1000)
    expect(control.scene.world.timeMs - t0).toBe(1000)
  })

  it('再读一次档也一样（原版第二次读档不抛、仍是两条线程；这一层始终一条）', () => {
    fresh()
    let s: RunningSession = loadGame(pickedFromMenu([SLOT0, SLOT1]))
    s = openMenu(s)
    s = advanceSession(s, { ...NO_INPUT, menu: menuClick(...buttonCenter(menuWorldOf(s)!.tabs.func)) }, 0)
    const b = menuWorldOf(s)!.panels.funcPanel.funcButtons!.main.readButton
    s = advanceSession(s, { ...NO_INPUT, menu: menuClick(...buttonCenter(b)) }, 0)
    s = loadGame(advanceSession(s, { ...NO_INPUT, saveload: slotClick(1) }, 0))
    const t = s.scene.world.timeMs
    expect(advanceSession(s, NO_INPUT, 1000).scene.world.timeMs - t).toBe(1000)
  })

  it('读档 → 回标题 → 起：新局也只走 1000 ms（原版这个入口再多一条，读数三条 254.5 次/秒）', () => {
    fresh()
    const loaded = loadGame(pickedFromMenu([SLOT0]))
    const carry = carryIntoNewGame(loaded)
    const next = enterScene(createSession(loaded.deps, carry), createWorld(getScene('脚本1'), true, carry.recorder))
    const t = next.scene.world.timeMs
    expect(advanceSession(next, NO_INPUT, 1000).scene.world.timeMs - t).toBe(1000)
  })
})

describe('读档 → 回标题 → 起：钱、药、装备库存、答题记录带进新局', () => {
  /**
   * JVM 读数（探针：读 存档0 → 再 `initiation("脚本1.txt")`，即「起」那一下的状态部分）：
   * 钱 59868、药 32/18/15/10/16/2、装备库存（探针预先写的一件 ×7）、答题记录（探针预先写的一条）
   * 全部原样带进新局。
   *
   * 这里只断言这四样，理由（xl-i06.11 票上的主干评论）：
   * - **等级 / 血 / 经验**：原版也带进来（11/10/11 级），而 web 的「起」**故意**重置队伍
   *   （xl-lly，ADR-0001 例外表第一行）。两者冲突，归 xl-9rv 裁；
   * - **身上的装备**：原版也带进来，但它与等级是**绑在一起的** —— 穿着的那件的四项加成算在
   *   属性上，而 `resetParty()` 把属性回到出厂值。只带装备不带属性，弃用那一下会把加成扣成负的。
   *   所以跟等级一起归 xl-9rv；
   * - **剧情三元组 `currentScript`、`isLoad`、任务文本**：原版也带进来（`currentScript` 仍是存档0 的
   *   `43/42 比武第二阶段 脚本38.txt`，于是「新局」的剧情接着存档里的走）。web 的「起」整个世界
   *   重建，这几样回到开机值 —— 同样归 xl-9rv。
   */
  function newGameAfterLoad() {
    fresh()
    const world: World = { ...createWorld(getScene('脚本1')), recorder: [{ scene: '探针.txt', answered: [true, false] }] }
    const picked = pickedFromMenu([SLOT0], 0, world)
    picked.menu.world.panels.equipPanel.equip!.owned.helmet[0] = 77
    const loaded = loadGame(picked)
    const carried = {
      coins: getCoins(),
      drugs: DRUGS.map((d) => drugCount(d.name)),
      owned: structuredClone(loaded.menu.world.panels.equipPanel.equip!.owned),
      recorder: loaded.scene.world.recorder,
    }
    // `useGame.restart()`：`resetParty()` + 会话整个重来；重来时 `useGame` 的 effect 先
    // `carryIntoNewGame(旧会话)`，再 `createSession(deps, carry)`，场景取到手后
    // `enterScene(…, createWorld(脚本1, true, carry.recorder))`。
    resetParty()
    const carry = carryIntoNewGame(loaded)
    const next = enterScene(createSession(loaded.deps, carry), createWorld(getScene('脚本1'), true, carry.recorder))
    return { carried, next }
  }

  // 钱与药不在这里断言：它们的落点是两个模块单例，上面那三句组合里没有一句碰它们，在这一层
  // 断言「没被清」是按构造成立的。唯一可能清掉它们的是 `useGame.restart()` 本身 —— 那条判据在
  // `game/useGame.test.tsx`「重开一局：钱与药是上一局的」。

  it('装备库存：新局的全局背包是上一局那份', () => {
    const { carried, next } = newGameAfterLoad()
    expect(carried.owned.helmet[0]).toBe(77)
    expect(next.menu.world.panels.equipPanel.equip!.owned).toEqual(carried.owned)
  })

  it('答题记录：新局的世界带着上一局那两张表', () => {
    const { carried, next } = newGameAfterLoad()
    expect(carried.recorder).toContainEqual({ scene: '探针.txt', answered: [true, false] })
    for (const r of carried.recorder) expect(next.scene.world.recorder).toContainEqual(r)
  })

  it('开机那一次没有上一局：什么都不带（背包全空、答题表只有脚本1 自己登记的）', () => {
    const carry = carryIntoNewGame(null)
    const s = enterScene(createSession(deps(createMemorySaveStore())), createWorld(getScene('脚本1'), true, carry.recorder))
    const owned = s.menu.world.panels.equipPanel.equip!.owned
    expect(Object.values(owned).flat().every((n) => n === 0)).toBe(true)
    expect(s.scene.world.recorder).toEqual(createWorld(getScene('脚本1')).recorder)
  })
})
