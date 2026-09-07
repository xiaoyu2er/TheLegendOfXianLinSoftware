#!/usr/bin/env bash
# 导出随机数黄金数据到 tools/random-golden/java-random.json。
#
#   tools/export-random.sh            # 导出一次
#   tools/export-random.sh --check    # 导两遍到临时文件并 cmp，验证确定性
#
# 产物入库：它是 web 端那份位精确 java.util.Random 复刻的唯一判据，
# 重跑之后 `git diff tools/random-golden` 必须为空。
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"
# 参数只认 --check。不认识的参数要响亮失败，不能被无声吃掉然后 exit 0 ——
# 那样「跑过了没确定性检查」和「跑过了且确定性 OK」长得一模一样。
check=0
for a in "$@"; do
  case "$a" in
    --check) check=1 ;;
    *) echo "不认识的参数：${a}，只接受 --check" >&2; exit 2 ;;
  esac
done

# 总是重建：只判断目录存在会在源码改动后静默使用陈旧的 class。
tools/build.sh >/dev/null

CP="tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar"
OUT=tools/random-golden/java-random.json

run() {  # run <输出路径>
  # --add-opens：要读 java.util.Random 私有的 seed 字段，把 48 位内部状态一并导出。
  # 不开这个的表现是 ExportRandom 当场退出码 2 并说明原因，不会退回自己算一遍。
  "$JAVA_HOME/bin/java" -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 \
    --add-opens java.base/java.util=ALL-UNNAMED \
    -cp "$CP" devtools.ExportRandom "$1"
}

run "$OUT"

if [ "$check" = 1 ]; then
  tmp="$(mktemp -t xl-random)"
  run "$tmp" >/dev/null
  if cmp -s "$OUT" "$tmp"; then
    echo "  确定性 OK：两次导出逐字节一致（$(wc -c < "$OUT" | tr -d ' ') 字节）"
    rm -f "$tmp"
  else
    echo "  确定性失败：两次导出不一致，首个差异：" >&2
    cmp "$OUT" "$tmp" >&2 || true
    rm -f "$tmp"
    exit 1
  fi
fi
