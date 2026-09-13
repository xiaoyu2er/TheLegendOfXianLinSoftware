# 原版平台原语逐处台账

原版 `src/` 里「浏览器没有对应物」的那一类平台原语，每一处调用点在 web 侧落成什么（xl-03x.20）。

读数（2026-09-13）：共 151 行命中、53 个单元（照做 87 · 已登记 55 · 欠账 4 · 仪器 5 · 未核 0）

**分母不在这里写**：哪几类算「这一类原语」，是 `web/src/test/originalPrimitives.test.ts` 里
`PRIMITIVES` 那张正则表定的（线程 / 睡眠 / 定时器 / 退出 / 随机数 / 音频 / 文件 / 捕获 / 光标 / 窗口），
扫 `src/**/*.java`（按 GBK 解码，整行注释跳过）。上面那句读数由测试核对，改了台账或分母就要跟着改。

**判定这一列要人写**（dispatch.md 纪律 3：这是登记，不是分母）。五种写法：

- `照做` —— web 侧复刻了；证据指到实现与守它的判据；
- `已登记 ADR-0001#<键>` —— 故意不同，ADR-0001 例外表有一行说了；
- `欠账 <票号>` —— 不同、没人裁成例外、有一张开着的票要把它做成一样；
- `仪器` —— 迁移时为导真值加进 `src/tools/` 的代码，不是原版行为；
- `未核` —— 读了，没读明白，也没跑。如实记下，不塞进最像的那一格。

与「照做了 / 已登记 / 两样都没有」三选一的对应：`照做` 与 `已登记` 就是前两种；
`欠账` 是**两样都没有**（遗漏）里已经有票追着的那些；`仪器` 不在分母里（不是原版行为）；
`未核` 是**可能属于两样都没有**、还说不清的那些。**遗漏 = 欠账 + 未核里查实的那部分。**
这一遍找到的「两样都没有」都已经补登或改成照做，所以台账里不留一条没归属的遗漏。

⚠️ 扫描器只核**引用完整**（每一处都有归属、行号真是命中、键与票真存在），**不核判定对不对**。
「照做」是不是真照做了，是证据那一格指过去的判据的事；其中写着「无单独判据」的，就是没有。

⚠️ 这张台账看不见的，见 ADR-0001「第二遍：从原版侧出发」那一节。

## 台账

| 调用点 | 原语 | 判定 | 证据 |
|---|---|---|---|
| `src/battle/BattlePanel.java:17,157` | 线程 | 欠账 xl-sn2 | 战斗里：`battle/loop.ts` 100 ms 一拍，`game/session.ts` 的 `advanceBattle`，`battle/battleTrace.test.ts` 逐步对真值。**战斗之外**：原版这条线程构造时起、关机停，web 只在 `panel === 'battle'` 时推。xl-03x.23 跑了读数（`tools/src/devtools/BattleIdleProbe.java`）：六种收场（五份入库的战斗剧本，外加 `battle-victory` 三人都压到 10 级的变体 —— 那份变体没入库，复现步骤见 xl-sn2）各空推 200 拍，动的只有帧相位（`mouse.code` / `instruct.code`）与 `victoryReminder` / `stateBlank` 自己的计数，英雄、`battleState`、钱、背包一个字段都不动；六种都接着在同一块面板上开 `battle-script3` 推 150 拍，空推 200 拍与不空推逐拍只差帧相位 —— 这部分与 `ADR-0001#panel-threads-run-while-hidden` 同族。**唯一的例外**：没升级的胜利在 `timeCode==15` 回地图，之后 `timeCode` 照加，空推第 40 拍到 55，`VictoryReminder.java:435` 又 `switchTo("scene")` 一次；web 在出口那一拍丢掉战斗世界，这一次不会发生。xl-sn2 把后果跑了出来（`BattleIdleProbe rescene`，同一个 JVM 里立起真的场景与菜单面板）：回地图后第 20 拍进菜单，第 40 拍被拽回场景、场景曲第二次 `play`；一直待在场景，第 40 拍场景曲第二次 `play`；升级那一支对照留在菜单、只 `play` 一次；4 秒内开了新一场则 `timeCode` 归 0、第二次不发生。复刻还是登记，交主干裁 —— 裁定之后这一格跟着改 |
| `src/battle/BattlePanel.java:470,471` | 睡眠 / 捕获 | 照做 | `battle/loop.ts` 的 `BATTLE_TICK_MS = 100`（ADR-0003）；try 里只有 sleep，吞掉的只是 `InterruptedException` |
| `src/battle/BattlePanel.java:304,306,308` | 光标 | 照做 | 透明光标 + 自绘鼠标：`index.css` 的 `.stage { cursor: none }`（xl-03x.20 补）+ `battle/render/assets.ts` 的鼠标图；`app/stageCursor.test.ts` |
| `src/battle/BattleState.java:85` | 随机数 | 已登记 `ADR-0001#random-streams-per-battle-and-shop` | 算式照抄：`battle/step.ts` 的 `nextDouble()*100`；`battle/battleTrace.test.ts` |
| `src/battle/Enemy.java:148,176` | 随机数 | 已登记 `ADR-0001#random-streams-per-battle-and-shop` | 算式照抄（六折写成 `Math.trunc(hurt*0.6)`）；`battle/battleTrace.test.ts` |
| `src/battle/EnemyAI.java:15,27` | 随机数 | 已登记 `ADR-0001#random-streams-per-battle-and-shop` | 算式照抄；`battle/battleTrace.test.ts` |
| `src/battle/LuXueQi.java:154,213,219,231` | 随机数 | 已登记 `ADR-0001#random-streams-per-battle-and-shop` | 算式照抄（普攻 / 劈风追月的类型 / 技能伤害）；`battle/battleTrace.test.ts` |
| `src/battle/Pet.java:50` | 随机数 | 已登记 `ADR-0001#random-streams-per-battle-and-shop` | 算式照抄；`battle/battleTrace.test.ts` |
| `src/battle/YuJie.java:153,187,220` | 随机数 | 已登记 `ADR-0001#random-streams-per-battle-and-shop` | 算式照抄（普攻 / 治疗 / 技能伤害）；`battle/battleTrace.test.ts` |
| `src/battle/ZhangXiaoFan.java:153,198` | 随机数 | 已登记 `ADR-0001#random-streams-per-battle-and-shop` | 算式照抄；`battle/battleTrace.test.ts` |
| `src/main/GameLauncher.java:68,69,74` | 窗口 | 照做 | 标题：`web/index.html` 的 `<title>`（xl-03x.20 把「仙林软件奇侠传」改回原版的「仙林奇侠传」），`app/pageTitle.test.ts` 从 GBK 源码现读比对；关窗口 = 关标签页；`setVisible` 无可比 |
| `src/main/GameLauncher.java:71,170` | 窗口 / 光标 | 已登记 `ADR-0001#stage-scales-to-window` | `:71` 不许改尺寸、`:170` 是死代码 `setMiddle()` 里取屏幕尺寸居中；web 缩放 + 居中（`stage/computeStageScale.ts`） |
| `src/main/GameLauncher.java:149,150` | 睡眠 / 捕获 | 已登记 `ADR-0001#title-bgm-sleep` | `game/session.ts` 的 `createSession`；`game/session.test.ts`「起手就停在标题上」 |
| `src/media/MusicPlayer.java:7,9,20,48,50,60,66,67,68,88,90,100,106,107,108,150,180` | 音频 / 文件 / 捕获 | 照做 | 平台搬家：背景音乐 `audio/bgmPlayer.ts`（循环、只一个播放对象）、音效 `audio/sfxPlayer.ts`（后一声顶掉前一声）；`audio/bgmPlayer.test.ts`、`audio/sfxPlayer.test.ts`。`:150` / `:180` 是逐字节推流线程里的 catch，web 没有推流这一层 |
| `src/media/MusicPlayer.java:41,42` | 睡眠 / 捕获 | 照做 | 换曲子前忙等上一条播放线程收工，免得两条抢一个设备；web 只有一个播放对象、换 `src`，结构上不会重叠（`audio/bgmPlayer.test.ts`「从头到尾只有一个播放对象」）。少的只是 ≤ 几十毫秒的等待 |
| `src/media/MusicPlayer.java:77,117` | 捕获 | 已登记 `ADR-0001#fail-loud-where-original-swallows` | 找不到文件：原版打栈静音；web 名单外的 BGM / 查不到的音效当场抛 |
| `src/menu/FatherPanel.java:10,59,120,121` | 线程 / 睡眠 / 捕获 | 已登记 `ADR-0001#panel-threads-run-while-hidden` | `game/session.ts` 只在菜单显示着时推 |
| `src/menu/FuncButtons.java:379` | 退出 | 已登记 `ADR-0001#start-exit-disabled` | `menu/funcButtons.ts` 的 `FUNC_DISABLED` |
| `src/menu/MenuPanel.java:84,87,88,90` | 光标 | 照做 | `.stage { cursor: none }` + `menu/render/assets.ts` 的鼠标图；`app/stageCursor.test.ts` |
| `src/scene/Dialogue.java:8,60,61,62,63,64,65` | 定时器 | 照做 | `state/timer.ts`（Swing 的 start / restart 语义）+ `state/dialogue.ts` 六个周期 20 / 20 / 30 / 500 / 10 / 10；`state/traceReplay.test.ts` 逐 tick 对真值（周期常量无单独判据） |
| `src/scene/EquipmentEvent.java:10,18,19` | 定时器 | 照做 | `state/treasure.ts` 50 / 100；`state/treasure.test.ts`「两个定时器的间隔」 |
| `src/scene/FightEvent.java:49` | 随机数 | 照做 | `state/fight.ts`，生产里就是 `Math.random`（两边都无种子）；`game/session.test.ts`「迷宫1：走满 30 格起战斗」 |
| `src/scene/NPC.java:8,30,31` | 定时器 | 照做 | `state/npc.ts` 200 / 200；`state/traceReplay.test.ts` |
| `src/scene/Narratage.java:7,16,17` | 定时器 | 照做 | `state/narratage.ts` 180 / 50；`state/traceReplay.test.ts` |
| `src/scene/Narratage.java:109,110,127,128` | 睡眠 / 捕获 | 已登记 `ADR-0001#narratage-sleeps` | `state/narratage.ts` 头注 |
| `src/scene/Role.java:9,39,40` | 定时器 | 照做 | `state/role.ts` 80 / 80；`state/traceReplay.test.ts` |
| `src/scene/ScenePanel.java:14,276,277` | 线程 / 睡眠 / 捕获 | 照做 | `state/step.ts` 的 `TICK_MS = 10`，面板不显示也推（与原版一样线程不停）；`state/loop.test.ts`、`game/menuSession.test.ts`「那条线程不停」；try 里只有 sleep |
| `src/scene/ScenePanel.java:354,357,358,360` | 光标 | 照做 | 透明光标、场景里不画鼠标：`.stage { cursor: none }`；`app/stageCursor.test.ts` |
| `src/scene/SelectEvent.java:12,55,56,57` | 定时器 | 照做 | `state/select.ts` 30 / 40 / 50；`state/traceReplay.test.ts` |
| `src/scene/SelectEvent.java:384,400` | 随机数 | 照做 | `state/select.ts`，生产里是 `Math.random`；`state/select.test.ts`「500 + (int)(500 * random)」 |
| `src/scene/TreasureBox.java:57` | 随机数 | 照做 | `state/treasure.ts`，生产里是 `Math.random`；`state/treasure.test.ts`「开箱给几个、提示语怎么拼」 |
| `src/shop/EquipmentShopPanel.java:140,149,150` | 线程 / 睡眠 / 捕获 | 已登记 `ADR-0001#panel-threads-run-while-hidden` | `game/useGame.ts` 的 `shopSinceRef` |
| `src/shop/EquipmentShopPanel.java:163,166,169,172,175,178` | 随机数 | 已登记 `ADR-0001#random-streams-per-battle-and-shop` | 算式照抄 `scaledInt(10)`，次序从六段 `readEquipment` 解出；`shop/world.test.ts`。存货活不过「起」另见 `new-game-rerolls-shop-stock` |
| `src/shop/EquipmentShopPanel.java:242,245,246,248` | 光标 | 照做 | `.stage { cursor: none }` + `shop/render/assets.ts` 的鼠标图；`app/stageCursor.test.ts` |
| `src/shop/ShopPanel.java:102,110,111` | 线程 / 睡眠 / 捕获 | 已登记 `ADR-0001#panel-threads-run-while-hidden` | `game/useGame.ts` 的 `shopSinceRef`（帧号从进门那一刻数起）；`shop/render/animation.test.ts`「八格一圈、每格 120ms」 |
| `src/shop/ShopPanel.java:125` | 随机数 | 已登记 `ADR-0001#random-streams-per-battle-and-shop` | 算式照抄 `scaledInt(10)`；`shop/world.test.ts`「62 次掷骰共用一条流，先药店后装备店」 |
| `src/shop/ShopPanel.java:166,169,170,172` | 光标 | 照做 | `.stage { cursor: none }` + `shop/render/assets.ts` 的鼠标图；`app/stageCursor.test.ts` |
| `src/shop/ShopReader.java:19,37,45,67` | 文件 / 捕获 | 照做 | 平台搬家：数据抄进代码（`battle/drugs.ts`、`shop/world.ts`）、介绍图进烘焙；`battle/drugs.test.ts`「逐行逐列相等」。原版的失败路径（缺文件 → 空表）在 web 运行时走不到，数据坏了在测试或烘焙时红 |
| `src/start/EndPanel.java:8,95,97` | 线程 / 睡眠 / 捕获 | 照做 | `end/world.ts` 100 ms，进过结局之后每拍都推；`end/endTrace.test.ts` |
| `src/start/EndPanel.java:53` | 线程 | 已登记 `ADR-0001#end-thread-not-duplicated` | 每进一次结局多起一条 |
| `src/start/LoadAndSavePanel.java:23` | 线程 | 已登记 `ADR-0001#load-extra-scene-loop` | `game/loadResidue.test.ts`「读档之后场景不是双倍速」 |
| `src/start/LoadAndSavePanel.java:130,134,135` | 线程 / 睡眠 / 捕获 | 已登记 `ADR-0001#panel-threads-run-while-hidden` | `saveload/world.ts` |
| `src/start/Loader.java:72,82` | 文件 / 捕获 | 照做 | 缺档 → 空槽：`save/browserStore.ts`；`save/store.test.ts`「空槽那一支」。坏档那一支不走这个 catch，见 `fail-loud-where-original-swallows` |
| `src/start/Mouse.java:22,25,26,28` | 光标 | 照做 | 标题与存读档：`.start-panel` / `.stage` 的 `cursor: none`；`app/stageCursor.test.ts` |
| `src/start/Recorder.java:52,83` | 文件 / 捕获 | 已登记 `ADR-0001#saveload-notices` | 写失败吞掉、内存状态照旧 —— 这一半照做（`save/store.test.ts`「落盘失败：快照照样是新的」）；多出来的那行提示字归这一行登记 |
| `src/start/StartPanel.java:149,153,154` | 线程 / 睡眠 / 捕获 | 已登记 `ADR-0001#panel-threads-run-while-hidden` | 离开标题就卸载、计时器停；状态由 `App.tsx` 留着，回来接着那一份（`start/useStartPanel.ts`，xl-6zf）—— xl-03x.20 补进那一行 |
| `src/start/StartPanel.java:234` | 退出 | 已登记 `ADR-0001#start-exit-disabled` | `start/buttons.ts` 的 `START_BUTTON_WIRING.end` |
| `src/start/StartPanel.java:342` | 线程 | 已登记 `ADR-0001#load-extra-scene-loop` | 回标题再「起」多一条场景循环，同一行登记 |
| `src/tools/Clock.java:67` | 睡眠 | 仪器 | `tools.Clock`（87cf64cb，2026-09-05），factor 1.0 时等于 `Thread.sleep` |
| `src/tools/MusicLog.java:33,42,49` | 线程 | 仪器 | 音效调用记录（`fix(diag)`，2026-09-06），默认关闭 |
| `src/tools/Reader.java:84,91` | 捕获 | 欠账 xl-1dv.13 | 构造函数整场 catch：脚本文件打不开就吞掉，场景带着空的地图网格照进（之后大概率 NPE，读源码推断，未实测）。走得到它的是那 6 个占位名出口；web 侧怎么表示「没有目标的出口」归那张票 |
| `src/tools/Reader.java:270` | 捕获 | 照做 | `switchReader` 吞掉 NPC 段的坏数据、场景照进：`state/npc.ts`；`state/npc.test.ts`「坏数据那几个场景照建」+ `npc-defect` 真值（xl-03x.13） |
| `src/tools/Reader.java:300` | 线程 | 仪器 | 缺图告警去重（353b12ee，`fix(diag)`） |
