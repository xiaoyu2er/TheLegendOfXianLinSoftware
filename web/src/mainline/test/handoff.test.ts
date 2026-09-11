import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { START_SCENE } from '../../data/scenes'
import { getScene } from '../../data/scenesEager'
import { createWorld, step } from '../../state/step'
import { sceneSourceOf } from '../../state/trace'
import type { TilePos, World } from '../../state/types'
import { repoPath } from '../../test/repoPath'
import { type Hop, type Truths, bare, exitsOf, loadTruths, plotBattle, readPlotBosses, readStart, walkChain } from './chain'

/**
 * **交接判据**（xl-czb.7）：主线上相邻两段的交接点对得上 —— 前一段记下的目标 ==
 * 后一段剧本的起点。形状同前两个里程碑的「门」（`game/doors.test.ts`）与「读档」
 * （`game/loadSession.test.ts`）。
 *
 * ## 两侧各从哪来
 *
 * - **前一段记下的目标**：链上每一跳的 `nextScript` 三元组 `[落点, 场景名, 脚本名]`
 *   与那一跳怎么发生（出口 / 走自由场景 / 推剧情的战斗）—— 全部取自 `chain.ts`，也就是
 *   入库的**数据层真值**（原版 `tools.Reader` 导出的逐字段结果）加 GBK 源码现读，
 *   **不经过 Web 的任何一行产品代码**。
 * - **后一段的起点**：Web 的状态层（`state/step.ts`）把这一跳真的走一遍之后，站在哪本
 *   脚本里、`currentScript` 是什么、主角落在哪一格。场景数据是烘焙产物（`getScene`），
 *   换场景时按出口名找场景走的是产品侧那条解析（`sceneSourceOf` →
 *   `data/scenes.ts` 的 `sceneNameOfFile`）。
 *
 * 一跳接一跳地走：第 k 跳从第 k−1 跳走完的那个世界出发，不是每一跳各自新建。
 *
 * ## ⚠️ 这一层弱在哪
 *
 * 它证的是「**每一段各自对、链是通的、交接点对得上**」，**不是「有人真的从头走到了
 * 尾」**：
 *
 * 1. 每一跳之前，那本脚本的**对话被直接置成放完了**（战斗跳则是停在最后一句、`@` 已
 *    记下），主角被**直接摆到出口格上** —— 不是一句一句按空格、一步一步走过去的。对话、
 *    走路、打仗各自对不对归各自的行为真值；这里只管那一下交接。
 * 2. 战斗跳只走到「开打前 `nextScript()` 把场景换掉」为止，**那一场仗打没打赢不在这里**
 *    （打赢回场景那一截是 `game/session.test.ts` 的「打赢：结算跑完回场景」）。
 * 3. 没有一条真值剧本跨过这些交接点：真正的端到端要把 `GameLauncher` 立起来，归 xl-x0t。
 */

const truths = loadTruths()
const start = readStart()
const bosses = readPlotBosses()
const chain = walkChain(truths, 'win32', start.script, bosses)
const scenes = sceneSourceOf(getScene)

const TILE = 32
const tileOf = (w: World): TilePos => ({ x: Math.floor(w.role.px / TILE), y: Math.floor(w.role.py / TILE) })
const parseTile = (spec: string): TilePos => {
  const [x, y] = spec.split('/').map(Number)
  return { x: x!, y: y! }
}

/** 这本脚本的对话当作已经放完：出口那一支（分支 1）认的就是 `dialogueEventOver`。 */
function storyDone(w: World): World {
  return {
    ...w,
    dialogue: { ...w.dialogue, speaking: false, groupOver: false, eventOver: true },
    // 剧情固定战不止一场的场景，要全打完才轮到查出口（`needsBattle1Over`）。
    fight: { ...w.fight, battle1Over: true },
  }
}

/** 把主角摆到名为 `name` 的那个出口的第一格上，走一拍。当前场景没有这个出口就抛。 */
function stepOnto(w: World, name: string): World {
  const table = w.exit
  const i = table?.nextScene.indexOf(name) ?? -1
  if (table === null || i < 0) throw new Error(`${w.scene} 没有名为 ${JSON.stringify(name)} 的出口`)
  const tile = table.exits[i]![0]!
  return step({ ...w, role: { ...w.role, px: tile.x * TILE, py: tile.y * TILE } }, [], 10, scenes)
}

/**
 * 从 `from` 出发只沿出口走，到一个出口段里有 `exit` 的场景要踩哪几个出口名（广度优先、
 * 最短）。出口名按 win32 语义解析 —— 与链同一把尺（`chain.ts`），不借产品侧的解析。
 */
function roamPath(t: Truths, from: string, exit: string): string[] {
  const seen = new Set([from])
  const queue: { file: string; path: string[] }[] = [{ file: from, path: [] }]
  for (let cur = queue.shift(); cur !== undefined; cur = queue.shift()) {
    for (const name of exitsOf(t.get(cur.file)!)) {
      const file = bare(name)
      if (!t.has(file) || seen.has(file)) continue
      const path = [...cur.path, name]
      if (exitsOf(t.get(file)!).includes(exit)) return path
      seen.add(file)
      queue.push({ file, path })
    }
  }
  throw new Error(`从 ${from} 只沿出口走，走不到一个带 ${exit} 出口的场景`)
}

/** 推剧情的那一场：停在最后一句、`@` 已记下、`countOfBattle1` 指着它，按一下空格。 */
function fightThrough(w: World, hop: Hop): World {
  const s = truths.get(hop.from)!
  const boss = plotBattle(s, bosses)!
  const at = (s.battle1 ?? []).findIndex((b) => b[4] === boss)
  const ready: World = {
    ...w,
    dialogue: { ...w.dialogue, speaking: true, groupOver: true, groupOrder: (w.script.groups ?? []).length, fight: true },
    fight: { ...w.fight, countOfBattle1: at, battle1Over: false },
  }
  return step(ready, [{ e: 'press', k: 'space', ctrl: false }], 10, scenes)
}

function takeHop(w: World, hop: Hop): World {
  switch (hop.how.kind) {
    case 'battle':
      return fightThrough(w, hop)
    case 'exit':
      return stepOnto(storyDone(w), hop.triple[1])
    case 'roam': {
      let cur = storyDone(w)
      for (const name of roamPath(truths, hop.from, hop.triple[1])) cur = stepOnto(cur, name)
      return stepOnto(cur, hop.triple[1])
    }
  }
}

/** 顺着链一跳接一跳地走。断了之后的每一跳都报「断在第几跳」，不从别处重起。 */
const walked: ({ after: World } | { brokenAt: number; error: unknown })[] = (() => {
  const out: ({ after: World } | { brokenAt: number; error: unknown })[] = []
  // 新游戏：`StartPanel` 那句 `initiation("脚本1.txt")`，`currentScript` 是构造函数写死的那份。
  let w: World = createWorld(getScene(START_SCENE))
  let broken: { brokenAt: number; error: unknown } | null = null
  for (const hop of chain.hops) {
    if (broken === null) {
      try {
        w = takeHop(w, hop)
      } catch (error) {
        broken = { brokenAt: hop.index, error }
      }
    }
    out.push(broken ?? { after: w })
  }
  return out
})()

describe('前提', () => {
  it('链是通的（win32），且 Web 的起点场景就是链的起点', () => {
    expect(chain.broken).toBeUndefined()
    expect(chain.hops.length).toBeGreaterThan(0)
    expect(`${START_SCENE}.txt`).toBe(start.script)
  })
})

describe('交接：链上每一跳，前一段记下的三元组 == Web 状态层走完这一跳之后的起点', () => {
  it.each(chain.hops.map((h, k) => [h.index, h.from, h.triple[2], h.how.kind, k] as const))(
    '第 %i 跳 %s → %s（%s）',
    (_i, _from, _to, _kind, k) => {
      const hop = chain.hops[k]!
      const r = walked[k]!
      if ('error' in r) {
        throw new Error(`Web 状态层走到第 ${r.brokenAt} 跳就走不下去了：${String(r.error)}`)
      }
      // 后一段的起点：站在下一本剧情脚本里、剧情三元组就是前一段记下的那一份、落点是它的第 0 格。
      expect(r.after.scene, '进的脚本').toBe(hop.triple[2])
      expect(r.after.currentScript, 'currentScript').toEqual([...hop.triple])
      expect(tileOf(r.after), '落点').toEqual(parseTile(hop.triple[0]))
      expect(r.after.isScript, 'isScript').toBe(true)
    },
  )
})

describe('交接：链尾 → 结局', () => {
  it('每一条结局真值剧本的起点（setup.scene）== 链尾那本', () => {
    const dir = repoPath('tools/traces/scripts')
    // 分母现扫：driver 是 end 的那几条剧本。
    const ends = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as { driver?: string; name: string; setup?: { scene: string } })
      .filter((s) => s.driver === 'end')
    expect(ends.length).toBeGreaterThan(0)
    for (const s of ends) expect(s.setup?.scene, s.name).toBe(chain.scripts.at(-1))
  })
})
