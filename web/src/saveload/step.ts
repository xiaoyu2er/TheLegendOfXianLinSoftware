import type { SaveFile } from '../save/format'
import type { SaveStore } from '../save/store'
import { inButton, prepareScenes } from './world'
import type { SaveLoadFrom, SaveLoadMode, SaveLoadWorld } from './world'

/**
 * 存读档面板的一步 = **一个输入事件**（与 saveload 真值同一个口径）。
 *
 * 形状与 saveload 真值 `input` 那一列逐字相同：
 *
 * - `enter` —— 进面板。原版替它做的三句（`FuncButtons` 的存档 / 提取、`StartPanel`
 *   的「承」）：`setLastPanel(from)` → `changeStateTo(mode)` → `switchTo("ls")`；
 * - `press` / `release` / `move` / `drag` —— 鼠标（`target` 只是真值的注释，不读）；
 * - `key` —— 退出键。原版的键先到 `GameLauncher.keyPressed`，当前面板是它才转来。
 */
export type SaveLoadInput =
  | { readonly e: 'enter'; readonly mode: SaveLoadMode; readonly from: SaveLoadFrom }
  | { readonly e: 'press' | 'release' | 'move' | 'drag'; readonly x: number; readonly y: number; readonly target?: string }
  | { readonly e: 'key'; readonly key: 'escape' }

/** `switchTo(...)` 的入参 —— 这个面板会切去的几块。 */
export type SaveLoadTarget = 'ls' | 'scene' | 'menu' | 'start'

/** 一步推出来的跨面板动作。状态机自己不知道换面板是什么意思，交给会话层。 */
export interface SaveLoadEffect {
  /** 这一步里依次调过的 `switchTo`。一次事件可能不止一次（见 `release` 的多监听器）。 */
  readonly switches: SaveLoadTarget[]
  /** 这一步里读过的槽（`loader.load(i)`），依次。重建那条路归 xl-i06.10。 */
  readonly loads: number[]
  /** 这一步写过的槽，依次。 */
  readonly saves: number[]
  /** 这一步里 `t.start()` 真的起了那条多余的场景循环（见 `SaveLoadWorld.sceneLoopStarted`）。 */
  sceneLoopStart: boolean
}

/** 状态机要的外部件。 */
export interface SaveLoadPorts {
  readonly store: SaveStore
  /** 此刻的游戏状态拼成一份档（`Recorder.save` 的那十个列表）。只在存档时调。 */
  readonly capture: () => SaveFile
}

export function noEffect(): SaveLoadEffect {
  return { switches: [], loads: [], saves: [], sceneLoopStart: false }
}

export function applySaveLoadInput(
  w: SaveLoadWorld,
  input: SaveLoadInput,
  ports: SaveLoadPorts,
): SaveLoadEffect {
  const fx = noEffect()
  switch (input.e) {
    case 'enter':
      w.lastPanel = input.from
      // `changeStateTo(state)`：换模式、换背景，**再调一次 `setMouse()`**。
      w.mode = input.mode
      w.listeners++
      fx.switches.push('ls')
      return fx
    case 'key':
      // `keyPressed`：只认 ESC，`returnToLastPanel()` → `switchTo(lastPanel)`。
      if (input.key !== 'escape') return fx
      if (w.lastPanel === null) {
        // 原版 `switchTo(null)` 会在 `switch` 上 NPE；从没进过面板也就收不到这个键。
        throw new Error('存读档面板还没进来过就按了退出键 —— lastPanel 是 null')
      }
      fx.switches.push(w.lastPanel)
      return fx
    case 'press':
      w.currentX = input.x
      w.currentY = input.y
      // 每个监听器各跑一遍 `isPressedButton`；它是幂等的，跑几遍都一样。
      for (let n = 0; n < w.listeners; n++) {
        for (const b of w.buttons) {
          if (inButton(b, input.x, input.y)) {
            b.isclicked = true
            b.glowing = false
          }
        }
      }
      return fx
    case 'release':
      w.currentX = input.x
      w.currentY = input.y
      // ⚠️ 每个监听器依次：先 `setButton()`（看 `isclicked` 办事），再对三颗按钮
      // `isRelesedButton`（**只有松手落在按钮框里才清 `isclicked`**）。于是：
      //
      // - 松手落在按下的那颗上：第一个监听器办完事就清掉，后面几个什么都不做 ——
      //   几对监听器与一对观察不到差别（saveload-menu 最后那次读档就是三对）；
      // - 按下之后拖出去再松手：`isclicked` 清不掉，**每个监听器各办一遍**，而且
      //   下一次在别处松手还会再办一遍。照抄。
      for (let n = 0; n < w.listeners; n++) {
        setButton(w, ports, fx)
        for (const b of w.buttons) {
          if (inButton(b, input.x, input.y)) b.isclicked = false
        }
      }
      return fx
    case 'move':
      w.currentX = input.x
      w.currentY = input.y
      for (const b of w.buttons) b.glowing = inButton(b, input.x, input.y)
      return fx
    case 'drag':
      // `mouseDragged` 只记坐标，不碰按钮。
      w.currentX = input.x
      w.currentY = input.y
      return fx
  }
}

/**
 * `setButton()`：
 *
 *     if (PanelState == LOAD) 被按着的那颗：if (!loader.isNull(i)) { load(i); if(!t.isAlive()) t.start(); switchTo("scene"); }
 *     else                    被按着的那颗：recorder.save(i); prepareScenes();
 *
 * **点空槽读档什么都不发生**就是那句 `isNull`。
 */
function setButton(w: SaveLoadWorld, ports: SaveLoadPorts, fx: SaveLoadEffect): void {
  w.buttons.forEach((b, i) => {
    if (!b.isclicked) return
    if (w.mode === 'load') {
      if (ports.store.read(i) === null) return
      fx.loads.push(i)
      if (!w.sceneLoopStarted) {
        w.sceneLoopStarted = true
        fx.sceneLoopStart = true
      }
      fx.switches.push('scene')
    } else {
      ports.store.write(i, ports.capture())
      fx.saves.push(i)
      prepareScenes(w, ports.store)
    }
  })
}
