#!/usr/bin/env bash
# 导出 96 个脚本的解析真值到 tools/ground-truth/*.json。
# 这批 JSON 是 web 版数据烘焙管道的黄金基线，产物入库、一旦生成即冻结。
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"
# 总是重建：只判断目录存在会在源码改动后静默使用陈旧的 class，
# 表现为 ClassNotFoundException 或更糟——用旧逻辑跑出一份"看起来正常"的产物。
tools/build.sh >/dev/null
exec "$JAVA_HOME/bin/java" -Dstdout.encoding=UTF-8 \
  -cp "tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar" \
  devtools.ExportGroundTruth "${1:-tools/ground-truth}"
