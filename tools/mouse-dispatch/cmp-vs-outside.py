#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""换落点之后，**派给原版窗口的行**跟默认落点比：相同 / 只差落点坐标 / 真的不同。

为什么要有这一步（xl-23v）：desktop 那一支跟默认落点比**必然**差一行 —— D2「在外面按右、
再松左」松手那一行的 `xy` 就是**落点换算到面板内坐标**，落点不同它当然不同。而 probe.sh 原来
只会 diff 一下然后打「**换落点改了结论**」，那句话是这张票唯一的结论句，README 与那几处代码
注释转抄的就是它 —— 照抄就把「按构造必然不同的一个坐标」说成了「原版的派发不一样」。

⚠️ **摘掉不等于放过。** 只有当那一行**除了 xy 之外逐字相同**、并且它的 xy **确实等于现算出来的
落点**（由 drive 日志的 WHERE 与事件日志的 GEOMETRY 算，不是写死的）时，才算「按构造的差异」。
算不出落点就**不摘**，报「没有结论」，不退回「相同」。

    cmp-vs-outside.py <基准文件> <实测文件> [落点在面板内的坐标 X,Y]
    cmp-vs-outside.py --selftest

第一行打一个判词，后面是明细。退出码：0 相同或只差落点坐标；1 真的不同；3 算不出落点、没有结论。
"""
import sys

SAME = '相同'
SAME_EXCEPT_POINT = '只差落点坐标'
DIFFER = '不同'
NO_POINT = '没有结论'


def _strip_xy(line):
    """把一行里的 `xy=...` 摘掉，返回 (其余部分, xy 的值或 None)。"""
    parts = line.split(' ')
    rest, xy = [], None
    for p in parts:
        if p.startswith('xy=') and xy is None:
            xy = p[3:]
        else:
            rest.append(p)
    return ' '.join(rest), xy


def compare(baseline, observed, point):
    """→ (判词, 明细行的列表)。baseline / observed 是两个字符串列表。"""
    if len(baseline) != len(observed):
        return DIFFER, ['行数不同：基准 %d 行，实测 %d 行' % (len(baseline), len(observed))]
    excused, real, unknown = [], [], []
    for i, (b, o) in enumerate(zip(baseline, observed), start=1):
        if b == o:
            continue
        b_rest, b_xy = _strip_xy(b)
        o_rest, o_xy = _strip_xy(o)
        only_xy = (b_rest == o_rest and o_xy is not None)
        if only_xy and point is not None and o_xy == point:
            excused.append((i, b_xy, o_xy))
        elif only_xy and point is None:
            # ⚠️ **算不出落点时，只差 xy 的那一行判不了** —— 它可能是落点（按构造必然不同），
            #    也可能是真差异，而这两种要做的事完全相反。所以它既不许被摘掉（那是「相同」），
            #    也不许被算成红（那是「有东西错了」）：它是**没核成**，第三个码。
            #    这条原先落在 real 里，于是「没核成」塌进了「不同」，而三处文档写的都是「没有结论」——
            #    /code-review 逮到的，正是这套三层对账本身要防的形状。
            unknown.append((i, b, o))
        else:
            real.append((i, b, o))
    if real:
        return DIFFER, ['第 %d 行：\n     基准 %s\n     实测 %s' % r for r in real]
    if unknown:
        return NO_POINT, ['算不出这一趟的落点（drive 日志里没有 WHERE，或事件日志里没有 GEOMETRY），'
                          '而第 %d 行只差 xy —— 判不了它是落点还是真差异。' % i
                          for i, _b, _o in unknown]
    if not excused:
        return SAME, []
    return SAME_EXCEPT_POINT, [
        '第 %d 行只差 xy：基准 %s → 实测 %s，而 %s 正是这一趟的落点换算到面板内坐标 —— 按构造必然不同。'
        % (i, b_xy, o_xy, o_xy) for i, b_xy, o_xy in excused]


def _selftest():
    base = ['PRESSED btn=1 mex=0x400 src=start.StartPanel xy=600,300',
            'RELEASED btn=1 mex=0x1000 src=start.StartPanel xy=1254,250']
    cases = [
        ('逐字相同', base, list(base), '3320,1207', SAME),
        # 要害：只差落点那一处 —— 必须与「真的不同」分开，否则这张票的结论句就是错的。
        ('只差落点坐标', base,
         [base[0], 'RELEASED btn=1 mex=0x1000 src=start.StartPanel xy=3320,1207'], '3320,1207',
         SAME_EXCEPT_POINT),
        # 反面一：xy 变了，但**不等于**落点 —— 那就是真的不同，不许被摘掉。
        ('xy 变了但不是落点', base,
         [base[0], 'RELEASED btn=1 mex=0x1000 src=start.StartPanel xy=999,999'], '3320,1207', DIFFER),
        # 反面二：xy 是落点，可**同一行别的字段也变了** —— 不许被摘掉。
        ('落点对但 src 也变了', base,
         [base[0], 'RELEASED btn=1 mex=0x1000 src=main.GameLauncher xy=3320,1207'], '3320,1207', DIFFER),
        # 反面三：算不出落点时**既不摘也不算红** —— 「没核成」与「相同」「有红」三者互不共用。
        ('算不出落点 → 没有结论', base,
         [base[0], 'RELEASED btn=1 mex=0x1000 src=start.StartPanel xy=3320,1207'], None, NO_POINT),
        # 同样算不出落点，但差的**不只是 xy** —— 那与落点无关，照样是真的不同。
        ('算不出落点但差的不只 xy', base,
         [base[0], 'RELEASED btn=3 mex=0x1000 src=main.GameLauncher xy=3320,1207'], None, DIFFER),
        # 真差异**压过**没核成：同一趟里两种都有时，先说「有东西错了」（与 probe.sh 末尾那个
        # 三态退出同一个优先级）。
        ('真差异压过没核成', base + ['PRESSED btn=1 mex=0x400 src=start.StartPanel xy=1,1'],
         [base[0], 'RELEASED btn=1 mex=0x1000 src=start.StartPanel xy=3320,1207',
          'PRESSED btn=1 mex=0x400 src=main.GameLauncher xy=1,1'], None, DIFFER),
        ('行数不同', base, base[:1], '3320,1207', DIFFER),
        ('别的行不同', base,
         ['PRESSED btn=3 mex=0x400 src=start.StartPanel xy=600,300', base[1]], '3320,1207', DIFFER),
    ]
    bad = 0
    for name, b, o, p, want in cases:
        got, _ = compare(b, o, p)
        if got == want:
            print('✅ %s → %s' % (name, got))
        else:
            print('❌ %s：要 %s，得到 %s' % (name, want, got)); bad += 1
    if not cases:
        print('❌ 一条用例都没跑'); return 1
    print('自检 %d 条%s。' % (len(cases), '全过' if not bad else '，%d 条红' % bad))
    return 1 if bad else 0


def main(argv):
    if len(argv) == 2 and argv[1] == '--selftest':
        return _selftest()
    if len(argv) not in (3, 4):
        sys.stderr.write(__doc__)
        return 2
    def read(p):
        with open(p, encoding='utf-8') as f:
            return [l for l in f.read().splitlines() if l.strip()]
    point = argv[3] if len(argv) == 4 and argv[3] else None
    verdict, detail = compare(read(argv[1]), read(argv[2]), point)
    print(verdict)
    for d in detail:
        print(d)
    return {SAME: 0, SAME_EXCEPT_POINT: 0, DIFFER: 1, NO_POINT: 3}[verdict]


if __name__ == '__main__':
    sys.exit(main(sys.argv))
