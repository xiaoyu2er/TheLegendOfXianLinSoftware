# 玩家走得通哪一段

这是这个项目唯一一份**玩家视角的全貌**：原版里玩家能做的每一件事，Web 端今天做不做得到。
每个里程碑收口时**现查着重写**，完工判据拿它当分母。

**现查：2026-09-12，「战斗 全灭时第一槽的怪已先被打死」一行由「不对」改判「能」之后；再往前是战斗鼠标那两行（悬停、按住拖开再松手）由「不能」改判「能」之后；再往前是 xl-6zf（closed） 把「存读档 按 Esc 回到来处」、xl-5jx（closed） 把「菜单装备页里看见战斗掉的装备」两行各由「不对」改判「能」之后（再往前是 xl-byy（closed）/ xl-bsv（closed）改判两行，能 53 · 不能 5 · 能但不对 4；xl-3hn（closed）改判三行，能 51 · 不能 5 · 能但不对 6）。共 62 行（能 59 · 不能 2 · 能但不对 1）——「声音 战斗 / 场景里的音效」那一行由主干在合并 xl-o9z（closed）/ xl-03x.22（closed）/ xl-cpo（closed）/ xl-r0x（closed）之后改判「能」：它欠的那张票 xl-b36（closed）早已合进主干，只是票据快照没重导、判据因此没红（2026-09-12）。**（上一次整表逐行重查是 2026-09-11 M8 收口那张票 xl-03x.19（closed），那时是能 49、不能 6、不对 7；之后 xl-3hn（closed）只改了三行，xl-byy（closed）/ xl-bsv（closed）只改了两行（菜单药品页、战斗用药）外加删掉「战斗 战利品」那一行里指向这两行的括注，最近这一次只改了「存读档 按 Esc 回到来处」一行，其余各行没有重查。）
（这句读数由 `web/src/mainline/test/playerCoverage.test.ts` 对着下面那张表现数核对，改了表不改这句会红。）

## M8 完工判据：当前读数（2026-09-11，M8 收口实跑）

「完成」是什么意思、四条判据为什么是这四条、三种身份各指什么，是**判断**，写在
`docs/adr/0007-what-done-means.md`。这里只放**读数** —— 两者过期的速度不一样，分开写。

| 判据 | 读数 | 怎么红 |
|---|---|---|
| 1. 对照表每一行要么是「能」，要么在例外表里有一行签过字的登记，要么指向一张已立的票并写明它欠的是什么 | **成立**：62 行 = 能 55 + 靠签过字的例外 2（标题「结」、天书「确认离开」，`ADR-0001#start-exit-disabled`）+ 指向开着的票且写明欠什么 6（「存读档 按 Esc 回到来处」那一行改判「能」之后现数；xl-byy（closed）/ xl-bsv（closed）之后是 53 / 2 / 7；xl-3hn（closed）之后是 51 / 2 / 9，M8 收口时是 49 / 2 / 11） | `playerCoverage.test.ts`：「不能 / 不对」没写欠什么、只指向关掉的票、指向的例外还是待签、引的例外键或票号不存在 —— 都红 |
| 2. 全量跨端逐帧比对 N/N 符合预期 | **成立：45/45 条剧本符合预期**（N = `tools/traces/scripts/` 现数 45；合计 1818 帧；退出码 0）。缺口区复核：报告里 144 条缺口区记账、49 个不同的区名，**没有一个区的最差帧是 0** —— 没有「账还完了而区还留着」的；比对器本身对「某区一帧都不差」双向红，所以这一条也是它守着的。每个区的成因写在 `web/src/compare/expected.ts` 那个区的 `why` / `issue` 上（类型强制，缺了编译不过）；这一轮之内被删掉的区只有旁白第 599 行那一个（xl-03x.15（closed））。账本对撞 18 条剧本逐帧相等。⚠️ 同一天第一次全量跑时，`maze-treasure` 取到第 4 帧后卡死 9 分钟（进程全部 0% CPU）；单独重跑那一条通过、第二次全量也通过 —— 记为偶发，没有查到原因 | `tools/compare-frames.sh` 退出码 |
| 3. 对照表每一行各有一条会红的判据 | **按字面不成立**；机器核得到的那一半成立：判「能」的 55 行（xl-6zf（closed） 与 xl-5jx（closed） 各改判一行之后现数），每一行的依据列都引到了一份磁盘上存在的测试文件或剧本（机器核）；「不能 / 不对」的 7 行，会红的是认领关系本身（认领的票关了而这一行没改 → 判据 1 红）。⚠️ **「引到的那份测试在这一行坏掉时真的会红」没有逐行篡改验证过** —— 验过的只有 M8 各票自己篡改过的那些行 | `playerCoverage.test.ts`：「能」行没引到存在的测试或剧本、引的测试文件不存在 —— 都红 |
| 4. 主线从起点到结局在状态层连跑一遍不抛 | **成立**（xl-3hn（closed）之后）：真实产品数据下链 45 本 / 44 跳（win32）全部落地、走到结局（148481 拍，每跳最多 20062 拍，第 13 跳）；全库脚本用到的怪在出厂表里一只不缺（`monsterGap` 现数 0）。此前断在第 4 跳（脚本3，「武林高手1」没有出厂数据）的登记 `KNOWN_BREAK` 与测试替身那份连跑已随之删除 | `playthrough.test.ts`：连跑断在任何一跳、或全库脚本冒出一只出厂表里没有的怪 —— 红 |
| 每张 open 票恰好一个身份标签 | **成立**（关票后重导的快照）：open 64 张，每张恰好一个身份 —— 登记 35 · 下一轮 11 · 没人认领 18（没人认领里含 blocked 的 xl-u7b（open））。关票前快照 open 66 张、64 张有身份，**缺的两张恰好是本票与 M8 的 SPEC**，判据当场红在这两张上 —— 那是「少一个」在真快照上的读数。「多一个」的真快照读数：给 xl-y11（closed）临时再贴一个身份、重导，判据红「贴了 2 个身份」；撕掉重导后快照逐字节回到原样 | `issueIdentity.test.ts`：少一个、多一个、认不出、与快照不是同一次导出 —— 都红 |

⚠️ 跟着这四条一起写死的两句，一个字都不能少：

- **它不等于没有 bug。** 这四条证的是「清单上的每件事都有人做了、且改坏了会响」，**不是「玩家玩一遍不会遇到问题」**。
- **没有人在真的浏览器里从头玩到尾。** 那归跨面板端到端那张票，这一轮不碰。

还有一条边界：**完工判据骑在对照表上，所以对照表看不见的东西它也看不见。**

⚠️ **「完成」意味着「清单上的每件事要么做了、要么有人签字说不做、要么有一张写明欠什么的票」，不意味着玩家能从头玩到尾** —— 这一轮已经证明后者不成立（主线第 4 跳进战斗就抛）。

「用这一轮立的标记扫一遍」的读数：`adrExceptions.test.ts` 双向对撞绿（标记 ⇄ 例外表）；另对 M8 这一轮新增的非测试代码行按措辞扫了一遍（词表同 ADR-0001「第二遍」那一段），**23 条命中逐条读过，没有一条是只写在注释里、没进例外表的新决定**（都落在已登记的行里，或明写「照抄」「还没做、不是故意不复刻」）。⚠️ 措辞扫描本身找不全，理由见 ADR-0001。

「还欠什么」是一句查询：`bd list --label 身份:没人认领`（另两份：`身份:下一轮`、`身份:登记`）。

## 这张表怎么读、怎么守

- **分母是「原版里玩家能做的一件事」**，由原版定死，从 `src/` 现读：`GameLauncher` 的面板切换与键盘分发、
  `StartPanel` 五颗按钮、`ScenePanel.keyPressed` / `step` 与 `scene/*Event`、菜单四页 + 天书
  （`FuncButtons`）、`LoadAndSavePanel`、两家店、战斗 `Command` / `SkillMenu` / `DrugMenu` /
  `EnemySlector` / `Check` / `GameOver`、`media/MusicPlayer`。**不是票数，也不从票据系统或上一版转抄。**
- 第二列三种判定：`能` · `**不能**：……` · `**能，但不对**：……`（做得到，但与原版不一致）。后两种**冒号后面必须写明欠的是什么**，
  并在第四列指向至少一张**还开着**的票，或一行**签过字**的 ADR-0001 例外（`ADR-0001#键`；标着「待签」的不算）。
- **「走主线碰不碰得到」用可达闭包，不用链长**（`web/src/mainline/test/chain.ts`，win32 语义）：
  **链上** = 主线链上某本脚本就有这一类段；**仅闭包** = 不在链上、挂在链上各本的出口上，玩家随时拐得进去；
  **随时** = 菜单 / 标题 / 存读档，不挂在哪本脚本上。
- 依据列的标法：**实跑** = 本票现查时实际跑过（测试条数是那一次的读数）；**读代码** = 没跑过，是从源码读出来的。只列源码行号 / 剧本名、没有这两个字的：源码行号是读代码，剧本名取自 `web/src/compare/expected.ts` 的表态，由上面那轮全量逐帧比对覆盖。
  **判「能」的行必须引到至少一份存在的测试文件或剧本**（完工判据第 3 条机器核得到的那一半）。
- **判据只守引用、不守内容**：表里每个票号后面写着它的状态，判据拿它们对着入库的票据快照
  `tools/issue-snapshot/issues.json` 撞（票号存在、状态一致、「不能 / 不对」有开着的票或签过的例外认领、例外键与测试文件名真有、上面那句读数与表对得上）。
  「能不能做」是人现查着写的，**判据一个字都不核，也绝对不许改成自动生成** —— 自动扫出来的表等于让被守的东西自己签字。
- **快照不是 `.beads/issues.jsonl`**：那是 bd 的被动导出，现查时是过期的（2026-09-11 开工时读数：它 125 条、open 25；活库 251 条、非 closed 84 —— 读数，不是规格）。**那份导出已经撤出 git**（xl-319（closed），2026-09-12 用户裁定）：它从来没有被自动刷新过，留着只会让人读到旧账。
  快照由 `tools/export-issues.sh` 从活库导出（同一次还导出每张 open 票的身份标签 `identity.json`），`tools/export-issues.sh --check`（或重导后 `git diff tools/issue-snapshot`）为空才算快照是活库现在的样子。
  改完表的流程：`tools/export-issues.sh` → `cd web && pnpm exec vitest run src/mainline/test/playerCoverage.test.ts src/mainline/test/issueIdentity.test.ts`。

### 可达闭包读数（实跑，`chain.ts` 现算，M8 收口）

全库 96 本 · 链 45 本 / 44 跳（出口 22 / 战斗 8 / 走自由场景 14），不断、走到结局 · 闭包 93 本 · 够不着 3 本
（剧情1 / 大迷宫1 / 迷宫1）。对照 posix 语义：链断在第 36 跳（脚本32 → 食堂夜），闭包 84 本 —— Web 按 win32 解析文件名，
见 ADR-0001 例外表 `win32-script-filename`。

各类段落落在哪（数据层真值 `tools/ground-truth/*.json` 里对应字段非空的本数；xl-03x.2（closed）的读数，本票只复核了随机遭遇那一栏）：对话 链上 43 · 旁白 链上 7 ·
剧情战 链上 11（其中 8 本推剧情）· 随机遭遇 链上 3（脚本6 / 10 / 20，各 3 行）· 宝箱 链上 3 · 结局 `$` 链上 1（脚本41）·
选择战 / 药店 / 装备店 仅闭包各 2 · 答题 仅闭包 10。

## 对照表

| 玩家能做的事 | Web 能不能做 | 走主线碰不碰得到 | 欠的那部分归 | 依据（现查） |
|---|---|---|---|---|
| **标题** 开机进标题、放主题曲 | 能 | 随时 | — | `GameLauncher.java:76,144-155`；实跑 `appTitle.test.tsx` 4/4 |
| 标题 悬停换图、高亮转；自绘鼠标 8 帧、云飘 | 能 | 随时 | — | 剧本 `start-about` / `start-newgame`（驱动器 `start`：状态层 `startTrace.test.ts` + 逐帧比对）；实跑 `StartPanel.test.tsx`、`animation.test.ts` |
| 标题 点「起」：卷轴展开、载入 30 拍、进脚本1 | 能（队伍回出厂是 ADR-0001 登记过的例外 `ADR-0001#new-game-resets-party`） | 随时 | —（重开把结局线程与字幕位置一起丢掉那一条已由 xl-eqo（closed）修好，判据 `game/newGameEnd.test.ts`；字幕滚到一半回标题，web 与原版一样在标题上接着滚 —— xl-p6n 票面怀疑冻住，实测不成立，判据同一个文件）| `StartPanel.java:220-222,335-344`；实跑 `StartPanel.test.tsx`「卷轴放完再等 30 拍」 |
| 标题 点「承」：进读档面板 | 能 | 随时 | — | 剧本 `saveload-start`（gap：只剩字形；缩略图逐像素相等） |
| 标题 点「转」：「关于我们」逐段揭开，点「回」收起 | 能 | 随时 | — | `StartPanel.java:228-241,296-328`；剧本 `start-about`（展开 / 收起各 10 拍，`expect` 核拍数）；实跑 `panelState.test.ts` |
| 标题 点「结」：退出进程 | **不能**：浏览器没有「退出进程」的对应物 —— 按钮画出来、禁用、带一句理由（`title`），悬停不换图（原版会换） | 随时 | `ADR-0001#start-exit-disabled`（xl-u23（closed）量过三条路后的定案；xl-03x.12（closed）两处统一） | `StartPanel.java:233-234`；实跑 `StartPanel.test.tsx` 17/17（「禁用的两颗各带一句理由」「禁用的那两颗点下去屏幕纹丝不动」） |
| **存读档** 从天书进存档：点槽直接写盘、不问覆盖，当场重读三个槽的摘要 | 能（不问覆盖、拖出去松手也触发、监听器越挂越多、头像只置不清 —— 缺陷照抄） | 随时 | 原版缺陷登记：xl-1dv.23（open）、xl-1dv.25（open）、xl-1dv.24（open）、xl-1dv.31（open） | 剧本 `saveload-menu`；实跑 `saveloadTrace.test.ts` 23/23、`step.test.ts` 8/8 |
| 存读档 读档：点非空槽，读档并切到场景 | 能 | 随时 | 原版读档多起一条场景循环，不复刻（`ADR-0001#load-extra-scene-loop`）：xl-1dv.28（open） | 剧本 `load-slot0` / `load-slot1` / `load-slot2`；实跑 `loadSession.test.ts` 11/11 |
| 存读档 读档时点空槽：什么都不发生 | 能 | 随时 | — | `LoadAndSavePanel.java:199`；剧本 `saveload-start` 第 2 步 |
| 存读档 按 Esc 回到来处 | 能 | 随时 | 离开标题那段时间标题页不推（`ADR-0001#panel-threads-run-while-hidden`） | `LoadAndSavePanel.java:295-303`；标题状态活过卸载（实跑 `appTitle.test.tsx`「离开标题再回来」）、回标题主题曲从头放（实跑 `useGameBgm.test.tsx`「从存读档面板回标题的背景音乐」）；背景音乐开关回标题拨回「开」由 xl-03x.21（closed）还上（`saveloadSession.test.ts`）。原先这里写的「原版卷轴停在展开那一帧」不成立：`drawScroll()` 那句 `stopButtonAnimation()` 把卷轴拨回第 0 帧 |
| **结局** 字幕滚动、过场画轮放、播完定格 | 能 | 链上（链尾 脚本41） | — | 剧本 `end-credits` 表态 match；实跑 `endTrace.test.ts` 21/21 |
| 结局 按 Esc：被场景当成开菜单，结局被切走 | 能（照复刻，M7 主干裁定） | 链上 | — | `GameLauncher.java:161-164,186-191`；剧本 `end-credits` 末 3 步 |
| **场景** 方向键走、Ctrl 跑、碰撞 | 能 | 链上 | — | `ScenePanel.java:187-196`；剧本 `dorm-walk` / `bigmap-walk`；实跑 `traceReplay.test.ts` 219/219 |
| 场景 看旁白（逐字、换背景） | 能（背景第 599 行的取整账已还清，旁白背景逐像素相等） | 链上（7 本） | —（xl-03x.15（closed）、xl-t0h（closed）） | `Narratage.java:48`；剧本 `dorm-intro` / `milestone` 硬比区含旁白背景（缺口区只剩字形）；`narratageLayout.test.ts` 对黄金数据 |
| 场景 看对话（自动 / 位置 / 找 NPC 推主线）、空格翻页 | 能（另多了回车跳过吐字，`ADR-0001#dialogue-skip-printing`） | 链上（43 本） | — | `DialogueEvent.java:30-146`；剧本 `dorm-intro` / `milestone`；实跑 `dialogue.test.ts` |
| 场景 NPC 闲聊；NPC 走动、靠近就停 | 能 | 链上 | — | `NPCEvent.java:17-133`；剧本 `bigmap-walk`；实跑 `npc.test.ts` 10/10 |
| 场景 走出口换图（三条分支） | 能（按 win32 解析文件名，`ADR-0001#win32-script-filename`） | 链上 | 原版在 posix 上断链这件事本身：xl-1dv.11（open） | `ExitEvent.java:30-74`；实跑 `handoff.test.ts` 46/46、`doors.test.ts` 17/17 |
| 场景 踩到占位名或缺文件的出口 | **能，但不对**：原版吞 `FileNotFoundException` 得一个全空的场景、首帧 `paint` 抛空指针；Web 在进场景时硬抛 —— 失败的样子不同 | 仅闭包（缺文件那处在剧情1，够不着） | xl-1dv.12（open）、xl-1dv.13（open） | `Reader.java:84-95`；实跑：原版探针（`initiation` 成功、`OtherEvent.addMap` 空指针）；`step.ts` 进场景那一支 |
| 场景 开宝箱 | 能 | 链上（3 本：脚本6 / 10 / 20） | — | `TreasureBox.java:42-62`；剧本 `maze-treasure`；实跑 `treasure.test.ts` 13/13 |
| 场景 随机遭遇（计步 30 或 50 格） | 能（脚本6 的 3 行随机遭遇原先全部撞到没有出厂数据的怪，xl-3hn（closed）补齐；脚本10 / 20 照原版） | 链上（3 本） | — | `FightEvent.java:48-51,110-121`；实跑 `fight.test.ts` 8/8、`session.test.ts`（迷宫1 真走 30 格）；剧本 `battle-script6`（脚本6 第 3 行原样：武林高手1 + 两只舞剑者）的行为真值与逐帧表态；实跑 `playthrough.test.ts` 的缺口现数 0 |
| 场景 对话里 `@` 触发剧情战、打推剧情的 boss 后剧情推进 | 能（xl-3hn（closed）：链上 9 场剧情战的怪补齐了出厂数据，真实产品连跑走到结局） | 链上（11 本，8 本推剧情） | — | `FightEvent.java:38-46,100-104`；实跑 `playthrough.test.ts` 4/4（真实产品 44 跳走到结局）、`session.test.ts`、`handoff.test.ts` 46/46；剧本 `battle-script3` / `12` / `15` / `17` / `25` / `31` / `38-2` / `38-3` / `39`（各照搬那一行 Fight 数据）的行为真值逐步逐字段对上（`battleTrace.test.ts`） |
| 场景 选择框 → 约战 | 能 | 仅闭包（2 本） | — | `SelectEvent.java:191-202`；剧本 `battle-door` |
| 场景 选择框 → 药店 | 能 | 仅闭包（2 本） | — | `SelectEvent.java:178-190`；剧本 `shop-door`；实跑 `select.test.ts` 11/11 |
| 场景 选择框 → 装备店 | 能 | 仅闭包（2 本） | — | `SelectEvent.java:185-190`；剧本 `equipshop-door` |
| 场景 答题（答对加钱、答错扣钱、答过的记住） | 能 | 仅闭包（10 本；剧情1 也有但够不着） | —（xl-03x.3（closed）已还：取图页与会话层共用记账，金币数值由账本逐帧对撞守着；像素上只剩字形） | `SelectEvent.java:203-216,371-421`；剧本 `question-answer` / `question-memory` |
| 场景 走进「仙二205」 | 能（xl-03x.13（closed）：原版吞掉异常照进 —— 前 3 个 NPC 进列表、出口与音乐照读；Web 复刻成同样的「停下、场景照进」） | 仅闭包 | —（xl-03x.13（closed）、xl-d8u（closed）） | 剧本 `npc-defect`（行为真值 + 逐帧表态）；原版 `Reader` 得 npcs=3、exits=1（`Reader.java:100,270-273` 吞的）；实跑 `npc.test.ts` 10/10 |
| 场景 对话里 `$` 进结局 | 能 | 链上（1 本：脚本41） | — | `Dialogue.java:111-113`；实跑 `trigger.test.ts` 7/7 |
| 场景 按 Esc 开菜单（旁白中、对话吐字中不开） | 能（逐帧比对看不见这一条：取图页不画菜单，判据在会话层） | 随时（场景内） | —（xl-03x.16（closed）、xl-as2（closed）） | `ScenePanel.java:177-178,207-208`；实跑 `escGate.test.ts` 6/6 |
| 场景 视口跟随、地图遮挡、右下角金币数 | 能（金币数的字形差异是逐帧比对里登记的缺口区） | 链上 | — | `OtherEvent.java:34-100`；实跑 `viewport.test.ts` 44/44、`mapOverlays.test.ts` 5/5 |
| **菜单** 点物品 / 装备 / 奇术 / 天书四个标签切页 | 能 | 随时 | — | `menu/Command.java:91-119`；剧本 `menu-hero` / `menu-magic`；实跑 `menuTrace.test.ts` 76/76 |
| 菜单 顶栏「当前任务」显示当前任务 | 能（「错一个字」逐帧比对看不见 —— 顶栏是字形缺口区；判据是逐字符串对真值） | 随时 | —（xl-03x.10（closed）、xl-lna（closed）） | `menu/Command.java:130-141`、`Reader.java:267`；剧本 `menu-task`；实跑 `taskTitle.test.ts` 8/8、`menuTask.test.ts` 5/5 |
| 菜单 点头像换人（陆 / 文在队才有）、看等级 | 能 | 随时 | — | `Scoll.java:121-184`；剧本 `menu-hero` |
| 菜单 药品页：悬停选药、点「使用」回血回蓝 | 能 | 随时 | —（xl-bsv（closed）） | `DrugPanel.java:92-300`；`game/session.ts` 开菜单时从药包现读（`refreshMenuWorld` 的 `drugs`）、每一拍写回；实跑 `menuSession.test.ts`「物品页看得见药包里的药」与「喝一瓶药」那条的药包断言 |
| 菜单 装备页：六个槽位切换、悬停看升降箭头、「使用」/「弃用」/ 不能用时「禁止」 | 能 | 随时 | — | `EquipPanel.java:297-320,520-950`；剧本 `menu-equip`；实跑 `equipPanel.test.ts` 9/9、`equipDraw.test.ts` 22/22 |
| 菜单 装备页里看见战斗掉的装备 | 能（原版名字对不上出厂表的那一件 `颀崟巨环` 照原版丢掉） | 随时 | —（xl-5jx（closed）） | `VictoryReminder.java:348-361`；`game/session.ts` 在战斗那一拍之后把 `lootEquipment` 搬进菜单装备页的 `owned`；实跑 `session.test.ts`「打赢掉的装备进全局装备背包」两条、`doors.test.ts`「打赢掉的装备：再进装备超市……」 |
| 菜单 长列表：够到框外的那几行 | 能（原版不裁剪、没有滚动条，框外照画照点；Web 画的那一半裁、加滚动条，`ADR-0001#list-clipped-with-scrollbar`。滑块拖得动（xl-03x.9（closed））） | 随时 | —（xl-03x.9（closed）、xl-4ev（closed）） | `EquipPanel.java:474-486,548-571`；剧本 `menu-scroll`；实跑 `scroll.test.ts` 25/25 |
| 菜单 奇术页：点技能看动画、说明、听音效 | 能（音效由音效播放器真的交出去，见「声音」那两行） | 随时 | — | `MagicPanel.java:343-456`；剧本 `menu-magic`（47 帧动画逐像素相等）；实跑 `magic.test.ts` 22/22 |
| 菜单 奇术页的技能格数随等级涨 | 能（升级 2 / 5 / 10 级各 +1；读档只抬不压） | 随时 | —（xl-03x.17（closed）、xl-i06.13（closed）、xl-8ym（closed）） | `ZhangXiaoFan.java:223-224,720-727`、`MagicPanel.java:285-335`；剧本 `menu-magic-levels`；实跑 `magic.test.ts` 22/22、`loadSession.test.ts` 11/11 |
| 菜单 天书「存档」/「提取」进存读档面板 | 能 | 随时 | — | `FuncButtons.java:192-213`；剧本 `saveload-menu`；实跑 `saveloadSession.test.ts` 10/10 |
| 菜单 天书「设定」→ 背景音乐 开 / 关 | 能 | 随时 | — | `FuncButtons.java:288-319`；实跑 `menuAudio.test.ts` 5/5、`useGameBgm.test.tsx` 4/4 |
| 菜单 天书「设定」→ 特殊音效 开 / 关 | 能（关掉之后菜单与商店的声音真的停；战斗 / 场景里的音效本来就还不响，那是「声音」最后一行的事，不是开关的） | 随时 | —（xl-03x.8（closed）、xl-ebw（closed）） | `FuncButtons.java:321-350`、`MusicPlayer.java:84,167`；实跑 `sfxSwitch.test.ts` 3/3、`useGameSfx.test.tsx` 2/2 |
| 菜单 天书「返回」回场景 | 能 | 随时 | 跨帧松手被丢掉：xl-z4f（closed） | `FuncButtons.java:224-232`；实跑 `menuSession.test.ts` 24/24。回来下一拍场景曲从头放（`ScenePanel.java:262-265` 那句 `readBGM` 不看同名）：实跑 `useGameBgm.test.tsx` 4/4「从菜单回场景的背景音乐」 |
| 菜单 天书「退出」→「重新开始」回标题 | 能（回标题把背景音乐开关拨回「开」，xl-03x.21（closed）） | 随时 | —（xl-03x.11（closed）、xl-fbs（closed）） | `FuncButtons.java:353-368`；实跑 `menuSession.test.ts` 24/24、`funcButtons.test.ts` 23/23 |
| 菜单 天书「退出」→「确认离开」退出进程 | **不能**：浏览器没有「退出进程」的对应物 —— 照画、照原版展开收起，禁用：不响应悬停 / 按下 / 松开、不出声，理由挂在画布宿主的 `title` 上 | 随时 | `ADR-0001#start-exit-disabled`（xl-03x.12（closed）） | `FuncButtons.java:370-380`；实跑 `funcButtons.test.ts` 23/23、`menuSession.test.ts` 24/24、`appMenu.test.tsx` 5/5 |
| **商店** 药店：悬停看恢复量与价位评语、±数量、买（按库存封顶，钱不够整笔回滚）、卖 | 能 | 仅闭包 | — | `ShopPanel.java:131-265`；剧本 `shop-trade` / `shop-edges`；实跑 `shopTrace.test.ts` 46/46、`drugShop.test.ts` 13/13 |
| 商店 装备店：六类标签切换、悬停看属性与谁能用、±、买、卖 | 能 | 仅闭包 | — | `EquipmentShopPanel.java:86-437`；剧本 `shop-categories`；实跑 `equipShop.test.ts` 20/20 |
| 商店 进门读当前的钱与药、每一步写回，「返回游戏」回进门那一格 | 能 | 仅闭包 | — | `ShopPanel.java:215-252`；实跑 `appShop.test.tsx` 10/10；回来下一拍场景曲从头放（与菜单「返回」同一句 `readBGM`）：`doors.test.ts`「进店之后按「返回游戏」」 |
| **战斗** 「击」→ 点怪选敌 | 能 | 链上 | — | `battle/Command.java:81-88`；剧本 `battle-min` / `battle-victory`；实跑 `battleTrace.test.ts` 57/57 |
| 战斗 「技」→ 技能菜单 → 选招（单体选敌、全体直接放）、菜单里「返回」 | 能 | 链上 | — | `SkillMenu.java:202-287`；剧本 `battle-zhang-skills` / `battle-menus` 等 |
| 战斗 「防」：怒气满放秘术，不满弹提示 | 能 | 链上 | — | `battle/Command.java:104-144`；剧本 `battle-mishu-zhang` / `battle-mishu-yu` / `battle-mishu-lu` |
| 战斗 「物」→ 药品菜单 → 用药（回血或回蓝、扣存货、跳过这一回合） | 能 | 链上 | —（xl-byy（closed）） | `DrugMenu.java:52,110-192`；会话起战斗时从药包现读存货、每一拍写回；真的用药那一路由剧本 `battle-drugs`（驱动器新字段 `drugs`）逐字段钉住；实跑 `battleTrace.test.ts`、`session.test.ts`「战斗里的药来自药包」 |
| 战斗 鼠标悬停：技能说明、药品说明、选敌时怪物高亮停帧、按钮待点态 | 能（战斗画布分开收移动 / 拖动 / 按下 / 松开；按着键拖过怪物不停帧、不换选中图，与原版 `mouseDragged` 同） | 链上 | — | `BattlePanel.java:349-367`；真值 `battle-mouse`（`mouse` 指令）逐字段回放 + 逐帧比对；`battle/pointer.test.ts`、`app/appGrab.test.tsx` |
| 战斗 按住按钮拖开再松手照样触发 | 能（松手走 `grabRelease`，拖出画布再松手也归战斗；框外松手不清 `isclicked`，下一次任何松手都会连带触发 —— 照原版） | 链上 | — | `GameButton.java:54-72`；真值 `battle-mouse` 第 149 拍（拖开松手开选敌）、第 258 拍（粘着的「击」随「技」一起触发） |
| 战斗 按 J 秒杀全部敌人（原版留的调试键） | 能（照复刻：清空敌人、直接落进「全部怪物被杀死」那一段；控制台与提示照原版盖在结算画面上） | 链上 | —（它让「正常打死 → 结算 → 回场景」一度零覆盖，已由剧本 `battle-victory-normal` 补回） | `BattlePanel.java:289-296`；剧本 `battle-victory`（加了一步 `debugKill`）；实跑 `battleTrace.test.ts` 57/57、`useGame.test.tsx` 13/13（进脚本22，按 J，经验得动） |
| 战斗 打赢：经验、升级、属性滚动、结算完回地图 | 能 | 链上 | —（xl-3hn（closed）那十份剧情战真值都停在「胜利」出现的那一刻，没走结算；走完结算的是右栏那两份） | `Check.java:38-68`、`VictoryReminder.java:332-437`；剧本 `battle-victory`（按 J）/ `battle-victory-normal`（正常打死）；`battleTrace.test.ts`「正常打赢之后结算走完、回到场景」从真值现算这类剧本的份数、要求至少一份；实跑 `victory.test.ts` 11/11；主线连跑（`playthrough.test.ts`）在状态层用真实出厂数据开出链上每场仗，**按 J 打赢**、结算、回到地图（正常打死那条路见 `battle-victory-normal`） |
| 战斗 战利品：药和钱进背包 | 能 | 链上 | — | `VictoryReminder.java:348-361`；实跑 `victory.test.ts`「物品与钱在 thing_sx1==4 那一拍发出去」 |
| 战斗 全灭：第一槽是罹年居士回地图，其余回标题 | 能 | 链上 | — | `GameOver.java:93-125`；剧本 `battle-defeat-scene` / `battle-defeat-start` / `battle-defeat-slot2`；实跑 `session.test.ts`「打输的两条分支」 |
| 战斗 全灭时第一槽的怪已先被打死 | 能（照原版：那一发空指针冲出 `run()`、战斗线程死掉，面板不切、画面停在那一帧，场景线程照跑；Web 在同一句抛 `BattleThreadDied`，推进器只接这一类） | 链上 | — | `GameOver.java:95`、`Check.java:19-23`、`BattlePanel.java:464-471`（try 只包着 sleep）；实跑 `threadDeath.test.ts`（源码形状现读 + 死后一拍不推）、`session.test.ts`「全灭时第一槽已空」；原版那侧没跑过，逐帧比对不覆盖（没有真值走到这一支） |
| 战斗 听战斗背景音乐 | 能（修之前 10 首进战斗那一拍抛） | 链上 | —（xl-19z（closed）） | `BattlePanel.java:170-203`；实跑 `bgmPlayer.test.ts` 34/34（「战斗背景音乐」：曲名从源码现读，逐首 `resolveBgmOrNull` 非 null、真播放器逐首 `sync` 不抛） |
| **声音** 场景 / 标题的背景音乐，从别的面板回来恢复 | 能（延后转码名单上的 16 首故意静音） | 链上 | — | `ScenePanel.java:171,262-265`；剧本 `milestone`；实跑 `bgmPlayer.test.ts` 34/34 |
| 声音 菜单 / 商店里的音效 | 能（与背景音乐同时响；音效之间后一声顶掉前一声，照原版） | 随时 | —（xl-03x.5（closed）、xl-03x.6（closed）、xl-03x.7（closed）、xl-8l2（closed）） | `MusicPlayer.java`；实跑 `sfxWiring.test.ts` 25/25（有非空音效真值的 9 份剧本逐步对撞：真值 music == 经会话交给播放器的序列）、`sfxPlayer.test.ts`。⚠️ 证的是「该响的时候调了播放器、参数对」，**证不了玩家真的听到了** |
| 声音 战斗 / 场景里的音效 | 能（原版有效调用点 战斗 25 / 场景 1，xl-03x.7（closed）现数；xl-b36（closed）接上两支的观察点并重导 42 份带 music 的真值） | 链上 | —（xl-b36（closed）） | `MusicPlayer.java`；实跑 `web/src/game/sfxWiring.test.ts`（分母已扩到战斗与场景：battle 24 + scene 18 = 42 份真值逐步对撞）。⚠️ 与菜单 / 商店那一行同一句：证的是「该响的时候调了播放器、参数对」，**证不了玩家真的听到了** |

## 这一轮现查改出来的（与上一版相比）

上一版是 xl-03x.2（closed）现查、之后由主干与各票在合并时逐行同步的那一份（⚠️ 那几次同步**不是重新现查**）。
这一版整表逐行重查过；对比只为记下「这一轮做完之后，现查又改出了什么」：

- **从「不能 / 不对」变成「能」**（各自的判据本票实跑过，条数写在依据列）：顶栏当前任务 · 天书「重新开始」· 场景 Esc 那两道门 ·
  技能格数 · 调试秒杀键 J · 特殊音效开关 · 走进仙二205 · 旁白取整 · 战斗 BGM（后三行合并时已改）。
- **「不能」但改由签过字的例外认领**：标题「结」与天书「确认离开」—— 浏览器没有「退出进程」的对应物，禁用 + title，
  `ADR-0001#start-exit-disabled`（本票签，见 ADR-0001）。
- **从「能」退下来**（被实跑推翻）：「剧情战」→ **不能**（xl-03x.18（closed）的主线连跑：真实产品断在第 4 跳）；
  「随机遭遇」→ **能，但不对**（**本票现查新发现**：同一个缺口在脚本6 的 3 行随机遭遇上全中，一遇敌就抛 —— 主干交接的清单里没有这一行）。
- **一行拆成两行**：「声音 … 里的音效」→ 菜单 / 商店那一半「能」、战斗 / 场景那一半当时「不能」（xl-b36（closed）已把后一半补上，见上表）。
- **认领关系变了**：xl-fbs（closed）/ xl-8l2（closed）/ xl-yg6.15（closed）三张被别的票实质做掉的重复票，本票按先例关掉（关闭理由里点名由谁做掉）。

## ⚠️ 交给主干拍的（这张票不自己决定）

1. **完工判据第 4 条字面不成立**（真实产品断在第 4 跳）。第 1 条已按用户拍板改写，第 4 条没有。M8 算不算完成，
   是这一条字面与「剧情战」那一行的第三种表述之间怎么对账 —— 读数并排摆在上面，**措辞不由本票改**。
2. **ADR-0001 那些「待签」行本票签了**（主干交接时列为收口的活）。签法与每一行判据的篡改读数写在 ADR-0001 表下；
   合并即认，不认就在合并前退回。
3. **epic xl-03x（closed）已关**：它原先挂着的 xl-03x.22（closed）/ xl-03x.23（closed）都是下一轮的，关 epic 前已挪出这个 epic（两张都贴着 `身份:下一轮`）；身份与票据快照跟着重导过。

## ⚠️ 这张表弱在哪

- 它证的是「每一行有人现查过、欠账有人认领」，**不是「玩家玩一遍不会遇到问题」**。标「读代码」的那些行没有跑过。
- 分母由人从 `src/` 读出来，**这一遍可能漏了行** —— 上一版漏了战斗用药与药品页，这一版的「随机遭遇」也是现查才改的，这一版不会是最后一次。
- 「能」只说明做得到，不说明与原版逐像素一致；像素一致由逐帧比对的分区表态守（`web/src/compare/expected.ts`）。
- 判「能」的行「引到了一份存在的测试」**不等于**那份测试在这一行坏掉时会红（见完工判据第 3 条的读数）。
- **没有人在真的浏览器里从头玩到尾**，那归跨面板端到端 xl-x0t（open）。
