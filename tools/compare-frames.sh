#!/usr/bin/env bash
# 跨端逐帧比对：同一份剧本在原版与 Web 版各跑一遍，各出 N 帧，逐帧算差异。
#
#   tools/compare-frames.sh                     # 跑 tools/traces/scripts 下的全部剧本
#   tools/compare-frames.sh dorm-walk           # 只跑一份
#   tools/compare-frames.sh --every 50          # 每 50 个 tick 取一帧（默认 25）
#   tools/compare-frames.sh --threshold 0.001   # 一帧里超过千分之一的像素偏了才算偏离
#   tools/compare-frames.sh dorm-walk --self-check  # 故意改坏一处渲染，验流水线响不响
#
# 产物在 tools/traces/compare/<剧本>/：java/ 是原版真的画出来的位图，
# web/ 是真浏览器里 Pixi 真的画出来的位图，diff/ 是差异图（洋红=偏了），
# 外加一份 report.json。整个目录不入库（tools/.gitignore）。
#
# 退出码：0 = 每条剧本都符合 web/src/compare/expected.ts 里的预期；
#         1 = 有剧本不符合预期（回归了、缺口补上了而表没改），**或者有剧本的
#             驱动器 web 侧还没实现**（战斗 / 菜单 / 商店，见 xl-1vu.7）——
#             后者在报告里单独一段，逐条点名剧本、判别名与归属票号；
#         2 = 流水线自己没跑完。
#
# 判据与"为什么不是哈希"见 web/src/compare/diff.ts；
# "现在必然红"为什么不等于没用，见 web/src/compare/expected.ts。
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"

SCRIPTS=tools/traces/scripts
OUT=tools/traces/compare
every=25
names=()
pass=()   # 透传给 web 侧比对器的参数

while [ $# -gt 0 ]; do
  case "$1" in
    --every) every="$2"; shift 2 ;;
    --threshold|--tolerance) pass+=("$1" "$2"); shift 2 ;;
    --skip-capture|--self-check) pass+=("$1"); shift ;;
    --*) echo "不认识的参数 $1" >&2; exit 2 ;;
    *) names+=("$1"); shift ;;
  esac
done
if [ ${#names[@]} -eq 0 ]; then
  for f in "$SCRIPTS"/*.json; do names+=("$(basename "$f" .json)"); done
fi

# 总是重建：只判断目录存在会在源码改动后静默使用陈旧的 class。
tools/build.sh >/dev/null
CP="tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar"

echo "原版侧：$every 个 tick 取一帧"
for n in "${names[@]}"; do
  [ -f "$SCRIPTS/$n.json" ] || { echo "找不到剧本 $SCRIPTS/$n.json" >&2; exit 2; }
  mkdir -p "$OUT/$n/java"
  # --add-opens 与 tools/export-trace.sh 里那一处同源：战斗驱动器要给
  # java.lang.Math 私有的 Random 播种。两处的 java 命令行必须一致，否则
  # 「导得出来的剧本」在这两条路上会不一样。
  "$JAVA_HOME/bin/java" -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 \
    --add-opens java.base/java.lang=ALL-UNNAMED \
    -Dapple.awt.UIElement=true -Djava.awt.headless=false -cp "$CP" \
    devtools.ExportTrace "$SCRIPTS/$n.json" "$OUT/$n/java/trace.json" \
    --frames "$OUT/$n/java" --every "$every" | sed 's/^/  /'

  # 顺手拿入库的行为真值当校验：这一次导出的 trace 必须与 tools/traces/out/
  # 里那份逐字节一致。不一致意味着原版侧的行为变了 —— 那是比"某一帧画得不像"
  # 严重得多的信号，不能被埋在像素差异里。
  if [ -f "tools/traces/out/$n.trace.json" ]; then
    if ! cmp -s "$OUT/$n/java/trace.json" "tools/traces/out/$n.trace.json"; then
      echo "  原版侧行为已偏离入库真值：$n —— 先跑 tools/export-trace.sh --check" >&2
      exit 2
    fi
  else
    echo "  注意：tools/traces/out/$n.trace.json 不在，跳过了与入库真值的比对" >&2
  fi
done

echo "Web 侧：真浏览器里回放同一份剧本，在同一组 tick 上截图"
cd web
exec pnpm exec vite-node scripts/compare.ts -- "${names[@]}" ${pass[@]+"${pass[@]}"}
