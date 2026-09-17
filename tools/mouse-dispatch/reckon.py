#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把一轮探针日志按驱动器打的 MARK 分段，每段给出一份**不含计数、不含坐标**的读数（xl-8eg）。

为什么要它，而不是复用 tools/mouse-dispatch-probe.sh 里那个 `normalize`：

- `normalize` 只留 PRESSED / RELEASED。**xl-8eg 要量的是 DRAGGED**（起 grab 那只键松开后、
  只剩那只被挡掉的键按着时的拖动，原版收不收得到），它一条都进不了对账。
- 移动那一批的**条数不稳**（系统会合并，见 MouseDispatchProbe 的类注释）。所以这里对每一段
  只报「出现过哪几种 <事件 btn mex src>」，去重后排序 —— **零 / 非零**与**派给了谁**是稳的，
  条数不是。坐标（xy= / scr=）同理去掉：越界那件事 xl-40m 已经量过，这一趟不靠它。

读法（一行一条）：

    <段名> | PRESSED btn=1 mex=0x400 src=start.StartPanel
    <段名> | 没有 PRESSED / RELEASED / DRAGGED

**「没有」也是一条读数**，所以空段照样打一行 —— 段名整个消失与「这一段什么都没收到」
长得不一样，这是故意的。

用法：

    tools/mouse-dispatch/reckon.py <驱动器日志> <事件日志>
    tools/mouse-dispatch/reckon.py --selftest        # 不碰鼠标、不要权限，只跑合成日志

退出码：0 = 打出来了；3 = **结构上读不出**（一个 MARK 都没有 / 一行事件都没有 /
日志里有认不出的行）。3 与「收到的事件是零」分得开，这是这个脚本最要紧的一件事：
两者都会让下面的读数变空，而成因完全不同（日志格式漂了 vs 合成事件被丢了 vs 原版真收不到）。
"""

import sys

KINDS = ('PRESSED', 'RELEASED', 'DRAGGED')
"""进读数的三种。MOVED / ENTERED / EXITED / CLICKED 条数不稳，不进（与 normalize 同一个理由）。"""

KNOWN = frozenset(('PRESSED', 'RELEASED', 'CLICKED', 'MOVED', 'DRAGGED', 'ENTERED', 'EXITED'))

EMPTY = '没有 PRESSED / RELEASED / DRAGGED'


def parse_marks(text):
    """`<毫秒> MARK <段名>` → [(毫秒, 段名)]，按日志里的先后。"""
    marks = []
    for line in text.splitlines():
        f = line.split(' ', 2)
        if len(f) == 3 and f[1] == 'MARK' and f[0].isdigit():
            marks.append((int(f[0]), f[2]))
    return marks


#: 探针写在事件之前的元信息行（`<名字> <值...>`）。加新的元信息行时要往这里加一个名字，
#: 否则它会被数成「认不出来」而不是被跳过 —— 而那会把整份分段读数作废。
META_PREFIXES = {'GEOMETRY', 'SAMEAPP', 'SAMEAPPCLASS'}


def parse_events(text):
    """事件日志 → ([(毫秒, '事件 btn= mex= src=')], 认不出的行数)。

    认不出的行**单独数**：格式漂了的时候下面的读数会整片变空，而那与「一条都没收到」
    长得一模一样（探针脚本里 normalize 那条 sed 也栽过同一个坑，见它的注释）。
    """
    events, junk = [], 0
    for line in text.splitlines():
        if not line.strip():
            continue
        # 探针在事件之前先写几行**元信息**（几何 / 另一块窗口的几何与类名）。它们不是事件，
        # 也不是「格式漂了」—— 名单写在这里，名单之外的仍然算 junk。
        # ⚠️ 原先只跳 GEOMETRY，于是 same-app-window 那一支多出来的 SAMEAPP / SAMEAPPCLASS
        #    两行被数成「认不出来」，整份分段读数当场作废（退出码 3）——**只有那一个落点会撞到**，
        #    默认落点上一次都不会响（xl-23v 实跑现撞到的）。
        # ⚠️ 要连**后面那半**一起要：裸一行 `GEOMETRY`（没有值）不是元信息，是格式真漂了 ——
        #    只看头一个词的话它会被静默跳过，而那正是「放宽了一个判据」的样子
        #    （/code-review 逮到的；原先写的是 startswith('GEOMETRY ')，带着那个空格）。
        head, _, tail = line.partition(' ')
        if head in META_PREFIXES and tail.strip():
            continue
        f = line.split()
        name = f[1] if len(f) > 1 else ''
        shape = (len(f) >= 6 and f[0].isdigit()
                 and (name in KNOWN or (name.startswith('ID') and name[2:].isdigit()))
                 # ⚠️ 前缀也要核，不能只数字段个数：探针要是在 btn 前面多插一列，
                 # `btn=` / `mex=` / `src=` 会整体右移一位，下面那句 join 照样拼得出一行，
                 # src 被静默丢掉 —— 那是一份**看起来正常**的错读数（/code-review 逮到的）。
                 and f[2].startswith('btn=') and f[3].startswith('mex=') and f[4].startswith('src='))
        if not shape:
            junk += 1
            continue
        if name not in KINDS:
            continue
        events.append((int(f[0]), ' '.join((name, f[2], f[3], f[4]))))
    return events, junk


def reckon(drive_text, events_text):
    """→ (读数行的列表, 出错的话一句话说明)。出错时读数行仍然照给，便于人看。"""
    marks = parse_marks(drive_text)
    events, junk = parse_events(events_text)

    problem = None
    names = [name for _, name in marks]
    if not marks:
        problem = '驱动器日志里一个 MARK 都没有 —— 分不了段，下面这份读数不算数'
    elif len(set(names)) != len(names):
        # 桶是拿 MARK 的**文本**当键的，重名会静默并成一桶：两段的读数混在一行里，
        # 而那一行读起来和「这一段就是这样」一模一样。
        problem = '驱动器日志里有同名的 MARK —— 它们会并成一桶，分段读数不算数'
    elif junk:
        problem = '事件日志里有 %d 行认不出来 —— 多半是探针的输出格式漂了，不是「没收到」' % junk
    elif not events:
        problem = '事件日志里 PRESSED / RELEASED / DRAGGED 一条都没有 —— 先看 A 对照，那多半是权限或焦点'

    # 分桶：一个事件归**时间戳不晚于它**的最后一个 MARK。第一个 MARK 之前的单独一桶。
    buckets = {name: set() for _, name in marks}
    before = set()
    for ts, tup in events:
        owner = None
        for mts, name in marks:
            if mts <= ts:
                owner = name
            else:
                break
        (before if owner is None else buckets[owner]).add(tup)

    lines = []
    if before:
        for tup in sorted(before):
            lines.append('（第一个 MARK 之前） | ' + tup)
    for _, name in marks:
        got = sorted(buckets[name])
        if got:
            lines.extend('%s | %s' % (name, t) for t in got)
        else:
            lines.append('%s | %s' % (name, EMPTY))
    return lines, problem


# ---------------------------------------------------------------- 自检

def _selftest():
    """一批合成用例（条数末尾自己报）。**不碰鼠标、不要辅助功能授权**，随时可跑。

    前两条是这套东西的要害：D3 段有 DRAGGED 与没有 DRAGGED，**输出必须长得不一样** ——
    xl-8eg 这一趟就是去分辨这两种，它们要是同形，跑了也白跑。
    """
    def log(*rows):
        return ''.join(r + '\n' for r in rows)

    drive = log('PERMISSIONS CGPreflightPostEventAccess=true AXIsProcessTrusted=true',
                '1000 MARK D1 拖出', '2000 MARK D3 拖回', '3000 MARK D4 收尾')
    d1 = '1500 DRAGGED btn=0 mex=0x400 src=start.StartPanel xy=1100,250 scr=1100,303'
    d3 = '2500 DRAGGED btn=0 mex=0x1000 src=start.StartPanel xy=900,260 scr=900,313'

    # 期望值里那一列是**说明里的一个词**，不是退出码：用退出码的话，「格式漂了」与
    # 「一条都没收到」都落在 3 上，两者同形 —— 而分开它们正是这个脚本存在的理由。
    cases = [
        ('D3 收得到（假设二）', drive, log(d1, d3, '2600 ' + d3.split(' ', 1)[1]), None, [
            'D1 拖出 | DRAGGED btn=0 mex=0x400 src=start.StartPanel',
            'D3 拖回 | DRAGGED btn=0 mex=0x1000 src=start.StartPanel',
            'D4 收尾 | ' + EMPTY]),
        ('D3 收不到（假设一）', drive, log(d1), None, [
            'D1 拖出 | DRAGGED btn=0 mex=0x400 src=start.StartPanel',
            'D3 拖回 | ' + EMPTY,
            'D4 收尾 | ' + EMPTY]),
        ('正对照也没有 = 整轮作废', drive, log(), '一条都没有', [
            'D1 拖出 | ' + EMPTY, 'D3 拖回 | ' + EMPTY, 'D4 收尾 | ' + EMPTY]),
        ('格式漂了，不是没收到', drive, log('1500 DRAGGED src=start.StartPanel'), '认不出来', [
            'D1 拖出 | ' + EMPTY, 'D3 拖回 | ' + EMPTY, 'D4 收尾 | ' + EMPTY]),
        # 分不了段时事件不丢，全进「第一个 MARK 之前」那一桶 —— 退出码 3 说的是「这份读数
        # 不算数」，不是「什么都没有」。（这条期望值起初写成空列表，自检当场逮到。）
        ('一个 MARK 都没有', log('PERMISSIONS x'), log(d1), '一个 MARK 都没有', [
            '（第一个 MARK 之前） | DRAGGED btn=0 mex=0x400 src=start.StartPanel']),
        # 多插一列：字段个数够、事件名也认得，只有前缀对不上 —— 不核前缀的话 src 会被静默丢掉。
        ('探针多插了一列 → 算格式漂了', drive,
         log('1500 DRAGGED id=7 btn=0 mex=0x400 src=start.StartPanel xy=1,2 scr=1,2'), '认不出来', [
            'D1 拖出 | ' + EMPTY, 'D3 拖回 | ' + EMPTY, 'D4 收尾 | ' + EMPTY]),
        # 同名 MARK：两段会并成一桶，读起来像「这一段就是这样」。
        # 症状就在期望值里：同一条读数被**打了两遍**（两段并成了一桶），而单看任一行都正常。
        ('两个同名 MARK → 不算数', log('1000 MARK D1 拖出', '2000 MARK D1 拖出'), log(d1),
         '同名的 MARK', ['D1 拖出 | DRAGGED btn=0 mex=0x400 src=start.StartPanel',
                        'D1 拖出 | DRAGGED btn=0 mex=0x400 src=start.StartPanel']),
        # 探针的元信息行不是事件、也不是「格式漂了」。⚠️ 这一条是 xl-23v 实跑撞出来的：
        # SAMEAPP / SAMEAPPCLASS 只在 same-app-window 那一支出现，默认落点上永远不会响。
        ('探针的元信息行不算 junk', drive,
         log('SAMEAPP 1104,153 300x300', 'SAMEAPPCLASS javax.swing.JFrame', d1), None, [
            'D1 拖出 | DRAGGED btn=0 mex=0x400 src=start.StartPanel',
            'D3 拖回 | ' + EMPTY, 'D4 收尾 | ' + EMPTY]),
        # 反面一：名单之外的元信息行**仍然要算 junk**。只加不减地放宽的话，真格式漂了也不会响。
        ('名单外的元信息行仍算 junk', drive, log('SAMEAPPTITLE 标题页', d1), '认不出来', [
            'D1 拖出 | DRAGGED btn=0 mex=0x400 src=start.StartPanel',
            'D3 拖回 | ' + EMPTY, 'D4 收尾 | ' + EMPTY]),
        # 反面二：名单里的名字但**后面没有值** —— 那是格式漂了，不是元信息。
        ('裸一行 GEOMETRY 算 junk', drive, log('GEOMETRY', d1), '认不出来', [
            'D1 拖出 | DRAGGED btn=0 mex=0x400 src=start.StartPanel',
            'D3 拖回 | ' + EMPTY, 'D4 收尾 | ' + EMPTY]),
        ('时间戳压在 MARK 上 → 归后一段', drive, log('2000 ' + d3.split(' ', 1)[1]), None, [
            'D1 拖出 | ' + EMPTY,
            'D3 拖回 | DRAGGED btn=0 mex=0x1000 src=start.StartPanel',
            'D4 收尾 | ' + EMPTY]),
    ]
    bad = 0
    for name, dv, ev, want_problem, want_lines in cases:
        lines, problem = reckon(dv, ev)
        ok_problem = (problem is None) if want_problem is None else (problem is not None and want_problem in problem)
        if lines != want_lines or not ok_problem:
            bad += 1
            print('❌ %s' % name)
            print('   说明：%s（要：%s）' % (problem or '（没有）', want_problem or '（没有）'))
            print('   读到：' + ' ⏎ '.join(lines))
            print('   要的：' + ' ⏎ '.join(want_lines))
        else:
            print('✅ %s（%s，%d 行）' % (name, problem or '没有要报的', len(lines)))
    # ⚠️ 这里原先还有一条「两份读数不同形」的断言，**它是按构造成立的**（/code-review 逮到）：
    # 头两条用例的期望文本本来就逐字不同，上面又逐条核过，两条过就推出不同形，永远红不了。
    # 真正在守这件事的是**头两条用例的期望文本本身** —— 它们只差 D3 那一行，改坏任何一边都红。
    bad_main, n_main = _selftest_main()
    bad += bad_main
    if bad:
        print('自检 %d 条不过。' % bad)
        return 1
    print('自检 %d 条全过。' % (len(cases) + n_main))
    return 0


def _selftest_main():
    """走一遍 main()，核退出码 —— 上面那批只调 reckon()，而 probe.sh 判的是退出码。→ (不过的条数, 条数)"""
    import tempfile, os
    bad = n = 0
    drive = 'PERMISSIONS ok\n1000 MARK D1 拖出\n2000 MARK D3 拖回\n'
    good = '1500 DRAGGED btn=0 mex=0x400 src=start.StartPanel xy=1,2 scr=1,2\n'
    for name, ev, want in (('main 正常 → 0', good, 0), ('main 格式漂了 → 3', '1500 DRAGGED src=x\n', 3)):
        d = tempfile.mkdtemp()
        dv, evp = os.path.join(d, 'drive.log'), os.path.join(d, 'events.log')
        open(dv, 'w', encoding='utf-8').write(drive)
        open(evp, 'w', encoding='utf-8').write(ev)
        devnull = open(os.devnull, 'w')
        so, se = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = devnull, devnull
        try:
            got = main(['reckon.py', dv, evp])
        finally:
            sys.stdout, sys.stderr = so, se
            devnull.close()
        n += 1
        if got == want:
            print('✅ %s' % name)
        else:
            bad += 1
            print('❌ %s：拿到 %d' % (name, got))
    return bad, n


def main(argv):
    if len(argv) == 2 and argv[1] == '--selftest':
        return _selftest()
    if len(argv) != 3:
        sys.stderr.write('用法：reckon.py <驱动器日志> <事件日志> | reckon.py --selftest\n')
        return 2
    with open(argv[1], encoding='utf-8') as f:
        drive_text = f.read()
    with open(argv[2], encoding='utf-8') as f:
        events_text = f.read()
    lines, problem = reckon(drive_text, events_text)
    for line in lines:
        print(line)
    if problem:
        sys.stderr.write('⚠️ ' + problem + '\n')
        return 3
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
