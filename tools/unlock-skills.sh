#!/usr/bin/env bash
# 解锁 mattpocock-skills 里若干 skill 的模型自调用能力。
#
# 背景：这些 skill 的 frontmatter 带 disable-model-invocation: true，
# 于是它们根本不出现在模型的可用列表里，只能由人手输斜杠命令触发。
# 自主 agent 因此无法使用 /implement —— 被派工的会话会报「没有这个 skill」。
#
# ⚠ 这是在改插件缓存，**插件一更新就会被覆盖**。所以本脚本做成可重复施加、
#   可检查、可还原的：更新插件后重跑一次即可，用 --check 确认状态。
#
# 用法:
#   tools/unlock-skills.sh --check     # 只报告状态，不改
#   tools/unlock-skills.sh             # 施加解锁
#   tools/unlock-skills.sh --restore   # 还原为上游默认（重新禁用）
set -euo pipefail

# 只解锁自主 agent 真正需要、且自调用不会造成伤害的：
#   implement    做一张票的主流程
#   to-spec      发现票的范围不对时，重新出规格
#   to-tickets   发现票太大时，切成更细的垂直切片
#   handoff      跨会话/跨 worktree 交接
# 刻意不解锁：grill-me / grill-with-docs / ask-matt / wait-what / teach /
#   to-questionnaire —— 这些是访谈型 skill，模型自调用会变成不请自来地盘问用户；
#   triage / wayfinder / improve-codebase-architecture —— 重量级探索，token 开销大；
#   setup-matt-pocock-skills —— 会改配置。
SKILLS=(implement to-spec to-tickets handoff)
DIRS=("$HOME/.claude" "$HOME/.claude-zyq")
REL="plugins/cache/claude-plugins-official/mattpocock-skills"

MODE=apply
case "${1:-}" in
  --check)   MODE=check ;;
  --restore) MODE=restore ;;
  -h|--help) awk 'NR>1 && /^#/ {sub(/^# ?/,""); print; next} NR>1 {exit}' "$0"; exit 0 ;;
  "")        ;;
  *)         echo "未知选项: $1" >&2; exit 2 ;;
esac

total=0; hit=0; changed=0
for d in "${DIRS[@]}"; do
  base="$d/$REL"
  [ -d "$base" ] || { echo "跳过（未安装）: $d"; continue; }
  ver=$(ls "$base" | head -1)
  echo "── $d  (mattpocock-skills $ver)"
  for s in "${SKILLS[@]}"; do
    total=$((total+1))
    f=$(find "$base" -type d -name "$s" -exec test -f {}/SKILL.md \; -print 2>/dev/null | head -1)
    if [ -z "$f" ]; then printf "   %-12s ❓ 找不到\n" "$s"; continue; fi
    f="$f/SKILL.md"; hit=$((hit+1))
    cur=$(grep -m1 '^disable-model-invocation:' "$f" || echo "(无该字段)")
    case "$MODE" in
      check)
        case "$cur" in
          *true)  printf "   %-12s 🚫 禁用（模型看不见）\n" "$s" ;;
          *false) printf "   %-12s ⚠ 写成了 false —— 加载器是否认这个写法未经验证，建议重跑本脚本改为删除该行\n" "$s" ;;
          *)      printf "   %-12s ✅ 已解锁（无该字段）\n" "$s" ;;
        esac ;;
      apply)
        # 直接删掉整行，而不是写 false —— 那 15 个本来就能自调用的 skill
        # 压根没有这个字段，删除即与已知可用状态完全一致，不必赌 false 是否被解析。
        if printf '%s' "$cur" | grep -q 'disable-model-invocation'; then
          perl -ni -e 'print unless /^disable-model-invocation:/' "$f"
          printf "   %-12s 🔓 已解锁（删除该字段）\n" "$s"; changed=$((changed+1))
        else printf "   %-12s ・ 已是解锁状态\n" "$s"; fi ;;
      restore)
        if printf '%s' "$cur" | grep -q 'disable-model-invocation'; then
          printf "   %-12s ・ 无需改动\n" "$s"
        else
          # 插在闭合 --- 之前。不要挂在 description 后面：handoff 的
          # argument-hint 在 description 之后，那样会插到 frontmatter 中间。
          perl -ni -e 'BEGIN{$n=0} $n++ if /^---$/; print "disable-model-invocation: true\n" if $n==2 && !$done && ($done=1); print' "$f"
          printf "   %-12s 🔒 已还原\n" "$s"; changed=$((changed+1))
        fi ;;
    esac
  done
done
# 改完立刻校验 frontmatter 完整性。之前有一版脚本用 s/…\s*$/…/ 替换，
# \s*$ 吃掉了换行符把闭合的 --- 并进同一行，下一次删整行时 --- 也跟着没了 ——
# 而这种损坏不会报错，只会让 skill 静默失效。
if [ "$MODE" != check ]; then
  bad=0
  for d in "${DIRS[@]}"; do
    base="$d/$REL"; [ -d "$base" ] || continue
    for s2 in "${SKILLS[@]}"; do
      f2=$(find "$base" -type d -name "$s2" -exec test -f {}/SKILL.md \; -print 2>/dev/null | head -1)
      [ -n "$f2" ] || continue
      n2=$(awk 'NR<=12 && /^---$/{c++} END{print c+0}' "$f2/SKILL.md")
      [ "$n2" -eq 2 ] || { echo "❌ frontmatter 损坏（--- 只有 $n2 个）: $f2/SKILL.md"; bad=$((bad+1)); }
    done
  done
  [ "$bad" -eq 0 ] && echo "frontmatter 完整性校验: 全部通过" || { echo "⚠ $bad 个文件 frontmatter 损坏"; exit 1; }
fi
echo "───────"
echo "目标 skill 数: ${#SKILLS[@]} × ${#DIRS[@]} 个目录 = $total ；实际命中 $hit"
[ "$MODE" = check ] || echo "本次改动: $changed 个文件"
[ "$hit" -eq "$total" ] || { echo "⚠ 有目标没命中，上面已逐条列出"; exit 1; }
