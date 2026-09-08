package devtools;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * 钉住 {@link ExportTrace} 的驱动器分派：**认不出的名字必须硬失败**。
 *
 * 缺口表第 7 行，七处里最贵的一处。把那个 {@code default:} 分支从
 * {@code die(...)} 换成静默回落 scene，两条重导对比都是绿的 —— 它导出的是一份
 * **看起来完全正常**的真值：退出码 0、JSON 合法、{@code --check} 两次逐字节一致。
 * 而 {@code ExportTrace} 的类注释白纸黑字写着「默认值是**唯一**的宽容之处 ——
 * 认不出的名字一律硬失败，绝不猜」。这条承诺此前没有任何东西在核。
 *
 * 测法是子进程，理由见 {@link Subprocess} 的类注释。
 *
 * <p>这里**只测拒绝那一半**：每个合法名字都会真的把面板建起来（battle 那条要
 * Swing 组件、要 {@code --add-opens}），那是重导对比每天在跑的事，不是这套单测
 * 该承担的。合法名字走得通，由 {@code tools/traces/out/} 下每一份真值的
 * {@code driver} 字段作证 —— 合法名字有几个不写在这里，读
 * {@code ExportTrace.pickDriver} 的 case 标签。
 */
public final class PickDriverTest {

    private PickDriverTest() {}

    /**
     * 每一条都是「写进 JSON 照样合法」的坏名字。尾随空格与大小写那两条尤其要有：
     * 它们最像对的，也最容易被一个「宽容一点」的实现放过去。
     */
    private static final String[] BAD = {"nope", "", "Scene", "SCENE", "scene ", " scene", "sce ne", "battle2"};

    public static void run() {
        for (String d : BAD) {
            Subprocess.Result r = runWithDriver(d);
            Checks.eq("driver \"" + d + "\" 必须硬失败（" + r + "）", 2, r.exit);
            Checks.check("driver \"" + d + "\" 的 stderr 要回显收到的名字",
                    r.err.contains("的 driver 是 \"" + d + "\""));
            Checks.check("driver \"" + d + "\" 的 stderr 要说清认得哪几个",
                    r.err.contains("只认"));
        }

        // 缺字段默认 scene —— 导出器**唯一**的宽容之处（五份场景剧本至今没有这个
        // 字段，给它们加上会改变剧本回显、逼一次全量重导）。
        //
        // 不把场景真的跑起来（那要 Swing，还要一份完整剧本），而是给一份**故意
        // 缺 scene 字段**的剧本：走进 scene 那一支就会在 TraceScript.load 上当场
        // 报「缺少字符串字段 scene」。这比「没有报错」有分辨力得多 —— 一个
        // 「什么都没发生」的通过条件，正是这个仓库最怕的形状。
        Subprocess.Result noField = runWithDriver(null);
        Checks.check("缺 driver 字段时不许报「认不出」（" + noField + "）",
                !noField.err.contains("的 driver 是"));
        Checks.check("缺 driver 字段时确实走进了 scene 那一支（" + noField + "）",
                noField.err.contains("缺少字符串字段 scene"));
        // 写死 1 而不是「不等于 2」：「不等于某个值」是个弱形状，一堆别的
        // 出错方式都能满足它。1 是实测值（未捕获异常从 main 里冒出去，JVM 退 1）。
        Checks.eq("退出码是异常冒泡的 1，不是硬失败的 2（" + noField + "）",
                1, noField.exit);
    }

    /** 写一份最小剧本到临时文件，driver 为 null 表示整个字段都不写。 */
    private static Subprocess.Result runWithDriver(String driver) {
        try {
            File dir = Files.createTempDirectory("xl-f8y-pickdriver").toFile();
            File script = new File(dir, "probe.json");
            File out = new File(dir, "out.json");
            String json = "{\n"
                    + "  \"name\": \"probe\",\n"
                    + (driver == null ? "" : "  \"driver\": " + Json.str(driver) + ",\n")
                    // driver 缺失那一场故意也不写 scene —— 见 run() 里的说明。
                    + (driver == null ? "" : "  \"scene\": \"宿舍.txt\",\n")
                    + "  \"tickMs\": 10,\n"
                    + "  \"maxTicks\": 1,\n"
                    + "  \"steps\": []\n"
                    + "}\n";
            Files.write(script.toPath(), json.getBytes(StandardCharsets.UTF_8));
            try {
                return Subprocess.run("devtools.ExportTrace", script.getPath(), out.getPath());
            } finally {
                script.delete();
                out.delete();
                dir.delete();
            }
        } catch (java.io.IOException e) {
            throw new IllegalStateException("写不出临时剧本", e);
        }
    }
}
