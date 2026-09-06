import { describe, expect, it } from 'vitest'
import { knownAssetIds } from '../assets/resolve'
import { createRole } from '../state/role'
import { DIRECTIONS } from '../state/types'
import type { RoleState } from '../state/types'
import { roleSprite } from './roleSprite'

/**
 * 帧下标的分母是可以数清楚的：4 个朝向 × 8 帧走 = 32，4 × 4 跑 = 16。
 * 全枚举一遍，要求**不重不漏地覆盖烘焙出来的每一张图**——漏一张的表现是
 * 主角走到某个朝向的某一帧突然消失，画面上根本看不出来。
 */
describe('主角贴图', () => {
  const base = createRole(12, 8)
  const withState = (patch: Partial<RoleState>): RoleState => ({ ...base, ...patch })

  it('走路：32 个下标不重不漏，正好是烘焙出来的 32 张行走图', () => {
    const assets = new Set<string>()
    for (const dir of DIRECTIONS) {
      for (let frame = 0; frame <= 7; frame++) {
        assets.add(roleSprite(withState({ dir, frame })).asset)
      }
    }
    expect([...assets].sort()).toEqual(
      knownAssetIds().filter((id) => id.startsWith('role:walk:')).sort(),
    )
  })

  it('跑步：16 个下标不重不漏，正好是烘焙出来的 16 张跑步图', () => {
    const assets = new Set<string>()
    for (const dir of DIRECTIONS) {
      for (let runFrame = 0; runFrame <= 3; runFrame++) {
        assets.add(roleSprite(withState({ dir, runFrame, running: true })).asset)
      }
    }
    expect([...assets].sort()).toEqual(
      knownAssetIds().filter((id) => id.startsWith('role:run:')).sort(),
    )
  })

  it('几何：脚站在格子上，图往上出头 32 px；跑步图宽 10 px，往左让 5 px', () => {
    const walk = roleSprite(withState({}))
    expect(walk).toMatchObject({ x: base.px, y: base.py - 32, width: 32, height: 64 })
    const run = roleSprite(withState({ running: true }))
    expect(run).toMatchObject({ x: base.px - 5, y: base.py - 32, width: 42, height: 64 })
    // 两张图的水平中心必须重合，否则走跑切换时主角会横着跳一下。
    expect(walk.x + walk.width / 2).toBe(run.x + run.width / 2)
  })
})
