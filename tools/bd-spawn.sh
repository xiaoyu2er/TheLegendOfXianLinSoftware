#!/usr/bin/env bash
# 为 bd issue 开 git worktree 并启动 Claude 会话：iTerm 标签页，或后台无头作业。
#
# bd 本身没有拉起终端的能力 —— bd swarm create 只写一条协调记录，等别人来捡。
# 这个脚本就是那个"捡"的动作。
#
# 用法:
#   tools/bd-spawn.sh [选项] <issue-id> [issue-id...]
#     --bg               后台无头执行（claude -p），不开标签页。作业名即 issue id
#     --dry-run          只打印将要执行的动作
#     --no-claim         不预先认领
#     --force            即使不在 bd ready 里也照开
#     --config-dir <dir> 覆盖 Claude 配置目录
#     --jobs             列出后台作业及状态
#     --stop <issue-id>  停掉一个后台作业
#
# ⚠ 两个 Claude 配置目录:
#     ~/.claude       yzong@turo.com            beads 插件 ❌
#     ~/.claude-zyq   zhihui.wang711@gmail.com  beads 插件 ✅   ← 两种模式都默认用它
#
# ⚠ 未登录时 claude -p 打印 "Not logged in" 却仍然 exit 0 —— 不预检的话，
#   后台作业会"成功"地产出一个只写着这句话的日志，看起来跑完了其实什么都没干。
#   所以 --bg 每次启动前实跑一次探针。
#
#   典型的踩法（实测 A/B）：
#     env CLAUDE_CONFIG_DIR=~/.claude-zyq       claude -p  → Not logged in
#     env CLAUDE_CONFIG_DIR="$HOME/.claude-zyq" claude -p  → OK
#   前者因为命令前有 timeout/env，bash 不把它当赋值词，**tilde 不展开**，
#   于是指向当前目录下一个字面名为 ~ 的空目录（还会被顺手创建出来）。
#   本脚本一律用 "$HOME/..."，并在下面校验目录里确有 .claude.json。

set -euo pipefail
cd "$(dirname "$0")/.."
REPO=$(pwd); REPO_NAME=$(basename "$REPO")
WT_ROOT="$REPO/../${REPO_NAME}-agents"
SPAWN_ROOT="$WT_ROOT/.spawn"

CONFIG_DIR=""; DRY=0; CLAIM=1; FORCE=0; BG=0; MODE=spawn; STOP_ID=""; IDS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --bg|--background) BG=1; shift ;;
    --dry-run)         DRY=1; shift ;;
    --no-claim)        CLAIM=0; shift ;;
    --force)           FORCE=1; shift ;;
    --config-dir)      CONFIG_DIR="$2"; shift 2 ;;
    --jobs)            MODE=jobs; shift ;;
    --stop)            MODE=stop; STOP_ID="${2:-}"; shift 2 ;;
    -h|--help)         awk 'NR>1 && /^#/ {sub(/^# ?/,""); print; next} NR>1 {exit}' "$0"; exit 0 ;;
    -*)                echo "未知选项: $1" >&2; exit 2 ;;
    *)                 IDS+=("$1"); shift ;;
  esac
done

slug_of(){ printf '%s' "$1" | tr '.' '-'; }

# ── --jobs ──────────────────────────────────────────────
if [ "$MODE" = jobs ]; then
  [ -d "$SPAWN_ROOT" ] || { echo "还没有任何后台作业"; exit 0; }
  printf "%-14s %-8s %-10s %s\n" "作业(issue)" "PID" "状态" "日志"
  found=0
  for j in "$SPAWN_ROOT"/*/; do
    [ -f "$j/pid" ] || continue
    found=$((found+1))
    pid=$(cat "$j/pid"); name=$(basename "$j")
    if kill -0 "$pid" 2>/dev/null; then st="运行中"; else st="已结束"; fi
    printf "%-14s %-8s %-10s %s\n" "$name" "$pid" "$st" "$j/log"
  done
  [ "$found" -gt 0 ] || echo "（无）"
  exit 0
fi

# ── --stop ──────────────────────────────────────────────
if [ "$MODE" = stop ]; then
  [ -n "$STOP_ID" ] || { echo "--stop 需要一个 issue id" >&2; exit 2; }
  j="$SPAWN_ROOT/$(slug_of "$STOP_ID")"
  [ -f "$j/pid" ] || { echo "找不到作业: $STOP_ID" >&2; exit 1; }
  pid=$(cat "$j/pid")
  if kill -0 "$pid" 2>/dev/null; then kill "$pid" && echo "已停止 $STOP_ID (pid $pid)"
  else echo "$STOP_ID 已经不在运行 (pid $pid)"; fi
  exit 0
fi

# ── spawn ───────────────────────────────────────────────
[ ${#IDS[@]} -gt 0 ] || { echo "需要至少一个 issue id。用 --help 看用法。" >&2; exit 2; }
command -v bd >/dev/null || { echo "找不到 bd" >&2; exit 1; }

# 两种模式都默认 zyq（那边有 beads 插件）。无头鉴权若瞬时失效，
# 下面的预检会拦住并提示改用 --config-dir $HOME/.claude。
[ -n "$CONFIG_DIR" ] || CONFIG_DIR="$HOME/.claude-zyq"
case "$CONFIG_DIR" in
  *"~"*) echo "❌ 配置目录里有字面量 ~，说明 tilde 没被展开: $CONFIG_DIR" >&2
         echo "   用 \"\$HOME/...\" 而不是 ~/... " >&2; exit 1 ;;
esac
[ -d "$CONFIG_DIR" ] || { echo "❌ Claude 配置目录不存在: $CONFIG_DIR" >&2; exit 1; }
[ -f "$CONFIG_DIR/.claude.json" ] || {
  echo "❌ $CONFIG_DIR 里没有 .claude.json，不像一个已登录的配置目录" >&2; exit 1; }

# 无头鉴权预检：必须做，因为未登录时 claude -p 仍然 exit 0
if [ "$BG" -eq 1 ] && [ "$DRY" -eq 0 ]; then
  probe=$(timeout 90 env CLAUDE_CONFIG_DIR="$CONFIG_DIR" claude -p "回答 OK 两个字母，不要做别的" 2>&1 | head -3 || true)
  if printf '%s' "$probe" | grep -qi "not logged in\|please run /login"; then
    echo "❌ 无头鉴权预检失败：$CONFIG_DIR 未登录（claude -p 报 Not logged in）" >&2
    echo "   注意它的 exit code 仍是 0，所以不预检的话后台作业会静默空转。" >&2
    echo "   可换 --config-dir \$HOME/.claude，或在该目录下 /login。" >&2
    exit 1
  fi
  echo "✅ 无头鉴权预检通过（${CONFIG_DIR}）"
fi

READY=$(bd ready 2>/dev/null || true)

for ID in "${IDS[@]}"; do
  echo "──────── $ID"
  bd show "$ID" >/dev/null 2>&1 || { echo "  ❌ issue 不存在，跳过"; continue; }
  if [ "$FORCE" -eq 0 ] && ! printf '%s' "$READY" | grep -q -- "$ID"; then
    echo "  ❌ 不在 bd ready 里（被阻塞、已认领或已关闭）。要强开加 --force"; continue
  fi

  SLUG=$(slug_of "$ID")
  WT="$WT_ROOT/$SLUG"
  JOB="$SPAWN_ROOT/$SLUG"
  # 不用 head：它会提前关闭管道，bd 收到 SIGPIPE 返回非零，set -e 会静默中断整个循环。
  TITLE=$(bd show "$ID" 2>/dev/null | sed -n '1s/^[^ ]* //p' | cut -c1-60 || true)

  PROMPT="你负责 bd issue ${ID}（${TITLE}）。

先跑 bd show ${ID} 读清楚正文与验收标准——那是唯一的需求来源，
再读 CLAUDE.md 与 docs/agents/issue-tracker.md 了解本仓库的约定。
然后用 /implement 完成它。

三条纪律，违反任何一条都算没做完：

1. **关票之前必须先 commit。** 分支上没有 commit 就 bd close，等于成果只
   存在于你的工作区里，别人 checkout 这个分支什么都看不到。顺序是：
   git add -> git commit -> bd close ${ID} --reason \"<改了什么>\"。
   收尾前跑一次 git status，确认没有该提交而未提交的东西。

2. **不要改这张票范围之外的共享文件。** CLAUDE.md、docs/MIGRATION-PLAN.md、
   docs/agents/*、.beads/* 都是多个 agent 并行时的公共品，你改了就会和别人
   冲突。确实需要改的，写进 bd close 的 reason 里说明，交给主干处理。

   有三个文件是**并行热点**，你多半非改不可，那就只做加法、不要重排：
   web/src/compare/expected.ts（每张票都要动自己那条剧本的表态）、
   web/scripts/bake.ts（每张票都可能往里加自己的烘焙）、
   web/src/scene/sceneRenderer.ts（每张票都可能加自己的绘制层）。
   在这三个文件里，改你自己那一段，别顺手整理别人的段落——重排会让一行
   的冲突变成整块的冲突。

3. **不要把「目前只有 X」这类事实写死。** 别的 agent 正在并行改同一个仓库，
   你今天数到的数量、名单、目录内容，合并时可能已经不成立了。写死过的地方
   （常量名单、断言里的分母、README 里的描述）合并时一定冲突。真实教训：
   xl-9bd.6 写了 SCENES = ['宿舍','大地图'] 和 toHaveLength(50)，而并行的
   xl-9bd.4 同时把烘焙改成了全量 96 个，四个文件冲突。
   正确做法是**从数据源头推导**——扫目录、读 glob、用 X.length 当分母——
   这样既保住「少了要响」的检查，又不会和别人撞车。

4. 你在一个独立的 git worktree 里，分支是 ${SLUG}。不要动 master，不要推送，
   不要合并。"

  if [ "$DRY" -eq 1 ]; then
    echo "  [dry-run] 模式       : $([ $BG -eq 1 ] && echo '后台无头' || echo 'iTerm 标签页')"
    echo "  [dry-run] worktree   : $WT"
    echo "  [dry-run] 配置目录   : $CONFIG_DIR"
    echo "  [dry-run] 作业目录   : $JOB"
    echo "  [dry-run] 认领       : $([ $CLAIM -eq 1 ] && echo "BEADS_ACTOR=$SLUG bd update $ID --claim" || echo '(跳过)')"
    continue
  fi

  if [ -d "$WT" ]; then echo "  ℹ worktree 已存在，复用"
  else mkdir -p "$WT_ROOT"; bd worktree create "$WT" --branch "$SLUG" >/dev/null; echo "  ✅ worktree: $WT"; fi

  if [ "$CLAIM" -eq 1 ]; then
    if out=$(BEADS_ACTOR="$SLUG" bd update "$ID" --claim 2>&1); then echo "  ✅ 已认领（actor=${SLUG}）"
    else echo "  ❌ 认领失败: $(printf '%s' "$out" | sed -n 1p)"; continue; fi
  fi

  # 作业文件放在 worktree *外面*：放里面会让 agent 的 git status 一开局就不干净。
  mkdir -p "$JOB"
  printf '%s\n' "$PROMPT" > "$JOB/task.txt"

  if [ "$BG" -eq 1 ]; then
    if [ -f "$JOB/pid" ] && kill -0 "$(cat "$JOB/pid")" 2>/dev/null; then
      echo "  ⚠ 已有同名作业在跑 (pid $(cat "$JOB/pid"))，跳过"; continue
    fi
    ( cd "$WT" && exec env CLAUDE_CONFIG_DIR="$CONFIG_DIR" BEADS_ACTOR="$SLUG" \
        claude -p --dangerously-skip-permissions "$(cat "$JOB/task.txt")" ) \
      > "$JOB/log" 2>&1 &
    echo $! > "$JOB/pid"
    echo "  ✅ 后台作业已启动  名称=${ID}  pid=$(cat "$JOB/pid")"
    echo "     日志: $JOB/log      跟踪: tail -f $JOB/log"
  else
    cat > "$JOB/start.sh" <<EOF
#!/usr/bin/env bash
cd "$WT"
exec env CLAUDE_CONFIG_DIR="$CONFIG_DIR" BEADS_ACTOR="$SLUG" claude --dangerously-skip-permissions "\$(cat "$JOB/task.txt")"
EOF
    chmod +x "$JOB/start.sh"
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
    write text "$JOB/start.sh"
  end tell
end tell
EOF
    echo "  ✅ 已在 iTerm 新标签页启动（标签名 ${ID}）"
  fi
done
