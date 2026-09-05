#!/usr/bin/env bash
# 在原版上执行一份声明式剧本，逐 tick 导出行为真值到 tools/traces/out/。
#
#   tools/export-trace.sh                    # 跑 tools/traces/scripts 下的全部剧本
#   tools/export-trace.sh dorm-walk          # 只跑一份
#   tools/export-trace.sh --check            # 跑两遍，验证两次输出逐字节一致
#
# 产物入库：它是状态层/视口层所有票的真值来源，任何 diff 都是信号。
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"
# 总是重建：只判断目录存在会在源码改动后静默使用陈旧的 class，
# 表现为 ClassNotFoundException 或更糟——用旧逻辑跑出一份"看起来正常"的产物。
tools/build.sh >/dev/null

CP="tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar"
SCRIPTS=tools/traces/scripts
OUT=tools/traces/out

check=0
names=()
for a in "$@"; do
  case "$a" in
    --check) check=1 ;;
    *) names+=("$a") ;;
  esac
done
if [ ${#names[@]} -eq 0 ]; then
  for f in "$SCRIPTS"/*.json; do names+=("$(basename "$f" .json)"); done
fi

mkdir -p "$OUT"
run() {  # run <剧本名> <输出路径>
  "$JAVA_HOME/bin/java" -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 \
    -Djava.awt.headless=false -cp "$CP" \
    devtools.ExportTrace "$SCRIPTS/$1.json" "$2"
}

rc=0
for n in "${names[@]}"; do
  [ -f "$SCRIPTS/$n.json" ] || { echo "找不到剧本 $SCRIPTS/$n.json" >&2; exit 2; }
  run "$n" "$OUT/$n.trace.json"
  if [ "$check" = 1 ]; then
    tmp="$(mktemp -t xl-trace)"
    run "$n" "$tmp"
    if cmp -s "$OUT/$n.trace.json" "$tmp"; then
      echo "  确定性 OK：$n 两次导出逐字节一致（$(wc -c < "$OUT/$n.trace.json" | tr -d ' ') 字节）"
    else
      echo "  确定性失败：$n 两次导出不一致，首个差异：" >&2
      cmp "$OUT/$n.trace.json" "$tmp" >&2 || true
      diff <(tr ',' '\n' < "$OUT/$n.trace.json") <(tr ',' '\n' < "$tmp") | head -20 >&2 || true
      rc=1
    fi
    rm -f "$tmp"
  fi
done
exit $rc
