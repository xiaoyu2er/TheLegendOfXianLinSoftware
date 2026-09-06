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
