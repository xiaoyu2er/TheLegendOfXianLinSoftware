# 派工：把一张 bd 票交给一个 agent

这份文件是**被派工的 agent 自己要读的**。派工者给的那一句话必须**以斜杠命令开头**：

> `/implement bd issue <id>。先跑 bd show <id> 读票，再读 docs/agents/dispatch.md。`

**「行首」不是格式讲究，是它生效与否的分界。** 斜杠命令由**客户端**展开：写在
行首，agent 收到的第一条消息是 `<command-name>/mattpocock-skills:implement</command-name>`
加参数、skill 正文直接进上下文；夹在句子中间（「……然后用 `/implement` 完成它」）
就只是一句普通文本，模型把它当建议，skill **一次都不会生效**。

这不是推测，是数出来的（2026-09-06，同一个仓库、相邻的两张票）：

| prompt 写法 | skill 生效 | typecheck | pnpm test | /code-review |
|---|---|---|---|---|
| 句中「用 `/implement`」 | 否 | **0 次** | **0 次** | 0 次 |
| 行首 `/implement …` | **是** | **13 次** | **9 次** | **1 次** |

那个 0 次是有代价的：`xl-1vu.6` 因此一次 web 门禁都没跑，漏了一条表态，
主干合并时才发现。skill 正文里「经常跑 typecheck、最后跑全量测试、用
`/code-review` 复查」这三句，实测是真的会被照做的。

⚠️ 一个会骗人的读数：**Skill 工具的调用次数是 0，不代表 skill 没生效** ——
行首展开发生在客户端，根本不经过那个工具。要判断生效与否，看 agent 收到的
第一条消息里有没有 `<command-name>` 块。

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

### 你在 worktree 里，但 bd 读的是主仓库那一份库

实测过的链条（2026-09-06）：

    worktree/.git                     ← 是个文件，不是目录
      内容: gitdir: <主仓库>/.git/worktrees/<slug>
           ↓
    git rev-parse --git-common-dir    → <主仓库>/.git
           ↓
    bd where（在 worktree 里跑）       → <主仓库>/.beads
                                        database: …/.beads/embeddeddolt

`bd where` 是它自己给的权威答案，有疑问就跑它。

三条支撑：`.beads/embeddeddolt/` 是 gitignore 掉的（见 `.beads/.gitignore`），
所以 worktree 里**没有数据库**、跑完 bd 也不会长出来；`metadata.json` 里没有
任何路径，两边逐字节相同；而 worktree 可能落在 `~/.herdr/` 下，沿文件系统往上
走**永远到不了主仓库**。反证也做过：把 `.beads/` 的入库文件复制到一个没有
`.git` 的目录，`bd count` 报 `no beads database found`、退出码 1。

对你的意义：**所有 worktree 共用同一个库**，你的 `--claim` 与 `bd close` 主干
那边立刻看得见。落点搬到哪里都不影响这件事，因为解析走的是 git 链接不是路径。

⚠️ 未验证：多个 agent 同时写这一个嵌入式 Dolt 会不会冲突或丢更新，**没有测过**。
今天四个并行没出问题，那是观察不是结论。

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

## 收尾时留下你踩过的坑

关票时除了「改了什么」，还要交一样东西：**这一趟你踩过的坑**。写在 `bd close`
的 reason 里，或者 commit message 里，两处都行。

这不是复盘仪式。下面那一节「验证动作本身的坑」里的每一条，都是某个 agent 或
主干在某一趟里真栽过、事后才被打捞出来的；打捞是有损的，而当事人写一句话是
无损的。你交上来的坑，主干会挑出通用的那些补进这份文件，下一个人就不必再踩。

**最值得交的是这三种**，它们的共同点是「失败的样子和成功一模一样」：

1. **你以为某个检查在验，其实它没在验。** 比如篡改了实现，测试却是绿的。
2. **一条命令的成功与失败输出长得一样。** 比如管道吞了退出码、grep 没匹配到
   却返回了空、某个工具报错却 exit 0。
3. **你的测法本身是错的，而结果看起来是合理的。** 比如环境被污染、改的文件
   被工具重新生成覆盖了、量的是错误的那一对读数。

格式不限，一句话也行，要的是**具体**：什么命令、什么现象、正确的做法是什么。
例：

    踩过的坑：先用 `pnpm test | tail` 判断成败，拿到的是 tail 的退出码，
    一直显示成功。改成先重定向到文件再 `echo $?`。

**没踩到坑就明确写「没有」。** 空着和忘了写长得一样 —— 又是同一类问题。

## 验证动作本身的坑

判据失灵与判据通过长得一模一样，所以**测法**本身也要验。下面每条这个仓库都
真栽过，且都表现为「篡改了却没红」——看起来像判据没用，其实是测法不对。

**1. 管道吞退出码。** `cmd | tail` 拿到的是 `tail` 的退出码。要判断成败的命令
不要接管道：

    cmd > /tmp/out.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/out.log

**2. 篡改要挑对层。** `tools/export-trace.sh --check` 只证明「这一次跑出来的
东西可复现」。三个 agent 各自独立撞到过它的边界，三种它一律看不见的东西：

- **一个稳定的错误**（状态字段一直算错）——在它眼里和正确一模一样；
  能认出来的是重导之后 `git diff tools/traces/out` 为不为空。
- **真值不记录的字段里的不确定性**——它只 `cmp` trace.json，那些字段不在里面；
  只有 `--frames` 出图才会时对时错。
- **剧本注释与真值不一致**（注释说动画在往前走，导出来全是 null）——两者都不看
  注释；只有把真值打开逐行读才发现。

挑判据时先问：这条检查失败的样子，和它通过的样子长得一样吗。

**3. `tools/compare-frames.sh` 会重跑 Java 导出。** 手改 `tools/traces/compare/
<剧本>/java/trace.json` 再跑它，改动会被覆盖；而 `--skip-capture` 又跳过浏览器，
取图页根本没机会读你改的东西。要测取图页的行为，绕开外壳直接跑：

    cd web && pnpm exec vite-node scripts/compare.ts -- <剧本>

**4. worktree 里的 `web/node_modules` 是空的。** herdr 新建的 worktree 不带它，
头一次跑 `compare-frames.sh` 会得到 `Command "vite-node" not found`，跑
`pnpm typecheck` 会得到 `tsc: command not found`。**先 `cd web && pnpm install`。**
不装就等于两条 web 门禁一条都没跑过——`xl-1vu.6` 就是这么漏掉一条表态的。

**5. 测试环境会被你自己的环境污染。** 验 `.zshrc` 里那个按项目选配置目录的
`claude()` 函数时，头一轮每个分支都返回同一个值——因为跑测试的这个进程本身就
带着 `CLAUDE_CONFIG_DIR`。要 `env -u CLAUDE_CONFIG_DIR zsh -ic '...'` 才测得准。
凡是「读环境变量再决定」的东西，先把那个变量清掉。

**6. 引号与 heredoc。** 中文正文里的半角引号会提前闭合 shell 字符串（派工脚本
曾因此 exit 127）；一条命令里写两个 heredoc 会产生一个消息是垃圾的提交，而且
**不报错**。长文本一律写文件再 `--file=<路径>` 或 `"$(cat 文件)"`。

**7. 篡改本身可能根本没写进去，而工具照样 exit 0。** `sed -i.orig 's/BG_COUNT
= 53/= 52/'` 改一行算出来的常量——那个字面量不存在，sed 没匹配到，**退出码
仍是 0**，于是"篡改了但测试是绿的"，看起来像判据失灵（`xl-23y` 实测）。凡是
篡改验证，先确认篡改生效再看颜色：

    python3 -c "s=open(p).read(); assert OLD in s, '篡改点没匹配到'; open(p,'w').write(s.replace(OLD,NEW,1))"

**8. `git diff --name-only` 会把中文路径整个加引号**（`"web/src/\345\244..."`）。
喂进 shell 循环后 `git show` / `cmp` 全部 "no such file"，而
`cmp -l a b | wc -l` 照样打印 **0** ——和"零字节不同"长得一模一样（`xl-23y`
实测，本仓库的产物路径几乎全是中文）。用 NUL 分隔读：

    git diff --name-only -z -- <路径> | while IFS= read -r -d '' f; do … done

**9. 判定 m4a 重烘 churn 要看偏移，不要看字节个数。** `bake-m4a-timestamps`
那条 memory 原先记的"每个文件恰好 12 个字节不同"不是常数——`xl-23y` 那趟实测
是 18 个。差多少取决于距上次烘焙过了多久（两个 4 字节时间戳里有几个字节恰好
相同）。判据是**差异偏移是否全部小于 300**（mvhd/tkhd/mdhd 都在文件头）。
memory 已按实测改写。这条本身也是"别人的数字要自己再量一遍"的实例。
