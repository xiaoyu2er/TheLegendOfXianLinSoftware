#!/usr/bin/env bash
# 为一个 bd issue 开一个 git worktree，并在新的 iTerm 标签页里启动一个 Claude 会话。
#
# bd 本身没有拉起终端的能力 —— bd swarm create 只写一条协调记录，等别人来捡。
# 这个脚本就是那个"捡"的动作。
#
# ⚠ 本机有两个 Claude 配置目录：
#     ~/.claude       (别名 ccd-turo)  —— 没有 beads 插件
#     ~/.claude-zyq   (别名 ccd-zyq)   —— 有 /beads:* 与 beads:task-agent
#   默认用后者。用前者起的会话仍有项目级的 SessionStart hook 与 CLAUDE.md，
#   但没有那 22 个斜杠命令。
#
# 用法:
#   tools/bd-spawn.sh [选项] <issue-id> [issue-id...]
#     --dry-run          只打印将要执行的动作，不建 worktree、不认领、不开窗
#     --config-dir <dir> 覆盖 Claude 配置目录（默认 ~/.claude-zyq）
#     --no-claim         不预先认领（交给会话自己 bd update --claim）
#     --force            即使 issue 不在 bd ready 里也照开

set -euo pipefail
cd "$(dirname "$0")/.."
REPO=$(pwd)
REPO_NAME=$(basename "$REPO")

CONFIG_DIR="$HOME/.claude-zyq"
WT_ROOT="$REPO/../${REPO_NAME}-agents"
DRY=0; CLAIM=1; FORCE=0; IDS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)    DRY=1; shift ;;
    --no-claim)   CLAIM=0; shift ;;
    --force)      FORCE=1; shift ;;
    --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    -h|--help)    awk 'NR>1 && /^#/ {sub(/^# ?/,""); print; next} NR>1 {exit}' "$0"; exit 0 ;;
    -*)           echo "未知选项: $1" >&2; exit 2 ;;
    *)            IDS+=("$1"); shift ;;
  esac
done
[ ${#IDS[@]} -gt 0 ] || { echo "需要至少一个 issue id。用 --help 看用法。" >&2; exit 2; }

command -v bd >/dev/null || { echo "找不到 bd" >&2; exit 1; }
[ -d "$CONFIG_DIR" ] || { echo "Claude 配置目录不存在: $CONFIG_DIR" >&2; exit 1; }
osascript -e 'tell application "System Events" to return (exists process "iTerm2")' >/dev/null 2>&1 \
  || echo "⚠ iTerm2 似乎没在运行，AppleScript 会尝试启动它" >&2

READY=$(bd ready 2>/dev/null || true)

for ID in "${IDS[@]}"; do
  echo "──────── $ID"

  if ! bd show "$ID" >/dev/null 2>&1; then
    echo "  ❌ issue 不存在，跳过"; continue
  fi
  if [ "$FORCE" -eq 0 ] && ! printf '%s' "$READY" | grep -q -- "$ID"; then
    echo "  ❌ 不在 bd ready 里（被阻塞、已认领或已关闭）。要强开加 --force"; continue
  fi

  SLUG=$(printf '%s' "$ID" | tr '.' '-')
  WT="$WT_ROOT/$SLUG"
  # 不用 head：它会提前关闭管道，bd 收到 SIGPIPE 返回非零，set -e 会静默中断整个循环。
  TITLE=$(bd show "$ID" 2>/dev/null | sed -n '1s/^[^ ]* //p' | cut -c1-60 || true)

  # 注意：不要在这里写 /implement。上游 mattpocock-skills 的 implement 带
  # disable-model-invocation: true，模型看不见也调不了（实测：被派工的 agent
  # 报「没有 /implement 这个 skill」）。本仓库用项目级的 implement-ticket 代替，
  # 它是模型可自调用的。
  PROMPT="你负责 bd issue ${ID}（${TITLE}）。
第一步：用 implement-ticket 这个 skill，它写明了本仓库的实现流程与硬约束。
第二步：bd show ${ID} 读清楚正文与验收标准——那是唯一的需求来源。
完成后 bd close ${ID} --reason \"<改了什么>\"。
你在一个独立的 git worktree 里，分支是 ${SLUG}，不要动 master，不要推送。"

  if [ "$DRY" -eq 1 ]; then
    echo "  [dry-run] worktree     : $WT"
    echo "  [dry-run] 分支         : $SLUG"
    echo "  [dry-run] 认领         : $([ $CLAIM -eq 1 ] && echo "BEADS_ACTOR=$SLUG bd update $ID --claim" || echo '(跳过)')"
    echo "  [dry-run] 配置目录     : $CONFIG_DIR"
    echo "  [dry-run] 启动脚本     : $WT_ROOT/.spawn/$SLUG/start.sh （在 worktree 外）"
    echo "  [dry-run] 会在 iTerm 新标签页执行:"
    echo "              cd $WT && CLAUDE_CONFIG_DIR=$CONFIG_DIR claude --dangerously-skip-permissions '<提示词>'"
    continue
  fi

  if [ -d "$WT" ]; then
    echo "  ℹ worktree 已存在，复用: $WT"
  else
    mkdir -p "$WT_ROOT"
    bd worktree create "$WT" --branch "$SLUG" >/dev/null
    echo "  ✅ worktree: $WT"
  fi

  if [ "$CLAIM" -eq 1 ]; then
    if out=$(BEADS_ACTOR="$SLUG" bd update "$ID" --claim 2>&1); then
      echo "  ✅ 已认领（actor=${SLUG}）"
    else
      echo "  ❌ 认领失败: $(printf '%s' "$out" | head -1)"; continue
    fi
  fi

  # 提示词与启动脚本放在 worktree *外面*：放里面会让每个 agent 的
  # git status 一开局就不干净，很容易被顺手 commit 进去。
  SPAWN_DIR="$WT_ROOT/.spawn/$SLUG"
  mkdir -p "$SPAWN_DIR"
  printf '%s\n' "$PROMPT" > "$SPAWN_DIR/task.txt"
  cat > "$SPAWN_DIR/start.sh" <<EOF
#!/usr/bin/env bash
cd "$WT"
exec env CLAUDE_CONFIG_DIR="$CONFIG_DIR" claude --dangerously-skip-permissions "\$(cat "$SPAWN_DIR/task.txt")"
EOF
  chmod +x "$SPAWN_DIR/start.sh"

  osascript >/dev/null <<EOF
tell application "iTerm"
  activate
  if (count of windows) = 0 then
    create window with default profile
    set targetTab to current tab of current window
  else
    tell current window to set targetTab to (create tab with default profile)
  end if
  tell current session of targetTab
    set name to "$ID"
    write text "$SPAWN_DIR/start.sh"
  end tell
end tell
EOF
  echo "  ✅ 已在 iTerm 新标签页启动（标签名 ${ID}）"
done
