# web 端复刻原版缺陷，不修

原版战斗里有一批确实错了的行为：第三只怪的点击范围借用了第一只的高度、
敌人血量可以是负数、连打两场会累积单位、按钮的点击范围比画出来的位置左偏
15 上偏 6、小精灵的伤害扣了两次、算出来的技能防御从未被使用。**web 端全部
照搬**，因为行为真值逐字段记录的是原版做了什么，任何一处"修好"都会让那条
真值永远对不上，于是必须为它写一条例外——而例外是要靠人记的东西。

## Considered Options

- **逐条决定哪些修哪些不修**。否掉的理由不是原则而是事实：这批缺陷是**一趟
  读代码就多出来三条**的，清单不封闭。对一个还在长的清单没法逐条决定。
- **全部修正，真值里标成已知偏离**。等于把判据的分辨力换成一份人工维护的
  例外表。

## Consequences

想修的话，修是 M7 之后单独一张票的事，且必须连真值一起重导。

`xl-1dv.*` 那批票是**缺陷的记录**，不是待办；其中 `xl-1dv.5`（"paint() 有
副作用"）的结论已被实测推翻，见 ADR-0003。

## 例外（这一节要靠人签，不能推导）

"全部照搬"有例外，而例外**不写下来就等于没有**：一处照搬与一处故意不照搬，
在画面上分不开，下一个照着原版重读那一段的人只会以为 web 端抄错了。

### 标记约定（xl-03x.4）

**代码里每一处「故意不复刻」或「故意加了原版没有的东西」，都必须在那段注释里带一个
标记** `@exception ADR-0001#<键>`，键就是下表第一列。扫描器
`web/src/test/adrExceptions.test.ts` 认的是这个标记，**不认措辞**，并与这张表双向对撞：

- 代码里有一处标记、表里没有那一行 → 红；
- 表里有一行、代码里零处标记指向它 → 红；
- `@exception` 后面没跟一个完整的 `ADR-0001#<键>` → 红（笔误不许安静地漏过去）；
- 标记写进测试文件 → 红（取舍住在实现旁边；测试里的标记会替实现那边丢了的标记充数）。

**为什么不用关键词 grep 守**：「不复刻」「不抄」「原版没有」「有意」「已知偏离」……
这些措辞写法不封闭，grep 找不到就等于通过 —— 而漏写一个措辞正是这张表漏掉一整族
两个里程碑没人发现的原因。

⚠️ **扫描器只管以后。** 标记立起来之前就存在的那些，是 xl-03x.4 人工找了一遍补上的
（找法与读数见表下面那一段）。**那一遍找漏了没人知道**，扫描器变绿不说明历史上没有
漏登的例外。

标注「xl-03x.19 收口签」的那十五行，原先都标着「待签」：十一行是 xl-03x.4 补登的草稿（**事实与理由都抄自代码里本来就有的注释**），
四行是 xl-03x.20 补登的，一行是 xl-03x.12 改写的。M8 收口（xl-03x.19）按主干的交接把它们签掉，**合并即认**；
每一行判据格有没有被篡改验证过、读数是多少，写在表下「收口签字与篡改读数」那一节 —— **签字不等于判据成立**，
「暂无会红的判据」的那几行签的是取舍本身。⚠️ 「待签」这两个字不只是注释：`docs/player-coverage.md` 的判据
（`web/src/mainline/test/playerCoverage.test.ts`）认一行例外为「签过字的登记」，条件就是那一行里没有「待签」。

| 标记 | 原版行为 | web 端做的 | 为什么 | 判据 |
|---|---|---|---|---|
| `new-game-resets-party` | 点「起」**不重置队伍**（`GameLauncher.init()` 是死代码，唯一调用点被注释掉；而且即便调用了，`level` / `exp` / `angryValue` 是 `static`、三个构造函数一个都不赋，最多只到"满血复活、等级经验照旧"） | 回出厂状态：1 / 3 / 1 级、满血、经验 0 | xl-kaa 的验收标准第二条点名要它。全灭回标题再开一局，带着上一局的残血进脚本1 是玩不下去的 —— 而这一层今天还没有存档（M6，xl-i06.1），"接着上一局"没有别的出口 | `web/src/fakes/originalNewGame.test.ts`（原版那一半）+ `web/src/fakes/party.test.ts`（出厂状态那一半）+ `web/src/game/useGame.test.tsx` 的「重开一局」 |
| `list-clipped-with-scrollbar` | **列表不裁剪、也没有滚动条**：`EquipPanel.drawEquipment()` 的 y 一路加下去，画到列表框外照样画；`isMoveIn()` 的命中带同样无界（`originalY += 22`） | **画的那一半裁**：只画滚动窗口里的那几行，框的右内沿上加一条滚动条，滚轮、槽内点击与拖滑块翻页（`MenuInput` 因此多一支 `wheel`，真值里没有它；拖滑块不另开输入，骑在 `move` 上 —— 原版 `mouseDragged` 与 `mouseMoved` 两支逐字相同。拖拽状态 `drag` 与滚动位置一样**不进真值**，xl-03x.9） | 装不下一屏的背包**看不见**后面那几行（20 件武器撑过框 4 行，`menu-scroll` 量的就是它）。xl-6lo.13 的票面要的是「看得见」 | `web/src/menu/scroll.test.ts` 与 `menu/render/scrollbar.test.ts` |
| `list-offscreen-rows-still-hit` | 同上的**另一半**：框外那几行**仍然点得中**（落点 y 518 / 540 / 562 / 584，都还在 640 高的面板里） | **不改**：命中带一路往下排、没有下界，`offset == 0` 时算式与原版逐字相同 | 「看得见」与「够得着」是两件事，`menu-scroll` 的剧本描述把它们分开写着。合成一条的话第 9 / 10 步当场对不上真值 —— 篡改矩阵实测：给命中加上下界，`menu-scroll · equip` 立刻红 | `scroll.test.ts` 的「够得着那一半没被改掉」一组 + `menuTrace.test.ts` 的 `menu-scroll · equip` |
| `scrolled-up-rows-unhittable` | **`offset > 0` 时卷到框上面去的那几行点不中**（原版没有 `offset`，所以原版没有对应行为可抄） | 命中只从第 `offset` 行起算 | 卷上去的那片区域住着六颗槽位按钮（命中框 y 129..149）。不设这条下界，翻过页之后点槽位按钮会**同时**选中一件装备 | `scroll.test.ts`「翻上去的那几行点不中」（装备页 / 物品页各一条） |
| `load-extra-scene-loop` | **中途读档多起一条场景循环**（`LoadAndSavePanel` 构造时就建好 `Thread t=new Thread(scenePanel)`，读档分支 `if(!t.isAlive()) t.start()`；它与「起」那条不是同一个对象，而 `ScenePanel.run()` 是没有出口的 `while(true)`）。**玩家观测到的**：「起」之后中途读档，场景里走路、对话吐字、NPC 动画**全部快一倍**（JVM 读数：`step()` 85.5 → 169.5 次/秒，场景线程 1 → 2 条）；之后再读几次档**仍是两倍，不抛、不崩**（`isAlive` 恒真，第二次读档根本不调 `start()`）。同一机制还有一个不经过读档的入口：回标题再「起」每次多一条（读数 3 条、254.5 次/秒） | 不复刻：场景一拍一个 `advance`，读档不叠、重开也不叠 | 复刻它要求状态层先有「场景循环线程」这个概念，而状态层是同步纯函数、**没有线程模型** —— 搬过来的是原版的一个实现细节，不是行为（xl-i06.2 裁定，xl-i06.11 落地；「第二次读档会崩」是 grilling 时读源码的推断，JVM 上跑出来不成立，不写） | `web/src/game/loadResidue.test.ts`「读档之后场景不是双倍速」一组（读档一次、读档两次、读档 → 回标题 → 起，各推一秒只走 1000 ms）；原版那一半：`web/src/save/test/loadResidueOriginal.test.ts`「那条不复刻的例外」 |
| `win32-script-filename` | **出口名带行尾空格的那三本打不开**（`xl-1dv.11`；`new Reader(name)` 把名字原样拼进 `"script//" + name`）。**这一条只在 posix 上成立**：macOS + openjdk 17 **实测** `new tools.Reader("仙二教学楼二楼夜.txt ")` 抛 `FileNotFoundException`，去掉行尾空格就打得开；Win32 的路径规范化会去掉末尾的空格与点，打得开（⚠️ Win32 文档行为，这台机器上没法跑）。其中 `脚本32` 那一本**在主线链上**（第 36 跳），断在它后面的是三分之一条链与整个结局 | **按 win32 语义解析脚本文件名**：`data/scenes.ts` 的 `sceneNameOfFile` 去掉末尾的空格与点 | 这批数据是在 Windows 上写、在 Windows 上玩的（`剧情1` / `迷宫1` 里那三条反斜杠路径为证，`assets/path.ts` 的 `normalizePath` 已经为同一个原因站在 Windows 那一边）。posix 下的断链是「把一个 Windows 游戏搬到别的文件系统上」的产物，不是游戏逻辑。**登在这里而不是当成 portability，是因为真值是在 macOS 上导的**：原版侧 `mainline/test/chain.ts` 把两种语义都算出来、posix 那一条明写着主线断在第 36 跳，Web 与它分道扬镳的地方只有这张表记得住（xl-czb.7 裁定，主干 7eaf2f4 签）。**数据不改**，`assets/knownMissing.ts` 那两条也不动 —— 那张表登记的是「字面路径在磁盘上不存在」，这件事仍然成立 | `web/src/mainline/test/handoff.test.ts`（主线第 36 跳；去掉那一步 trim，主干实测**恰好 10 条红**，第 36 跳起一路到第 44 跳）+ `web/src/data/loadedScenes.test.ts`「行尾带空格的出口名」 |
| `panel-threads-run-while-hidden` | **（xl-03x.4 补登 · xl-03x.19 收口签）****面板动画线程关着也在跑**：`GameLauncher` 构造函数里一口气 `new` 好菜单、两家店、存读档面板，各自构造时就起一条没有出口的 `while(true)`（菜单 `FatherPanel` 四条 100 ms；`ShopPanel` / `EquipmentShopPanel` 各一条 120 ms；`LoadAndSavePanel.startAnimationThread()` 一条 100 ms；xl-03x.20 现扫 `new Thread` 补进第五处：标题 `StartPanel.startAnimationThread()` 一条 100 ms，推鼠标 / 按钮 / 卷轴的帧与**云的坐标**），从开机跑到关机，**不管面板显不显示**。它们推的是鼠标图、人物动画、奇术页技能动画的帧 —— 一个状态字段都不碰（菜单那几个 `Mouse` 计数器与奇术页动画进快照，但不进队伍、不进战斗） | **不推**：菜单只在显示着时推（`advanceSession` 的 `panel === 'menu'`）；店与存读档面板的帧号由渲染层从进面板那一刻现数；标题页离开即卸载（`App.tsx` 只在标题时挂它），计时器随之停；**状态不丢**（xl-6zf 起放在 `App.tsx` 的 `titleStateRef`，与原版那一块从开机活到关机的 `StartPanel` 同一份），回来接着离开那一刻 —— 云停在离开时的坐标上，不是原版飘过了的坐标 | 推它要求这一层有「面板级线程在背后跑」的模型，而状态层是同步纯函数、没有线程模型（与「读档多起一条场景循环」同一个理由）。菜单那几条要推还得先把 `update()` 与 `paint` 拆开（原版关着菜单一次 paint 都没有），见 `xl-6lo.19`。**只影响帧相位，不影响任何玩法状态**。M8 规格（xl-03x.1）裁定：**补签，不实现**；`xl-6lo.19` 留作登记 | **暂无会红的判据** —— 行为真值两条菜单剧本全程菜单开着，盖不到「关着」那一段；`xl-6lo.19` 的验收写着要自己造一条 |
| `title-bgm-sleep` | **（xl-03x.4 补登 · xl-03x.19 收口签）**`switchTo("start")` 里 `readBGM("主题曲.mp3")` → **`Clock.sleep(1000)`** → `openBGM()`：夹在中间那一秒是 `MusicPlayer` 两个标志位之间的线程同步补丁 | 不睡：标题一进来就把主题曲交给 `audio/bgmPlayer.ts` | 浏览器那边没有那对标志位，换曲子由播放器自己收尾；照抄成一秒延迟，是把别人家的竞态补丁变成我们自己的一秒黑屏（理由全文在 `game/session.ts` 的 `createSession`） | `game/session.test.ts`「起手就停在标题上」（`currentBgm` 当拍就是主题曲） |
| `narratage-sleeps` | **（xl-03x.4 补登 · xl-03x.19 收口签）**旁白 `WordRun` 一句打完 `Clock.sleep(500)`、整段播完 `Clock.sleep(1000)` —— **在 EDT 上直接睡**，睡的是真实时间 | 不模拟：句与句之间没有那半秒停顿 | 真值跑在虚拟时钟上，那两段睡眠一个 tick 都不占（第 0 句从 vt=50 打到 vt=950，vt=1000 就换行）；模拟了反而与真值差 150 个 tick。要复刻它得先有一份能看见它的真值（`state/narratage.ts` 头注） | 场景真值的逐步回放（`state/traceReplay.test.ts`）—— ⚠️ 「模拟那半秒就会错拍」是从头注那条读数推的，本票没有篡改验证 |
| `dialogue-skip-printing` | **（xl-03x.4 补登 · xl-03x.19 收口签）****原版没有**「跳过逐字打印」：句子没打完时 `DialogueEvent.keyPressed` / `NPCEvent.keyPress` 什么也不做，只能等 | **加了**：回车把当前这一屏一次打满（`state/dialogue.ts` 的 `skipPrinting`），空格那一路与原版逐字同构 | xl-9bd.10 的验收标准要它。挂回车不挂空格，是为了让这条增量一次都踩不到真值（真值里的空格全在句子打完之后） | `state/dialogue.test.ts`「跳过逐字打印（原版没有的加法）」 |
| `start-focus-hover` | **（xl-03x.4 补登 · xl-03x.19 收口签）****原版没有键盘焦点**：标题四颗按钮只认鼠标坐标 | **加了**：Tab 到一颗按钮上等于鼠标移进来（换图 + 那圈高亮转起来），离开等于移出 | 无障碍。只补 CSS 的话 Tab 过来的人看到一颗半死的按钮 | `start/StartPanel.test.tsx`「键盘 Tab 过来也换图、也转高亮」 |
| `saveload-notices` | **（xl-03x.4 补登 · xl-03x.19 收口签）****原版没有**存读档面板上那几行状态字（原版的档是同步读写本地文件，没有「正在读」「读不上来」「没写进去」这几种状态） | **加了**：`app/App.tsx` 的 `SaveLoadNotices`，画在 DOM overlay 上、不进画布 | 浏览器存储是异步的、会失败。不说一声的话，「还没读上来」画成三个空槽是一句谎话。放在 overlay 上是为了不被当成原版画面去逐帧比 | `game/saveloadSession.test.ts` 与 `save/store.test.ts`（就绪 / 失败 / 写失败几种状态） |
| `start-exit-disabled` | **（xl-03x.12 改写，合两处 · xl-03x.19 收口签）**两颗按钮都是 `System.exit(0)`：标题「结」（`src/start/StartPanel.java:234`），与天书页「退出」→「确认离开」（`src/menu/FuncButtons.java:379`；退出之前还先出一声 `换list.wav`、收起按钮组） | 两颗都**画出来、禁用**，带一句理由。标题那颗是 `<button disabled title>`（`start/buttons.ts` 的 `START_BUTTON_WIRING.end`）；天书页那颗在画布上（`menu/funcButtons.ts` 的 `FUNC_DISABLED`）：照画、照原版展开收起（`isDraw` 不动，真值 `func.drawn` 不受影响），但不响应悬停 / 按下 / 松开 —— 贴图恒为常态、不出声、不收按钮组，理由挂在菜单画布宿主的 `title` 上。**两颗悬停都不换图**：React 对禁用的按钮不派发 `mouseenter`（2026-09-11 jsdom 实测；⚠️ 真浏览器没量过），而原版会换 | 浏览器里没有对应物（`window.close()` 对地址栏进来的页面一声不吭）；xl-u23 量过三条路之后的定案（用户 2026-09-08 裁定）。M8 规格原定「画出来、点了什么都不发生」，主干在 xl-03x.12 的评论里改裁为与 xl-u23 统一：禁用让「浏览器做不到」在画面上看得见，而「按钮好好的、点了没反应」与「没接线」长得一模一样 | 标题：`start/StartPanel.test.tsx`「禁用的两颗各带一句理由」+「禁用的那两颗点下去屏幕纹丝不动」；天书页：`menu/funcButtons.test.ts`「天书页『确认离开』是禁用的」一组、`game/menuSession.test.ts`「走会话也纹丝不动」、`app/appMenu.test.tsx`「挂上理由的 title」 |
| `start-button-hitbox-dom` | 标题页五颗按钮的命中判定是**四个严格不等号**，有效区是 49×49 的开区间 —— 左边与上边那一列 / 一行**点不着** | 命中判定交给 DOM：按钮元素的盒子就是那个 50×50 矩形，而 CSS 盒子**含左、上两条边** —— 于是那一列 / 一行**点得着** | 补这一像素要在 DOM 上再叠一层自己的命中判定（`pointer-events: none` + 手算坐标），那会把「按钮是真的 `<button>`、读屏读得到、Tab 走得到、回车按得动」整套无障碍能力作废（⚠️ 「回车按得动」这一样一度**并不成立**：窗口级键盘监听吞掉了默认动作，2026-09-12 由 `xl-fqm` 修好，判据见本文件第三遍那一节） —— **为一个像素换掉四样无障碍能力，不划算**。⚠️ 这是 xl-whk 的评审翻出来的旧账：差异与理由一直写在 `start/buttons.ts` 的头注里，**但从没进过这张表**（标记约定立起来之前就存在的那一类，正是扫描器管不到的历史）。主干 2026-09-12 核过头注与实现后签 | `web/src/start/buttons.ts` 的头注（原版那四个严格不等号从 GBK 源码现读）+ `start/startTrace.test.ts`：入库剧本的坐标都落在两者一致的内部，**真落到那一像素上，状态层判据会当场对不上** |
| `end-not-kept-across-new-game` | **（xl-03x.4 补登 · xl-03x.19 收口签）**点「起」**不重建 `endPanel`**（`GameLauncher.init()` 的调用点被注释掉），所以结局那条线程与字幕停下的位置活过新局 —— 新局再走到 `$`，原版一进来就定格 | 「起」整个重建会话（`NewGameCarry` 不带结局），新局走到 `$` 从头再滚一遍 | 这是 `new-game-resets-party` 那个取舍连带出来的：「起」回出厂状态靠的是整个重建会话。⚠️ **未量过**（`game/session.ts` 的 `Session.end` 自己写着）；M8 规格把「重开一局把结局那条线程一起丢掉」划进跨面板那一族、这一轮不收（xl-03x.1 Out of Scope），所以它今天是一条**没有归属票**的偏离 —— 登在这里，免得它只活在一句注释里 | **暂无会红的判据**（要跨面板才看得见） |
| `end-thread-not-duplicated` | **（xl-03x.4 补登 · xl-03x.19 收口签）**每 `switchTo("end")` 一次，`EndPanel.start()` 就 `new Thread(this).start()` **多起一条**结局线程 | 第二次进结局只把旗标重置，不多起一条 | 与「读档多起一条场景循环」同一个理由：这一层没有线程模型。⚠️ **走不走得到第二次未验证**：`$` 只出现在脚本41 那一段对话里、按完就不再开（`end/trigger.test.ts`）；读一个停在那段对话之前的档再按一遍可能是一条路 —— 未量过 | **暂无会红的判据**（上面那条路走不走得到都还没量） |
| `map-source-overflow-throws` | **（xl-03x.4 补登 · xl-03x.19 收口签）**地图图片**比碰撞网格要的源矩形还小**时，`drawMap` 的源矩形越出图片，Java2D 画出来的是一种说不清的残缺（xl-czb.3 的探针：1022×640 那张少画两整列，1023×639 那张缺的像素最左一个在 x=0） | **硬失败**：`scene/mapSize.ts` 的 `checkMapSize` 抛 | 拉伸、补边、夹取都会画出「看起来对」的画面。今天**没有场景走得到**这条路（比源矩形小一两像素的那 6 张走的是另一支、已复刻） | `scene/mapSize.test.ts` |
| `select-under-dialogue-overlay` | **（xl-03x.4 补登 · xl-03x.19 收口签）**`ScenePanel.paint()` 先画对话框、再画选择框与「得到物品」提示框 —— 后两者压在对话框上面 | 次序**反了**：对话框在这一侧是 DOM overlay（`ui/DialogueBox.tsx`），永远压在画布上面 | 对话框做成 DOM 是整层的取舍（字形与排版归浏览器）。两者同时开着的那一帧**今天走不到**（选择框开着时 `checkSelectEvent` 会把口头语截胡） | **暂无会红的判据** —— 没有真值分辨得出来 |
| `random-streams-per-battle-and-shop` | **（xl-03x.20 补登 · xl-03x.19 收口签）**全局**一条无种子**的 `Math.random()` 流：战斗里伤害 / 出招 / 小精灵等 15 处、两家店开机掷存货 7 处，都直接调它 | 每场战斗、每家店（会话里头一次进门时）**各开一条** `JavaRandom`，种子由 `Math.random()` 现摇（31 位）。算式逐字照抄；遇敌、答题金币、宝箱仍直接调 `Math.random()`，与原版同 | 战斗与店的世界要能按剧本种子逐位复现真值（ADR-0004），同一个世界到了游戏里只能换一个现摇的种子。分布不变，玩家观测不到（⚠️ 读代码的结论，没跑过分布检验）。理由原文在 `game/session.ts` 的 `SessionDeps.random` —— 注释自称「明写出来的差别」，却没进这张表 | 算式那一半：`battle/battleTrace.test.ts`「逐步逐字段与真值相等」、`shop/world.test.ts`「62 次掷骰共用一条流，先药店后装备店」；「现摇种子」这一半**暂无会红的判据** |
| `new-game-rerolls-shop-stock` | **（xl-03x.20 补登 · xl-03x.19 收口签）**点「起」**不重建两家店**：`ShopPanel` / `EquipmentShopPanel` 开机 `new` 一次，存货（连上一局买掉的）活过新局 | 「起」整个重建会话，`Session.shop` 回到 `null`，新局头一次进门**重掷存货** | `new-game-resets-party` 那个取舍连带的（「起」回出厂状态靠整个重建会话）。`game/session.ts` 的 `NewGameCarry` 头注列了一张「不带、归 xl-9rv 裁」的名单，两家店不在上面 —— 名单漏了，不是裁过。⚠️ **读代码，未跑** | **暂无会红的判据** |
| `stage-scales-to-window` | **（xl-03x.20 补登 · xl-03x.19 收口签）**窗口 1024×640、`setResizable(false)`；**不居中**（`setMiddle()` 唯一的调用点 `GameLauncher.java:73` 被注释掉，位置归系统） | 逻辑画布恒 1024×640，**随窗口等比缩放、居中、两侧 letterbox、可全屏**（`stage/computeStageScale.ts`、`app/App.tsx` 的 `useFullscreen`） | 浏览器窗口的大小不归页面管。xl-9bd.1 脚手架时定的（「不做响应式视野 —— 视野范围与坐标都是按这个分辨率调过的，改了就不是移植」），**理由只写在那个提交信息里**，是 xl-03x.20 扫提交信息扫出来的。逐帧比对取的是 1024×640 逻辑画布，不受缩放影响 | 缩放那一半：`stage/computeStageScale.test.ts`；居中**暂无会红的判据** |
| `fail-loud-where-original-swallows` | **（xl-03x.20 补登 · xl-03x.19 收口签）**缺资源、坏数据、没判空时**不出声**：`MusicPlayer` 找不到曲子 / 音效就打栈、静音、照玩；战斗里没判空的地方一发 NPE，**那条线程死掉、画面冻住、进程还在**（`Hero.calDamage` 的 `case 5/6/7` 等）；坏档的内容在 `parseInt` 上抛、状态读进一半（⚠️ 读源码的推断，未实测） | **大声失败**：战斗里抛一句点名原版哪一句 NPE 的错误（`battle/step.ts` 若干处）；名单外的背景音乐与默认 resolve 查不到的音效当场抛；一个槽坏了整个存档仓库 `failed`，面板上说一声 | 静默会做出「看起来一切正常」的画面与真值：「打过了、可就是没人挨打」、「这一首暂时不管」与「烘焙漏了一首」分不开。照抄的是「它会炸」，炸法换成说得清的话（xl-rh9.7 的提交信息、`battle/step.ts` 的 `heroTargets` 注释）。⚠️ 代价：`game/useGame.ts` 的主循环没有 catch，**走得到的**那几处失败的样子与原版不同 —— 第一槽先死再全灭那一条就走得到（xl-9go） | `audio/sfxPlayer.test.ts`「映射表里没有的一声：默认 resolve 当场抛」、`assets/resolve.test.ts`「已知缺失的素材查出来是 null，别的查不到照旧抛」、`save/store.test.ts`「盘上有一份不认识版本号的档：failed」；战斗那几处**没有**逐条篡改验证 |
| `shift-also-runs` | **（xl-03x.22 补登 · 主干签）**跑步键只有 Ctrl：`GameLauncher.keyPressed` 把 `e.isControlDown()` 传给 `ScenePanel.keyPressed`，那是原版读的唯一一个修饰键 | **Shift 也算跑**：`game/keyboard.ts` 的 `isRunModifier` 是 `ctrlKey \|\| shiftKey`，状态层收到的仍然只是 `ctrl: true` | macOS 上 Ctrl+方向键是系统级的切换桌面，事件到不了页面，只认 Ctrl 等于在 Mac 上跑不起来。理由一直写在 `keyboard.ts` 的注释里，**没进过这张表**；是 xl-03x.22 从 web 侧反扫键位（`docs/web-primitives.md`「## 键位」，原版没有 `isShiftDown`）扫出来的 | `game/keyboard.test.ts`「Ctrl 与 Shift 都算跑步键」、`game/useGame.test.tsx`「按住 Shift 是跑」 |
| `toolbar-under-stage` | **（xl-03x.22 补登 · 主干签）**原版窗口里**只有游戏画面**，没有任何提示字与设置 | 舞台右下角一条工具栏：**按面板变的操作提示**（`toolbar-hint`，「方向键走动……ESC 开菜单」之类）、**放大方式**切换（锐利 / 平滑，`stage/scaling.ts`）、全屏按钮（全屏那一半归 `stage-scales-to-window`）。场景 / 商店两个选择器只在开发模式或 `?dev` 下出现，不算玩家看得到的加法 | 原版的键位全靠说明书，网页没有说明书（`index.css` 的 `.toolbar-hint` 注释：「迁移期起码得让人知道怎么走」）；放大方式是缩放带出来的选择（xl-h1f 裁定默认锐利）。**理由只在注释与 xl-h1f 里**，xl-03x.22 从 web 侧反扫 DOM 元素扫出来 | `app/App.test.tsx`「默认用锐利放大，点一下切到平滑」、`app/appTitle.test.tsx` 读 `.toolbar-hint`；提示字**逐面板的内容无判据** |
| `loading-notices` | **（xl-03x.22 补登 · 主干签）**原版切场景 / 进战斗 / 开菜单 / 进店 / 进结局都是**同步读盘**，没有「载入中」这一种状态，也就没有任何提示 | 素材与场景 JSON 按需异步取，取的这几十毫秒里舞台正中叠一行 `role="status"` 的「正在载入 脚本1… / 商店… / 菜单… / 战斗… / 结局…」；渲染器起不来时同一处写失败原因（`app/App.tsx`） | 异步是浏览器的；不说一声，这段时间就是一块不知道为什么的黑屏。与 `saveload-notices` 同一个理由、同一种画法（DOM overlay，不进画布、不进逐帧比对），那一行只登了存读档面板上的几行，这几行一直没登 —— xl-03x.22 从 web 侧反扫 `role=` 扫出来 | `app/appShop.test.tsx`「正在载入商店…」；场景 / 菜单 / 战斗 / 结局那几行**无单独判据** |
| `bgm-waits-for-gesture` | **（xl-03x.22 补登 · 主干签）**开机就放主题曲：`switchTo("start")` → `readBGM("主题曲.mp3")`，一打开就响 | 浏览器的自动播放策略挡下 `play()` 时，**等页面上第一次 `pointerdown` / `keydown` / `touchstart` 再放**（`audio/bgmPlayer.ts` 的 `arm`）；在那之前没有声音 | 浏览器在用户与页面交互之前不许出声，这是平台策略、页面绕不过去；能做的只是「第一下就接住」（`game/useGame.ts` 让 pump 不等渲染器，就是为了不浪费那第一下）。xl-03x.22 从 web 侧反扫 `'pointerdown'` 扫出来 —— 原版侧台账把 `MusicPlayer` 判成「照做」，看不见这一半 | `audio/bgmPlayer.test.ts`「自动播放被浏览器挡下来时，等一次用户手势再试」；⚠️ **真浏览器里策略挡不挡、第一下接不接得住，没有自动判据**（headless Chrome 实测会挡，见 `bgmPlayer.ts` 注释） |
| `drag-not-grabbed-to-hidden-panel` | **（xl-bwl 补登 · 主干签）**Swing 的 `LightweightDispatcher` 把 `MOUSE_DRAGGED` 也按 grab 派：在一块面板上按下、面板随即被切走，**藏着的那块照样收拖动** | **拖动照当前面板过滤**（`game/useGame.ts` 的 `routeByGrab`：只有松手按 grab 派）。松手、以及拖到宿主之外的那一段（xl-b28 / xl-bwl）都是照 grab 走的，唯独「面板已经被切走」这一种不送 | 四块宿主逐块查过为什么今天看不出来：菜单、存读档见 `game/session.ts` 那两段（悬停贴图下次开菜单头一下移动全刷 / 只记坐标、松手重写）；店换面板只有「返回游戏」一条而它在 `mouseReleased` 里、键也到不了店，按着的时候店不会被切走；战斗那条**走得到**（战斗线程自己结束、玩家还按着），⚠️ 但「那几下拖动留不留得到下一场」是**未验证的推理**，没有量过。四块的理由写在 `routeByGrab` 的头注里 | **暂无会红的判据**：这一行登记的是「不送」，而送不送今天在四块上都看不出后果；战斗那一块要有判据，得先把上面那条未验证的推理量出来 |
| `screen-reader-text` | **（xl-03x.22 补登 · 主干签）**原版一切文字都画进画布，读屏什么都读不到 | 给读屏的文字：对话框里一段视觉上隐藏的整句（`ui/DialogueBox.tsx` 的 `.dialogue-transcript`，外层 `aria-live="polite"`，**一句话出来读屏就念**）、标题按钮的 `aria-label`（开始新游戏 / 读取存档……）、「关于我们」那张图的 `alt` | 无障碍，与 `start-focus-hover` 同一个方向。视觉上一个像素都不变（逐帧比对照样对得上），**只有读屏用户看得到它**，所以它最容易被当成「不算加法」—— 但读屏用户也是玩家。xl-03x.22 从 web 侧反扫 `aria-` / `alt=` 扫出来 | **无判据**：`dialogue-transcript` 在测试里零处引用（xl-03x.22 现数） |

还有一条：**原版自己就不一致。**「承」（读档）走的是三个人的
`intialFromInfo()`，它把 `level` / `hp` / `mp` / `angryValue` / `exp` 逐个从
`roleInfo` 写回去（`ZhangXiaoFan.java:718` / `YuJie.java:749` /
`LuXueQi.java:746`）——那条路是**会**改写队伍的，而「起」一个字段都不动。
所以这里不存在一个"原版对队伍的统一处置"可供照搬，只有两条互不相同的路；
web 端选了其中说得通的那条。这一句也有判据，与上面同一份文件里的
「承」那三条用例（同一个赋值选择器在读档那条路上一抓一个准，才说明它抓得到）。

### 历史遗漏的那一遍人工找（xl-03x.4，2026-09-11）

**找法**：在 `web/src` 与 `web/scripts` 的 `.ts` / `.tsx` 里 grep 两批措辞，再逐条读上下文：
`不复刻|不照抄|不照搬|不抄|登记而不|故意不|有意偏离|不跟原版|没有复刻|未复刻|不复制`（48 行命中）
与 `有意|原版没有|偏离|宁可|分家|与原版不同|跟原版不|和原版不|不跟着|这一层不做|这里不做|没有线程模型|没线程`
（去掉 `src/generated` 与「有意重复 / 有意义」之后 164 行，绝大多数是「两份实现分家」「合计偏离」
那类说法，与复刻无关）；另外把原版 `src/` 里全部 9 处
`new Thread` 逐个对了一遍 web 侧有没有推它。

**读数**：票面预期「至少两处」（菜单那四条线程、存读档自称「同族」的那一条）。现数是
**11 行新登记**，落在 **13 处**代码位置（表里「待签」那十一行；其中「面板动画线程」一行
合了菜单 / 两家店 / 存读档三处，理由相同）。**明显多于预期**，按票面另立了一张票追。

**找到了但没登的**，以及为什么（写下来，免得下一个人以为漏了）：

- **没有行为差别的「没抄」**：`showDrug()` 死代码（`menu/drugPanel.ts`，有判据守零调用者）、
  `CURRENTLIST` 整数表（`menu/equipment.ts`）、`drawValueBar()` 里那三句 `refreshValue()`
  （`menu/render/drawList.ts`，刷新已经在 `drinkDrug` 里）、开机那一帧 `startView` 不推进
  （`start/panelState.ts`，开机时两支都不会触发，`panelState.test.ts` 钉住）。原版做的事 web 端一件没少，只是换了地方做。
- **欠账，不是取舍**（有票、将来要做成与原版一致）：菜单松手落在下一帧时被丢
  （`xl-z4f`）。（菜单「确认离开」的后半段原先也列在这里；xl-03x.12 把它定成禁用，
  并进了上表 `start-exit-disabled` 那一行，不再是欠账。）
- **已知缺口，登在逐帧比对的分区表态里**：字形（`textFont.ts`、`compare/expected.ts`）。
  它们不是「决定不做」，是「做不到逐像素」，那份账有上界守着。

⚠️ **这一遍可能找漏了。** 它是措辞 grep + 人读，也就是这张表原先漏掉一族的同一种办法；
没带上面任何一个措辞的偏离、以及只写在票面或提交信息里而代码里没注释的偏离，都找不到。

### 第二遍：从原版侧出发（xl-03x.20，2026-09-11）

**找法一（判据）：原语台账。** 不从 web 的措辞出发，而从原版 `src/` 里「浏览器没有对应物」的
那一类平台原语出发 —— 线程、睡眠、定时器、退出、随机数、音频、文件 IO、异常捕获、光标、窗口，
十类，正则写在 `web/src/test/originalPrimitives.test.ts` 的 `PRIMITIVES`，**那张正则表就是分母的
定义**。逐处在 `docs/original-primitives.md` 落一个判定（照做 / 已登记 / 欠账 / 仪器 / 未核），
测试双向对撞：扫出来的每一行都得有判定、台账里的每一行号都得真是一处命中。读数写在台账开头。

**找法二（便宜的补充，不是判据）：扫票与提交信息。** 已关票的 close reason、全部票的描述、
全部非合并提交的信息，拿一批「不复刻 / 故意 / 原版没有 / 禁用……」的措辞 grep，再逐条读。
⚠️ **它本身仍是措辞扫描**：当时就没写下来的决定、写下来却没用这批词的决定，它都看不见。
它**不算**把「只写在票面或提交信息里」那一类盖住了。
读数（2026-09-11，词表逐字：`不复刻|不照抄|不照搬|不抄|故意|原版没有|有意偏离|偏离原版|与原版不同|跟原版不|和原版不|不模拟|禁用|不实现|多加了|加了原版`）：
已关票 195 张、有 close reason 的 182 张、命中 28 张；全部票 264 张的描述命中 44 张；
非合并提交 520 个、命中 51 个。命中的逐条读过，新东西只有下面读数里点名的两处。

**顺手验了两条待签行的判据**（xl-03x.4 那十一行判据格原先都没篡改验证过）：
`dialogue-skip-printing` —— 让 `skipPrinting` 一进来就返回，`state/dialogue.test.ts`
「跳过之后的游标与"等它自己打完"逐字段相同」红（1 红 / 3 绿）；`start-focus-hover` ——
`onFocus` 不再 `hover`，`start/StartPanel.test.tsx`「键盘 Tab 过来也换图」红（1 红 / 16 绿）。
其余九行**仍未验**，留给收口那张（读数见下一节）。

**读数**：新登 **4 行**（上表 `random-streams-per-battle-and-shop` / `new-game-rerolls-shop-stock` /
`stage-scales-to-window` / `fail-loud-where-original-swallows`），扩写 **1 行**
（`panel-threads-run-while-hidden` 补进标题那条线程），**直接改成照做 2 处**（页面标题差了「软件」两个字；
舞台上露出系统光标、四块面板两只指针 —— 两处都没人裁过，默认是复刻，一行 CSS / 一个字符串就还上了，
判据 `app/pageTitle.test.ts`、`app/stageCursor.test.ts`）。
哪一种找法找到的：原语台账找到标题线程、随机流、店存货重掷、页面标题、光标、音效 / 背景音乐与
坏档那半个「大声失败」；提交信息找到舞台缩放（理由只在 xl-9bd.1 的提交里）与战斗 NPE 那半个
「大声失败」（xl-rh9.7 的提交里）—— **后两处原语台账结构性地看不见**（缩放在原版侧只是一句
`setResizable(false)`，台账能指到它却说不出 web 做了什么；隐式 NPE 根本不是一处调用）。

⚠️ **这一遍仍然可能找漏了**，而且漏在哪儿是说得出来的：

- **原语清单之外**：键位（`KeyEvent.VK_*`）、隐式 NPE、绘制次序、字形、面板切换的时序 —— 都不在那十类里。
  清单封闭是它比措辞 grep 强的地方，也正是它的边界；
- **web 侧加了原版没有的东西**：原语台账从原版出发，只看得见「原版做了、web 做法不同」，看不见
  「web 多做了一件原版根本没有的事」（例如工具栏、键盘焦点）。这一半要从 web 侧的浏览器 API 反过来扫，
  另立了票 `xl-03x.22`（顺带把键位这一类并进去）；
- **判定写错**：台账写「照做」而其实没照做，扫描器照样绿 —— 它只核引用完整，不核判定；
- **未核**：战斗线程在战斗之外的那一段（`BattlePanel.run()` 开机起、关机停，战斗结束后仍在调
  `launchAttack.check()` / `gameOver.update()` 等）改不改得到下一场的状态，读代码判断不了，
  台账如实记成「未核」，另立了票 `xl-03x.23`（先跑读数再定去留）。

### 第三遍：从 web 侧出发（xl-03x.22，2026-09-12）

**找法（判据）：web 侧浏览器 API 台账。** 第二遍从原版出发，只看得见「原版做了、web 做法不同」；这一遍反过来，
把 `web/src` 生产代码里浏览器平台 API 的每一处调用点现扫出来（事件、键盘、指针、定时、时钟、存储、地址、全屏、视口、
全局对象、音频、图片、DOM 元素、无障碍属性、CSS 伪类，外加今天应当零命中的「生命周期」一类；正则写在
`web/src/test/webPrimitives.test.ts` 的 `PRIMITIVES`），逐处在 `docs/web-primitives.md` 落一个判定：对应（指到原版哪一行）/
已登记 / 工程 / 未核。同一个文件里还有一张**键位表**：原版 `KeyEvent.VK_*` 与 `isXxxDown()` 现扫一边、web 认的键现读一边，
每个键恰好落一行 —— 第二遍的原语清单没有键位。

**读数**写在台账开头那一句（由测试核对，这里不抄 —— 抄过来的数没人守，合并时就过期）。**新登 5 行**（上表 `shift-also-runs` /
`toolbar-under-stage` / `loading-notices` / `bgm-waits-for-gesture` / `screen-reader-text`，都标着「待签」）：
五样都是玩家看得到（或读屏用户听得到）的加法，理由原本都写在代码注释或提交里，**一样都没进过这张表**。
其中 `shift-also-runs` 是键位表找到的（原版读的修饰键只有 `isControlDown`）；`bgm-waits-for-gesture` 在原版侧台账里
被判成「照做」（`MusicPlayer` 那一行）—— 那一行说的是「只有一个播放对象」，看不见「第一声要等一次手势」。

**顺带找到一个缺陷，不是例外**：标题页按钮在真浏览器里**键盘按不动**。`game/useGame.ts` 在 `window` 上的键盘监听对回车 /
空格一律 `preventDefault()`，吞掉了按钮的默认激活 —— 真 Chrome 实测回车、空格各一次 click 0 次，对照 `.click()` 1 次。
而 `start-button-hitbox-dom` 那一行的理由里算着「回车按得动」。jsdom 不执行默认动作，所以现有测试看不出来。归 `xl-fqm`。

**`xl-fqm` 已修（2026-09-12）**：窗口级监听加一道闸门 —— `keyReceiver(panel)` 为 `null` 的面板上**既不收键也不拦**
（会话那一侧本来就对这些面板喂 `NO_KEYS`）。判据不数 `click` 而数 `defaultPrevented`，因为 jsdom 不执行默认动作、
数 click 在这里恒假：`app/App.test.tsx`（标题页聚焦「开始新游戏」，回车 / 空格的 keydown+keyup 都没被拦）、
`game/useGame.test.tsx`（场景里照旧被拦）。所以下面 `start-button-hitbox-dom` 那一行里的「回车按得动」**现在才是真的**；
在此之前它是一句**从实现推出来、没人在真浏览器里量过**的话，而这张表的其余理由里可能还躺着同一种句子。

**篡改读数**（每条 cp 备份 → 断言恰好 1 处 → 只跑 `webPrimitives.test.ts` → cp 还原 → cmp）：漏登一行 2 红、过期行号 3 红、
错键（原版 / web 各一）各 1 红、死正则（有命中的类）4 红、错引原版行 1 红、源码多认一个键 3 红、源码多一处 `localStorage`
4 红、一边空着的键行判「照做」1 红。**死正则（absent 类的一个分支）头一轮是绿的** —— 一句样例只守得住整条正则，
写坏的那一支被别的分支顶替了；改成「每条正则按顶层 `|` 拆开、每一支都要有代码或样例见证」之后 1 红。

⚠️ **这一遍结构性地看不见的**：

- **不经过任何浏览器 API 的加法。** 状态层里多一条纯函数分支（例如「跳过逐字打印」在 `state/dialogue.ts` 的那一半）
  一个平台 API 都不调，这里只看得见它挂在键盘上的那一头；CSS 只收伪类，**属性**不在分母里 —— 颜色、布局、`pointer-events`、
  `cursor`（`cursor: none` 归原版侧台账的「光标」，工具栏上的 `cursor: pointer` 这里看不见）；
- **`web/src` 之外**：`web/index.html`（页面标题归原版侧台账）、`web/scripts`（烘焙器，玩家看不见）；
- **正则之外的写法**：键位表只认 `keyboard.ts` 的两张映射表、`event.key` / `event.code` 与字面量的比较、`event` / `raw`
  上的修饰键 —— 换个变量名读 `.key`，键位表看不见，只剩站点表里「键盘」「事件」两类兜住那个监听器本身；
- **判定写错**：写「对应」而其实顺手多做了一件事，扫描器照样绿。上面那个键盘按不动，就是「对应」那一行里读出来的；
- **行为本身对不对**：台账说「这一处是什么」，不说「它做得对不对」—— 键盘按不动是去真浏览器里跑才知道的。

### 收口签字与篡改读数（xl-03x.19，2026-09-11）

十五行一并签掉。每条篡改：`cp` 备份 → python 断言恰好命中 1 处再替换 → 只跑那一行判据格点名的测试文件 → `cp` 还原 → `cmp` 一致。

- `title-bgm-sleep`：篡改 `currentBgm` 在标题上答 `null`（等于「这一刻还没交主题曲」） → `game/session.test.ts` 3 红 / 16 绿（含「起手就停在标题上」）
- `narratage-sleeps`：篡改 句末模拟那半秒：之后 10 个字拍（10 × 50 ms）什么都不做 → `state/traceReplay.test.ts` 10 红 / 209 绿。对照两条都是绿（219/219）：只插计数器从不置位、置一个没人读的全局量 —— 排除「篡改本身没改行为」
- `map-source-overflow-throws`：篡改 `checkMapSize` 不再抛 → `scene/mapSize.test.ts` 1 红 / 4 绿
- `stage-scales-to-window`：篡改 缩放恒为 1 → `stage/computeStageScale.test.ts` 9 红 / 18 绿
- `fail-loud-where-original-swallows`：篡改 ① 音效默认 resolve 查不到时吞成 `null`；② 坏档把仓库置 `ready` 而不是 `failed` → ① `audio/sfxPlayer.test.ts` 1 红 / 17 绿；② `save/store.test.ts` + `game/saveloadSession.test.ts` 3 红 / 24 绿。**战斗那几处 NPE 仍没有逐条篡改**
- `start-exit-disabled`：篡改 标题「结」去掉 `disabledReason` → `start/StartPanel.test.tsx` 1 红 / 16 绿（天书页那一半由 xl-03x.12 验过：T1 红 6 条）
- `random-streams-per-battle-and-shop`：篡改 **负结果对照**：商店种子钉成常数 0 → `web/src/shop` + `web/src/game` 397 条**全绿** —— 证实这一行自己写的「现摇种子这一半暂无会红的判据」
- `dialogue-skip-printing` / `start-focus-hover`：xl-03x.20 验过，各 1 红（见上一节）
- `saveload-notices`：本票**没有**单独篡改：它的判据格指的是存储状态那一半，读数与上面 `fail-loud` ② 是同一处篡改、同一组红；DOM 上那几行字本身没有判据
- `panel-threads-run-while-hidden` / `end-not-kept-across-new-game` / `end-thread-not-duplicated` / `select-under-dialogue-overlay` / `new-game-rerolls-shop-stock`：**暂无会红的判据**，无从篡改。签的是取舍本身；它们各自写着的「未量过 / 读代码，未跑」原句照留

### 第三遍五行的签字与篡改读数（主干，2026-09-12）

`shift-also-runs` / `toolbar-under-stage` / `loading-notices` / `bgm-waits-for-gesture` /
`screen-reader-text` 五行一并签掉。判据格点名的测试**逐个现查在不在**（在），再照
xl-03x.19 的做法篡改：`cp` 备份 → python 断言恰好命中 1 处再替换 → 只跑那一行判据格点名的
测试文件 → `cp` 还原 → `cmp` 一致。

- `shift-also-runs`：篡改 `isRunModifier` 只认 `ctrlKey`（等于「照原版，只有 Ctrl 算跑」）
  → `game/keyboard.test.ts` + `game/useGame.test.tsx` **红 2 / 绿 18**，两份判据各红一条
- `toolbar-under-stage`：两处各篡改一次 —— ① `.toolbar-hint` 改个类名
  → `app/appTitle.test.tsx` **红 1 / 绿 10**；② `DEFAULT_SCALING_MODE` 由 `sharp` 改成 `smooth`
  → `app/App.test.tsx` **红 1 / 绿 10**。**提示字逐面板的内容仍无判据**，原句照留
- `loading-notices`：篡改 「正在载入商店…」那行提示清空 → `app/appShop.test.tsx` **红 2 / 绿 8**。
  场景 / 菜单 / 战斗 / 结局那四行仍无单独判据，原句照留
- `bgm-waits-for-gesture`：篡改 被挡下之后不再给 `GESTURES` 挂监听（等于「挡下就算了」）
  → `audio/bgmPlayer.test.ts` **红 1 / 绿 36**。⚠️ 真浏览器里策略挡不挡、第一下接不接得住，
  仍然没有自动判据 —— 签的是「挡下来之后等一次手势」这一段，不是「在真 Chrome 上放得出声」
- `screen-reader-text`：**无从篡改，签的是取舍本身**。那一行写着「`dialogue-transcript` 在测试里
  零处引用」，主干现数复核：`web/src` 里引用它的只有 `index.css` 与 `ui/DialogueBox.tsx`，
  测试 0 处 —— 读屏那段文字整个没有会红的判据，如实留着

⚠️ 签字不等于这五样做得对：`bgm-waits-for-gesture` 与 `screen-reader-text` 各有一半只在 jsdom 里
成立或根本没判据；同一遍反扫顺带找到的 `xl-fqm`（标题页按钮在真浏览器里键盘按不动）正是这类
盲区的现成例子。

缺陷本身登记在 `xl-lly`。**这张表是登记不是分母**（见 `docs/agents/dispatch.md`
纪律 3）：它必须由人来加，自动扫出来的"例外清单"等于让被守的东西自己签字。
