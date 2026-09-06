# web/ —— 浏览器版

Vite + React + TypeScript + Pixi。现在能打开网页看到**宿舍**，开发模式下可以
跳到**全部 96 个场景**里的任意一个（xl-9bd.3 / xl-9bd.4）。主角、NPC、对话、
镜头跟随都还没有。

## 命令

全部在 `web/` 下运行：

```bash
pnpm install
pnpm dev          # 开发服务器
pnpm bake         # 重烘场景 JSON 与 WebP（见下）
pnpm check:assets # 对入库产物跑一遍资源存在性硬校验（bake 里也会跑）
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm build        # 产物在 dist/，可直接静态部署
pnpm preview      # 本地预览 dist/
```

`typecheck` / `test` / `build` 三条在 CI 里跑，见 `.github/workflows/web.yml`。
`bake` 不在 CI 里 —— 它的产物是入库的，见下一节。

## 数据烘焙

`pnpm bake`（`scripts/bake.ts`）把 `script/` 下**全部 96 个** `.txt`（GBK）
烘成 JSON，把它们用到的 28 张地图转成 WebP（共 9.5 MB），并写一张
"逻辑 ID → 文件"的映射表。产物在 `src/generated/`，**全部入库**：

- CI 与 `pnpm build` 因此不需要 Java、不需要 cwebp、不需要仓库外的原始素材；
- 代价是产物可能陈旧，`src/data/scenes.test.ts` 会现场重烘一遍来判定。

判据不是"跑通了"，是**与原版解析器自己导出的冻结真值逐字段相等**：
`tools/ground-truth/*.json` 由 `tools/export-truth.sh` 从 `tools.Reader` 导出，
`src/data/bakeScript.test.ts` 逐字段对。分母分两层：M1 链路上的宿舍与大地图对
全部 26 个字段，96 个脚本对基础段的 13 个字段（字段怎么切见
`src/data/types.ts`；剩下 13 个剧情段字段是 xl-9bd.5）。

## 资源存在性硬校验

烘焙前先把数据引用到的**每一条**资源路径 stat 一遍，缺一条就非零退出，
一个字节都不落盘。1602 条引用（互异 523 条）分五类：地图、场景 BGM、
NPC 图片、战斗背景、出口目标脚本，拼法逐条对着原版（见
`src/assets/sceneAssets.ts` 的表）。

理由是本项目最贵的那种坑：原版 `ImageIcon` 路径错了既不抛异常也不返回 null，
只给一个宽度 −1 的空壳。27 帧 NPC 素材缺了十三年、3 场战斗背景白了十三年，
没人发现，因为**失败长得和成功一模一样**。

仓库当下确实缺 37 条（27 帧素材 + 1 条漏扩展名的 NPC 路径 + 9 个不是文件的
出口目标），它们列在 `src/assets/knownMissing.ts`，每条挂一个 bd issue。
这张表**两头都会红**：表外的缺失红，表内的路径哪天存在了也红 —— 否则
"清单里全都还缺着"与"清单早就过期了"看起来会一模一样。

那 3 条 Windows 反斜杠路径（`剧情1` / `迷宫1` 的战斗背景）在这里被规范化，
`src/assets/sceneAssets.test.ts` 拿它们当夹具：**不要"修好"数据**，
改掉了这段逻辑就永远测不到。

一个已知的代价：`src/data/scenes.ts` 的 glob 是 eager 的，96 份场景 JSON
（源文件共 952 KB）因此整个进主 bundle。地图图片没有这个问题（`?url`，
谁用谁 fetch）。改成按需加载会把 `getScene` 变成异步，是 xl-9bd.15。

资产走**逻辑 ID**：游戏逻辑说 `map:宿舍`，`resolveAsset` 查表拿到实际 URL。
将来换素材、换格式、换目录都不动游戏逻辑（素材还有版权问题要处理，一定会换）。

WebP 的编码参数按源分：PNG 用无损，JPG 用 q80。实测（KB）：
宿舍 136 → 无损 47，转有损 q80 反而涨到 159；大地图 4.2 MB → q80 2.0 MB。

"PNG 转有损反而更大"这句话扩到 28 张之后**只对其中大部分成立**：
大迷宫.png 无损 2579 / q80 449，一张就占了 9.5 MB 里的 2.5 MB。
仍然按源格式走，没有改成"哪个小选哪个"——后者会在没人看的情况下把像素图
降质。这两张要不要开例外是 xl-9bd.14。

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
