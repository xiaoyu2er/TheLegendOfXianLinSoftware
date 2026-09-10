import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SCENE_TRACE_NAMES, readTrace } from '../state/trace'
import { repoPath } from '../test/repoPath'
import { EXPECTED } from './expected'

/**
 * 读档剧本在跨端比对里的表态（xl-i06.10）。
 *
 * 场景驱动器取图页装得出，可读档剧本的起手是 `Loader.load` —— 取图页照剧本头那套
 * `warmup → scene` 建出来的是另一个世界，比出来的差异是装错了，不是两端不同。所以
 * 这几条表 `unpainted`（「装得出、这一条比不了」），而且取图页对它们**当场抛**。
 *
 * `unpainted` 不许成为逃生舱（`expected.ts` 那段注释）：战斗那边由 `drawList.test.ts`
 * 回放到抛的那一拍来核；场景这边核两件事，两个方向都红：
 *
 * 1. 带 `load` 的场景真值 ⇔ 表 `unpainted` 且挂 xl-i06.12（分母是磁盘上的场景真值）；
 * 2. 取图页源码里那道拦截还在。⚠️ **这一条弱**：它是文本核对，证明的是「那一句写着」，
 *    不是「浏览器里真的抛了」—— 取图页要 Pixi 与 DOM，不在这个测试环境里起。
 */
describe('读档剧本的比对表态', () => {
  const loads = SCENE_TRACE_NAMES.filter((n) => readTrace(n).script.load !== undefined)

  it('带 load 的场景真值都表 unpainted、挂 xl-i06.12；表 unpainted 的场景真值都带 load', () => {
    expect(loads.length).toBeGreaterThan(0)
    for (const n of loads) {
      expect(EXPECTED[n], n).toMatchObject({ status: 'unpainted', issue: 'xl-i06.12' })
    }
    const unpaintedScenes = SCENE_TRACE_NAMES.filter((n) => EXPECTED[n]?.status === 'unpainted')
    expect(unpaintedScenes).toEqual(loads)
  })

  it('取图页的场景装配对读档剧本当场抛，抛的那句点名 xl-i06.12', () => {
    const src = readFileSync(repoPath('web/src/replay/main.ts'), 'utf8')
    const guard = src.indexOf('if (parsed.script.load !== undefined) {')
    const build = src.indexOf('world = { ...initiate(warm, scene), isScript: parsed.script.isScript }')
    expect(guard, '拦截那一句不在了').toBeGreaterThan(0)
    expect(build).toBeGreaterThan(guard)
    expect(src.slice(guard, build)).toMatch(/throw new Error\([\s\S]*xl-i06\.12/)
  })
})
