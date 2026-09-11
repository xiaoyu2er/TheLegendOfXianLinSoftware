import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../test/repoPath'
import { getScene } from '../data/scenesEager'
import { readMenuTrace } from '../menu/trace'
import { createWorld, initiate } from '../state/step'
import { menuTaskOf } from './menuTask'

/**
 * 游戏里喂给菜单顶栏的那一句（xl-03x.10）。期望值取原版读数，不手写：
 * `menu-task` 那份真值是导出器进了 `setup.scene` 那一本之后 `Reader.task` 的样子。
 */
const TRACE = readMenuTrace('menu-task')
const SCENE = TRACE.script.setup.scene!
const JAVA_TASK = TRACE.ticks[0]!['task'] as string

describe('menuTaskOf：菜单顶栏读场景那一侧的 Reader.task', () => {
  it('前提：那份真值的 task 非 null —— 否则下面比的是 null 对 null', () => {
    expect(typeof JAVA_TASK).toBe('string')
  })

  it('游戏里每一处画菜单都喂 menuTaskOf —— 那一行退回 menuDrawList(world) 就红', () => {
    // useGame 是 React hook，没法在 Node 上跑；这里读它的源码。分母是文件里
    // `menuDrawList(` 的调用处数，一处都没有时要响（文件改名 / 挪走与「都喂了」不能同形）。
    const src = readFileSync(repoPath('web/src/game/useGame.ts'), 'utf8')
    // `menuDrawList(` 带括号，import 那一行匹配不到。
    const calls = src.match(/menuDrawList\([^\n]*/g) ?? []
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call).toContain('menuTaskOf(next.scene)')
  })

  it('进了那一本之后，顶栏喂的是原版读出来的那一句', () => {
    const world = createWorld(getScene(SCENE.replace(/\.txt$/, '')))
    expect(menuTaskOf({ world })).toBe(JAVA_TASK)
  })

  it('再进一本没有 Task 段的，留着上一本的（static 没人清）', () => {
    const first = createWorld(getScene(SCENE.replace(/\.txt$/, '')))
    const dorm = initiate(first, getScene('宿舍'))
    // 前提：宿舍确实没有 Task 段 —— 否则这条比的是宿舍自己的任务。
    expect(createWorld(getScene('宿舍')).readerStatics.task).toBeNull()
    expect(menuTaskOf({ world: dorm })).toBe(JAVA_TASK)
  })

  it('还没开局（没有场景那一侧）是 null，画成「无」', () => {
    expect(menuTaskOf(null)).toBeNull()
  })
})
