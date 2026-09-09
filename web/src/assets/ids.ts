/**
 * 资产的**逻辑 ID**。
 *
 * 游戏逻辑只说 `map:宿舍`，说不出 `src/generated/assets/maps/宿舍.webp`。
 * 中间隔一张映射表（`resolveAsset`），换素材、换格式、换目录结构都不动逻辑
 * ——这是迁移计划里"资产层做成可替换抽象"那条决策的落点，素材本身还有版权
 * 问题要处理，将来一定会换。
 *
 * ID 从脚本数据里的文件名推出来，因此这几个函数**必须是纯的**：同样的
 * `mapName` 在烘焙期（生成映射表）和运行期（查映射表）要得到同一个 ID，
 * 两边算不一样就会表现为"这张图查不到"。
 */
import { basename, normalizePath, stem } from './path'

export type AssetId = string

/** `宿舍.png` → `map:宿舍`；`image\背景图\x.png` 这种反斜杠路径也认。 */
export function mapAssetId(mapName: string): AssetId {
  return `map:${stem(basename(mapName))}`
}

/**
 * 主角的一帧行走图 / 跑步图。
 *
 * 原版 `Role` 的构造函数把 `roles/zhangxiaofan/0..31.png` 与
 * `roles/zhangxiaofanRun/1..16.png` 全部读进内存，绘制时按
 * `walkImages.get(direction + count)` / `runImages.get(direction / 2 + count2)`
 * 取。**这里的 `frame` 就是那两个下标**（走 0..31、跑 0..15），不是文件名——
 * 跑步图的文件是从 1 开始编号的，两者差 1，把这个差留在烘焙器里，
 * 渲染层就永远不必知道它。
 */
export function roleAssetId(gait: 'walk' | 'run', frame: number): AssetId {
  return `role:${gait}:${frame}`
}

/**
 * NPC 的一帧。入参是 `scene.NPC` 的三个构造函数拼出来的**文件名**，
 * 也就是 `NpcState.images` 里的一条：
 *
 *   静止     `老头.png`      → `npc:老头.png`
 *   原地运动 `篮球公主/1.png` → `npc:篮球公主/1.png`
 *   单向走动 `曾书书/9.png`   → `npc:曾书书/9.png`
 *
 * **目录那一层留在 ID 里**：同一个名字既可能是一张静止图，也可能是一个目录
 * （`商塔阿威哥.png` 与 `商塔阿威哥/3.png`），压成一层就撞了。
 *
 * **扩展名也留着**，跟地图那条不一样，理由是数据里有一条真实的坏路径：
 * `NPCs/商塔副堂主` 漏了 `.png`（xl-1dv.3），而 `NPCs/商塔副堂主.png` 是有的。
 * 去掉扩展名，这两条就是同一个 ID —— 那条十三年画不出来的引用会悄悄查到好图，
 * 于是 Web 版画出一个原版没有的 NPC，而 `knownMissing.ts` 还照旧说它缺着。
 * 留着扩展名，两者就是两个 ID，坏的那条查不到、画不出来，与原版一致。
 */
export function npcAssetId(imageName: string): AssetId {
  return `npc:${normalizePath(imageName)}`
}

/**
 * 对话框的一张头像。
 *
 * 入参是 `Dialogue.heads` 这个 `ArrayList` 的**下标**（脚本数据里 `0/59/正文`
 * 的那个 `59`），不是文件编号：原版的构造函数是
 * `for (int i = 1; i <= 91; i++) heads.add(read("heads/heads (" + i + ").png"))`，
 * 于是下标 59 对应文件 `heads (60).png`。这个差 1 跟主角跑步图那处是同一个
 * 套路（见 `roleAssetId`）——留在烘焙器里，渲染层就永远不必知道它。
 */
export function headAssetId(index: number): AssetId {
  return `head:${index}`
}

/**
 * 对话框自己的几张固定图（`Dialogue` 的构造函数一次性读的那四张）。
 * `name` 是这里定义的逻辑名，不是文件名 —— 文件名里有中文和 `36-18` 这种
 * 编号，都不该漏进渲染层。映射见 `scripts/bake.ts` 的 `DIALOGUE_IMAGES`。
 */
export function dialogueAssetId(name: 'box' | 'name' | 'icon0' | 'icon1'): AssetId {
  return `dialogue:${name}`
}

/**
 * 旁白背景动画的一帧（xl-9bd.11）。
 *
 * 原版 `Narratage` 的构造函数读的是
 * `backImages//NarratageBackImages//all_magic_21-{2..53}.png`，而 `index`
 * 在 `0 .. 51` 之间循环。**这里的 `frame` 就是那个 `index`**，文件名从 2 起
 * 编号的那个偏移只出现在烘焙器里（`scripts/bake.ts`），跟主角跑步图那 1 的
 * 差是同一个处理法：渲染层永远不必知道它。
 */
export function narratageBgAssetId(frame: number): AssetId {
  return `narratage:bg:${frame}`
}

/** `舒缓.mp3` → `bgm:舒缓`。BGM 的转码与播放在 xl-9bd.12。 */
export function bgmAssetId(musicName: string): AssetId {
  return `bgm:${stem(basename(musicName))}`
}

/**
 * 药品菜单里那张介绍图（xl-rh9.12）。
 *
 * 入参是 `sources/Shop/drug.txt` 第 4 列那个**文件名**（`金创药.png`），
 * 原版 `ShopReader.readDrug()` 把它拼在 `sources/Shop/药品/回复类/` 后面。
 *
 * **它不走 `battleAssetId`**：那一支要求路径以 `image/` 开头，而这六张图不在
 * `image/` 下 —— 药品是商店那一摊的数据，战斗菜单只是借来画一下。硬塞进
 * `battle:` 前缀等于让"战斗素材根目录"这个概念多一个例外，而例外不会响。
 *
 * **扩展名留着**，与 `npcAssetId` 同一个理由：ID 要是数据里那一列的函数。
 */
export function drugPictureAssetId(picture: string): AssetId {
  return `drug:${normalizePath(picture)}`
}

/**
 * 装备页那两张图之一（xl-234）。
 *
 * `category` 是 `sources/Shop/装备/` 下那一层**类目录名**（`武器` / `盔甲` /
 * `头` / `脚` / `手` / `饰品`），`picture` 是六张表第 6 列那个文件名。原版
 * `ShopReader.readEquipment(s)` 拼的就是 `sources/Shop/装备/<s>/<第 6 列>`，
 * 而那个 `s` 与 `sources/Shop/<s>.txt` 是同一个字符串。
 *
 * **类必须进 ID**：六个目录里有重名的文件（`饰品/` 与别处的同名件），
 * 去掉这一层，两件不同的装备会算出同一个 ID —— 表现是选中 A 却画出 B，
 * 而两张图长得都像装备，没人看得出来。
 *
 * **它不走 `battleAssetId` / `menuAssetId`**，与 `drugPictureAssetId` 同一个
 * 理由：这批图在 `sources/Shop/` 下，既不在 `image/` 里也不在 `sources/菜单/`
 * 里。硬塞进那两个前缀等于给"根目录"这个概念多一个例外，而例外不会响。
 *
 * **扩展名留着**，与 `npcAssetId` / `drugPictureAssetId` 同一个理由：ID 要是
 * 数据里那一列的函数。这里还多一层必要性 —— 同一个词干在磁盘上有 `.png`
 * 与 `.bmp` 两份（29 对），去掉扩展名它们就撞成一条。
 */
export function equipPictureAssetId(category: string, picture: string): AssetId {
  return `equip:${normalizePath(category)}/${normalizePath(picture)}`
}

/**
 * 开始界面的一张图（xl-kaa）。`name` 是逻辑名，不是文件名 —— 文件名里有中文
 * （`按钮/起2.png`），而且"常态图"与"悬停图"在原版里只差一个 `2`，
 * 漏进渲染层就成了一条谁都不敢改的命名约定。映射见 `src/start/assets.ts` 的
 * `START_IMAGES`，跟 `dialogueAssetId` 是同一个套路。
 *
 * 这里的联合类型是 `StartImageName` 的**另一半**：那边的 `START_IMAGES` 声明
 * 成 `Record<StartImageName, string>`，两边对不上 `pnpm typecheck` 就红。
 */
export function startAssetId(
  name:
    | 'back'
    | 'newGame'
    | 'newGameHover'
    | 'load'
    | 'loadHover'
    | 'about'
    | 'aboutHover'
    | 'end'
    | 'endHover'
    | 'goBack'
    | 'goBackHover'
    | 'aboutPage'
    | 'cloud',
): AssetId {
  return `start:${name}`
}

/**
 * 开始界面上一段逐帧动画的**一帧**（xl-4si）。
 *
 * 原版 `start.StartAnimation` 的构造函数是
 * `array[i] = Reader.readImage("sources/StartPanel/" + s + "/" + (i+1) + ".png")`，
 * 也就是目录名加上**从 1 起**的编号。`frame` 这里是**下标**（`0 .. length-1`），
 * 与 `StartAnimation.i` 同一套，那个差 1 只出现在烘焙器里 —— 跟主角跑步图、
 * 头像、旁白背景是同一个处理法（见 `roleAssetId` / `headAssetId`）。
 *
 * 目录名不漏进这一层：`卷轴` / `反向卷轴` / `按钮动画` 这些中文名与
 * `START_IMAGES` 里那几条一样，是原版写死的文件名，映射在
 * `src/start/assets.ts` 的 `START_SEQUENCES`。
 */
export function startFrameAssetId(name: StartSequenceName, frame: number): AssetId {
  return `start:${name}:${frame}`
}

/**
 * 开始界面上那六段逐帧动画的逻辑名。
 *
 * 与 `startAssetId` 的联合类型同一个套路：`START_SEQUENCES` 声明成
 * `Record<StartSequenceName, …>`，两边对不上 `pnpm typecheck` 就红。
 */
export type StartSequenceName =
  | 'buttonGlow'
  | 'cursor'
  | 'scroll'
  | 'backScroll'
  | 'loading'
  | 'loading2'
