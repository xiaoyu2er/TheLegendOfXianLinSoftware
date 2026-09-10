import { parseSave, serializeSave } from './format'
import type { SaveFile } from './format'
import { SAVE_SLOT_COUNT, checkSlot, requireReady } from './store'
import type { SaveStore, SaveStoreStatus } from './store'

/**
 * 存档仓库的**浏览器版**（xl-i06.8）：内存快照 + 一个异步的持久化后端。
 *
 * 状态机只碰快照（`read` / `write` 都是同步的）；快照与后端对齐是这里在状态机
 * 之外做的两件事：
 *
 * 1. **开机拉一次**：建出来当场就去后端取全部槽位，取回来之前 `status()` 是
 *    `loading`，取回来逐个 `parseSave` —— 盘上有一份不认识版本号的档就是
 *    `failed`，**不是**「那个槽是空的」（见 `SaveStoreStatus`）；
 * 2. **写一次推一次**：`write` 先改快照，再把序列化后的文本排进一条串行的写队列。
 *    串行是为了「后写的必然后落」：两次存同一个槽，并发写的话落盘次序由后端
 *    说了算，而那种错只在关掉再打开之后才看得见。
 *
 * 后端出错不掀翻游戏（同 `bgmPlayer` 被挡下来的 `play()`），但**读得到**：
 * `persistError()` 是最近一次落盘失败的原因。
 */

/** 持久化后端：按槽位存一段文本。运行时是 IndexedDB（{@link indexedDbBackend}）。 */
export interface SaveBackend {
  /** 全部槽位的文本，下标即槽位；空槽为 `null`。 */
  loadAll(): Promise<readonly (string | null)[]>
  save(slot: number, text: string): Promise<void>
}

export interface BrowserSaveStore extends SaveStore {
  /** 开机那一次拉取有了结果（就绪或失败）时 resolve。**不会** reject。 */
  whenLoaded(): Promise<void>
  /** 此刻排着的写都落了盘（或失败了）时 resolve。**不会** reject。 */
  flush(): Promise<void>
  /** 最近一次落盘失败的原因，`null` = 没失败过。 */
  persistError(): Error | null
}

export function createBrowserSaveStore(backend: SaveBackend): BrowserSaveStore {
  let status: SaveStoreStatus = 'loading'
  let error: Error | null = null
  let persistError: Error | null = null
  const slots: (SaveFile | null)[] = Array.from({ length: SAVE_SLOT_COUNT }, () => null)
  let writes: Promise<void> = Promise.resolve()

  const loaded = (async () => {
    try {
      const texts = await backend.loadAll()
      const parsed = Array.from({ length: SAVE_SLOT_COUNT }, (_, i) => {
        const text = texts[i] ?? null
        if (text === null) return null
        try {
          return parseSave(text)
        } catch (e) {
          throw new Error(`存档槽位 ${i} 读不上来：${(e as Error).message}`, { cause: e })
        }
      })
      // 全部解析过了才换进快照：半截快照与「那几个槽是空的」同样分不开。
      parsed.forEach((save, i) => (slots[i] = save))
      status = 'ready'
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e))
      status = 'failed'
    }
  })()

  const state = { status: () => status, error: () => error }
  return {
    ...state,
    read(slot) {
      checkSlot(slot)
      requireReady(state, `读槽位 ${slot}`)
      return slots[slot]!
    },
    write(slot, save) {
      checkSlot(slot)
      requireReady(state, `写槽位 ${slot}`)
      // 序列化在这里当场做，不留到队列里：排队期间调用方再改那个对象，落盘的
      // 就不是存档那一刻的样子了。
      const text = serializeSave(save)
      slots[slot] = save
      writes = writes.then(
        () =>
          backend.save(slot, text).then(
            () => undefined,
            (e: unknown) => {
              persistError = e instanceof Error ? e : new Error(String(e))
            },
          ),
      )
    },
    whenLoaded: () => loaded,
    flush: () => writes,
    persistError: () => persistError,
  }
}

// ---------------------------------------------------------------- IndexedDB

const DB_NAME = 'xianlin'
const DB_VERSION = 1
const STORE = 'saves'

/**
 * 运行时的后端：IndexedDB，一个库、一张表、键是槽位号。
 *
 * ⚠️ 这一段**没有判据**，按票面是故意的：判据全落在 `SaveStore` 接口上，不去测
 * 浏览器存储本身（jsdom 里也没有 IndexedDB）。它出错的样子是 `status()` 为
 * `failed` 或 `persistError()` 非空 —— 读得到，不是静默的。
 */
export function indexedDbBackend(factory: IDBFactory | undefined = globalThis.indexedDB): SaveBackend {
  let db: Promise<IDBDatabase> | null = null
  const open = (): Promise<IDBDatabase> => {
    if (db) return db
    db = new Promise((resolve, reject) => {
      if (!factory) {
        reject(new Error('这个环境没有 IndexedDB'))
        return
      }
      const req = factory.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('打开 IndexedDB 失败'))
    })
    return db
  }
  const done = <T>(req: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 请求失败'))
    })
  return {
    async loadAll() {
      const store = (await open()).transaction(STORE, 'readonly').objectStore(STORE)
      const out: (string | null)[] = []
      for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
        const v: unknown = await done(store.get(i))
        // 没有这个键才是空槽；键在而值读不懂是坏档，**抛** —— 当成空槽的话下一次
        // 存档就把它覆盖了（见 `SaveStoreStatus` 的 failed）。
        if (v === undefined) out.push(null)
        else if (typeof v === 'string') out.push(v)
        else throw new Error(`IndexedDB 里槽位 ${i} 的值不是文本：${Object.prototype.toString.call(v)}`)
      }
      return out
    },
    async save(slot, text) {
      const tx = (await open()).transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(text, slot)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 写入失败'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 写入被中止'))
      })
    },
  }
}
