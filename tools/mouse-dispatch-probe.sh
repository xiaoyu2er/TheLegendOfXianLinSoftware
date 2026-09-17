#!/usr/bin/env bash
# 原版鼠标事件派发探针：量「舞台外按着键拖进来」那一族的几下鼠标，原版到底收没收到、派给了谁。
# （xl-zs6 现搭的一次性探针，xl-sij 收成可复跑的工具。）
#
#   tools/mouse-dispatch-probe.sh --dry-run    # 只编译两侧 + 读权限，一个事件都不发、不碰鼠标
#   tools/mouse-dispatch-probe.sh              # 真跑：起原版、合成四组序列、与期望读数对账
#   tools/mouse-dispatch-probe.sh --yes        # 同上，跳过「要接管鼠标」那句确认
#   tools/mouse-dispatch-probe.sh --rounds 1   # 少跑几轮（默认 3 轮，判确定性）
#   tools/mouse-dispatch-probe.sh --out <目录> # 日志落在哪（默认临时目录，跑完留着路径）
#   tools/mouse-dispatch-probe.sh --where desktop          # 换「窗口外」那一下的落点
#   tools/mouse-dispatch-probe.sh --where same-app-window  # 同上；三个落点各有一份期望读数
#   tools/mouse-dispatch-probe.sh --replay <目录>  # 拿存过的日志重跑对账，**一下鼠标都不碰**
#   tools/mouse-dispatch-probe.sh --check-point --where desktop
#                                              # 起原版拿几何、把「窗口外」那一下的落点算出来就退出。
#                                              # 一个事件都不发、**一下鼠标都不碰**。desktop 那一支
#                                              # 要先有一块露出来的桌面，用它可以在借鼠标之前先问清楚。
#
# 三个落点（xl-g9w 加进来；认不出来的名字是硬失败，不猜 —— 默认掉的话，
# 「量的其实是另一种落点」与真读数长得一模一样）：
#
#   outside-window   （默认）驱动器自己开的那块空白窗口 —— 另一个 app 的普通窗口。xl-zs6 量的就是它。
#   desktop          露出来的桌面（落点由驱动器现扫，扫不到就硬失败让人挪窗口）。
#   same-app-window  原版那个 JVM 自己多开的另一块 JFrame —— 三支里唯一可能与另两支结论不同的。
#
# ⚠️ 原生全屏 app 那一种**量不了，而且不是「难」是「不存在」**：macOS 的原生全屏把那个 app
#    放进自己的 Space，原版窗口同时不在屏幕上，「在外面按下、拖进原版窗口」构造上发生不了；
#    而「铺满屏幕但仍在同一个 Space 的普通窗口」等价于 outside-window 那一支。
#    ⚠️ 这一段是**推理，没量过**。
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
set -euo pipefail
OLDPWD_AT_START="$PWD"
cd "$(dirname "$0")/.."
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"

dry=0; yes=0; rounds=3; rounds_given=0; outdir=""; where=outside-window; replay=""; checkpoint=0
KNOWN_WHERE="outside-window desktop same-app-window"
# ⚠️ 带值的参数要自己检查值在不在：写成 `shift; rounds="${1:-}"` 再靠末尾那个 shift，
# 值缺失时 set -e 会在那个 shift 上先退出，下面那句「要一个正整数」**永远打不出来** ——
# 静默 exit 1 与「参数校验响了」长得不一样，但与「别的什么东西挂了」长得一样。
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1; shift ;;
    --yes) yes=1; shift ;;
    --rounds) [ $# -ge 2 ] || { echo "--rounds 后面要跟一个正整数" >&2; exit 2; }; rounds="$2"; rounds_given=1; shift 2 ;;
    --out) [ $# -ge 2 ] || { echo "--out 后面要跟一个目录" >&2; exit 2; }; outdir="$2"; shift 2 ;;
    --where) [ $# -ge 2 ] || { echo "--where 后面要跟一个落点名：${KNOWN_WHERE}" >&2; exit 2; }; where="$2"; shift 2 ;;
    --replay) [ $# -ge 2 ] || { echo "--replay 后面要跟一个跑过的输出目录" >&2; exit 2; }; replay="$2"; shift 2 ;;
    --check-point) checkpoint=1; shift ;;
    *) echo "不认识的参数：${1}，只接受 --dry-run / --yes / --rounds N / --out 目录 / --where 落点 / --replay 目录 / --check-point" >&2; exit 2 ;;
  esac
done
case "$rounds" in ''|*[!0-9]*) echo "--rounds 要一个正整数，收到：${rounds}" >&2; exit 2 ;; esac
[ "$rounds" -ge 1 ] || { echo "--rounds 至少是 1" >&2; exit 2; }

# 认不出来的落点是硬失败，不退回默认。
case " ${KNOWN_WHERE} " in
  *" ${where} "*) ;;
  *) echo "不认识的落点 --where ${where}，只接受：${KNOWN_WHERE}" >&2; exit 2 ;;
esac

# 每个落点一份期望读数：默认那一支沿用原来的文件名（xl-zs6 的读数，不动），另两支各一份。
if [ "$where" = outside-window ]; then
  EXPECTED=tools/mouse-dispatch/expected-events.txt
else
  EXPECTED="tools/mouse-dispatch/expected-events-${where}.txt"
fi
# --check-point 不对账，所以它不要求期望读数存在（一个落点可以「算得出落点、还没量过」）。
if [ "$checkpoint" = 0 ] && [ ! -f "$EXPECTED" ]; then
  echo "找不到期望读数：${EXPECTED}" >&2
  echo "落点 ${where} 还没有一份量过的读数 —— 先用 --check-point 确认落点算得出来，再借鼠标真跑一趟，" >&2
  echo "把跑出来的 normal1.txt 当成读数写进这个文件（要三轮逐字一致才算数）。" >&2
  exit 1
fi

# ⚠️ 上面已经 cd 到仓库根了，所以 --out 给的相对路径要按**调用者的 cwd**解回来，
# 否则 `--out out/` 会静悄悄落在仓库根下面，而不是你以为的那个目录。
# --replay：拿一趟跑过的日志重跑对账。判据逻辑与真跑那条路**是同一段代码**，
# 所以它验的就是真跑要用的那一段；它一下鼠标都不碰，也不起 JVM。
if [ -n "$replay" ]; then
  [ "$dry" = 0 ] || { echo "--replay 与 --dry-run 不能一起给" >&2; exit 2; }
  [ "$checkpoint" = 0 ] || { echo "--replay 与 --check-point 不能一起给" >&2; exit 2; }
  # 重放的轮数由磁盘上有几份 events*.log 定，给 --rounds 只会被悄悄吞掉 —— 那是「参数没生效」
  # 与「参数生效了」同形，所以直接报错。
  [ "$rounds_given" = 0 ] || { echo "--replay 的轮数按目录里的 events*.log 现数，不要再给 --rounds" >&2; exit 2; }
  case "$replay" in /*) ;; *) replay="$OLDPWD_AT_START/$replay" ;; esac
  [ -d "$replay" ] || { echo "重放目录不存在：${replay}" >&2; exit 2; }
  if [ -n "$outdir" ]; then
    case "$outdir" in /*) abs_out="$outdir" ;; *) abs_out="$OLDPWD_AT_START/$outdir" ;; esac
    # 往重放目录自己里写 = 把被重放的那份东西跑脏；入库的 fixture 尤其不行。
    [ "$(cd "$replay" && pwd)" != "$(mkdir -p "$abs_out" && cd "$abs_out" && pwd)" ] || {
      echo "--out 不能就是 --replay 那个目录（那样会把被重放的日志跑脏）" >&2; exit 2; }
  fi
  # ⚠️ **读的目录与写的目录分开**：重放会往 outdir 里写 normal*.txt 与几个 diff，
  #    而重放的对象可能是**入库的那份 fixture** —— 就地写会把仓库弄脏，
  #    而「工作区脏了」和「跑完了」在收尾时长得很像。
  # 轮数**现数**，不信参数（dispatch.md 纪律 3：别把「目前只有 N 轮」写死）。
  # ⚠️ 这里用 find 不用 `ls ...events*.log`：本脚本开头是 `set -euo pipefail`，而 `ls` 匹配不到
  #    任何文件时退出 1 —— pipefail 把整条管道变成非零，set -e 当场把脚本杀掉，
  #    下面那句「一份都没有」**永远打不出来**。表现是一个没有任何输出的 exit 1，
  #    与「别的什么东西挂了」分不开（xl-g9w 现踩，改成 find 之后那句话才打得出来）。
  #    find 找不到东西时退出码是 0。
  rounds=$(find "$replay" -maxdepth 1 -name 'events*.log' | wc -l | tr -d ' ')
  [ "$rounds" -ge 1 ] || { echo "重放目录里一份 events*.log 都没有：${replay}" >&2; exit 2; }
fi

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
if [ "$checkpoint" = 0 ]; then
# `|| true`：一条都没滤出来时 grep 退出 1，set -e 会当场退出，下面那句守卫就**永远打不出来** ——
# 那是一个没有任何输出的 exit 1，与「别的什么东西挂了」分不开。
grep -v '^#' "$EXPECTED" > "$EXP" || true
[ -s "$EXP" ] || { echo "期望读数里一条都没有（${EXPECTED} 全是注释？）" >&2; exit 1; }
fi


# 归一化：只留按下 / 松手两种，去掉时间戳与屏幕坐标。
# 去掉 scr= 的理由：它取决于窗口落在屏幕哪里（xl-zs6 那次 GEOMETRY 0,53 1024x640 →
# scr=600,353），换一块屏幕就变；xy= 是组件内坐标，与落点无关，所以留着对账。
normalize() {  # normalize <原始日志>
  sed -n -E 's/^[0-9]+ (PRESSED|RELEASED) (.*) scr=[0-9-]+,[0-9-]+$/\1 \2/p' "$1"
}

if [ -n "$replay" ]; then
  echo "[重放] ${replay}：${rounds} 轮存过的日志，落点 ${where}。一下鼠标都不碰。产物写在 ${outdir}。"
  r=1
  while [ "$r" -le "$rounds" ]; do
    [ -s "$replay/events${r}.log" ] || { echo "重放：缺 $replay/events${r}.log" >&2; exit 2; }
    normalize "$replay/events${r}.log" > "$outdir/normal${r}.txt"
    echo "  第 ${r} 轮：$(wc -l < "$outdir/normal${r}.txt" | tr -d ' ') 行按下/松手"
    r=$((r + 1))
  done
else

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

# --check-point：起一轮原版拿几何、让驱动器把落点算出来就停。一个事件都不发。
if [ "$checkpoint" = 1 ]; then
  rounds=1
  echo "[4/4] --check-point：只算落点，一个事件都不发、一下鼠标都不碰。"
elif [ "$yes" != 1 ]; then
  echo
  echo "⚠️ 接下来这 ${rounds} 轮会**接管物理鼠标**：光标自己动、真的按下去，每轮约 15 秒。"
  echo "   期间别动鼠标键盘。确认请输入 yes："
  read -r ans < /dev/tty
  [ "$ans" = "yes" ] || { echo "取消。"; exit 1; }
fi

CP="tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar"

echo "[4/4] 跑 ${rounds} 轮（落点 ${where}）…"
for r in $(seq 1 "$rounds"); do
  log="$outdir/events${r}.log"; geo="$outdir/geometry${r}.txt"; samegeo="$outdir/samegeo${r}.txt"
  rm -f "$log" "$geo" "$samegeo"
  # same-app-window：让探针在同一个 JVM 里多开一块 JFrame 当「窗口外」，几何写进 $samegeo。
  # ⚠️ 参数用数组，别用裸变量 —— zsh 不拆词（dispatch.md 坑 10.5），这个脚本虽然是 bash，
  #    但同一族的写法不值得在两边各留一个形状。
  probe_args=("$log" "$geo")
  drive_args=("--where" "$where")
  [ "$checkpoint" = 1 ] && drive_args+=("--dry-point")
  waitfor=("$geo")
  if [ "$where" = same-app-window ]; then
    probe_args+=("$samegeo")
    drive_args+=("--outside-geometry" "$samegeo")
    waitfor+=("$samegeo")
  fi
  "$JAVA_HOME/bin/java" -Djava.awt.headless=false \
    -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 \
    -cp "$CP" devtools.MouseDispatchProbe "${probe_args[@]}" \
    > "$outdir/game${r}.log" 2>&1 &
  game=$!

  # 等探针把几何写出来。⚠️ 判「起来了没有」看**有没有产出那个文件**，不看进程在不在：
  # 原版启动失败时进程也会在（Swing 的 EDT 不退），两种情况分不开。
  waited=0
  while :; do
    missing=0
    for f in "${waitfor[@]}"; do [ -s "$f" ] || missing=1; done
    [ "$missing" = 0 ] && break
    sleep 1; waited=$((waited + 1))
    # ⚠️ 先判「探针进程还在不在」，再判超时：探针自己 System.exit 掉（比如同 app 那块窗口
    #    与面板叠上了）时，几何文件可能**已经写了一份**，只差后一份 —— 那时候干等 30 秒
    #    再报「原版多半没起来」，与真的没起来同形。两种成因要说成两句话。
    if ! kill -0 "$game" 2>/dev/null; then
      wait "$game" 2>/dev/null || true
      echo "第 ${r} 轮：探针进程已经退出，而 ${waitfor[*]} 还没齐 —— 它是自己失败退的，不是没起来。" >&2
      echo "   看 $outdir/game${r}.log 末尾那几行。" >&2
      exit 1
    fi
    if [ "$waited" -ge 30 ]; then
      kill "$game" 2>/dev/null || true
      echo "第 ${r} 轮：30 秒没等到几何文件（${waitfor[*]}），原版多半没起来。看 $outdir/game${r}.log" >&2
      exit 1
    fi
  done

  "$DRIVE" "$geo" "${drive_args[@]}" > "$outdir/drive${r}.log" 2>&1 || {
    kill "$game" 2>/dev/null || true
    echo "第 ${r} 轮：驱动器退出码非零，看 $outdir/drive${r}.log" >&2
    exit 1
  }
  kill "$game" 2>/dev/null || true
  wait "$game" 2>/dev/null || true

  normalize "$log" > "$outdir/normal${r}.txt"
  # ⚠️ 归一化那条 sed 匹配不到任何东西时也是「零行 + 退出码 0」，与「一行事件都没收到」
  # 产出同一个空文件。两者的成因完全不同（日志格式漂了 vs 合成事件被丢了），分开报。
  # ⚠️ --check-point 那条路本来就一个事件都不发，归一化当然是空的 —— 那里报这句话是假警。
  if [ "$checkpoint" = 0 ] && [ ! -s "$outdir/normal${r}.txt" ] && [ -s "$log" ]; then
    echo "  ⚠️ 第 ${r} 轮：原始日志有 $(wc -l < "$log" | tr -d ' ') 行，归一化后一条都不剩 ——" >&2
    echo "     多半是探针的输出格式变了（normalize 那条 sed 对不上），不是没收到事件。" >&2
  fi
  echo "  第 ${r} 轮：$(wc -l < "$outdir/normal${r}.txt" | tr -d ' ') 行按下/松手 · $(head -c 200 "$geo" | tr -d '\n') · $(grep '^WHERE ' "$outdir/drive${r}.log" || true) · $log"
done
fi   # 重放分支到此合流：下面的对账两条路共用，所以重放验的就是真跑要用的那一段。

if [ "$checkpoint" = 1 ]; then
  echo "  落点算得出来（见上面那行 WHERE）。真跑要 ${outdir} 之外的一段鼠标时间。"
  exit 0
fi

fail=0

# A 对照：头两行必须是左键那一对、且派给了 start.StartPanel。
# 这条单列出来，是因为「一行都没有」有两个成因（权限没给 / 原版真收不到），
# 直接丢给 diff 的话两者读起来一样。
# ⚠️ **每一轮都核**，不是只核第 1 轮（xl-g9w 实测：13 轮里有 2 轮被别的窗口抢了，
#    其中一轮整轮零事件。只核第 1 轮的话，那种轮次只会表现为「轮间不一致」——
#    而「这一轮根本没量到」与「这一轮量到的不一样」是两件事，成因也不同。）
expected_a="$(head -2 "$EXP")"
r=1
while [ "$r" -le "$rounds" ]; do
  a_head="$(head -2 "$outdir/normal${r}.txt")"
  if [ "$a_head" != "$expected_a" ]; then
    echo >&2
    echo "❌ 第 ${r} 轮 A 对照不成立：窗口内空白处那一下左键单击没有按期望被 start.StartPanel 收到。" >&2
    echo "   收到的头两行是：" >&2
    printf '%s\n' "${a_head:-（一行都没有）}" | sed 's/^/     /' >&2
    echo "   一行都没有 = 合成事件被丢了（权限 / 窗口没在最前 / 别的 app 抢了焦点），" >&2
    echo "   **不是**「原版收不到」。这一轮读数作废。" >&2
    fail=1
  fi
  r=$((r + 1))
done

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

# 与期望读数对账。
if diff -u "$EXP" "$outdir/normal1.txt" > "$outdir/diff-expected.txt"; then
  echo
  # ⚠️ 这句话只说第 1 轮与期望读数的关系。**「${rounds} 轮之间也一致」那半要看 $fail** ——
  #    原来这里无条件就把它打出来了，于是上面明明红着「第 1 轮与第 2 轮不一致」，
  #    这里还跟一句「3 轮之间也逐行一致」（xl-g9w 现踩；退出码是对的，只有话是假的）。
  if [ "$fail" != 0 ]; then
    echo "⚠️ 第 1 轮与期望读数逐行一致（$(wc -l < "$EXP" | tr -d ' ') 行），**但上面有红的** —— 整趟不算过。"
  elif [ "$rounds" -ge 2 ]; then
    echo "✅ 与期望读数逐行一致（$(wc -l < "$EXP" | tr -d ' ') 行），${rounds} 轮之间也逐行一致。"
  else
    echo "✅ 与期望读数逐行一致（$(wc -l < "$EXP" | tr -d ' ') 行）。只跑了 1 轮，确定性那半没核。"
  fi
  echo "   日志留在 $outdir"
else
  echo >&2
  echo "❌ 与 ${EXPECTED} 对不上：" >&2
  sed 's/^/     /' "$outdir/diff-expected.txt" >&2
  echo "   （落点是 ${where}，期望读数是 ${EXPECTED}）" >&2
  echo "   对不上不一定是谁错了 —— 换了 JDK、换了 macOS 版本、窗口落点变了都可能。" >&2
  echo "   先看是哪几行，再决定是改期望还是改结论；改期望要连 xl-zs6 的读数一起重记。" >&2
  fail=1
fi

# 换落点之后，**派给原版那块窗口的行**跟默认落点比是相同还是不同 —— 这一票（xl-g9w）问的就是这个。
# 不把「不同」做成硬失败：不同本身是个结论，不是故障；而「读数变了」那一半由上面各自的期望读数对账挡着。
# ⚠️ 滤掉的是探针自己那块「窗口外」的窗口收到的行，剩下的才是原版窗口收到的。
#    **那个类名不写死在这里，由探针自己报**（日志里的 SAMEAPPCLASS 一行）—— 写死的话，
#    探针那边一换窗口类，滤不掉的行就被当成「原版收到的」，而那份输出**看起来仍然正常**
#    （/code-review Spec 轴逮到的）。报不出来就硬失败，不退回一个猜出来的类名。
#
# ⚠️ **两条纪律，都是这一段头一版没做到、被 /code-review 逮回来的**（与上面那句结论话术一模一样的毛病）：
#   1. **这一趟有红的时候，这句话不是结论。** 头一版只看 normal1.txt 存不存在、不看 $fail，
#      于是紧跟在「⚠️ 整趟不算过」后面照样打「逐字相同 —— 换落点不改结论」。
#      而这句正是本票唯一的结论句，README 与那几处代码注释转抄的就是它。
#   2. **逐轮核，不是只核第 1 轮。** A 对照刚从「只核第 1 轮」改成逐轮，这里不能留在第 1 轮上 ——
#      第 2/3 轮要是与 outside-window 不同，只看第 1 轮读不出来。
if [ "$where" != outside-window ]; then
  grep -v '^#' tools/mouse-dispatch/expected-events.txt > "$outdir/baseline-expected.txt" || true
  echo
  if [ "$fail" != 0 ]; then
    echo "⚠️ 这一趟有红的（见上面），所以下面这条比对**不是结论** —— 先把红的弄清楚再看它。"
  fi
  differ=0
  skipped=0
  r=1
  while [ "$r" -le "$rounds" ]; do
    # 探针那块窗口的组件类名：现读，读不到就硬失败。
    # `|| true` + 空判：grep 没匹配到时退出 1，set -e 会当场把脚本杀掉，下面那句话就永远打不出来。
    outside_class=""
    if [ "$where" = same-app-window ]; then
      src_log="${replay:-$outdir}/events${r}.log"
      outside_class="$(grep -m1 '^SAMEAPPCLASS ' "$src_log" | cut -d' ' -f2 || true)"
      if [ -z "$outside_class" ]; then
        # 读不到就**跳过这一条，并且不给结论** —— 不猜一个类名顶上。
        # 「跳过」与「相同」长得不一样：跳过会打这句话，而 ⇒ 结论那一行根本不出现。
        echo "⚠️ 第 ${r} 轮：${src_log} 里没有 SAMEAPPCLASS 那一行，不知道该滤掉哪块窗口的行 ——" >&2
        echo "   这一条比对**没核**（不是「相同」）。多半是旧版本探针出的日志；重跑一趟就有了。" >&2
        skipped=1
        r=$((r + 1))
        continue
      fi
    fi
    if [ -n "$outside_class" ]; then
      grep -v "src=${outside_class} " "$outdir/normal${r}.txt" > "$outdir/original-window${r}.txt" || true
    else
      cp "$outdir/normal${r}.txt" "$outdir/original-window${r}.txt"
    fi
    if diff -u "$outdir/baseline-expected.txt" "$outdir/original-window${r}.txt" > "$outdir/diff-vs-outside-window-${r}.txt"; then
      echo "📐 第 ${r} 轮 · 落点 ${where}：派给原版窗口的 $(wc -l < "$outdir/original-window${r}.txt" | tr -d ' ') 行与 outside-window 的期望读数**逐字相同**。"
    else
      differ=1
      echo "📐 第 ${r} 轮 · 落点 ${where}：派给原版窗口的行与 outside-window 的期望读数**不同**，差异在 $outdir/diff-vs-outside-window-${r}.txt："
      sed 's/^/     /' "$outdir/diff-vs-outside-window-${r}.txt"
    fi
    r=$((r + 1))
  done
  if [ "$fail" = 0 ] && [ "$skipped" != 0 ]; then
    echo "⇒ 没有结论：有轮次的比对没核成（见上面的 ⚠️）。"
  elif [ "$fail" = 0 ]; then
    if [ "$differ" = 0 ]; then
      echo "⇒ 结论：${rounds} 轮都一样 —— **换落点不改结论**。"
    else
      echo "⇒ 结论：**换落点改了结论**（见上面那几轮的差异）。改注释与 README 的时候按这个写。"
    fi
  fi
fi

exit "$fail"
