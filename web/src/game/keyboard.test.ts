import { describe, expect, it } from 'vitest'
import { toInputEvent } from './keyboard'

describe('键盘映射', () => {
  it('四个方向键映射成四个方向，一个不少', () => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
    const got = keys.map((key) =>
      toInputEvent({ type: 'keydown', key, ctrlKey: false, shiftKey: false }),
    )
    expect(got).toEqual([
      { e: 'press', k: 'left', ctrl: false },
      { e: 'press', k: 'right', ctrl: false },
      { e: 'press', k: 'up', ctrl: false },
      { e: 'press', k: 'down', ctrl: false },
    ])
  })

  it('松开是 release，不带 ctrl（原版松手只置 canStop）', () => {
    expect(toInputEvent({ type: 'keyup', key: 'ArrowUp', ctrlKey: true, shiftKey: false })).toEqual({
      e: 'release',
      k: 'up',
    })
  })

  it('Ctrl 与 Shift 都算跑步键', () => {
    for (const mods of [
      { ctrlKey: true, shiftKey: false },
      { ctrlKey: false, shiftKey: true },
    ]) {
      expect(toInputEvent({ type: 'keydown', key: 'ArrowLeft', ...mods })).toEqual({
        e: 'press',
        k: 'left',
        ctrl: true,
      })
    }
  })

  it('空格认成 space —— 与 trace 里的键名逐字一致', () => {
    expect(toInputEvent({ type: 'keydown', key: ' ', ctrlKey: false, shiftKey: false })).toEqual({
      e: 'press',
      k: 'space',
      ctrl: false,
    })
  })

  it('回车认成 enter —— 与 trace 里的键名逐字一致（选择框的确认键）', () => {
    expect(toInputEvent({ type: 'keydown', key: 'Enter', ctrlKey: false, shiftKey: false })).toEqual(
      { e: 'press', k: 'enter', ctrl: false },
    )
  })

  it('别的键一概返回 null（Esc 进菜单属于别的票）', () => {
    for (const key of ['Escape', 'a', 'Tab']) {
      expect(toInputEvent({ type: 'keydown', key, ctrlKey: false, shiftKey: false })).toBeNull()
    }
  })
})
