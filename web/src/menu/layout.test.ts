import { describe, expect, it } from 'vitest'
import { javaSource } from '../test/javaSource'
import {
  HEAD_GAP,
  HEAD_H,
  HEAD_POS,
  HEAD_W,
  SCOLL_X,
  SCOLL_Y,
  TABS,
  TAB_H,
  TAB_W,
  TAB_X,
  TAB_Y,
  tabX,
} from './layout'

/** 一份源码里 `int name=<表达式>;` 的右边，原样取出（含 `60+32` 这种）。 */
function intField(source: string, name: string): string {
  const matches = [...source.matchAll(new RegExp(`int\\s+${name}\\s*=\\s*([^;]+);`, 'g'))]
  if (matches.length !== 1) {
    throw new Error(`源码里 ${name} 的初始化式解出了 ${matches.length} 处，应为 1 处`)
  }
  return matches[0]![1]!.trim()
}

describe('菜单骨架的几何，对回原版的字段初始化式', () => {
  const command = javaSource('src/menu/Command.java')
  const scoll = javaSource('src/menu/Scoll.java')

  it('顶栏四颗页签', () => {
    expect(String(TAB_W)).toBe(intField(command, 'width_of_GameButton'))
    expect(String(TAB_H)).toBe(intField(command, 'height_of_GameButton'))
    expect(String(TAB_X)).toBe(intField(command, 'x_of_GameButton'))
    expect(String(TAB_Y)).toBe(intField(command, 'y_of_GameButton'))
  })

  it('四颗页签的次序与横向倍数，从 addGameButton() 里解出来', () => {
    // 四段 `new MenuButton(x_of_GameButton…, y_of_GameButton, …)`，按出现顺序。
    const matches = [
      ...command.matchAll(
        /new MenuButton\(x_of_GameButton(?:\+(\d+)\*width_of_GameButton)?,\s*y_of_GameButton/g,
      ),
    ]
    expect(matches, 'Command.addGameButton 里没解出四段').toHaveLength(4)
    expect(matches.map((m) => Number(m[1] ?? 0))).toEqual(TABS.map((t) => t.multiple))
    // 顺序也是判据：原版的顺序是 物品 / 装备 / 奇术 / 天书，而 `checkPressed`
    // 那串 if-else 的分支顺序是 物品 / 奇术 / 天书 / 装备 —— 两者不同，抄混了
    // 也画得出来。这里核的是**建按钮**那一段。
    expect(TABS.map((t) => t.key)).toEqual(['thing', 'equip', 'magic', 'func'])
    expect(TABS.map((t) => tabX(t.multiple))).toEqual([400, 504, 608, 712])
  })

  it('卷轴与三颗头像', () => {
    expect(intField(scoll, 'x_scoll')).toBe('60+32')
    expect(SCOLL_X).toBe(92)
    expect(String(SCOLL_Y)).toBe(intField(scoll, 'y_scoll'))
    expect(String(HEAD_W)).toBe(intField(scoll, 'width_head'))
    expect(String(HEAD_H)).toBe(intField(scoll, 'height_head'))
    expect(String(HEAD_GAP)).toBe(intField(scoll, 'hgap'))
    expect(intField(scoll, 'x_head')).toBe('x_scoll+14')
    expect(intField(scoll, 'y_head')).toBe('y_scoll+20')
  })

  it('二号头像低 6 像素 —— 这不是笔误', () => {
    // 原版：`new MenuButton(x_head+width_head+hgap, y_head+6, …)`。
    expect(scoll).toContain('x_head+width_head+hgap, y_head+6')
    expect(HEAD_POS.map((p) => p.y)).toEqual([90, 96, 90])
    expect(HEAD_POS.map((p) => p.hero)).toEqual([1, 2, 4])
    expect(HEAD_POS.map((p) => p.x)).toEqual([106, 156, 206])
  })
})
