# web 侧浏览器平台 API 逐处台账

`web/src` 生产代码里每一处浏览器平台 API 的调用点，各自是原版哪一处的对应物、还是原版根本没有的加法（xl-03x.22）。
`docs/original-primitives.md`（xl-03x.20）的另一半：那一份从原版出发，这一份从 web 出发。

读数（2026-09-13）：共 135 行命中、50 个单元（对应 40 · 已登记 36 · 工程 59 · 未核 0）

**分母不在这里写**：哪几类算「浏览器平台 API」，是 `web/src/test/webPrimitives.test.ts` 里 `PRIMITIVES` 那张正则表定的
（事件 / 键盘 / 指针 / 定时 / 时钟 / 存储 / 地址 / 全屏 / 视口 / 全局 / 音频 / 图片 / 元素 / 无障碍 / 伪类，外加今天应当零命中的「生命周期」），
扫 `web/src` 下的 `.ts` / `.tsx` / `.css`，跳过 `*.test.*`、`test/` 目录与 `generated/`，整行注释跳过。上面那句读数由测试核对。

**判定这一列要人写**（dispatch.md 纪律 3：这是登记，不是分母）。四种写法：

- `对应 src/…java:行` —— 原版在那一行做的是同一件事，这里是它在浏览器里的对应物；测试核那一行真存在、不是空行；
- `已登记 ADR-0001#<键>` —— 原版没有、或故意不同，ADR-0001 例外表有一行说了；
- `工程` —— 加载、诊断、开发工具、渲染载体：玩家看不见这件事本身（看得见的是它画出来的画面，那归逐帧比对）；
- `未核` —— 读了，没读明白，也没跑。

**没有「遗漏」这一格**：这一遍扫出来的「web 多做了、表里没有」都已补登进 ADR-0001（读数见文末），所以台账里不留没归属的一行。

⚠️ 扫描器只核**引用完整**，**不核判定对不对**。「对应」是不是真的只做了原版那件事、没顺手多做一件，是人读出来的。

## 台账

| 调用点 | 类 | 判定 | 证据 |
|---|---|---|---|
| `web/src/app/App.tsx:76` | 元素 / 无障碍 | 已登记 `ADR-0001#saveload-notices` | 存读档面板上那几行 `role="status"` |
| `web/src/app/App.tsx:394,395,396,400,401,402` | 事件 / 全局 | 对应 `src/menu/MenuPanel.java:100` | `mouseReleased`：松手按「按下那一刻」的组件派（Swing 的 mouse grab）。菜单是 xl-z4f，商店与存读档两块宿主 xl-o9z 收拢进同一个 `grabRelease`（归谁在 `useGame.routeByGrab` 定），战斗画布 xl-qqw 接进来（`BattlePanel.java:331`，拖出画布再松手照样触发）；按下到松手之间 window 上同时挂 `mousemove`，拖出宿主的 `mouseDragged` 也按 grab 派（xl-b28；对应 `BattlePanel.java:369`、`MenuPanel.java:116`、`LoadAndSavePanel.java:188`、`ShopPanel.java:200`、`EquipmentShopPanel.java:276`），grab 期间别的宿主不收移动；`mousemove` 与 `mousedown` 挂在捕获阶段，窗口外松了手（window 收不到 mouseup，原版照样收到）之后头一下没按键的移动或新按下当场补上松手（xl-bwl，坐标是见到的那一刻）；和弦（按着一个键再按另一个）照 `Container.java` 的 `isMouseGrab`：第二次按下也归 grab，每一次松手都派给 grab，所有键都松开才解除，窗口外松开按按下次数补松手（xl-4xi）；grab 开始之前舞台外就按着别的键，再在宿主上按下：`isMouseGrab` 为真、`mouseEventTarget` 不重设，目标是最后一个不在 grab 里的事件定的（不收鼠标的面板上那一下按下 / 无键离开窗口那一下 MOUSE_EXITED，都是 null），于是这一下按下不送、不起 grab，它与别的键的松手一个都不送（xl-2yh；窗口外按下的键原版真机上的修饰位未验证）；没有 grab 时按着键移到宿主上：MOUSE_DRAGGED 的 `isMouseGrab` 按着键恒为真、从不重设目标，目标同样是 null，一个 `mouseDragged` 都不派，全松开之后的移动照常（xl-5ee）；`app/appMenu.test.tsx`、`app/appGrab.test.tsx` |
| `web/src/app/App.tsx:461` | 元素 | 工程 | 外壳 `div` |
| `web/src/app/App.tsx:477` | 事件 | 对应 `src/battle/BattlePanel.java:309` | 战斗画布的鼠标按下 |
| `web/src/app/App.tsx:478` | 事件 | 对应 `src/battle/BattlePanel.java:350` | 战斗画布的 `mouseMoved`；按住左键时按 `buttons` 分成 `mouseDragged`（`:369`，少一句 `enemySlector.checkMoveIn`）（xl-qqw）；`app/appGrab.test.tsx`、`battle/pointer.test.ts` |
| `web/src/app/App.tsx:485` | 事件 | 对应 `src/menu/MenuPanel.java:93` | 菜单 `mousePressed` |
| `web/src/app/App.tsx:486` | 事件 | 对应 `src/menu/MenuPanel.java:109` | 菜单 `mouseMoved`（与 `mouseDragged` 两支逐字相同） |
| `web/src/app/App.tsx:487` | 事件 | 已登记 `ADR-0001#list-clipped-with-scrollbar` | 滚轮：原版没有这种输入 |
| `web/src/app/App.tsx:488` | 无障碍 | 已登记 `ADR-0001#start-exit-disabled` | 天书页「确认离开」禁用的理由挂在宿主 `title` 上 |
| `web/src/app/App.tsx:495,496` | 事件 | 对应 `src/shop/ShopPanel.java:173` | 两家店的按下 / 移动（装备店是 `EquipmentShopPanel.java:249` 同形的一段）；按住任一键移动送 `drag`（`ShopPanel.java:200`，只记坐标不跑 `isMoveIn`，xl-bwl）。**松手不在宿主上**，走上面那一行的 `grabRelease`（xl-o9z） |
| `web/src/app/App.tsx:503,504` | 事件 | 对应 `src/start/LoadAndSavePanel.java:161` | 按 `buttons` 分开 `mouseDragged` 与 `mouseMoved`，任一键都算拖动（xl-bwl）；松手同样走 `grabRelease`（xl-o9z） |
| `web/src/app/App.tsx:520,529,534,539,544` | 元素 / 无障碍 | 已登记 `ADR-0001#loading-notices` | 「正在载入 …」与渲染失败那一行（**xl-03x.22 补登**） |
| `web/src/app/App.tsx:525` | 事件 | 工程 | `<StartPanel onNewGame onLoad>` 是组件 prop，不是浏览器事件 —— 正则的误报，如实记下 |
| `web/src/app/App.tsx:555,595,622,623` | 元素 / 无障碍 / 事件 | 已登记 `ADR-0001#toolbar-under-stage` | 工具栏、操作提示、放大方式切换（**xl-03x.22 补登**） |
| `web/src/app/App.tsx:557,567,571,573,581,585,588` | 元素 / 事件 | 工程 | 场景 / 商店两个选择器，只在开发模式或 `?dev` 下渲染（`app/devTools.ts`） |
| `web/src/app/App.tsx:614,616` | 事件 / 无障碍 | 已登记 `ADR-0001#stage-scales-to-window` | 全屏按钮 |
| `web/src/app/devTools.ts:11` | 地址 / 全局 | 工程 | `?dev` 开关 |
| `web/src/audio/bgmPlayer.ts:59,99` | 键盘 / 指针 / 事件 | 已登记 `ADR-0001#bgm-waits-for-gesture` | 自动播放被挡时等第一次手势（**xl-03x.22 补登**） |
| `web/src/audio/bgmPlayer.ts:62` | 音频 | 对应 `src/media/MusicPlayer.java:71` | 背景音乐开播（`play()` 里 `sourceDataLine.start()`）；web 只有一个播放对象、换 `src` |
| `web/src/audio/sfxPlayer.ts:79` | 音频 | 对应 `src/media/MusicPlayer.java:111` | 音效开播（`playmusic()` 里 `sourceDataLine.start()`）；后一声顶掉前一声 |
| `web/src/battle/render/battleRenderer.ts:151,171` | 全局 | 工程 | 量字 / 离屏画布 |
| `web/src/battle/render/scaledBlit.ts:283` | 全局 | 工程 | 离屏画布（战斗与存读档共用的 `blitRectsOnto`，xl-cpo 从 `battleRenderer` 挪过来的） |
| `web/src/game/enemySprites.ts:47` | 图片 | 工程 | 量怪物贴图的尺寸 |
| `web/src/game/keyboard.ts:11,68,77` | 键盘 | 对应 `src/main/GameLauncher.java:186` | 按下 / 松开两路；逐键见下面「## 键位」 |
| `web/src/game/useGame.ts:352,380,395,396,398,399` | 键盘 / 事件 / 全局 | 对应 `src/main/GameLauncher.java:186` | 窗口级键盘监听（原版 `this.addKeyListener(this)` 挂在 `JFrame` 上）。只在 `keyReceiver` 认的面板上收键并 `preventDefault`，别的面板既不收也不拦 —— 标题页按钮的回车 / 空格激活靠的就是那个默认动作（`xl-fqm` 修，见文末）；`app/App.test.tsx`、`game/useGame.test.tsx` |
| `web/src/game/useGame.ts:359` | 键盘 | 对应 `src/scene/ScenePanel.java:207` | ESC 开菜单 |
| `web/src/game/useGame.ts:372` | 键盘 | 对应 `src/battle/BattlePanel.java:290` | 调试外挂键 J（xl-03x.14） |
| `web/src/game/useGame.ts:475,494,811,812` | 时钟 / 定时 / 全局 | 对应 `src/scene/ScenePanel.java:276` | 10 ms 一拍，按真实流逝补拍；`state/loop.test.ts` |
| `web/src/index.css:112` | 伪类 | 已登记 `ADR-0001#toolbar-under-stage` | 工具栏按钮悬停描边 |
| `web/src/main.tsx:6` | 全局 | 工程 | 挂载根 |
| `web/src/menu/render/menuRenderer.ts:129,148` | 全局 | 工程 | 量字 / 离屏画布 |
| `web/src/replay/main.ts:185,188,190,200,205,232,418,605,664,700,899,913,934,935,939,940,942,943` | 全局 / 图片 / 定时 / 事件 | 工程 | 逐帧比对的取图页，不进游戏 |
| `web/src/save/browserStore.ts:112` | 存储 / 全局 | 对应 `src/start/Recorder.java:52` | 存档落盘换成 IndexedDB；读的那一半是 `Loader.java:72` |
| `web/src/saveload/render/saveLoadRenderer.ts:50,62` | 全局 | 工程 | 量字 / 离屏画布 |
| `web/src/scene/sceneRenderer.ts:156,213,247,250,270,284` | 全局 | 工程 | 离屏画布 |
| `web/src/shop/render/shopRenderer.ts:110,128` | 全局 | 工程 | 量字 / 离屏画布 |
| `web/src/shop/render/useShopPreview.ts:52,60,63` | 时钟 / 定时 | 工程 | 开发用商店预览（`?dev` 下的选择器才进得来） |
| `web/src/stage/Stage.tsx:42` | 元素 | 已登记 `ADR-0001#stage-scales-to-window` | 等比缩放 + letterbox 的外框 |
| `web/src/stage/Stage.tsx:63` | 元素 | 工程 | overlay 容器（里面每一样各有自己的一行） |
| `web/src/stage/useFullscreen.ts:15,19,21,22,30,31,33` | 全屏 / 全局 / 事件 | 已登记 `ADR-0001#stage-scales-to-window` | 可全屏 |
| `web/src/stage/useViewportSize.ts:32,33,38,39` | 视口 / 事件 / 全局 | 已登记 `ADR-0001#stage-scales-to-window` | 随窗口缩放 |
| `web/src/start/StartPanel.tsx:153,242` | 无障碍 / 元素 | 已登记 `ADR-0001#screen-reader-text` | 按钮 `aria-label`、「关于我们」的 `alt`（**xl-03x.22 补登**） |
| `web/src/start/StartPanel.tsx:155` | 无障碍 | 已登记 `ADR-0001#start-exit-disabled` | 「结」禁用的理由 |
| `web/src/start/StartPanel.tsx:165,166,167,202` | 事件 / 元素 | 对应 `src/start/StartPanel.java:202` | `mouseMoved` |
| `web/src/start/StartPanel.tsx:172,173` | 事件 | 已登记 `ADR-0001#start-focus-hover` | 键盘焦点 = 悬停 |
| `web/src/start/StartPanel.tsx:174` | 事件 | 对应 `src/start/StartPanel.java:192` | 原版在**松手**时响应（`mouseReleased` → `isRelesedButton`），`click` 也在松手时触发。用 `onClick` 还为了「键盘也按得动」—— 真浏览器里曾经按不动，`xl-fqm` 修了 |
| `web/src/start/StartPanel.tsx:186,195,210,216,226,252,261,277` | 无障碍 / 元素 | 工程 | 装饰图的 `alt=""`（读屏跳过） |
| `web/src/start/useStartPanel.ts:113,115,116` | 时钟 / 定时 | 对应 `src/start/StartPanel.java:153` | 100 ms 一拍，按真实流逝补拍 |
| `web/src/ui/DialogueBox.tsx:50,53` | 元素 / 无障碍 | 已登记 `ADR-0001#screen-reader-text` | `aria-live` + 视觉隐藏的整句（**xl-03x.22 补登**） |
| `web/src/ui/DialogueBox.tsx:77,124` | 无障碍 | 工程 | 头像与等待图标的 `alt=""` |

## 键位

原版一边是 `src/` 里每一处 `KeyEvent.VK_*` 与 `isXxxDown()`；web 一边是 `game/keyboard.ts` 的 `ARROWS` / `KEYS`、
与 `event.key` / `event.code` 比较的字面量、`event` / `raw` 上读的修饰键。两边各自现扫，每个键恰好落一行。
「原版调用点」那一格列出这个键在原版里**每一处**出现的行（现扫对撞：少列、多列、行号过期都红）——
按键归并会把「同一个键在不同场合接得一不一样」藏起来，这一格至少让每一处都看得见、指得到。
各场合的行为本身是行为真值逐步回放（`state/traceReplay.test.ts` 等）的事，这张表不核。
web 那一格写成 JSON 字符串（空格键只能这么写：`" "`）。

| 原版 | 原版调用点 | web | 判定 | 证据 |
|---|---|---|---|---|
| `VK_LEFT` | `src/scene/RoleEvent.java:34` · `src/scene/ScenePanel.java:189,286` | "ArrowLeft" | 照做 | `game/keyboard.test.ts`「四个方向键映射成四个方向」；`state/traceReplay.test.ts` |
| `VK_RIGHT` | `src/scene/RoleEvent.java:37` · `src/scene/ScenePanel.java:190,287` | "ArrowRight" | 照做 | 同上 |
| `VK_UP` | `src/scene/RoleEvent.java:40` · `src/scene/ScenePanel.java:188,288` · `src/scene/SelectEvent.java:316,331` | "ArrowUp" | 照做 | 同上（选择框里上下移动也是它，`SelectEvent.java:316`） |
| `VK_DOWN` | `src/scene/RoleEvent.java:43` · `src/scene/ScenePanel.java:187,289` · `src/scene/SelectEvent.java:316,323` | "ArrowDown" | 照做 | 同上 |
| `VK_SPACE` | `src/scene/DialogueEvent.java:116` · `src/scene/NPCEvent.java:30` · `src/scene/ScenePanel.java:179,197` · `src/scene/SelectEvent.java:416` · `src/scene/TreasureBox.java:54` | " ", "Spacebar" | 照做 | `game/keyboard.test.ts`「空格认成 space」。`Spacebar` 是旧浏览器给同一个键报的名字，不是第二个键 |
| `VK_ENTER` | `src/scene/SelectEvent.java:341` | "Enter" | 已登记 `ADR-0001#dialogue-skip-printing` | 选择框开着时是原版的确认键（`SelectEvent.java:341`，照做）；没开着时是加出来的「跳过逐字打印」 |
| `VK_ESCAPE` | `src/menu/MenuPanel.java:126` · `src/scene/ScenePanel.java:207` · `src/start/LoadAndSavePanel.java:301` | "Escape" | 照做 | 场景开菜单、存读档面板退出；菜单里的 `VK_ESCAPE`（`MenuPanel.java:126`）原版就收不到，照样收不到；`game/useGame.test.tsx` |
| `VK_J` | `src/battle/BattlePanel.java:290` | "KeyJ", "j" | 照做 | 战斗里的调试外挂键（xl-03x.14）；认 `code` 是因为中文输入法开着时 `key` 是 `Process`；`game/useGame.test.tsx` |
| `isControlDown` | `src/main/GameLauncher.java:190` | "ctrlKey" | 照做 | 跑步；`game/keyboard.test.ts`「Ctrl 与 Shift 都算跑步键」 |
| — | — | "shiftKey" | 已登记 `ADR-0001#shift-also-runs` | **原版没有**（xl-03x.22 补登） |

## 这一遍找到的，与它看不见的

找法、读数与结构性盲区写在 ADR-0001「第三遍：从 web 侧出发」那一节。

上面「见文末」说的是：标题页按钮在真浏览器里曾经**键盘按不动**（回车、空格各测一次，click 0 次；
对照 `.click()` 1 次）。`useGame.ts` 的窗口级监听对认下来的键一律 `preventDefault()`，吞掉了按钮的默认激活。
这是缺陷不是例外，`xl-fqm` 修了：`keyReceiver` 不认的面板上既不收键也不拦。判据不数 click（jsdom 不执行默认动作，
数出来修没修都是 0），数的是 `defaultPrevented`：`app/App.test.tsx` 标题页那条、`game/useGame.test.tsx` 场景里照旧拦那条。
