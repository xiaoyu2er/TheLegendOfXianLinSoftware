import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSession, saveSlotsOf } from '../game/session'
import { traceNamesOf } from '../state/trace'
import { javaSource } from '../test/javaSource'
import { repoPath } from '../test/repoPath'
import { createBrowserSaveStore } from './browserStore'
import type { SaveBackend } from './browserStore'
import { SAVE_VERSION, serializeSave } from './format'
import type { SaveFile } from './format'
import { createMemorySaveStore } from './memoryStore'
import {
  EMPTY_SLOT_SUMMARY,
  SAVE_SLOT_COUNT,
  SaveStoreNotReady,
  saveSlotsView,
  slotSummary,
} from './store'
import type { SaveStore, SlotSummary } from './store'
import { ROLE_AND_MAP_EXPRS, fromRecorderText, readSample, sampleNames } from './test/originalSave'

/**
 * 存档仓库这道缝的判据（xl-i06.8）。**全落在 `SaveStore` 接口上**：浏览器版
 * 接的是下面这个内存里的异步后端，没有一条用例依赖 IndexedDB 真的可用。
 */

// ---------------------------------------------------------------- 测试用的后端

/**
 * 一个活在内存里的异步后端。`gate` 给了就等它 resolve 才交出 `loadAll` 的结果
 * —— 「盘上确实有档、但还没读上来」就是这么造的。`disk` 在几个仓库之间共用，
 * 「关掉再打开」就是同一个 `disk` 上再建一个仓库。
 */
function memoryBackend(disk: (string | null)[] = [], gate?: Promise<void>): SaveBackend & { disk: (string | null)[] } {
  return {
    disk,
    async loadAll() {
      if (gate) await gate
      return [...disk]
    },
    async save(slot, text) {
      await Promise.resolve()
      disk[slot] = text
    },
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

// ---------------------------------------------------------------- 真值那一侧

const SAMPLES = sampleNames()
/** 入库样例存档按槽位号：`存档N.txt` → 第 N 槽。 */
function sampleOfSlot(n: number): SaveFile {
  const name = `存档${n}.txt`
  if (!SAMPLES.includes(name)) throw new Error(`真值目录里没有 ${name}（现有：${SAMPLES.join('、')}）`)
  return fromRecorderText(readSample(name))
}

interface SaveLoadTick {
  readonly slots: readonly SlotSummary[]
}
interface SaveLoadTrace {
  readonly script: { readonly setup: { readonly emptySlots: readonly number[] } }
  readonly ticks: readonly SaveLoadTick[]
}
const SAVELOAD_TRACES = traceNamesOf('saveload')
function readSaveLoadTrace(name: string): SaveLoadTrace {
  return JSON.parse(readFileSync(repoPath('tools/traces/out', `${name}.trace.json`), 'utf8')) as SaveLoadTrace
}

/**
 * 导出器的草稿区就是那几份入库样例（`SaveDraftIntactTest` 守着），
 * `setup.emptySlots` 那几个槽导出前被删掉。按这个造一份仓库的起手内容。
 */
function slotsOf(trace: SaveLoadTrace): (SaveFile | null)[] {
  return Array.from({ length: SAVE_SLOT_COUNT }, (_, n) =>
    trace.script.setup.emptySlots.includes(n) ? null : sampleOfSlot(n),
  )
}

/** 两份实现各造一份装着这些档、已经就绪的仓库。 */
const IMPLEMENTATIONS: Record<string, (slots: (SaveFile | null)[]) => Promise<SaveStore>> = {
  内存版: async (slots) => createMemorySaveStore(slots),
  浏览器版: async (slots) => {
    const store = createBrowserSaveStore(memoryBackend(slots.map((s) => (s === null ? null : serializeSave(s)))))
    await store.whenLoaded()
    return store
  },
}

// ---------------------------------------------------------------- 分母对撞

describe('槽位数：与原版源码、与真值对撞', () => {
  it('LoadAndSavePanel 里的 3 就是 SAVE_SLOT_COUNT（GBK 源码现读）', () => {
    const src = javaSource('src/start/LoadAndSavePanel.java')
    expect([...src.matchAll(/isRoleExist = new int\[(\d+)\]\[3\]/g)].map((m) => Number(m[1]))).toEqual([
      SAVE_SLOT_COUNT,
    ])
    const prepare = src.slice(src.indexOf('private void prepareScenes()'))
    expect(prepare.match(/for \(int i = 0; i < (\d+); i\+\+\)/)?.[1]).toBe(String(SAVE_SLOT_COUNT))
  })

  it('每份 saveload 真值每一步的槽位数都是 SAVE_SLOT_COUNT', () => {
    let ticks = 0
    for (const name of SAVELOAD_TRACES) {
      for (const tick of readSaveLoadTrace(name).ticks) {
        expect(tick.slots, name).toHaveLength(SAVE_SLOT_COUNT)
        ticks++
      }
    }
    expect(ticks).toBeGreaterThan(0)
  })

  it('摘要 roles 的次序就是存档第 1 行前三项的次序（与原版解析器的登记对撞）', () => {
    const save = sampleOfSlot(0)
    const keys = ROLE_AND_MAP_EXPRS.slice(0, 3).map((e) => e.replace('SaveAndLoad.', ''))
    expect(keys).toEqual(['zhang', 'lu', 'wen'])
    // 三个人逐个单独在队，roles 里亮的必须是对应那一格。
    keys.forEach((key, j) => {
      const party = { zhang: false, lu: false, wen: false, [key]: true }
      const roles = slotSummary({ ...save, party }).roles
      expect(roles.map((r, i) => (r ? i : -1)).filter((i) => i >= 0), key).toEqual([j])
    })
  })

  it('空槽那一支是原版的字面量「无」，task 为 null 时照原版画成 "null"', () => {
    const src = javaSource('src/start/LoadAndSavePanel.java')
    expect(src).toContain('maps.add("无");')
    expect(src).toContain('tasks.add("无");')
    expect(slotSummary(null)).toEqual(EMPTY_SLOT_SUMMARY)
    const save = sampleOfSlot(0)
    expect(slotSummary({ ...save, summary: { ...save.summary, task: null } }).task).toBe('null')
  })
})

// ---------------------------------------------------------------- 真值回放

describe('真值回放：同步读出来的摘要 == 原版进面板那一刻算出来的摘要', () => {
  it('saveload 真值不止零份（分母现扫）', () => {
    expect(SAVELOAD_TRACES.length).toBeGreaterThan(0)
  })

  for (const [impl, make] of Object.entries(IMPLEMENTATIONS)) {
    for (const name of SAVELOAD_TRACES) {
      it(`${impl} · ${name}：第 0 步的每个槽`, async () => {
        const trace = readSaveLoadTrace(name)
        const store = await make(slotsOf(trace))
        // 回放这一步本身是同步的：读接口一旦变成异步，下面拿到的是 Promise。
        const view = saveSlotsView(store)
        expect(view).toEqual({ status: 'ready', slots: trace.ticks[0]!.slots })
        // 至少有一个非空槽、一个空槽被比过 —— 否则「全是空槽」也能过。
        const slots = trace.ticks[0]!.slots
        expect(slots.some((s) => s.map !== '无'), `${name} 没有非空槽`).toBe(true)
        expect(slots.some((s) => s.map === '无'), `${name} 没有空槽`).toBe(true)
      })
    }
  }
})

// ---------------------------------------------------------------- 就绪标志

describe('就绪标志：「有档但还没读上来」与「读上来了、确实是空的」必须不同', () => {
  it('两者此刻的面板状态不同；读上来之后才看得见那份档', async () => {
    const gate = deferred()
    const withSave = createBrowserSaveStore(memoryBackend([serializeSave(sampleOfSlot(0))], gate.promise))
    const empty = createBrowserSaveStore(memoryBackend([]))
    await empty.whenLoaded()

    const loadingView = saveSlotsView(withSave)
    const emptyView = saveSlotsView(empty)
    // 先钉住「空的那份」确实就绪且三个槽都是空 —— 否则下面的「不同」可能只是
    // 空的那份也没就绪。
    expect(emptyView).toEqual({ status: 'ready', slots: [EMPTY_SLOT_SUMMARY, EMPTY_SLOT_SUMMARY, EMPTY_SLOT_SUMMARY] })
    expect(loadingView).not.toEqual(emptyView)
    expect(loadingView).toEqual({ status: 'loading' })

    gate.resolve()
    await withSave.whenLoaded()
    const loaded = saveSlotsView(withSave)
    expect(loaded.status).toBe('ready')
    expect(loaded.status === 'ready' && loaded.slots[0]).toEqual(slotSummary(sampleOfSlot(0)))
  })

  it('会话层读到的就是这个视图：还没读上来的仓库，会话报 loading 而不是三个空槽', async () => {
    const gate = deferred()
    const saves = createBrowserSaveStore(memoryBackend([serializeSave(sampleOfSlot(0))], gate.promise))
    const session = createSession({ scenes: () => undefined, sprite: () => ({ width: 1, height: 1 }), random: () => 0, saves })
    expect(saveSlotsOf(session)).toEqual({ status: 'loading' })
    gate.resolve()
    await saves.whenLoaded()
    expect(saveSlotsOf(session)).toEqual({
      status: 'ready',
      slots: [slotSummary(sampleOfSlot(0)), EMPTY_SLOT_SUMMARY, EMPTY_SLOT_SUMMARY],
    })
  })

  it('没就绪时读、写都抛，不交空槽', () => {
    const gate = deferred()
    const store = createBrowserSaveStore(memoryBackend([], gate.promise))
    expect(() => store.read(0)).toThrow(SaveStoreNotReady)
    expect(() => store.write(0, sampleOfSlot(0))).toThrow(SaveStoreNotReady)
  })

  it('盘上有一份不认识版本号的档：failed，不是「那个槽是空的」', async () => {
    const future = JSON.stringify({ ...sampleOfSlot(0), version: SAVE_VERSION + 1 })
    const store = createBrowserSaveStore(memoryBackend([null, future]))
    await store.whenLoaded()
    expect(store.status()).toBe('failed')
    expect(store.error()?.message).toMatch(/槽位 1 读不上来：不认识的存档版本号/)
    expect(saveSlotsView(store)).toEqual({ status: 'failed' })
    expect(() => store.read(0)).toThrow(SaveStoreNotReady)
  })

  it('后端本身读不上来（没有 IndexedDB 那种）：failed，原因读得到', async () => {
    const store = createBrowserSaveStore({
      loadAll: () => Promise.reject(new Error('这个环境没有 IndexedDB')),
      save: () => Promise.resolve(),
    })
    await store.whenLoaded()
    expect(store.status()).toBe('failed')
    expect(store.error()?.message).toBe('这个环境没有 IndexedDB')
  })
})

// ---------------------------------------------------------------- 关掉再打开

describe('关掉再打开，进度还在', () => {
  it('存进去、落盘、在同一块盘上新建一个仓库：读回来的逐字段相同', async () => {
    const disk: (string | null)[] = []
    const first = createBrowserSaveStore(memoryBackend(disk))
    await first.whenLoaded()
    const save = sampleOfSlot(2)
    first.write(1, save)
    // 快照当场就是新的（原版存完立刻 prepareScenes 重读）。
    expect(first.read(1)).toEqual(save)
    await first.flush()
    expect(first.persistError()).toBeNull()

    // 「关掉」：丢掉 first，只留下盘。
    const second = createBrowserSaveStore(memoryBackend(disk))
    expect(second.status()).toBe('loading')
    await second.whenLoaded()
    expect(second.read(1)).toEqual(save)
    expect(second.read(0)).toBeNull()
    expect(saveSlotsView(second)).toEqual({
      status: 'ready',
      slots: [EMPTY_SLOT_SUMMARY, slotSummary(save), EMPTY_SLOT_SUMMARY],
    })
  })

  it('同一个槽连存两次，后存的那份最后落盘（写队列是串行的）', async () => {
    const disk: (string | null)[] = []
    // 每一次落盘都由用例手动放行。并发写的话两次 save 当场都发出去了，而后端先
    // 完成哪一次由它说了算 —— 这里故意让**头一次**最后完成。
    const pending: { slot: number; text: string; done: () => void }[] = []
    const backend: SaveBackend = {
      loadAll: async () => [...disk],
      save: (slot, text) => new Promise<void>((done) => pending.push({ slot, text, done })),
    }
    const settle = () => new Promise((r) => setTimeout(r, 0))
    const store = createBrowserSaveStore(backend)
    await store.whenLoaded()
    const a = sampleOfSlot(0)
    const b = sampleOfSlot(2)
    store.write(0, a)
    store.write(0, b)
    await settle()
    // 串行：头一次没落完，第二次根本还没发出去。
    expect(pending.map((p) => p.text)).toEqual([serializeSave(a)])
    // 就算后端把它们倒着完成，也轮不到：放行头一次，第二次才发出去。
    const land = (i: number) => {
      disk[pending[i]!.slot] = pending[i]!.text
      pending[i]!.done()
    }
    land(0)
    await settle()
    expect(pending).toHaveLength(2)
    land(1)
    await store.flush()
    expect(disk[0]).toBe(serializeSave(b))
  })

  it('落盘失败：快照照样是新的，原因读得到，不掀翻调用方', async () => {
    const store = createBrowserSaveStore({
      loadAll: async () => [],
      save: () => Promise.reject(new Error('盘满了')),
    })
    await store.whenLoaded()
    store.write(0, sampleOfSlot(0))
    await store.flush()
    expect(store.read(0)).toEqual(sampleOfSlot(0))
    expect(store.persistError()?.message).toBe('盘满了')
  })
})
