import { Application, Assets, Container, Sprite, Texture } from 'pixi.js'
import { isDeferredMenuAsset, menuAssetId } from '../../assets/menuAssets'
import { isDeferredBattleAsset } from '../../assets/battleAssets'
import { resolveDeferredBattleAsset } from '../../assets/deferredBattle'
import { resolveDeferredMenuAsset } from '../../assets/deferredMenu'
import { resolveAsset } from '../../assets/resolve'
import { drugPictureAssetId } from '../../assets/ids'
import type { AssetId } from '../../assets/ids'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../stage/constants'
import { TEXT_FONT_STACK } from '../../textFont'
import type { MenuDrawOp } from './drawList'

/**
 * 菜单层渲染器（Pixi）。**执行 `drawList` 那份清单，自己不做任何决定。**
 *
 * 分工与 `battle/render/battleRenderer.ts` 一样：画什么、画在哪、按什么次序
 * 全在 `drawList.ts` 那个纯函数里，进得了 `pnpm test`；这里只剩"把一张纹理贴
 * 到 (x,y)"这件在浏览器里才做得成的事，因此**没有测试缝** —— 给它硬加缝只会
 * 得到一堆断言"我调用了 setTexture"的实现细节测试。真实像素由跨端逐帧比对
 * 兜底，而 menu 那条流水线**已经由 xl-6lo.14 接上了**。
 *
 * **不与战斗那一份抽公共件**（xl-6lo.2 §模块边界）：两边今天确实像，但都还没
 * 长成，现在抽是在猜共性，而且会让 M3 每张票都去动战斗模块、并行度归零。
 * M3 收尾再评估。
 *
 * ## 两处照抄原版的绘制语义
 *
 * 1. **最近邻采样**。Java2D 的 `KEY_INTERPOLATION` 默认是最近邻，Pixi 默认线性。
 *    菜单这一层没有缩放（每一条都是 `g.drawImage(img,x,y,panel)` 原尺寸贴），
 *    所以差别只出在缩放整个舞台的时候 —— 那由 `stage/scaling.ts` 管。这里
 *    仍然把纹理的 `scaleMode` 设成 `nearest`，免得将来加了缩放层才发现。
 * 2. **字画在基线上**。`g.drawString(s,x,y)` 的 y 是基线，不是行盒左上角。
 *    与场景 / 战斗同一个理由，用 2D canvas 自己写字；ascent 是量出来的，
 *    不是拍的常数 —— 换一台机器换一条后备字体链，整排字会上下错开几个像素。
 */

export interface MenuRenderer {
  /** 把这一帧用得到的纹理一次载齐。**必须在第一次 `draw` 之前 await 完。** */
  load(ids: readonly AssetId[]): Promise<void>
  /** 画一帧：执行这份清单。 */
  draw(ops: readonly MenuDrawOp[]): void
  destroy(): void
}

/**
 * 一个菜单素材的 URL。**进主包的走映射表，按需的走 `menuContent.json`** ——
 * 边界由 `assets/menuAssets.ts` 定，这里只照它分流。
 *
 * **有两个前缀不带 `menu:` 却要在菜单里画**，各有各的理由：
 *
 * - `battle:`（xl-6lo.11）：奇术页那段技能动画的帧在
 *   `image/技能动画/<角色>技能<招号>/` 下，与战斗用的是同一批文件、同一条
 *   按需边界 —— 菜单素材那条边界是按 `sources/菜单/` 的顶层目录切的，
 *   `image/` 根本不在那个坐标系里。
 * - `drug:`（xl-6lo.15）：物品页选中那瓶药的插图在
 *   `sources/Shop/药品/回复类/` 下，**三个坐标系一个都不在**。它没有按需
 *   那一半 —— `bake.ts` 的 `DRUG_PICTURE_DIR` 把整个目录一路烘进主包映射表
 *   （xl-rh9.12 为战斗侧的药品菜单先烘的），所以直接走 `resolveAsset`。
 *
 * **前缀是白名单**：认不出来的一律抛，不猜。猜出来的 ID 要么查不到，要么
 * 恰好撞上别的素材（画错图，且悄无声息）。
 *
 * ⚠️ **它在闭包外面，是为了有一条缝**。这个文件其余部分是"把纹理贴到 (x,y)"
 * —— 没有测试缝，由跨端逐帧比对兜底（见文件头注）。但**分流是个决定**，
 * 不是贴图：把 `battle:` 那一支错接到主包上，表现是奇术页动画 404，而
 * 逐帧比对当时还没接 menu，一个判据都碰不到它。实测这条篡改在闭包里时是
 * **绿的**。判据在 `menuRenderer.test.ts` —— 它仍然是这一条唯一的守卫，
 * xl-6lo.14 把流水线接上之后也一样：`menu-magic` 那 45 帧奇术页真的取到了图，
 * 但"404 之后画不出来"在浏览器里是抛异常、不是差异像素。
 */
export async function menuAssetUrl(id: AssetId): Promise<string> {
  const battle = id.startsWith('battle:') ? id.slice('battle:'.length) : null
  if (battle !== null) {
    return isDeferredBattleAsset(battle) ? resolveDeferredBattleAsset(id) : resolveAsset(id)
  }
  const drug = id.startsWith('drug:') ? id.slice('drug:'.length) : null
  if (drug !== null) {
    // 反向自检，与下面 `menu:` 那条同一个理由：ID 是从 `drug.txt` 第 4 列
    // 那个文件名算出来的，算回去必须一致。
    if (drugPictureAssetId(drug) !== id) {
      throw new Error(`药品插图 ID ${id} 不是从文件名 ${drug} 算出来的`)
    }
    return resolveAsset(id)
  }
  const relative = id.startsWith('menu:') ? id.slice('menu:'.length) : null
  if (relative === null) {
    throw new Error(`菜单渲染器只认 menu: / battle: / drug: 前缀的逻辑 ID，收到 ${id}`)
  }
  // 反向自检：ID 是从路径算出来的，算回去必须一致。不一致说明有人手写了 ID。
  if (menuAssetId(`sources/菜单/${relative}`) !== id) {
    throw new Error(`菜单素材 ID ${id} 不是从 sources/菜单/${relative} 算出来的`)
  }
  return isDeferredMenuAsset(relative) ? resolveDeferredMenuAsset(id) : resolveAsset(id)
}

export async function createMenuRenderer(host: HTMLElement): Promise<MenuRenderer> {
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
      `菜单渲染器建出来的位图是 ${app.canvas.width}×${app.canvas.height}，` +
        `应为 ${STAGE_WIDTH}×${STAGE_HEIGHT}。`,
    )
  }
  app.canvas.className = 'stage-canvas'
  host.appendChild(app.canvas)

  const stage = new Container()
  app.stage.addChild(stage)

  const textures = new Map<AssetId, Texture>()
  /** 精灵池：只增不减。一帧十来条，来回建销毁不值得。 */
  const pool: Sprite[] = []
  /** 文字纹理按「内容 + 字号 + 颜色」缓存 —— 顶栏那行字每帧都一样。 */
  const textCache = new Map<string, { texture: Texture; ascent: number; left: number }>()

  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')
  if (!measureCtx) throw new Error('取不到菜单文字层的 2D context')

  function fontOf(size: number): string {
    // `new Font("文鼎粗钢笔行楷", Font.BOLD, size)`。那款中文字体多半没交付，
    // 后备链在 `textFont.ts` 里 —— 它正是逐帧比对里最会抖的东西。
    return `bold ${size}px ${TEXT_FONT_STACK}`
  }

  function textTexture(text: string, size: number, color: string) {
    const key = `${size}|${color}|${text}`
    const hit = textCache.get(key)
    if (hit) return hit
    const pad = 2
    measureCtx!.font = fontOf(size)
    const m = measureCtx!.measureText(text)
    const left = Math.ceil(m.actualBoundingBoxLeft) + pad
    const ascent = Math.ceil(m.actualBoundingBoxAscent) + pad
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, left + Math.ceil(m.actualBoundingBoxRight) + pad)
    canvas.height = Math.max(1, ascent + Math.ceil(m.actualBoundingBoxDescent) + pad)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('取不到菜单文字纹理的 2D context')
    ctx.font = fontOf(size)
    ctx.fillStyle = color
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(text, left, ascent)
    const made = { texture: Texture.from(canvas), ascent, left }
    textCache.set(key, made)
    return made
  }

  async function load(ids: readonly AssetId[]): Promise<void> {
    const wanted = [...new Set(ids)].filter((id) => !textures.has(id))
    if (wanted.length === 0) return
    const urls = await Promise.all(wanted.map(menuAssetUrl))
    const loaded = (await Assets.load(urls)) as Record<string, Texture>
    wanted.forEach((id, i) => {
      const texture = loaded[urls[i]!]
      if (!texture) throw new Error(`菜单素材 ${id} 载入之后取不到纹理`)
      texture.source.scaleMode = 'nearest'
      textures.set(id, texture)
    })
  }

  function textureOf(id: AssetId): Texture {
    const t = textures.get(id)
    if (!t) {
      // 静默不画就是"这一块偶尔不见了"，正是查不出来的那种错 ——
      // `menuTextureIds` 少推了一条的表现就长这样。
      throw new Error(
        `菜单渲染要 ${id}，但没有载入它（已载 ${textures.size} 张）；` +
          `名单由 render/assets.ts 的 menuTextureIds 从世界现推。`,
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

  function draw(ops: readonly MenuDrawOp[]): void {
    ops.forEach((op, i) => {
      const sprite = slot(i)
      // 精灵是**回收再用**的，所以每一条都要把上一条留下的三样按回默认值 ——
      // 缩放、着色、透明度。少按一样的表现是"某一帧起某张图忽然变小 / 变色"，
      // 而它取决于上一帧那个位置上是谁，查起来极难（滚动条那条 `rect` 就是
      // 靠这三样画出来的）。
      sprite.scale.set(1)
      sprite.tint = 0xffffff
      sprite.alpha = 1
      if (op.kind === 'image') {
        sprite.texture = textureOf(op.id)
        sprite.position.set(op.x, op.y)
      } else if (op.kind === 'rect') {
        // 一块纯色：白纹理拉到要的尺寸再着色。原版没有这种绘制，见
        // `drawList.ts` 里 `rect` 那一支的注释（xl-6lo.13 的滚动条）。
        sprite.texture = Texture.WHITE
        sprite.position.set(op.x, op.y)
        sprite.setSize(op.width, op.height)
        sprite.tint = op.color
        sprite.alpha = op.alpha
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
