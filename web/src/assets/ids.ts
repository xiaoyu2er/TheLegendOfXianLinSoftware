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
export type AssetId = string

/** `宿舍.png` → `map:宿舍`；`image\背景图\x.png` 这种反斜杠路径也认。 */
export function mapAssetId(mapName: string): AssetId {
  return `map:${stem(basename(mapName))}`
}

/** `舒缓.mp3` → `bgm:舒缓`。BGM 的转码与播放在 xl-9bd.12。 */
export function bgmAssetId(musicName: string): AssetId {
  return `bgm:${stem(basename(musicName))}`
}

/**
 * 反斜杠一律当分隔符。脚本数据里有 Windows 风格路径（`script/剧情1.txt` 与
 * `script/迷宫1.txt` 共 3 处），在非 Windows 平台上按字面量找就是找不到。
 * 原版侧的同一处理见 `tools.Reader.normalizePath`。
 *
 * **不要去"修好"数据里那几行**：它们是这段规范化逻辑现成的测试夹具。
 */
function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? path
}

function stem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}
