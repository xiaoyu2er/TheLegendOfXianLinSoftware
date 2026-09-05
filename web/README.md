# web/ —— 浏览器版

Vite + React + TypeScript。当前只有 **xl-9bd.1 的舞台脚手架**：一块 1024×640
的空舞台，还没有游戏内容（场景渲染见 xl-9bd.3）。

## 命令

全部在 `web/` 下运行：

```bash
pnpm install
pnpm dev         # 开发服务器
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # 产物在 dist/，可直接静态部署
pnpm preview     # 本地预览 dist/
```

`typecheck` / `test` / `build` 三条在 CI 里跑，见 `.github/workflows/web.yml`。

## 1024×640 是硬约束

逻辑画布锁死 1024×640（`src/stage/constants.ts`），与原版
`src/scene/ScenePanel.java:17-18` 的 `WIDTH` / `HEIGHT` 相同。

窗口变大时**只放大画面，不扩大视野**。原版的视野范围、NPC 摆位、战斗站位
都是按这个分辨率调过的；做成响应式视野就不再是移植了。

canvas 的位图恒为 1024×640，只有它的 CSS 尺寸随窗口变化，所以游戏代码
一律用逻辑坐标作画，不需要知道自己被放大了多少倍。

## 两个坑，都在代码里留了注释

- **全屏时浏览器只渲染全屏元素的子树。** 因此全屏目标是外层 `.app-shell`
  而不是舞台本身——否则工具栏会整个消失，玩家只剩 Esc 一条退路。
  `src/app/App.test.tsx` 里有一条测试盯着这个结构。
- **headless Chrome 不派发 ResizeObserver 回调。** 在 headless 里量出来的
  舞台尺寸会冻结在首次渲染的值，看起来像缩放坏了，其实不是。要验证缩放
  行为，用有头浏览器。

## 产物可静态部署

`vite.config.ts` 里 `base: './'`，产物引用相对路径，`dist/` 整个目录丢到任意
静态托管的任意子目录下都能跑。CI 里有一步 grep 校验这一点。
