#!/usr/bin/env bash
# 把 bd 库里每张票的「票号 → open / closed」导成一份入库的快照：
# tools/issue-snapshot/issues.json。
#
#   tools/export-issues.sh            # 从活库重导，覆盖快照
#   tools/export-issues.sh --check    # 重导到临时文件，与入库的快照逐字节比；不同就退出 1
#
# 它是 docs/player-coverage.md（「玩家走得通哪一段」对照表）引用完整性判据的真值源：
# web/src/mainline/test/playerCoverage.test.ts 拿表里引用的票号对着这份快照撞。
# 快照本身用「重导后差异为空」守 —— 与 export-truth.sh 同一道缝：重跑之后
# `git diff tools/issue-snapshot` 必须为空（或者直接跑 --check）。
#
# ⚠️ 为什么不直接读 .beads/issues.jsonl：那是 bd 的**被动导出**，实测是过期的
# （读数见 docs/player-coverage.md「快照不是」那一条）。拿它当真值，
# 判据会静默地对着一份旧名单点头。这里只认活库。
#
# ⚠️ 这份快照只能在有 bd 库的机器上重导（库是 gitignore 掉的嵌入式 Dolt），CI 上
# 跑不了 —— CI 只跑 web 那条判据（表 vs 入库快照），「快照是不是活库现在的样子」
# 是本地的检查，与 export-trace.sh --check 同一个待遇。
#
# 状态只分两桶：closed 与 open（open / in_progress / blocked / deferred 都算 open）。
# 理由：认领一张票就会把它改成 in_progress，按原值导的话每次派工都让快照变脏，
# 而对照表关心的只是「欠账归的那张票还开着没有」。不认识的状态响亮失败，不猜。
set -euo pipefail
cd "$(dirname "$0")/.."

check=0
for a in "$@"; do
  case "$a" in
    --check) check=1 ;;
    *) echo "不认识的参数：${a}，只接受 --check" >&2; exit 2 ;;
  esac
done

command -v bd >/dev/null || { echo "找不到 bd，无法重导票据快照" >&2; exit 2; }

OUT=tools/issue-snapshot/issues.json
# 第二份：每张 open 票身上的身份标签（xl-03x.19）。与上一份**同一次**导出，所以两者说的是同一刻的库。
# 判据在 web/src/mainline/test/issueIdentity.test.ts（每张 open 票恰好一个）；这里**照实写**，
# 零个、两个都照写 —— 替人补一个就等于让导出器自己签字。
IDENT=tools/issue-snapshot/identity.json
raw="$(mktemp "${TMPDIR:-/tmp}/xl-issues-raw.XXXXXX")"
tmp="$(mktemp "${TMPDIR:-/tmp}/xl-issues.XXXXXX")"
tmpi="$(mktemp "${TMPDIR:-/tmp}/xl-identity.XXXXXX")"
trap 'rm -f "$raw" "$tmp" "$tmpi"' EXIT

# --limit 0：bd list 默认只给 50 条，不带它快照会**静默**截断成 50 行。
bd list --all --json --limit 0 > "$raw"

python3 - "$raw" "$tmp" "$tmpi" <<'EOF'
import json, re, sys
src, dst, dsti = sys.argv[1], sys.argv[2], sys.argv[3]
rows = json.load(open(src, encoding='utf-8'))
# bd 在空库上答 0 条而不报错 —— 空快照会让判据对任何票号都说「不存在」，
# 看起来像表全错了；更糟的是反过来没人引用时它恒绿。这里当场拒绝。
if not rows:
    sys.exit('bd 返回 0 张票：库是空的或没解析到库（先跑 bd where），拒绝写空快照')
OPEN = {'open', 'in_progress', 'blocked', 'deferred'}
out = {}
for r in rows:
    i, s = r['id'], r['status']
    if not re.fullmatch(r'xl-[0-9a-z]+(\.[0-9]+)*', i):
        sys.exit(f'票号 {i!r} 不是 xl- 前缀的形状，拒绝写快照')
    if i in out:
        sys.exit(f'票号 {i} 出现了两次')
    if s == 'closed':
        out[i] = 'closed'
    elif s in OPEN:
        out[i] = 'open'
    else:
        sys.exit(f'{i} 的状态 {s!r} 不认识 —— 在这里加一桶之前先想清楚它算不算「欠账还开着」')
def key(i):  # xl-03x.10 排在 xl-03x.9 后面
    base, *nums = i.split('.')
    return (base, [int(n) for n in nums])
with open(dst, 'w', encoding='utf-8') as f:
    f.write('{\n')
    f.write(',\n'.join(f'  {json.dumps(i)}: {json.dumps(out[i])}' for i in sorted(out, key=key)))
    f.write('\n}\n')
print(f'  {len(out)} 张票（closed {sum(v == "closed" for v in out.values())} / open {sum(v == "open" for v in out.values())}）', file=sys.stderr)
# 只给 open 票记身份；closed 票身上留着的身份标签不算数（关掉的票不欠什么）。
ident = {r['id']: sorted(l for l in (r.get('labels') or []) if l.startswith('身份:'))
         for r in rows if out[r['id']] == 'open'}
with open(dsti, 'w', encoding='utf-8') as f:
    f.write('{\n')
    f.write(',\n'.join(f'  {json.dumps(i)}: {json.dumps(ident[i], ensure_ascii=False)}' for i in sorted(ident, key=key)))
    f.write('\n}\n')
EOF

if [ "$check" = 1 ]; then
  stale=0
  for pair in "$OUT:$tmp" "$IDENT:$tmpi"; do
    committed="${pair%%:*}" fresh="${pair#*:}"
    if cmp -s "$committed" "$fresh"; then
      echo "  $committed 与活库一致"
    else
      echo "  快照过期：重导结果与入库的 $committed 不同" >&2
      diff "$committed" "$fresh" >&2 || true
      stale=1
    fi
  done
  exit "$stale"
else
  mkdir -p "$(dirname "$OUT")"
  cp "$tmp" "$OUT"
  cp "$tmpi" "$IDENT"
  echo "  已写 $OUT 与 $IDENT"
fi
