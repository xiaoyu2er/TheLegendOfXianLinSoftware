/**
 * 路径规范化。**唯一一处**把 Windows 反斜杠换成正斜杠的地方。
 *
 * 脚本数据里有 3 条 Windows 风格路径（`script/剧情1.txt` 的 Fight 段 1 条、
 * `script/迷宫1.txt` 的 Fight 段 2 条，都是战斗背景图）。反斜杠只在 Windows
 * 上是合法分隔符，在 macOS/Linux 上按字面量找就是找不到，而 `ImageIcon`
 * 找不到既不抛异常也不返回 null —— 原版那 3 场战斗的背景一直是全白的。
 * 原版侧的同一处理见 `tools.Reader.normalizePath`。
 *
 * 方向只能是反斜杠 → 正斜杠：Java 与浏览器在 Windows 上同样接受正斜杠，
 * 反过来会把另外 22 条本来正常的路径在别的平台上弄坏。
 *
 * **不要去"修好"数据里那 3 行**：它们是这段逻辑现成的、唯一的测试夹具
 * （见 `sceneAssets.test.ts`），改掉数据这段逻辑就永远测不到了。
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

/** 路径的最后一段，反斜杠同样当分隔符。 */
export function basename(path: string): string {
  const parts = normalizePath(path).split('/')
  return parts[parts.length - 1] ?? path
}

/** 去掉扩展名。`宿舍.png` → `宿舍`。 */
export function stem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}
