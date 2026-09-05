#!/usr/bin/env bash
# 把取景器产出的 PNG 参考图批量转成 WebP q80。
# 用法: tools/to-webp.sh <PNG根目录> <输出根目录>
set -euo pipefail
src=${1:?需要 PNG 根目录}; dst=${2:?需要输出根目录}
command -v cwebp >/dev/null || { echo "需要 cwebp (brew install webp)"; exit 1; }
n=0
while IFS= read -r f; do
  rel=${f#"$src"/}; out="$dst/${rel%.png}.webp"
  mkdir -p "$(dirname "$out")"
  cwebp -quiet -q 80 "$f" -o "$out"
  n=$((n+1)); [ $((n % 500)) -eq 0 ] && echo "  已转 $n 张"
done < <(find "$src" -name '*.png' | sort)
echo "完成 $n 张 -> $dst"
