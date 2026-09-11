import { Application, Assets, Container, Sprite, Texture } from 'pixi.js'
import { resolveAsset } from '../../assets/resolve'
import type { AssetId } from '../../assets/ids'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../stage/constants'
import type { EndDrawOp } from './drawList'

/**
 * 结局面板渲染器（Pixi，xl-czb.6）。**执行 `drawList` 那份清单，自己不做任何决定** ——
 * 画什么、画在哪、什么次序全在 `drawList.ts` 那个纯函数里，进得了 `pnpm test`；这里只剩
 * 「把一张纹理贴到 (x,y)」这件在浏览器里才做得成的事，没有测试缝。
 *
 * 不与商店 / 菜单 / 存读档那几份抽公共件，理由同 `shop/render/shopRenderer.ts` 的头注。
 * 比存读档那份还少一样：这个面板一个字都不写。
 */
export interface EndRenderer {
  load(ids: readonly AssetId[]): Promise<void>
  draw(ops: readonly EndDrawOp[]): void
  destroy(): void
}

/** 素材 URL。**前缀白名单**：只认 `end:`。认不出来一律抛，不猜。 */
export function endAssetUrl(id: AssetId): string {
  if (id.startsWith('end:')) return resolveAsset(id)
  throw new Error(`结局面板渲染器只认 end: 前缀的逻辑 ID，收到 ${id}`)
}

export async function createEndRenderer(host: HTMLElement): Promise<EndRenderer> {
  const app = new Application()
  await app.init({ width: STAGE_WIDTH, height: STAGE_HEIGHT, autoDensity: false, resolution: 1, background: '#000000' })
  if (app.canvas.width !== STAGE_WIDTH || app.canvas.height !== STAGE_HEIGHT) {
    app.destroy({ removeView: true }, { children: true })
    throw new Error(`结局面板渲染器的位图是 ${app.canvas.width}×${app.canvas.height}，应为 ${STAGE_WIDTH}×${STAGE_HEIGHT}。`)
  }
  app.canvas.className = 'stage-canvas'
  host.appendChild(app.canvas)

  const stage = new Container()
  app.stage.addChild(stage)
  const textures = new Map<AssetId, Texture>()
  const pool: Sprite[] = []

  async function load(ids: readonly AssetId[]): Promise<void> {
    const wanted = [...new Set(ids)].filter((id) => !textures.has(id))
    if (wanted.length === 0) return
    const urls = wanted.map(endAssetUrl)
    const loaded = (await Assets.load(urls)) as Record<string, Texture>
    wanted.forEach((id, i) => {
      const texture = loaded[urls[i]!]
      if (!texture) throw new Error(`结局面板素材 ${id} 载入之后取不到纹理`)
      texture.source.scaleMode = 'nearest'
      textures.set(id, texture)
    })
  }

  function textureOf(id: AssetId): Texture {
    const t = textures.get(id)
    if (!t) throw new Error(`结局面板渲染要 ${id}，但没有载入它（已载 ${textures.size} 张）；名单见 end/assets.ts 的 endTextureIds`)
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

  function draw(ops: readonly EndDrawOp[]): void {
    ops.forEach((op, i) => {
      const sprite = slot(i)
      sprite.texture = textureOf(op.id)
      sprite.position.set(op.x, op.y)
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
