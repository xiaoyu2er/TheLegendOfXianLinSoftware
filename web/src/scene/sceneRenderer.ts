import { Application, Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js'
import { mapAssetId, roleAssetId } from '../assets/ids'
import { resolveAsset } from '../assets/resolve'
import type { SceneScript } from '../data/types'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/constants'
import { createWorld } from '../state/step'
import type { World } from '../state/types'
import { roleSprite } from './roleSprite'
import { computeDrawOrder, computeViewport, mapTiles } from './viewport'

/** 一个瓦片的边长（像素）。原版 `scene.Map.CS = 32`。 */
export const TILE = 32

/**
 * 把纹理的采样方式钉成最近邻，**这是复刻，不是画质偏好**（xl-9bd.16）。
 *
 * 原版画的每一张图都走 `Graphics.drawImage`，而 Java2D 的
 * `RenderingHints.KEY_INTERPOLATION` 默认值是最近邻；Pixi 的 `TextureSource`
 * 默认是线性过滤。地图那一路原先还叠了一个 1.0079/1.0127 的缩放（见
 * `viewport.ts` 的 `mapTiles`），两件事合起来的后果是整屏每一个像素都在变：
 * 实测 dorm-walk 第 0 帧，按 64×64 分格统计，160 个格子全部有偏离、每格
 * 28–59%，全帧 38.51%。
 *
 * 缩放已经改成分段 1:1 平移，理论上采样点正落在源像素正中、线性过滤也取得到
 * 原值；这里仍然钉死最近邻，是因为那个"正中"含 GPU 的插值误差（实测约
 * 0.03 px），线性过滤会把它变成一点点邻居颜色 —— 而最近邻把这段余量整个吃掉。
 */
function nearest(texture: Texture): Texture {
  texture.source.scaleMode = 'nearest'
  return texture
}

export interface SceneRenderer {
  /** 切到某个场景：解析地图资产、加载、贴上去。同一张图第二次是缓存命中。 */
  showScene(scene: SceneScript): Promise<void>
  /**
   * 画出这一帧：镜头、地图底图的摆位、主角、以及主角与 NPC 的先后。
   * **只读 `world`，一个字段都不写回去**——状态推进是 `state/step.ts` 那个纯
   * 函数的事，绘制在这里只是它的一个投影。每帧调一次，成本是改几个数加换一张
   * 纹理。
   *
   * 入参是整个世界而不只是 `role`：镜头要看地图尺寸，绘制顺序要看 NPC，
   * 两者都在 `world` 里。这也是 `computeViewport` / `computeDrawOrder`
   * 绕不过去的地方——不调它们，这个方法就没有位置可写。
   */
  showWorld(world: World): void
  destroy(): void
}

/**
 * 场景层渲染器（Pixi）。
 *
 * 现在画地图底图与主角，镜头跟着主角走并在地图边缘停住（xl-9bd.6 / .7）。
 * NPC 与遮掩层是 xl-9bd.9 —— NPC 那一层已经建好并按绘制顺序排位，只是还空着。
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

  // 三层，次序照抄原版 `ScenePanel.paint()`：地图 → 人物。
  //
  // 地图**不在** `camera` 里面：原版的地图是用一个源矩形铺满整块画布的，
  // 边缘帧那个源矩形会短 8 px，于是地图被轻微拉伸，而人物只是平移。
  // 两者的变换不一样，就不能共用一个容器（见 `viewport.ts` 的 `mapTiles`）。
  const mapLayer = new Container()
  const camera = new Container()
  app.stage.addChild(mapLayer)
  app.stage.addChild(camera)

  // 地图这一帧被切成若干块 1:1 贴上去（见 `viewport.ts` 的 `mapTiles`）。
  // 池子按需长大、只增不减：块数只有 1 或 81 两种，来回切场景不值得反复建精灵。
  let mapTexture: Texture | null = null
  const mapPieces: { sprite: Sprite; texture: Texture }[] = []

  // NPC 是 xl-9bd.9，现在这一层是空的。**它照样要存在**：绘制顺序就是靠
  // 它与主角谁先 addChild 表达的，等有了 NPC 再补一个容器，等于把这一票的
  // 结论重新实现一遍。
  const npcLayer = new Container()

  // 主角的 48 帧一次性载入。逐帧按需加载会让走动的第一圈掉帧，而这批图
  // 一共 100 KB 出头，没有按需的理由。
  const roleTextures = new Map<string, Texture>()
  const heroSprite = new Sprite()
  heroSprite.visible = false
  camera.addChild(npcLayer)
  camera.addChild(heroSprite)

  async function loadRoleTextures(): Promise<void> {
    if (roleTextures.size > 0) return
    const ids: string[] = []
    for (let frame = 0; frame < 32; frame++) ids.push(roleAssetId('walk', frame))
    for (let frame = 0; frame < 16; frame++) ids.push(roleAssetId('run', frame))
    const textures = await Promise.all(
      ids.map((id) => Assets.load<Texture>(resolveAsset(id)).then(nearest)),
    )
    ids.forEach((id, i) => roleTextures.set(id, textures[i]!))
  }

  /**
   * 镜头与绘制顺序：这一帧唯一会写到 Pixi 场景图上的几何。
   *
   * 三件事，都来自 `viewport.ts` 那两个纯函数，一件都不在这里现算：
   *
   * 1. `camera` 平移 `offsetX/offsetY` —— 人物就是这么跟着镜头走的；
   * 2. 地图底图按 `mapTiles` 摆（腹地帧是一块，边缘帧是 81 块，合起来复刻原版
   *    那个 ~0.79%/1.27% 的拉伸，见 `docs/viewport-edge-stretch.md`）；
   * 3. 主角与 NPC 层谁在上：`setChildIndex` 每帧摆一次。
   *
   * 绘制顺序**每帧都要重设**，不能只在变化时设：漏设的表现是"偶尔主角被 NPC
   * 挡住"，跟真正的错误长得一模一样，而且没有任何东西会响。每帧两次
   * `setChildIndex` 是常数开销。
   */
  function place(world: World): void {
    const viewport = computeViewport(world)
    camera.position.set(viewport.offsetX, viewport.offsetY)
    if (mapTexture) {
      const tiles = mapTiles(viewport)
      while (mapPieces.length < tiles.length) {
        // `dynamic` 必须开：每帧都要挪这块碎片在源图上的位置，不开的话精灵
        // 会一直用建的时候那一份 uv，表现为"地图卡在第一帧不动"。
        const texture = new Texture({
          source: mapTexture.source,
          frame: new Rectangle(0, 0, 1, 1),
          dynamic: true,
        })
        const sprite = new Sprite(texture)
        mapLayer.addChild(sprite)
        mapPieces.push({ sprite, texture })
      }
      mapPieces.forEach((piece, i) => {
        const tile = tiles[i]
        if (!tile) {
          piece.sprite.visible = false
          return
        }
        piece.texture.frame.x = tile.sourceX
        piece.texture.frame.y = tile.sourceY
        piece.texture.frame.width = tile.width
        piece.texture.frame.height = tile.height
        piece.texture.update()
        piece.sprite.position.set(tile.destX, tile.destY)
        piece.sprite.visible = true
      })
    }
    if (computeDrawOrder(world) === 'npcs-first') {
      camera.setChildIndex(npcLayer, 0)
      camera.setChildIndex(heroSprite, 1)
    } else {
      camera.setChildIndex(heroSprite, 0)
      camera.setChildIndex(npcLayer, 1)
    }
  }

  return {
    async showScene(scene: SceneScript): Promise<void> {
      await loadRoleTextures()
      const texture = nearest(
        await Assets.load<Texture>(resolveAsset(mapAssetId(scene.mapName))),
      )

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

      // 换地图只换碎片指向的源，精灵与 `Texture` 对象留着 —— Assets 的缓存
      // 保住了解码结果，池子保住了精灵。
      mapTexture = texture
      for (const piece of mapPieces) piece.texture.source = texture.source
      // 第一帧还没来，先按这个场景的初始世界把镜头摆好。不摆的话换场景那一瞬
      // 会闪一下上一张地图的镜头位置（两张地图尺寸不同时尤其明显）。
      place(createWorld(scene))
    },

    showWorld(world: World): void {
      place(world)
      // 纹理还没到（首帧、或者场景正在切）就先不画，别画成一个白方块。
      if (roleTextures.size === 0) return
      const sprite = roleSprite(world.role)
      const texture = roleTextures.get(sprite.asset)
      if (!texture) {
        // 下标算错了。静默不画会表现为"主角偶尔消失"，那是查不出来的。
        throw new Error(`主角没有 ${sprite.asset} 这一帧（dir=${world.role.dir}）。`)
      }
      heroSprite.texture = texture
      heroSprite.position.set(sprite.x, sprite.y)
      heroSprite.setSize(sprite.width, sprite.height)
      heroSprite.visible = true
    },

    destroy(): void {
      app.destroy({ removeView: true }, { children: true })
    },
  }
}
