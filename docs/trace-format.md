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
确定性 OK：bigmap-walk 两次导出逐字节一致（1189286 字节）
确定性 OK：dorm-exit   两次导出逐字节一致（1161429 字节）
确定性 OK：dorm-intro  两次导出逐字节一致（3591275 字节）
确定性 OK：dorm-walk   两次导出逐字节一致（394779 字节）
确定性 OK：menu-equip  两次导出逐字节一致（42314 字节）
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
防御 / 技能防御 / 技能数）、`equip`、`drug`、`magic`、`func`。

| 字段 | 来源 / 陷阱 |
|---|---|
| `equip.list` | 当前分类里画得出来的那几项。**从 `currentList` 现算**，不读 `EquipPanel.list` —— `drawEquipment()` 每画一帧就往里 `add` 一遍而从不清空，几步之后它是一份不断变长的重复列表。 |
| `equip.selected` | `currentEquipment` 在上面那份列表里的下标。**用完最后一件之后是 `-1`**：原版让 `currentEquipment` 继续指着一件 `numberGOT` 已经是 0、列表里不再画出来的装备。 |
| `equip.warnEquipped` / `warnCannotUse` | 两条拒绝路径：身上那一格已经有装备 / 这件不是当前角色能用的（`Equipment.user`）。**必须在 `paint()` 之前抓** —— `drawWarning()` 会把这两个标志清零，放到 paint 之后读永远是 0，得到一份"从没发生过拒绝"的真值。 |
| `equip.diff` | 装备页中间那四个升降数字。取的是四个 `ShowValue` 对象自己的 `value`/`type`，**不是 `EquipPanel` 上那四个 `showPP/showAngile/...` 字段**：`showValueDifference()` 的 else 分支（身上那一格是空的）把绝对值直接传进 `ShowValue.show()`，一个字段都不写，于是字段里留着上一次的陈值。`signal != 1` 时记 `null` —— 那一整段（算差值 + 画四个箭头）都在 `if(signal==1)` 里面。 |
| `magic.animation` | 开局**不是** `null`：`addMagicAnimation()` 用同一个临时字段建了 20 个动画，循环结束时它停在最后一个（文敏第 5 技能）上，于是刚进奇术页就画着那一条说明。照记不改。 |
| `func.drawn` | 天书页当前画得出来的按钮，按字段名排序。 |

**菜单真值里没有音效。** 原版把音效文件名记在 `MusicPlayer.filename` 上，而那行
赋值在 `if (CAN_PLAY_MUSIC == YES)` 的**里面**；导出必须
`MusicReader.closeMusic()`（否则每次点击都开音频设备、起一条播放线程，两遍导出
不可能一致），关掉之后就观察不到了。

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

代价是这份真值**记不到那条 100ms 循环推的东西**：鼠标图标的循环帧固定在第 0 帧，
奇术页的技能动画固定在 `code=1`。菜单里没有别的东西靠它。

## 现有的剧本

| 剧本 | 场景 | 覆盖 |
|---|---|---|
| `dorm-walk` | `宿舍.txt` | 走、跑、四向拐弯、碰撞、静止地图的视口、绘制顺序翻转、NPC 口头语的逐字打印 |
| `bigmap-walk` | `大地图.txt` | 100×80 卷动地图的视口跟随与边缘夹取（53 个不同视口）、两段跑、13 个 NPC 里 8 个单向走动 + 4 个原地动画都在跑帧 |
| `dorm-intro` | `脚本1.txt` | 6 句旁白逐字播完（46 个背景帧）、接一整段 23 句主线对话，头像式与名字式两种对话框、翻页 |
| `dorm-exit` | `宿舍.txt` → `大地图.txt` → `脚本1.txt` | 出口切换的两条分支：走到 `宿舍` 门口进 `大地图`（`isScript` 置假），再从 `大地图` 走回来 —— 回的是 `currentScript[2]`（`脚本1`）而不是 `宿舍`，`isScript` 重新为真、旁白被 `narratageOver` 压掉、主线对话的进度按 `dialogueOrder` 还原。三次背景音乐切换、两个入口坐标 |
| `milestone` | `脚本1.txt` → `脚本2` → `大活夜` → `大地图夜` | M1 里程碑：开场从头走一遍 —— 旁白 + 23 句主线对话 + 跟曾书书搭话，出门进大地图夜，那边的旁白与 27 句对话也走完，进大活夜再出来。覆盖出口切换的三条分支与两次背景音乐切换 |
| `menu-equip` | 菜单（`driver` = `menu`） | 四个子面板各自进入与退出；装备页一整条换装：拒绝（已装备）→ 弃用（敏捷 11→10、武力 12→10、精气 11→10）→ 拒绝（藏璎环是陆雪琪专属）→ 换回武器 → 穿上铁甲（体力 10→15、血上限 700→1050、防御 50→75）→ 物品页喝药（生命 700→1000，金创药 2→1） |
