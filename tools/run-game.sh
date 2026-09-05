#!/usr/bin/env bash
# 启动原版游戏。必须从仓库根目录运行（游戏用相对路径读 script/、sources/ 等）。
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"
[ -d tools/build/classes ] || tools/build.sh
exec "$JAVA_HOME/bin/java" \
  -cp "tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar" \
  main.Game "$@"
