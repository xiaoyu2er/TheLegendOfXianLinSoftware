# 玩家走得通哪一段

这是这个项目唯一一份**玩家视角的全貌**：原版里玩家能做的每一件事，Web 端今天做不做得到。
每个里程碑收口时**现查着重写**，完工判据拿它当分母。

**现查：2026-09-11，xl-03x.2（closed）。共 61 行（能 44 · 不能 8 · 能但不对 9）。**（xl-19z（closed）把「战斗 听战斗背景音乐」从「能，但不对」改成「能」；xl-03x.15（closed）把「场景 看旁白」从「能，但不对」改成「能」；xl-03x.13（closed）把「走进仙二205」从「不能」改成「能」。⚠️ 这两处与状态列一样，是主干在合并时按当时的现状改的，**不是重新现查**——收口那一轮要整表再查一遍。）
（这句读数由 `web/src/mainline/test/playerCoverage.test.ts` 对着下面那张表现数核对，改了表不改这句会红。）

## 这张表怎么读、怎么守

- **分母是「原版里玩家能做的一件事」**，由原版定死，从 `src/` 现读：`GameLauncher` 的面板切换与键盘分发、
  `StartPanel` 五颗按钮、`ScenePanel.keyPressed` / `step` 与 `scene/*Event`、菜单四页 + 天书
  （`FuncButtons`）、`LoadAndSavePanel`、两家店、战斗 `Command` / `SkillMenu` / `DrugMenu` /
  `EnemySlector` / `Check` / `GameOver`、`media/MusicPlayer`。**不是票数，也不从票据系统或上一版转抄。**
- 第二列三种判定：`能` · `**不能**` · `**能，但不对**`（做得到，但与原版不一致）。「不能 / 能，但不对」
  的行必须在第四列指向至少一张**还开着**的票。
- **「走主线碰不碰得到」用可达闭包，不用链长**（`web/src/mainline/test/chain.ts`，win32 语义）：
  **链上** = 主线链上某本脚本就有这一类段；**仅闭包** = 不在链上、挂在链上各本的出口上，玩家随时拐得进去；
  **随时** = 菜单 / 标题 / 存读档，不挂在哪本脚本上。
- 依据列的标法：**实跑** = 本票现查时实际跑过（测试条数是那一次的读数）；**读代码** = 没跑过，是从源码读出来的。只列源码行号 / 剧本名、没有这两个字的：源码行号是读代码，剧本名取自 `web/src/compare/expected.ts` 的表态，本票**没有重跑逐帧比对**。
- **判据只守引用、不守内容**：表里每个票号后面写着它的状态，判据拿它们对着入库的票据快照
  `tools/issue-snapshot/issues.json` 撞（票号存在、状态一致、「不能 / 不对」有开着的票认领、上面那句读数与表对得上）。
  「能不能做」是人现查着写的，**判据一个字都不核，也绝对不许改成自动生成** —— 自动扫出来的表等于让被守的东西自己签字。
- **快照不是 `.beads/issues.jsonl`**：那是 bd 的被动导出，现查时是过期的（2026-09-11 开工时读数：它 125 条、open 25；活库 251 条、非 closed 84 —— 读数，不是规格）。
  快照由 `tools/export-issues.sh` 从活库导出，`tools/export-issues.sh --check`（或重导后 `git diff tools/issue-snapshot`）为空才算快照是活库现在的样子。
  改完表的流程：`tools/export-issues.sh` → `cd web && pnpm exec vitest run src/mainline/test/playerCoverage.test.ts`。

### 可达闭包读数（实跑，`chain.ts` 现算）

全库 96 本 · 链 45 本 / 44 跳（出口 22 / 战斗 8 / 走自由场景 14），不断、走到结局 · 闭包 93 本 · 够不着 3 本
（剧情1 / 大迷宫1 / 迷宫1）。对照 posix 语义：链断在第 36 跳（脚本32），闭包 84 本 —— Web 按 win32 解析文件名，
见 ADR-0001 例外表第六行。

各类段落落在哪（数据层真值 `tools/ground-truth/*.json` 里对应字段非空的本数）：对话 链上 43 · 旁白 链上 7 ·
剧情战 链上 11（其中 8 本推剧情）· 随机遭遇 链上 3 · 宝箱 链上 3 · 结局 `$` 链上 1（脚本41）·
选择战 / 药店 / 装备店 仅闭包各 2 · 答题 仅闭包 10。

## 对照表

| 玩家能做的事 | Web 能不能做 | 走主线碰不碰得到 | 欠的那部分归 | 依据（现查） |
|---|---|---|---|---|
| **标题** 开机进标题、放主题曲 | 能 | 随时 | — | `GameLauncher.java:76,144-155`；实跑 `appTitle.test.tsx` 4/4 |
| 标题 悬停换图、高亮转；自绘鼠标 8 帧、云飘 | 能 | 随时 | 没有逐帧比对：xl-whk（open） | 实跑 `StartPanel.test.tsx` 17/17、`animation.test.ts` 14/14；标题页没有驱动器 |
| 标题 点「起」：卷轴展开、载入 30 拍、进脚本1 | 能（队伍回出厂是 ADR-0001 登记过的例外） | 随时 | 重开把结局线程一起丢掉（跨面板）：xl-eqo（open） | `StartPanel.java:220-222,335-344`；实跑 `StartPanel.test.tsx`「卷轴放完再等 30 拍」 |
| 标题 点「承」：进读档面板 | 能 | 随时 | 缩略图缩放未拟合：xl-cpo（open） | 剧本 `saveload-start`（gap：缩略图 + 字形） |
| 标题 点「转」：「关于我们」逐段揭开，点「回」收起 | 能 | 随时 | 没有逐帧比对：xl-whk（open） | `StartPanel.java:228-241,296-328`；实跑 `panelState.test.ts` 28/28 |
| 标题 点「结」：退出进程 | **不能**：浏览器无对应物。现状是禁用按钮 + title（xl-u23（closed）的裁定），与 xl-03x.12（open）「画出来、点了什么都不发生」口径冲突，**待主干裁** | 随时 | xl-03x.12（open） | `StartPanel.java:233-234`；`web/src/start/buttons.ts` 的 `START_BUTTON_WIRING.end` |
| **存读档** 从天书进存档：点槽直接写盘、不问覆盖，当场重读三个槽的摘要 | 能（不问覆盖、拖出去松手也触发、监听器越挂越多、头像只置不清 —— 缺陷照抄） | 随时 | 原版缺陷登记：xl-1dv.23（open）、xl-1dv.25（open）、xl-1dv.24（open）、xl-1dv.31（open） | 剧本 `saveload-menu`；实跑 `saveloadTrace.test.ts` 23/23、`step.test.ts` 8/8 |
| 存读档 读档：点非空槽，读档并切到场景 | 能 | 随时 | 原版读档多起一条场景循环，不复刻（ADR-0001 已登记）：xl-1dv.28（open） | 剧本 `load-slot0/1/2`；实跑 `loadSession.test.ts` 11/11 |
| 存读档 读档时点空槽：什么都不发生 | 能 | 随时 | — | `LoadAndSavePanel.java:199`；剧本 `saveload-start` 第 2 步 |
| 存读档 按 Esc 回到来处 | **能，但不对**：回标题时标题页状态被重置（原版卷轴停在展开那一帧）、主题曲不从头放 | 随时 | xl-6zf（open） | `LoadAndSavePanel.java:295-303`；读代码：`App.tsx` 离开标题即卸载 `<StartPanel>`，状态在组件内 `useRef` |
| **结局** 字幕滚动、过场画轮放、播完定格 | 能 | 链上（链尾 脚本41） | — | 剧本 `end-credits` 表态 match；实跑 `endTrace.test.ts` 21/21 |
| 结局 按 Esc：被场景当成开菜单，结局被切走 | 能（照复刻，M7 主干裁定） | 链上 | — | `GameLauncher.java:161-164,186-191`；剧本 `end-credits` 末 3 步 |
| **场景** 方向键走、Ctrl 跑、碰撞 | 能 | 链上 | — | `ScenePanel.java:187-196`；剧本 `dorm-walk` / `bigmap-walk`；实跑 `traceReplay.test.ts` 208/208 |
| 场景 看旁白（逐字、换背景） | 能（背景第 599 行的取整账已还清，旁白背景逐像素相等） | 链上（7 本） | xl-03x.15（closed）、xl-t0h（open） | `Narratage.java:48`；剧本 `dorm-intro` / `milestone` 硬比区含旁白背景（缺口区只剩字形）；`narratageLayout.test.ts` 对黄金数据 |
| 场景 看对话（自动 / 位置 / 找 NPC 推主线）、空格翻页 | 能（另多了回车跳过吐字，验收要求加的） | 链上（43 本） | — | `DialogueEvent.java:30-146`；剧本 `dorm-intro` / `milestone`；实跑 `dialogue.test.ts` |
| 场景 NPC 闲聊；NPC 走动、靠近就停 | 能 | 链上 | — | `NPCEvent.java:17-133`；剧本 `bigmap-walk`；实跑 `npc.test.ts` 7/7 |
| 场景 走出口换图（三条分支） | 能（按 win32 解析文件名，ADR-0001 第六行） | 链上 | 原版在 posix 上断链这件事本身：xl-1dv.11（open） | `ExitEvent.java:30-74`；实跑 `handoff.test.ts` 46/46、`doors.test.ts` 17/17 |
| 场景 踩到占位名或缺文件的出口 | **能，但不对**：原版吞 `FileNotFoundException` 得一个全空的场景、首帧 `paint` 抛空指针；Web 在进场景时硬抛 —— 失败的样子不同 | 仅闭包（缺文件那处在剧情1，够不着） | xl-1dv.12（open）、xl-1dv.13（open） | `Reader.java:84-95`；实跑：原版探针（`initiation` 成功、`OtherEvent.addMap` 空指针）；`step.ts` 进场景那一支 |
| 场景 开宝箱 | 能 | 链上（3 本：脚本6 / 10 / 20） | — | `TreasureBox.java:42-62`；剧本 `maze-treasure`；实跑 `treasure.test.ts` 13/13 |
| 场景 随机遭遇（计步 30 或 50 格） | 能 | 链上（3 本） | — | `FightEvent.java:48-51,110-121`；实跑 `fight.test.ts` 8/8、`session.test.ts`（迷宫1 真走 30 格）；没有 scene 行为真值 |
| 场景 对话里 `@` 触发剧情战、打推剧情的 boss 后剧情推进 | 能 | 链上（11 本，8 本推剧情） | — | `FightEvent.java:38-46,100-104`；实跑 `session.test.ts` 16/16、`handoff.test.ts` 8 个战斗跳 |
| 场景 选择框 → 约战 | 能 | 仅闭包（2 本） | — | `SelectEvent.java:191-202`；剧本 `battle-door` |
| 场景 选择框 → 药店 | 能 | 仅闭包（2 本） | — | `SelectEvent.java:178-190`；剧本 `shop-door`；实跑 `select.test.ts` 11/11 |
| 场景 选择框 → 装备店 | 能 | 仅闭包（2 本） | — | `SelectEvent.java:185-190`；剧本 `equipshop-door` |
| 场景 答题（答对加钱、答错扣钱、答过的记住） | 能 | 仅闭包（10 本；剧情1 也有但够不着） | —（xl-03x.3（closed）已还：取图页与会话层共用记账，金币数值由账本逐帧对撞守着；像素上只剩字形） | `SelectEvent.java:203-216,371-421`；剧本 `question-answer` / `question-memory` |
| 场景 走进「仙二205」 | 能（xl-03x.13（closed）：原版吞掉异常照进 —— 前 3 个 NPC 进列表、出口与音乐照读；Web 复刻成同样的「停下、场景照进」） | 仅闭包 | —（xl-03x.13（closed）、xl-d8u（closed）） | 实跑两侧：Web 抛「仙二205.txt npcList[3] 只有 7 个字段」；原版 `Reader` 得 npcs=3、exits=1，`initiation` + 一帧 `paint` 成功（`Reader.java:100,270-273` 吞的） |
| 场景 对话里 `$` 进结局 | 能 | 链上（1 本：脚本41） | — | `Dialogue.java:111-113`；实跑 `end/trigger.test.ts` 7/7 |
| 场景 按 Esc 开菜单（旁白中、对话吐字中不开） | **能，但不对**：旁白中、对话中也开 | 随时（场景内） | xl-03x.16（open）、xl-as2（open） | `ScenePanel.java:177-178,207-208`；实跑 Web：脚本1 第 1 拍旁白中、脚本10 第 1 拍对话中 `openMenu` 都进了菜单 |
| 场景 视口跟随、地图遮挡、右下角金币数 | 能（金币数的字形差异是逐帧比对里登记的缺口区） | 链上 | — | `OtherEvent.java:34-100`；实跑 `viewport.test.ts` 44/44、`mapOverlays.test.ts` 5/5 |
| **菜单** 点物品 / 装备 / 奇术 / 天书四个标签切页 | 能 | 随时 | — | `menu/Command.java:91-119`；剧本 `menu-hero` / `menu-magic`；实跑 `menuTrace.test.ts` 51/51 |
| 菜单 顶栏「当前任务」显示当前任务 | **不能**：游戏里恒为「无」 | 随时 | xl-03x.10（open）、xl-lna（open） | `menu/Command.java:130-141`、`Reader.java:267`；读代码：`useGame.ts` 调 `menuDrawList(world)` 不传任务 |
| 菜单 点头像换人（陆 / 文在队才有）、看等级 | 能 | 随时 | — | `Scoll.java:121-184`；剧本 `menu-hero` |
| 菜单 药品页：悬停选药、点「使用」回血回蓝 | **能，但不对**：药品页永远看不到玩家持有的药，只会说「没药了」 | 随时 | xl-bsv（open） | `DrugPanel.java:92-300`；实跑 scratch：药包 3、菜单药品页 0；读代码：`refreshMenuWorld` 不同步药包 |
| 菜单 装备页：六个槽位切换、悬停看升降箭头、「使用」/「弃用」/ 不能用时「禁止」 | 能 | 随时 | — | `EquipPanel.java:297-320,520-950`；剧本 `menu-equip`；实跑 `equipPanel.test.ts` 9/9、`equipDraw.test.ts` 22/22 |
| 菜单 装备页里看见战斗掉的装备 | **能，但不对**：战利品装备写进另一个背包，菜单与商店都读不到 | 随时 | xl-5jx（open） | `VictoryReminder.java:348-361`；读代码：`battle/victory.ts` 写 `fakes/equipmentPack`，菜单读 `owned` |
| 菜单 长列表：够到框外的那几行 | 能（原版不裁剪、没有滚动条，框外照画照点；Web 画的那一半裁、加滚动条，ADR-0001 已登记。滑块现在拖得动（xl-03x.9（closed））） | 随时 | 拖滑块：xl-03x.9（closed）、xl-4ev（closed） | `EquipPanel.java:474-486,548-571`；剧本 `menu-scroll`；实跑 `scroll.test.ts` 25/25 |
| 菜单 奇术页：点技能看动画、说明、听音效 | 能（音效那一半见最后一行） | 随时 | — | `MagicPanel.java:343-456`；剧本 `menu-magic`（47 帧动画逐像素相等）；实跑 `magic.test.ts` 20/20 |
| 菜单 奇术页的技能格数随等级涨 | **能，但不对**：冻结在 2 / 3 / 2，升级、读档之后都不变 | 随时 | xl-03x.17（open）、xl-i06.13（open）、xl-8ym（open） | `ZhangXiaoFan.java:223-224,720-727`、`MagicPanel.java:285-335`；读代码：`menu/magic.ts` 读常量 `SKILL_NUMBER` |
| 菜单 天书「存档」/「提取」进存读档面板 | 能 | 随时 | — | `FuncButtons.java:192-213`；剧本 `saveload-menu`；实跑 `saveloadSession.test.ts` 8/8 |
| 菜单 天书「设定」→ 背景音乐 开 / 关 | 能 | 随时 | — | `FuncButtons.java:288-319`；实跑 `menuAudio.test.ts` 5/5、`useGameBgm.test.tsx` 2/2 |
| 菜单 天书「设定」→ 特殊音效 开 / 关 | **能，但不对**：开关拨得动，拨了不影响任何声音（没有音效播放器） | 随时 | xl-03x.8（open） | `FuncButtons.java:321-350`、`MusicPlayer.java:84,167`；`web/src/game/audioSettings.ts` 注释「sfx 写了没人读」 |
| 菜单 天书「返回」回场景 | 能 | 随时 | 跨帧松手被丢掉：xl-z4f（open） | `FuncButtons.java:224-232`；实跑 `menuSession.test.ts` 17/17 |
| 菜单 天书「退出」→「重新开始」回标题 | **不能**：只换了按钮组，没人读 `sub.restart` | 随时 | xl-03x.11（open）、xl-fbs（open） | `FuncButtons.java:353-368`；读代码：`menu/funcButtons.ts` |
| 菜单 天书「退出」→「确认离开」退出进程 | **不能**：浏览器无对应物 | 随时 | xl-03x.12（open）、xl-fbs（open） | `FuncButtons.java:370-380` |
| **商店** 药店：悬停看恢复量与价位评语、±数量、买（按库存封顶，钱不够整笔回滚）、卖 | 能 | 仅闭包 | — | `ShopPanel.java:131-265`；剧本 `shop-trade` / `shop-edges`；实跑 `shopTrace.test.ts` 46/46、`drugShop.test.ts` 13/13 |
| 商店 装备店：六类标签切换、悬停看属性与谁能用、±、买、卖 | 能 | 仅闭包 | — | `EquipmentShopPanel.java:86-437`；剧本 `shop-categories`；实跑 `equipShop.test.ts` 20/20 |
| 商店 进门读当前的钱与药、每一步写回，「返回游戏」回进门那一格 | 能 | 仅闭包 | — | `ShopPanel.java:215-252`；实跑 `appShop.test.tsx` 10/10 |
| **战斗** 「击」→ 点怪选敌 | 能 | 链上 | — | `battle/Command.java:81-88`；剧本 `battle-min` / `battle-victory`；实跑 `battleTrace.test.ts` 58/58 |
| 战斗 「技」→ 技能菜单 → 选招（单体选敌、全体直接放）、菜单里「返回」 | 能 | 链上 | — | `SkillMenu.java:202-287`；剧本 `battle-zhang-skills` / `battle-menus` 等 |
| 战斗 「防」：怒气满放秘术，不满弹提示 | 能 | 链上 | — | `battle/Command.java:104-144`；剧本 `battle-mishu-zhang/yu/lu` |
| 战斗 「物」→ 药品菜单 → 用药（回血或回蓝、扣存货、跳过这一回合） | **能，但不对**：Web 战斗里的存货恒为 0，永远只弹「没药」 | 链上 | xl-byy（open） | `DrugMenu.java:52,110-130` 读的是与商店 / 菜单共用的 `DrugPack`；Web `battle/world.ts` 写死 `drugStock` 为 0 |
| 战斗 鼠标悬停：技能说明、药品说明、选敌时怪物高亮停帧、按钮待点态 | **不能** | 链上 | xl-qqw（open） | `BattlePanel.java:349-367`；读代码：战斗画布只挂 `onMouseDown` |
| 战斗 按住按钮拖开再松手照样触发 | **不能** | 链上 | xl-qqw（open） | `GameButton.java:54-72`；读代码：Web 一次点击 = 同一点上的移入 + 按下 + 松开 |
| 战斗 按 J 秒杀全部敌人（原版留的调试键） | **不能** | 链上 | xl-03x.14（open）、xl-2d5（open） | `BattlePanel.java:289-296`；实跑 `keyboard.test.ts` 6/6（`KEYS` 里没有 j） |
| 战斗 打赢：经验、升级、属性滚动、结算完回地图 | 能 | 链上 | — | `Check.java:38-68`、`VictoryReminder.java:332-437`；剧本 `battle-victory`；实跑 `victory.test.ts` 10/10 |
| 战斗 战利品：药和钱进背包 | 能（战斗里用不上、菜单里看不见是另两行的事） | 链上 | — | `VictoryReminder.java:348-361`；实跑 `victory.test.ts`「物品与钱在 thing_sx1==4 那一拍发出去」 |
| 战斗 全灭：第一槽是罹年居士回地图，其余回标题 | 能 | 链上 | — | `GameOver.java:93-125`；剧本 `battle-defeat-scene` / `-start` / `-slot2`；实跑 `session.test.ts`「打输的两条分支」 |
| 战斗 全灭时第一槽的怪已先被打死 | **能，但不对**：原版空指针冻住战斗线程；Web 故意抛，但主循环没人接 —— 失败的样子不同 | 链上 | xl-9go（open） | `GameOver.java:95`、`Check.java:19-23`；读代码 |
| 战斗 听战斗背景音乐 | 能（修之前 10 首进战斗那一拍抛：实跑只抛一次，跳过那一拍绘制、上一首场景曲接着放） | 链上 | xl-19z（closed） | `BattlePanel.java:170-203`；实跑 `bgmPlayer.test.ts`「战斗背景音乐」：曲名从源码现读，逐首 `resolveBgmOrNull` 非 null、真播放器逐首 `sync` 不抛 |
| **声音** 场景 / 标题的背景音乐，从别的面板回来恢复 | 能（延后转码名单上的 16 首故意静音） | 链上 | — | `ScenePanel.java:171,262-265`；剧本 `milestone`；实跑 `bgmPlayer.test.ts` 20/20 |
| 声音 战斗 / 菜单 / 商店 / 场景里的音效 | **不能**：素材已进烘焙（xl-03x.5（closed））、播放器已有（xl-03x.6（closed）），但还没有一层把状态层报的音效交给它（xl-03x.7（open）） | 随时 | xl-03x.5（closed）、xl-03x.6（closed）、xl-03x.7（open） | 原版有效调用点 84（战斗 25 / 菜单 42 / 商店 16 / 场景 1，去注释现数）；`web/src/audio/` 只有 `bgmPlayer.ts` |

## 这一轮现查改出来的（与上一版相比）

上一版是 xl-czb.7（closed）现查、贴在 epic 评论里的 39 行。这一版没有从它转抄；对比只为记下「现查又改出了什么」：

- **推翻一行**：「场景 / 战斗 BGM　能」。上一版的依据是「真值 audio 列」，那一列只证状态层声明了该放哪首，
  证不了产品侧放得出来 —— 实跑 12 首战斗曲 10 首抛。拆成两行，战斗那一行改判「能，但不对」。
- **一行不在原版的分母里**：「列表滚动：拖滑块　不能」。原版根本没有滚动条（ADR-0001 例外表），拖滑块是 Web 自加
  控件的欠账。改写成「够到框外的那几行　能」。
- **新行**：战斗里用药、药品页看不到药、战斗悬停、战斗拖开松手、全灭时第一槽已空、存读档 Esc 回标题、
  踩到占位名 / 缺文件的出口、战斗背景音乐。
- **细化**：「走进仙二205」的原版半边现在有实跑读数（前 3 个 NPC 进列表、出口与音乐照读）；xl-d8u（closed）里
  「NPC 段之后都没读」的猜测与之不符。「结」这一行两张票口径冲突。

## 新行按「写条剧本就能让逐帧比对看见」过线

SPEC 的线：**写一条剧本就能让跨端逐帧比对看见的进这一轮，要跨面板才看得见的只立票。**

- **进这一轮的：无。** 这一轮现查出来的新行没有一条过线。
- **只立票的**（已立，都在上表第四列）：

  | 票 | 为什么过不了线 |
  |---|---|
  | xl-19z（closed）战斗背景音乐 10 首抛 | 逐帧比对不放声音；判据该落在单元缝上 |
  | xl-byy（open）战斗里用不了药 | 要跨面板（商店 / 宝箱 → 战斗），或者先给战斗驱动器加「预置存货」字段 |
  | xl-bsv（open）药品页看不到药 | 要跨面板（商店 / 宝箱 / 读档 → 菜单） |
  | xl-qqw（open）战斗悬停、拖开松手 | 单面板，但战斗驱动器只认点击，要先扩驱动器 |
  | xl-9go（open）全灭时第一槽已空 | 原版那侧线程死掉之后导出器能不能取帧未验证 |
  | xl-6zf（open）Esc 回标题 | 要跨面板，而且标题页没有驱动器 |
  | xl-whk（open）标题页没有驱动器 | 判据层欠账，不影响玩家 |

## ⚠️ 交给主干拍的（这张票不自己决定）

1. **闸门现数**：xl-03x（open）下选进来的实现票是 xl-03x.2（closed）到 xl-03x.18（open）共 17 张，恰好等于 SPEC 的上限 17；xl-03x.20（open）是 xl-03x.4（closed）做着做着逼出来的，按 SPEC 不占额度。这一趟新立的七张都没进这一轮，所以**没有超闸门**。
2. **范围没有被撑大，但有一张可能要出去**：xl-03x.16（open）（Esc 那两道门）进这一轮的理由是「写条剧本就能看见」，
   现查（读代码，未跑）门禁在会话层，而取图页只调 `step()`、不走会话层 —— 一条普通 scene 剧本按 Esc，两端都停在场景上。
   已评论在票上。
3. **xl-19z（closed）是这一轮现查出来最重的一条**：玩家进大多数战斗都会撞上。按线它不进这一轮，要不要破例由主干定。
4. **「结」口径冲突**：xl-u23（closed）的裁定（禁用 + title）已落地，xl-03x.12（open）要的是「画出来、点了什么都不发生」。
5. **重复票**（没动，列出来）：xl-2d5（open）≈ xl-03x.14（open）· xl-as2（open）≈ xl-03x.16（open）·
   xl-t0h（open）≈ xl-03x.15（closed）· xl-lna（open）≈ xl-03x.10（open）· xl-4ev（closed）≈ xl-03x.9（closed）·
   xl-8l2（open）≈ xl-03x.5（closed）、xl-03x.6（closed）、xl-03x.7（open） · xl-fbs（open）≈ xl-03x.11（open）+ xl-03x.12（open） · xl-8ym（open）≈ xl-i06.13（open）≈ xl-03x.17（open）。

## ⚠️ 这张表弱在哪

- 它证的是「每一行有人现查过、欠账有人认领」，**不是「玩家玩一遍不会遇到问题」**。标「读代码」的那些行没有跑过。
- 分母由人从 `src/` 读出来，**这一遍可能漏了行** —— 上一版漏了战斗用药与药品页，这一版不会是最后一次。
- 「能」只说明做得到，不说明与原版逐像素一致；像素一致由逐帧比对的分区表态守（`web/src/compare/expected.ts`）。
- **没有人在真的浏览器里从头玩到尾**，那归跨面板端到端 xl-x0t（open）。
