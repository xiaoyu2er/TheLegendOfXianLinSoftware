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
import { basename, stem } from './path'

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

/** `舒缓.mp3` → `bgm:舒缓`。BGM 的转码与播放在 xl-9bd.12。 */
export function bgmAssetId(musicName: string): AssetId {
  return `bgm:${stem(basename(musicName))}`
}
