package devtools;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Map;

/**
 * 钉住 {@link ExportTrace} 的取帧密度三层定夺（xl-6lo.3）：
 * 命令行 &gt; 剧本自报的 {@code every} &gt; {@link ExportTrace#DEFAULT_EVERY}。
 *
 * <h2>为什么这一处两条重导对比都看不见</h2>
 *
 * {@code tools/export-trace.sh} 从不传 {@code --frames}，所以密度对它导出的
 * trace.json **一个字节都不影响**（回显进头里的是剧本自报值，那一半确实被
 * {@code git diff tools/traces/out} 盯着）。真正会因为密度而变的东西是
 * frames.json 与那一堆 PNG，而它们整个目录都不入库
 * （{@code tools/.gitignore}）。于是：
 *
 * <ul>
 *   <li>把「剧本自报」这一层整个删掉 —— 两条重导对比全绿，跨端比对照跑，
 *       只是 {@code menu-magic} 又变回 2 帧、而 2 帧照样能打印"比过了"；
 *   <li>把「命令行压剧本」这一层反过来 —— 同上，全绿。
 * </ul>
 *
 * <h2>为什么不真跑一次导出</h2>
 *
 * 四支驱动器**一支都跑不起来**：{@code ScenePanel} / {@code MenuPanel} 建构造
 * 里就 {@code createCustomCursor}，在 {@code -Djava.awt.headless=true} 下当场
 * 抛 {@code HeadlessException}（2026-09-08 实测，scene 与 menu 各验一次）。
 * 而 {@code tools/test.sh} 那个 headless 开关是**故意**的（本地跑在 CI 的条件
 * 下）。所以这里钉的是定夺逻辑本身，加上「坏值必须在建驱动器之前就炸」——
 * 后者顺带把顺序也钉住了：真把密度挪到 pickDriver 之后，下面那三条子进程
 * 用例读到的就是 HeadlessException 而不是那句硬失败。
 *
 * 「密度真的被用在取样上」那一条由 {@code tools/compare-frames.sh} 的实测读数
 * 作证（menu-magic 不带参数 47 拍 47 帧），不在这套单测的射程里。
 */
public final class FrameEveryTest {

    private FrameEveryTest() {}

    public static void run() {
        precedence();
        declared();
        badValuesAreHardFailures();
    }

    /** 三层定夺。四种组合各一条，任何一层被抹掉都会有一条红。 */
    private static void precedence() {
        Checks.eq("两边都没给 → 兜底 25", 25, ExportTrace.resolveEvery(0, 0));
        Checks.eq("只有剧本自报 → 用剧本的", 7, ExportTrace.resolveEvery(0, 7));
        Checks.eq("只有命令行 → 用命令行的", 3, ExportTrace.resolveEvery(3, 0));
        // 这一条是整张表里唯一分得开「命令行赢」与「剧本赢」的：上面三条在
        // 两种实现下读数相同。
        Checks.eq("两边都给 → 命令行压掉剧本", 3, ExportTrace.resolveEvery(3, 7));
        // 兜底值不是这里手写的 25，而是导出器自己那个常量 —— 两处各写一个
        // 数字的话，改了一处另一处照样绿。
        Checks.eq("兜底值就是 ExportTrace.DEFAULT_EVERY",
                ExportTrace.DEFAULT_EVERY, ExportTrace.resolveEvery(0, 0));
    }

    /** 剧本自报值的读取：写了就读出来，没写是 0（而不是 25 —— 0 才分得开"没写"）。 */
    private static void declared() {
        Checks.eq("剧本写了 every 就读出来", 4,
                ExportTrace.declaredEvery(parse("{\"every\": 4}"), "探针"));
        Checks.eq("剧本没写 every 时返回 0（不是兜底值）", 0,
                ExportTrace.declaredEvery(parse("{\"name\": \"probe\"}"), "探针"));
        Checks.throwsWith("every 不是数字要炸", IllegalArgumentException.class, "应当是数字",
                new Runnable() {
                    @Override public void run() {
                        ExportTrace.declaredEvery(parse("{\"every\": \"1\"}"), "探针");
                    }
                });
    }

    /**
     * {@code 0} 与负数必须硬失败，而且要在**建驱动器之前**。
     *
     * 为什么这两个值不能"当没写"：{@code 0} 会让 {@code steps % every} 抛
     * ArithmeticException，负数则一帧都采不到 —— 而"采了 0 帧"与"采全了"
     * 在退出码上长得一模一样。
     */
    private static void badValuesAreHardFailures() {
        for (int bad : new int[] {0, -1, -25}) {
            Subprocess.Result r = runWithEvery(String.valueOf(bad));
            Checks.eq("剧本 every=" + bad + " 必须硬失败（" + r + "）", 2, r.exit);
            Checks.check("剧本 every=" + bad + " 的 stderr 要回显收到的值（" + r + "）",
                    r.err.contains("的 every 必须为正整数，收到 " + bad));
        }
        // 命令行那一半同样的形状。它和上面那半走的是两处不同的判断。
        Subprocess.Result cli = Subprocess.run("devtools.ExportTrace",
                probe("{\"name\": \"probe\"}").getPath(), "/dev/null", "--every", "0");
        Checks.eq("命令行 --every 0 必须硬失败（" + cli + "）", 2, cli.exit);
        Checks.check("命令行 --every 0 的 stderr 要说清（" + cli + "）",
                cli.err.contains("--every 必须为正整数，收到 0"));
    }

    private static Map<String, Object> parse(String json) {
        return JsonIn.obj(JsonIn.parse(json), "探针");
    }

    /** 写一份只带 every 的最小剧本，跑一遍导出器。 */
    private static Subprocess.Result runWithEvery(String every) {
        File script = probe("{\n  \"name\": \"probe\",\n  \"every\": " + every + ",\n  \"steps\": []\n}\n");
        return Subprocess.run("devtools.ExportTrace", script.getPath(), "/dev/null");
    }

    private static File probe(String json) {
        try {
            File dir = Files.createTempDirectory("xl-6lo-3-every").toFile();
            dir.deleteOnExit();
            File script = new File(dir, "probe.json");
            script.deleteOnExit();
            Files.write(script.toPath(), json.getBytes(StandardCharsets.UTF_8));
            return script;
        } catch (java.io.IOException e) {
            throw new IllegalStateException("写不出临时剧本", e);
        }
    }
}
