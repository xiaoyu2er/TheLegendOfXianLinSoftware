package devtools;

import java.io.File;
import java.lang.reflect.InvocationTargetException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

/**
 * Java 侧单元测试的入口。用法：{@code tools/test.sh}（必须在仓库根目录运行）。
 *
 * 这一套只钉一件事：**两条重导对比看不见的那些处**（xl-f8y 数出来的七处，清单与
 * 它们各自的篡改点见 {@code docs/java-side-test-gap.md}；之后每补一处就加一个类）。
 * 原版 {@code src/} 是冻结的规范，不为它建套件 —— 它的行为已经被 96×26 的字段契约
 * 与逐步行为真值覆盖在移植端真正消费的那一层上。
 *
 * <h2>登记与分母要对撞</h2>
 *
 * {@link #SUITE} 是**登记**：哪几个测试类算数，由人签。
 * {@link #onDisk()} 是**分母**：{@code tools/test/devtools/} 下文件名以
 * {@code Test.java} 结尾的有几个，现扫。
 *
 * 两者必须逐个相等，不等就是硬失败。只留其中一个都会安静地少跑东西：只有登记
 * 时，新加的测试文件忘了注册就永远不跑；只有现扫时，一个测试文件被删掉、被
 * 改名、或者整个目录路径写错，「扫到 0 个」和「全部通过」长得一模一样。
 * （{@code docs/agents/dispatch.md} 纪律 3 与它下面那条「已被记录的误用」。）
 */
public final class TestMain {

    private TestMain() {}

    /** 测试源码目录。相对仓库根，和别的 Java 侧命令一样要求在根目录运行。 */
    private static final File TEST_DIR = new File("tools/test/devtools");

    /**
     * 登记：每个类各自钉住一处「重导对比看不见」的缺口。
     * 括号里是 {@code docs/java-side-test-gap.md} 复现表里的编号 —— 那张表是
     * xl-f8y 那一趟数出来的十个篡改点，后来补的缺口没有编号，写票号。
     */
    private static final String[] SUITE = {
            "NormalizePathTest",   // 4  fix(path) 的反斜杠归一化
            "RoleSectionTest",     // 5  Reader 的 Role 段
            "JsonEscapeTest",      // 6  Json.str 的六个转义分支
            "PickDriverTest",      // 7  未知 driver 必须硬失败
            "ClockTest",           // 8  Clock 的缩放、下限与冻结
            "ReadImageWarningTest",// 9  fix(diag) 的缺图警告
            "RequireKindTest",     // 10 判别名的形状校验
            "FrameEveryTest",      // xl-6lo.3 取帧密度的三层定夺
            "SceneSelectOpTest",   // xl-yg6.7 选择框那八条场景指令的解析层拒绝
            "MenuFuncOpTest",      // xl-6lo.7 func 指令的两道拒绝与那张表的分母
            "SaveDraftIntactTest", // xl-i06.5 存档草稿区没有覆盖掉真值
            "SaveLoadScriptTest",  // xl-i06.6 存读档剧本的解析层拒绝
            "EndScriptTest",       // xl-czb.5 结局剧本的解析层拒绝
    };

    public static void main(String[] args) {
        List<String> problems = new ArrayList<>();

        Set<String> registered = new LinkedHashSet<>(Arrays.asList(SUITE));
        if (registered.size() != SUITE.length) {
            problems.add("SUITE 里有重复项：" + Arrays.toString(SUITE));
        }
        Set<String> disk = onDisk();
        if (disk.isEmpty()) {
            problems.add("在 " + TEST_DIR.getPath() + " 下一个 *Test.java 都没扫到"
                    + " —— 要么路径不对（当前目录 " + new File(".").getAbsolutePath() + "），"
                    + "要么测试真的没了。两者都不是「通过」。");
        }
        Set<String> onlyDisk = new TreeSet<>(disk);
        onlyDisk.removeAll(registered);
        Set<String> onlyReg = new TreeSet<>(registered);
        onlyReg.removeAll(disk);
        if (!onlyDisk.isEmpty()) problems.add("磁盘上有、SUITE 里没登记：" + onlyDisk);
        if (!onlyReg.isEmpty()) problems.add("SUITE 里登记了、磁盘上没有：" + onlyReg);

        if (!problems.isEmpty()) {
            System.err.println("[test] 登记与分母对不上：");
            for (String p : problems) System.err.println("  ✗ " + p);
            System.exit(1);
        }

        List<String> silent = new ArrayList<>();
        for (String name : SUITE) {
            Checks.beginClass(name);
            try {
                Class.forName("devtools." + name).getMethod("run").invoke(null);
            } catch (InvocationTargetException e) {
                Throwable c = e.getCause() == null ? e : e.getCause();
                System.err.println("[test] " + name + " 抛出了 " + c.getClass().getName() + ": " + c.getMessage());
                c.printStackTrace();
                System.err.println("[test] " + name + " 中途抛异常，退出。");
                System.exit(1);
            } catch (ReflectiveOperationException e) {
                System.err.println("[test] " + name + " 够不着：" + e
                        + "\n  （每个测试类要有 public static void run()）");
                System.exit(1);
            }
            int n = Checks.endClass();
            System.out.printf("  %-22s %d 条断言%n", name, n);
            if (n == 0) silent.add(name);
        }

        boolean bad = false;
        if (Checks.checks() == 0) {
            System.err.println("[test] 一条断言都没跑到 —— 这不是通过。");
            bad = true;
        }
        if (!silent.isEmpty()) {
            System.err.println("[test] 这些已注册的测试类一条断言都没贡献：" + silent);
            bad = true;
        }
        if (Checks.failures() > 0) {
            System.err.println("[test] " + Checks.failures() + " 条断言失败：");
            for (String m : Checks.messages()) System.err.println(m);
            bad = true;
        }

        if (bad) {
            System.err.println("[test] 失败（" + SUITE.length + " 个测试类，"
                    + Checks.checks() + " 条断言，" + Checks.failures() + " 条失败）");
            System.exit(1);
        }
        System.out.println("[test] 通过：" + SUITE.length + " 个测试类，"
                + Checks.checks() + " 条断言，0 条失败");
        // 必须显式退出，理由和 ExportTrace.main 末尾那句一样：原版加载图片会起
        // 非守护的 AWT 线程，main 返回之后 JVM 不会自己结束。实测过 —— 第一版
        // 没有这一句，七个测试类全绿、结论也打印出来了，而进程再也不返回，
        // 只能被 timeout 杀掉（退出码 124）。**一次挂住的通过和一次通过，
        // 在屏幕上长得一模一样**，区别只在那个永远不出现的 shell 提示符。
        System.exit(0);
    }

    /** 现扫测试源码目录，返回类名（去掉 .java）。 */
    private static Set<String> onDisk() {
        Set<String> out = new TreeSet<>();
        File[] fs = TEST_DIR.listFiles();
        if (fs == null) return out;
        for (File f : fs) {
            String n = f.getName();
            if (n.endsWith("Test.java")) out.add(n.substring(0, n.length() - ".java".length()));
        }
        return out;
    }
}
