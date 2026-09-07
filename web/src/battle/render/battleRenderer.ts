import { Application, Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js'
import { isDeferredBattleAsset } from '../../assets/battleAssets'
import { resolveDeferredBattleAsset } from '../../assets/deferredBattle'
import type { AssetId } from '../../assets/ids'
import { resolveAsset } from '../../assets/resolve'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../stage/constants'
import { TEXT_FONT_STACK } from '../../textFont'
import type { DrawOp, Rect } from './drawList'

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
   * 目标与源等大时（战斗里除了 `Reminder` 全是这种）这就是"少画几行/几列"，
   * 与 Java2D 把图外当透明的效果一致。
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

/**
 * 一个战斗素材的 URL。**边界判在这里，只判一次**：`技能动画` 与 `背景动画`
 * 走 `public/` 按需加载，其余走带指纹的主包产物（`assets/battleAssets.ts`）。
 */
async function urlOf(id: AssetId): Promise<string> {
  const relative = id.startsWith('battle:') ? id.slice('battle:'.length) : null
  if (relative === null) {
    throw new Error(`战斗渲染只认 battle: 前缀的逻辑 ID，收到 ${id}`)
  }
  return isDeferredBattleAsset(relative) ? resolveDeferredBattleAsset(id) : resolveAsset(id)
}
