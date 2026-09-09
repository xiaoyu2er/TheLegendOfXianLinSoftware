package devtools;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 钉住 {@code func} 指令那两道拒绝，以及它那张表的分母（xl-6lo.7）。
 *
 * <h2>为什么两条重导对比都看不见这一处</h2>
 *
 * {@code tools/export-trace.sh} 跑的是 {@code tools/traces/scripts/} 里入库的
 * 那些剧本，而**没有任何一份剧本会写一个点不得的按钮名** —— 写了就不入库了。
 * 于是把整段拒绝删掉，两条重导对比什么都察觉不到。**实测（2026-09-09）**：
 * 删掉 {@code b.forbidden != null} 那一支，{@code tools/export-trace.sh --check
 * menu-func} 退出码 0、逐字节一致、{@code git status tools/traces/out} 是空的，
 * 而这个测试当场红 7 条。放行之后 {@code exitForSure} 就写得进剧本 —— 它会
 * {@code System.exit(0)}，导出器在写文件之前消失，**退出码是 0**。
 * 「什么都没导出」与「导出成功」在那条命令上长得一模一样，这正是本仓库
 * 最忌讳的一族失败。
 *
 * <b>这一段只对「点不得」那道成立，别推广到整张表。</b> 同一天量的另一条：
 * 把 {@code onBGM} 映到的字段名改错（{@code on_BGM} → {@code onBGM}），
 * 这个测试红 2 条（分母那条 + 映射那条），而 {@code export-trace.sh} **也**红 ——
 * {@code menu-func} 真的点那颗按钮，反射当场抛「没有字段 onBGM on class
 * menu.FuncButtons」。两道各守各的：字段名那半重导看得见，拒绝那半看不见。
 *
 * <h2>三件事，各一条</h2>
 *
 * <ol>
 *   <li><b>分母</b>：{@code MenuScript} 那张表覆盖的字段名，与 {@code menu.FuncButtons}
 *       上真正声明出来的 {@code MenuButton} 字段**逐个相等**。原版多一颗、少一颗、
 *       改个名，这条红。它是这里唯一从源头现扫的东西 —— 名单里"点得 / 点不得"
 *       那一半是**登记**，必须由人签（{@code docs/agents/dispatch.md} 纪律 3
 *       底下那条"分母 vs 登记"）。
 *   <li><b>点不得的都被挡住，且报的是自己那条理由</b>：七颗逐颗验。只验"抛了"
 *       不够 —— 一句报错说的是别的事，排查的人会被带到别处去，而退出码那一位
 *       读起来一样。
 *   <li><b>点得的能进剧本、映射到对的字段</b>：七颗逐颗验。少了这一条，把整张表
 *       改成"全部拒绝"也是绿的。
 * </ol>
 */
public final class MenuFuncOpTest {

    private MenuFuncOpTest() {}

    /** 剧本里点得的那七颗，以及它们该映射到的 {@code FuncButtons} 字段。 */
    private static final String[][] CLICKABLE = {
            { "set", "setButton" },
            { "setBGM", "setBGM" },
            { "setClick", "setClick" },
            { "onBGM", "on_BGM" },
            { "offBGM", "off_BGM" },
            { "offClick", "off_click" },
            { "exit", "exitButton" },
    };

    /** 点不得的那七颗，以及各自那条理由里必须出现的关键字。 */
    private static final String[][] FORBIDDEN = {
            { "save", "lsPanel" },
            { "read", "lsPanel" },
            { "return", "switchTo" },
            { "restart", "switchTo" },
            { "exitForSure", "System.exit(0)" },
            { "onClick", "openMusic" },
            { "setKey", "点不到" },
    };

    public static void run() {
        tableCoversEveryButton();
        forbiddenAreRejectedWithTheirOwnReason();
        clickableParseAndMapToTheRightField();
    }

    /**
     * 分母：表里的字段名 == {@code FuncButtons} 上声明的 MenuButton 字段。
     *
     * 扫的是 {@code getDeclaredFields()}，不是构造出来的对象 —— 建一个
     * {@code FuncButtons} 要先有 {@code FatherPanel}，而那条路在
     * {@code -Djava.awt.headless=true} 下建 {@code MenuPanel} 时就抛
     * {@code HeadlessException}（{@link FrameEveryTest} 记着同一件事）。
     * 反射读字段声明不需要初始化这个类。
     */
    private static void tableCoversEveryButton() {
        List<String> declared = new ArrayList<>();
        for (Field f : buttonsClass().getDeclaredFields()) {
            if (f.getType().getSimpleName().equals("MenuButton")) declared.add(f.getName());
        }
        Collections.sort(declared);
        List<String> covered = new ArrayList<>(MenuScript.funcFieldNames());
        Collections.sort(covered);
        // 分母不能是空的：一次"扫到 0 个"（类名写错、字段类型改名）与"全都盖住了"
        // 在下面那条相等断言上长得一模一样。
        Checks.check("FuncButtons 上扫得到 MenuButton 字段", !declared.isEmpty());
        Checks.eq("表覆盖的字段 == FuncButtons 声明的 MenuButton 字段", declared, covered);
    }

    private static Class<?> buttonsClass() {
        try {
            return Class.forName("menu.FuncButtons");
        } catch (ClassNotFoundException e) {
            throw new AssertionError("找不到 menu.FuncButtons —— classpath 不对", e);
        }
    }

    /** 七颗点不得的，逐颗验：抛了，而且抛的是自己那条理由。 */
    private static void forbiddenAreRejectedWithTheirOwnReason() {
        for (String[] row : FORBIDDEN) {
            final String name = row[0];
            Checks.throwsWith("天书页的 " + name + " 不许进剧本，且要说自己那条理由",
                    IllegalArgumentException.class, row[1],
                    new Runnable() {
                        @Override public void run() { loadWithFunc(name); }
                    });
        }
        // 名字打错要报的是**点得的那七颗**，不是十四颗全集：报全集等于告诉下一个人
        // 「exitForSure 是个合法选项」。
        Checks.throwsWith("拼错的名字报的是点得的那几颗",
                IllegalArgumentException.class, "只能是 [set, setBGM, setClick, onBGM, offBGM, offClick, exit]",
                new Runnable() {
                    @Override public void run() { loadWithFunc("setBgm"); }
                });
    }

    /** 七颗点得的，逐颗验：进得了剧本，且映射到对的字段。 */
    private static void clickableParseAndMapToTheRightField() {
        for (String[] row : CLICKABLE) {
            MenuScript s = loadWithFunc(row[0]);
            Checks.eq(row[0] + " 进得了剧本", row[0], s.steps.get(0).target);
            Checks.eq(row[0] + " 映射到 " + row[1], row[1], MenuScript.funcField(row[0]));
        }
        // 点不得的那几颗在驱动器那一侧拿不到字段。这一条不是重复上面的拒绝：
        // 它钉的是"就算有人绕过解析层直接问驱动器，也问不出一个能点的按钮"。
        Checks.eq("点不得的按钮在驱动器侧拿不到字段", null, MenuScript.funcField("exitForSure"));
    }

    // ---- 造一份只有一条 func 指令的剧本 ----

    private static MenuScript loadWithFunc(String name) {
        File f = null;
        try {
            f = File.createTempFile("menu-func-op", ".json");
            try (Writer w = new OutputStreamWriter(new FileOutputStream(f), StandardCharsets.UTF_8)) {
                w.write("{\"driver\":\"menu\",\"name\":\"probe\",\"steps\":["
                        + "{\"op\":\"func\",\"name\":" + Json.str(name) + "}]}");
            }
            return MenuScript.load(f);
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new AssertionError("造探针剧本失败", e);
        } finally {
            if (f != null && !f.delete()) f.deleteOnExit();
        }
    }

}
