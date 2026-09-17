#!/usr/bin/env bash
# 原版鼠标事件派发探针：量「舞台外按着键拖进来」那一族的几下鼠标，原版到底收没收到、派给了谁。
# （xl-zs6 现搭的一次性探针，xl-sij 收成可复跑的工具。）
#
#   tools/mouse-dispatch-probe.sh --dry-run    # 只编译两侧 + 读权限，一个事件都不发、不碰鼠标
#   tools/mouse-dispatch-probe.sh              # 真跑：起原版、合成五组序列、与期望读数对账
#   tools/mouse-dispatch-probe.sh --yes        # 同上，跳过「要接管鼠标」那句确认
#   tools/mouse-dispatch-probe.sh --rounds 1   # 少跑几轮（默认 3 轮，判确定性）
#   tools/mouse-dispatch-probe.sh --out <目录> # 日志落在哪（默认临时目录，跑完留着路径）
#
# ⚠️ 跑之前要先问人：它接管物理鼠标，这十几秒里光标会自己动、会真的按下去。
#    --yes 是给「已经问过了」用的，不是默认。
#
# ⚠️ 权限前提（两个都要，人在「系统设置 → 隐私与安全性 → 辅助功能」里给跑它的那个终端）：
#      CGPreflightPostEventAccess=true   能不能往 HID tap 上发合成事件
#      AXIsProcessTrusted=true           这个进程是不是被信任的辅助功能客户端
#    没授权时合成事件被**静默丢弃**，Java 侧同样是零事件 —— 与「原版真的收不到」长得一模一样。
#    所以本脚本先读这两个值，再把 **A 对照**（窗口内空白处左键单击必须被 start.StartPanel 收到）
#    当判据的一部分核一遍：A 没行 = 权限没给，不是「原版收不到」。
#
# ⚠️ 跑不进 CI，两条硬拦：要真窗口（-Djava.awt.headless=false，还要 StartPanel 真摆在屏幕上），
#    要「辅助功能」授权（人在系统设置里点的，runner 上给不了）。CI 里覆盖到的只有
#    tools/build.sh 编得过探针那个 .java；驱动器那半连编译都不在 CI 里，要 --dry-run 才编。
#    （对照：tools/export-scaled-blit.sh 只往 BufferedImage 上画，那个是**跑得进**的。）
#
# 期望读数（xl-zs6，macOS 24.6.0 + openjdk 17，2026-09-16，三轮逐字一致）在
# tools/mouse-dispatch/expected-events.txt，跑完自动对账；读法与限定见
# tools/src/devtools/MouseDispatchProbe.java 的类注释。
#
# 退出码：0 一切如常；1 **回归**（A 对照不成立 / 与 expected-events.txt 对不上 / 轮间不一致 /
# 正对照不成立）；2 参数错；4 **D 组的预测被实测推翻**（与 expected-events-D.txt 对不上）——
# 4 不是「谁错了」，那就是 xl-8eg 要的读数，按它改写预测那几行。
#
# 跑完还会打一份**按 MARK 分段**的读数（tools/mouse-dispatch/reckon.py，xl-8eg 加的）。
# 它和上面那份对账是两件事：对账只看按下 / 松手，而 D 组要量的是 **DRAGGED**，一条都进不了对账。
# 分段读数不含计数、不含坐标（条数与坐标都不稳），只报每一段「出现过哪几种事件、派给了谁」。
set -euo pipefail
OLDPWD_AT_START="$PWD"
cd "$(dirname "$0")/.."
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"

dry=0; yes=0; rounds=3; outdir=""
# ⚠️ 带值的参数要自己检查值在不在：写成 `shift; rounds="${1:-}"` 再靠末尾那个 shift，
# 值缺失时 set -e 会在那个 shift 上先退出，下面那句「要一个正整数」**永远打不出来** ——
# 静默 exit 1 与「参数校验响了」长得不一样，但与「别的什么东西挂了」长得一样。
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1; shift ;;
    --yes) yes=1; shift ;;
    --rounds) [ $# -ge 2 ] || { echo "--rounds 后面要跟一个正整数" >&2; exit 2; }; rounds="$2"; shift 2 ;;
    --out) [ $# -ge 2 ] || { echo "--out 后面要跟一个目录" >&2; exit 2; }; outdir="$2"; shift 2 ;;
    *) echo "不认识的参数：${1}，只接受 --dry-run / --yes / --rounds N / --out 目录" >&2; exit 2 ;;
  esac
done
case "$rounds" in ''|*[!0-9]*) echo "--rounds 要一个正整数，收到：${rounds}" >&2; exit 2 ;; esac
[ "$rounds" -ge 1 ] || { echo "--rounds 至少是 1" >&2; exit 2; }

EXPECTED=tools/mouse-dispatch/expected-events.txt
[ -f "$EXPECTED" ] || { echo "找不到期望读数：${EXPECTED}" >&2; exit 1; }
# D 组那几行还是**预测**，单独一份、单独对账（退出码 4），理由写在它开头。
EXPECTED_D=tools/mouse-dispatch/expected-events-D.txt
[ -f "$EXPECTED_D" ] || { echo "找不到 D 组的预测：${EXPECTED_D}" >&2; exit 1; }

# ⚠️ 上面已经 cd 到仓库根了，所以 --out 给的相对路径要按**调用者的 cwd**解回来，
# 否则 `--out out/` 会静悄悄落在仓库根下面，而不是你以为的那个目录。
if [ -z "$outdir" ]; then
  outdir="$(mktemp -d -t xl-mouse-dispatch)"
else
  case "$outdir" in /*) ;; *) outdir="$OLDPWD_AT_START/$outdir" ;; esac
fi
mkdir -p "$outdir"
outdir="$(cd "$outdir" && pwd)"

# 期望读数里 # 开头的是出处与读法，滤掉再对账。
# 放在这里（而不是跑之前那一步）是为了：期望读数本身不成立的话，别先把鼠标借走。
EXP="$outdir/expected.txt"
EXP_D="$outdir/expected-D.txt"
# `|| true`：一条都没滤出来时 grep 退出 1，set -e 会当场退出，下面那句守卫就**永远打不出来** ——
# 那是一个没有任何输出的 exit 1，与「别的什么东西挂了」分不开。
grep -v '^#' "$EXPECTED" > "$EXP" || true
[ -s "$EXP" ] || { echo "期望读数里一条都没有（${EXPECTED} 全是注释？）" >&2; exit 1; }
grep -v '^#' "$EXPECTED_D" > "$EXP_D" || true
[ -s "$EXP_D" ] || { echo "D 组的预测里一条都没有（${EXPECTED_D} 全是注释？）" >&2; exit 1; }

# 读数器的自检放在**借鼠标之前**：它坏了的话，跑完三轮才发现就白借了一分多钟鼠标。
# ⚠️ 别写成 `python3 … | sed … || {…}`：`||` 读的是 **sed** 的退出码，自检红了也进不了那个分支
#    （dispatch.md 的 1 号坑）。先落盘、再判、再打印。
echo "[0/4] reckon.py 自检（不碰鼠标、不要权限）…"
selftest_rc=0
python3 tools/mouse-dispatch/reckon.py --selftest > "$outdir/reckon-selftest.log" 2>&1 || selftest_rc=$?
sed 's/^/  /' "$outdir/reckon-selftest.log"
[ "$selftest_rc" = 0 ] || { echo "reckon.py 自检不过 —— 分段读数不算数，先修它。" >&2; exit 1; }


echo "[1/4] 编译原版 + 探针（tools/build.sh）…"
tools/build.sh >/dev/null

echo "[2/4] 编译驱动器（swiftc）…"
command -v swiftc >/dev/null || { echo "找不到 swiftc：这套东西只在 macOS 上跑" >&2; exit 1; }
DRIVE="$outdir/drive"
swiftc -O -o "$DRIVE" tools/mouse-dispatch/drive.swift

echo "[3/4] 读权限…"
perm="$("$DRIVE" --preflight)"
echo "  $perm"
ok_post=0; ok_ax=0
case "$perm" in *"CGPreflightPostEventAccess=true"*) ok_post=1 ;; esac
case "$perm" in *"AXIsProcessTrusted=true"*) ok_ax=1 ;; esac

if [ "$dry" = 1 ]; then
  echo "[4/4] --dry-run：两侧都编译过了，一个事件都没发。"
  if [ "$ok_post" = 1 ] && [ "$ok_ax" = 1 ]; then
    echo "  权限够，真跑会量得到东西。"
  else
    echo "  ⚠️ 权限不够：真跑会一行事件都收不到，而那与「原版真的收不到」长得一样。"
    echo "     去「系统设置 → 隐私与安全性 → 辅助功能」把跑它的这个终端加进去。"
  fi
  echo "  产物：$DRIVE"
  exit 0
fi

if [ "$ok_post" != 1 ] || [ "$ok_ax" != 1 ]; then
  echo "权限不够（见上面那一行）。不往下跑 —— 跑了只会得到一份零事件的日志，" >&2
  echo "而它与「原版真的收不到」长得一模一样。先去系统设置里授权。" >&2
  exit 1
fi

if [ "$yes" != 1 ]; then
  echo
  # 「约 22 秒」是**按驱动器里的 sleep 算出来的**（合成事件 16.2 秒 + JVM 起窗口那几秒），不是实测 ——
  # 加 D 组之前那句写的是 15 秒，同样是估算。真跑过之后按实测改这个数。
  echo "⚠️ 接下来这 ${rounds} 轮会**接管物理鼠标**：光标自己动、真的按下去，每轮约 22 秒（估算，含 D 组）。"
  echo "   期间别动鼠标键盘。确认请输入 yes："
  read -r ans < /dev/tty
  [ "$ans" = "yes" ] || { echo "取消。"; exit 1; }
fi

CP="tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar"

# 归一化：只留按下 / 松手两种，去掉时间戳与屏幕坐标。
# 去掉 scr= 的理由：它取决于窗口落在屏幕哪里（xl-zs6 那次 GEOMETRY 0,53 1024x640 →
# scr=600,353），换一块屏幕就变；xy= 是组件内坐标，与落点无关，所以留着对账。
normalize() {  # normalize <原始日志>
  sed -n -E 's/^[0-9]+ (PRESSED|RELEASED) (.*) scr=[0-9-]+,[0-9-]+$/\1 \2/p' "$1"
}

echo "[4/4] 跑 ${rounds} 轮…"
for r in $(seq 1 "$rounds"); do
  log="$outdir/events${r}.log"; geo="$outdir/geometry${r}.txt"
  rm -f "$log" "$geo"
  "$JAVA_HOME/bin/java" -Djava.awt.headless=false \
    -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 \
    -cp "$CP" devtools.MouseDispatchProbe "$log" "$geo" \
    > "$outdir/game${r}.log" 2>&1 &
  game=$!

  # 等探针把几何写出来。⚠️ 判「起来了没有」看**有没有产出那个文件**，不看进程在不在：
  # 原版启动失败时进程也会在（Swing 的 EDT 不退），两种情况分不开。
  waited=0
  while [ ! -s "$geo" ]; do
    sleep 1; waited=$((waited + 1))
    if [ "$waited" -ge 30 ]; then
      kill "$game" 2>/dev/null || true
      echo "第 ${r} 轮：30 秒没等到几何文件，原版多半没起来。看 $outdir/game${r}.log" >&2
      exit 1
    fi
  done

  "$DRIVE" "$geo" > "$outdir/drive${r}.log" 2>&1 || {
    kill "$game" 2>/dev/null || true
    echo "第 ${r} 轮：驱动器退出码非零，看 $outdir/drive${r}.log" >&2
    exit 1
  }
  kill "$game" 2>/dev/null || true
  wait "$game" 2>/dev/null || true

  normalize "$log" > "$outdir/normal${r}.txt"
  # ⚠️ 归一化那条 sed 匹配不到任何东西时也是「零行 + 退出码 0」，与「一行事件都没收到」
  # 产出同一个空文件。两者的成因完全不同（日志格式漂了 vs 合成事件被丢了），分开报。
  if [ ! -s "$outdir/normal${r}.txt" ] && [ -s "$log" ]; then
    echo "  ⚠️ 第 ${r} 轮：原始日志有 $(wc -l < "$log" | tr -d ' ') 行，归一化后一条都不剩 ——" >&2
    echo "     多半是探针的输出格式变了（normalize 那条 sed 对不上），不是没收到事件。" >&2
  fi
  echo "  第 ${r} 轮：$(wc -l < "$outdir/normal${r}.txt" | tr -d ' ') 行按下/松手 · $(head -c 200 "$geo" | tr -d '\n') · $log"
done

fail=0

# A 对照：头两行必须是左键那一对、且派给了 start.StartPanel。
# 这条单列出来，是因为「一行都没有」有两个成因（权限没给 / 原版真收不到），
# 直接丢给 diff 的话两者读起来一样。
a_head="$(head -2 "$outdir/normal1.txt")"
expected_a="$(head -2 "$EXP")"
if [ "$a_head" != "$expected_a" ]; then
  echo >&2
  echo "❌ A 对照不成立：窗口内空白处那一下左键单击没有按期望被 start.StartPanel 收到。" >&2
  echo "   收到的头两行是：" >&2
  printf '%s\n' "${a_head:-（一行都没有）}" | sed 's/^/     /' >&2
  echo "   一行都没有 = 合成事件被丢了（权限 / 窗口没在最前 / 别的 app 抢了焦点），" >&2
  echo "   **不是**「原版收不到」。整轮读数作废。" >&2
  fail=1
fi

# 轮与轮之间：确定性。
# ⚠️ 这里不用 $(seq 2 "$rounds")：macOS 的 seq 在 first > last 时**倒着数**（`seq 2 1`
# 打 "2 1"，退出码 0），于是 --rounds 1 会拿第 1 轮去跟一份根本不存在的第 2 轮比，
# 凭空多出一条 ❌。xl-sij 那趟三次 --rounds 1 的篡改跑里都带着这条假红（读数在 xl-sij 的 bd 评论里）。
r=2
while [ "$r" -le "$rounds" ]; do
  if ! diff -u "$outdir/normal1.txt" "$outdir/normal${r}.txt" > "$outdir/diff1-${r}.txt"; then
    echo >&2
    echo "❌ 第 1 轮与第 ${r} 轮不一致，差异在 $outdir/diff1-${r}.txt：" >&2
    sed 's/^/     /' "$outdir/diff1-${r}.txt" >&2
    fail=1
  fi
  r=$((r + 1))
done

# 与期望读数对账。A / B / B2 / C 四组是实测读数（对不上 = 回归），D 组那几行还是预测
# （对不上 = 预测被推翻，那正是 xl-8eg 要的读数）。所以按行数切成两段，分开报、分开的退出码。
# ⚠️ 前一段要是少了行，切点跟着挪，两段会同时红 —— 两边都响得出来，而头一条会指名是哪几行。
n_exp="$(wc -l < "$EXP" | tr -d ' ')"
head -n "$n_exp" "$outdir/normal1.txt" > "$outdir/normal1-abc.txt"
tail -n "+$((n_exp + 1))" "$outdir/normal1.txt" > "$outdir/normal1-d.txt"
if diff -u "$EXP" "$outdir/normal1-abc.txt" > "$outdir/diff-expected.txt"; then
  echo
  if [ "$rounds" -ge 2 ]; then
    echo "✅ 与期望读数逐行一致（$(wc -l < "$EXP" | tr -d ' ') 行），${rounds} 轮之间也逐行一致。"
  else
    echo "✅ 与期望读数逐行一致（$(wc -l < "$EXP" | tr -d ' ') 行）。只跑了 1 轮，确定性那半没核。"
  fi
  echo "   日志留在 $outdir"
else
  echo >&2
  echo "❌ 与 ${EXPECTED} 对不上：" >&2
  sed 's/^/     /' "$outdir/diff-expected.txt" >&2
  echo "   对不上不一定是谁错了 —— 换了 JDK、换了 macOS 版本、窗口落点变了都可能。" >&2
  echo "   先看是哪几行，再决定是改期望还是改结论；改期望要连 xl-zs6 的读数一起重记。" >&2
  fail=1
fi

# ── 按 MARK 分段的读数（xl-8eg）。放在这里而不是掺进上面那份对账，是因为两者问的不是同一件事：
#    对账问「按下 / 松手逐行对不对得上那份读数」，这里问「每一段出现过哪几种事件、派给了谁」，
#    而 D 组要量的 DRAGGED 只在后者里。理由、格式与自检都在 tools/mouse-dispatch/reckon.py。
r=1
while [ "$r" -le "$rounds" ]; do
  # ⚠️ 退出码 3 = 「结构上读不出」（格式漂了 / 一个 MARK 都没有），与「读数是空的」不是一回事，
  #    所以这里既不能 `|| true` 吞掉，也不能让 set -e 当场退出（后面几轮就不跑了）。
  rc=0
  python3 tools/mouse-dispatch/reckon.py "$outdir/drive${r}.log" "$outdir/events${r}.log" \
    > "$outdir/reckon${r}.txt" 2> "$outdir/reckon${r}.err" || rc=$?
  if [ "$rc" != 0 ]; then
    echo >&2
    echo "❌ 第 ${r} 轮的分段读数读不出来（退出码 ${rc}）：" >&2
    sed 's/^/     /' "$outdir/reckon${r}.err" >&2
    fail=1
  fi
  if [ "$r" != 1 ] && ! diff -u "$outdir/reckon1.txt" "$outdir/reckon${r}.txt" > "$outdir/reckon-diff1-${r}.txt"; then
    echo >&2
    echo "❌ 分段读数第 1 轮与第 ${r} 轮不一致，差异在 $outdir/reckon-diff1-${r}.txt：" >&2
    sed 's/^/     /' "$outdir/reckon-diff1-${r}.txt" >&2
    fail=1
  fi
  r=$((r + 1))
done

# D 组有**两个正对照**，各管一件事，缺哪个 D3 那个「没有」都不止一种读法：
#   D1 起 grab 那只键按着拖出窗口 —— 证**左键**的拖动进得了 Java（xl-40m / xl-bg3 已量过）；
#   D5 面板里按右、拖一段、松右   —— 证**右键**的拖动进得了 Java（这套 AWT + CGEvent 组合下
#      右键的拖动从来没量过；B / B2 量到的是右键**按下**）。
# 与 A 对照同一个道理：「没收到」有好几个成因，长得一样。
for ctl in D1 D5; do
  if ! grep -q "^${ctl} .*DRAGGED.*src=start\.StartPanel" "$outdir/reckon1.txt"; then
    echo >&2
    echo "❌ D 组正对照不成立：${ctl} 段里没有 src=start.StartPanel 的 DRAGGED。" >&2
    echo "   D3 段的读数整个作废 —— 那个「没有」分不出是原版收不到还是事件压根没进来。" >&2
    fail=1
  fi
done

echo
echo "D 组分段读数（xl-8eg；D3 那几行**没有期望值**，两种结果都说得通，这一趟就是去取它的）："
sed -n '/^D[0-9] /p' "$outdir/reckon1.txt" | sed 's/^/   /'
echo "   全部分段读数：$outdir/reckon1.txt"

# D 组按下 / 松手那一层的**预测**单独对账。对不上不是回归，是预测被读数推翻 —— 退出码 4，
# 与回归的 1 分开，好让「脚本红了」只有一种含义。
pred=0
if diff -u "$EXP_D" "$outdir/normal1-d.txt" > "$outdir/diff-expected-D.txt"; then
  echo "   D 组按下 / 松手与预测逐行一致（$(wc -l < "$EXP_D" | tr -d ' ') 行）—— 预测这次撞对了，它现在是读数。"
else
  echo >&2
  echo "⚠️ D 组按下 / 松手与 ${EXPECTED_D} 的**预测**对不上：" >&2
  sed 's/^/     /' "$outdir/diff-expected-D.txt" >&2
  echo "   这不是回归 —— 那几行本来就是推的（四下里三下）。**这就是 xl-8eg 要的读数**：" >&2
  echo "   按实测改写 ${EXPECTED_D}，并把 D3 段的 DRAGGED 读数写回 App.tsx / StartPanel.tsx /" >&2
  echo "   docs/web-primitives.md。⚠️ 探针只驱动标题页，读数直接管的是 StartPanel.tsx 那一支。" >&2
  pred=4
fi

[ "$fail" = 0 ] || exit 1
exit "$pred"
