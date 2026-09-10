import type { SaveFile } from './format'

/**
 * 存档仓库这道缝（xl-i06.8）—— M6 唯一一道新开的运行时缝。
 *
 * ## 读接口同步，异步只在状态机之外
 *
 * 浏览器那份存储全异步，而状态层是**同步纯函数**，所有真值回放能成立就靠这一条。
 * 所以 {@link SaveStore.read} 读的是一份**内存快照**，当场返回；「快照与浏览器
 * 存储对齐」那一层（`browserStore.ts`）在状态机之外异步地做，形状抄
 * `audio/bgmPlayer.ts`：状态只声明「该放哪首」，播放器去把它同步到实际输出。
 * 这里是反过来的两个方向 —— 开机把盘上的档**拉进**快照，写档把快照**推出去** ——
 * 但状态机从头到尾只碰快照。
 *
 * 两份实现：`memoryStore.ts`（测试与真值回放，按 ADR-0005 登记在册）与
 * `browserStore.ts`（运行时）。判据全落在这个接口上，不去测浏览器存储本身。
 *
 * ## ⚠️ 就绪标志是显式的
 *
 * 「还没从盘上读上来」与「几个槽本来就是空的」**在画面上长得一模一样** —— 三个
 * 槽都写着「无」。所以就绪与否是 {@link SaveStore.status} 自己报的，**不许**拿
 * 「快照是空的」去推。没就绪时 {@link SaveStore.read} **抛**，不交一个空槽出去：
 * 交空槽的话，面板照样画得出来，而画出来的是一句谎话。
 */

/**
 * 原版的槽位数。`LoadAndSavePanel` 里 `new int[3][3]`、`for (int i = 0; i < 3; i++)`
 * 与三个按钮 —— 与 GBK 源码、与两份 saveload 真值的槽位数对撞见 `store.test.ts`。
 */
export const SAVE_SLOT_COUNT = 3

/**
 * - `loading`：还在从盘上读，快照**不可信**；
 * - `ready`：快照与盘上一致（写档之后到落盘之前，快照比盘新 —— 那是写的一侧的事，
 *   读的一侧永远以快照为准）；
 * - `failed`：读不上来（存储不可用、盘上有一份不认识的档……）。**不降级成空槽**：
 *   一份不认识版本号的档被当成「这个槽是空的」，下一次存档就把它覆盖掉了。
 */
export type SaveStoreStatus = 'loading' | 'ready' | 'failed'

export interface SaveStore {
  status(): SaveStoreStatus
  /** `failed` 时为什么失败；别的状态是 `null`。 */
  error(): Error | null
  /**
   * **同步**读一个槽。`null` = 这个槽是空的（原版 `Loader.isNull` 为真）。
   * 没就绪时抛 {@link SaveStoreNotReady}。
   */
  read(slot: number): SaveFile | null
  /**
   * **同步**写一个槽：快照当场就是新的（原版存完档立刻 `prepareScenes()` 重读，
   * 那一下读到的必须是刚存进去的）。落盘是之后的事，见各实现。没就绪时抛。
   */
  write(slot: number, save: SaveFile): void
  /**
   * 最近一次**落盘**失败的原因，`null` = 没失败过（xl-i06.9 从浏览器版提上来）。
   *
   * 与 {@link status} 的 `failed` 不是一回事：那是开机读不上来；这是快照已经是新的、
   * 而浏览器存储没写进去 —— 面板上摘要看起来存上了，关掉页面就没了。存读档面板
   * 把它露出来（`game/session.ts` 的 `saveLoadViewOf`）。
   */
  persistError(): Error | null
}

/** 没就绪就读写。这是调用方的错 —— 面板不该在快照就绪之前打开。 */
export class SaveStoreNotReady extends Error {
  override name = 'SaveStoreNotReady'
}

export function checkSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SAVE_SLOT_COUNT) {
    throw new RangeError(`存档槽位 ${slot} 不存在：一共 ${SAVE_SLOT_COUNT} 个（0..${SAVE_SLOT_COUNT - 1}）`)
  }
}

export function requireReady(store: Pick<SaveStore, 'status' | 'error'>, what: string): void {
  const status = store.status()
  if (status === 'ready') return
  throw new SaveStoreNotReady(
    `存档仓库还没就绪（${status}${store.error() ? `：${store.error()!.message}` : ''}）就${what} —— ` +
      '「还没读上来」与「槽是空的」长得一样，不许拿空槽顶替',
  )
}

// ---------------------------------------------------------------- 槽位摘要

/**
 * 一个槽的摘要 —— 原版 `LoadAndSavePanel.prepareScenes()` 算出来的那三样，字段
 * 名与 saveload 真值的 `slots[i]` 相同。
 *
 * - `roles`：`isRoleExist[i]`，次序是存档第 1 行前三项（张小凡 / 陆雪琪 / 文敏）；
 * - `map` / `task`：`maps` / `tasks`，空槽两样都是字面量「无」。
 */
export interface SlotSummary {
  readonly roles: readonly [boolean, boolean, boolean]
  readonly map: string
  readonly task: string
}

/** 原版空槽那一支：`maps.add("无"); tasks.add("无");`，`isRoleExist[i]` 一格不置。 */
export const EMPTY_SLOT_SUMMARY: SlotSummary = { roles: [false, false, false], map: '无', task: '无' }

/**
 * 一个槽**头一次**算出来的摘要（面板刚建好、`isRoleExist` 全零时那一次）。
 *
 * ⚠️ 原版 `prepareScenes()` 只把 `isRoleExist` 往 1 置、**从不清零**，于是同一个
 * 面板里重算时 `roles` 是「以前算过的」与「这一份」取或（saveload-menu 第 4 步：
 * 两人档覆盖三人档，摘要上文敏还在）。那份跨次重算的记忆归面板（xl-i06.9），
 * 这里只算一份档本身说了什么。
 *
 * `task` 为 `null`（原版 `Reader.task` 的初值）时，原版写档落成字面量 `"null"`，
 * 读回来 `tasks.add("null")`，画出来就是 null 四个字母。照抄。
 */
export function slotSummary(save: SaveFile | null): SlotSummary {
  if (save === null) return EMPTY_SLOT_SUMMARY
  return {
    roles: [save.party.zhang, save.party.lu, save.party.wen],
    map: save.summary.mapName,
    task: save.summary.task ?? 'null',
  }
}

/**
 * 存读档面板读到的样子。**没就绪就是没就绪**，不是三个空槽 —— 两者在原版画面
 * 上一模一样，所以在这里必须不一样。
 */
export type SaveSlotsView =
  | { readonly status: 'loading' | 'failed' }
  | { readonly status: 'ready'; readonly slots: readonly SlotSummary[] }

export function saveSlotsView(store: SaveStore): SaveSlotsView {
  const status = store.status()
  if (status !== 'ready') return { status }
  const slots: SlotSummary[] = []
  for (let i = 0; i < SAVE_SLOT_COUNT; i++) slots.push(slotSummary(store.read(i)))
  return { status, slots }
}
