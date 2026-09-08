import { Application, Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js'
import { isDeferredBattleAsset } from '../../assets/battleAssets'
import { resolveDeferredBattleAsset } from '../../assets/deferredBattle'
import type { AssetId } from '../../assets/ids'
import { resolveAsset } from '../../assets/resolve'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../stage/constants'
import { TEXT_FONT_STACK } from '../../textFont'
import type { DrawOp, Rect } from './drawList'
import type { BlitRect } from './scaledBlit'
import { scaledBlitPasses } from './scaledBlit'

/**
 * 战斗层渲染器（Pixi）。**执行 `drawList` 那份清单，自己不做任何决定。**
 *
 * 分工是有意的：画什么、画在哪、按什么次序，全在 `drawList.ts` 那个纯函数里，
 * 于是那些都进得了 `pnpm test`；这里只剩「把一张纹理贴到 (x,y)」这件在浏览器
 * 里才做得成的事，跟 `scene/sceneRenderer.ts` 一样**没有测试缝** —— 给它硬加
 * 缝只会得到一堆断言"我调用了 setTexture"的实现细节测试。真实像素由跨端剧本
 * 逐帧比对兜底（`docs/frame-compare.md`）。
 *
 * ## 三处必须照抄原版的绘制语义
 *
 * 1. **最近邻采样**。Java2D 的 `KEY_INTERPOLATION` 默认就是最近邻，Pixi 默认
 *    线性。战斗里 `Reminder` 那一层是真的在缩放（源 128×24 拉到目标 0..120 宽），
 *    线性过滤会让边缘糊掉一圈，而那一圈在逐帧比对里就是几百个像素。
 *    **而"最近邻"本身还不够**：纹素边界上打平时 GPU 与 Java2D 会分道扬镳，
 *    所以缩放那一层的位图由 CPU 按原版的采样表拼出来再 1:1 贴上去，
 *    见 `scaledBlit.ts` 与下面的 `scaledTexture`（xl-ttu）。
 * 2. **源矩形越界要裁，不要缩**。怒气槽满的时候源矩形会伸到图外面
 *    （`sy1 = 80 - height` 而 height 算到 100），Java2D 把图外那部分当成透明，
 *    也就是**少画几行**，不是把图挤扁。目标与源等大时裁一刀就等价，见 `clip()`。
 * 3. **字画在基线上**。`g.drawString(s, x, y)` 的 y 是基线，不是行盒左上角。
 *    与 `scene/sceneRenderer.ts` 同一个理由，用 2D canvas 自己写字；ascent
 *    是量出来的，不是拍的常数（见 `textTexture`）。
 */

export interface BattleRenderer {
  /** 把这一场用得到的纹理一次载齐。**必须在第一次 `draw` 之前 await 完。** */
  load(ids: readonly AssetId[]): Promise<void>
  /** 画一帧：执行这份清单。 */
  draw(ops: readonly DrawOp[]): void
  destroy(): void
}

/** 与 `BattlePanel` 的字体一致：`new Font("文鼎粗钢笔行楷", Font.BOLD, 15)`。 */
const FONT = `bold 15px ${TEXT_FONT_STACK}`

export async function createBattleRenderer(host: HTMLElement): Promise<BattleRenderer> {
  const app = new Application()
  await app.init({
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    autoDensity: false,
    resolution: 1,
    background: '#000000',
  })
  if (app.canvas.width !== STAGE_WIDTH || app.canvas.height !== STAGE_HEIGHT) {
    app.destroy({ removeView: true }, { children: true })
    throw new Error(
      `战斗渲染器建出来的位图是 ${app.canvas.width}×${app.canvas.height}，` +
        `应为 ${STAGE_WIDTH}×${STAGE_HEIGHT}。`,
    )
  }
  app.canvas.className = 'stage-canvas'
  host.appendChild(app.canvas)

  const stage = new Container()
  app.stage.addChild(stage)

  const textures = new Map<AssetId, Texture>()

  // 精灵池：只增不减。一帧的绘制条数在 30 上下浮动（伤害数字与被击动画来来
  // 去去），来回建销毁精灵不值得。
  const pool: { sprite: Sprite; frame: Texture }[] = []

  // 文字：**每条 `drawString` 各自一张小纹理**，不是合成一整层。
  //
  // 原本是合成一层再插进 z 序里的（跟 `scene/sceneRenderer.ts` 的旁白一样），
  // 第一次真跑就炸了：`StateBlank.drawStateBlank` 是**按人**循环的，一个人
  // 一条血、一条灵力、三行字，于是文字与图片在第 6..18 条之间交替出现。
  // 合成一层就只能插在一个位置上，那会改 z 序。
  //
  // 每条一张纹理是唯一不改 z 序的做法。代价是一帧最多九张小纹理，而它们按
  // 文字内容缓存 —— 血量不变就不重画。
  const textCache = new Map<string, { texture: Texture; left: number; ascent: number }>()
  const measureCanvas = document.createElement('canvas')
  const measureCtx0 = measureCanvas.getContext('2d')
  if (!measureCtx0) throw new Error('取不到战斗文字层的 2D context')
  const measureCtx = measureCtx0

  /**
   * 把一串字画成一张刚好裹住它的纹理，并记下**基线在纹理里的位置**。
   *
   * `g.drawString(s,x,y)` 的 y 是基线；精灵摆的是左上角。两者差一个随字体
   * 而变的 ascent，所以这里量出来带着走 —— 拍一个常数的话，换一台机器换一条
   * 后备字体链，整排字就上下错开几个像素。
   */
  function textTexture(text: string): { texture: Texture; left: number; ascent: number } {
    const cached = textCache.get(text)
    if (cached) return cached
    const pad = 2
    measureCtx.font = FONT
    const m = measureCtx.measureText(text)
    const left = Math.ceil(m.actualBoundingBoxLeft) + pad
    const ascent = Math.ceil(m.actualBoundingBoxAscent) + pad
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, left + Math.ceil(m.actualBoundingBoxRight) + pad)
    canvas.height = Math.max(1, ascent + Math.ceil(m.actualBoundingBoxDescent) + pad)
    const c = canvas.getContext('2d')
    if (!c) throw new Error('取不到战斗文字纹理的 2D context')
    c.font = FONT
    // `g.setColor(Color.black)`。
    c.fillStyle = '#000000'
    c.textBaseline = 'alphabetic'
    c.fillText(text, left, ascent)
    const made = { texture: Texture.from(canvas), left, ascent }
    textCache.set(text, made)
    return made
  }

  function slot(i: number): { sprite: Sprite; frame: Texture } {
    while (pool.length <= i) {
      // `dynamic` 必须开：同一个精灵这一帧贴血条、下一帧贴别的，源矩形每帧都
      // 在动。不开的话它会一直用建的时候那一份 uv。
      const frame = new Texture({
        source: Texture.EMPTY.source,
        frame: new Rectangle(0, 0, 1, 1),
        dynamic: true,
      })
      const sprite = new Sprite()
      sprite.visible = false
      stage.addChild(sprite)
      pool.push({ sprite, frame })
    }
    return pool[i]!
  }

  function textureOf(id: AssetId): Texture {
    const t = textures.get(id)
    if (!t) {
      // 载入时漏了这个 ID。静默不画就是"这个精灵偶尔不见了"，正是查不出来的
      // 那种错 —— `battleTextureIds` 少推了一条的表现就长这样。
      throw new Error(
        `战斗渲染要 ${id}，但这一场没有载入它（已载 ${textures.size} 张）；` +
          `名单由 render/assets.ts 的 battleTextureIds 从世界现推。`,
      )
    }
    return t
  }

  /**
   * 把源矩形裁进纹理里，目标矩形按同样的比例跟着裁。
   *
   * **它现在只在目标与源等大时才会被调到**（缩放那一支走 `scaledTexture`），
   * 而等大时这就是"少画几行/几列"，与 Java2D 把图外当透明的效果一致。
   * 按比例跟着裁那一段因此恒等于 1:1，留着是因为"越界要裁"这件事本身是原版
   * 的语义（怒气槽满的时候源矩形会伸到图外面），不是这条分支的偶然。
   */
  function clip(dest: Rect, src: Rect, tex: Texture): { dest: Rect; src: Rect } | null {
    const sx0 = Math.max(0, src.x)
    const sy0 = Math.max(0, src.y)
    const sx1 = Math.min(tex.width, src.x + src.width)
    const sy1 = Math.min(tex.height, src.y + src.height)
    if (sx1 <= sx0 || sy1 <= sy0) return null
    const kx = dest.width / src.width
    const ky = dest.height / src.height
    return {
      src: { x: sx0, y: sy0, width: sx1 - sx0, height: sy1 - sy0 },
      dest: {
        x: dest.x + (sx0 - src.x) * kx,
        y: dest.y + (sy0 - src.y) * ky,
        width: (sx1 - sx0) * kx,
        height: (sy1 - sy0) * ky,
      },
    }
  }

  /**
   * 缩放过的位图，按 **素材 + 源矩形 + 目标尺寸** 缓存。
   *
   * 只增不减，和精灵池同一个理由：提示图一共 22 张、目标尺寸一共 12 档
   * （`Reminder.update()` 每拍宽 +10 高 +2，到 120×24 为止），封顶 264 张
   * 120×24 的小位图；而它每拍都在变尺寸，不缓存就是每帧现拼。
   */
  const scaledCache = new Map<string, Texture>()

  /**
   * 开一张 canvas，把这些矩形逐个 `drawImage` 上去。
   *
   * `imageSmoothingEnabled=false` 是必须的：搬的段落要么是 1:1 的整段拷贝，
   * 要么是"一个源像素铺满 length 个目标像素"，开着插值后者会被抹匀。
   */
  function blitOnto(
    source: CanvasImageSource,
    width: number,
    height: number,
    rects: readonly BlitRect[],
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('取不到缩放贴图的 2D context')
    ctx.imageSmoothingEnabled = false
    for (const r of rects) {
      ctx.drawImage(source, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh)
    }
    return canvas
  }

  /**
   * 按原版的采样表把一块源区域拼成目标尺寸的位图。**不经过 GPU 采样**，
   * 理由见文件头第 1 条与 `scaledBlit.ts`。
   *
   * **搬哪些矩形由 `scaledBlitPasses` 说了算**，这里只负责把它们交给
   * `drawImage`：几何进得了 `pnpm test`（那边拿一个软件 blitter 逐像素核），
   * 而"开一张 canvas、关掉插值"这件只有浏览器做得成的事留在这里。
   */
  function scaledTexture(id: AssetId, tex: Texture, src: Rect, dest: Rect): Texture {
    const key = `${id}|${src.x},${src.y},${src.width},${src.height}|${dest.width}x${dest.height}`
    const hit = scaledCache.get(key)
    if (hit) return hit

    // 缩放这一层没有"源矩形越界要裁"的先例（提示图的源恒为整张图），所以越界
    // 在这里是响亮失败，而不是照 `clip()` 那样按比例裁一刀 —— 那条等价关系是
    // 目标与源等大时才成立的，缩放时裁完的比例该怎么算没量过。
    if (
      src.x < 0 ||
      src.y < 0 ||
      src.x + src.width > tex.width ||
      src.y + src.height > tex.height
    ) {
      throw new Error(
        `缩放贴图的源矩形越界：${id} 是 ${tex.width}×${tex.height}，` +
          `要的是 (${src.x},${src.y}) 起 ${src.width}×${src.height}`,
      )
    }
    const resource = tex.source.resource as CanvasImageSource | undefined
    if (!resource) throw new Error(`缩放贴图取不到 ${id} 的位图源`)

    // 源在图集里的偏移：`scaledBlitPasses` 只知道逻辑坐标，加偏移是这里的事。
    const passes = scaledBlitPasses(
      { x: tex.frame.x + src.x, y: tex.frame.y + src.y, width: src.width, height: src.height },
      dest,
    )

    const mid = blitOnto(resource, dest.width, src.height, passes.horizontal)
    const out = blitOnto(mid, dest.width, dest.height, passes.vertical)

    const made = Texture.from(out)
    made.source.scaleMode = 'nearest'
    scaledCache.set(key, made)
    return made
  }

  function draw(ops: readonly DrawOp[]): void {
    let n = 0
    for (const op of ops) {
      const s = slot(n)
      if (op.kind === 'text') {
        const t = textTexture(op.text)
        s.sprite.texture = t.texture
        // 基线对齐：精灵左上角 = 落笔点减去纹理里的 (left, ascent)。
        s.sprite.position.set(op.x - t.left, op.y - t.ascent)
        s.sprite.setSize(t.texture.width, t.texture.height)
        s.sprite.visible = true
        n++
        continue
      }
      const tex = textureOf(op.id)
      if (op.kind === 'image') {
        s.sprite.texture = tex
        s.sprite.position.set(op.x, op.y)
        s.sprite.setSize(tex.width, tex.height)
        s.sprite.visible = true
        n++
        continue
      }
      if (op.dest.width !== op.src.width || op.dest.height !== op.src.height) {
        // 真的在缩放。目标是空的（提示图 `show()` 之后、第一次 `update()` 之前
        // 就是 0 宽）时原版什么都不画。
        if (op.dest.width <= 0 || op.dest.height <= 0) continue
        s.sprite.texture = scaledTexture(op.id, tex, op.src, op.dest)
        s.sprite.position.set(op.dest.x, op.dest.y)
        s.sprite.setSize(op.dest.width, op.dest.height)
        s.sprite.visible = true
        n++
        continue
      }
      const clipped = clip(op.dest, op.src, tex)
      if (!clipped) continue
      s.frame.source = tex.source
      s.frame.frame.x = tex.frame.x + clipped.src.x
      s.frame.frame.y = tex.frame.y + clipped.src.y
      s.frame.frame.width = clipped.src.width
      s.frame.frame.height = clipped.src.height
      s.frame.update()
      s.sprite.texture = s.frame
      s.sprite.position.set(clipped.dest.x, clipped.dest.y)
      s.sprite.setSize(clipped.dest.width, clipped.dest.height)
      s.sprite.visible = true
      n++
    }
    // 这一帧没用到的精灵全部藏起来。**不藏的话**上一帧的伤害数字会留在屏幕
    // 上，而那看起来像"伤害数字停留得久了一点"，不像一个错。
    for (let i = n; i < pool.length; i++) pool[i]!.sprite.visible = false
  }

  return {
    async load(ids: readonly AssetId[]): Promise<void> {
      const wanted = ids.filter((id) => !textures.has(id))
      const loaded = await Promise.all(
        wanted.map(async (id) => {
          const url = await urlOf(id)
          const texture = await Assets.load<Texture>(url)
          // 最近邻，理由见文件头第 1 条。
          texture.source.scaleMode = 'nearest'
          return texture
        }),
      )
      wanted.forEach((id, i) => textures.set(id, loaded[i]!))
    },
    draw,
    destroy(): void {
      app.destroy({ removeView: true }, { children: true })
    },
  }
}

/** 药品菜单介绍图的 ID 前缀，见下面 `urlOf` 的注释。 */
const DRUG_PREFIX = 'drug:'

/**
 * 一个战斗素材的 URL。**边界判在这里，只判一次**：`技能动画` 与 `背景动画`
 * 走 `public/` 按需加载，其余走带指纹的主包产物（`assets/battleAssets.ts`）。
 *
 * `drug:` 是唯一一个不带 `battle:` 前缀却要在战斗里画的（xl-rh9.12）：药品
 * 菜单的介绍图在 `sources/Shop/药品/回复类/` 下，不在 `image/` 里，所以走
 * 主包那一条 —— 按需那条边界是按 `image/` 的顶层目录切的，`drug:` 根本不在
 * 那个坐标系里。**前缀是白名单**：认不出来的一律抛，不猜；猜出来的 ID 要么
 * 查不到，要么恰好撞上别的素材（画错图，且悄无声息）。
 */
async function urlOf(id: AssetId): Promise<string> {
  if (id.startsWith(DRUG_PREFIX)) return resolveAsset(id)
  const relative = id.startsWith('battle:') ? id.slice('battle:'.length) : null
  if (relative === null) {
    throw new Error(`战斗渲染只认 battle: 与 ${DRUG_PREFIX} 前缀的逻辑 ID，收到 ${id}`)
  }
  return isDeferredBattleAsset(relative) ? resolveDeferredBattleAsset(id) : resolveAsset(id)
}
