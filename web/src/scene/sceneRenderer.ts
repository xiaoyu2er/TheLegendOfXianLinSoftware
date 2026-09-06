import { Application, Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js'
import { mapAssetId, narratageBgAssetId, npcAssetId, roleAssetId } from '../assets/ids'
import type { AssetId } from '../assets/ids'
import { resolveAsset, resolveAssetOrNull } from '../assets/resolve'
import type { SceneScript } from '../data/types'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/constants'
import { BG_COUNT, MAX_LINE } from '../state/narratage'
import type { NarratageState } from '../state/narratage'
import type { NpcState } from '../state/npc'
import { createWorld } from '../state/step'
import type { World } from '../state/types'
import { npcSprite } from './npcSprite'
import { roleSprite } from './roleSprite'
import { computeDrawOrder, computeViewport, mapTiles, npcLayerOffset } from './viewport'

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

/**
 * 旁白文字的排版，四个数照抄原版 `Narratage.drawNarratage` / `init`：
 * 字号 20 的粗体白字，左边距 50，第 `i` 行的**基线**在 `fontSize * (3 + 2i)`
 * ——也就是 60 / 100 / 140 …，行距正好两倍字号。
 *
 * 字体原版写的是 `文鼎粗钢笔行楷`，那是一款没有随游戏交付的中文字体：
 * 十三年前的机器上装了就是行楷、没装就退到 Java 的默认字体。浏览器里同样
 * 退回后备字体，所以**字形与原版不会逐像素相同**，这是已知偏离，记在
 * `compare/expected.ts` 的 dorm-intro 那条里。位置与颜色是准的。
 */
const TEXT_LEFT = 50
const FONT_SIZE = 20
const FONT_STACK = '"文鼎粗钢笔行楷", "STKaiti", "KaiTi", serif'

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
 * 现在画地图底图、主角与 NPC，镜头跟着主角走并在地图边缘停住
 * （xl-9bd.6 / .7 / .9）。地图遮掩层（`OtherEvent.addMap`）还没有。
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

  // NPC 全部挂在这一层里：绘制顺序是**整层一起翻**的（原版那个局部变量 `b`
  // 一置真，所有 NPC 一起画到主角前面），不是逐个排序。见 `computeDrawOrder`。
  const npcLayer = new Container()
  // 精灵与 `world.npcs` 逐下标对应，`showScene` 时按这个场景的 NPC 条数重建。
  let npcSprites: Sprite[] = []
  // `null` = 仓库里确实没有这份素材（`assets/resolve.ts` 的已知缺失名单）。
  // 原版在那几处画的是一个宽度 −1 的空壳，也就是什么都没画。
  const npcTextures = new Map<AssetId, Texture | null>()

  // 旁白：一张铺满画布的背景动画 + 一层文字（xl-9bd.11）。
  //
  // 整层挂在最上面，**旁白进行中把地图与人物那两层整个藏掉**——原版
  // `ScenePanel.paint()` 里主角、NPC、地图、宝箱、对话框全在
  // `if (!narratage.isNarratage)` 里面，那些帧一个精灵都不画。藏而不是"画在
  // 上面盖住"：背景图有黑边，盖不严的话地图会从缝里露出来。
  const narratageLayer = new Container()
  narratageLayer.visible = false
  app.stage.addChild(narratageLayer)
  const narratageBg = new Sprite()
  narratageLayer.addChild(narratageBg)
  // 52 帧背景，只在这个场景真的有旁白时才载（`showScene`）。
  const narratageTextures: Texture[] = []

  // 文字画在自己的一张离屏画布上，再当纹理贴上去。**不用 Pixi 的 Text**：
  // 原版给的是基线坐标，而 `Text` 摆的是行盒的左上角，两者差一个随字体而变的
  // ascent —— 自己画就能把 `fillText(line, 50, baseline)` 一字不差地照抄。
  const textCanvas = document.createElement('canvas')
  textCanvas.width = STAGE_WIDTH
  textCanvas.height = STAGE_HEIGHT
  const ctx2d = textCanvas.getContext('2d')
  if (!ctx2d) throw new Error('取不到旁白文字层的 2D context')
  const textCtx = ctx2d
  const narratageText = new Sprite(Texture.from(textCanvas))
  narratageLayer.addChild(narratageText)
  // 上一次画的是哪几行。每帧重画一次要把 1024×640 的画布重新上传一遍纹理，
  // 而这几行 50 ms 才变一次。
  let drawnText = ''

  // 主角的 48 帧一次性载入。逐帧按需加载会让走动的第一圈掉帧，而这批图
  // 一共 100 KB 出头，没有按需的理由。
  const roleTextures = new Map<string, Texture>()
  const heroSprite = new Sprite()
  heroSprite.visible = false
  camera.addChild(npcLayer)
  camera.addChild(heroSprite)

  /**
   * 这个场景的 NPC 用到的每一帧。**一次全载**，跟主角那 48 帧同一个理由：
   * 一个走动的 NPC 8 帧轮播，按需加载会让它第一圈一卡一卡的，而这批图一共
   * 几十 KB。已经载过的跳过 —— 同一个 NPC 在十几个场景里出现是常事。
   */
  async function loadNpcTextures(npcs: readonly NpcState[]): Promise<void> {
    const wanted = [
      ...new Set(npcs.flatMap((npc) => npc.images.map((image) => npcAssetId(image)))),
    ].filter((id) => !npcTextures.has(id))
    const textures = await Promise.all(
      wanted.map(async (id) => {
        const url = resolveAssetOrNull(id)
        return url === null ? null : await Assets.load<Texture>(url)
      }),
    )
    wanted.forEach((id, i) => npcTextures.set(id, textures[i] ?? null))
  }

  /**
   * 旁白背景的 52 帧。**只在这个场景真的有旁白时才载**：96 个场景里绝大多数
   * 没有 `Narratage` 段，替它们载 3.17 MB 图是白费（52 帧无损 WebP，实测
   * 3 326 738 字节；同一批走 q80 是 1.55 MB，按 `toWebp` 的规矩 PNG 源走无损）。
   * 载过一次就留着——旁白只在
   * 进场时播一次，但场景来回切是常事。
   */
  async function loadNarratageTextures(scene: SceneScript): Promise<void> {
    if (scene.narratage === null || narratageTextures.length > 0) return
    const textures = await Promise.all(
      Array.from({ length: BG_COUNT }, (_, frame) =>
        Assets.load<Texture>(resolveAsset(narratageBgAssetId(frame))).then(nearest),
      ),
    )
    narratageTextures.push(...textures)
  }

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
    // NPC 用的是 `-firstTile*8` 而不是 `offset`，两者今天恒等；见
    // `npcLayerOffset`。恒等的量照样每帧设一次，是为了它哪天不恒等时不必回来
    // 改这里 —— 那种偏移在画面上跟"画错了一个精灵"分不开。
    const npcOffset = npcLayerOffset(viewport)
    npcLayer.position.set(npcOffset.x, npcOffset.y)
    if (computeDrawOrder(world) === 'npcs-first') {
      camera.setChildIndex(npcLayer, 0)
      camera.setChildIndex(heroSprite, 1)
    } else {
      camera.setChildIndex(heroSprite, 0)
      camera.setChildIndex(npcLayer, 1)
    }
  }

  /**
   * 旁白这一帧：`Narratage.drawNarratage` 的两句话。
   *
   * 背景那张 639×395 的图被拉满 1024×640（原版
   * `drawImage(img, 0,0,1024,640, 0,0,639,395)`），文字压在它上面。
   */
  function drawNarratage(narratage: NarratageState): void {
    const texture = narratageTextures[narratage.bg]
    if (!texture) {
      // 背景帧没载入。静默不画会表现为"旁白偶尔黑一下"，那是查不出来的。
      throw new Error(`旁白的第 ${narratage.bg} 帧背景没载入（共 ${narratageTextures.length} 帧）。`)
    }
    narratageBg.texture = texture
    narratageBg.setSize(STAGE_WIDTH, STAGE_HEIGHT)

    // `null` 的行原版不画（`if (bufferedText[i] != null)`），空串也不用画。
    const key = narratage.text.map((line) => line ?? '').join('\n')
    if (key !== drawnText) {
      textCtx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT)
      textCtx.font = `bold ${FONT_SIZE}px ${FONT_STACK}`
      textCtx.fillStyle = '#ffffff'
      textCtx.textBaseline = 'alphabetic'
      for (let i = 0; i < MAX_LINE; i++) {
        const line = narratage.text[i]
        if (line == null) continue
        textCtx.fillText(line, TEXT_LEFT, FONT_SIZE * (3 + 2 * i))
      }
      narratageText.texture.source.update()
      drawnText = key
    }
  }

  function showWorld(world: World): void {
    // 旁白进行中：地图与人物那两层整个不画，跟原版 `paint()` 的那个 if 一致。
    // `narratageOver` 也要看——原版的 else 分支里还套着 `if (!narratageOver)`，
    // 两个标志同时为真的那一帧什么都不画。
    const showingNarratage = world.narratage.active && !world.narratage.over
    narratageLayer.visible = showingNarratage
    mapLayer.visible = !world.narratage.active
    camera.visible = !world.narratage.active
    if (world.narratage.active) {
      if (showingNarratage) drawNarratage(world.narratage)
      return
    }

    place(world)
    drawNpcs(world)
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
  }

  /**
   * NPC 这一帧：换纹理、摆位置。
   *
   * 精灵数与 `world.npcs` 对不上是硬失败：那意味着 `showWorld` 拿到的是**另一个
   * 场景**的世界，而画面上的表现是少画或多画一个 NPC —— 恰好是最不容易看出来的
   * 那种错。不设尺寸，按纹理的原尺寸画（见 `npcSprite.ts`）。
   */
  function drawNpcs(world: World): void {
    if (npcSprites.length !== world.npcs.length) {
      throw new Error(
        `这一帧有 ${world.npcs.length} 个 NPC，而渲染器建了 ${npcSprites.length} 个精灵；` +
          `showScene 与 showWorld 拿到的不是同一个场景。`,
      )
    }
    world.npcs.forEach((npc, i) => {
      const sprite = npcSprites[i]!
      const placement = npcSprite(npc)
      const texture = npcTextures.get(placement.asset)
      if (texture === undefined) {
        // 载入时漏了这个 ID。静默不画就是"这个 NPC 偶尔不见了"。
        throw new Error(`NPC ${npc.name} 要 ${placement.asset}，但这个场景没载入它。`)
      }
      // 已知缺失的素材：原版在这里也什么都没画（xl-1dv.1）。
      if (texture === null) {
        sprite.visible = false
        return
      }
      sprite.texture = texture
      sprite.position.set(placement.x, placement.y)
      sprite.visible = true
    })
  }

  return {
    async showScene(scene: SceneScript): Promise<void> {
      await loadRoleTextures()
      await loadNarratageTextures(scene)
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

      // 这个场景的 NPC：先把素材载齐，再按条数重建精灵。**重建而不是复用**，
      // 因为上一个场景的 NPC 条数与这个场景无关，留着多出来的那几个就会在
      // 新场景里画出上一张地图的人。
      const world = createWorld(scene)
      await loadNpcTextures(world.npcs)
      for (const child of npcLayer.removeChildren()) child.destroy({ texture: false })
      npcSprites = world.npcs.map(() => {
        const sprite = new Sprite()
        sprite.visible = false
        npcLayer.addChild(sprite)
        return sprite
      })

      // 第一帧还没来，先按这个场景的初始世界把镜头与人物摆好。不摆的话换场景
      // 那一瞬会闪一下上一张地图的镜头位置（两张地图尺寸不同时尤其明显）。
      showWorld(world)
    },

    showWorld,

    destroy(): void {
      app.destroy({ removeView: true }, { children: true })
    },
  }
}
