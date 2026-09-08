package devtools;

/**
 * 钉住 {@link ExportTrace#requireKind}：判别名的形状校验。
 *
 * 缺口表第 10 行。把那个 {@code if} 整个关掉，两条重导对比都是绿的 ——
 * 四支驱动器的 {@code kind()} 今天全是写死的合法字面量，这条校验在真实导出里
 * 一次都走不到。
 *
 * 它守的是什么，源码注释说得很清楚：判别名是回放端「装配哪一套」的唯一依据，
 * 一个空串或带空格、带大写的名字**写进 JSON 照样是合法 JSON**，导出成功、
 * 退出码 0，而回放端要到几步之后才在别的地方失败 —— 又一次「失败长得像成功」。
 *
 * 测法是子进程：{@code requireKind} 不合格时走 {@code System.exit(2)}，
 * 在本进程里调会把测试一起带走。见 {@link Subprocess} 的类注释。
 */
public final class RequireKindTest {

    private RequireKindTest() {}

    /**
     * 正例：这些**形状**必须被放行。前几个恰好是今天真驱动器报的名字，
     * 但这里测的是形状而不是名单 —— 名单维护在实现方，导出器不替它记
     * （{@code requireKind} 的注释原话）。所以新增一支驱动器不该让这里变红。
     */
    private static final String[] GOOD = {"scene", "battle", "menu", "shop", "a", "a-b", "a0", "x-1-y"};

    /** 反例：这些形状必须硬失败。每一条对应一种「写进 JSON 也合法」的坏名字。 */
    private static final String[] BAD = {
            "",          // 空串
            "__null__",  // kind() 返回 null
            "Scene",     // 带大写
            "my scene",  // 带空格
            "scene ",    // 尾随空格（肉眼几乎看不见，正是最坏的一种）
            "-scene",    // 首字符不是字母
            "0scene",    // 首字符是数字
            "scene_2",   // 下划线不在字符集里
            "scène",     // 非 ASCII
    };

    public static void run() {
        for (String k : GOOD) {
            Subprocess.Result r = Subprocess.run("devtools.RequireKindProbe", k);
            Checks.eq("合法判别名 \"" + k + "\" 应放行（" + r + "）", 0, r.exit);
            Checks.check("放行时把原样的名字还回来：\"" + k + "\"",
                    r.out.contains("ACCEPTED:" + k));
        }
        for (String k : BAD) {
            Subprocess.Result r = Subprocess.run("devtools.RequireKindProbe", k);
            Checks.eq("坏判别名 " + show(k) + " 必须硬失败（" + r + "）", 2, r.exit);
            Checks.check("坏判别名 " + show(k) + " 的 stderr 要说清是判别名的事",
                    r.err.contains("判别名必须匹配"));
            Checks.check("坏判别名 " + show(k) + " 的 stderr 要把收到的名字回显出来",
                    r.err.contains("__null__".equals(k) ? "返回了 null" : "\"" + k + "\""));
        }
    }

    private static String show(String k) {
        return "__null__".equals(k) ? "null" : "\"" + k + "\"";
    }
}
