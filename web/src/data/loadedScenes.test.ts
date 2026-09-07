import { readdirSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { repoPath } from '../test/repoPath'
import { step } from '../state/step'
import { readTrace, replayWorld, sceneSourceOf } from '../state/trace'
import type { World } from '../state/types'
import { exitTargets } from './loadedScenes'
import { sceneNameFromPath } from './scenes'
import { getScene } from './scenesEager'

/**
 * 出口预取（xl-9br）。
 *
 * `state/step.ts` 的 `applyExit` 有三条分支，进的分别是出口表的 `nextScene[i]`、
 * `nextScript[2]` 与 `currentScript[2]`。后两条**目标场景名压根不在出口表里**，
 * 所以 `exitTargets` 少预取它们的表现是：踩上那个出口时 `step()` 抛"这个场景
 * 没准备好"。
 *
 * 这一条修复在 xl-9bd.13 里做过，但没有任何单元测试守着：把 `exitTargets`
 * 改回只取 `nextScene`，`pnpm test` 全绿，只有 `tools/compare-frames.sh`
 * （**不在 CI 里**）会红。这个文件补的就是这个洞。
 *
 * 判据全部取自真值 `tools/traces/out/`：剧本走过哪几次出口、每一次进的是哪个
 * 场景，都是回放出来的，不是手抄的。名单从目录现扫，分母是它自己的长度。
 */

const TRACE_NAMES = readdirSync(repoPath('tools/traces/out'))
  .filter((f) => f.endsWith('.trace.json'))
  .map((f) => f.replace(/\.trace\.json$/, ''))
  .sort()

/** 真值里的一次换场景，连同"换之前那个世界预取了些什么"。 */
interface Switch {
  readonly trace: string
  readonly from: string
  readonly to: string
  /** 进的这个场景，是不是就写在出口表的 `nextScene` 里（分支 3）。 */
  readonly inNextScene: boolean
  /** 进的这个场景来自 `nextScript[2]`（分支 1：剧情往前走一段）。 */
  readonly viaNextScript: boolean
  /** 进的这个场景来自 `currentScript[2]`（分支 2：走回当前这段剧情）。 */
  readonly viaCurrentScript: boolean
  /** 换之前那个世界的预取目标，已经抹平扩展名。 */
  readonly prefetched: readonly string[]
}

const stem = (file: string): string => sceneNameFromPath(file).replace(/\.txt$/, '')

/** 照真值回放一遍，把每一次换场景收下来。场景数据这里管够（`scenesEager`），
 *  收的是"进了哪儿"这个事实本身，与预取到底取没取到无关。 */
function switchesOf(name: string): Switch[] {
  const trace = readTrace(name)
  const scenes = sceneSourceOf(getScene)
  const out: Switch[] = []
  let world = replayWorld(trace, getScene)
  for (const tick of trace.ticks) {
    const before: World = world
    world = step(world, tick.input, trace.script.tickMs, scenes)
    if (world.scene === before.scene) continue
    const to = stem(world.scene)
    out.push({
      trace: name,
      from: stem(before.scene),
      to,
      inNextScene: (before.exit?.nextScene ?? []).some((f) => stem(f) === to),
      viaNextScript: before.nextScript?.[2] !== undefined && stem(before.nextScript[2]) === to,
      viaCurrentScript:
        before.currentScript[2] !== undefined && stem(before.currentScript[2]) === to,
      prefetched: exitTargets(before).map(stem),
    })
  }
  return out
}

const SWITCHES = TRACE_NAMES.flatMap(switchesOf)

describe('出口预取的目标', () => {
  it('真值里确有走 nextScript[2] 与 currentScript[2] 两支的出口', () => {
    // 这一条盯的是**真值**，不是实现：剧本里一次都没走过那两支的话，下面那条
    // "都预取到了"在一份只走 nextScene 的真值上照样全绿 —— 而它正是被回退时
    // 那 521 条测试的处境。
    expect(TRACE_NAMES.length).toBeGreaterThan(0)
    expect(SWITCHES.length).toBeGreaterThan(0)

    const extra = SWITCHES.filter((s) => !s.inNextScene)
    expect(extra.filter((s) => s.viaNextScript).length).toBeGreaterThan(0)
    expect(extra.filter((s) => s.viaCurrentScript).length).toBeGreaterThan(0)
    // 出口表之外只有这两支：真值里冒出第三种来源，说明 applyExit 又多了一条
    // 分支，而这里的预取名单还不知道。
    expect(extra.filter((s) => !s.viaNextScript && !s.viaCurrentScript)).toEqual([])
  })

  it('每一次换场景，进的那个场景都在换之前的预取名单里', () => {
    // 分母是换场景的次数本身（真值现数出来的），不是手写的数字。
    expect(SWITCHES.length).toBeGreaterThan(0)
    expect(SWITCHES.filter((s) => !s.prefetched.includes(s.to))).toEqual([])
  })
})

describe('只拿预取到手的场景回放', () => {
  // 这一组跑的是 `replay/main.ts` 那条真路径：场景来源只有 `loadedSceneSource`，
  // 预取漏了谁，`step()` 当场抛"这个场景没准备好"——失败的样子与成功不一样。
  it.each(TRACE_NAMES)('%s 整条剧本走得完', async (name) => {
    // 每份剧本都要一份干净的 LOADED：上一份剧本顺手取过的场景会把这一份的
    // 缺口盖住（真实教训见 exitTargets 的注释）。
    vi.resetModules()
    const { exitsReady, loadedSceneSource, prepareExits, rememberScene } = await import(
      './loadedScenes'
    )
    const trace = readTrace(name)
    // 照 `replay/main.ts` 的次序：预热与进场那两份不走出口，得有人塞。
    if (trace.script.warmup !== null) {
      rememberScene(stem(trace.script.warmup), getScene(stem(trace.script.warmup)))
    }
    rememberScene(stem(trace.script.scene), getScene(stem(trace.script.scene)))

    let world = replayWorld(trace, getScene)
    for (const tick of trace.ticks) {
      if (!exitsReady(world)) await prepareExits(world)
      world = step(world, tick.input, trace.script.tickMs, loadedSceneSource)
    }
    // 走完停在真值说的那个场景上：中途抛没抛之外，还得真的走到了地方。
    expect(world.scene).toBe(trace.ticks[trace.ticks.length - 1]!.scene)
  })
})
