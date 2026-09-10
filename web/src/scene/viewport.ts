import { roleTileX, roleTileY } from '../state/role'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/constants'
import type { CollisionMap, RoleState, TilePos } from '../state/types'

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

/**
 * 这两个纯函数要的全部：镜头看地图尺寸与主角像素坐标，绘制顺序看主角与 NPC
 * 的格子坐标。
 *
 * **收的不是整个 `World`**，而且 `npcs` 只按 `TilePos` 读 —— 于是用例可以拿
 * 两三个坐标搭出一个场面来钉那条全局翻转，不必伪造一整套 NPC 状态（伪造出来
 * 的那套多半还是错的）。`World` 本身是它的子类型，调用方照传不误。
 */
export interface ViewportInput {
  readonly collision: CollisionMap
  readonly role: RoleState
  readonly npcs: readonly TilePos[]
}

/** 碰撞格的边长。原版 `Map.CS = 32`。 */
export const TILE_PX = 32

/** 地图源矩形的单位：8 px。原版 `Map.tilesToPixels` 是 `tiles * 8`。 */
export const MAP_UNIT = 8

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
export function computeViewport(world: ViewportInput): SceneViewport {
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
export function computeDrawOrder(world: ViewportInput): DrawOrder {
  const rx = roleTileX(world.role)
  const ry = roleTileY(world.role)
  for (const npc of world.npcs) {
    if (ry > npc.y && rx - 2 <= npc.x && rx + 1 >= npc.x) return 'npcs-first'
  }
  return 'hero-first'
}

/**
 * NPC 层相对 `camera` 的偏移。
 *
 * 原版画主角和画 NPC 用的**不是同一个量**：主角是 `offsetX/offsetY`
 * （`Role.drawHero`），NPC 是 `-firstTileX*8 / -firstTileY*8`
 * （`NPC.drawNPC`）。后者是前者除以 8 再截断再乘回 8，两者只在
 * `offsetX` 不是 8 的倍数时才分家。
 *
 * 今天分不开：`offsetX = 512 - role.px`，而 `role.px` 每次挪 8 或 16，
 * 夹取用的两个界是 0 与 `1024 - col*32`，都是 8 的倍数。
 * `viewport.test.ts` 现场扫三份真值确认这一点。
 *
 * 那为什么还要有这个函数：**因为分不开是一个可以变的事实**，而它变了的样子是
 * 所有 NPC 整体偏几个像素 —— 跟"画错了一个精灵"长得一模一样，肉眼分不出。
 * 照抄原文，这条差异就永远不会出现。
 */
export function npcLayerOffset(viewport: SceneViewport): {
  readonly x: number
  readonly y: number
} {
  return {
    x: -viewport.firstTileX * MAP_UNIT - viewport.offsetX,
    y: -viewport.firstTileY * MAP_UNIT - viewport.offsetY,
  }
}

/**
 * 地图底图这一帧该怎么摆：**一组 1:1 贴上去的碎片，不是一次缩放**。
 *
 * 原版 `Map.drawMap` 把源矩形
 * `(firstTileX*8, firstTileY*8) - (lastTileX*8-8, lastTileY*8-8)`
 * 铺满整块 1024×640 的目标矩形。**源矩形并不总是 1024×640**：`lastTileX/Y` 被
 * 地图尺寸夹过之后会短一格（8 px），于是地图被横向拉伸约 0.79%、纵向约 1.27%，
 * 而主角与 NPC 是按 `offsetX/offsetY` 原样平移画上去的，不跟着拉。
 * 这就是原版在边缘处人物与地形对不齐的来源，实测见
 * `docs/viewport-edge-stretch.md`。这里复刻它 —— 不复刻的话每一帧的地图都会
 * 比原版矮一点窄一点，跨端逐帧比对（xl-9bd.8）永远收敛不了。
 *
 * **为什么不直接给精灵一个 1.0079 的缩放**（xl-9bd.16）：那样每个目标像素取哪
 * 一个源像素，就交给了 GPU 的 UV 插值与采样器去决定，而它的精度是拿不准的。
 * 实测（dorm-walk 第 0 帧，最近邻过滤下）：横向 1024 列全对，纵向却有 10 行
 * 整行取错了上面一个像素 —— 误差呈 `-5.24e-5 × y` 的相对形状，在 y 接近 640
 * 时约 0.03 个像素，而这个映射相邻两点的最小间距只有 1/160 = 0.00625 个像素。
 * 也就是说**误差和判定间距同量级**，加一个偏置只会把另一端顶过去，修不好。
 *
 * 于是换一种表述：这个映射是**分段整数平移**。目标像素 `i` 取源像素
 * `floor((i + 0.5) * 源边长 / 目标边长)`（这条公式是实测的，见下），
 * 该函数每一步要么加 1、要么原地不动，所以把"源下标 − 目标下标"相同的目标像素
 * 归成一段，每一段就是一次 1:1、整数对齐的平移。1016→1024 分 9 段、
 * 632→640 分 9 段，横竖相乘 81 块；没被夹住的帧退化成 1 块。每块按 1:1 贴，
 * 目标像素中心落在源像素正中，离判定边界有 0.5 个像素的余量 —— 比上面那个
 * 0.03 的误差大一个多数量级，于是**这件事不再依赖采样器的精度**。
 *
 * 采样公式本身是量出来的，不是推的：把一张 1024×640 的图按
 * `drawImage(img, 0,0,1024,640, 0,0,1016,632, null)` 缩放后逐像素读回，
 * 1024 列与 640 行**全部**等于 `floor((i + 0.5) * 源 / 目标)`；
 * 按 `floor(i * 源 / 目标)` 截断则有 504 列、312 行对不上。
 */
export interface MapTile {
  /** 目标画布上的左上角，单位 1 px。 */
  readonly destX: number
  readonly destY: number
  /** 源图上的左上角，单位 1 px（已经含了源矩形的原点）。 */
  readonly sourceX: number
  readonly sourceY: number
  readonly width: number
  readonly height: number
}

/** 一段：目标 `[start, start + length)` 取源 `[start + offset, …)`。 */
interface Run {
  readonly start: number
  readonly length: number
  readonly offset: number
}

/**
 * 把 `destSize` 个目标像素按"源下标 − 目标下标"切成段。
 *
 * 全程整数运算（`(2i+1) * src` 与 `2 * dest` 都远小于 2^53），不经过一次浮点，
 * 所以段界是确定的，跟机器无关。
 */
function runs(sourceSize: number, destSize: number): Run[] {
  const out: Run[] = []
  let start = 0
  let offset = 0
  for (let i = 0; i < destSize; i++) {
    const delta = Math.floor(((2 * i + 1) * sourceSize) / (2 * destSize)) - i
    if (i === 0) {
      offset = delta
    } else if (delta !== offset) {
      out.push({ start, length: i - start, offset })
      start = i
      offset = delta
    }
  }
  out.push({ start, length: destSize - start, offset })
  return out
}

export function mapTiles(viewport: SceneViewport): MapTile[] {
  const sourceX = viewport.firstTileX * MAP_UNIT
  const sourceY = viewport.firstTileY * MAP_UNIT
  const sourceWidth = viewport.lastTileX * MAP_UNIT - MAP_UNIT - sourceX
  const sourceHeight = viewport.lastTileY * MAP_UNIT - MAP_UNIT - sourceY
  const tiles: MapTile[] = []
  for (const v of runs(sourceHeight, STAGE_HEIGHT)) {
    for (const h of runs(sourceWidth, STAGE_WIDTH)) {
      tiles.push({
        destX: h.start,
        destY: v.start,
        sourceX: sourceX + h.start + h.offset,
        sourceY: sourceY + v.start + v.offset,
        width: h.length,
        height: v.length,
      })
    }
  }
  return tiles
}
