import { Application, Assets, Container, Sprite, Texture } from 'pixi.js'
import { mapAssetId } from '../assets/ids'
import { resolveAsset } from '../assets/resolve'
import type { SceneScript } from '../data/types'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/constants'

/** 一个瓦片的边长（像素）。原版 `scene.Map.CS = 32`。 */
export const TILE = 32

export interface SceneRenderer {
  /** 切到某个场景：解析地图资产、加载、贴上去。同一张图第二次是缓存命中。 */
  showScene(scene: SceneScript): Promise<void>
  destroy(): void
}

/**
 * 场景层渲染器（Pixi）。
 *
 * 现在只画地图底图。主角、NPC、遮掩层分别是 xl-9bd.6 / .9，
 * 镜头跟随是 xl-9bd.7 —— 在那之前世界容器恒定停在 (0, 0)，
 * 大地图因此显示左上角那一屏。
 *
 * 这一层**没有测试缝**，是 spec 的明确决策：给渲染硬加缝只会得到一堆断言
 * "我调用了 drawSprite" 的实现细节测试。真实像素由跨端剧本逐帧比对兜底
 * （xl-9bd.8）。所以这里的每一个失败都必须是响的 —— 见下面的尺寸校验。
 *
 * **canvas 由 Pixi 自己建，挂进 `host`，销毁时一并摘掉。**
 * 不要改成把现成的 canvas 递给 `app.init({ canvas })`：一张 canvas 上
 * init → destroy → 再 init，第二次 init **不报错，直接把主线程挂住**
 * （实测：headless Chrome + SwiftShader 下 `Runtime.enable` 都超时，
 * 页面再也不响应）。而 React 19 的 StrictMode 在开发模式下就是
 * 挂载→卸载→再挂载，正好走这条路 —— 于是"开发模式下白屏卡死、
 * 生产模式正常"，是最难查的那种。每次挂载都用新的 canvas 就绕开了整类问题。
 */
export async function createSceneRenderer(host: HTMLElement): Promise<SceneRenderer> {
  const app = new Application()
  await app.init({
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    // 位图恒为 1024×640，缩放交给 CSS（见 stage/Stage.tsx）。
    // 交给 Pixi 去跟随 DPR 会让逻辑坐标不再等于位图坐标。
    autoDensity: false,
    resolution: 1,
    background: '#000000',
  })
  // 位图必须恰好是逻辑画布。一旦不是，游戏里所有的逻辑坐标都会悄悄错位
  // （画面看着只是"有点糊"），所以这里直接拒绝开工。
  if (app.canvas.width !== STAGE_WIDTH || app.canvas.height !== STAGE_HEIGHT) {
    app.destroy({ removeView: true }, { children: true })
    throw new Error(
      `渲染器建出来的位图是 ${app.canvas.width}×${app.canvas.height}，` +
        `应为 ${STAGE_WIDTH}×${STAGE_HEIGHT}。`,
    )
  }
  app.canvas.className = 'stage-canvas'
  host.appendChild(app.canvas)

  const world = new Container()
  app.stage.addChild(world)
  let mapSprite: Sprite | null = null

  return {
    async showScene(scene: SceneScript): Promise<void> {
      const texture = await Assets.load<Texture>(resolveAsset(mapAssetId(scene.mapName)))

      // 地图图片必须正好是 瓦片数 × 32。原版就是这么画的（`Map.drawMap` 的源
      // 矩形直接用世界像素），对不上就意味着碰撞网格和图对不齐 —— 那种错在
      // 画面上表现为"墙的位置有点怪"，不查是查不出来的，所以这里直接拒绝渲染。
      const expected = `${scene.col * TILE}×${scene.row * TILE}`
      const actual = `${texture.width}×${texture.height}`
      if (expected !== actual) {
        throw new Error(
          `${scene.script} 的地图 ${scene.mapName} 是 ${actual}，` +
            `但碰撞网格是 ${scene.col}×${scene.row} 瓦片，应为 ${expected}。`,
        )
      }

      if (mapSprite) {
        // 只销毁精灵，纹理留给 Assets 的缓存 —— 场景来回切不必反复解码。
        mapSprite.destroy({ texture: false })
      }
      mapSprite = new Sprite(texture)
      world.addChild(mapSprite)
      // 视口跟随在 xl-9bd.7；在那之前恒为左上角。
      world.position.set(0, 0)
    },

    destroy(): void {
      app.destroy({ removeView: true }, { children: true })
    },
  }
}
