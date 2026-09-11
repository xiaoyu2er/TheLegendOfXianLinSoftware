import { Application, Assets, Container, Rectangle, Sprite, Texture } from 'pixi.js'
import { dialogueAssetId, mapAssetId, mapOverlayAssetId, narratageBgAssetId, npcAssetId, roleAssetId } from '../assets/ids'
import { getCoins } from '../fakes/wallet'
import { checkMapSize } from './mapSize'
import { COIN_ICON, COIN_ICON_FILE, COIN_TEXT, OVERLAY_FILES, overlayPlacements } from './mapOverlays'
import type { AssetId } from '../assets/ids'
import { resolveAsset, resolveAssetOrNull } from '../assets/resolve'
import type { SceneScript } from '../data/types'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/constants'
import { BG_COUNT, MAX_LINE } from '../state/narratage'
import type { NarratageState } from '../state/narratage'
import type { NpcState } from '../state/npc'
import { createWorld } from '../state/step'
import type { World } from '../state/types'
import { TEXT_FONT_STACK } from '../textFont'
import { BG_SRC_HEIGHT, FONT_SIZE, baselineY, layoutLine, narratageBgPasses } from './narratageLayout'
import { npcSprite } from './npcSprite'
import {
  PRESENT_BASELINE,
  PRESENT_COLOR,
  PRESENT_FONT_SIZE,
  PRESENT_TEXT_DX,
  PRESENT_Y,
  boxPlacement,
  presentCells,
} from './presentLayout'
import { roleSprite } from './roleSprite'
import {
  FONT_SIZE as SELECT_FONT_SIZE,
  ICON_SIZE,
  boxFrame,
  selectBoxKind,
  selectCells,
  selectLines,
} from './selectLayout'
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
 * 旁白文字的排版在 `narratageLayout.ts`：字号、左边距、每行的基线、以及
 * **逐字按格摆**的那条规则（xl-9bd.18）都在那边，这里只负责画。
 *
 * 字体原版写的是 `文鼎粗钢笔行楷`，那是一款没有随游戏交付的中文字体，两端
 * 各自退到本机的默认字体。**字形因此不会逐像素相同**，这是已知偏离，记在
 * `compare/expected.ts` 的 dorm-intro 那条里；为什么不打包一款字体来消掉它，
 * 见 `src/textFont.ts`。位置与颜色是准的。
 */
const FONT_STACK = TEXT_FONT_STACK

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
 * （xl-9bd.6 / .7 / .9）；地图遮掩层与金币 HUD（`OtherEvent.addMap`）由
 * xl-yg6.12 画上，摆位在 `mapOverlays.ts`。
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
  // 宝箱（xl-yg6.10）：`paint()` 里 `equipmentEvent.drawTreasureBox` 紧跟在
  // `map.drawMap` 之后、人物之前。**不在 `camera` 里**：它用的是
  // `firstTile*8` 那个量（与 NPC 同），直接算成画布坐标，见 `presentLayout.ts`。
  const boxLayer = new Container()
  app.stage.addChild(boxLayer)
  app.stage.addChild(camera)

  // `OtherEvent.addMap` 那一层（xl-yg6.12）：`paint()` 里紧跟在主角与 NPC 之后、
  // 对话框 / 选择框 / 提示框之前。**不在 `camera` 里**：遮掩图减的是 `firstTile*8`
  // （与 NPC 同），金币 HUD 是画布坐标。摆位全在 `mapOverlays.ts`。
  const overlayLayer = new Container()
  app.stage.addChild(overlayLayer)
  /** 十张遮掩图各一个精灵（仙一仙二同图不同位，所以按句建、不按文件建）。 */
  const overlaySprites: Sprite[] = []
  const overlayTextures = new Map<string, Texture>()
  const coinIcon = new Sprite()
  // 金币数自己画在一张小画布上，理由同旁白：原版给的是**基线**坐标。
  const COIN_ASCENT = COIN_TEXT.fontSize + 6
  const coinCanvas = document.createElement('canvas')
  coinCanvas.width = STAGE_WIDTH - COIN_TEXT.x
  coinCanvas.height = COIN_TEXT.fontSize * 2
  const coinCtx2d = coinCanvas.getContext('2d')
  if (!coinCtx2d) throw new Error('取不到金币数那一层的 2D context')
  const coinCtx = coinCtx2d
  const coinText = new Sprite(Texture.from(coinCanvas))
  coinText.position.set(COIN_TEXT.x, COIN_TEXT.baseline - COIN_ASCENT)
  let drawnCoins: number | null = null
  /** 遮掩图要看地图名与碰撞网格的行数，那两样在场景里、不在 `world` 里。 */
  let currentScene: SceneScript | null = null

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

  // 选择框（xl-yg6.8）。**全 Pixi，画在场景这张画布上** —— 原版就是画进
  // 场景的离屏图的（`ScenePanel.paint()` 的第 3 步），不像菜单与商店是独立
  // 面板。所以它挂在 `app.stage` 上，不走 `stage/Stage.tsx` 那层 DOM overlay。
  //
  // ⚠️ 与对话框的先后**与原版反了**，这是已知偏离：原版 `paint()` 先画对话框
  // 再画选择框，而对话框在这一侧是 DOM overlay（`ui/DialogueBox.tsx`），
  // 永远压在画布上面。两者同时开着的那一帧今天走不到（选择框开着时
  // `checkSelectEvent` 会把口头语截胡），所以没有真值分辨得出来。
  // @exception ADR-0001#select-under-dialogue-overlay
  const selectLayer = new Container()
  selectLayer.visible = false
  app.stage.addChild(selectLayer)
  const selectBox = new Sprite()
  const selectCursor = new Sprite()
  selectLayer.addChild(selectBox)
  selectLayer.addChild(selectCursor)

  // 「得到物品」提示框（xl-yg6.10）：`paint()` 的第 4 步，画在选择框之后。
  // ⚠️ 与对话框的先后同样与原版反了（对话框是 DOM overlay），同一个已知偏离。
  const presentLayer = new Container()
  presentLayer.visible = false
  app.stage.addChild(presentLayer)
  const presentBox = new Sprite()
  presentLayer.addChild(presentBox)
  // 正文自己画在一张小画布上，**跟着框一起挪**：框每 50 ms 挪 32 px，而字
  // 100 ms 才多一个 —— 每挪一下就重传一张整屏画布太贵。基线在这张小画布里的
  // 高度是 `PRESENT_TEXT_ASCENT`，贴的时候再减回去。
  // 小画布里基线离顶的距离：一个字号的 ascent 再留 6 px 余量，免得粗体的笔画
  // 顶到画布上沿被裁掉。它只决定字在小画布里画在哪，贴的时候整个减回去，
  // 所以对落点没有影响 —— 不是原版的数，原版没有这张小画布。
  const PRESENT_TEXT_ASCENT = PRESENT_FONT_SIZE + 6
  const presentCanvas = document.createElement('canvas')
  presentCanvas.width = STAGE_WIDTH
  presentCanvas.height = PRESENT_FONT_SIZE * 2
  const presentCtx2d = presentCanvas.getContext('2d')
  if (!presentCtx2d) throw new Error('取不到提示框文字层的 2D context')
  const presentTextCtx = presentCtx2d
  const presentText = new Sprite(Texture.from(presentCanvas))
  presentLayer.addChild(presentText)
  let drawnPresentText: string | null = null
  /** 提示框与两张宝箱图。`null` = 还没载。 */
  let presentTexture: Texture | null = null
  let fullBoxTexture: Texture | null = null
  let emptyBoxTexture: Texture | null = null
  /** 与 `world.treasure.boxes` 逐下标对应，`showScene` 时按这个场景的宝箱数重建。 */
  let boxSprites: Sprite[] = []
  /** `选择框.png` 与 `icon.png`，两张一起载，跟主角那 48 帧同一个理由。 */
  let selectTexture: Texture | null = null
  /** 选择框那张图这一帧露出的那块。`dynamic` 要开，理由同地图碎片。 */
  let selectFrame: Texture | null = null
  /** 问题框（`问题框.png`，xl-yg6.9）这一帧露出的那块。与选择框共用一个精灵，按支换纹理。 */
  let questionFrame: Texture | null = null

  // 旁白：一张铺满画布的背景动画 + 一层文字（xl-9bd.11）。
  //
  // 整层挂在最上面，**旁白进行中把地图与人物那两层整个藏掉**——原版
  // `ScenePanel.paint()` 里主角、NPC、地图、宝箱、对话框全在
  // `if (!narratage.isNarratage)` 里面，那些帧一个精灵都不画。藏而不是"画在
  // 上面盖住"：背景图有黑边，盖不严的话地图会从缝里露出来。
  const narratageLayer = new Container()
  narratageLayer.visible = false
  app.stage.addChild(narratageLayer)
  // 背景那张 1024×640 是 CPU 拼的（xl-03x.15，见 `narratageBgPasses`）：先横着
  // 把每一列搬进「目标宽 × 源高」的中间位图，再竖着把每一行搬到位。
  const bgPasses = narratageBgPasses()
  const bgMidCanvas = document.createElement('canvas')
  bgMidCanvas.width = STAGE_WIDTH
  bgMidCanvas.height = BG_SRC_HEIGHT
  const bgOutCanvas = document.createElement('canvas')
  bgOutCanvas.width = STAGE_WIDTH
  bgOutCanvas.height = STAGE_HEIGHT
  const bgMidCtx2d = bgMidCanvas.getContext('2d')
  const bgOutCtx2d = bgOutCanvas.getContext('2d')
  if (!bgMidCtx2d || !bgOutCtx2d) throw new Error('取不到旁白背景的 2D context')
  const bgMidCtx = bgMidCtx2d
  const bgOutCtx = bgOutCtx2d
  bgMidCtx.imageSmoothingEnabled = false
  bgOutCtx.imageSmoothingEnabled = false
  /** 背景画布上现在拼的是第几帧；-1 = 还没拼过。 */
  let blittedBg = -1
  const narratageBg = new Sprite(nearest(Texture.from(bgOutCanvas)))
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

  // 选择框的正文同样自己画在一张离屏画布上，理由与旁白那层一样：原版给的是
  // **基线**坐标，而 Pixi 的 `Text` 摆的是行盒左上角。
  const selectCanvas = document.createElement('canvas')
  selectCanvas.width = STAGE_WIDTH
  selectCanvas.height = STAGE_HEIGHT
  const selectCtx2d = selectCanvas.getContext('2d')
  if (!selectCtx2d) throw new Error('取不到选择框文字层的 2D context')
  const selectTextCtx = selectCtx2d
  const selectText = new Sprite(Texture.from(selectCanvas))
  selectLayer.addChild(selectText)
  let drawnSelectText = ''

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

  /**
   * 选择框那三张图（选择框 / 问题框 / 光标）。**一次载齐**，加起来几十 KB；
   * 按需载会让框弹出来的第一帧画不出来，而那一帧恰好是滑入动画的起点。
   */
  async function loadSelectTextures(): Promise<void> {
    if (selectTexture !== null) return
    const [box, question, icon] = await Promise.all([
      Assets.load<Texture>(resolveAsset(dialogueAssetId('select'))).then(nearest),
      Assets.load<Texture>(resolveAsset(dialogueAssetId('question'))).then(nearest),
      Assets.load<Texture>(resolveAsset(dialogueAssetId('selectIcon'))).then(nearest),
    ])
    selectTexture = box
    const frameOf = (texture: Texture): Texture =>
      new Texture({ source: texture.source, frame: new Rectangle(0, 0, 1, 1), dynamic: true })
    selectFrame = frameOf(box)
    questionFrame = frameOf(question)
    selectCursor.texture = icon
  }

  /** 提示框与宝箱那三张图（xl-yg6.10）。理由同选择框：一次载齐，几 KB。 */
  async function loadTreasureTextures(): Promise<void> {
    if (presentTexture !== null) return
    const [present, full, empty] = await Promise.all(
      (['present', 'fullBox', 'emptyBox'] as const).map((name) =>
        Assets.load<Texture>(resolveAsset(dialogueAssetId(name))).then(nearest),
      ),
    )
    presentTexture = present!
    fullBoxTexture = full!
    emptyBoxTexture = empty!
    presentBox.texture = present!
  }

  /**
   * 宝箱与提示框这一帧：`EquipmentEvent.drawTreasureBox` 与 `drawPresentation`。
   * 摆位全部来自 `presentLayout.ts`（对着原版逐行核过），这里只负责贴。
   */
  function drawTreasure(world: World): void {
    const t = world.treasure
    const boxes = t.boxes ?? []
    if (boxSprites.length !== boxes.length) {
      // 与 NPC 那条同一个理由：对不上说明 showScene 与 showWorld 拿到的不是同一个场景。
      throw new Error(
        `这一帧有 ${boxes.length} 个宝箱，而渲染器建了 ${boxSprites.length} 个精灵；` +
          `showScene 与 showWorld 拿到的不是同一个场景。`,
      )
    }
    const viewport = computeViewport(world)
    boxes.forEach((box, i) => {
      const sprite = boxSprites[i]!
      const placement = boxPlacement(box, viewport)
      const texture = placement.image === 'emptyBox' ? emptyBoxTexture : fullBoxTexture
      sprite.visible = texture !== null
      if (texture === null) return
      sprite.texture = texture
      sprite.position.set(placement.x, placement.y)
    })

    // `if (isDrawString)`：框在不在场。滑出去之后它仍然是真，框停在 1056 处，
    // 画在画布外面 —— 照画，不替它收。
    presentLayer.visible = t.presenting && presentTexture !== null
    if (!presentLayer.visible) return
    presentBox.position.set(t.x, PRESENT_Y)
    // `if (bufferedText != null)`：一个字都没吐时正文不画。
    presentText.visible = t.bufferedText !== null
    presentText.position.set(t.x + PRESENT_TEXT_DX, PRESENT_BASELINE - PRESENT_TEXT_ASCENT)
    if (t.bufferedText === null || t.bufferedText === drawnPresentText) return
    presentTextCtx.clearRect(0, 0, presentCanvas.width, presentCanvas.height)
    presentTextCtx.font = `bold ${PRESENT_FONT_SIZE}px ${FONT_STACK}`
    presentTextCtx.fillStyle = PRESENT_COLOR
    presentTextCtx.textBaseline = 'alphabetic'
    const measure = (char: string): number => presentTextCtx.measureText(char).width
    for (const cell of presentCells(t.bufferedText, measure)) {
      presentTextCtx.fillText(cell.char, cell.x, PRESENT_TEXT_ASCENT)
    }
    presentText.texture.source.update()
    drawnPresentText = t.bufferedText
  }

  /** 遮掩图 18 张 + 金币图标，一次载齐（合计三百来 KB，只载一次）。 */
  async function loadOverlayTextures(): Promise<void> {
    if (overlayTextures.size > 0) return
    const textures = await Promise.all(
      OVERLAY_FILES.map((file) =>
        Assets.load<Texture>(resolveAsset(mapOverlayAssetId(file))).then(nearest),
      ),
    )
    OVERLAY_FILES.forEach((file, i) => overlayTextures.set(mapOverlayAssetId(file), textures[i]!))
    coinIcon.texture = overlayTextures.get(mapOverlayAssetId(COIN_ICON_FILE))!
    coinIcon.position.set(COIN_ICON.x, COIN_ICON.y)
  }

  /** `OtherEvent.addMap`：先金币图标与金币数，再十张遮掩图（大地图才有）。 */
  function drawOverlays(world: World, scene: SceneScript): void {
    const placements = overlayPlacements(scene.mapName, scene.row, computeViewport(world))
    while (overlaySprites.length < placements.length) overlaySprites.push(new Sprite())
    overlayLayer.removeChildren()
    overlayLayer.addChild(coinIcon, coinText)
    placements.forEach((p, i) => {
      const sprite = overlaySprites[i]!
      const texture = overlayTextures.get(p.asset)
      // 漏载的表现是「屋檐偶尔不压人」，查不出来，所以响。
      if (!texture) throw new Error(`遮掩图 ${p.asset} 没载入。`)
      sprite.texture = texture
      sprite.position.set(p.x, p.y)
      overlayLayer.addChild(sprite)
    })
    const coins = getCoins()
    if (coins === drawnCoins) return
    coinCtx.clearRect(0, 0, coinCanvas.width, coinCanvas.height)
    coinCtx.font = `bold ${COIN_TEXT.fontSize}px ${FONT_STACK}`
    coinCtx.fillStyle = COIN_TEXT.color
    coinCtx.textBaseline = 'alphabetic'
    coinCtx.fillText(String(coins), 0, COIN_ASCENT)
    coinText.texture.source.update()
    drawnCoins = coins
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
    // **不交给 GPU 采样**（xl-03x.15）：CPU 按原版的采样表拼好整张 1024×640，
    // 再 1:1 贴。GPU 在第 599 行取错一行，理由与实测见 `narratageBgPasses`。
    // 背景 180 ms 才换一帧，只在换帧时重拼。
    if (narratage.bg !== blittedBg) {
      const resource = texture.source.resource as CanvasImageSource | undefined
      if (!resource) throw new Error(`旁白的第 ${narratage.bg} 帧背景取不到位图源`)
      bgMidCtx.clearRect(0, 0, STAGE_WIDTH, BG_SRC_HEIGHT)
      for (const r of bgPasses.horizontal) {
        bgMidCtx.drawImage(resource, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh)
      }
      bgOutCtx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT)
      for (const r of bgPasses.vertical) {
        bgOutCtx.drawImage(bgMidCanvas, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh)
      }
      narratageBg.texture.source.update()
      blittedBg = narratage.bg
    }

    // `null` 的行原版不画（`if (bufferedText[i] != null)`），空串也不用画。
    const key = narratage.text.map((line) => line ?? '').join('\n')
    if (key !== drawnText) {
      textCtx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT)
      textCtx.font = `bold ${FONT_SIZE}px ${FONT_STACK}`
      textCtx.fillStyle = '#ffffff'
      textCtx.textBaseline = 'alphabetic'
      // **逐字摆，不是 `fillText(整行)`**：浏览器给中文的步进不是原版
      // `FontMetrics` 那个整 20 px，一行 43 个字累起来是十几个像素的横向
      // 漂移（xl-9bd.18）。理由与实测见 `narratageLayout.ts`。
      const measure = (char: string): number => textCtx.measureText(char).width
      for (let i = 0; i < MAX_LINE; i++) {
        const line = narratage.text[i]
        if (line == null) continue
        const y = baselineY(i)
        for (const cell of layoutLine(line, measure)) {
          textCtx.fillText(cell.char, cell.x, y)
        }
      }
      narratageText.texture.source.update()
      drawnText = key
    }
  }

  /**
   * 选择框这一帧：`SelectEvent.drawSelectImage` 那两支。
   *
   * 摆位全部来自 `selectLayout.ts`（对着原版逐行核过），这里只负责贴。
   */
  function drawSelect(world: World): void {
    const kind = selectBoxKind(world.select)
    const frame = kind === 'question' ? questionFrame : selectFrame
    if (kind === null || selectTexture === null || frame === null) {
      selectLayer.visible = false
      return
    }
    selectLayer.visible = true

    // 选择框与问题框共用一个精灵，按支换纹理（原版是同一个 `drawSelectImage`
    // 里的两支，一帧只进一支）。
    const rect = boxFrame(world.select, kind)
    selectBox.texture = frame
    // 宽或高为 0 的 `Rectangle` 会让 Pixi 算出一张 0 尺寸的纹理；滑入的第一帧
    // 就是 0×0（`showSelectShopPanel` 把两个游标清成 0，下一拍才 +50/+15；
    // 问题框翻过来那一拍四个游标都在屏幕中心）。
    selectBox.visible = rect.width > 0 && rect.height > 0
    if (selectBox.visible) {
      frame.frame.x = rect.srcX
      frame.frame.y = rect.srcY
      frame.frame.width = rect.width
      frame.frame.height = rect.height
      frame.update()
      selectBox.position.set(rect.x, rect.y)
      selectBox.setSize(rect.width, rect.height)
    }

    const lines = selectLines(world.select, kind)
    const cursor = lines.find((line) => line.selected)
    selectCursor.visible = cursor !== undefined
    if (cursor !== undefined) {
      selectCursor.position.set(cursor.iconX, cursor.iconY)
      selectCursor.setSize(ICON_SIZE, ICON_SIZE)
    }

    // 正文只在真的变了的时候重画：一整张 1024×640 的画布每帧重传纹理太贵，
    // 而逐字游标 30 ms 才动一次。键里带上是哪一支与光标行号 —— 只按文字比的
    // 话，上下键翻光标那一下颜色不会跟着变；而问题框与回答框的行距起点不同，
    // 同一行字换一支画的位置就不一样。
    const key = `${kind}|${cursor?.row ?? -1}|${lines.map((line) => `${line.row}:${line.text}`).join('\n')}`
    if (key === drawnSelectText) return
    selectTextCtx.clearRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT)
    selectTextCtx.font = `bold ${SELECT_FONT_SIZE}px ${FONT_STACK}`
    selectTextCtx.textBaseline = 'alphabetic'
    const measure = (char: string): number => selectTextCtx.measureText(char).width
    for (const line of lines) {
      selectTextCtx.fillStyle = line.color
      for (const cell of selectCells(line, measure)) {
        selectTextCtx.fillText(cell.char, cell.x, line.baseline)
      }
    }
    selectText.texture.source.update()
    drawnSelectText = key
  }

  function showWorld(world: World): void {
    // 旁白进行中：地图与人物那两层整个不画，跟原版 `paint()` 的那个 if 一致。
    // `narratageOver` 也要看——原版的 else 分支里还套着 `if (!narratageOver)`，
    // 两个标志同时为真的那一帧什么都不画。
    const showingNarratage = world.narratage.active && !world.narratage.over
    narratageLayer.visible = showingNarratage
    mapLayer.visible = !world.narratage.active
    camera.visible = !world.narratage.active
    // 宝箱与提示框同在 `if (!narratage.isNarratage)` 里面（xl-yg6.10）。
    boxLayer.visible = !world.narratage.active
    // `addMap` 同样在那个 if 里面。
    overlayLayer.visible = !world.narratage.active
    if (world.narratage.active) {
      selectLayer.visible = false
      presentLayer.visible = false
      if (showingNarratage) drawNarratage(world.narratage)
      return
    }

    drawSelect(world)
    drawTreasure(world)
    place(world)
    drawNpcs(world)
    if (currentScene) drawOverlays(world, currentScene)
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
      await loadSelectTextures()
      await loadTreasureTextures()
      await loadNarratageTextures(scene)
      await loadOverlayTextures()
      const texture = nearest(
        await Assets.load<Texture>(resolveAsset(mapAssetId(scene.mapName))),
      )

      // 地图图片至少要盖得住原版源矩形最远的那一格（网格 − 8，`Map.drawMap` 的
      // 源矩形直接用世界像素）。几种处境与各自的实测在 `mapSize.ts`；比源矩形
      // 还小的那一种拒绝渲染。
      checkMapSize(scene.script, scene.mapName, texture, scene.col, scene.row)

      // 换地图只换碎片指向的源，精灵与 `Texture` 对象留着 —— Assets 的缓存
      // 保住了解码结果，池子保住了精灵。
      mapTexture = texture
      // 遮掩层要的地图名与行数跟地图**同一处**换：早于这一行换的话，上面那几个
      // `await` 期间来的 `showWorld` 会拿新场景的名字去摆旧地图上的遮掩图。
      currentScene = scene
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
      // 宝箱精灵同理：`new EquipmentEvent` 跟着 initiation 重建，条数随场景变。
      for (const child of boxLayer.removeChildren()) child.destroy({ texture: false })
      boxSprites = (world.treasure.boxes ?? []).map(() => {
        const sprite = new Sprite()
        sprite.visible = false
        boxLayer.addChild(sprite)
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
