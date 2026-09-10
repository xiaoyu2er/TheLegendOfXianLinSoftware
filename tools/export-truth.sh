#!/usr/bin/env bash
# 导出数据层真值到 tools/ground-truth/，两族：
#   - script/*.txt 每个脚本的解析真值 → tools/ground-truth/<脚本>.json
#     （几个脚本、几个字段一律现数，这里不写死）；
#   - 原版样例存档（M6，xl-i06.5）→ tools/ground-truth/存档/存档N.json，即原版
#     Loader.loadLine 实际读出来的那几行。旁边的 存档N.txt 是逐字节副本、本身就是
#     真值，导出器不写它；草稿区 sources/Record/ 与副本不等时拒绝导出（见 SaveTruth，
#     tools/test.sh 里的 SaveDraftIntactTest 核同一件事）。
# 这批产物是 web 版数据烘焙管道与存档读取器的黄金基线，入库、一旦生成即冻结 ——
# 重跑之后 git diff tools/ground-truth 必须为空。
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"
# 总是重建：只判断目录存在会在源码改动后静默使用陈旧的 class，
# 表现为 ClassNotFoundException 或更糟——用旧逻辑跑出一份"看起来正常"的产物。
tools/build.sh >/dev/null
exec "$JAVA_HOME/bin/java" -Dstdout.encoding=UTF-8 \
  -cp "tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar" \
  devtools.ExportGroundTruth "${1:-tools/ground-truth}"
