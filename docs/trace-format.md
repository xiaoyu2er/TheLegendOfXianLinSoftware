# 剧本格式与 trace 格式

> 本文描述 `tools/export-trace.sh` 的输入（剧本）与输出（trace）。
> 实现在 `tools/src/devtools/`，被驱动的是 `src/` 里的原版程序本身。

## 为什么要有这套东西

状态层与视口层的实现如果没有真值，测试就只能手写期望值 —— 而写实现和写期望的
会是同一个 agent、在同一个上下文窗口里。那样的测试会绿，而且是错的。

这里导出的每一个 tick 都是原版自己跑出来的结果，Web 侧只能对齐，不能协商。

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

### 指令词汇

**声明式**：写"走到 (14,19)"，不写"按 12 次下键"。后者对时序敏感 —— 一格走 8
帧、每帧 80ms，两端只要有一处 tick 边界对不齐，之后整条 trace 全错，而错因和
现象隔着几千帧。声明式的终点是一个可断言的事实，两端各自负责把它展开成按键。

这套词汇就是 Web 侧状态推进函数的入参类型，不是另一套平行机制。

| 指令 | 参数 | 语义 |
|---|---|---|
| `walkTo` | `x`, `y` | 走到目标格。先 X 后 Y。到不了 —— 硬失败。 |
| `runTo` | `x`, `y` | 同上，按住 Ctrl 跑。 |
| `talk` | — | 按一次空格（站在相邻 NPC 旁就是搭话）。 |
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
     "audio":{"bgm":"舒缓.mp3"},
     "viewport":{"offsetX":0,"offsetY":0,"firstTileX":0,"lastTileX":128,
                 "firstTileY":0,"lastTileY":80},
     "drawOrder":"hero-first"}
  ]
}
```

| 字段 | 来源 |
|---|---|
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
| `audio.bgm` | `MusicPlayer.currentPlayingBGM`。是一个可断言的字符串，不是"调用了 play()"。 |
| `viewport` | `OtherEvent.calOffset()` 算出的六元组，对应 spec 里的 `computeViewport`。 |
| `drawOrder` | `npcs-first` / `hero-first`，对应 spec 里的 `computeDrawOrder`。 |

## 确定性是怎么做到的

这是整件事唯一的技术难点。原版把时间摊在三个地方，没有一处是可重复的：
17 个 `javax.swing.Timer` 挂在 Swing 的 `TimerQueue` 上、主循环是
`while(true){ ...; Thread.sleep(10); }`、`paint()` 在 EDT 上另跑一条线。

1. **定时器**。`tools.Clock.freezeTimers(base)` 让 `Clock.delay(x)` 返回
   `base + x`（base = 24 小时），真实 `TimerQueue` 在一次导出里绝无可能触发；
   之所以是 `base + x` 而不是一个统一大常数，是为了让导出器能从
   `timer.getDelay()` 反算回原始间隔。随后每个 `Timer` 对象被换成
   `devtools.VirtualTimer`，`start/stop/restart/isRunning` 全部改挂虚拟时钟。

   为什么必须**换对象**而不是在外面记一张到期时间表：原版有若干处对
   *正在运行的*定时器再次 `start()`（`NPCEvent.checkNPCStop` 对 type==2 的
   NPC 是无条件 `action.start()`），Swing 的语义是重新计时。外部记账看不见
   这次调用，会把本该永远不推进的动画推进起来 —— 那样的 trace 是错的，
   而且看不出错。

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
确定性 OK：bigmap-walk 两次导出逐字节一致（1154623 字节）
确定性 OK：dorm-intro  两次导出逐字节一致（3441060 字节）
确定性 OK：dorm-walk   两次导出逐字节一致（374314 字节）
```

跨机器、跨 JDK 版本的一致性**未验证**。

## 现有的三份剧本

| 剧本 | 场景 | 覆盖 |
|---|---|---|
| `dorm-walk` | `宿舍.txt` | 走、跑、四向拐弯、碰撞、静止地图的视口、绘制顺序翻转、NPC 口头语的逐字打印 |
| `bigmap-walk` | `大地图.txt` | 100×80 卷动地图的视口跟随与边缘夹取（53 个不同视口）、两段跑、会走动与原地动的 NPC |
| `dorm-intro` | `脚本1.txt` | 6 句旁白逐字播完（46 个背景帧）、接一整段 23 句主线对话，头像式与名字式两种对话框、翻页 |
