import { describe, expect, it } from 'vitest'
import { SCENE_NAMES } from '../data/scenes'
import { getScene } from '../data/scenesEager'
import { createWorld } from '../state/step'
import { TRACE_NAMES, readTrace, sceneNameOf } from '../state/trace'
import type { TraceTick } from '../state/trace'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/constants'
import type { SceneScript } from '../data/types'
import { computeDrawOrder, computeViewport, mapTiles, npcLayerOffset } from './viewport'
import type { ViewportInput } from './viewport'

/**
 * 视口与绘制顺序的真值对齐。
 *
 * 期望值一个都不是手写的：全部来自 `tools/traces/out/`，由原版 Java 自己跑出来
 * （`docs/trace-format.md`）。手写期望的测试会绿而且会错——写实现和写期望的是
 * 同一个 agent。
 *
 * **不经过状态层**：世界是拿 trace 里那一 tick 的主角像素坐标与 NPC 格子坐标
 * 现搭的。状态层自己对齐 trace 是 `state/traceReplay.test.ts` 的事；两层串起来
 * 测，一处错会让两处都红，定位不了。
 */
describe('视口与绘制顺序对齐真值', () => {
  const traces = TRACE_NAMES.map(readTrace)

  /**
   * 拿来做单元用例的场景：**已烘焙场景里最宽的那一张**，从数据现推。
   * 写死一个名字（比如 '大地图'）会在别人改烘焙清单时无声地失去意义——
   * 挑最宽的那张，保证它一定是会卷动的那种，前提是烘焙里有卷动地图。
   */
  const widest = SCENE_NAMES.reduce((a, b) => (getScene(b).col > getScene(a).col ? b : a))

  it('三份 trace 都带着 viewport 与 drawOrder 两个字段', () => {
    // 分母是 TRACE_NAMES 本身：加了 trace 而没有这两个字段，这里要响，
    // 而不是表现为下面的用例"跳过了所以全绿"。
    expect(traces).toHaveLength(TRACE_NAMES.length)
    for (const trace of traces) {
      expect(trace.ticks).toHaveLength(trace.tickCount)
      expect(trace.tickCount).toBeGreaterThan(0)
      for (const tick of trace.ticks) {
        expect(Object.keys(tick.viewport).sort()).toEqual([
          'firstTileX',
          'firstTileY',
          'lastTileX',
          'lastTileY',
          'offsetX',
          'offsetY',
        ])
        expect(['npcs-first', 'hero-first', null]).toContain(tick.drawOrder)
      }
    }
  })

  for (const trace of traces) {
    it(`${trace.script.name}：逐 tick 的视口六元组与真值一致`, () => {
      const scene = getScene(sceneNameOf(trace))
      for (const tick of trace.ticks) {
        // 带上 t：错位从第几帧开始，要一眼看得见。
        expect({ t: tick.t, ...computeViewport(worldAt(scene, tick)) }).toEqual({
          t: tick.t,
          ...tick.viewport,
        })
      }
    })

    it(`${trace.script.name}：逐 tick 的绘制顺序与真值一致`, () => {
      const scene = getScene(sceneNameOf(trace))
      for (const tick of trace.ticks) {
        // 旁白帧原版一个精灵都不画，没有绘制顺序可言，跳过——跳过多少条在
        // 下面的覆盖用例里有分母兜底。
        if (tick.drawOrder === null) continue
        expect({ t: tick.t, order: computeDrawOrder(worldAt(scene, tick)) }).toEqual({
          t: tick.t,
          order: tick.drawOrder,
        })
      }
    })
  }

  it('真值覆盖了跟随、边缘夹取与两种绘制顺序', () => {
    let scrolled = 0
    let clampedRight = 0
    let clampedBottom = 0
    const orders = new Map<string, number>()
    for (const trace of traces) {
      const scene = getScene(sceneNameOf(trace))
      const seen = new Set<string>()
      for (const tick of trace.ticks) {
        seen.add(JSON.stringify(tick.viewport))
        if (tick.viewport.offsetX === STAGE_WIDTH - scene.col * 32) clampedRight++
        if (tick.viewport.offsetY === STAGE_HEIGHT - scene.row * 32) clampedBottom++
        const key = String(tick.drawOrder)
        orders.set(key, (orders.get(key) ?? 0) + 1)
      }
      scrolled += seen.size - 1
    }
    // 这四条是上面两组用例的前提。真值换掉而覆盖丢了，要在这里响，而不是
    // 表现为"测试还是绿的，只是不再测边缘了"。
    expect(scrolled).toBeGreaterThan(0)
    expect(clampedRight).toBeGreaterThan(0)
    expect(clampedBottom).toBeGreaterThan(0)
    expect([...orders.keys()].sort()).toEqual(['hero-first', 'npcs-first', 'null'])
  })

  /**
   * 这一条是这张票最容易被凭直觉写错的地方，所以单独钉。
   *
   * 原版不是按 Y 逐个排序，而是**一个全局开关**：任意一个 NPC 满足条件，全部
   * NPC 就都画在主角前面。逐个排序会在下面这些 tick 上给出不同答案——它们在
   * 真值里真实存在，所以上面那两组回放用例本身就能识破逐个排序的实现。
   */
  it('真值里存在只有全局翻转才解释得通的 tick', () => {
    let onlyFlipExplains = 0
    for (const trace of traces) {
      for (const tick of trace.ticks) {
        if (tick.drawOrder !== 'npcs-first') continue
        // 有 NPC 与主角同行或在其下方：按 Y 排序它该压在主角前面，
        // 而原版把它跟其它 NPC 一起丢到了主角后面。
        if (tick.npcs.some((npc) => npc.y >= tick.role.y)) onlyFlipExplains++
      }
    }
    expect(onlyFlipExplains).toBeGreaterThan(0)
  })

  it('一个 NPC 满足条件，全部 NPC 都排到主角前面——包括离得很远的那个', () => {
    const world = worldOf(getScene(widest), 12 * 32, 8 * 32, [
      // 满足条件：在主角上方一格、横向落在 [x-2, x+1] 窗口里。
      { x: 12, y: 7 },
      // 远在屏幕另一头，且在主角下方——逐个排序会把它画在主角前面。
      { x: 30, y: 18 },
    ])
    expect(computeDrawOrder(world)).toBe('npcs-first')

    // 把那个满足条件的 NPC 拿掉，翻转就没了：证明上面那条不是恒真。
    expect(computeDrawOrder({ ...world, npcs: [{ x: 30, y: 18 }] })).toBe('hero-first')
  })

  it('横向窗口是不对称的 [x-2, x+1]，照抄原版', () => {
    const at = (x: number) =>
      computeDrawOrder(worldOf(getScene(widest), 12 * 32, 8 * 32, [{ x, y: 7 }]))
    expect([10, 11, 12, 13].map(at)).toEqual([
      'npcs-first',
      'npcs-first',
      'npcs-first',
      'npcs-first',
    ])
    expect([9, 14].map(at)).toEqual(['hero-first', 'hero-first'])
  })

  /**
   * 边缘拉伸的裁定（见 `docs/viewport-edge-stretch.md`）。**结论是：确实存在，
   * 而且不止在卷动地图的边缘**——凡是 `lastTileX/Y` 被地图尺寸夹住的帧，地图源
   * 矩形就短 8 px，被拉伸着铺满 1024×640。这里复刻它。
   *
   * 复刻的形式是**分段 1:1 平移**而不是一次缩放（xl-9bd.16）：拉伸多少，看的
   * 是碎片总数与它们盖住的源范围，而不是一个缩放系数。数字全部现算，不写死：
   * 分母来自 `STAGE_WIDTH / STAGE_HEIGHT` 与场景自己的尺寸。
   */
  it('夹住的帧地图被切成多块，没夹住的帧只有一块 1:1', () => {
    const stretched = new Set<string>()
    const identity = new Set<string>()
    for (const trace of traces) {
      for (const tick of trace.ticks) {
        const tiles = mapTiles(tick.viewport)
        // 无论几块，拼起来必须恰好盖满整块画布，一个像素不重不漏。
        expect(tiles.reduce((n, t) => n + t.width * t.height, 0)).toBe(
          STAGE_WIDTH * STAGE_HEIGHT,
        )
        if (tiles.length === 1) {
          // 没夹住：地图就是按 offset 平移，跟人物用的是同一套坐标。
          const only = tiles[0]!
          identity.add(JSON.stringify(only))
          expect(only.destX).toBe(0)
          expect(only.destY).toBe(0)
          // `0 - x` 而不是 `-x`：offset 为 0 时后者是 -0，`toBe(0)` 会红。
          expect(only.sourceX).toBe(0 - tick.viewport.offsetX)
          expect(only.sourceY).toBe(0 - tick.viewport.offsetY)
        } else {
          stretched.add(JSON.stringify(tiles))
        }
      }
    }
    // 两种帧真值里都有，否则下面的断言可能是在断言空集。
    expect(identity.size).toBeGreaterThan(0)
    expect(stretched.size).toBeGreaterThan(0)

    // 32×20 的地图（一屏正好装得下）每一帧都被夹住：源矩形 1016×632。
    const oneScreen = mapTiles({
      offsetX: 0,
      offsetY: 0,
      firstTileX: 0,
      lastTileX: (STAGE_WIDTH / 32) * 4,
      firstTileY: 0,
      lastTileY: (STAGE_HEIGHT / 32) * 4,
    })
    // 少 8 px 就要多复制 8 行/8 列，也就是横竖各切 9 段。
    expect(oneScreen).toHaveLength(9 * 9)
    // 碎片盖住的源范围正是那个 1016×632 的源矩形。
    const right = Math.max(...oneScreen.map((t) => t.sourceX + t.width))
    const bottom = Math.max(...oneScreen.map((t) => t.sourceY + t.height))
    expect(right).toBe(STAGE_WIDTH - 8)
    expect(bottom).toBe(STAGE_HEIGHT - 8)
    // 约 0.79% 与 1.27%——票里那个"约 0.8%"的推算，横向是对的。
    expect(STAGE_WIDTH / right).toBeCloseTo(1.0079, 4)
    expect(STAGE_HEIGHT / bottom).toBeCloseTo(1.0127, 4)
  })

  /**
   * 采样公式照抄原版：目标像素 `i` 取源像素 `floor((i + 0.5) * 源 / 目标)`。
   * 这条是量出来的（见 `mapTiles` 的注释），所以这里逐像素钉死它 —— 分段平移
   * 只是它的另一种写法，写错一段的表现是"某一行整行取到了上面一行"，在画面上
   * 完全看不出来。
   */
  it('碎片展开后逐像素等于原版的最近邻采样公式', () => {
    const tiles = mapTiles({
      offsetX: 0,
      offsetY: 0,
      firstTileX: 0,
      lastTileX: (STAGE_WIDTH / 32) * 4,
      firstTileY: 0,
      lastTileY: (STAGE_HEIGHT / 32) * 4,
    })
    const sourceWidth = STAGE_WIDTH - 8
    const sourceHeight = STAGE_HEIGHT - 8
    // 逐像素展开，但只在**最后**断言一次：655360 次 `expect` 要跑几十秒。
    const wrong: string[] = []
    let checked = 0
    for (const tile of tiles) {
      for (let dy = 0; dy < tile.height; dy++) {
        for (let dx = 0; dx < tile.width; dx++) {
          const x = tile.destX + dx
          const y = tile.destY + dy
          const sx = Math.floor(((x + 0.5) * sourceWidth) / STAGE_WIDTH)
          const sy = Math.floor(((y + 0.5) * sourceHeight) / STAGE_HEIGHT)
          if (tile.sourceX + dx !== sx || tile.sourceY + dy !== sy) {
            if (wrong.length < 5)
              wrong.push(
                `(${x},${y}) 取了 (${tile.sourceX + dx},${tile.sourceY + dy})，应为 (${sx},${sy})`,
              )
          }
          checked++
        }
      }
    }
    expect(wrong).toEqual([])
    expect(checked).toBe(STAGE_WIDTH * STAGE_HEIGHT)
  })

  /**
   * `intDiv` 照抄 Java 的截断除法，而截断与 `Math.floor` 只在 `-offset` 为负
   * 时才分家——那要求地图比屏幕还小。现场扫一遍已烘焙的场景确认没有这种地图，
   * 分母是 `SCENE_NAMES.length`：将来烘出一张更小的地图，这里会响，而不是
   * 悄悄走进一条从没测过的分支。
   */
  it('没有比屏幕还小的地图，所以截断与向下取整今天分不出来', () => {
    expect(SCENE_NAMES.length).toBeGreaterThan(0)
    const tooSmall = SCENE_NAMES.filter((name) => {
      const scene = getScene(name)
      return scene.col * 32 < STAGE_WIDTH || scene.row * 32 < STAGE_HEIGHT
    })
    expect(tooSmall).toEqual([])
  })

  it('镜头把主角摆在屏幕正中，走到地图边缘就停住', () => {
    const scene = getScene(widest)
    // 这条用例要的是一张会卷动的地图。一张都没有的话必须红，不能因为
    // "跳过了所以没报错"而静静地失去意义——这个项目的招牌坑就是这个。
    expect(scene.col * 32).toBeGreaterThan(STAGE_WIDTH * 2)
    expect(scene.row * 32).toBeGreaterThan(STAGE_HEIGHT * 2)

    // 地图腹地：主角就在屏幕正中，一个像素不差。
    const inside = computeViewport(worldOf(scene, STAGE_WIDTH, STAGE_HEIGHT, []))
    expect(STAGE_WIDTH + inside.offsetX).toBe(STAGE_WIDTH / 2)
    expect(STAGE_HEIGHT + inside.offsetY).toBe(STAGE_HEIGHT / 2)

    // 左上角：镜头顶住，绝不露出地图外面的空白。
    const corner = computeViewport(worldOf(scene, 0, 0, []))
    expect(corner.offsetX).toBe(0)
    expect(corner.offsetY).toBe(0)

    // 右下角：同理，顶住另一头——地图右/下边界正好贴着屏幕右/下沿。
    const far = computeViewport(
      worldOf(scene, (scene.col - 1) * 32, (scene.row - 1) * 32, []),
    )
    expect(scene.col * 32 + far.offsetX).toBe(STAGE_WIDTH)
    expect(scene.row * 32 + far.offsetY).toBe(STAGE_HEIGHT)
  })

  /**
   * NPC 层的偏移（xl-9bd.9）。原版画 NPC 用的是 `-firstTile*8`，画主角用的是
   * `offset` —— 两个不同的量。这条现场量一遍它们差多少。
   */
  it('三份真值的每一帧，NPC 层与主角层的偏移都恰好相等', () => {
    let frames = 0
    let apart = 0
    for (const trace of traces) {
      for (const tick of trace.ticks) {
        frames++
        const offset = npcLayerOffset(tick.viewport)
        if (offset.x !== 0 || offset.y !== 0) apart++
      }
    }
    // 分母先响：一帧都没扫到的话，下面那个 0 是没有意义的。
    expect(frames).toBeGreaterThan(0)
    // `offsetX = 512 - role.px`，主角每次挪 8 或 16，两个夹取的界也都是 8 的
    // 倍数，所以 `-offsetX` 恒为 8 的倍数、截断不掉任何东西。**这是实测的
    // 结论，不是恒等式**：换一张尺寸不同的地图、或者主角的步长改了，它就不再
    // 成立，而那时画面上的样子是所有 NPC 整体偏几个像素。所以 `sceneRenderer`
    // 照样每帧设一次这个偏移，不把它当 0 省掉。
    expect(apart).toBe(0)
  })
})

/** 拿 trace 里那一 tick 的快照现搭一个世界——只填这两个函数读的字段。 */
function worldAt(scene: SceneScript, tick: TraceTick): ViewportInput {
  return worldOf(
    scene,
    tick.role.px,
    tick.role.py,
    tick.npcs.map((npc) => ({ x: npc.x, y: npc.y })),
  )
}

function worldOf(
  scene: SceneScript,
  px: number,
  py: number,
  npcs: readonly { x: number; y: number }[],
): ViewportInput {
  const base = createWorld(scene)
  return { ...base, npcs, role: { ...base.role, px, py } }
}
