import { readFileSync } from 'node:fs'
import { repoPath } from '../test/repoPath'
import type { InputEvent, TilePos } from './types'

/**
 * `tools/traces/out/*.trace.json` 的形状——**只声明状态层要用到的字段**。
 * 其余字段（对话、旁白、视口、绘制顺序）属于别的票，那边自己去读。
 *
 * 这是**测试与开发工具用的读取器**，跑在 Node 上（`node:fs`），不进浏览器包。
 */
export interface Trace {
  readonly format: string
  readonly script: { readonly name: string; readonly scene: string; readonly tickMs: number }
  readonly tickCount: number
  readonly ticks: readonly TraceTick[]
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
  readonly npcs: readonly (TilePos & { readonly type: number })[]
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
