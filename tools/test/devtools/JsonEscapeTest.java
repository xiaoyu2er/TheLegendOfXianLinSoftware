package devtools;

/**
 * 钉住 {@link Json#str} 的**六个**转义分支。
 *
 * 缺口表第 6 行。这一处是分支覆盖的问题，而且分母数得出来：把 96 份
 * {@code tools/ground-truth/*.json} 加 {@code tools/traces/out/*.json} 里出现过的
 * 转义全数一遍（2026-09-08 读数），只有三种 —— 双引号 x22、反斜杠 x6、
 * 制表符 x3。**换行、回车、控制字符这三个分支从来没被跑到过**，改坏了两条
 * 重导对比一声不吭。
 *
 * 所以这里六个分支一个不落，没跑到过的那三个尤其要有。控制字符那两条用
 * {@code (char) 0} / {@code (char) 0x1f} 拼出来，不写进源码字面量 —— 一个
 * 肉眼看不见的字节躺在源码里，改没改都看不出来。
 */
public final class JsonEscapeTest {

    private JsonEscapeTest() {}

    /** 把一个码位夹在 a 和 b 中间，避免源码里出现看不见的字符。 */
    private static String wrap(int codePoint) {
        return "a" + (char) codePoint + "b";
    }

    public static void run() {
        Checks.eq("null 不加引号", "null", Json.str(null));
        Checks.eq("空串", "\"\"", Json.str(""));
        Checks.eq("普通中文原样（不转成 uXXXX）", "\"宿舍\"", Json.str("宿舍"));

        // 六个分支，逐个。
        Checks.eq("分支 1/6 双引号", "\"a\\\"b\"", Json.str("a\"b"));
        Checks.eq("分支 2/6 反斜杠", "\"a\\\\b\"", Json.str("a\\b"));
        Checks.eq("分支 3/6 换行（真值里从没出现过）", "\"a\\nb\"", Json.str(wrap('\n')));
        Checks.eq("分支 4/6 回车（真值里从没出现过）", "\"a\\rb\"", Json.str(wrap('\r')));
        Checks.eq("分支 5/6 制表符", "\"a\\tb\"", Json.str(wrap('\t')));
        Checks.eq("分支 6/6 控制字符走 uXXXX（真值里从没出现过）",
                "\"a\\u0000b\"", Json.str(wrap(0)));
        Checks.eq("分支 6/6 边界：0x1f 要转",
                "\"a\\u001fb\"", Json.str(wrap(0x1f)));
        Checks.eq("分支 6/6 边界：0x20 是空格，原样不转",
                "\"a b\"", Json.str(wrap(0x20)));

        // 反斜杠那条是脚本数据里真有的形状（剧情1 / 迷宫1 的三条 Windows 路径）。
        Checks.eq("原版数据里那条 Windows 路径",
                "\"image\\\\背景图\\\\伏魔山树林.png\"",
                Json.str("image\\背景图\\伏魔山树林.png"));

        Checks.eq("arrStr 的 null", "null", Json.arrStr(null));
        Checks.eq("plainArr 的 null", "null", Json.plainArr(null));
        Checks.eq("grid 的 null", "null", Json.grid(null));
        Checks.eq("grid 逐行", "[[1,2],[3,4]]", Json.grid(new int[][]{{1, 2}, {3, 4}}));
    }
}
