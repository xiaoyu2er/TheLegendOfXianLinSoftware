#!/usr/bin/env bash
# 导出 96 个脚本的解析真值到 tools/ground-truth/*.json。
# 这批 JSON 是 web 版数据烘焙管道的黄金基线，产物入库、一旦生成即冻结。
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"
[ -d tools/build/classes ] || tools/build.sh
exec "$JAVA_HOME/bin/java" -Dstdout.encoding=UTF-8 \
  -cp "tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar" \
  devtools.ExportGroundTruth "${1:-tools/ground-truth}"
