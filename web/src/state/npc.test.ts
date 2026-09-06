import { describe, expect, it } from 'vitest'
import { KNOWN_DEFECTS } from '../assets/knownMissing'
import { scanSceneAssets } from '../assets/sceneAssets'
import { SCENE_NAMES } from '../data/scenes'
import { getScene } from '../data/scenesEager'
import {
  NPC_DOWN,
  NPC_LEFT,
  NPC_RIGHT,
  NPC_TIMER_MS,
  NPC_UP,
  createNpcs,
  tickNpcTimers,
  toNpcDraft,
} from './npc'
import type { NpcState } from './npc'

/**
 * NPC 层的**结构性**检查：逐 tick 的行为对齐在 `traceReplay.test.ts`
 * （期望值一个都不是手写的，全部来自原版跑出来的 trace）。这里管的是另一件事
 * ——把 96 个场景的 NPC 数据整个扫一遍，看这一层认不认得出来。
 *
 * 每个用例的分母都**从数据源头数出来**，不写"目前只有 N 个"：并行的票随时会
 * 改烘焙范围，写死的数字合并时一定冲突，而"少了要响"这件事又必须保住。
 */
describe('NPC 摆放与四种运动状态', () => {
  /** 96 份烘焙产物里的每一条 NPC 数据，带上出处。 */
  const rows = SCENE_NAMES.flatMap((name) => {
    const scene = getScene(name)
    return (scene.npcList ?? []).map((row, i) => ({ scene: name, i, row }))
  })

  /** `KNOWN_DEFECTS` 里那些位置所在的场景 —— 数据坏到连原版都会崩的地方。 */
  const brokenScenes = new Set(
    KNOWN_DEFECTS.map((d) => d.where.split(' ')[0]?.replace(/\.txt$/, '')),
  )

  it('有 NPC 的场景与 NPC 的条数都不为零 —— 否则下面几条全是空转', () => {
    expect(rows.length).toBeGreaterThan(0)
    expect(SCENE_NAMES.length).toBeGreaterThan(0)
    expect(brokenScenes.size).toBeGreaterThan(0)
  })

  it('数据里的状态码，原版建得出来的与建不出来的各是哪些', () => {
    const codes = [...new Set(rows.map((r) => r.row[0]))].sort()
    // `tools.Reader` 的 if/else 链只有 0/1/2 三个分支：注释里写着的
    // `3.四向运动` 没有构造函数，那样的 NPC 根本不会被创建。今天的数据里一条
    // 都没有 —— 这一行是**现场数出来的**，不是抄的。哪天数据里真出现一个 3，
    // 这里会红，那时要连着 `assets/sceneAssets.ts` 的 defect 分支一起看。
    expect(codes).toEqual(['0', '1', '2'])
  })

  it('每个场景建出来的 NPC 条数 = 数据里状态码是 0/1/2 的条数', () => {
    let checked = 0
    for (const name of SCENE_NAMES) {
      if (brokenScenes.has(name)) continue
      const scene = getScene(name)
      const expected = (scene.npcList ?? []).filter((row) =>
        ['0', '1', '2'].includes(row[0] ?? ''),
      ).length
      expect({ name, n: createNpcs(scene).length }).toEqual({ name, n: expected })
      checked++
    }
    // 分母：跳过的只该是已知坏数据那几个场景。
    expect(checked).toBe(SCENE_NAMES.length - brokenScenes.size)
  })

  it('字段少了就抛，而且抛的正好是已知坏数据那几处 —— 原版在那里是崩', () => {
    const threw = SCENE_NAMES.filter((name) => {
      try {
        createNpcs(getScene(name))
        return false
      } catch {
        return true
      }
    })
    // 两头都会红：多抛一个说明这一层比原版更挑剔，少抛一个说明它把
    // "走进去就崩"悄悄咽了下去。
    expect(threw.sort()).toEqual([...brokenScenes].sort())
  })

  it('NPC 的图片文件名与资源扫描器拼出来的路径逐条一致', () => {
    // 两处**各自**按 `NPC.java` 的三个构造函数拼路径：这一层要拿它去查纹理，
    // `assets/sceneAssets.ts` 要拿它去 stat 文件。拼法分家的表现是"校验说
    // 素材齐全，运行时却查不到纹理"，两边都不会响。
    let compared = 0
    for (const name of SCENE_NAMES) {
      if (brokenScenes.has(name)) continue
      const scene = getScene(name)
      const fromScan = scanSceneAssets(scene)
        .refs.filter((r) => r.kind === 'npc')
        .map((r) => r.raw)
      const fromState = createNpcs(scene).flatMap((npc) => npc.images.map((f) => `NPCs/${f}`))
      expect({ name, paths: fromState }).toEqual({ name, paths: fromScan })
      compared += fromScan.length
    }
    expect(compared).toBeGreaterThan(0)
  })

  it('单向走动的素材必须够 8 帧 —— 不够的话原版会下标越界', () => {
    // `NPC.walk` 的 count 在一个来回里跑满 0..7，而 `drawNPC` 直接
    // `images.get(count)`。帧数少于 8 的 NPC，原版走到回程第一帧就
    // ArrayIndexOutOfBoundsException。数据里有没有这种，现场数。
    expect(walkers().filter((npc) => npc.images.length < 8)).toEqual([])
    expect(walkers().length).toBeGreaterThan(0)
  })

  it('初始方向是 5 或 13 的单向走动 NPC 永远不动 —— 数据里有没有，现场数', () => {
    // `NPC.walk` 的 case 5 / case 13 要求 count 落在 4..7，而 count 的初值是 0，
    // 两个条件都不成立：每 200 ms 什么也不发生。这是原版的行为，不是要修的
    // bug。今天的数据里一条都没有，所以这条性质在真值里看不见 —— 用一个
    // **合成的** NPC 把它钉住，并同时断言数据里确实没有。
    expect(walkers().filter((npc) => npc.dir === NPC_RIGHT || npc.dir === NPC_UP)).toEqual([])
    expect([...new Set(walkers().map((npc) => npc.dir))].sort((a, b) => a - b)).toEqual([
      NPC_LEFT,
      NPC_DOWN,
    ])

    const stuck = toNpcDraft({ ...walkers()[0]!, dir: NPC_RIGHT })
    const before = { px: stuck.px, py: stuck.py, frame: stuck.frame }
    for (let now = 0; now < 10 * NPC_TIMER_MS; now += 10) tickNpcTimers(stuck, now)
    expect({ px: stuck.px, py: stuck.py, frame: stuck.frame }).toEqual(before)
  })

  function walkers(): NpcState[] {
    return SCENE_NAMES.filter((name) => !brokenScenes.has(name))
      .flatMap((name) => createNpcs(getScene(name)))
      .filter((npc) => npc.type === 1)
  }
})
