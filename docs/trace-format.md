# 剧本格式与 trace 格式

> 本文描述 `tools/export-trace.sh` 的输入（剧本）与输出（trace）。
> 实现在 `tools/src/devtools/`，被驱动的是 `src/` 里的原版程序本身。

## 为什么要有这套东西

状态层与视口层的实现如果没有真值，测试就只能手写期望值 —— 而写实现和写期望的
会是同一个 agent、在同一个上下文窗口里。那样的测试会绿，而且是错的。

这里导出的每一个 tick 都是原版自己跑出来的结果，Web 侧只能对齐，不能协商。

## 四种驱动器一览（xl-1vu 收口）

一套设施、四支驱动器（`tools/src/devtools/TraceDriver.java` 那三件事：推进一步 /
快照可断言状态 / 快照真的画出来的位图）。剧本一律在 `tools/traces/scripts/*.json`，
真值一律在 `tools/traces/out/<剧本>.trace.json`，**两处都入库**。

| 驱动器 | 一步是什么 | 剧本 | 实现 |
|---|---|---|---|
| `scene` | 一个 tick | `dorm-walk` `bigmap-walk` `dorm-intro` `dorm-exit` `milestone` | `SceneDriver.java` |
| `battle` | `BattlePanel.run()` 的一次循环体 + 一次 `paint()` | `tools/traces/scripts/battle-*.json`（这一列原先是写死的五个名字，xl-rh9.11 加了一份、xl-rh9.14 又加了六份都没跟上 —— 名单在磁盘上，别再抄一份） | `BattleDriver.java` |
| `menu` | 一次输入事件（`tick` 指令则是一次 `run()` 循环体） | `menu-equip` `menu-magic` | `MenuDriver.java` |
| `shop` | 一次输入事件 | `shop-trade` | `ShopDriver.java` |

**「剧本」这一列里写出来的名字是 2026-09-07 的读数，不是名单。** 权威的名单在
磁盘上，每份剧本自报 `driver`（缺省算 `scene`）；现数一遍：

```bash
for f in tools/traces/scripts/*.json; do
  python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('driver','scene'))" "$f"
done | sort | uniq -c
```

**导出命令只有一条，四支通用**（选哪一支由剧本自报的 `driver` 字段定，
`ExportTrace.pickDriver` 认不出的名字一律硬失败）：

```bash
tools/export-trace.sh                 # 全部剧本
tools/export-trace.sh battle-min      # 只导一份
tools/export-trace.sh --check         # 每份导两遍，cmp 两份产物
```

### 判据：两条回归，四支驱动器一视同仁

与数据层那条（`tools/export-truth.sh` + `git diff tools/ground-truth` 为空）
并列，行为层是这两条，**缺一不可**：

| 检查 | 命令 | 通过条件 | 它管什么 |
|---|---|---|---|
| 确定性 | `tools/export-trace.sh --check` | 每份剧本在两个独立 JVM 里导出，两份产物 `cmp` 逐字节一致 | 这一次跑出来的东西可复现 |
| 无回归 | 重导之后 `git diff tools/traces/out` | 空 | 跑出来的还是同一份东西 |

**两条必须一起看。** `--check` 只证明"可复现"—— 一个**稳定的**错误在它眼里
和正确一模一样；能认出错误的是重导之后那个 `git diff`。挑判据时先问：这条检查
失败的样子，和它通过的样子长得一样吗。

**这张表不要在这里抄第二份。** 它每加一份剧本就整批变（下面那段括号说了三次
是怎么变的），而抄旧了之后「对不上」和「真值坏了」长得一模一样。要今天的数就
现跑一遍，输出即是表：

```bash
tools/export-trace.sh --check       # 每份剧本导两遍并 cmp，逐行打字节数
git diff --stat tools/traces/out    # 第二条判据：必须空
```

下面这一段是 **2026-09-07 的历史读数**（macOS / openjdk 17，当时磁盘上是
**15 份**剧本，全部 `--check` 通过，重导之后 `git status` 里除那次新增的一份
之外没有任何改动）。**它不是今天的名单，也从来不是「全的」**——照抄它会漏掉
之后加的剧本（xl-rh9.14 那六份战斗真值就是这么漏的）：

```
确定性 OK：battle-defeat-scene 两次导出逐字节一致（407590 字节）
确定性 OK：battle-defeat-slot2 两次导出逐字节一致（161894 字节）
确定性 OK：battle-defeat-start 两次导出逐字节一致（313187 字节）
确定性 OK：battle-em3-box      两次导出逐字节一致（1442613 字节）
确定性 OK：battle-menus        两次导出逐字节一致（897852 字节）
确定性 OK：battle-min          两次导出逐字节一致（767864 字节）
确定性 OK：battle-victory      两次导出逐字节一致（1618357 字节）
确定性 OK：bigmap-walk         两次导出逐字节一致（1200232 字节）
确定性 OK：dorm-exit           两次导出逐字节一致（1176782 字节）
确定性 OK：dorm-intro          两次导出逐字节一致（3644874 字节）
确定性 OK：dorm-walk           两次导出逐字节一致（401773 字节）
确定性 OK：menu-equip          两次导出逐字节一致（48608 字节）
确定性 OK：menu-magic          两次导出逐字节一致（71081 字节）
确定性 OK：milestone           两次导出逐字节一致（8220759 字节）
确定性 OK：shop-trade          两次导出逐字节一致（123712 字节）
```

（更早的一版这里记的是 10 份，且十个字节数里有**八个**与入库产物对不上 ——
只有两份战斗的数对得上。那份是更早一次导出留下的。xl-rh9.3 当场重量过一次，
xl-rh9.6 加进 `battle-defeat-slot2` 那一行时又整批重量了一次。xl-rh9.13 加进
`battle-victory` 时第三次整批重量 —— 那一趟七份战斗真值的字节数**全部变了**，
因为 xl-rh9.11 与 xl-rh9.13 各自往快照里加过字段；**照抄上一版的数字会得到一张
逐条对不上的表，而对不上和"真值坏了"长得一样**。所以这张表每次都重量。）

跨机器、跨 JDK 版本的一致性**未验证**。

### 跨端逐帧比对没接满四支

`tools/compare-frames.sh` 那条流水线（`docs/frame-compare.md`）四支都跑得到
原版侧，但 **Web 侧只装配得出 `web/src/replay/implemented.ts` 里
`IMPLEMENTED_DRIVERS` 列的那几支**——名单只有那一份，这里不抄第二份，
`cat` 它一眼就知道（战斗是 M2 接上的）。还没接上的面板要等
**M3（xl-6lo）/ M4（xl-knp）** 各自把 web 侧建起来。
**xl-1vu 这个 SPEC 不做接线**，它只负责让"装配不出来"这件事**响亮**——
详见 `docs/frame-compare.md` 的「装配不出来的驱动器」。

## 剧本（输入）

UTF-8 JSON，放在 `tools/traces/scripts/*.json`。

```json
{
  "name": "dorm-walk",
  "description": "一句话说明这份剧本覆盖什么",
  "warmup": "脚本1.txt",
  "scene": "宿舍.txt",
  "isScript": false,
  "tickMs": 10,
  "maxTicks": 20000,
  "steps": [
    { "op": "walkTo", "x": 13, "y": 11 },
    { "op": "runTo",  "x": 20, "y": 11 },
    { "op": "talk" },
    { "op": "advanceAll", "max": 8 }
  ]
}
```

| 字段 | 含义 |
|---|---|
| `warmup` | 先加载一遍的脚本，可为 `null`。96 个场景里有 20 个没有 `Dialogue` 段，依赖前一个场景残留的 `dialogueEvent` 对象才能跑，直接进去会 NPE。 |
| `isScript` | 对应 `ScenePanel.isScript`。`false` 时旁白与主线对话的轮询被跳过 —— 从大地图走进宿舍时原版就是这个状态。 |
| `tickMs` | 虚拟时钟的步长，必须整除 10。原版 17 个定时器的间隔是 10/20/30/40/50/80/100/180/200/500，全是 10 的倍数；步长不整除它们，触发时刻就会被舍入。 |
| `maxTicks` | 整份剧本的 tick 上限；跑满仍未结束是硬失败。 |
| `every` | **取帧密度，可选，四支驱动器通用**（xl-6lo.3）。跨端逐帧比对每 `every` 步存一张 PNG。不写就走导出器的缺省 25；写了就是这份剧本自己说了算，`--every` 仍能压掉它。`0` 与负数是硬失败（见下）。 |

### 指令词汇

**声明式**：写"走到 (14,19)"，不写"按 12 次下键"。后者对时序敏感 —— 一格走 8
帧、每帧 80ms，两端只要有一处 tick 边界对不齐，之后整条 trace 全错，而错因和
现象隔着几千帧。声明式的终点是一个可断言的事实，两端各自负责把它展开成按键。

这套词汇就是 Web 侧状态推进函数的入参类型，不是另一套平行机制。

| 指令 | 参数 | 语义 |
|---|---|---|
| `walkTo` | `x`, `y` | 走到目标格。先 X 后 Y。到不了 —— 硬失败。 |
| `runTo` | `x`, `y` | 同上，按住 Ctrl 跑。 |
| `exitTo` | `x`, `y` | 走向出口格，等场景真的换掉（`ScenePanel.fileName` 变了）才算完。走到了而场景没换 —— 硬失败。 |
| `talk` | — | 按一次空格（站在相邻 NPC 旁就是搭话）。按完没有对话开始 —— 硬失败。 |
| `advance` | `times` | 推进对话 `times` 次，每次都等当前句逐字打完再按空格。对话提前结束 —— 硬失败。 |
| `advanceAll` | `max` | 一直推进到对话结束，最多 `max` 次。到 `max` 还没结束 —— 硬失败。 |
| `wait` | `ticks` | 空等。 |
| `waitIdle` | — | 等到主角的走/跑定时器都停下（即已对齐到格）。 |
| `waitNarratage` | — | 等到旁白播完。 |

每条指令另有可选的 `budget`（默认 2000），是这条指令自己的 tick 预算。
超预算、走不动、对话提前结束，一律**非零退出并打印是哪条指令、第几个 tick、
主角当时在哪一格**。不静默跳过：走不到就当走到了，会导出一份看上去正常、
实际整条错位的 trace。

### walkTo / runTo 是怎么展开成按键的

原版的松手（`keyReleased`）只是把 `canStop` 置位，主角要走到下一个"可停点"
才真的停。可停点的间隔：

- 走路：每 4 次定时器触发 = 32px = 恰好一格；
- 跑步：每 4 次触发 = 64px = 两格；
- **例外**：一个刚构造出来的 `Role`，第一段移动要 8 次触发（64px = 两格）
  才遇到第一个可停点。（`Role.walk` 的 `count` 初值为 0、`nextStep` 初值为
  false，走的是 0→7 那条 8 拍的分支。）

所以"到了目标格再松手"必然多走一格。规划器改成**提前一格松手**；跑步先跑到
剩 3 格以内就松手，再切走路收尾。每段结束后重新判位，不对就再补一段 ——
补段总是精确的 1 格，必然收敛。上面那个"第一段两格"的例外因此表现为
一次过冲加一次回退，在 trace 里看得见（`dorm-walk` 的 t=0..98）。

被挡住有两种形态，都要硬失败：一段走完位置没变；以及按着方向键 1.5 秒
没挪窝（这种情况松手条件永远不满足，不专门拦就只会报一句"超预算"）。

## trace（输出）

UTF-8 JSON，LF 换行，写到 `tools/traces/out/<name>.trace.json`，**入库**。
每个 tick 一行，便于 `diff` 直接指出第一个偏离的帧号。

```json
{
  "format": "xianlin-trace/1",
  "driver": "scene",
  "script": { "...剧本原样回显..." },
  "tickCount": 538,
  "ticks": [
    {"t":0,"vt":0,"ip":0,
     "input":[{"e":"press","k":"right","ctrl":false}],
     "role":{"x":12,"y":8,"px":384,"py":256,"dir":"down","frame":0,
             "runFrame":0,"running":false,"moving":true,"stepNum":0},
     "npcs":[{"x":9,"y":8,"px":288,"py":256,"type":1,"dir":9,"frame":0}],
     "dialogue":{"active":false,"source":"none","type":1,"head":0,"name":null,
                 "sentence":null,"cursor":0,"row":0,"col":0,
                 "printing":false,"sentenceOver":false,"pageOver":false},
     "narratage":{"active":false,"over":true,"line":0,"cursor":0,"row":0,"bg":0},
     "scene":"宿舍.txt","isScript":false,
     "audio":{"bgm":"舒缓.mp3"},
     "viewport":{"offsetX":0,"offsetY":0,"firstTileX":0,"lastTileX":128,
                 "firstTileY":0,"lastTileY":80},
     "drawOrder":"hero-first"}
  ]
}
```

| 字段 | 来源 |
|---|---|
| `every` | 剧本自报的取帧密度，**剧本没写就整行不出现**。回显的是剧本自报值而不是这一趟真正生效的值 —— trace.json 必须与命令行怎么敲无关，否则 `tools/compare-frames.sh --every 5` 跑一次就会把它与入库真值的 `cmp` 判成"原版侧行为已偏离"。 |
| `driver` | **驱动器判别名**：这份真值是原版哪个面板导出来的。场景是 `scene`；战斗 / 菜单 / 商店各有各的。由 `TraceDriver.kind()` 报出，不是导出器按剧本猜的 —— 「装配哪一套」与「是谁导出的」必须是同一件事。 |
| `t` / `vt` | tick 序号 / 虚拟毫秒（`t * tickMs`）。 |
| `ip` | 当前执行到剧本的第几条指令。比对失败时用来定位是哪一段。 |
| `input` | **本 tick 实际喂给原版的按键事件**。Web 侧照着回放即可，不必重新实现规划器 —— 声明式指令负责编写，`input` 负责复现。 |
| `role.x/y` | 格子坐标（`Role.getX()/getY()`，即像素除以 32）。 |
| `role.px/py` | 像素坐标。格子坐标一格变一次，太粗，比对不出错位。 |
| `role.dir` | `down` / `up` / `left` / `right`（原版是 0/8/16/24）。 |
| `role.frame` | `Role.count`，行走图的帧号（`walkImages.get(direction + count)`）。 |
| `role.runFrame` | `Role.count2`，**跑步图**的帧号（`runImages.get(direction / 2 + count2)`）。它没有 getter，导出器走反射读（xl-u39）。少了这一笔，"跑动中画的是哪一帧"在逐 tick 比对里完全看不见，只有像素流水线抓得到。 |
| `role.running` | `Role.isRun()`。 |
| `role.moving` | 走或跑的定时器是否在跑。 |
| `npcs[].dir` | NPC 的方向仍用原版编码（1 左 / 5 右 / 9 下 / 13 上），这就是脚本数据里的写法。 |
| `dialogue.source` | `npc`（口头语）/ `script`（主线）/ `none`。 |
| `dialogue.cursor/row/col` | 逐字打印的游标：第几个字、第几行、第几列。 |
| `dialogue.pageOver` | 一屏 4×20 打满、等玩家翻页。 |
| `narratage.line/cursor/row/bg` | 第几句 / 第几个字 / 第几行 / 背景动画帧。 |
| `scene` | `ScenePanel.fileName`，当前这一 tick 走的是哪个脚本。出口生效的那一 tick 它就变了 —— 只记主角坐标的话，"切到了大地图"与"在原地被瞬移"分不开。 |
| `isScript` | `ScenePanel.isScript`。出口的三条分支各自把它置成什么，是可断言的（见 `scene/ExitEvent.java`）。 |
| `audio.bgm` | `MusicPlayer.currentPlayingBGM`。是一个可断言的字符串，不是"调用了 play()"。 |
| `viewport` | `OtherEvent.calOffset()` 算出的六元组，对应 spec 里的 `computeViewport`。 |
| `drawOrder` | `npcs-first` / `hero-first`，对应 spec 里的 `computeDrawOrder`。**旁白期间是 `null`** —— 原版 `paint()` 里主角与 NPC 的绘制整个在 `if (!narratage.isNarratage)` 里面，那些帧没有绘制顺序这回事。 |

### 回放端拿 `driver` 做什么

取图页（`web/src/replay/main.ts`）进门先按这个字段从装配表里挑一套
（`web/src/replay/drivers.ts` 的 `pickAssembly`）：建什么世界、用哪个渲染器、
叠哪些 DOM 层，各驱动器各一套。

**挑不出来是硬失败，而且要点名。** 未实现的驱动器如果被跳过，那条剧本比出来
的是「零帧差异」—— 和「两端完全一致」长得一模一样，整条流水线的判据就废了。

这件事现在有**三道**（xl-1vu.7），因为它有三种走法：

1. **分流**（`scripts/compare.ts`，开浏览器之前）。它拿帧清单里的 `driver` 与
   `src/replay/implemented.ts` 那份名单比，装配不出来的剧本压根不取图，报告里
   单独一段点名剧本、判别名、原因与归属票号，并计入非零退出（**退出码 1**）。
   为什么要提前分流：撞上去的话，撞到第一条就整轮中断，后面那些能比的场景剧本
   一帧都比不成 —— 默认全跑时按字典序第一条正好是 `battle-em3-box`。
2. **对撞**（`src/compare/unassembled.ts`）。名单与 `src/compare/expected.ts`
   的表态**两个方向都要对得上**：表说比得了而页面装不出（那笔账是编的）、
   页面装得出而表还写 `unassembled`（面板做好了而表没改）—— 都抛。
   进 CI 的是 `src/compare/unassembled.test.ts`，不需要 Java 与 Chrome。
3. **兜底**（`replay/drivers.ts` 的 `pickAssembly`，页面里）。真走到取图页还
   装不出来，就抛；异常经 `scripts/cdp.ts` 的 `evaluate` 转成 Node 侧的 Error，
   再由 `main().catch` 变成**退出码 2**。

实测（2026-09-06，把 `tools/traces/compare/dorm-walk/java/trace.json` 的判别
字段改掉，跑 `pnpm exec vite-node scripts/compare.ts -- dorm-walk --skip-capture`
—— **必须绕开 `tools/compare-frames.sh`**，它会重跑 Java 导出把改动覆盖掉）：

- 改成 `"battle"` → 退出码 2，`dorm-walk：帧清单说 driver=scene，旁边那份 trace.json 说 driver=battle。`
- 整行删掉 → 退出码 2，`…/java/trace.json 的前 4096 个字节里没有 driver 字段`

帧清单与它旁边那份 trace 是同一次导出的两个产物，判别名必须一致：分流读清单、
取图页读 trace，只核一头的话，改另一头就能让两边各按各的认知跑下去。

判别名**没有默认值**。默认成 `scene` 等于把一份来路不明的真值当场景真值回放。

## 确定性是怎么做到的

这是整件事唯一的技术难点。原版把时间摊在三个地方，没有一处是可重复的：
17 个 `javax.swing.Timer` 挂在 Swing 的 `TimerQueue` 上、主循环是
`while(true){ ...; Thread.sleep(10); }`、`paint()` 在 EDT 上另跑一条线。

1. **定时器**。`tools.Clock.freezeTimers(base)` 让 `Clock.delay(x)` 返回
   `base + x`（base = 24 小时），真实 `TimerQueue` 在一次导出里绝无可能触发；
   之所以是 `base + x` 而不是一个统一大常数，是为了让导出器能从
   `timer.getDelay()` 反算回原始间隔。随后每个 `Timer` 对象被换成
   `devtools.VirtualTimer`，`start/stop/restart/isRunning` 全部改挂虚拟时钟。

   为什么必须**换对象**而不是在外面记一张到期时间表：外部记账只看得见
   `isRunning()` 的状态，看不见调用本身，到期时间只能从状态变化去*推断*。
   而 Swing 这两个方法的语义正好相反，推错了不会报错，只会让动画不动：

   - `start()` 对已经在跑的定时器是**空操作**（`TimerQueue.addTimer` 直接
     忽略已入队的定时器），到期时间不变；
   - `restart()` 才是 `stop()` + `start()`，会重新计时。

   实测（openjdk 17，一个 100ms 的定时器，每 10ms 调一次，持续 1 秒）：
   反复 `start()` 触发 8 次，反复 `restart()` 触发 0 次。

   这条区别是有后果的：`NPCEvent.checkNPCStop` 对 type==2 的 NPC 是**无条件**
   `action.start()`，而主循环每 10ms 走一次。按真实语义那个原地动画照常播。
   本工具第一版把 `start()` 写成了重新计时，结果三份 trace 里所有 type==2 的
   NPC 都被记成永远停在第 0 帧 —— 导出成功、退出码 0、`--check` 也全绿，
   是代码审查按 JDK 语义反查才发现的。

   冻结必须在任何一个 `Timer` 被 new 出来之前生效：NPC 的两个定时器是在
   构造函数里 `start()` 的，而构造完 NPC 之后 `Dialogue` 还要读 91 张头像图，
   那期间足够真实定时器触发好几次。

2. **主循环**。`ScenePanel.run()` 的循环体已整块提取为
   `ScenePanel.step()`（只去掉一层缩进，语句一条未改），导出器每 tick 调一次，
   不起那个线程。`run()` 仍是运行时唯一的调用方。

3. **顺序**。原版里按键、定时器、主循环、绘制的相对顺序本来就是竞态的。
   导出器固定为 **输入 → 定时器 → `step()` → `paint()`**。
   这个顺序就是 Web 侧要对齐的语义。

4. **绘制**。`paint()` 有副作用（对话文本里的 `@` / `$` 会改状态机），
   所以每 tick 真的调一次，画进一张离屏图，不省。

5. **反射字段顺序**。`Class.getDeclaredFields()` 的顺序未经规范保证，
   一律按字段名排序后再用。

### 验证

`tools/export-trace.sh --check` 把每份剧本导两遍，`cmp` 两份产物；**它自己逐行
打出每份的字节数，那就是名单**——这里不抄，上面那一节里的转录块也只是一份带
日期的历史读数，不是当前名单。确定性只是两条判据里的一条 —— 另一条是重导之后
`git diff tools/traces/out` 为空，理由见那一节。

还有一处未做结构性隔离的真实时间依赖：`MusicPlayer.play()` 开头有
`while (!hasStop) { Clock.sleep(10); }`。`MusicReader.closeBGM()` 并不能
阻止它 —— `play()` 根本不看 `CAN_PLAY_BGM`，照样开音频设备、起播放线程，
只有播放线程自己在第一次 write 之前退出。`hasStop` 初值为 true，所以实测
从未自旋；但这取决于宿主机的音频设备，要做成结构性保证得给 `MusicPlayer`
加桩，那要改 `src/`。`audio.bgm` 本身是准的：`currentPlayingBGM` 在这一切
之前就已设好。

## 战斗剧本与战斗 trace（`driver: "battle"`）

战斗面板与场景面板在这套设施里只共用三件事（推进一步 / 快照状态 / 快照位图，
即 `TraceDriver`），别的都不一样：没有格子、没有主角、没有定时器，输入是鼠标。

### 剧本

```json
{
  "name": "battle-min",
  "driver": "battle",
  "background": "image/背景图/伏魔山树林.png",
  "party": ["zhang", "yu", "lu"],
  "level": { "zhang": 5, "yu": 5, "lu": 5 },
  "enemies": ["怪物1/5", "怪物2/6", "怪物2/7"],
  "seed": 20260906,
  "tickMs": 100,
  "maxTicks": 3000,
  "steps": [
    { "op": "command", "button": "attack", "budget": 400 },
    { "op": "target", "enemy": 1, "budget": 50 },
    { "op": "autoAttack", "until": "victory", "max": 2000 }
  ]
}
```

| 字段 | 含义 |
|---|---|
| `background` / `enemies` | 就是 `script/*.txt` 里 `Fight` 那一行的第一列与后三列。怪物写法 `名字/编号`，编号必须是 5/6/7（原版 `Enemy.initial` 按它定站位：5 中 / 6 上 / 7 下）。空槽位写 `null`，但三个槽位要写满。 |
| `party` / `level` | 出战的我方单位与各自的等级。**等级没有默认值**：三个人的原版默认等级各不相同（张小凡 1 / 文敏 3 / 陆雪琪 1），而这份真值里每一个伤害数字都是从这里算出来的。 |
| `skillNumber` | **可选**，技能菜单上给谁画几颗按钮，也就是 `ZhangXiaoFan.skillNumber` 等三个 **static** 字段（xl-rh9.14）。整个不写就一个字都不碰，用原版那三个字段的初值 **2 / 3 / 2**，而且**真值头里也不回显它** —— 老真值因此逐字节不变。写了的键必须在 `party` 里，取值 1..5。<br>为什么必须由剧本给：那三个字段只由 `levelUp()`（胜利结算）与 `intialFromInfo()`（读档）改，导出器只写 `level = n`，构造函数一个字都不碰它 —— **等级再高，菜单上仍然是那几颗**，第 3/4/5 颗被 `SkillMenu.checkReleased` 里的 `if(skillNumber>=n)` 守着。 |
| `seed` | `Math.random()` 的种子。伤害、怪物选招选人、状态命中全走它。 |
| `tickMs` | 只能是 `100` —— `BattlePanel.run()` 的循环周期就是 `Clock.sleep(100)`。 |

指令词汇：

| 指令 | 参数 | 语义 |
|---|---|---|
| `command` | `button` | 点控制台的一个按钮（`attack`/`skill`/`defend`/`thing`）。菜单在预算内没出来 —— 硬失败。 |
| `target` | `enemy` | 点某个怪物（1/2/3）。槽位空着、或者点下去 `currentBeAttacked` 没变 —— 硬失败。 |
| `autoAttack` | `until`, `max` | 「能点击就点『击』，能选敌就选第一个还站着的怪物」，一直打到分出胜负。`until` 是 `victory`/`defeat`/`decided`；打成了别的结局，或者跑满 `max` 步还没分出来 —— 都是硬失败。 |
| `skillMenu` | `button` | 点技能菜单上的一颗按钮（`skill1`..`skill5` / `return`）。菜单没打开就等；等到超预算是硬失败。这一场只有几颗按钮由 `<主角>.skillNumber` 那个静态字段的初值定（2/3/2），点一颗不存在的 —— 硬失败。 |
| `drugMenu` | `button` | 点药品菜单上的一颗按钮（`drug1`..`drug6` / `return`）。同上。 |
| `autoUntilRound` | `round`, `max` | 像 `autoAttack` 那样自动打，直到**控制台出现在指定回合上**（1 张 / 2 文 / 3 陆）为止，到了就停手、这一拍不点任何东西。跑满 `max` 步 —— 硬失败。 |
| `autoUntilAngry` | `round`, `max` | 同 `autoUntilRound`，外加一个条件：那个人的**怒气已经攒满**（`isAngry`）。秘术（`command` 点 `defend`）只有攒满才点得下去 —— `Command.checkReleased` 里 `if(bp.zxf.isAngry){…}else{bp.reminder.show(21)}`，没攒满就只弹一张 22.png 的提示图、控制台还开着，而「点了防、什么都没发生」与「放了秘术」在剧本里长得一模一样。要挨几下才攒满由伤害掷出来多少决定（`angryValue` 攒到 `hpMax*0.8`），写不成固定的回合数。 |
| `awaitExit` | `panel`, `max` | 等原版自己把面板切走，并断言切到了哪一块（`panel` 是 `GameLauncher` 那八张 `CardLayout` 卡片名之一，打输能走到的是 `scenePanel` / `startPanel`）。切到别的一块、或者跑满 `max`（默认 300）还没切 —— 都是硬失败。 |
| `wait` | `ticks` | 空等（与场景共用）。 |

`autoUntilRound` 存在的理由与 `autoAttack` 是同一条：**谁先跑满行动条由速度
与种子决定，写剧本的人事先不知道。** 而"点技能菜单上的第二颗"是**认人**的
—— 张小凡的第二颗是浪里寻花（给怪挂体力下降），文敏的第二颗是追星破月
（给自己挂敏捷提升），两条路数完全不同。把回合序写死等于赌一次，而赌错了
导出的是一份"点了另一个人的技能"的真值：它有头有尾、步数像模像样、退出码 0。
`battle-min` / `battle-menus` 那一场实测**我方**的回合序是 **3 → 2 → 1**
（速度 13/10/9），中间夹着怪物的回合。

`autoUntilAngry` 是同一条理由再走一步：怒气攒满要挨几下，取决于每一发伤害掷出
多少。xl-rh9.14 的三份秘术剧本因此是「一个人硬扛」——**怒气的窗口只有两成血**
（`angryValue` 攒到 `hpMax*0.8` 才算满，而攒到 `hpMax` 人就倒了），所以每一发
伤害相对血量越小，余地越大。三份剧本各自都是扛到第八到十二下前后攒满、再挨两
三下就会倒，换个种子未必还站得住 —— 这不是判据松，是原版的设定就这么紧。

`autoAttack` 是**策略**而不是一串写死的点击，因为一场战斗要打几个回合取决于
每次伤害掷出多少 —— 写剧本的人事先不知道。写死次数只要少一次，导出的就是一份
"打到一半就停"的 trace，而它和一份打完的长得一模一样。

### 打输的两条出口，以及为什么停在 `defeat` 不算数

原版打输有**两条完全不同的出口**，判定只看**第一只怪的名字**
（`GameOver.update()`）：

```java
if(bp.em1.name.equals("罹年居士")){        // 剧情必败战 → 回地图
    GameLauncher.switchTo("scene");
    …  ZhangXiaoFan.hp=ZhangXiaoFan.hpMax/2;  YuJie.hp=YuJie.hpMax/2;
}else{                                      // 普通全灭 → 回标题
    GameLauncher.switchTo("start");
}
```

它**只看第一只**：那个名字排在第二或第三个位置时照样回标题。而
`gameOver.isDraw` 置真只是全灭图**开始**对开的那一刻 —— 真正分岔的那一句在
**72 步之后**。这个 72 是量出来的（三份真值 `261-189`、`177-105` 与
`100-28` 都是 72），
算术也对得上，但要数清楚三处：

1. `GameOver.update()` 每拍把全灭图对开 8px，`512/8 = 64` 拍之后 `lsx2==512`；
2. 第 64 拍**同时**进第二个 `if`（两个 `if` 是并列的，不是 else），`code` 从
   0 变 1；再 9 拍数到 10，所以切面板发生在第 **73** 次 `update()` 上；
3. 而第 1 次 `update()` 与「`outcome` 头一次变成 `defeat`」落在**同一拍**里：
   置位的 `Check.checkHeroDead()` 由 `launchAttack.check()` 在
   `BattlePanel.run()` 第 536 行调，`gameOver.update()` 在第 558 行 ——
   同一个循环体，前者在先。

73 次 update 减掉重合的那一拍 = 真值上的 **72 步**。

所以 `outcome` 变成 `defeat` 就收工，导出的是一份**两条出口都还没走**的真值：
它有头有尾、步数像模像样、退出码 0，而"分支写反了"与"分支写对了"在它里面
长得一模一样。三份真值都靠 `awaitExit` 一路记到那一次切面板为止：

| 剧本 | Fight 数据 | 步数 | 出口 | 末步 |
|---|---|---|---|---|
| `battle-defeat-scene` | `脚本22` 第 1 行（商塔顶层，`罹年居士/5`，另两槽空） | 262 | `scenePanel` | 张小凡与文敏 hp 回到 `hpMax/2` = 1680，陆雪琪仍是 0 |
| `battle-defeat-start` | `脚本37` 第 1 行（比武场，`罹年居士分身` ×3） | 178 | `startPanel` | 两人 hp 仍是 0，三个槽位全部 `onField=false` |
| `battle-defeat-slot2` | **合成**（比武场，`怪物1/5` + `罹年居士/6`） | 101 | `startPanel` | 同上：两人 hp 仍是 0，两个在场槽位 `onField=false` |

**前两份必须成对存在。** 只测一条时，"两条都走错边"和"分支写对了"是同一个
样子。第二份还额外钉住那个比较是**逐字相等**：「罹年居士分身」以「罹年居士」开头，
用 `startsWith` / `includes` 写的分支会把它也送回地图，而那个错在第一份里
看不出来。

**第三份堵的是"有没有"与"第一只"的区别**（xl-rh9.6）。前两份合起来仍盖不住
一种写错法：把判断写成"三个槽位里**有没有**罹年居士"而不是"**第一只**是不
是"。第一份的罹年居士本来就在第 1 槽，第二份根本没有罹年居士 —— 两种写法在
那两份里结果完全相同。

`battle-defeat-slot2` 把罹年居士挪到第 2 槽、第 1 槽放一只"怪物1"，于是两种
写法分岔：原版只看 `em1`，走 `startPanel`；写成"有没有"的实现会走
`scenePanel`，`awaitExit` 当场非零退出。

**它这一行怪物不取自原版的 Fight 数据**，因为原版 96 份脚本里没有任何一行
把罹年居士排在第 2/3 槽（它只出现一次：`脚本22` 第 1 行，独自一只）。剧本
格式本来就允许三个槽位随便填，怪物名也都是原版 `Enemy.initial` 认得的；破
"逐行取自原版数据"这个惯例是有意的，剧本的 `description` 里写明了。

实测过它确实在验（xl-rh9.6）：把 `src/battle/GameOver.java` 那一句改成
`em1 || em2 || em3` 三个槽位都比，重新导出三份打输真值 ——
`battle-defeat-scene` 与 `battle-defeat-start` 退出码 0、`git diff` 一个字节
都没有，`battle-defeat-slot2` 退出码 2 并打印"剧本要的出口是 startPanel，
原版切到的是 scenePanel"。`src/` 已按字节还原。

**观察点怎么装的。** `GameLauncher.switchTo` 走的是
`switcher.show(c, "xxxPanel")`，而导出器里 `GameLauncher` 从没被构造过 ——
`c` 是 null，`CardLayout.show` 会在 `run()` 线程上 NPE，而那条线程的
try/catch 只包住 sleep（xl-1dv.10），于是它静静地死掉、闸门永远等不到放行：
**导出挂死，而挂死看起来只是"跑得慢"**。所以 `BattleDriver` 把
`GameLauncher.switcher` 这个 public static 字段换成一个只记卡片名的
`CardLayout`（`PanelTap`）。换掉的是**画面切换这个动作**，不是决定切到哪一块
的那段判断 —— 那一句仍是原版自己的 `em1.name.equals(…)`，`src/` 一个字没改。

**出口没有单独的状态字段，这是有意的。** 切到哪一块只出现在 trace 头部的**剧本
回显**里（`script.steps[].panel`），由导出器当场判 —— 与场景那边的 `exitTo`
同形。理由是加一个状态字段要改 `snapshotState`，那会让**已有两份战斗真值**跟着
重导，而本票的验收标准之一正是"重导之后原有真值 git diff 为空"。

代价说清楚：读 trace 的人看到的是"剧本要求的出口"，不是"原版实际切到的出口"，
想复核得重跑一次导出器。但**分支走错在真值里照样露头**，靠的是后果那几列：

- 走 `scenePanel` 那条：张小凡与文敏的 `hp` 跳到 `hpMax/2`、`drawn` 转真，
  陆雪琪一个字段都不动；
- 走 `startPanel` 那条：谁的 `hp` 都不动，三个槽位的 `onField` 一起转假。

所以 xl-rh9.4 的"逐字段对上"抓得住走错边的实现。真要把出口提成一等字段，那是
一次会重导全部战斗真值的改动，单开票、连四份一起重导。

配套两道硬失败：

- **切了面板而当前指令不是 `awaitExit`** → 非零退出。切面板必须由剧本显式
  接住，否则那一步之后的状态（血量被改回半血、怪物被摘空）没有任何人在看。
- **剧本跑完时 `outcome` 是 `defeat` 而面板还没切** → 非零退出，不产出真值。
  这一条不靠写剧本的人记得加 `awaitExit`。**只拦 `defeat`**：打赢之后原版
  不会**当场**切面板 —— 结算、发钱、经验、升级要走完（卷轴 24 拍拉满，
  `timeCode` 数到 15 或 55），`VictoryReminder.update()` 才自己
  `switchTo("scene")`。`battle-min` 正正停在"胜利"第一次出现的那一刻，
  那一段一度没有真值覆盖（归 xl-rh9.5 的账）；**xl-rh9.13 的
  `battle-victory` 把它记下来了**：`autoAttack until victory` 之后接一条
  `awaitExit panel=scenePanel`，837 步一路记到那一次切面板。

  > ⚠️ **走这条路要先给导出器补三个静态引用**（xl-rh9.13 实测）。
  > `VictoryReminder.update()` 收尾那两处会不判空地写
  > `GameLauncher.zhangXiaoFan.isLevelUp=false`，而导出器里 `GameLauncher`
  > 从没被构造过。那条 NPE 抛在 `run()` 线程上、它的 try/catch 只包住 sleep
  > （xl-1dv.10），于是线程静静死掉、闸门永远等不到放行 —— **导出挂死，而挂死
  > 看起来只是"跑得慢"**（第一次导出跑了 7 分钟没有产物，退出码 0）。
  > `BattleDriver.start()` 现在无条件建三个我方角色并挂上去，与原版 `init()`
  > 一致；这三个类的字段几乎全是 static，多建一个不会换掉出战那位的数据 ——
  > 判据是重导之后 `git diff tools/traces/out` 为空（13 份既有真值实测为空）。

### 一步是什么

**一步 = 原版 `BattlePanel.run()` 的一次循环体 + 一次 `paint()`**，顺序
`输入 → 循环体 → paint()`。

场景那边是把 `run()` 的循环体提取成了 `step()`；战斗这边**不动 `src/`**，
改用一道闸门：`BattleDriver.Gated` 是 `BattlePanel` 的子类，只在调用者是
`run()` 那条线程时把 `repaint()`（循环体的最后一句，原版自己写的那一句）
闸住，由导出器逐步放行。跑的是原版一字未改的循环体，不是它的一份誊抄。

起手那一下：先 `Clock.setFactor(1e-9)` 把 `sleep(100)` 拉到约 11 天，于是
"构造面板 → 建人物 → `initial()`"整段期间那条线程一次循环体都跑不了 ——
否则第一次循环发生在 `initial()` 之前还是之后就成了竞态，而两种结果的 trace
都"看上去正常"。闸门装好之后 `interrupt()` 它一次，随后 factor 调到 `1e6`
（`sleep` 只剩 1ms）。**那次 interrupt 会在 stderr 上留一条
`InterruptedException`，是有意的**：`run()` 的 try/catch 只包住 sleep
（xl-1dv.10），打完照常往下跑。

随机源：把 `java.lang.Math` 私有的那个 `Random` `setSeed(剧本的 seed)`。
算法一字未动，改的只是起点。需要 `--add-opens java.base/java.lang=ALL-UNNAMED`
（`tools/export-trace.sh` 与 `tools/compare-frames.sh` 都给了）；不给的表现是
`BattleDriver` 当场非零退出并说明原因，不会静默导出一份每次都不同的真值。

### `paint()` 到底有没有副作用

**实测（2026-09-06，openjdk 17）：战斗面板的 `paint()` 对状态机没有副作用。**
同一场战斗跑两遍，一遍每步 `paint()`、一遍一次都不 `paint()`，426 步 ×
24 个可断言字段的逐步转储**零行差异**（两遍的胜负、步数、末帧血量也都相同）。

xl-1dv.5 记的"不调 paint 时 `command.isDraw` 是 0/120、调 paint 时 59/120"
复现不出因果关系：那次测量里 `run()` 线程是自由奔跑的，`paint()` 只是让取样
循环变慢，于是取到了更靠后的状态。**但 `paint()` 仍然每步都调** —— 位图本身
是这份真值的交付物，而"省一次绘制"正是那种省对了和省错了长得一样的优化。

### trace 的每一步记什么

```json
{"t":0,"vt":0,"ip":0,
 "input":[{"e":"click","x":514,"y":325,"target":"command:attack"}],
 "outcome":"undecided",
 "round":0,"pattern":0,"beAttacked":0,
 "bar":{"origin":300,"zhang":309,"yu":310,"lu":313,"pet":300,
        "e1":311,"e2":310,"e3":310,"stopped":false,"drawn":true},
 "heroes":[{"code":1,"hp":1260,"hpMax":1260,"mp":540,"mpMax":540,
            "angry":0,"isAngry":false,"dead":false,"speed":9,
            "drawn":true,"frame":1,
            "state":{"type":0,"rounds":0,"usable":false,"role":0,"x":0,"y":0}}],
 "enemies":[{"slot":1,"name":"怪物1","hp":250,"speed":11,"onField":true,
             "dead":false,"drawn":true,"frame":1,
             "state":{"type":0,"rounds":0,"usable":false,"role":0,"x":0,"y":0},
             "box":[100,220,124,172]}],
 "hurts":[{"value":186,"type":1,"x":60,"y":330,"drawn":true,"frame":1}],
 "ui":{"command":false,"skillMenu":false,"drugMenu":false,"selectable":false,
       "instruct":false,"reminder":false,"victory":false,"gameOver":false,
       "startAnim":true},
 "anim":{"skill":null,"skillFrame":0,"skillDrawn":false,"skillX":0,"skillY":0,
         "bg":null,"bgFrame":0,"bgDrawn":false},
 "reminder":{"image":null,"code":0,"stopped":true,
             "dx1":500,"dy1":120,"dx2":500,"dy2":120},
 "menus":{"skill":null,"drug":null},
 "audio":{"bgm":"B6.mp3"}}
```

菜单真的画出来的那几拍，`menus` 那两项才有内容：

```json
 "menus":{"skill":{"group":"yu","buttons":[1,2,1],"return":1,"returnY":316,
                   "introDrawn":true,"introImage":"文敏/2","introY":256},
          "drug":null}
```

| 字段 | 来源 |
|---|---|
| `outcome` | `undecided` / `victory` / `defeat`。分别由 `victoryReminder.isDraw` 与 `gameOver.isDraw` 判，**先判失败**。 |
| `round` / `pattern` / `beAttacked` | `BattlePanel.currentRound` / `currentPattern` / `currentBeAttacked`。三个数合起来就是战斗状态机：谁在行动、用哪一招、打谁（编码见那三个字段的原版注释）。 |
| `bar` | `ProgressBar` 的七个像素位置 + 起点 + `isStop`/`isDraw`。原版的行动条只有位置这一个量：谁先跑满 `origin+400` 谁行动。 |
| `heroes[]` | 我方，顺序同 `BattlePanel.heroes`。`speed` 取的是三个类各自的静态字段（接口里没有 getter）。 |
| `enemies[]` | **三个槽位一律写满**（空槽位是 `null`）。怪物死后 `em1/em2/em3` 会被置 `null`，但对象与 `hp` 都还在 —— `onField` 那一列负责说它还在不在场上。只记"场上还有谁"的话，最后一击打了多少就没地方看了。 |
| `enemies[].box` | 原版 `EnemySlector` 判鼠标命中用的那个矩形，照它写的取。 |
| `hurts[]` | `BattlePanel.hurtValues`。原版每算一次伤害就 new 一个塞进去，动画播完自己收摊 —— 这是"这一击打了多少"唯一的可断言出处。 |
| `ui` | 控制台 / 技能菜单 / 药品菜单 / 怪物选择器 / 指示器 / 提示 / 胜利提示 / 全灭图 / 开场动画，九个 `isDraw` 类标志。 |
| `anim` | 技能动画与背景动画的名字、帧号、坐标。 |
| `<单位>.state` | 一个 `BattleState`。`x`/`y` 是 xl-rh9.11 补的 —— 状态图标就画在这两个数上，而 `clear()` **不清它们**（留着上一次的值）。`successRate` 不记：`set()` 只把它当入参读，那个字段恒为 0。 |
| `reminder` | 提示图（xl-rh9.11）。画没画在 `ui.reminder` 里，这里是**画的是哪一张**与那个会张开的目标矩形。⚠️ `image` 是**文件号**：`show(i)` 取的是 `images.get(i)`，而 `images` 装的是 `1.png`..`22.png`，所以 `show(19)` 画的是 `20.png`。源矩形 `(0,0)-(128,24)` 与 `centreX/centreY` 是构造函数里的常量，不记。 |
| `menus` | 技能菜单与药品菜单（xl-rh9.11）。**只在真的画出来那几拍才有内容**，其余是 `null` —— 两个菜单加起来二十来个字段，逐拍写满等于给每份真值凭空加上两千行恒定值。`buttons` 是每颗按钮现在贴的三张里的哪一张（1 常态 / 2 待点 / 3 按下），按**引用身份**认，认不出是硬失败。`skill.returnY` 落在 `226 + 按钮数×30` 上，而按钮数是 `skillNumber` 那个静态字段的初值（2/3/2），与等级无关。 |

### 真值里能看见的原版缺陷

真值的职责是记录原版做了什么，不是记录它应该做什么。**导出器一处都不修**：

- **xl-1dv.9 `Enemy.hp` 可为负。** 致命一击会打过头，而 `Check.checkEnemyDead`
  只判 `<=0` 就把怪物摘掉，从不夹到 0。`battle-min` 末帧三个槽位是
  `-12 / -88 / -84`。
- **xl-1dv.8 `EnemySlector` 判第三个怪物时用了 `height1`。** `box` 的第三项
  因此取的是第一个怪物图片的高。**在 `battle-min` 这一场里它是潜伏的**：
  `怪物1` 与 `怪物2` 的图片都是 172 高，`height1` 恰好等于真实的 `height3`，
  看不出差别 —— 写对了和写错了导出来的数完全相同。
  **`battle-em3-box` 就是为此补的那一场**（xl-1vu.10，取自 `script/脚本20.txt`
  第 3 行的 Fight 数据：`武林高手2/5 商塔弟子/6 商塔护法/7`）：em1 的图 188×220、
  em3 的图 124×172，于是 `enemies[3].box` 记成 `[60, 330, 124, 220]` —— 框高比
  这只怪真实的 172 多出 48px。判据在 `web/src/state/battleEnemyBox.test.ts`，
  它是双向的：框高不再等于 `height1` 会红，而**一份 em1≠em3 的真值都没有**
  也会红（那说明缺陷又变回不可观测了）。
- **xl-1dv.6 `initial()` 只 add 不 clear。** 同一个 JVM 里连开第二场会带上第
  一场的残留，所以**一份剧本 = 一个 JVM = 一场战斗**。这是绕开，不是修。

打输那两场（xl-rh9.3）又露出四条，都在 `GameOver.update()` 那段里：

- **回地图那条分支不复位陆雪琪。** 它只动 `zxf` 与 `yj`（各回 `hpMax/2`、
  `isDraw=true`、`deadAnimation.isDraw=false`），`lxq` 一个字段都不碰 ——
  只有回标题那条分支才把三个人一起处理。`battle-defeat-scene` 末步照实记着：
  `heroes` 的 hp 是 `1680 / 1680 / 0`，前两个 `drawn=true` 而陆雪琪
  `drawn=false`。
- **两条分支都不把 `isDead` 清回 false。** 复活的两个人末步是
  `hp=1680, dead=true` —— 血回了、人还标着死。清 `isDead` 的是**下一场战斗**
  的 `BattlePanel.initial()`（它对还标着死的人 `setDead(false)`，hp 为 0 的
  再补到 `hpMax` 的 10%）。所以从回地图到下一场开打之间，队伍带着
  `dead=true` 在地图上走。
- **回地图那条分支没有 null 检查。** `bp.zxf.deadAnimation` 与
  `bp.yj.deadAnimation` 都是直接点下去的，而回标题那条分支三个人各有一层
  `if(…!=null)`。所以一场第一只怪叫「罹年居士」、却没让张小凡或文敏出战的
  战斗，打输就是 NPE。**这一条在真值里是潜伏的** —— `脚本22` 那一场三个人
  都在，触不到；它是读源码读出来的。
- **`hp` 是静态字段。** `ZhangXiaoFan.hp=ZhangXiaoFan.hpMax/2` 写的是类字段，
  不是那个实例的。全局只有一份队伍，这在原版里成立；web 端照抄行为即可，
  不必照抄这个存储方式，但**回半血的时机与数值要一致**。

### 回放端

`web/src/replay/main.ts` 的装配表**装得出哪几支，由 `web/src/replay/implemented.ts`
的 `IMPLEMENTED_DRIVERS` 说了算**（别在这里抄一份名单——M2 接上战斗之后它就
不再只有 `scene` 了）。装不出的那几支，
真值在跨端比对里被**分流**挡在取图之前。

下面是这套分流刚落地时的实测（**2026-09-06 的历史读数**，当时装配表确实只有
`scene`；今天拿 `battle-min` 跑不再是这个输出，换一条 `menu-*` / `shop-*`
剧本才是）：

```
一条剧本都没比成 —— 这一趟没有任何像素被比过。

web 侧还装配不出来的剧本 1 条 —— 这一趟它们一帧都没比过：
  装不出  battle-min      driver=battle  web 侧还没有战斗面板，取图页装配不出 battle，整条流水线在这条剧本上硬失败 · 归 xl-82c
  取图页现在实现了：scene。
退出码=1
```

这正是要的行为 —— 一条没被装配的剧本比出来是"零帧差异"，和"两端完全一致"长得
一模一样。**接上战斗装配是 M2 的事，xl-1vu 这个 SPEC 不做**（已由 xl-rh9 下
的一批票做完；菜单与商店仍等 M3 xl-6lo / M4 xl-knp）。

## 菜单剧本与菜单真值（`driver` = `menu`）

上面整套讲的是场景驱动器。菜单是第二支（xl-1vu.5），**一步 = 一次输入事件，
不是一个 tick**。

`MenuPanel` 只有 133 行，是个 `CardLayout` 容器，既没有 `run` 循环也没有 `paint`
覆写；真正画东西的是底下物品 / 装备 / 奇术 / 天书四个 `FatherPanel`。这四个面板
唯一的时间驱动是各自那条 `while(true){ Clock.sleep(100); update(); mouse.update();
repaint(); }` 线程，它推的只有鼠标图标的循环帧与奇术页那段技能动画；菜单里所有
**可断言的状态变化**（切页、切人、选中、装备、属性重算）无一例外由一次鼠标事件
同步引起。把它硬套成逐 tick 真值，得到的是一长串一模一样的行。

### 剧本

```json
{
  "driver": "menu",
  "name": "menu-equip",
  "description": "一句话说明这份剧本覆盖什么",
  "setup": {
    "party": ["zhang"],
    "fullHeal": true,
    "equipment": [{ "name": "铁甲", "count": 1 }],
    "drugs": [{ "name": "金创药", "count": 2 }]
  },
  "maxSteps": 200,
  "steps": [
    { "op": "tab", "name": "equip" },
    { "op": "slot", "name": "weapon" },
    { "op": "select", "index": 1 },
    { "op": "use" }
  ]
}
```

`driver` 缺省是 `scene`。这是导出器**唯一**的宽容之处：五份场景剧本都写在这个
字段之前，给它们补一个字段等于改剧本回显，五份真值要跟着重导。认不出的名字一律
硬失败。

| 指令 | 参数 | 展开成 | 语义 |
|---|---|---|---|
| `tab` | `name` = `thing`/`equip`/`magic`/`func` | 按下 + 松开 | 点顶栏四个标题之一 |
| `hero` | `n` = 1/2/4 | 按下 + 松开 | 点卷轴上的头像切人（3 号宋大仁原版没做进菜单） |
| `slot` | `name` = `weapon`/`armor`/`helmet`/`shoe`/`glove`/`decoration` | 按下 + 松开 | 装备页的六个分类 |
| `select` | `index` | 一次 `mouseMoved` | 把鼠标移到当前列表第 index 行（从 0 起） |
| `use` | — | 按下 + 松开 | 点"使用" |
| `abandon` | — | 按下 + 松开 | 点"弃用" |
| `skill` | `n` = 1..5 | 按下 + 松开 | 点奇术页当前角色的第 n 个技能按钮 |
| `tick` | `n`（缺省 1） | n 步，一步一次 | 显式推 n 次 `FatherPanel.run()` 的循环体（见下面「tick」） |

**坐标一律不写在剧本里。** 驱动器从原版按钮对象自己的 `x/y/width/height` 反算
落点（命中判据抄自 `GameButton.isPressedButton`，含原版那个 `-15/-6` 的偏移），
然后**核对结果**：按下之后那个按钮必须 `isclicked`，松开之后必须不再 `isclicked`，
`select` 之后选中的必须真是第 index 项。不核对的话，一次点空会导出一份步数完全
正确、却什么都没发生的真值。

`setup` 是**开局状态**，不是期望值：原版所有装备与药品的初始持有量都是 0
（只有商店与剧情事件会加），不给点东西装备页永远是空的。加的路径是原版自己的
`EquipmentPack.addEqupment` / `DrugPack.addDrug`，加完核对数量真的涨了 ——
那两个方法是"名字对上才加"，名字打错时一声不响。`fullHeal` 补的是另一个坑：
无参的 `MenuPanel` 构造函数里那三个英雄走的是空构造函数，静态的 `hp/mp` 因此
停在 0（只有带 `BattlePanel` 的构造函数会拉满）。

### 真值

每一步记：`panel`（当前子面板）、`hero`（卷轴选中谁，天书页没有卷轴故为 `null`）、
`heroes[]`（三个人的等级 / 体力 / 敏捷 / 武力 / 精气 / hp / hpMax / mp / mpMax /
防御 / 技能防御 / 技能数）、`equip`、`drug`、`magic`、`func`、`mouse`、`music`。

| 字段 | 来源 / 陷阱 |
|---|---|
| `equip.list` | 当前分类里画得出来的那几项。**从 `currentList` 现算**，不读 `EquipPanel.list` —— `drawEquipment()` 每画一帧就往里 `add` 一遍而从不清空，几步之后它是一份不断变长的重复列表。 |
| `equip.selected` | `currentEquipment` 在上面那份列表里的下标。**用完最后一件之后是 `-1`**：原版让 `currentEquipment` 继续指着一件 `numberGOT` 已经是 0、列表里不再画出来的装备。 |
| `equip.warnEquipped` / `warnCannotUse` | 两条拒绝路径：身上那一格已经有装备 / 这件不是当前角色能用的（`Equipment.user`）。**必须在 `paint()` 之前抓** —— `drawWarning()` 会把这两个标志清零，放到 paint 之后读永远是 0，得到一份"从没发生过拒绝"的真值。 |
| `equip.diff` | 装备页中间那四个升降数字。取的是四个 `ShowValue` 对象自己的 `value`/`type`，**不是 `EquipPanel` 上那四个 `showPP/showAngile/...` 字段**：`showValueDifference()` 的 else 分支（身上那一格是空的）把绝对值直接传进 `ShowValue.show()`，一个字段都不写，于是字段里留着上一次的陈值。`signal != 1` 时记 `null` —— 那一整段（算差值 + 画四个箭头）都在 `if(signal==1)` 里面。 |
| `magic.animation` | 开局**不是** `null`：`addMagicAnimation()` 用同一个临时字段建了 20 个动画，循环结束时它停在最后一个（文敏第 5 技能）上，于是刚进奇术页就画着那一条说明。照记不改。 |
| `func.drawn` | 天书页当前画得出来的按钮，按字段名排序。 |
| `input` | 与场景同形，但菜单多一种条目：`tick` 步记的是 `[{"e":"tick"}]`。**它不是一次输入事件**，是"推一次 `run()` 的循环体"这个时钟脉冲 —— 回放端遇到它要推自己那条循环，而不是往面板喂事件。 |
| `music` | 这一步触发的音效文件名，按调用先后排列（`["换list.wav"]`）。空数组 = 这一步原版不出声。见下面「音效」一节。 |
| `mouse` | 四个子面板**各自**那个 `Mouse`（四条 run 线程各推各的，只有当前页画得出来）。每个记 `code`/`frame`/`x`/`y`。**`code` 与 `frame` 是两回事**：`code` 是"下一格拿哪张图"的计数器，`frame` 是这一帧真的画出来的那张的下标。`Mouse.update()` 先取图再自增，且 `code==8` 那一次只把 code 拨回 1、**不换图** —— 于是第 0 张只在开局出现一次、第 7 张连画两帧。只记 `code` 的话这两件事在真值里都看不见。|

### 音效：`music` 字段（xl-1vu.8 立的，xl-1vu.11 收的）

菜单与商店真值各记一个 `music` 数组：**这一步请求播放了哪些音效文件**。它是
M3 / M4 判断「该不该响、响哪一个」的唯一依据。

观察点**不是** `MusicPlayer.filename`。原版那行 `filename = name` 落在
`playmusic` 的 `if (CAN_PLAY_MUSIC == YES)` **里面**，而导出真值时音效必须关掉
（每次点击都开一次音频设备、起一条播放线程，两遍导出不可能逐字节一致；
`ExportTrace.main` 开头对**所有**驱动器统一 `CAN_PLAY_MUSIC = NO`），一关就
一个字都观察不到。开关不能打开，所以换了观察点：`MusicReader.readmusic` 的
入口，也就是那个判断**之外**。src/ 侧是 `tools.MusicLog`（诊断类改动，默认
关闭时 `record()` 第一行就 return），驱动器侧是 `devtools.MusicTap`。

**接一支新驱动器要写的是两行**（xl-1vu.11 之前是六处逐字重复，menu 与 shop
各抄一遍）：

    1. start() 的最后一行： MusicTap.arm(script.name);
                            （剧本可以全程不出声的用 armAllowingSilence）
    2. snapshotState() 里：  b.append(",\"music\":").append(MusicTap.json());

其余全在公共的那一处：`MusicTap` 是静态的（观察点 `tools.MusicLog` 本来就是
全局的，一次导出一个 JVM、一支驱动器、跑完就 `System.exit`），逐步取走
（`afterStep()`）与跑完的自检（`requireRecorded()`）由 `ExportTrace` 的
导出循环调，驱动器一个字都不写。

**这个字段的失败形态是空数组，而空数组同时是「本来就不响」的正常取值** ——
失败长得和成功一模一样。所以有四道会硬失败的检查，都在 `MusicTap` 里：

1. **探针**（`arm()`）。打开记录之后当场 `readmusic("__musictap-probe__.wav")`，
   必须恰好 drain 回这一个名字。走的是游戏自己的入口，不是直接调
   `MusicLog.record` —— 直接调就绕开了要验的那截接线。观察点哪天被挪回
   `CAN_PLAY_MUSIC` 判断里面、或者 `MusicReader` 里那行调用被删掉，这里立刻
   退出码 2。**实测**：把那行删掉重导 `menu-equip`，退出码 2，报「音效观察点
   没接上 —— 探针 … drain 回来的是 `[]`」。
2. **整份至少响过一次**（`requireRecorded()`）。分母固定，可数。**实测**：
   在 `arm()` 之后插一行 `MusicLog.setRecording(false)`（模拟记录被悄悄关掉），
   退出码 2，报「整份真值一个音效都没记到」。剧本确实可能全程不出声（见下面
   场景那一段），那种要显式写 `armAllowingSilence()`，而不是把这道检查删掉。
3. **写了字段却没 `arm()`**（`json()`，xl-1vu.11）。收拢成两行之后新的错法是
   「抄了 `snapshotState` 那行、忘了 `start()` 那行」—— 那样每一步都会安静地
   写 `[]`，又是一次失败长得像成功。**实测**：给 `SceneDriver` 只加第 2 行、
   不加第 1 行重导 `dorm-walk`，退出码 2，报「有人在真值里写 music 字段，
   却从来没调过 MusicTap.arm()」。
4. **取样顺序**（`json()` 要求本步已 `afterStep()`，xl-1vu.11）。「`afterStep()`
   排在 `step()` 之后、`snapshotState()` 之前」这条契约此前只靠一句注释，而把那
   两行对调，前三道全绿、`--check` 两遍照样逐字节一致，只有整份真值整体错位一步
   （读数见下一段）。这道检查把它变成退出码 2。

下面这种错法前三道都拦不住（第 4 道就是为它加的），靠的是重导之后 `git diff tools/traces/out`：把
取样点从 `step()` **之后**挪到 `step()` **之前**，导出退出码仍是 0、`--check`
两遍仍逐字节一致，但每一步的音效整体**错位一步**（`换list.wav` 从按下那一步
跑到松开那一步）。又一次「一个稳定的错误在 `--check` 眼里和正确一模一样」。
**实测（2026-09-07，xl-1vu.11）**：在 `ExportTrace` 的导出循环里把
`MusicTap.afterStep()` 挪到 `driver.step()` 之前重导，三份真值全变 ——
menu-equip 28 步、menu-magic 4 步、shop-trade 32 步，每一声都晚一步落地
（menu-equip 的 `换list.wav` 从 t=0 挪到 t=1，两声 `禁止.wav` 从 t=6/t=10
挪到 t=7/t=11）。`--check` 那一关照样报三份「确定性 OK」。

**取样点必须在 `paint()` 之后，因为原版的 paint 真的出声。**
`EquipPanel.drawWarning()` 里有两处 `readmusic("禁止.wav")` —— 就在把
`isEquiped` / `canBeEquiped` 清零的那同一段里。实测（2026-09-06）：menu-equip
30 步记到的 14 次音效中 **2 次是 paint 打出来的**（t=6 与 t=10 那两声禁止），
shop-trade 40 步则是 0 次。（xl-1vu.11 复量了一遍：menu-equip 30 步里派发期间
12 次、paint 期间 2 次 —— t=6 与 t=10，合计 14 次，与 .8 的读数一致。）

xl-1vu.11 之后这个时机由**导出器**保证而不是每支驱动器各写一遍：
`MusicTap.afterStep()` 在 `driver.step()` **返回之后**、`snapshotState()`
之前调，而 paint 发生在 `step()` 里面，所以「paint 之后」自动成立，且比原来更宽
—— `step()` 里任何位置出的声都算进本步。

**注意它与拒绝标志正好相反**：`warnEquipped` / `warnCannotUse` 必须在
paint **之前**抓（同一个 `drawWarning()` 会把它们清零），音效必须在 paint
**之后**取。同一个方法，两个相反的取样时机 —— 所以刻意没有并成一处：拒绝标志
留在 `MenuDriver.step()` 里（只有它知道自己 paint 的是哪个面板、要抓哪几个
字段），音效收到导出器那一处。

`music` 只在 `menu` / `shop` 两支上打开。场景与战斗不 `arm()`，`MusicLog`
一直是关的，没接 `music` 的那几份真值一个字节都没变（实测；xl-1vu.8 当时是
7 份，别把这个分子写死 —— 每接一支就变）。

**场景要接的话，0 次是正确答案。** xl-1vu.11 拿 `SceneDriver` 真接了一遍做演示
（两行，接完又撤掉 —— 接上会给五份场景真值每一步加一个 `music` 字段，那是改真值，
不是这张纯重构票的事）：五份场景剧本 dorm-intro（4123 步）/ dorm-walk（538）/
dorm-exit（1181）/ bigmap-walk（842）/ milestone（9158）**一声都不出** —— 走路、
切场景、对话推进全都不走 `readmusic`。所以场景那一支要写的是
`armAllowingSilence()`：头一次用 `arm()` 接，五份全部退出码 2 报「一个音效都没
记到」，那是正确长得像失败。

BGM 不走这条路：
`MusicPlayer.play` 里 `currentPlayingBGM = name` 本来就在任何开关判断之外。

`MusicTap.arm()` 里那道 `CAN_PLAY_MUSIC != NO` 的 if **当下打不响**：
`ExportTrace.main` 在任何驱动器起来之前就把它设成 `NO` 了。它是留给将来某个不走
`ExportTrace` 的调用者的前置断言，不是一道在验的检查。

### 确定性

场景那五条（定时器冻结、固定顺序、真的 paint、反射字段排序）照旧，另加一条：

**四条 `FatherPanel.run()` 线程用 `Clock.setFactor(1e-9)` 停住。** 它们在
`FatherPanel` 的构造函数里就 `start()`，改不了（改 `src/` 不在允许范围内）。
缩放之后 `Clock.ms(100)` = 10^11 毫秒 ≈ 3170 年，四条线程各自停在第一次
`Thread.sleep` 上，一次都走不到 `update()/repaint()`。**必须在
`new MenuPanel()` 之前设**，晚一步就有一条已经醒过。`Clock.delay()` 在冻结模式
下不看 `factor`，所以这个缩放不影响定时器那一套。

实测（2026-09-06）：把 `Clock.setFactor(SLOW)` 注释掉，`tools/export-trace.sh
--check menu-equip` 立刻报"两次导出不一致"。

### tick：把冻住的那条循环手动推起来（xl-1vu.9）

冻结换来确定性，代价是那条 100ms 循环推的两样东西在真值里不动：鼠标图标的循环帧
停在第 0 帧、奇术页的技能动画停在 `code=1`。`menu-equip` 至今就是这个样子
（它整条剧本的 `mouse` 都是全 0）—— 那份真值本身没错，菜单里**可断言的状态变化**
确实全由事件同步引起；缺的是 M3 真要把技能动画画出来时**没有逐帧真值可比**。

`tick` 指令补的就是这一块：**一步 = 一次循环体**，由驱动器显式调，不靠真实线程。
循环体是 `update(); mouse.update(); repaint();`，而一次 tick 推的是**四个子面板
各一次** —— 原版那四条线程不管哪一页在显示都在跑。四者互不相干（只有
`MagicPanel.update()` 有实质动作，各自的 `Mouse` 只读自己面板的 `currentX/Y`），
所以推进顺序不影响结果，固定成 `MenuPanel` 建面板的顺序只是为了可复现。
`repaint()` 那一半照旧由每步末尾那次 `paint()` 顶替，且只画当前页 —— 与原版一致：
CardLayout 盖住的面板 `repaint()` 不会真画。

**每 tick 都核对推进真的发生了**，两条：

- 鼠标帧按 `Mouse.update()` 的规则走一格（`code<8` 时换成 images[旧 code] 且 code
  加一；`code==8` 时 code 回到 1 且不换图）；
- 奇术页有动画在放时 `code` 加一，走到 `code+1==length` 时 `code` 被拨回 1 且
  `currentAnimation` 被置空。

这两条不是装饰。一次 tick 如果没落到该落的对象上，真值里只是多出几行一模一样的
状态 —— 和"这一段本来就没有变化"长得完全一样。实测（2026-09-07）：把
`mouseOf(p).update()` 注释掉，`menu-magic` 当场非零退出并说
"thingPanel 的鼠标帧没有按 Mouse.update() 推进：code 0 → 0（应为 1）"；把
`p.update()` 注释掉，报"奇术页动画的 code 没有推进：1 → 1（应为 2）"。**而把这两条核对
一并注释掉之后，`--check` 照样报"两次导出逐字节一致"** —— 稳定的错误在它眼里
和正确一模一样，认出来的是重导之后那个 `git diff`。

**两份菜单剧本都自报 `"every": 1`（xl-6lo.3）。** 从前这里写的是"M3 接线时记得敲
`--every 1`"：`tools/compare-frames.sh` 缺省 25 个 tick 取一帧，`menu-magic` 47 步
于是只出 2 帧、`menu-equip` 30 步只出 2 帧 —— 而菜单是事件驱动的，一步就是一次输入
事件，每一步画面都不一样，2 帧几乎什么都没采到，**却照样打印"比过了"**。

"记得敲"不是判据：会忘，而忘了的样子和没忘一模一样（那句"接线时记得"本身就说明
写它的人知道会忘）。现在密度写在剧本里，谁跑都一样；命令行 `--every` 仍能压掉它，
用来临时调稀一点快跑一趟。

⚠️ **改的不是剧本回显，是 trace 头新增的一个顶层字段** —— 这两件事很容易说混。
四支驱动器的 `script` 那一段都由各自的 `toJson()` 重新序列化，`every` 根本进不去
（加了字段之后 `menu-equip.trace.json` 的 `script` 行里仍然没有它）。也就是说
**本来可以做到零 diff**：不把它写进 trace 头，两份菜单真值一个字节都不用动。

选择写进去，是因为 trace 头是"两端跑的是不是同一份剧本"的凭据，而这个字段真的
会改变流水线的行为。一份改了密度的剧本导出一份逐字节相同的真值，等于把一次实质
改动藏了起来 —— 代价是那两份必须重导。diff 只有 `"every": 1` 这一行新增，
`tickCount` 与每一步的每个字段逐字节不变，其余每一份真值零变化（2026-09-08 实测，
份数现数：`ls tools/traces/out/*.trace.json | wc -l`）。给别的剧本补 `every`
也是同样的账，先想清楚要不要付。

`menu-magic` 是唯一一条推它的剧本：先在物品页空推 2 拍，看开局就挂在 `MagicPanel`
上的那条文敏第 5 技能动画照样往前走（`code` 1→3）；进奇术页时那一次**按下**把
`currentAnimation` 清成 `null`（`checkAllButtonPressed` 的第一件事，不是 bug，
是原版）；再点张小凡第 1 个技能，推满 36 拍走完那条 37 帧的动画。43 拍正好覆盖
鼠标帧的一整轮绕回。

加 `mouse` 字段让 `menu-equip` 的真值也变了：**diff 只有这一个新增字段，全程恒为
0**（脚本回显、`tickCount`、其余每个字段逐字节不变）—— 那正是这张票要让人看见的
事实。

## 商店剧本与商店真值（`driver` = `shop`）

第三支事件驱动的驱动器（xl-1vu.6），机制与菜单同源：**一步 = 一次输入事件**。
两家店（`ShopPanel` 药店 / `EquipmentShopPanel` 装备自选超市）里唯一的时间驱动
是那条 `while(true){ for(i=0..7){ 换鼠标帧与人物帧; Clock.sleep(120); repaint(); } }`
线程，它推的只有鼠标图标与四个店内人物的循环动画；**可断言的状态变化**（切分类、
加减交易量、买、卖、金钱、背包）全部由一次鼠标事件同步引起。

### 剧本

```json
{
  "driver": "shop",
  "name": "shop-trade",
  "setup": {
    "party": ["zhang"],
    "coins": 10000,
    "seed": 1,
    "drugs": [{ "name": "金创药", "count": 1 }],
    "equipment": [{ "name": "皮靴", "count": 1 }]
  },
  "maxSteps": 200,
  "steps": [
    { "op": "open", "name": "drug" },
    { "op": "hover", "index": 0 },
    { "op": "plus", "index": 0 },
    { "op": "buy" }
  ]
}
```

| 指令 | 参数 | 展开成 | 语义 |
|---|---|---|---|
| `open` | `name` = `drug`/`equipment` | 无输入事件，但**算一步** | 切到哪家店（原版是靠场景里的选择事件 `GameLauncher.switchTo` 进店的，那一下同样是一次跳转） |
| `category` | `name` = `weapon`/`helmet`/`armor`/`glove`/`shoe`/`decoration` | 按下 + 松开 | 只用于装备店 |
| `hover` | `index` | 一次 `mouseMoved` | 鼠标移到商品列表第 index 行 |
| `plus` / `minus` | `index` | 按下 + 松开 | 第 index 行的加 / 减按钮 |
| `buy` / `sell` | — | 按下 + 松开 | 点"购买" / "卖出" |

**没有 `back`。** 原版那个按钮直接调 `GameLauncher.switchTo("scene")`，而导出器
里根本没有 GameLauncher 的窗口 —— 留个指令等于留一条只会崩的路。

坐标一律不写在剧本里（与菜单同理）：驱动器从原版 `GameButton` 自己的
x/y/width/height 反算落点，按下之后核对那个按钮**真的** `isclicked`、且**只有它**
`isclicked`。

### 真值

每一步记：`shop`（哪家店）、`category`、`coins`、`cursor`（鼠标坐标 + 它落在第几
行，`-1` = 不在任何一行的命中带上）、`list`（当前这一列商品，每行五个数 = 原版
`drawIcon` 画在屏幕上的那五列：名字 / 单价 / 店里还剩几件 / 这一单要买卖几件 /
背包里已有几件）、`icon`（图标框里那张图是哪一行）、`message`（店主那句话）、
`pressed`、`pack`、`music`（这一步触发的音效文件名，与菜单同形同机制，见菜单
那一节的「音效」）。

### 两个"失败长得和成功一样"的坑

- **存货是掷出来的。** 两个面板的构造函数逐件
  `setNumber((int)(Math.random()*10))` —— 药店 6 件、装备店 56 件，共 62 次。
  剧本里的 `seed` 必填，播种走的是与战斗同一条路（反射
  `java.lang.Math$RandomNumberGeneratorHolder`，要 `--add-opens`）。
  **两个面板必须按固定顺序建**：顺序一换，62 次掷骰的分配就变了。
- **鼠标动画线程在睡下之前会先走一次赋值**（`mouse = mouses[0]` 与四个
  `animation.image = images.get(0)`），这一下与主线程竞态。状态真值不记这几个
  字段，所以 `--check` 两遍照样逐字节一致 —— **而 `snapshotImage()` 交出去的
  位图是时对时错的**，也就是说 `export-trace.sh --check` 对它是瞎的。
  `ShopDriver` 因此建完面板后自旋等这次赋值落地，并且先验一遍"第 0 张与第 7 张
  确实是不同对象"—— 否则那是个永远为真的等待条件，和真的等到了长得一样。

顺带一处原版的写法差异：`ShopPanel` 的买 / 卖循环写死 `i<6`（`drug.txt` 恰好
6 行），`EquipmentShopPanel` 那边才是按 `listTable(equipment).size()` 走的。

## 现有的剧本

| 剧本 | 场景 | 覆盖 |
|---|---|---|
| `dorm-walk` | `宿舍.txt` | 走、跑、四向拐弯、碰撞、静止地图的视口、绘制顺序翻转、NPC 口头语的逐字打印 |
| `bigmap-walk` | `大地图.txt` | 100×80 卷动地图的视口跟随与边缘夹取（53 个不同视口）、两段跑、13 个 NPC 里 8 个单向走动 + 4 个原地动画都在跑帧 |
| `dorm-intro` | `脚本1.txt` | 6 句旁白逐字播完（46 个背景帧）、接一整段 23 句主线对话，头像式与名字式两种对话框、翻页 |
| `dorm-exit` | `宿舍.txt` → `大地图.txt` → `脚本1.txt` | 出口切换的两条分支：走到 `宿舍` 门口进 `大地图`（`isScript` 置假），再从 `大地图` 走回来 —— 回的是 `currentScript[2]`（`脚本1`）而不是 `宿舍`，`isScript` 重新为真、旁白被 `narratageOver` 压掉、主线对话的进度按 `dialogueOrder` 还原。三次背景音乐切换、两个入口坐标 |
| `milestone` | `脚本1.txt` → `脚本2` → `大活夜` → `大地图夜` | M1 里程碑：开场从头走一遍 —— 旁白 + 23 句主线对话 + 跟曾书书搭话，出门进大地图夜，那边的旁白与 27 句对话也走完，进大活夜再出来。覆盖出口切换的三条分支与两次背景音乐切换 |
| `menu-magic` | 菜单（`driver` = `menu`） | 奇术页与那条 100ms 循环的逐帧真值（`tick` 指令）：开局挂着的文敏第 5 技能动画在物品页上照样推进（`code` 1→3）→ 进奇术页那一次按下把它清成 `null` → 张小凡第 1 个技能的 37 帧走完（末帧 `code` 拨回 1、动画撤下）→ 鼠标图标 43 拍走完一整轮绕回（第 0 张只出现一次、第 7 张连画两帧） |
| `menu-equip` | 菜单（`driver` = `menu`） | 四个子面板各自进入与退出；装备页一整条换装：拒绝（已装备）→ 弃用（敏捷 11→10、武力 12→10、精气 11→10）→ 拒绝（藏璎环是陆雪琪专属）→ 换回武器 → 穿上铁甲（体力 10→15、血上限 700→1050、防御 50→75）→ 物品页喝药（生命 700→1000，金创药 2→1） |
| `battle-min` | 战斗（`driver` = `battle`） | `剧情1.txt` 的那场固定遭遇（三人对三怪），从开场动画打到分出胜负。第一回合的两步写成显式指令，之后 `autoAttack` 打完 |
| `battle-em3-box` | 战斗（`driver` = `battle`） | 让 xl-1dv.8（`EnemySlector` 判 em3 用了 `height1`）在真值里露头的那一场：`脚本20.txt` 第 3 行的 Fight 数据，em1 的图 188×220 而 em3 的图 124×172 |
| `battle-defeat-scene` | 战斗（`driver` = `battle`） | 打输的第一条出口：`脚本22.txt` 第 1 行的剧情必败战（`罹年居士` 独自一只，hp/hurt/defense 全是 9999）。全灭之后一路记到切回 `scenePanel`，张小凡与文敏各回半血。第 2/3 槽是 `null` —— 原版的 Fight 数据一行可以只写一只怪 |
| `battle-defeat-start` | 战斗（`driver` = `battle`） | 打输的第二条出口：`脚本37.txt` 第 1 行（`罹年居士分身` ×3，等级压到 1 让它必输）。全灭之后切回 `startPanel`，谁的血都不回。它钉住那个名字比较是**逐字相等**而不是包含 |
| `battle-defeat-slot2` | 战斗（`driver` = `battle`） | **合成**的遭遇（不取自原版 Fight 数据）：第 1 槽 `怪物1`、第 2 槽 `罹年居士`。全灭之后照样切回 `startPanel` —— 它钉住那个判断只看 `em1`，而不是"三个槽位里有没有" |
| `battle-menus` | 战斗（`driver` = `battle`） | 点得下去的「技」与「物」（xl-rh9.11）：与 `battle-min` 同一场遭遇、换一颗种子。文敏那一回合先点「物」翻药品菜单（存货全是 0，点金创药走 `Reminder.show(19)`，也就是 `20.png`），返回后点「技」用技能2 追星破月 → 自己挂「敏捷提升」（type 1 @ 800,150，speed 10→11），到期那一拍又退回去（speed 11→10）；张小凡那一回合用技能2 浪里寻花 → 第 3 槽那只怪挂「体力下降」（type 8 @ 60,330）。三张提示图的文件号实测是 **20 / 7 / 2**，三条来路各不相同 |
| `battle-victory` | 战斗（`driver` = `battle`） | **打赢之后的结算**（xl-rh9.13，837 步）：与 `battle-em3-box` 同一行 Fight 数据（`脚本20.txt` 第 3 行），而**陆雪琪压到 1 级** —— 这一场 1190 点经验对 10 级的张小凡与文敏差得远（升一级要 14462），对 1 级的陆雪琪却够（700），于是结算的两条路在同一份真值里都走到：第一页三个人、第二页只有升了级的那一个、属性一项项滚上去、`timeCode` 数到 55 才 `switchTo("scene")`。它是 `victory.ts`（xl-rh9.5）的**第一份行为真值覆盖** |
| `shop-trade` | 商店（`driver` = `shop`） | 药店与装备超市各走一条完整的买卖：买 2 份金创药 → 钱不够被拒（金钱与背包一个数都没动） → 卖回 1 份 → 装备超市买月苗刀 → 切到鞋子那栏卖掉皮靴 → 切回武器栏确认刚买的还在。加减按钮的两端也都走到了 |
