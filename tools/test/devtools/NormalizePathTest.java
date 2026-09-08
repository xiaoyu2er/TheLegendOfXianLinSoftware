package devtools;

import tools.Reader;

/**
 * 钉住 {@code fix(path)}：{@link Reader#normalizePath} 的反斜杠归一化。
 *
 * 缺口表第 4 行。把这个方法整个改成 {@code return path;}，两条重导对比**都是绿的**
 * —— 真值存的是脚本里的原样字符串（{@code tools/ground-truth/剧情1.json} 与
 * {@code 迷宫1.json} 里那 6 个反斜杠转义原封不动留着），归一化只在
 * {@code readImage} 那一刻起作用，而 {@code ImageIcon} 路径错时既不抛异常也不返回
 * null，状态层看不出任何区别。
 *
 * 期望值不是编的，是脚本数据里真有的那几条（{@code CLAUDE.md} 点名说它们是
 * 「deliberate test fixtures」，不许「修」）。
 */
public final class NormalizePathTest {

    private NormalizePathTest() {}

    public static void run() {
        // 方向是单向的：反斜杠 -> 正斜杠。反过来（用 File.separator）会在
        // Windows 之外弄坏本来正常的那 22 条数据，源码注释专门写了这一点。
        Checks.eq("单个反斜杠归一化",
                "image/背景图/伏魔山树林.png",
                Reader.normalizePath("image\\背景图\\伏魔山树林.png"));

        Checks.eq("正斜杠原样不动",
                "image/背景图/伏魔山树林.png",
                Reader.normalizePath("image/背景图/伏魔山树林.png"));

        Checks.eq("混用时只动反斜杠那半",
                "sources/NPCs/商塔副堂主/1.png",
                Reader.normalizePath("sources/NPCs\\商塔副堂主\\1.png"));

        Checks.eq("连续反斜杠逐个换（原版数据里的 NPCs// 就是这个形状）",
                "NPCs//商塔副堂主",
                Reader.normalizePath("NPCs\\\\商塔副堂主"));

        Checks.eq("null 进 null 出", null, Reader.normalizePath(null));
        Checks.eq("空串原样", "", Reader.normalizePath(""));
        Checks.eq("没有分隔符的名字原样", "宿舍.png", Reader.normalizePath("宿舍.png"));
    }
}
