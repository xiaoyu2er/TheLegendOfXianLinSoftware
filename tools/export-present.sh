#!/usr/bin/env bash
# 导出战斗上屏那一步的黄金数据到 tools/present-golden/java-present.json（xl-eit）。
#
#   tools/export-present.sh            # 导出一次
#   tools/export-present.sh --check    # 导两遍到临时文件并 cmp，验证确定性
#
# 产物入库：web 端 battle/render/present.test.ts 拿它对上屏模型（底色、alpha 扔不扔）。
# 重跑之后 `git diff tools/present-golden` 必须为空。
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"
# 参数只认 --check。不认识的参数要响亮失败，理由同 export-random.sh。
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
OUT=tools/present-golden/java-present.json

run() {  # run <输出路径>
  # headless=true：只往 BufferedImage 上画，跑在 CI 的条件下。这也决定了 LAF 是 Metal
  # （Windows 上原版的默认）；macOS 真屏幕上是 Aqua，两者的 Panel.background 实测都是 238。
  "$JAVA_HOME/bin/java" -Djava.awt.headless=true \
    -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 \
    -cp "$CP" devtools.ExportPresent "$1"
}

run "$OUT"

if [ "$check" = 1 ]; then
  tmp="$(mktemp -t xl-present)"
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
