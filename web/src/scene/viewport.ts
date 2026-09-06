import { roleTileX, roleTileY } from '../state/role'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/constants'
import type { World } from '../state/types'

/**
 * 视口层：从世界状态算出"镜头在哪"与"谁先画"。
 *
 * **两个纯函数，不是一份绘制清单。** 清单会把渲染器压成哑适配器，跟 Pixi 这类
 * 保留模式的库正面相撞；相撞的结果通常不是修好，而是被悄悄绕开 —— 而绕开之后
 * 针对清单的测试仍然全绿。这两个函数拿到同样的测试价值（逐 tick 对齐 trace
 * 真值），却不做架构承诺，且 `sceneRenderer` 不调用它们就没有镜头、没有绘制
 * 顺序，绕不过去。
 *
 * 真值来自 `tools/traces/out/*.trace.json` 的 `viewport` / `drawOrder` 两个
 * 字段，见 `viewport.test.ts`。
 */

/**
 * 一帧的视口六元组，字段名与 trace 里的 `viewport` 逐字段一致。
 *
 * 名字里带 `Scene` 是为了跟 `stage/computeStageScale.ts` 的 `Viewport` 分开——
 * 那个说的是浏览器窗口有多大，这个说的是镜头对着地图的哪一块，两码事。
 *
 * `offsetX/Y` 是**世界像素到屏幕像素的平移量**（屏幕 = 世界 + offset），
 * 单位 1 px；`firstTileX/Y` 与 `lastTileX/Y` 是画地图时的源矩形，单位 **8 px**
 * （原版 `Map.pixelsToTiles` 就是除以 8，跟 32 px 的碰撞格不是一回事）。
 */
export interface SceneViewport {
  readonly offsetX: number
  readonly offsetY: number
  readonly firstTileX: number
  readonly lastTileX: number
  readonly firstTileY: number
  readonly lastTileY: number
}

/** 主角与 NPC 谁先画。原版 `ScenePanel.paint()` 里那个局部变量 `b`。 */
export type DrawOrder = 'npcs-first' | 'hero-first'

/** 碰撞格的边长。原版 `Map.CS = 32`。 */
const TILE_PX = 32

/** 地图源矩形的单位：8 px。原版 `Map.tilesToPixels` 是 `tiles * 8`。 */
const MAP_UNIT = 8

/**
 * Java 的 `int / int`：向零截断，**不是** `Math.floor`。
 *
 * 原版写的是 `(int) Math.floor(-offsetX / 8)`，那个 `Math.floor` 是白写的——
 * 括号里两个操作数都是 int，除法早就截断完了。两者只在被除数为负时才分道扬镳，
 * 也就是地图比屏幕还小（col < 32 或 row < 20）的时候。`viewport.test.ts` 会
 * 现场扫一遍已烘焙的场景确认这样的地图一份也没有——所以这条差异今天触发不到。
 * 照抄截断语义是因为它是原文，不是因为今天分不出来。
 *
 * 结果里的 -0 一并抹平：`Math.trunc(-0 / 8)` 是 -0，而 `Object.is(-0, 0)`
 * 为假，逐字段比对真值时会得到一句"expected 0 to equal -0"这种看不懂的红。
 * Java 的 int 没有 -0，抹平才是照抄。
 */
function intDiv(a: number, b: number): number {
  const quotient = Math.trunc(a / b)
  return quotient === 0 ? 0 : quotient
}

/**
 * `OtherEvent.calOffset()`：镜头跟随主角，并在地图边缘夹住。
 *
 * 三步，顺序照抄：
 *
 *   1. 把主角摆到屏幕正中：`offset = 屏幕一半 - 主角像素坐标`；
 *   2. `min(offset, 0)` —— 不让地图左/上边界离开屏幕左上角；
 *   3. `max(offset, 屏幕 - 地图像素)` —— 不让右/下边界露出空白。
 *
 * 注意夹取用的是 `Role.getRealX()`（像素），不是格子坐标：镜头是逐 8 px 跟的，
 * 按格子跟会一格一跳。
 */
export function computeViewport(world: World): SceneViewport {
  const { col, row } = world.collision
  const mapWidth = col * TILE_PX
  const mapHeight = row * TILE_PX

  let offsetX = STAGE_WIDTH / 2 - world.role.px
  offsetX = Math.min(offsetX, 0)
  offsetX = Math.max(offsetX, STAGE_WIDTH - mapWidth)

  let offsetY = STAGE_HEIGHT / 2 - world.role.py
  offsetY = Math.min(offsetY, 0)
  offsetY = Math.max(offsetY, STAGE_HEIGHT - mapHeight)

  const firstTileX = intDiv(-offsetX, MAP_UNIT)
  const lastTileX = Math.min(
    firstTileX + intDiv(STAGE_WIDTH, MAP_UNIT) + 1,
    col * (TILE_PX / MAP_UNIT),
  )
  const firstTileY = intDiv(-offsetY, MAP_UNIT)
  const lastTileY = Math.min(
    firstTileY + intDiv(STAGE_HEIGHT, MAP_UNIT) + 1,
    row * (TILE_PX / MAP_UNIT),
  )

  return { offsetX, offsetY, firstTileX, lastTileX, firstTileY, lastTileY }
}

/**
 * `ScenePanel.paint()` 里的绘制顺序判定。
 *
 * **这是一个全局翻转，不是逐个排序。** 原版先用一个循环把所有 NPC 扫一遍，
 * 只要**任意一个**满足条件，局部变量 `b` 就置真，然后**全部** NPC 一起画在
 * 主角前面。凭直觉重写几乎一定会写成"按 Y 排序、逐个决定谁压谁"——那是另一种
 * 行为：一个站在主角身后的 NPC，会因为屏幕另一头有另一个 NPC 满足条件而被
 * 画到主角前面。`viewport.test.ts` 直接钉住这条语义。
 *
 * 条件本身（`role.getY() > npc.getY() && role.getX() - 2 <= npc.getX() &&
 * role.getX() + 1 >= npc.getX()`）也照抄：主角在 NPC 下方、且横向落在
 * NPC 左 2 格到右 1 格这个不对称的窗口里。不对称不是笔误，是原文。
 *
 * 旁白期间原版整段绘制都不发生（`if (!narratage.isNarratage)`），那些帧没有
 * 绘制顺序这回事，trace 里记的是 `null`。旁白是 xl-9bd.11，这里不假装知道；
 * 调用方在旁白期间根本不该问这个函数。
 */
export function computeDrawOrder(world: World): DrawOrder {
  const rx = roleTileX(world.role)
  const ry = roleTileY(world.role)
  for (const npc of world.npcs) {
    if (ry > npc.y && rx - 2 <= npc.x && rx + 1 >= npc.x) return 'npcs-first'
  }
  return 'hero-first'
}

/**
 * 地图底图这一帧该怎么摆。
 *
 * 原版 `Map.drawMap` 把源矩形
 * `(firstTileX*8, firstTileY*8) - (lastTileX*8-8, lastTileY*8-8)`
 * 铺满整块 1024×640 的目标矩形。**源矩形并不总是 1024×640**：`lastTileX/Y` 被
 * 地图尺寸夹过之后会短一格（8 px），于是地图被横向拉伸约 0.79%、纵向约 1.27%，
 * 而主角与 NPC 是按 `offsetX/offsetY` 原样平移画上去的，不跟着拉。
 * 这就是原版在边缘处人物与地形对不齐的来源，实测见
 * `docs/viewport-edge-stretch.md`。这里**复刻**它：不复刻的话每一帧的地图都会
 * 比原版矮一点窄一点，跨端逐帧比对（xl-9bd.8）永远收敛不了。
 *
 * 内部帧退化成恒等变换（`scaleX = scaleY = 1`，`x/y = offsetX/offsetY`），
 * 所以这不是给常见情况加负担。
 */
export interface MapPlacement {
  readonly x: number
  readonly y: number
  readonly scaleX: number
  readonly scaleY: number
}

export function mapPlacement(viewport: SceneViewport): MapPlacement {
  const sourceX = viewport.firstTileX * MAP_UNIT
  const sourceY = viewport.firstTileY * MAP_UNIT
  const sourceWidth = viewport.lastTileX * MAP_UNIT - MAP_UNIT - sourceX
  const sourceHeight = viewport.lastTileY * MAP_UNIT - MAP_UNIT - sourceY
  const scaleX = STAGE_WIDTH / sourceWidth
  const scaleY = STAGE_HEIGHT / sourceHeight
  // 写成减法而不是 `-sourceX * scaleX`：后者在 sourceX 为 0 时得到 -0，
  // 而 `Object.is(-0, 0)` 为假，测试里 `toBe(0)` 会莫名其妙地红。
  return { x: 0 - sourceX * scaleX, y: 0 - sourceY * scaleY, scaleX, scaleY }
}
