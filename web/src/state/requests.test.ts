import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { TICK_MS, createWorld, step } from './step'
import { NO_REQUESTS, hasRequest } from './types'
import type { SceneRequests, World } from './types'

/**
 * 「只亮一拍的请求」那一族（xl-i06.3）。
 *
 * 几个、叫什么，**从 `NO_REQUESTS` 现读**，这里不写名单：它的类型是
 * `SceneRequests` 的键逐个映成 `null`，少一个键 `pnpm typecheck` 就红，所以它
 * 是分母，不是登记。每个请求**端到端**有没有被会话接住，另有各自的判据
 * （`session.test.ts` / `doors.test.ts` 里那几条「不会被同批的下一拍吞掉」）；
 * 这里守的是那几条共用的两件事：**亮了就停批**、**下一拍一定熄**。
 */
describe('只亮一拍的请求', () => {
  const world = createWorld(getScene('宿舍'))
  const keys = Object.keys(NO_REQUESTS) as (keyof SceneRequests)[]
  /** 随便一个非 `null` 的值。`hasRequest` 只认「是不是 null」。 */
  const LIT = {} as never

  const lit = (k: keyof SceneRequests): World => ({ ...world, [k]: LIT })

  it('分母不是空的 —— 否则下面两条对着零个请求恒真', () => {
    expect(keys.length).toBeGreaterThan(0)
  })

  it('一个都没亮时不停批', () => {
    expect(hasRequest(world)).toBe(false)
  })

  for (const k of keys) {
    it(`${k} 一亮就停批（state/loop.ts 靠它不吞掉这一拍）`, () => {
      expect(hasRequest(lit(k))).toBe(true)
    })

    it(`${k} 亮着进 step()，出来一定熄了`, () => {
      expect(step(lit(k), [], TICK_MS)[k]).toBeNull()
    })
  }

  it('新建的世界里一个都不亮', () => {
    for (const k of keys) expect(world[k], k).toBeNull()
  })
})
