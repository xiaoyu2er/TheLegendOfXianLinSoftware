import { Application, Assets, Container, Sprite, Texture } from 'pixi.js'
import { resolveAsset } from '../../assets/resolve'
import type { AssetId } from '../../assets/ids'
import { scaledBlitPasses } from '../../battle/render/scaledBlit'
import type { BlitRect } from '../../battle/render/scaledBlit'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../stage/constants'
import { TEXT_FONT_STACK } from '../../textFont'
import { LS_FONT_SIZE, LS_TEXT_COLOR } from './drawList'
import type { SaveLoadDrawOp } from './drawList'

/**
 * 存读档面板渲染器（Pixi，xl-i06.9）。**执行 `drawList` 那份清单，自己不做任何决定**
 * —— 画什么、画在哪、什么次序全在 `drawList.ts` 那个纯函数里，进得了 `pnpm test`；
 * 这里只剩「把一张纹理贴到 (x,y)」这件在浏览器里才做得成的事，没有测试缝。
 *
 * 不与商店 / 菜单那几份抽公共件，理由同 `shop/render/shopRenderer.ts` 的头注。
 * 多出来的只有一支：缩略图按给定尺寸缩（`op.scaled`）。**不交给 GPU 采样**（xl-cpo）：
 * 搬哪些矩形由 `scaledBlitPasses` 按原版的采样表说了算，这里在 CPU 上两趟拼成 150×100
 * 的位图再 1:1 贴 —— 与战斗提示图、旁白背景同一个做法（`battle/render/scaledBlit.ts`）。
 */
export interface SaveLoadRenderer {
  load(ids: readonly AssetId[]): Promise<void>
  draw(ops: readonly SaveLoadDrawOp[]): void
  destroy(): void
}

/**
 * 素材 URL。**前缀白名单**：`ls:`（这个面板自己的）、`start:`（鼠标那段，与标题共用）、
 * `map:`（缩略图，场景那批已烘的地图）。认不出来一律抛，不猜。
 */
export function saveLoadAssetUrl(id: AssetId): string {
  if (id.startsWith('ls:') || id.startsWith('start:') || id.startsWith('map:')) return resolveAsset(id)
  throw new Error(`存读档面板渲染器只认 ls:、start: 与 map: 前缀的逻辑 ID，收到 ${id}`)
}

export async function createSaveLoadRenderer(host: HTMLElement): Promise<SaveLoadRenderer> {
  const app = new Application()
  await app.init({ width: STAGE_WIDTH, height: STAGE_HEIGHT, autoDensity: false, resolution: 1, background: '#000000' })
  if (app.canvas.width !== STAGE_WIDTH || app.canvas.height !== STAGE_HEIGHT) {
    app.destroy({ removeView: true }, { children: true })
    throw new Error(`存读档面板渲染器的位图是 ${app.canvas.width}×${app.canvas.height}，应为 ${STAGE_WIDTH}×${STAGE_HEIGHT}。`)
  }
  app.canvas.className = 'stage-canvas'
  host.appendChild(app.canvas)

  const stage = new Container()
  app.stage.addChild(stage)
  const textures = new Map<AssetId, Texture>()
  const pool: Sprite[] = []
  const textCache = new Map<string, { texture: Texture; ascent: number; left: number }>()
  const measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) throw new Error('取不到存读档面板文字层的 2D context')
  const font = `bold ${LS_FONT_SIZE}px ${TEXT_FONT_STACK}`

  function textTexture(content: string) {
    const hit = textCache.get(content)
    if (hit) return hit
    const pad = 2
    measureCtx!.font = font
    const m = measureCtx!.measureText(content)
    const left = Math.ceil(m.actualBoundingBoxLeft) + pad
    const ascent = Math.ceil(m.actualBoundingBoxAscent) + pad
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, left + Math.ceil(m.actualBoundingBoxRight) + pad)
    canvas.height = Math.max(1, ascent + Math.ceil(m.actualBoundingBoxDescent) + pad)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('取不到存读档面板文字纹理的 2D context')
    ctx.font = font
    ctx.fillStyle = LS_TEXT_COLOR
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(content, left, ascent)
    const made = { texture: Texture.from(canvas), ascent, left }
    textCache.set(content, made)
    return made
  }

  async function load(ids: readonly AssetId[]): Promise<void> {
    const wanted = [...new Set(ids)].filter((id) => !textures.has(id))
    if (wanted.length === 0) return
    const urls = wanted.map(saveLoadAssetUrl)
    const loaded = (await Assets.load(urls)) as Record<string, Texture>
    wanted.forEach((id, i) => {
      const texture = loaded[urls[i]!]
      if (!texture) throw new Error(`存读档面板素材 ${id} 载入之后取不到纹理`)
      texture.source.scaleMode = 'nearest'
      textures.set(id, texture)
    })
  }

  function textureOf(id: AssetId): Texture {
    const t = textures.get(id)
    if (!t) throw new Error(`存读档面板渲染要 ${id}，但没有载入它（已载 ${textures.size} 张）；名单见 drawList.ts 的 saveLoadTextureIds`)
    return t
  }

  /** 按一组矩形把 `source` 搬到一张新 canvas 上，关掉插值。 */
  function blitOnto(source: CanvasImageSource, width: number, height: number, rects: readonly BlitRect[]): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('取不到存读档缩略图的 2D context')
    ctx.imageSmoothingEnabled = false
    for (const r of rects) ctx.drawImage(source, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh)
    return canvas
  }

  /**
   * 缩略图：整张地图按原版的采样表拼成目标尺寸（xl-cpo）。一张图一个缓存 —— 地图最大
   * 3200×2560，第一趟的中间位图是 150×2560，不值得每帧重拼。
   */
  const scaledCache = new Map<string, Texture>()
  function scaledTexture(id: AssetId, tex: Texture, scaled: NonNullable<Extract<SaveLoadDrawOp, { kind: 'image' }>['scaled']>): Texture {
    const key = `${id}|${scaled.width}x${scaled.height}|${scaled.loop}`
    const hit = scaledCache.get(key)
    if (hit) return hit
    const resource = tex.source.resource as CanvasImageSource | undefined
    if (!resource) throw new Error(`缩略图取不到 ${id} 的位图源`)
    // 源矩形是整张图（原版 `drawImage(img, x, y, w, h)` 没有源矩形）；图集里的偏移在这里加。
    const passes = scaledBlitPasses(
      { x: tex.frame.x, y: tex.frame.y, width: tex.width, height: tex.height },
      { width: scaled.width, height: scaled.height },
      scaled.loop,
    )
    const mid = blitOnto(resource, scaled.width, tex.height, passes.horizontal)
    const out = blitOnto(mid, scaled.width, scaled.height, passes.vertical)
    const made = Texture.from(out)
    made.source.scaleMode = 'nearest'
    scaledCache.set(key, made)
    return made
  }

  function slot(i: number): Sprite {
    while (pool.length <= i) {
      const sprite = new Sprite()
      sprite.visible = false
      stage.addChild(sprite)
      pool.push(sprite)
    }
    return pool[i]!
  }

  function draw(ops: readonly SaveLoadDrawOp[]): void {
    ops.forEach((op, i) => {
      const sprite = slot(i)
      sprite.scale.set(1)
      if (op.kind === 'image') {
        const texture = textureOf(op.id)
        sprite.texture = op.scaled ? scaledTexture(op.id, texture, op.scaled) : texture
        sprite.position.set(op.x, op.y)
      } else {
        const { texture, ascent, left } = textTexture(op.text)
        sprite.texture = texture
        sprite.position.set(op.x - left, op.y - ascent)
      }
      sprite.visible = true
    })
    for (let i = ops.length; i < pool.length; i++) pool[i]!.visible = false
    app.render()
  }

  return {
    load,
    draw,
    destroy() {
      app.destroy({ removeView: true }, { children: true })
    },
  }
}
