package devtools;

import java.util.ArrayList;
import java.util.List;

/**
 * 断言与记账，不引任何第三方依赖。
 *
 * 名字里**故意不带 {@code Test}**：{@link TestMain} 用「文件名以 Test.java 结尾」
 * 现扫出测试类的分母，一个需要手写例外的扫描，例外迟早会长第二条。
 *
 * 为什么不是 JUnit：这一套要钉的七项里五项是纯函数断言，JUnit 的参数化、
 * 生命周期、类路径发现一样都用不上，而引它意味着仓库里多一个 2.7 MiB 的二进制、
 * 一个版本号要跟、以及 tools/build.sh 的 classpath 再长一截。仓库里已有先例：
 * {@link Json} 与 {@link JsonIn} 的类注释都写着「不引第三方依赖」。
 * （xl-f8y，用户 2026-09-08 裁定。）
 *
 * **成功与失败必须长得不一样，这是这个类唯一的设计要求。**
 * 记账因此有三层，任何一层不满足都是非零退出：
 *
 * <ol>
 *   <li>有断言失败 —— 显然要红；
 *   <li>**一条断言都没跑到** —— 也要红。一个 main 什么都没做、或者测试类因为
 *       改名/漏注册而根本没被调用，安静地 exit 0 与全部通过长得一模一样，
 *       那正是 {@code docs/agents/dispatch.md} 反复记的那一族；
 *   <li>**某个已注册的测试类一条断言都没贡献** —— 同上，只是分母细到每个类。
 * </ol>
 *
 * 所以这里数的是**断言条数**而不是测试方法数：一个方法被调用了、里面的断言却
 * 因为提前 return 全被跳过，两者在方法数上看不出区别。
 */
public final class Checks {

    private Checks() {}

    private static int checks;
    private static int failures;
    private static final List<String> messages = new ArrayList<>();

    /** 当前正在跑的测试类，用于把断言数记到各自名下。 */
    private static String current = "(未指定)";
    private static int checksAtClassStart;

    static void beginClass(String name) {
        current = name;
        checksAtClassStart = checks;
    }

    /** @return 这个类贡献了几条断言。 */
    static int endClass() {
        int n = checks - checksAtClassStart;
        current = "(未指定)";
        return n;
    }

    // ---- 断言 ----

    static void check(String what, boolean ok) {
        checks++;
        if (!ok) fail(what + " —— 期望为真，实际为假");
    }

    static void eq(String what, Object expected, Object actual) {
        checks++;
        if (expected == null ? actual != null : !expected.equals(actual)) {
            fail(what + "\n      期望: " + show(expected) + "\n      实际: " + show(actual));
        }
    }

    /**
     * 断言 {@code body} 抛出 {@code type}，且异常消息里含 {@code needle}。
     *
     * 消息也要核：一个「硬失败」如果失败时说的是别的事，排查的人会被带到
     * 错误的地方去，而退出码那一位读起来是一样的。
     */
    static void throwsWith(String what, Class<? extends Throwable> type, String needle, Runnable body) {
        checks++;
        try {
            body.run();
        } catch (Throwable t) {
            if (!type.isInstance(t)) {
                fail(what + " —— 期望 " + type.getSimpleName() + "，实际 " + t.getClass().getName() + ": " + t.getMessage());
                return;
            }
            String msg = String.valueOf(t.getMessage());
            if (!msg.contains(needle)) {
                fail(what + " —— 异常类型对，但消息里没有 " + show(needle) + "\n      实际消息: " + show(msg));
            }
            return;
        }
        fail(what + " —— 期望抛 " + type.getSimpleName() + "，实际什么都没抛");
    }

    private static void fail(String msg) {
        failures++;
        messages.add("  ✗ [" + current + "] " + msg);
    }

    private static String show(Object o) {
        if (o == null) return "null";
        if (o instanceof String) return "\"" + ((String) o).replace("\\", "\\\\")
                .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t") + "\"";
        return String.valueOf(o);
    }

    // ---- 记账 ----

    static int checks() { return checks; }
    static int failures() { return failures; }
    static List<String> messages() { return messages; }
}
