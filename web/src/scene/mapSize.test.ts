import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TILE } from '../state/role'
import { SCENE_TRACE_NAMES, readTrace } from '../state/trace'
import { imageSize } from '../test/imageSize'
import { repoPath } from '../test/repoPath'
import { checkMapSize } from './mapSize'
import { MAP_UNIT, computeViewport, mapTiles } from './viewport'

/**
 * 地图图片尺寸与碰撞网格对不对得上（xl-i06.12 追出来，xl-czb.3 还 xl-i06.14 的账）。
 *
 * 场景与图片尺寸一律**现扫**：场景是 `tools/ground-truth/*.json`（数据层真值，
 * 不是烘焙产物），宽高读 `maps/` 下的原始素材。
 */
interface Scene {
  readonly script: string
  readonly mapName: string
  readonly col: number
  readonly row: number
}

const scenes: Scene[] = readdirSync(repoPath('tools/ground-truth'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(repoPath('tools/ground-truth', f), 'utf8')) as Scene)

type Kind = 'equal' | 'short' | 'long'
const classified = scenes.map((scene) => {
  const size = imageSize(repoPath('maps', scene.mapName))
  const w = scene.col * TILE
  const h = scene.row * TILE
  const kind: Kind =
    size.width === w && size.height === h ? 'equal' : size.width < w || size.height < h ? 'short' : 'long'
  return { scene, size, kind }
})

/**
 * 这一帧地图源矩形在源图上最远取到哪一列 / 哪一行（开区间右端）。
 *
 * 用渲染器自己的 `computeViewport` + `mapTiles` 算，主角摆在地图最右下角 ——
 * 镜头被夹在右 / 下边界时源矩形伸得最远。
 */
function farthestSource(scene: Scene): { readonly x: number; readonly y: number } {
  const world = {
    collision: { col: scene.col, row: scene.row },
    role: { px: scene.col * TILE, py: scene.row * TILE },
    npcs: [],
  } as unknown as Parameters<typeof computeViewport>[0]
  const tiles = mapTiles(computeViewport(world))
  return {
    x: Math.max(...tiles.map((t) => t.sourceX + t.width)),
    y: Math.max(...tiles.map((t) => t.sourceY + t.height)),
  }
}

describe('地图图片与碰撞网格', () => {
  it('三种处境在真实数据里都有 —— 一种都没扫到的话，下面几条就是在空集上通过', () => {
    const kinds = new Set(classified.map((c) => c.kind))
    expect([...kinds].sort()).toEqual(['equal', 'long', 'short'])
  })

  it('每一个场景都放行：短的那一种原版的源矩形也取不到缺的那几像素（xl-czb.3 实测）', () => {
    const refused = classified.flatMap(({ scene, size }) => {
      try {
        checkMapSize(scene.script, scene.mapName, size, scene.col, scene.row)
        return []
      } catch (e) {
        return [`${scene.script}：${(e as Error).message}`]
      }
    })
    expect(refused).toEqual([])
  })

  it('短的那一种，源矩形在任何镜头下都落在图内 —— 放行的理由本身', () => {
    const outside = classified
      .filter((c) => c.kind === 'short')
      .flatMap(({ scene, size }) => {
        const far = farthestSource(scene)
        return far.x <= size.width && far.y <= size.height
          ? []
          : [`${scene.script} ${size.width}×${size.height} 取到 ${far.x}×${far.y}`]
      })
    expect(outside).toEqual([])
  })

  it('原版那一侧的真值：走进短图场景的每一条真值，逐拍的源矩形都落在那张图内', () => {
    // 上一条用的是这一层自己的 `computeViewport`，它夹错了判据会跟着一起错；这一条读的是
    // 原版导出器记下的 `viewport` 列。分母是磁盘上的场景真值里「走进了短图场景」的那些拍。
    const shortByScript = new Map(
      classified.filter((c) => c.kind === 'short').map((c) => [c.scene.script, c.size]),
    )
    let checked = 0
    const outside: string[] = []
    for (const name of SCENE_TRACE_NAMES) {
      for (const tick of readTrace(name).ticks) {
        const size = shortByScript.get(tick.scene)
        if (size === undefined || tick.viewport === null) continue
        checked++
        const x = tick.viewport.lastTileX * MAP_UNIT - MAP_UNIT
        const y = tick.viewport.lastTileY * MAP_UNIT - MAP_UNIT
        if (x > size.width || y > size.height) {
          outside.push(`${name} ${tick.scene} 取到 ${x}×${y}，图是 ${size.width}×${size.height}`)
        }
      }
    }
    expect(checked, '没有一拍走进过短图场景 —— 下面那句 toEqual([]) 就是在空集上通过').toBeGreaterThan(0)
    expect(outside).toEqual([])
  })

  it('边界：图至少要盖住源矩形最远那一格；再短一个像素就越出图片，硬失败并点名这张票', () => {
    // 32×20 的静止地图：lastTile 被夹成 128/80，源矩形 (0,0)-(1016,632)。
    const far = farthestSource({ script: '', mapName: '', col: 32, row: 20 })
    expect(far).toEqual({ x: 1016, y: 632 })
    expect(() => checkMapSize('x.txt', 'x.png', { width: far.x, height: far.y }, 32, 20)).not.toThrow()
    expect(() => checkMapSize('x.txt', 'x.png', { width: far.x - 1, height: far.y }, 32, 20)).toThrow(
      /1015×632.*xl-czb\.3/,
    )
    expect(() => checkMapSize('x.txt', 'x.png', { width: far.x, height: far.y - 1 }, 32, 20)).toThrow()
  })
})
