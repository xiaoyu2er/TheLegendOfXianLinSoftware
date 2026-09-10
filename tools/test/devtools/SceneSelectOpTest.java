package devtools;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 钉住 xl-yg6.7 给场景词汇加的那八条指令的**解析层拒绝**，以及它们的分母。
 *
 * <h2>为什么两条重导对比都看不见这一处</h2>
 *
 * {@code tools/export-trace.sh} 跑的是 {@code tools/traces/scripts/} 里入库的
 * 那些剧本，而**没有任何一份剧本会写 {@code "key": "left"} 或 {@code "times": 0}**
 * —— 写了就不入库了。于是把这几段拒绝整个删掉，两条重导对比什么都察觉不到：
 * `--check` 照样两遍逐字节一致，`git diff tools/traces/out` 照样是空的。
 * 形状与 {@link MenuFuncOpTest} 那一趟逐字同形（{@code CLAUDE.md} 的
 * 「一个缺口要一条检查，每个缺口至少一条」）。
 *
 * <b>实测（2026-09-09，本文件落地时）</b>：把 {@code CURSOR_KEYS.contains(key)}
 * 那一支删掉，{@code tools/export-trace.sh --check question-answer} 退出码 0、
 * 逐字节一致，而这个测试当场红。
 *
 * <h2>放行之后会发生什么（为什么这几道值得守）</h2>
 *
 * <ul>
 *   <li>{@code key: "left"} —— 原版 {@code SelectEvent.keyPressed} 的第一支是
 *       {@code VK_DOWN || VK_UP}，左右键在选择框开着时一个分支都走不到。导出器
 *       照按不误，导出一份**看上去正常、而那一步什么都没发生**的真值。
 *   <li>{@code times: 0} —— 一条按 0 次的 cursor 与"这一步整个漏写了"在真值里
 *       长得一模一样，而光标停在哪一项正是答对/答错的分水岭。
 *   <li>场景 {@code awaitExit} 的 {@code max} —— 它当拍就判，那个上限一次都走不到；
 *       回显出去会被读真值的人当成判据。
 * </ul>
 *
 * <h2>四件事，各一组</h2>
 *
 * <ol>
 *   <li><b>分母</b>：解析层认得的场景指令名单，与 {@code SceneDriver.exec} 那个
 *       {@code switch} 里真正处理了的 {@code case} 标签**逐个相等**。加一条指令
 *       只改一头，这条红。名单从两边各自的源码现扫 —— 一头是
 *       {@code TraceScript} 的私有常量（反射读），另一头是
 *       {@code tools/src/devtools/SceneDriver.java} 这份源文件里的 case 标签。
 *   <li><b>点不得的都被挡住，且报的是自己那条理由</b>：只验"抛了"不够 ——
 *       一句报错说的是别的事，排查的人会被带到别处去，而退出码那一位读起来一样。
 *   <li><b>写对了的进得了剧本</b>：少了这一条，把整段解析改成"全部拒绝"也是绿的。
 *   <li><b>回显</b>：{@code cursor} 的 key/times 与 {@code awaitExit} 的 panel
 *       真的进了剧本回显，而场景的 awaitExit **不回显 max**。回显就是真值的一部分
 *       （trace 头里那个 {@code script} 字段），漏一个字段的表现是真值里少一行，
 *       而那一行正是"拦截到的目标"。
 * </ol>
 */
public final class SceneSelectOpTest {

    private SceneSelectOpTest() {}

    public static void run() {
        opsMatchTheDriversSwitch();
        badCursorKeysAreRejectedWithTheirOwnReason();
        badCursorTimesAreRejected();
        sceneAwaitExitRefusesMax();
        goodOnesParseAndEcho();
    }

    // ---- 1. 分母 ----

    /**
     * 解析层的场景指令名单 == 驱动器 {@code exec} 里真正处理了的 case 标签。
     *
     * 为什么读源文件而不是反射驱动器：{@code switch} 的 case 标签在字节码里没有
     * 名字。读源码的坏处是格式一变就扫不到，所以**扫到 0 个是硬失败** ——
     * "一个 case 都没扫到"与"两边完全一致"在下面那条相等断言上长得一模一样。
     */
    private static void opsMatchTheDriversSwitch() {
        List<String> declared = new ArrayList<>(TraceScript.sceneOps());
        java.util.Collections.sort(declared);

        List<String> handled = new ArrayList<>();
        String src = readUtf8(new File("tools/src/devtools/SceneDriver.java"));
        java.util.regex.Matcher m =
                java.util.regex.Pattern.compile("(?m)^\\s*case \"([a-zA-Z]+)\":").matcher(src);
        while (m.find()) if (!handled.contains(m.group(1))) handled.add(m.group(1));
        java.util.Collections.sort(handled);

        Checks.check("从 SceneDriver.java 扫得到 case 标签", !handled.isEmpty());
        Checks.eq("解析层的场景指令 == 驱动器 exec 处理的 case", declared, handled);
    }

    // ---- 2. 拒绝 ----

    private static void badCursorKeysAreRejectedWithTheirOwnReason() {
        for (final String bad : new String[] { "left", "right", "space", "DOWN", "" }) {
            Checks.throwsWith("cursor 的 key=" + bad + " 不许进剧本，且要说自己那条理由",
                    IllegalArgumentException.class, "[down, up]",
                    new Runnable() {
                        @Override public void run() { loadScene("{\"op\":\"cursor\",\"key\":"
                                + Json.str(bad) + ",\"times\":1}"); }
                    });
        }
    }

    private static void badCursorTimesAreRejected() {
        for (final int bad : new int[] { 0, -1 }) {
            Checks.throwsWith("cursor 的 times=" + bad + " 不许进剧本",
                    IllegalArgumentException.class, "times 至少是 1",
                    new Runnable() {
                        @Override public void run() {
                            loadScene("{\"op\":\"cursor\",\"key\":\"down\",\"times\":" + bad + "}");
                        }
                    });
        }
    }

    private static void sceneAwaitExitRefusesMax() {
        Checks.throwsWith("场景的 awaitExit 不接受 max",
                IllegalArgumentException.class, "当拍就判",
                new Runnable() {
                    @Override public void run() {
                        loadScene("{\"op\":\"awaitExit\",\"panel\":\"shopPanel\",\"max\":300}");
                    }
                });
        // 不认识的面板名照旧硬失败 —— 上面那条不能是"awaitExit 整个进不来"。
        Checks.throwsWith("awaitExit 的面板名必须是那八张卡片之一",
                IllegalArgumentException.class, "不认识的面板",
                new Runnable() {
                    @Override public void run() {
                        loadScene("{\"op\":\"awaitExit\",\"panel\":\"selectPanel\"}");
                    }
                });
    }

    // ---- 3 & 4. 写对了的进得了剧本，而且回显对 ----

    private static void goodOnesParseAndEcho() {
        for (String key : new String[] { "down", "up" }) {
            TraceScript s = loadScene("{\"op\":\"cursor\",\"key\":\"" + key + "\",\"times\":3}");
            Checks.eq("cursor key=" + key + " 进得了剧本", key, s.steps.get(0).key);
            Checks.eq("cursor times 进得了剧本", 3, s.steps.get(0).times);
            Checks.check("cursor 的 key 与 times 都回显了",
                    s.toJson().contains("\"key\":\"" + key + "\",\"times\":3"));
        }
        TraceScript s = loadScene("{\"op\":\"awaitExit\",\"panel\":\"battlePanel\"}");
        Checks.eq("awaitExit 的面板进得了剧本", "battlePanel", s.steps.get(0).panel);
        Checks.check("awaitExit 回显了 panel", s.toJson().contains("\"panel\":\"battlePanel\""));
        // 场景那一侧**不回显 max**：回显一个走不到的数，读真值的人会当它是判据。
        Checks.check("场景的 awaitExit 不回显 max", !s.toJson().contains("\"max\""));

        // 另外四条无参指令进得了剧本 —— 少了这一条，"解析层认得它们"这件事没人验。
        for (String op : new String[] { "select", "confirm", "dismiss", "awaitSelect",
                                        "openBox", "awaitPresent" }) {
            TraceScript t = loadScene("{\"op\":\"" + op + "\"}");
            Checks.eq(op + " 进得了剧本", op, t.steps.get(0).op);
        }
    }

    // ---- 造一份只有一条指令的场景剧本 ----

    private static TraceScript loadScene(String step) {
        File f = null;
        try {
            f = File.createTempFile("scene-select-op", ".json");
            try (Writer w = new OutputStreamWriter(new FileOutputStream(f), StandardCharsets.UTF_8)) {
                w.write("{\"driver\":\"scene\",\"name\":\"probe\",\"scene\":\"宿舍.txt\",\"steps\":["
                        + step + "]}");
            }
            return TraceScript.load(f);
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new AssertionError("造探针剧本失败", e);
        } finally {
            if (f != null && !f.delete()) f.deleteOnExit();
        }
    }

    private static String readUtf8(File f) {
        try {
            return new String(java.nio.file.Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        } catch (java.io.IOException e) {
            throw new AssertionError("读不到 " + f.getPath() + " —— 要在仓库根目录跑", e);
        }
    }
}
