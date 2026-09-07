# 派工：把一张 bd 票交给一个 agent

这份文件是**被派工的 agent 自己要读的**。派工者只需要给一句话：

> 你负责 bd issue `<id>`。先跑 `bd show <id>` 读票，再读 `docs/agents/dispatch.md`，然后用 `/implement` 完成它。

票的正文与验收标准是唯一的需求来源；本仓库的约定在 `CLAUDE.md` 与
`docs/agents/issue-tracker.md`。

## 四条纪律

这四条是 M1 期间五轮并行派工踩出来的，**违反任何一条都算没做完**。

### 1. 关票之前必须先 commit

分支上没有 commit 就 `bd close`，等于成果只存在于你的工作区里，别人 checkout
这个分支什么都看不到。顺序是：

    git add  →  git commit  →  bd close <id> --reason "<改了什么>"

收尾前跑一次 `git status`，确认没有该提交而未提交的东西。

**并行派工的 worktree 可能在会话中途被外部整个删掉再按新 master 重建**（2026-09-06
实测）。工作区里未提交的改动会一并消失，`git reflog` / `stash` 都救不回来——因为
从未进过对象库。所以改完一块能自洽的就先 commit，别攒到收尾。

### 2. 不要改这张票范围之外的共享文件

`CLAUDE.md`、`docs/MIGRATION-PLAN.md`、`docs/agents/*`、`.beads/*` 都是多个 agent
并行时的公共品，你改了就会和别人冲突。确实需要改的，写进 `bd close` 的 reason
里说明，交给主干处理。

有三个文件是**并行热点**，你多半非改不可，那就只做加法、不要重排：

- `web/src/compare/expected.ts`（每张票都要动自己那条剧本的表态）
- `web/scripts/bake.ts`（每张票都可能往里加自己的烘焙）
- `web/src/scene/sceneRenderer.ts`（每张票都可能加自己的绘制层）
- `tools/src/devtools/ExportTrace.java` 里**选驱动器那一处**：现在写死
  `new SceneDriver(script)`，每张接新面板的票都要在这里加自己那一支。加，
  不要顺手把它重构成注册表——两张票同时重构同一处，git 合得干净、`tools/build.sh`
  才报错。真要改成注册表，单开一张票、串行做。

在这三个文件里，改你自己那一段，别顺手整理别人的段落——重排会让一行的冲突变成
整块的冲突。

### 3. 不要把「目前只有 X」这类事实写死

别的 agent 正在并行改同一个仓库，你今天数到的数量、名单、目录内容，合并时可能
已经不成立了。写死过的地方（常量名单、断言里的分母、README 里的描述）合并时
一定冲突。

真实教训：`xl-9bd.6` 写了 `SCENES = ['宿舍','大地图']` 和 `toHaveLength(50)`，
而并行的 `xl-9bd.4` 同时把烘焙改成了全量 96 个，四个文件冲突。

正确做法是**从数据源头推导**——扫目录、读 glob、用 `X.length` 当分母——这样既
保住「少了要响」的检查，又不会和别人撞车。

### 4. 你在一个独立的 git worktree 里

分支名见下面的命名约定。**不要动 master，不要推送，不要合并。**

## 你自己要做的两件 bd 事

派工者不替你做，因为你自己就懂 bd：

1. **开工前认领**：`BEADS_ACTOR=<slug> bd update <id> --claim`。认领失败就停下
   报告，不要硬上——那意味着这张票已经被别人拿走或已经关闭。
2. **确认它真在 `bd ready` 里**。不在就说明它被阻塞了，先问清楚再动手。

`bd` 在空库上返回 `0` 而不报错，所以「没找到」不能当成「没问题」。

## 命名约定

票号里的点换成横杠，得到 slug；分支名与 `BEADS_ACTOR` 都用它：

    xl-9bd.12   →   xl-9bd-12
    xl-1vu.1    →   xl-1vu-1

herdr 的 agent 名字也用 slug —— 它不接受带点的名字（实测报
`invalid_agent_name`）。

**worktree 落在 herdr 的默认位置** `~/.herdr/worktrees/<仓库名>/<分支名>`，
派工时不传 `--path`。

两条另选的路都实测过，各自的问题：

- `<repo>/.claude/worktrees/<name>`（Claude Code 的 `EnterWorktree` 约定）：
  它嵌在仓库里，主仓库的 `git status` 立刻多出一行 `?? .claude/worktrees/`。
  要靠改 `.gitignore` 才能用，那是给约定打补丁。
- `../<repo>-agents/<slug>`（`tools/bd-spawn.sh` 时代的约定）：能用，但和这台
  机器上别的项目在 herdr 的 spaces 面板里长得不一样。

**worktree 不在 `~/code` 下这件事是安全的**，因为 `.zshrc` 里的 `claude()`
按**主仓库**位置选配置目录，不按当前目录：`git rev-parse --git-common-dir`
从链接 worktree 里也指回主仓库。（别用 `--show-toplevel` —— 它给的是当前
worktree 自己的根。）

## 派工与清理

派工者做这些；被派的 agent 一件都不做：

```bash
# 建 worktree（连 workspace + tab + pane 一起给）。label 用「票号 短名」。
herdr worktree create --cwd "$PWD" --branch <slug> --base master \
  --label "<票号> <短名>" --no-focus

# 在它给的那个 pane 里起 claude。名字用 slug。
herdr agent start <slug> --kind claude --pane <wN>:p1 -- --dangerously-skip-permissions

# 一句话 prompt
herdr agent prompt <slug> '你负责 bd issue <票号>。先跑 bd show <票号> 读票，
再读 docs/agents/dispatch.md，然后用 /implement 完成它。'

# 哨兵：等的是 agent 的真实状态，不是票有没有被关
herdr agent wait <slug> --until idle --until done --until blocked --timeout 7200000
```

**清理是派工者的活，在验收合并之后**，两条：

```bash
herdr worktree remove --workspace <wN>   # 删目录 + 摘 worktree + 关 workspace
git branch -d <slug>                     # 分支要单独删，它不管
```

被派的 agent 不许删自己脚下的工作区 —— 它不知道自己的分支合没合并。

两条实测得来的注意事项：

- `herdr agent start` 没有 `--env`，`agent send-keys` 又要求目标已经是 agent，
  所以没有办法往一个还只是 shell 的 pane 里打字。配置目录靠 `.zshrc` 里的
  `claude()` 函数解决，不靠传参。
- `agent start` 是把 `claude ...` **敲进交互式登录 zsh**（实测：claude 是那个
  `-zsh` 的直接子进程），所以 `.zshrc` 里的函数与别名对它是有效的。

## 验收会怎么对你

主干那边不采信自述，每条都会自己跑一遍。所以：

- **有数字就自己先量一遍**，写进 commit message，别写推断出来的数。
- **篡改自己的实现，看测试红不红**；不红就说明它没在验。把这次篡改与它变红的
  结果写进 commit message——这是本仓库对"判据有效"的证明方式。
- **负面用例要真做**，不要声称。
- 优先选**失败的样子和成功不一样**的检查。「找不到东西」不许成为通过条件。
