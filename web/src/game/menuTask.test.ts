import { describe, expect, it } from 'vitest'
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
  it('前提：那份真值确实进了一本有 Task 段的脚本', () => {
    expect(SCENE).toMatch(/\.txt$/)
    expect(typeof JAVA_TASK).toBe('string')
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
