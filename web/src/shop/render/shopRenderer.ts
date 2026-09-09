import { Application, Assets, Container, Sprite, Texture } from 'pixi.js'
import { resolveAsset } from '../../assets/resolve'
import { drugPictureAssetId, equipPictureAssetId } from '../../assets/ids'
import type { AssetId } from '../../assets/ids'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../stage/constants'
import { TEXT_FONT_STACK } from '../../textFont'
import { shopAssetId } from '../shopAssets'
import type { ShopDrawOp } from './drawList'

/**
 * 商店层渲染器（Pixi）。**执行 `drawList` 那份清单，自己不做任何决定。**
 *
 * 分工与 `menu/render/menuRenderer.ts` 一样：画什么、画在哪、按什么次序全在
 * `drawList.ts` 那个纯函数里，进得了 `pnpm test`；这里只剩"把一张纹理贴到
 * (x,y)"这件在浏览器里才做得成的事，因此**没有测试缝**。真实像素由跨端逐帧
 * 比对兜底 —— shop 那条流水线归 xl-knp.10。
 *
 * **不与菜单那一份抽公共件**：两边今天确实像（`menuRenderer.ts` 的头注也是
 * 这么写的，那时是"不与战斗那一份抽"），但商店还没长成，现在抽是在猜共性，
 * 而且会让 M4 每张票都去动菜单模块、并行度归零。M4 收尾再评估。
 *
 * 两处照抄原版的绘制语义与菜单同源：最近邻采样、字画在**基线**上。
 */

export interface ShopRenderer {
  /** 把这一帧用得到的纹理一次载齐。**必须在第一次 `draw` 之前 await 完。** */
  load(ids: readonly AssetId[]): Promise<void>
  /** 画一帧：执行这份清单。 */
  draw(ops: readonly ShopDrawOp[]): void
  destroy(): void
}

/**
 * 一个商店素材的 URL。
 *
 * **四个前缀，全都走主包映射表**，各自的边界写在别处：`shop:` 是 xl-knp.5
 * 烘的那 86 张里进主包的那批；`battle:` 是鼠标图那八张（在 `image/` 下）；
 * `drug:` 与 `equip:` 是商品图，由 xl-rh9.12 与 xl-234 先烘的。
 *
 * ⚠️ **商店这一层没有按需加载那一支** —— 进主包的那批按定义全都有代码引用，
 * 而没有代码引用的那 13 张落在 `src/generated/shop-unreferenced/`，
 * 不进 `assets.json`、不进 dist（`shop/shopAssets.ts` 的头注）。所以这里
 * 一律 `resolveAsset`，没有 `isDeferred…` 那一层分流。
 *
 * **前缀是白名单**：认不出来的一律抛，不猜。猜出来的 ID 要么查不到，要么
 * 恰好撞上别的素材（画错图，且悄无声息）。
 *
 * ⚠️ **它在闭包外面，是为了有一条缝**：分流与反向自检是**决定**，不是贴图，
 * 而 shop 的逐帧比对还没接上（xl-knp.10），这里是唯一守着它的地方。
 * 判据在 `shopRenderer.test.ts`。
 */
export function shopAssetUrl(id: AssetId): string {
  const shop = id.startsWith('shop:') ? id.slice('shop:'.length) : null
  if (shop !== null) {
    // 反向自检：ID 是从路径算出来的，算回去必须一致。不一致说明有人手写了 ID。
    if (shopAssetId(shop) !== id) {
      throw new Error(`商店素材 ID ${id} 不是从 sources/Shop/${shop} 算出来的`)
    }
    return resolveAsset(id)
  }
  const drug = id.startsWith('drug:') ? id.slice('drug:'.length) : null
  if (drug !== null) {
    if (drugPictureAssetId(drug) !== id) {
      throw new Error(`药品插图 ID ${id} 不是从文件名 ${drug} 算出来的`)
    }
    return resolveAsset(id)
  }
  const equip = id.startsWith('equip:') ? id.slice('equip:'.length) : null
  if (equip !== null) {
    const slash = equip.indexOf('/')
    if (slash < 0 || equipPictureAssetId(equip.slice(0, slash), equip.slice(slash + 1)) !== id) {
      throw new Error(`装备图 ID ${id} 不是从 <类>/<文件名> 算出来的`)
    }
    return resolveAsset(id)
  }
  // 鼠标那八张在 `image/鼠标图/` 下。⚠️ `sources/菜单/鼠标图/` 下另有一份
  // 同名的八张（`menu:` 前缀），拿错一份画出来几乎一样，而它是错的。
  if (id.startsWith('battle:')) return resolveAsset(id)
  throw new Error(`商店渲染器只认 shop:、battle:、drug: 与 equip: 前缀的逻辑 ID，收到 ${id}`)
}

export async function createShopRenderer(host: HTMLElement): Promise<ShopRenderer> {
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
      `商店渲染器建出来的位图是 ${app.canvas.width}×${app.canvas.height}，` +
        `应为 ${STAGE_WIDTH}×${STAGE_HEIGHT}。`,
    )
  }
  app.canvas.className = 'stage-canvas'
  host.appendChild(app.canvas)

  const stage = new Container()
  app.stage.addChild(stage)

  const textures = new Map<AssetId, Texture>()
  /** 精灵池：只增不减。 */
  const pool: Sprite[] = []
  /** 文字纹理按「内容 + 字号 + 颜色」缓存 —— 商品名与价钱每帧都一样。 */
  const textCache = new Map<string, { texture: Texture; ascent: number; left: number }>()

  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')
  if (!measureCtx) throw new Error('取不到商店文字层的 2D context')

  function fontOf(size: number): string {
    // `new Font("文鼎粗钢笔行楷", Font.BOLD, size)`。后备链在 `textFont.ts` 里。
    return `bold ${size}px ${TEXT_FONT_STACK}`
  }

  function textTexture(content: string, size: number, color: string) {
    const key = `${size}|${color}|${content}`
    const hit = textCache.get(key)
    if (hit) return hit
    const pad = 2
    measureCtx!.font = fontOf(size)
    const m = measureCtx!.measureText(content)
    const left = Math.ceil(m.actualBoundingBoxLeft) + pad
    const ascent = Math.ceil(m.actualBoundingBoxAscent) + pad
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, left + Math.ceil(m.actualBoundingBoxRight) + pad)
    canvas.height = Math.max(1, ascent + Math.ceil(m.actualBoundingBoxDescent) + pad)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('取不到商店文字纹理的 2D context')
    ctx.font = fontOf(size)
    ctx.fillStyle = color
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(content, left, ascent)
    const made = { texture: Texture.from(canvas), ascent, left }
    textCache.set(key, made)
    return made
  }

  async function load(ids: readonly AssetId[]): Promise<void> {
    const wanted = [...new Set(ids)].filter((id) => !textures.has(id))
    if (wanted.length === 0) return
    const urls = wanted.map(shopAssetUrl)
    const loaded = (await Assets.load(urls)) as Record<string, Texture>
    wanted.forEach((id, i) => {
      const texture = loaded[urls[i]!]
      if (!texture) throw new Error(`商店素材 ${id} 载入之后取不到纹理`)
      texture.source.scaleMode = 'nearest'
      textures.set(id, texture)
    })
  }

  function textureOf(id: AssetId): Texture {
    const t = textures.get(id)
    if (!t) {
      // 静默不画就是"这一块偶尔不见了"，正是查不出来的那种错。
      throw new Error(
        `商店渲染要 ${id}，但没有载入它（已载 ${textures.size} 张）；` +
          `名单由 render/assets.ts 的 shopTextureIds 从世界现推。`,
      )
    }
    return t
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

  function draw(ops: readonly ShopDrawOp[]): void {
    ops.forEach((op, i) => {
      const sprite = slot(i)
      // 精灵是**回收再用**的，所以每一条都要把上一条留下的三样按回默认值。
      sprite.scale.set(1)
      sprite.tint = 0xffffff
      sprite.alpha = 1
      if (op.kind === 'image') {
        sprite.texture = textureOf(op.id)
        sprite.position.set(op.x, op.y)
      } else {
        const { texture, ascent, left } = textTexture(op.text, op.size, op.color)
        sprite.texture = texture
        // 基线 → 左上角：往上挪一个 ascent，往左挪一个 left。
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
