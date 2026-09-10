import { SAVE_SLOT_COUNT, slotSummary } from '../save/store'
import type { SaveStore } from '../save/store'

/**
 * 存读档面板的状态层（xl-i06.9）—— `start.LoadAndSavePanel` 里**改状态的那一半**。
 * 画的那一半在 `render/drawList.ts`。
 *
 * ## 原版这个面板**只有一份**，从开机活到关机
 *
 * `GameLauncher` 构造函数里 `lsPanel = new LoadAndSavePanel()` 一次，此后菜单的
 * 「存档 / 提取」与标题的「承」都只调 `setLastPanel` + `changeStateTo` + `switchTo("ls")`
 * 三句，从不重建。于是面板上的三样东西**跨次进出都留着**：
 *
 * - `isRoleExist` —— `prepareScenes()` 只把它往 1 置、**从不清零**。一个三人档被
 *   两人档覆盖之后，摘要上第三个人还在（saveload-menu 第 4 步）。这份记忆就是
 *   {@link SaveLoadWorld.roles}，而它是 `store.ts` 的 `slotSummary` 算不出来的：
 *   那个函数只看一份档本身说了什么；
 * - `maps` / `tasks` —— 只在构造函数与存档之后重算，**进面板不重算**；
 * - 鼠标监听器 —— `changeStateTo()` 每调一次就再挂一对（原版缺陷，见 `step.ts`）。
 *
 * 这一层的会话把它**推迟到头一次进面板才建**（`game/session.ts`）：开机时存档仓库
 * 可能还在从浏览器存储里读，那时建出来的摘要是一句谎话（`save/store.ts` 的就绪
 * 标志）。推迟与原版观察不到差别 —— 原版构造与头一次进面板之间，没有任何东西写档。
 *
 * ## 不在这里的：动画帧号与鼠标图
 *
 * 那条 10 Hz 的 `while(true)` 线程只推绘制量（帧号、当前图片），与点击判定、槽位
 * 空不空走完全不相交的两条链（xl-i06.6 量过）。不复刻，同菜单那四条同形线程一族；
 * 帧号归渲染层自己数。**按钮上那段光效开没开**是状态（`isMoveIn` 改它），在这里。
 */
export type SaveLoadMode = 'save' | 'load'

/** 进来之前那块面板，也就是退出键回哪去（`setLastPanel` 的两个调用点）。 */
export type SaveLoadFrom = 'menu' | 'start'

/**
 * `StartButton` 的可断言字段。三颗按钮三态同一张图（`空白.png`），所以 `buttonImage`
 * 换成哪一张画面上看不出来，不记；记的是它身上那段光效（`StartAnimation`）的开关。
 */
export interface SlotButton {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  isclicked: boolean
  /** `animation.isStop` 取反：`isMoveIn` 进来就开、出去就停，按下也停。 */
  glowing: boolean
}

export interface SaveLoadWorld {
  /** `LoadAndSavePanel.PanelState`。原版是 static，初值 `false` = `LOAD`。 */
  mode: SaveLoadMode
  /** `lastPanel`。构造完是 `null`，第一次进面板之前没人设它。 */
  lastPanel: SaveLoadFrom | null
  /** `isRoleExist`：`[槽][张 / 陆 / 文]`，**只置不清**。 */
  readonly roles: boolean[][]
  /** `maps` / `tasks`：最近一次 `prepareScenes()` 读出来的。 */
  readonly maps: string[]
  readonly tasks: string[]
  /**
   * 这个槽的任务文本画不画 —— `paint()` 里 `if(tasks.get(i)!="无")`，**引用比较**。
   * 空槽那一支 `tasks.add("无")` 是编译期字面量、与判据那个 `"无"` 是同一个对象；
   * 从档里读出来的字符串永远是新对象，哪怕内容恰好是「无」。所以它等价于「最近
   * 一次重算时这个槽不是空的」，**不看文本**。照抄（缺陷登记在 xl-1dv）。
   */
  readonly taskDrawn: boolean[]
  readonly buttons: SlotButton[]
  /** `currentX / currentY`：鼠标图画在这里。不进真值（每一步的落点已在 input 里）。 */
  currentX: number
  currentY: number
  /** 挂着几对鼠标监听器：构造函数一对，每次 `changeStateTo` 再一对。 */
  listeners: number
  /**
   * 字段 `t = new Thread(GameLauncher.scenePanel)` 起过没有。读档那一下
   * `if(!t.isAlive()) t.start()` —— 原版在读档时**多起一条场景循环**，那是 M6
   * 唯一明写不复刻的一条（场景双倍速）。这里只记「原版此刻会起它」，真值的
   * `intercept.sceneLoopStart` 就是这个；会话层不照做。
   */
  sceneLoopStarted: boolean
}

/**
 * 三颗按钮：`new StartButton(800, 150 + i * 200, 80, 80, …)`。与 GBK 源码对撞见
 * `saveload/step.test.ts`（最后一条）。
 */
export const SLOT_BUTTON_X = 800
export const SLOT_BUTTON_Y0 = 150
export const SLOT_STRIDE = 200
export const SLOT_BUTTON_SIZE = 80

/** 构造函数：建三颗按钮、挂一对监听器、`prepareScenes()` 一次。仓库必须已就绪。 */
export function createSaveLoadWorld(store: SaveStore): SaveLoadWorld {
  const w: SaveLoadWorld = {
    mode: 'load',
    lastPanel: null,
    roles: Array.from({ length: SAVE_SLOT_COUNT }, () => [false, false, false]),
    maps: [],
    tasks: [],
    taskDrawn: [],
    buttons: Array.from({ length: SAVE_SLOT_COUNT }, (_, i) => ({
      x: SLOT_BUTTON_X,
      y: SLOT_BUTTON_Y0 + i * SLOT_STRIDE,
      width: SLOT_BUTTON_SIZE,
      height: SLOT_BUTTON_SIZE,
      isclicked: false,
      glowing: false,
    })),
    currentX: 0,
    currentY: 0,
    listeners: 1,
    sceneLoopStarted: false,
  }
  prepareScenes(w, store)
  return w
}

/**
 * `prepareScenes()`：清掉 `maps` / `tasks` 重读三个槽；`isRoleExist` **只置 1**。
 * 一个槽的档说了什么由 `store.ts` 的 `slotSummary` 算（空槽是字面量「无」）。
 */
export function prepareScenes(w: SaveLoadWorld, store: SaveStore): void {
  w.maps.length = 0
  w.tasks.length = 0
  w.taskDrawn.length = 0
  for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
    const save = store.read(i)
    const s = slotSummary(save)
    s.roles.forEach((has, k) => {
      if (has) w.roles[i]![k] = true
    })
    w.maps.push(s.map)
    w.tasks.push(s.task)
    w.taskDrawn.push(save !== null)
  }
}

/** 第 i 颗按钮命中框的中心（导出器 `SaveLoadDriver.center` 同一个算法）。只给测试与回放用。 */
export function slotCenter(i: number): { x: number; y: number } {
  return { x: SLOT_BUTTON_X - 15 + SLOT_BUTTON_SIZE / 2, y: SLOT_BUTTON_Y0 + i * SLOT_STRIDE - 6 + SLOT_BUTTON_SIZE / 2 }
}

/** `StartButton` 的命中框：`x-15 < cx < x+w-15 && y-6 < cy < y+h-6`（与 `GameButton` 同一对历史偏移）。 */
export function inButton(b: SlotButton, x: number, y: number): boolean {
  return x > b.x - 15 && x < b.x + b.width - 15 && y > b.y - 6 && y < b.y + b.height - 6
}
