# web/ —— 浏览器版

Vite + React + TypeScript + Pixi。现在能打开网页看到**宿舍**，用方向键走动、
按住 Ctrl 或 Shift 跑动，撞到墙和家具会被挡住（xl-9bd.6）；开发模式下可以跳到
**全部 96 个场景**里的任意一个（xl-9bd.3 / xl-9bd.4）。NPC、对话、镜头跟随
还没有。

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
- 代价是产物可能陈旧，两层判据各管一段：场景 JSON 由 `src/data/scenes.test.ts`
  现场重烘一遍比对；资源那一层（WebP / m4a / 映射表）重烘不了——`cwebp` 要
  另装、`afconvert` 是 macOS 自带而 CI 是 ubuntu，且它的产物每次都不同——改由
  `src/assets/bakeStamp.test.ts` 核烘焙时写下的指纹：烘焙器自己的源码闭包
  （顺着 import 现爬）与它读过的每一个输入文件（写这段时是 703 个，数目由
  `bakeStamp.json` 自己数，这里只是当天的读数），跑测试时重算 sha256 比对。
  改了 `scripts/bake.ts` 却不重烘，那条红；`roleSpriteSize.test.ts` 这类核
  产物的用例照绿（实测），这正是它要补的洞（xl-23y）。

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

场景 JSON **按需加载**（xl-9bd.15）：`src/data/scenes.ts` 的 glob 不是 eager 的，
一个场景一个 chunk，名单仍然是同步的（选择器不用等任何一份 JSON）。取场景因此
是异步的 `loadScene`，这条边界本来就在——渲染器的 `showScene` 一直是异步的。
量出来的代价与收益（当时烘了 96 个场景，手法是把 glob 换成空表再 `pnpm build`
相减）：场景 JSON 占主 chunk 597.56 kB / gzip 85.81 kB，即一半 / 四分之一，
改完主 chunk 从 gzip 340.60 kB 降到 257.34 kB。其中 89.9% 是碰撞网格，
而玩家一次只站在一个场景里。

同一批产物还有一个**同步**取法 `src/data/scenesEager.ts`，一次性全读进来，
**只给测试与 `scripts/` 下的 node 工具用**：应用代码 import 它就等于把上面这件事
悄悄撤销（功能全对，只是主 chunk 又胖回去）。`src/data/sceneLoading.test.ts`
里那条用例数的是"谁在 import 它"的名单，扫不到人也会红。

资产走**逻辑 ID**：游戏逻辑说 `map:宿舍`，`resolveAsset` 查表拿到实际 URL。
将来换素材、换格式、换目录都不动游戏逻辑（素材还有版权问题要处理，一定会换）。

WebP 的编码参数按源分：PNG 用无损，JPG 用 q80。实测（KB）：
宿舍 136 → 无损 47，转有损 q80 反而涨到 159；大地图 4.2 MB → q80 2.0 MB。

"PNG 转有损反而更大"这句话扩到 28 张之后**只对其中大部分成立**：
大迷宫.png 无损 2579 / q80 449，一张就占了 9.5 MB 里的 2.5 MB。
仍然按源格式走，没有改成"哪个小选哪个"——后者会在没人看的情况下把像素图
降质。这两张要不要开例外是 xl-9bd.14。

## 状态层：一个纯函数，跟渲染没有关系

游戏状态在 `src/state/`，对外只有一个

```ts
step(world: World, input: InputEvent[], dtMs: number): World
```

不读时钟、不碰 DOM、不认识 Pixi（`src/state/step.test.ts` 里有一条测试逐个文件
查 import，分母是 `src/state/` 下的每一个文件）。原版的状态推进挂在绘制上
——`ScenePanel.paint()` 有副作用，不画就不推进——照抄到浏览器里就是"切后台
游戏冻住、切回来补跑几百帧"。

驱动在 `src/game/useGame.ts`，用 `setInterval` 而**不是** `requestAnimationFrame`：
rAF 在标签页不可见时完全不触发，而 `setInterval` 只是被节流到 ~1 秒一次，
流逝的时间从 `performance.now()` 现算，所以每次醒来补的是那一秒。
"前后台行为一致"这条写成了可执行的不变量：**同样的总时长、同样的输入，
切成几段喂进来世界一模一样**（`src/state/loop.test.ts`）。

### 期望值一个都不是手写的

逐 tick 的行为对齐 `tools/traces/out/*.trace.json` —— 那是原版 Java 程序自己
跑出来的每一帧（见 `docs/trace-format.md`）。`src/state/traceReplay.test.ts`
照着 trace 里的按键回放，逐 tick 比主角的格子坐标、像素坐标、朝向、帧号、
走跑状态。手写期望值的测试会绿、而且是错的：写实现和写期望的是同一个 agent。

剧本名单**从 `tools/traces/out/` 现数**（`src/state/trace.ts` 的 `TRACE_NAMES`），
不抄一份出来：加了剧本立刻多一组回放用例，少导出一份名单立刻短一截。
回放照剧本头的 `warmup` 先进一遍预热脚本 —— 原版的 `initiation` 只在新场景
有 `Dialogue` 段时才换 `DialogueEvent`，不预热的话 `dialogueEventOver` 是反的，
而出口的分支正是靠它分开的。

## 跨端逐帧比对（xl-9bd.8）

逐 tick 对齐**状态**之外，还有一条对齐**像素**的流水线：同一份剧本在原版与
Web 版各跑一遍，各出 N 帧，逐帧算差异，超阈值即回归，并报告第一个偏离的帧号。

    tools/compare-frames.sh                          # 从仓库根目录跑
    tools/compare-frames.sh dorm-walk --self-check   # 故意改坏一处渲染，验它响不响

Web 侧那一半在这里：`replay.html` + `src/replay/`（dev-only 取图页，`vite build`
不打它）、`scripts/cdp.ts`（一百来行的无头 Chrome 驱动，不引 puppeteer）、
`scripts/compare.ts`（取图 + 报告）、`src/compare/`（判据、PNG 编解码、期望表）。

要 Java 与本机 Chrome，所以整条流水线不在 CI 里；**进 CI 的是它的判据**
（`src/compare/*.test.ts`）。判据为什么不是哈希、"现在必然红"为什么不等于没用、
以及它量出来的第一个真问题（原版画地图是拉伸的，`xl-9bd.16`），见
`docs/frame-compare.md`。

## 时间加速

`state/loop.ts` 的 `Ticker.timeScale`：倍率乘在**真实流逝的毫秒**上，不乘在
tick 步长上——后者会跳过定时器的触发时刻，主角走的距离立刻对不上真值。
判据是一条不变量：**k× 跑 T 毫秒，与 1× 跑 k·T 毫秒得到逐字段相同的世界**
（`src/state/loop.test.ts`，四个倍率）。墙钟实测见 `tools/speed-probe.sh`。

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

## 出口切换与背景音乐（xl-9bd.12）

走到出口格，世界自己换场景：`state/step.ts` 的第 4 步照抄 `ExitEvent.checkExit`
的三条分支（进目标场景 / 走回当前剧情脚本 / 剧情往前推一段），落点是数据里的
`entrance`。换场景的数据只能**同步**取——原版的 `initiation` 就在 `step()` 里
同步跑完——所以调用方要先把当前场景那几个出口的目标预取到手
（`src/data/loadedScenes.ts`，取的是邻居，不是 96 个）。

**背景音乐是世界状态里的一个声明值**：`world.audio.bgm` 就是原版
`MusicPlayer.currentPlayingBGM` 那个字符串，逐 tick 对着真值比
（`state/traceReplay.test.ts`）。`audio/bgmPlayer.ts` 只是把它同步到实际输出的
订阅者，一个决定都不做；**不重叠是结构性的**——整个播放器只有一个播放对象。

音频烘成 96 kbps 的 AAC-LC（`.m4a`，`afconvert`），**只烘 M1 走到的那三个场景
用到的三首**，其余 24 首落在 `src/generated/deferredBgm.json` 上：查不到与
"故意还没转"必须分得开，否则烘焙漏了一首的表现只是某个场景是哑的。
产物走 `?url`，谁放谁下载。

浏览器在用户碰过页面之前不让出声（实测 headless Chrome：`play()` 抛
`NotAllowedError`），播放器为此等一次手势再试。

## 开发用场景跳转

工具栏上的场景下拉框在 `pnpm dev` 里恒有；构建产物里默认没有，加 `?dev`
打开（`src/app/devTools.ts`）——部署一份产物给别人看的时候，"跳到任意场景
做检查"这件事不能只在本机能做。

## 产物可静态部署

`vite.config.ts` 里 `base: './'`，产物引用相对路径，`dist/` 整个目录丢到任意
静态托管的任意子目录下都能跑。CI 里有一步 grep 校验这一点。
