#!/usr/bin/env bash
# 两端的时间加速倍率：实测线性度。
#
#   tools/speed-probe.sh            # 量 1× 2× 5× 10×
#   tools/speed-probe.sh 1 3 20     # 量指定的倍率（只作用于 Java 侧）
#
# Java 侧量 tools.Clock.sleep —— 原版 13 处 Thread.sleep 与主循环全走它。
# Web 侧量 src/state/loop.ts 的推进器，倍率乘在"真实流逝的毫秒"上。
#
# 退出码非零 = Web 侧某个倍率的实测偏差超过 20%，即加速已经不线性
# （表现是游戏"跑得没那么快"，不报错，所以必须有人量）。
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"

tools/build.sh >/dev/null
"$JAVA_HOME/bin/java" -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 \
  -cp "tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar" \
  devtools.ClockProbe "$@"

echo
cd web
exec pnpm exec vite-node scripts/speed.ts
