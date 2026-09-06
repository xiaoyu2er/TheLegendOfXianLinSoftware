import { readFileSync } from 'node:fs'
import { repoPath } from '../test/repoPath'
import type { InputEvent, TilePos } from './types'

/**
 * `tools/traces/out/*.trace.json` 的形状——**只声明已经有人对齐的字段**。
 * 其余字段（对话、旁白）属于别的票，那边自己去读。
 *
 * 这是**测试与开发工具用的读取器**，跑在 Node 上（`node:fs`），不进浏览器包。
 */
export interface Trace {
  readonly format: string
  readonly script: { readonly name: string; readonly scene: string; readonly tickMs: number }
  readonly tickCount: number
  readonly ticks: readonly TraceTick[]
}

/**
 * trace 里一个 NPC 的快照。`dir` 用的是**原版的方向码**（1 左 / 5 右 / 9 下 /
 * 13 上），不是主角那套 `down/up/left/right` —— 脚本数据里就是这么写的，
 * 翻译一道只会多一个错位的机会。
 */
export interface TraceNpc extends TilePos {
  readonly px: number
  readonly py: number
  readonly type: number
  readonly dir: number
  readonly frame: number
}

export interface TraceTick {
  readonly t: number
  readonly vt: number
  readonly ip: number
  readonly input: readonly InputEvent[]
  readonly role: {
    readonly x: number
    readonly y: number
    readonly px: number
    readonly py: number
    readonly dir: 'down' | 'up' | 'left' | 'right'
    readonly frame: number
    readonly running: boolean
    readonly moving: boolean
  }
  readonly npcs: readonly TraceNpc[]
  /**
   * 对话与旁白，**只取 `step()` 那两道门要用的字段**（`ScenePanel.step()` 的
   * 第 3 步：`!dialogueEvent.isSpeaking && !narratage.isNarratage` 时才检查
   * NPC）。逐字打印那一套是 xl-9bd.10 / .11 的事，那边自己去补。
   *
   * `source` 为 `script` 才是 `isSpeaking`；`npc`（NPC 口头语）走的是
   * `npcEvent.isOral`，**不在**那道门里。
   */
  readonly dialogue: { readonly active: boolean; readonly source: 'npc' | 'script' | 'none' }
  readonly narratage: { readonly active: boolean }
  /** `OtherEvent.calOffset()` 的六元组，见 `scene/viewport.ts`。 */
  readonly viewport: {
    readonly offsetX: number
    readonly offsetY: number
    readonly firstTileX: number
    readonly lastTileX: number
    readonly firstTileY: number
    readonly lastTileY: number
  }
  /**
   * `ScenePanel.paint()` 里主角与 NPC 的先后。**旁白期间是 `null`**——那些帧
   * 原版一个精灵都不画，没有绘制顺序这回事（`dorm-intro` 开头就有一大段）。
   * 类型里保留这个 `null` 是有意的：收窄成两个字面量，回放时就会在旁白帧上
   * 断言一个原版根本没有的值。
   */
  readonly drawOrder: 'npcs-first' | 'hero-first' | null
}

/** 已导出的三份 trace。名字就是 `tools/traces/scripts/*.json` 的 `name`。 */
export const TRACE_NAMES = ['dorm-walk', 'bigmap-walk', 'dorm-intro'] as const

export function readTrace(name: string): Trace {
  const path = repoPath('tools/traces/out', `${name}.trace.json`)
  const trace = JSON.parse(readFileSync(path, 'utf8')) as Trace
  if (trace.format !== 'xianlin-trace/1') {
    throw new Error(`${path} 的 format 是 ${trace.format}，本读取器只认 xianlin-trace/1。`)
  }
  return trace
}

/** trace 里的场景文件名 `宿舍.txt` → 烘焙注册表里的场景名 `宿舍`。 */
export function sceneNameOf(trace: Trace): string {
  return trace.script.scene.replace(/\.txt$/, '')
}
