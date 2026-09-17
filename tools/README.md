# tools/ — 原版取景器与规格提取器

这些不是临时脚本。迁移期内 **Java 源码是唯一的规格文档**，这里的工具负责
从规格里提取可断言的事实，因此和 `src/` 同等重要，必须版本化。

## 环境

```bash
brew install openjdk@17        # 源码目标是 JavaSE-1.7，17 可编译
export JAVA_HOME=/opt/homebrew/opt/openjdk@17   # build.sh 默认就是这个路径
```

**所有命令都必须从仓库根目录运行** —— 游戏用相对路径读 `script/`、`sources/`、`image/`。

## 命令

| 命令 | 作用 |
|---|---|
| `tools/build.sh` | 编译游戏本体（GBK）+ 开发工具（UTF-8）到 `tools/build/classes` |
| `tools/run-game.sh` | 启动原版游戏 |
| `tools/export-truth.sh` | 导出 96 个脚本的解析真值到 `tools/ground-truth/*.json` |
| `tools/export-trace.sh [名字…] [--check]` | 在原版上执行声明式剧本，逐 tick 导出行为真值到 `tools/traces/out/`；`--check` 跑两遍验证逐字节一致 |
| `tools/compare-frames.sh [名字…]` | 跨端逐帧比对：同一份剧本在原版与 Web 版各出 N 帧，逐帧算差异，报告首个偏离帧号；`--self-check` 故意改坏一处渲染验流水线响不响。见 `docs/frame-compare.md` |
| `tools/speed-probe.sh [倍率…]` | 两端时间加速倍率的墙钟线性度实测 |
| `tools/mouse-dispatch-probe.sh [--dry-run\|--yes\|--rounds N\|--out 目录]` | 原版鼠标事件派发探针：合成「舞台外按着键拖进来」那一族的序列，量原版到底收没收到、派给了谁。**接管物理鼠标、要辅助功能授权、跑不进 CI**，见下 |
| `tools/to-webp.sh <src> <dst>` | 把取景器产出的 PNG 批量转 WebP q80 |
| `tools/bd-spawn.sh <issue-id>…` | 为 issue 开 worktree、认领、在新的 iTerm 标签页启动 Claude 会话 |

## 并行开发：bd-spawn.sh

bd 本身没有拉起终端的能力 —— `bd swarm create` 只写一条协调记录，等别人来捡。
`tools/bd-spawn.sh` 就是那个"捡"的动作：

```bash
tools/bd-spawn.sh --dry-run xl-9bd.1     # 先看它要做什么
tools/bd-spawn.sh xl-9bd.1 xl-9bd.2      # 真开两个
```

每个 issue 会得到：仓库外的一个 git worktree（`../<repo>-agents/<id>`，
所以不污染 `.gitignore`）、一次原子认领、以及一个 iTerm 标签页里的 Claude 会话。
不在 `bd ready` 里的 issue 会被拒绝（除非 `--force`），认领冲突时硬失败。

**⚠ 本机有两个 Claude 配置目录**：`~/.claude`（别名 `ccd-turo`）与
`~/.claude-zyq`（别名 `ccd-zyq`）。**beads 插件只装在后者**，所以脚本默认用
`~/.claude-zyq`。用前者起的会话仍有项目级的 SessionStart hook 与 CLAUDE.md，
但没有 `/beads:*` 那 22 个斜杠命令，也没有 `beads:task-agent`。
需要时用 `--config-dir` 覆盖。

## 原版鼠标事件派发探针：mouse-dispatch-probe.sh

「舞台外按着键拖进来」那一族票（xl-2yh、xl-m9q、xl-zs6、xl-5ee）的票面上反复出现
「平台未验证」——源码只答得了「事件到了 Java 之后派给谁」，答不了「这一下到没到得了
Java 窗口」。这套东西回答后一个问题，xl-zs6 现搭、xl-sij 收进来：

- `tools/src/devtools/MouseDispatchProbe.java` —— 挂 `Toolkit.addAWTEventListener`
  （**派发之前**的位置）再调 `main.Game.main`，把原版收到的每一个鼠标事件连同**派给了谁**
  落盘。不改 `src/`。于是「收到了但没转派给面板」与「压根没到窗口」在日志里长得不一样。
- `tools/mouse-dispatch/drive.swift` —— 按 `--where` 选一个「窗口外」的落点，用 CGEvent 按 HID tap
  合成四组序列（A 对照 / B / B2 / C）。三个落点（xl-g9w）：`outside-window`（默认，驱动器自己开的
  那块空白窗口 = 另一个 app 的普通窗口）、`desktop`（露出来的桌面，落点现扫）、`same-app-window`
  （原版那个 JVM 自己多开的另一块 `JFrame`）。认不出来的名字是**硬失败**，不猜。
- `tools/mouse-dispatch/expected-events.txt` —— `outside-window` 那一支的读数（xl-zs6 三轮；
  xl-g9w 在同一台机器上复跑 4 轮，逐行一致、读数未改），跑完自动对账；
  `expected-events-same-app-window.txt` 是同 app 那一支的（xl-g9w 三轮）。
- `tools/mouse-dispatch/replay-fixture/` —— 三份存下来的原始日志，给 `--replay` 用：
  **不借鼠标**就能把对账那半判据跑一遍，也让上面那两句「量过几轮」各自带着可复跑的证据，
  而不只是一句陈述。见那个目录的 README.md。

```bash
tools/mouse-dispatch-probe.sh --dry-run   # 只编译两侧 + 读权限，一个事件都不发
tools/mouse-dispatch-probe.sh             # 真跑（默认三轮），跑前会问一句
tools/mouse-dispatch-probe.sh --where same-app-window   # 换落点；每个落点一份期望读数

# 下面这两条**一下鼠标都不碰**：
tools/mouse-dispatch-probe.sh --check-point --where desktop   # 起原版拿几何、只把落点算出来
tools/mouse-dispatch-probe.sh --replay <目录>                  # 拿存过的日志重跑对账
```

**⚠ 跑之前要先问人**：它接管物理鼠标，那十几秒里光标自己动、真的按下去。

**⚠ 权限前提**：`CGPreflightPostEventAccess` 与 `AXIsProcessTrusted` 都要为真（人在
「系统设置 → 隐私与安全性 → 辅助功能」里给跑它的那个终端）。**没授权时合成事件被静默
丢弃，Java 侧同样是零事件 —— 与「原版真的收不到」长得一模一样。** 所以 **A 对照**
（窗口内空白处左键单击必须被 `start.StartPanel` 收到）是判据的一部分，不是装饰；
脚本起手读那两个权限、末尾单独核 A 对照，就是为此。

**⚠ 跑不进 CI**，两条硬拦：要真窗口（`-Djava.awt.headless=false`，还要 `StartPanel`
真摆在屏幕上有屏幕坐标可算），要辅助功能授权（人在系统设置里点的，runner 上给不了）。
CI 里覆盖到的只有 `tools/build.sh` 编得过探针那个 `.java`；驱动器那半连编译都不在 CI 里，
要 `--dry-run` 才编。（对照 `tools/export-scaled-blit.sh`：那个只往 `BufferedImage`
上画，跑在 CI 的条件下。）

读数、读法与它的限定（事件是合成的；哪些落点量过、哪些没量过）写在 `MouseDispatchProbe`
的类注释里。**换落点量过一支了**（xl-g9w）：`same-app-window` 与默认那支相比，
**对原版那块窗口来说读数逐字相同**；`desktop` 还没量过（要先有一块露出来的桌面，
用 `--check-point` 可以在借鼠标之前先问清楚）；原生全屏那一支**构造上量不了**
（它在自己的 Space，原版窗口同时不在屏上）—— 最后这一句是推理，没量过。

## 编码

源码本身是 **GBK**，编译必须 `-encoding GBK`。

数据文件（`script/*.txt`、`sources/Shop/*.txt`、存档）也是 GBK，但代码已在
4 个 I/O 点显式指定编码（见 commit `fix(io):`），**运行时不再需要任何
`-Dfile.encoding` 参数** —— 实测在 openjdk 17 上那些参数一律无效。

## 目录

- `src/devtools/ExportGroundTruth.java` — 真值导出器（Q15 的黄金基线）
- `src/devtools/MouseDispatchProbe.java` — 原版鼠标事件派发探针（收不收得到 / 派给谁），与 `mouse-dispatch/drive.swift`、`mouse-dispatch/expected-events.txt` 配套
- `src/devtools/ExportTrace.java` — 行为 trace 导出器：在虚拟时钟上驱动原版，逐 tick 录状态
- `src/devtools/TraceScript.java` — 声明式剧本的模型与加载
- `src/devtools/VirtualTimer.java` `VirtualClock.java` — 挂在虚拟时钟上的 `javax.swing.Timer` 替身
- `src/devtools/Json.java` `JsonIn.java` — 极简 JSON 写出/读入，无第三方依赖
- `traces/scripts/` — 剧本（入库）；`traces/out/` — 导出的 trace（**入库，是状态层的真值**）
- `src/battle/Shot3.java` — 会打架的战斗取景器：检测到指令菜单就点「击」再点敌人
- `src/battle/Shot2.java` — 战斗取景器（不驱动输入），用于对照
- `src/ShotFull.java` `src/ShotFix.java` — 场景/对话/旁白/问答/选择/宝箱/面板取景
- `src/Audit.java` — 帧序列静止度审计（判断截图里到底有没有动作）
- `src/Diff.java` — 帧间像素差异统计
- `ground-truth/` — 96 个脚本的解析真值 JSON（**冻结产物**，任何 diff 都是信号）

## 为什么 Shot3 要放在 `battle` 包里

战斗输入是纯鼠标的，`BattlePanel.currentX/currentY`、`Command.isDraw`、
`EnemySlector.isSlectable` 都是包内可见字段。放在 `battle` 包里就能直接驱动，
不必伪造 AWT 事件。按钮坐标写死在 `Command.java:33-58`（击 500,300 58x62）。

## 已知的原版问题（由这些工具发现）

- ~~`paint()` 有副作用：战斗状态机被渲染驱动。不调 `paint()` 时
  `command.isDraw` 恒为 false（实测 0/120 vs 59/120）。~~
  **这条是错的，2026-09-06 实测推翻**（openjdk 17）：战斗面板的 `paint()`
  对状态机没有副作用，同一场战斗 paint / 不 paint 各跑一遍，426 步 × 24 个
  可断言字段零行差异。那组 0/120 vs 59/120 量的是采样频率不是因果——`run()`
  线程当时自由奔跑，`paint()` 只是让取样循环变慢。留着划掉是因为这条被引用过，
  删掉下一个人会重新得出它。见 `docs/trace-format.md` 与
  `tools/src/devtools/BattleDriver.java` 的类注释（xl-p1j）。
  *（场景侧的 `ScenePanel.paint()` 另说，它真的有副作用，见同一份文档。）*
- 20 个场景依赖前序场景残留的 `dialogueEvent` 对象才能渲染；直接
  `initiation()` 跳进去会 NPE。取景器用 `剧情1.txt` 预热规避。
- `BattlePanel.initial()` 只 `add` 不 `clear` `heroes`/`enemies`，
  连续开战会累积。取景器改成一场一个 JVM。
- `EnemySlector.checkMoveIn()` 判定 em3 时用了 `height1`。
- 31 个资源路径缺失，详见 commit `fix(diag):`。

## 行为 trace 与确定性

`tools/export-trace.sh` 在原版程序里执行一份**声明式**剧本（"走到 (14,19)"，
不是"按 12 次下键"），逐 tick 把主角、NPC、对话游标、旁白、BGM、视口六元组、
绘制顺序录成 JSON。这是状态层与视口层所有票的真值来源。

做到"同一份剧本重跑两次逐字节一致"需要把原版的三处真实时间全部换掉：
17 个 `javax.swing.Timer`、`while(true){...sleep(10)}` 的主循环、EDT 上的
`paint()`。手法与理由见 `docs/trace-format.md`；为此对 `src/` 做了两处
**行为中性**的改动：`tools.Clock` 增加默认关闭的定时器冻结模式，
`ScenePanel.run()` 的循环体整块提取为 `ScenePanel.step()`。

    tools/export-trace.sh --check      # 每份剧本导两遍并 cmp

同一个导出器加 `--frames <目录>` 还能把原版**真的画出来的**那张 1024×640 位图
每 n 个 tick 存一张 PNG，外加一份帧清单——那是跨端逐帧比对的原版侧那一半
（`tools/compare-frames.sh`，见 `docs/frame-compare.md`）。
