# web/ —— 浏览器版

Vite + React + TypeScript + Pixi。现在能打开网页看到**宿舍**，开发模式下可以
跳到**大地图**（xl-9bd.3）。主角、NPC、对话、镜头跟随都还没有。

## 命令

全部在 `web/` 下运行：

```bash
pnpm install
pnpm dev         # 开发服务器
pnpm bake        # 重烘场景 JSON 与 WebP（见下）
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # 产物在 dist/，可直接静态部署
pnpm preview     # 本地预览 dist/
```

`typecheck` / `test` / `build` 三条在 CI 里跑，见 `.github/workflows/web.yml`。
`bake` 不在 CI 里 —— 它的产物是入库的，见下一节。

## 数据烘焙

`pnpm bake`（`scripts/bake.ts`）把 `script/*.txt`（GBK）烘成 JSON，把它们的
地图图片转成 WebP，并写一张"逻辑 ID → 文件"的映射表。产物在
`src/generated/`，**全部入库**：

- CI 与 `pnpm build` 因此不需要 Java、不需要 cwebp、不需要仓库外的原始素材；
- 代价是产物可能陈旧，`src/data/scenes.test.ts` 会现场重烘一遍来判定。

判据不是"跑通了"，是**与原版解析器自己导出的冻结真值逐字段相等**：
`tools/ground-truth/*.json` 由 `tools/export-truth.sh` 从 `tools.Reader` 导出，
`src/data/bakeScript.test.ts` 逐字段对，分母是 2 个场景 × 26 个字段。
M1 只烘宿舍与大地图；扩到 96 个是 xl-9bd.4 / xl-9bd.5。

资产走**逻辑 ID**：游戏逻辑说 `map:宿舍`，`resolveAsset` 查表拿到实际 URL。
将来换素材、换格式、换目录都不动游戏逻辑（素材还有版权问题要处理，一定会换）。

WebP 的编码参数按源分：PNG 用无损，JPG 用 q80。实测（KiB / MiB）：
宿舍 136 KB → 无损 47 KB，转有损 q80 反而涨到 159 KB；
大地图 4.2 MB → q80 2.0 MB。

## 1024×640 是硬约束

逻辑画布锁死 1024×640（`src/stage/constants.ts`），与原版
`src/scene/ScenePanel.java:17-18` 的 `WIDTH` / `HEIGHT` 相同。

窗口变大时**只放大画面，不扩大视野**。原版的视野范围、NPC 摆位、战斗站位
都是按这个分辨率调过的；做成响应式视野就不再是移植了。

canvas 的位图恒为 1024×640，只有它的 CSS 尺寸随窗口变化，所以游戏代码
一律用逻辑坐标作画，不需要知道自己被放大了多少倍。

## 四个坑，都在代码里留了注释

- **一张 canvas 上 init → destroy → 再 init 会把主线程整个挂住。** Pixi 的
  `Application` 销毁后那张 canvas 就废了，第二次 init 不报错、不返回，页面
  再也不响应（实测 headless Chrome 里连 CDP 的 `Runtime.enable` 都超时）。
  而 React 19 的 StrictMode 在开发模式下就是挂载→卸载→再挂载，正好走这条路。
  所以 **canvas 由渲染器自己建、自己摘**，舞台只提供一个宿主 `<div>`
  （`src/scene/sceneRenderer.ts`）。
- **全屏时浏览器只渲染全屏元素的子树。** 因此全屏目标是外层 `.app-shell`
  而不是舞台本身——否则工具栏会整个消失，玩家只剩 Esc 一条退路。
  `src/app/App.test.tsx` 里有一条测试盯着这个结构。
- **headless Chrome 不派发 ResizeObserver 回调。** 在 headless 里量出来的
  舞台尺寸会冻结在首次渲染的值，看起来像缩放坏了，其实不是。要验证缩放
  行为，用有头浏览器。
- **Vite 会静态改写 `new URL('…', import.meta.url)`**，把它当资源引用去解析；
  参数是模板字符串时还会退化成对整个目录的 glob。测试要读仓库里的文件，
  用 `src/test/repoPath.ts`。

## 开发用场景跳转

工具栏上的场景下拉框在 `pnpm dev` 里恒有；构建产物里默认没有，加 `?dev`
打开（`src/app/devTools.ts`）——部署一份产物给别人看的时候，"跳到任意场景
做检查"这件事不能只在本机能做。

## 产物可静态部署

`vite.config.ts` 里 `base: './'`，产物引用相对路径，`dist/` 整个目录丢到任意
静态托管的任意子目录下都能跑。CI 里有一步 grep 校验这一点。
