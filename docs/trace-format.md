# 剧本格式与 trace 格式

> 本文描述 `tools/export-trace.sh` 的输入（剧本）与输出（trace）。
> 实现在 `tools/src/devtools/`，被驱动的是 `src/` 里的原版程序本身。

## 为什么要有这套东西

状态层与视口层的实现如果没有真值，测试就只能手写期望值 —— 而写实现和写期望的
会是同一个 agent、在同一个上下文窗口里。那样的测试会绿，而且是错的。

这里导出的每一个 tick 都是原版自己跑出来的结果，Web 侧只能对齐，不能协商。

## 剧本（输入）

UTF-8 JSON，放在 `tools/traces/scripts/*.json`。剧本头的 `driver` 字段说这是
哪个面板的剧本（缺省 `scene`）—— 它决定必填字段是哪些、指令词汇是哪一套。
下面这一节讲的是 `scene`；战斗那一套见〈战斗剧本与战斗 trace〉。

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
             "running":false,"moving":true,"stepNum":0},
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
| `driver` | **驱动器判别名**：这份真值是原版哪个面板导出来的。场景是 `scene`；战斗 / 菜单 / 商店各有各的。由 `TraceDriver.kind()` 报出，不是导出器按剧本猜的 —— 「装配哪一套」与「是谁导出的」必须是同一件事。 |
| `t` / `vt` | tick 序号 / 虚拟毫秒（`t * tickMs`）。 |
| `ip` | 当前执行到剧本的第几条指令。比对失败时用来定位是哪一段。 |
| `input` | **本 tick 实际喂给原版的按键事件**。Web 侧照着回放即可，不必重新实现规划器 —— 声明式指令负责编写，`input` 负责复现。 |
| `role.x/y` | 格子坐标（`Role.getX()/getY()`，即像素除以 32）。 |
| `role.px/py` | 像素坐标。格子坐标一格变一次，太粗，比对不出错位。 |
| `role.dir` | `down` / `up` / `left` / `right`（原版是 0/8/16/24）。 |
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
所以判别名缺失、形状不对、或者 Web 侧还没有那一套，一律抛：页面里的异常经
`scripts/cdp.ts` 的 `evaluate` 转成 Node 侧的 Error，再由 `scripts/compare.ts`
的 `main().catch` 变成**退出码 2**，消息里带着是哪个驱动器、本页实现了哪些。

实测（2026-09-06，把 `tools/traces/compare/dorm-walk/java/trace.json` 的判别
字段改掉，跑 `pnpm exec vite-node scripts/compare.ts -- dorm-walk`）：

- 改成 `"battle"` → 退出码 2，`驱动器 battle 在取图页还没有实现，装配不出来。本页实现了：scene。`
- 整行删掉 → 退出码 2，`真值没有报驱动器判别名（driver = undefined）。`

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

`tools/export-trace.sh --check` 把每份剧本导两遍，`cmp` 两份产物。

已实测（macOS / openjdk 17，两次独立 JVM 进程）：

```
确定性 OK：battle-min  两次导出逐字节一致（688276 字节）
确定性 OK：bigmap-walk 两次导出逐字节一致（1189286 字节）
确定性 OK：dorm-exit   两次导出逐字节一致（1161429 字节）
确定性 OK：dorm-intro  两次导出逐字节一致（3591275 字节）
确定性 OK：dorm-walk   两次导出逐字节一致（394779 字节）
确定性 OK：milestone   两次导出逐字节一致（8101705 字节）
```

跨机器、跨 JDK 版本的一致性**未验证**。

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
| `seed` | `Math.random()` 的种子。伤害、怪物选招选人、状态命中全走它。 |
| `tickMs` | 只能是 `100` —— `BattlePanel.run()` 的循环周期就是 `Clock.sleep(100)`。 |

指令词汇：

| 指令 | 参数 | 语义 |
|---|---|---|
| `command` | `button` | 点控制台的一个按钮（`attack`/`skill`/`defend`/`thing`）。菜单在预算内没出来 —— 硬失败。 |
| `target` | `enemy` | 点某个怪物（1/2/3）。槽位空着、或者点下去 `currentBeAttacked` 没变 —— 硬失败。 |
| `autoAttack` | `until`, `max` | 「能点击就点『击』，能选敌就选第一个还站着的怪物」，一直打到分出胜负。`until` 是 `victory`/`defeat`/`decided`；打成了别的结局，或者跑满 `max` 步还没分出来 —— 都是硬失败。 |
| `wait` | `ticks` | 空等（与场景共用）。 |

`autoAttack` 是**策略**而不是一串写死的点击，因为一场战斗要打几个回合取决于
每次伤害掷出多少 —— 写剧本的人事先不知道。写死次数只要少一次，导出的就是一份
"打到一半就停"的 trace，而它和一份打完的长得一模一样。

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
            "state":{"type":0,"rounds":0,"usable":false,"role":0}}],
 "enemies":[{"slot":1,"name":"怪物1","hp":250,"speed":11,"onField":true,
             "dead":false,"drawn":true,"frame":1,
             "state":{"type":0,"rounds":0,"usable":false,"role":0},
             "box":[100,220,124,172]}],
 "hurts":[{"value":186,"type":1,"x":60,"y":330,"drawn":true,"frame":1}],
 "ui":{"command":false,"skillMenu":false,"drugMenu":false,"selectable":false,
       "instruct":false,"reminder":false,"victory":false,"gameOver":false,
       "startAnim":true},
 "anim":{"skill":null,"skillFrame":0,"skillDrawn":false,"skillX":0,"skillY":0,
         "bg":null,"bgFrame":0,"bgDrawn":false},
 "audio":{"bgm":"B6.mp3"}}
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

### 真值里能看见的原版缺陷

真值的职责是记录原版做了什么，不是记录它应该做什么。**导出器一处都不修**：

- **xl-1dv.9 `Enemy.hp` 可为负。** 致命一击会打过头，而 `Check.checkEnemyDead`
  只判 `<=0` 就把怪物摘掉，从不夹到 0。`battle-min` 末帧三个槽位是
  `-12 / -88 / -84`。
- **xl-1dv.8 `EnemySlector` 判第三个怪物时用了 `height1`。** `box` 的第三项
  因此取的是第一个怪物图片的高。**在 `battle-min` 这一场里它是潜伏的**：
  `怪物1` 与 `怪物2` 的图片都是 172 高，`height1` 恰好等于真实的 `height3`，
  看不出差别。要让它真的可观测，得换一场 em1/em3 图片高度不同的遭遇。
- **xl-1dv.6 `initial()` 只 add 不 clear。** 同一个 JVM 里连开第二场会带上第
  一场的残留，所以**一份剧本 = 一个 JVM = 一场战斗**。这是绕开，不是修。

### 回放端

`web/src/replay/main.ts` 的装配表今天只有 `scene` 一项，所以战斗真值走到取图页
会被 `pickAssembly` 挡住。实测（`tools/compare-frames.sh battle-min --every 100`）：

```
[compare] 页面里抛了异常：UnknownDriverError: battle-min：驱动器 battle 在取图页还没有实现，装配不出来。本页实现了：scene。
退出码=2
```

这正是要的行为 —— 一条没被装配的剧本比出来是"零帧差异"，和"两端完全一致"长得
一模一样。接上战斗装配是 xl-1vu.7 的事。

## 现有的剧本

| 剧本 | 场景 | 覆盖 |
|---|---|---|
| `dorm-walk` | `宿舍.txt` | 走、跑、四向拐弯、碰撞、静止地图的视口、绘制顺序翻转、NPC 口头语的逐字打印 |
| `bigmap-walk` | `大地图.txt` | 100×80 卷动地图的视口跟随与边缘夹取（53 个不同视口）、两段跑、13 个 NPC 里 8 个单向走动 + 4 个原地动画都在跑帧 |
| `dorm-intro` | `脚本1.txt` | 6 句旁白逐字播完（46 个背景帧）、接一整段 23 句主线对话，头像式与名字式两种对话框、翻页 |
| `battle-min` | （战斗，`driver: battle`） | `剧情1.txt` 的那一场固定遭遇（三人对三怪），404 步打到胜利。行动条、回合归属、双方 HP、伤害数字、胜负，外加 xl-1dv.9 的负血 |
| `dorm-exit` | `宿舍.txt` → `大地图.txt` → `脚本1.txt` | 出口切换的两条分支：走到 `宿舍` 门口进 `大地图`（`isScript` 置假），再从 `大地图` 走回来 —— 回的是 `currentScript[2]`（`脚本1`）而不是 `宿舍`，`isScript` 重新为真、旁白被 `narratageOver` 压掉、主线对话的进度按 `dialogueOrder` 还原。三次背景音乐切换、两个入口坐标 |
