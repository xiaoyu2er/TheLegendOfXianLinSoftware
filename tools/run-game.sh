#!/usr/bin/env bash
# 启动原版游戏。必须从仓库根目录运行（游戏用相对路径读 script/、sources/ 等）。
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"
# 总是重建：只判断目录存在会在源码改动后静默使用陈旧的 class，
# 表现为 ClassNotFoundException 或更糟——用旧逻辑跑出一份"看起来正常"的产物。
tools/build.sh >/dev/null
exec "$JAVA_HOME/bin/java" \
  -cp "tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar" \
  main.Game "$@"
