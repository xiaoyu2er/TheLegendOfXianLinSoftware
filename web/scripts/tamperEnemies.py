#!/usr/bin/env python3
"""怪物出厂表的逐列篡改验证 —— 一次性的判据有效性证明，不进 CI。

对 `web/src/battle/units.ts` 里 `ENEMIES` 的**每一行每一列**各做一次篡改
（数值 +1、字符串加后缀、`zhangSpeed + 6` 改成 `+ 7`），每次跑一遍
`vitest run src/battle/units.test.ts`，最后报数。2026-09-07 实测：
7 行 × 24 列 = 168 次，168 红 0 绿。

从仓库根目录跑：`python3 web/scripts/tamperEnemies.py`（约 6 分钟）。
跑完会把 units.ts 还原；中途 Ctrl-C 会留下一个被篡改的文件，用
`git checkout -- web/src/battle/units.ts` 还原。

两个"失败长得像成功"的坑，写在这里免得下一个人再踩：

1. 切段落的正则原先是 `\\n  (\\S+): \\{\\n(.*?)\\n  \\},\\n`，结尾那个 `\\n` 被
   吃掉了，于是紧跟在上一行 `},` 后面的怪物一律匹配不到 —— 分母从 7 悄悄变成
   3，而输出（一串整齐的 RED）看起来完全正常。改成 `$` + re.M，并加了一条
   对撞：解出的段落数必须等于块里顶层 `名字: {` 的行数。
2. 篡改按**绝对偏移**写，不按 `str.replace`：`length: 4,` 这种行在多只怪物身上
   逐字相同，replace 会一次改掉好几处（或改错那一处）。
"""
import io, re, subprocess, os
# 仓库根目录 = 这个文件的上上级（web/scripts/ → web/ → 根）。
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
P=os.path.join(ROOT,'web/src/battle/units.ts')
orig=io.open(P,encoding='utf-8').read()

start=orig.index('export const ENEMIES')
end=orig.index('\n}\n',start)+3
block=orig[start:end]

# 逐行分出每一只怪物的段落
# 用 lookahead 收尾，不吃掉那个换行 —— 吃掉了的话，紧跟在上一行 `},` 后面
# 的下一只怪物就匹配不到（只有前面隔着注释的那几只能匹配），于是分母从 7 悄悄
# 变成 3，而输出看起来完全正常。
rows={}
for m in re.finditer(r'^  (\S+): \{\n(.*?)\n  \},$', block, re.S|re.M):
    rows[m.group(1)]=(m.start(2)+start, m.group(2))
# 对撞：段落数必须等于块里顶层 `名字: {` 的行数。
declared=len(re.findall(r'^  \S+: \{$', block, re.M))
assert rows and len(rows)==declared, f'解出 {len(rows)} 段，块里却有 {declared} 行'

targets=[]  # (row, col, old_line, new_line)
for name,(off,body) in rows.items():
    # 顶层标量列
    for lm in re.finditer(r'^    (\w+): (.+),$', body, re.M):
        targets.append((name, lm.group(1), off+lm.start(), lm.group(0)))
    # skill 子对象
    sm=re.search(r'^    skill: \{\n(.*?)\n    \},$', body, re.M|re.S)
    assert sm, f'{name} 没有 skill 块'
    for lm in re.finditer(r'^      (\w+): (.+),$', sm.group(1), re.M):
        targets.append((name, 'skill.'+lm.group(1), off+sm.start(1)+lm.start(), lm.group(0)))

def mutate(line):
    key,val=line.split(':',1)
    v=val.strip().rstrip(',')
    if re.fullmatch(r'-?\d+', v):
        nv=str(int(v)+1)
    elif v.startswith("'"):
        nv=v[:-1]+"篡改'"
    elif 'zhangSpeed' in v:
        nv=v.replace('+ 6','+ 7')
        assert nv!=v
    else:
        raise SystemExit('不认得的值：'+v)
    return key+': '+nv+','

red=green=0
fails=[]
for name,col,at,line in targets:
    assert orig[at:at+len(line)]==line, f'篡改点对不上 {name}.{col}'
    new=mutate(line)
    s=orig[:at]+new+orig[at+len(line):]
    assert s!=orig, f'篡改没写进去 {name}.{col}'
    io.open(P,'w',encoding='utf-8').write(s)
    r=subprocess.run(['pnpm','exec','vitest','run','src/battle/units.test.ts'],
                     cwd=os.path.join(ROOT,'web'),capture_output=True)
    io.open(P,'w',encoding='utf-8').write(orig)
    if r.returncode!=0: red+=1
    else:
        green+=1; fails.append(f'{name}.{col}')
    print(('RED  ' if r.returncode!=0 else 'GREEN')+f' {name}.{col}  ({line.strip()} -> {new.strip()})',flush=True)

print(f'\n分母 = {len(rows)} 行 × 各自的列 = {len(targets)} 次篡改')
print(f'红 {red} / 绿 {green}')
if fails: print('没红的：', fails)
