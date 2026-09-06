import { describe, expect, it } from 'vitest'
import { getScene } from '../data/scenesEager'
import { step } from './step'
import { readTrace, replayWorld, sceneSourceOf } from './trace'
import type { Trace, TraceTick } from './trace'
import type { World } from './types'

/**
 * M1 的验收（xl-9bd.13）。
 *
 * 这张票要的不是"各个机制看起来都做完了"，而是一条可复现的判据：
 * **一条从头走到尾的剧本，两端都过**。剧本是 `tools/traces/scripts/milestone.json`，
 * 走的就是原版的开场 ——
 *
 *   脚本1（宿舍）  旁白播完 → 23 句主线对话按完 → 跟曾书书搭一次话
 *   → 出门          脚本2（大地图夜）：那边的旁白与 27 句对话
 *   → 进大活夜      背景音乐换一次
 *   → 出大活夜      回到大地图上，背景音乐再换一次
 *
 * 判据分三层，这个文件是**中间那层**：
 *
 * 1. 数据：`tools/ground-truth/` 的 96 份黄金测试（`data/scenes.test.ts`）。
 * 2. 行为：`traceReplay.test.ts` 已经在**每一份** trace 上逐 tick 比对了主角、
 *    NPC、对话、旁白、视口 —— milestone 这条自然也在里面。这里不重复那件事，
 *    只回答它答不了的那个问题：**这条剧本真的把四个环节都走到了吗。**
 *    逐 tick 全绿而剧本只是在原地站了一万拍，上面那条一样是绿的。
 * 3. 像素：`tools/compare-frames.sh milestone`（预期见 `compare/expected.ts`）。
 *
 * 所有的"多少次"都不是手抄的：**分母一律从真值里现数**，然后要求 Web 侧
 * 自己推出来的世界数出同一个数。写死次数的话，剧本改一步这里就得跟着改，
 * 而改错了看起来跟"实现回归了"一模一样。
 */
describe('M1 里程碑剧本', () => {
  const trace = readTrace('milestone')
  const scenes = sceneSourceOf(getScene)

  /** 一次走完，把两边关心的事实各收一份。 */
  const beats = collect(trace)

  it('剧本本身横跨多个场景、含旁白、含主线对话、含 NPC 口头语', () => {
    // 这一条盯的是**剧本**，不是实现：真值里少了任何一个环节，M1 的判据就
    // 不再是"端到端"，而下面那些"两边一致"的断言在一条空剧本上照样全绿。
    expect(beats.truth.scenes.length).toBeGreaterThan(1)
    expect(beats.truth.narratageScenes.length).toBeGreaterThan(0)
    expect(beats.truth.scriptSentences.length).toBeGreaterThan(0)
    expect(beats.truth.oralSentences.length).toBeGreaterThan(0)
    // 出口至少走过两回，且背景音乐至少换过一次 —— "走到大地图并听到背景音乐
    // 切换"是这张票写在验收里的那一句。
    expect(beats.truth.switches.length).toBeGreaterThan(1)
    expect(beats.truth.bgm.length).toBeGreaterThan(1)
  })

  it('Web 侧自己推出来的世界，四个环节与真值逐项一致', () => {
    // 一项一项对，而不是先 &&' 起来：不一致时要一眼看出是哪个环节。
    expect(beats.web.scenes).toEqual(beats.truth.scenes)
    expect(beats.web.narratageScenes).toEqual(beats.truth.narratageScenes)
    expect(beats.web.scriptSentences).toEqual(beats.truth.scriptSentences)
    expect(beats.web.oralSentences).toEqual(beats.truth.oralSentences)
    expect(beats.web.switches).toEqual(beats.truth.switches)
    expect(beats.web.bgm).toEqual(beats.truth.bgm)
  })

  it('每一次换场景，声明的背景音乐就是新场景 Music 段里写的那首', () => {
    // 分母是换场景的次数本身。这条与上面那条不同：上面比的是"两端一致"，
    // 两端一起错了也一致；这里比的是"跟数据一致"。
    const followed = beats.truth.switches.filter(
      (s) => s.bgm === getScene(stem(s.to)).sceneMusic,
    )
    expect(followed).toEqual(beats.truth.switches)
  })

  it('走完之后停在一张卷动大地图上，而且那首背景音乐确实换过', () => {
    const last = beats.truth.scenes[beats.truth.scenes.length - 1]!
    const scene = getScene(stem(last))
    // "大地图"的可核定义是**地图比舞台大**（1024×640 = 32×20 格），
    // 不是名字里带"大地图"三个字。
    expect(scene.col * scene.row).toBeGreaterThan(32 * 20)
    // 收尾那一首与开场那一首不是同一首。
    expect(beats.truth.bgm[beats.truth.bgm.length - 1]).not.toBe(beats.truth.bgm[0])
  })

  /**
   * 逐 tick 走一遍，把 Web 侧世界与真值各自的"环节"收成两份同构的记录。
   * `step()` 的入参只有真值里那一 tick 实际按下的键（见 `traceReplay.test.ts`
   * 顶上的说明）—— 状态字段一个都不喂。
   */
  function collect(trace: Trace): { web: Beats; truth: Beats } {
    const web = emptyBeats()
    const truth = emptyBeats()
    let world = replayWorld(trace, getScene)
    let prevWeb: World = world
    let prevTruth: TraceTick | null = null

    for (const tick of trace.ticks) {
      world = step(world, tick.input, trace.script.tickMs, scenes)

      push(web.scenes, world.scene)
      push(truth.scenes, tick.scene)
      if (world.narratage.active) push(web.narratageScenes, world.scene)
      if (tick.narratage.active) push(truth.narratageScenes, tick.scene)
      if (world.dialogue.speaking && world.dialogue.sentence !== null) {
        push(web.scriptSentences, world.dialogue.sentence)
      }
      if (tick.dialogue.source === 'script' && tick.dialogue.sentence !== null) {
        push(truth.scriptSentences, tick.dialogue.sentence)
      }
      if (world.dialogue.oral && world.dialogue.sentence !== null) {
        push(web.oralSentences, world.dialogue.sentence)
      }
      if (tick.dialogue.source === 'npc' && tick.dialogue.sentence !== null) {
        push(truth.oralSentences, tick.dialogue.sentence)
      }
      if (world.scene !== prevWeb.scene) {
        web.switches.push({ from: prevWeb.scene, to: world.scene, bgm: world.audio.bgm })
      }
      if (prevTruth !== null && tick.scene !== prevTruth.scene) {
        truth.switches.push({ from: prevTruth.scene, to: tick.scene, bgm: tick.audio.bgm })
      }
      if (world.audio.bgm !== null) push(web.bgm, world.audio.bgm)
      if (tick.audio.bgm !== null) push(truth.bgm, tick.audio.bgm)

      prevWeb = world
      prevTruth = tick
    }
    return { web, truth }
  }
})

interface Switch {
  readonly from: string
  readonly to: string
  readonly bgm: string | null
}

interface Beats {
  /** 依次进过的场景（连着的重复压掉）。 */
  readonly scenes: string[]
  /** 哪几个场景里播过旁白。 */
  readonly narratageScenes: string[]
  /** 主线对话逐句的全文。 */
  readonly scriptSentences: string[]
  /** NPC 口头语逐句的全文。 */
  readonly oralSentences: string[]
  readonly switches: Switch[]
  /** 依次声明过的背景音乐（连着的重复压掉）。 */
  readonly bgm: string[]
}

function emptyBeats(): Beats {
  return {
    scenes: [],
    narratageScenes: [],
    scriptSentences: [],
    oralSentences: [],
    switches: [],
    bgm: [],
  }
}

/** 只在与上一项不同的时候追加：一句话打上百个 tick，收的是"依次出现过什么"。 */
function push(into: string[], value: string): void {
  if (into[into.length - 1] !== value) into.push(value)
}

function stem(sceneFile: string): string {
  return sceneFile.replace(/\.txt$/, '')
}
