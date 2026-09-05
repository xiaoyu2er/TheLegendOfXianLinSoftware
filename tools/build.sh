#!/usr/bin/env bash
# 编译原版游戏 + 开发工具。产物在 tools/build/classes（不入库）。
#
# 关键：源码是 GBK 编码的，必须 -encoding GBK；工具源码是 UTF-8。
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"
JAVAC="$JAVA_HOME/bin/javac"
[ -x "$JAVAC" ] || { echo "找不到 javac：请设 JAVA_HOME（brew install openjdk@17）"; exit 1; }

OUT=tools/build/classes
LIBS="jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar"
rm -rf "$OUT"; mkdir -p "$OUT"

echo "[1/2] 编译游戏本体 (GBK)…"
"$JAVAC" -encoding GBK -nowarn -d "$OUT" -cp "$LIBS" $(find src -name '*.java')

echo "[2/2] 编译开发工具 (UTF-8)…"
"$JAVAC" -encoding UTF-8 -nowarn -d "$OUT" -cp "$OUT:$LIBS" $(find tools/src -name '*.java')

echo "完成：$(find "$OUT" -name '*.class' | wc -l | tr -d ' ') 个 class -> $OUT"
