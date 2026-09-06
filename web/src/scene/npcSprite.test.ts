import { describe, expect, it } from 'vitest'
import MISSING_IDS from '../generated/missingAssets.json'
import { knownAssetIds } from '../assets/resolve'
import { SCENE_NAMES } from '../data/scenes'
import { getScene } from '../data/scenesEager'
import { KNOWN_DEFECTS } from '../assets/knownMissing'
import { createNpcs } from '../state/npc'
import { step } from '../state/step'
import { TRACE_NAMES, readTrace, replayWorld, sceneSourceOf } from '../state/trace'
import { npcSprite } from './npcSprite'

/**
 * NPC 精灵：**取哪一帧、画在哪**。
 *
 * 这一层最容易错的是下标 —— 单向走动的帧号跑 0..7 而素材的文件名从方向码起
 * 编（`曾书书/9.png` .. `曾书书/16.png`），原地运动的从 1 起编。错了的样子是
 * "某个 NPC 在某个方向上闪成另一个人"，画面上几乎看不出来，所以这里把**每个
 * 场景、每个 NPC、每一个到得了的帧号**枚举干净。
 */
describe('NPC 精灵', () => {
  const brokenScenes = new Set(
    KNOWN_DEFECTS.map((d) => d.where.split(' ')[0]?.replace(/\.txt$/, '')),
  )
  const buildable = SCENE_NAMES.filter((name) => !brokenScenes.has(name))

  it('96 个场景里每个 NPC 到得了的每一帧，都能拼出一个查得到的资产 ID', () => {
    const known = new Set([...knownAssetIds(), ...(MISSING_IDS as string[])])
    let frames = 0
    for (const name of buildable) {
      for (const npc of createNpcs(getScene(name))) {
        // 帧号的取值范围照 `NPC.walk` / `NPC.action`：单向走动一个来回跑满
        // 0..7（跟素材张数无关，这正是它必须有 8 张的原因），原地运动是
        // 0..张数-1，静止的只有一张。
        const reachable =
          npc.type === 1 ? 8 : npc.type === 2 ? npc.images.length : 1
        for (let frame = 0; frame < reachable; frame++) {
          const placement = npcSprite({ ...npc, frame })
          expect({ name, id: placement.asset, known: known.has(placement.asset) }).toEqual({
            name,
            id: placement.asset,
            known: true,
          })
          frames++
        }
      }
    }
    // 分母先响：一帧都没枚举到的话，上面那个 `known` 是空转。
    expect(frames).toBeGreaterThan(0)
  })

  it('画的位置就是 NPC 的像素坐标，没有主角那个 -32', () => {
    // 主角画在 `(x, y-32)`，NPC 画在 `(x, y)`（`NPC.drawNPC` vs `Role.drawHero`）。
    // 位置这件事有真值：逐 tick 拿三份 trace 里的 NPC 像素坐标对。
    let checked = 0
    for (const name of TRACE_NAMES) {
      const trace = readTrace(name)
      let world = replayWorld(trace, getScene)
      for (const tick of trace.ticks) {
        world = step(world, tick.input, trace.script.tickMs, sceneSourceOf(getScene))
        const placed = world.npcs.map((npc) => {
          const { x, y } = npcSprite(npc)
          return { x, y }
        })
        expect(placed).toEqual(tick.npcs.map((npc) => ({ x: npc.px, y: npc.py })))
        checked += placed.length
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('帧号越界就抛 —— 原版在这里是 IndexOutOfBoundsException', () => {
    const npc = buildable.flatMap((name) => createNpcs(getScene(name)))[0]!
    expect(() => npcSprite({ ...npc, type: 1, frame: npc.images.length })).toThrowError(
      /IndexOutOfBounds/,
    )
  })
})
