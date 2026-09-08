#!/usr/bin/env bash
# Java 侧单元测试。必须在仓库根目录运行（测试要读 script/ 与 image/）。
#
#   tools/test.sh
#
# 它只钉两条重导对比看不见的那七处，不是给 src/ 建套件 —— 原版是冻结的规范。
# 缺口清单与每一处的篡改点：docs/java-side-test-gap.md。
#
# 没有构建系统，没有第三方 jar：跑起器是 tools/test/devtools/TestMain.java，
# 断言是 Checks.java（xl-f8y，用户 2026-09-08 裁定）。
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"
# 总是重建，理由同 export-truth.sh：只判断目录存在会在源码改动后静默用陈旧的
# class，跑出一份"看起来正常"的结果。
tools/build.sh >/dev/null
# -Djava.awt.headless=true 是**故意**的：CI 的 runner 上没有显示器，本地绿、
# CI 红是最难查的一种红。让本地就跑在 CI 的条件下。
exec "$JAVA_HOME/bin/java" -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 \
  -Djava.awt.headless=true \
  -cp "tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar" \
  devtools.TestMain
