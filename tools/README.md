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

## 编码

源码本身是 **GBK**，编译必须 `-encoding GBK`。

数据文件（`script/*.txt`、`sources/Shop/*.txt`、存档）也是 GBK，但代码已在
4 个 I/O 点显式指定编码（见 commit `fix(io):`），**运行时不再需要任何
`-Dfile.encoding` 参数** —— 实测在 openjdk 17 上那些参数一律无效。

## 目录

- `src/devtools/ExportGroundTruth.java` — 真值导出器（Q15 的黄金基线）
- `src/devtools/Json.java` — 极简 JSON 写出，无第三方依赖
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

- `paint()` 有副作用：战斗状态机被渲染驱动。不调 `paint()` 时
  `command.isDraw` 恒为 false（实测 0/120 vs 59/120）。
- 20 个场景依赖前序场景残留的 `dialogueEvent` 对象才能渲染；直接
  `initiation()` 跳进去会 NPE。取景器用 `剧情1.txt` 预热规避。
- `BattlePanel.initial()` 只 `add` 不 `clear` `heroes`/`enemies`，
  连续开战会累积。取景器改成一场一个 JVM。
- `EnemySlector.checkMoveIn()` 判定 em3 时用了 `height1`。
- 31 个资源路径缺失，详见 commit `fix(diag):`。
