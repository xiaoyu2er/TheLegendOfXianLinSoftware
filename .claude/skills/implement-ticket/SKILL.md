---
name: implement-ticket
description: 实现一张 bd ticket（本仓库的 /implement 替代品）。当你被指派了一个 xl-* issue、或要开始做某张票时使用。上游 mattpocock-skills 的 /implement 带 disable-model-invocation，模型看不见也调不了，所以这里重述其流程并补上本仓库的约束。
---

# 实现一张 bd ticket

上游 `/implement` 的正文只有六行，核心是：**在事先约定好的缝上用 `/tdd`，
频繁跑类型检查与单测，最后跑一次全量测试，再用 `/code-review` 复查，然后提交。**
`/tdd` 与 `/code-review` 都是模型可自调用的，直接用。

以下是本仓库额外的约束。**先读完再动手。**

## 1. 认领与收尾

```bash
bd show <id>                      # 正文与验收标准是唯一的需求来源
bd update <id> --claim            # 若派工脚本已经认领过，这步会提示已认领，正常
# …做完…
bd close <id> --reason "<改了什么>"
```

你在一个独立的 git worktree 与分支上，**不要动 master**。
提交到当前分支即可，不要推送、不要合并，除非被明确要求。

## 2. 三条测试缝，以及一条硬约束

| 缝 | 签名 | 真值来源 |
| --- | --- | --- |
| 1 数据 | `bakeScript(raw) → SceneScript` | `tools/ground-truth/*.json`（已冻结，96 文件 × 26 字段） |
| 2 状态 | `step(world, input, dtMs) → World` | 原版 trace 导出器（`xl-9bd.2`） |
| 2.5 视口 | `computeViewport` / `computeDrawOrder` | 同上，共用一份 trace |
| — 像素 | 不设缝 | 跨端剧本逐帧比对（验收闸门，非测试） |

**硬约束：缝 2 与 2.5 在 trace 真值就绪前不得开工。**
已冻结的 96 个 JSON 是原版解析器的形状，不是 `World` 的形状。没有从原版录制的
行为 trace，缝 2 的测试只能是手写期望值——而写实现和写期望的是同一个你、在同一个
上下文窗口里。**那样的测试会绿，而且是错的。**

如果你手上的票需要缝 2/2.5 而 trace 还没有，停下来说明情况，不要硬做。

## 3. 判据必须让"坏"和"好"长得不一样

本仓库已经栽过多次：

- 战斗截图曾被判为"60/60 唯一帧、没问题"，实际 16 场里 14 场两秒后完全静止、
  九成的帧是废的——用哈希判"唯一帧"没有诊断力，进度条挪一像素就算不同。
- `awk '/^Fight$/'` 匹配不到任何东西，因为数据是 CRLF，而"什么都没找到"
  正是这个检查的通过条件。
- `bd supersede` 的 13 次调用全部失败，却因为 `| tail -1` 截掉了多行报错而
  看起来像静默成功。

所以：**每个检查都要有一个开跑前就能数清楚的分母**，凡是"没找到问题就算通过"的
检查一律不算数。跑命令时不要用 `| head` 截断（会引发 SIGPIPE 让 `set -e` 静默
中断），也不要 `2>/dev/null` 吞掉 stderr。

## 4. 碰原版 Java 代码时

- 源码是 **GBK + CRLF**，编译要 `-encoding GBK`。程序化编辑要经 UTF-8 往返再写回
  GBK+CRLF，**绝不要往 `src/` 写裸 LF**。
- 数据文件（`script/*.txt` 等）也是 GBK + CRLF，`grep`/`awk` 用 `$` 锚定前先
  `tr -d '\r'`。
- **迁移期内 Java 源码是规格文档**，保持可运行，不改游戏逻辑。
- **不要"修好" `script/` 里那 3 行 Windows 反斜杠路径**——它们是烘焙管道路径
  规范化逻辑的现成测试夹具。

## 5. 所有命令从仓库根目录跑

原版用相对路径读 `script/`、`sources/`、`image/`。

```bash
tools/build.sh          # 编译原版 + 开发工具
tools/run-game.sh       # 跑原版
tools/export-truth.sh   # 重导 96 份真值；git diff tools/ground-truth 必须为空
```

更多约定见 `CLAUDE.md`、`docs/agents/issue-tracker.md`、`docs/MIGRATION-PLAN.md`。
