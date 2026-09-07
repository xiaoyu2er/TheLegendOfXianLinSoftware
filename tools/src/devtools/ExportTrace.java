package devtools;

import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import javax.imageio.ImageIO;

/**
 * trace 导出器：在原版 Java 程序里执行一份声明式剧本，逐步导出行为真值。
 *
 * 为什么需要它：状态层与视口层的票如果没有真值，测试就只能手写期望值 ——
 * 而写实现和写期望的会是同一个 agent、在同一个上下文窗口里。那样的测试会绿，
 * 而且是错的。这里导出的每一步都来自原版自己跑出来的结果。
 *
 * **本类不认识任何面板。** 它只通过 {@link TraceDriver} 那三件事工作：
 * 推进一步 / 快照可断言状态 / 快照这一步之后真的画出来的位图。确定性怎么来
 * （虚拟时钟、定时器替换、绘制副作用、反射字段顺序），归驱动器管 ——
 * 场景那一份见 {@link SceneDriver}。这里只管：剧本读进来、逐步跑、
 * 攒成 JSON、按采样率存帧、写帧清单。
 *
 * 一步是什么由驱动器定义：tick 驱动的场景一步 = 一个 tick，
 * 事件驱动的菜单/商店一步 = 一次输入事件。
 *
 * 用法: java devtools.ExportTrace <剧本.json> <输出.json> [--frames <目录> [--every <n>]]
 * 必须在仓库根目录运行（原版用相对路径读 script/、sources/、image/）。
 *
 * --frames 额外把**原版真的画出来的那张位图**每 n 步存一张 PNG，并写一份
 * frames.json 清单。这份清单是跨端逐帧比对（xl-9bd.8）里"比哪些帧"的
 * **唯一来源**：Web 侧照着同一组 tick 出图，两边帧数对不上就是硬失败，
 * 而不是各挑各的帧然后比个寂寞。
 */
public final class ExportTrace {

    private final File scriptFile;

    // ---- 剧本回显。由 run() 里选驱动器那一处按剧本类型填上。 ----
    private String scriptName = "?";
    private String scriptScene = "?";
    private int scriptTickMs;
    private String scriptJson = "null";
    private String driverKind = "?";

    // ---- 帧导出（--frames，默认关闭；关闭时下面这几个字段一个都不读） ----
    private File framesDir;
    private int every = 25;
    private final List<Integer> sampled = new ArrayList<>();
    private int frameW;
    private int frameH;

    private ExportTrace(File scriptFile) { this.scriptFile = scriptFile; }

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("用法: java devtools.ExportTrace <剧本.json> <输出.json> [--frames <目录> [--every <n>]]");
            System.exit(2);
        }
        File in = new File(args[0]);
        if (!in.isFile()) die("找不到剧本文件: " + in.getPath());
        if (!new File("script").isDirectory()) die("找不到 script/ 目录 —— 必须在仓库根目录运行");

        ExportTrace t = new ExportTrace(in);
        for (int i = 2; i < args.length; i++) {
            switch (args[i]) {
                case "--frames":
                    if (++i >= args.length) die("--frames 后面要跟目录");
                    t.framesDir = new File(args[i]);
                    break;
                case "--every":
                    if (++i >= args.length) die("--every 后面要跟正整数");
                    t.every = Integer.parseInt(args[i]);
                    if (t.every <= 0) die("--every 必须为正整数，收到 " + args[i]);
                    break;
                default:
                    die("不认识的参数 " + args[i]);
            }
        }
        String out = t.run();
        File dst = new File(args[1]);
        if (dst.getParentFile() != null) dst.getParentFile().mkdirs();
        try (Writer w = new OutputStreamWriter(new FileOutputStream(dst), StandardCharsets.UTF_8)) {
            w.write(out);
        }
        System.out.println("导出 " + t.scriptName + " -> " + dst.getPath()
                + (t.framesDir == null ? "" : "（" + t.sampled.size() + " 帧 -> " + t.framesDir.getPath() + "）"));
        // 必须显式退出：音频播放线程与 Swing 的 TimerQueue 都不是守护线程。
        System.exit(0);
    }

    static void die(String msg) {
        System.err.println("[ExportTrace] " + msg);
        System.exit(2);
    }

    // ================= 主流程 =================

    private String run() throws Exception {
        TraceDriver driver = pickDriver();
        String kind = requireKind(driver);
        driverKind = kind;
        prepareFramesDir();

        StringBuilder body = new StringBuilder();
        int steps = 0;
        while (driver.step()) {
            if (steps > 0) body.append(",\n");
            body.append("    ").append(driver.snapshotState(steps));
            if (framesDir != null && steps % every == 0) dumpFrame(driver, steps);
            steps++;
        }

        if (framesDir != null) writeFrameManifest(steps);

        StringBuilder b = new StringBuilder();
        b.append("{\n");
        b.append("  \"format\": \"xianlin-trace/1\",\n");
        b.append("  \"driver\": ").append(Json.str(kind)).append(",\n");
        b.append("  \"script\": ").append(scriptJson).append(",\n");
        b.append("  \"tickCount\": ").append(steps).append(",\n");
        b.append("  \"ticks\": [\n").append(body).append("\n  ]\n");
        b.append("}\n");
        return b.toString();
    }

    /**
     * 按剧本自报的 {@code driver} 选一支驱动器，顺手把剧本回显与帧清单要的
     * 那几个字段填上。**每接一个面板就在这里加一支**，不要顺手改成注册表 ——
     * 几张票并行时那种重构 git 合得干净、编译才报错（见 docs/agents/dispatch.md）。
     *
     * 缺 {@code driver} 字段时默认 {@code scene}：五份场景真值的剧本都是在这个
     * 字段之前写的，给它们补一个字段等于改剧本回显，五份真值要跟着重导。
     * 默认值是**唯一**的宽容之处 —— 认不出的名字一律硬失败，绝不猜。
     */
    private TraceDriver pickDriver() throws Exception {
        String want = JsonIn.strOr(
                JsonIn.obj(JsonIn.parse(new String(
                        java.nio.file.Files.readAllBytes(scriptFile.toPath()),
                        StandardCharsets.UTF_8)), "剧本"),
                "driver", "scene");
        switch (want) {
            case "scene": {
                TraceScript s = TraceScript.load(scriptFile);
                scriptName = s.name;
                scriptScene = s.scene;
                scriptTickMs = s.tickMs;
                scriptJson = s.toJson();
                return new SceneDriver(s);
            }
            case "battle": {
                // 战斗与场景共用 TraceScript —— 它按 driver 字段挑指令词汇那一套
                // （见 TraceScript 的类注释）。战斗没有场景文件，scene 为 null。
                TraceScript s = TraceScript.load(scriptFile);
                scriptName = s.name;
                scriptScene = s.scene;
                scriptTickMs = s.tickMs;
                scriptJson = s.toJson();
                return new BattleDriver(s);
            }
            case "menu": {
                MenuScript s = MenuScript.load(scriptFile);
                scriptName = s.name;
                // 菜单不是 tick 驱动的：一步是一次输入事件，没有时长。写 0 而不是
                // 编一个像模像样的 10 —— 帧清单里同时写着 driver，读的人分得开。
                scriptScene = "menu";
                scriptTickMs = 0;
                scriptJson = s.toJson();
                return new MenuDriver(s);
            }
            default:
                die(scriptFile.getPath() + " 的 driver 是 \"" + want
                        + "\"，导出器只认 scene / battle / menu");
                return null;
        }
    }

    /**
     * 驱动器的判别名，校验过再往真值头里写。
     *
     * 为什么要校验：这个字段是回放端"装配哪一套"的唯一依据。一个空串或者一个
     * 带空格、带大写的名字，写进 JSON 照样是合法 JSON，导出成功、退出码 0，
     * 而回放端要到几步之后才在别的地方失败 —— 又是一次"失败长得像成功"。
     * 这里只校形状，不校名单：名单维护在实现方，导出器不替它记。
     */
    private static String requireKind(TraceDriver driver) {
        String kind = driver.kind();
        if (kind == null || !kind.matches("[a-z][a-z0-9-]*")) {
            die(driver.getClass().getSimpleName() + ".kind() 返回了 "
                    + (kind == null ? "null" : "\"" + kind + "\"")
                    + "，判别名必须匹配 [a-z][a-z0-9-]*");
        }
        return kind;
    }

    // ================= 帧导出 =================

    /**
     * 清空帧目录里上一次的产物。
     *
     * 为什么非清不可：帧文件是按 tick 编号命名的，剧本变短之后旧的高位帧会**留在
     * 原地**，而比对器按清单读文件，读到的是一份"这一次根本没画过"的图。那种失败
     * 长得和成功一模一样（文件在、能解码、尺寸对），正是本项目最贵的那类坑。
     */
    private void prepareFramesDir() {
        if (framesDir == null) return;
        if (!framesDir.isDirectory() && !framesDir.mkdirs()) die("建不出帧目录 " + framesDir.getPath());
        File[] old = framesDir.listFiles();
        if (old != null) {
            for (File f : old) {
                if ((f.getName().endsWith(".png") || f.getName().equals("frames.json")) && !f.delete()) {
                    die("删不掉旧帧 " + f.getPath());
                }
            }
        }
    }

    /** 把驱动器这一步真的画出来的那张位图存成 PNG。尺寸校验在驱动器里。 */
    private void dumpFrame(TraceDriver driver, int tick) {
        BufferedImage b = driver.snapshotImage();
        File f = new File(framesDir, String.format("f%06d.png", tick));
        try {
            if (!ImageIO.write(b, "png", f)) die("这个 JDK 没有 PNG 编码器");
        } catch (java.io.IOException e) {
            die("写不出 " + f.getPath() + "：" + e);
        }
        sampled.add(tick);
        // 帧清单只写得下一个宽高。驱动器要是某一步换了张尺寸不同的图，不拦的话
        // 清单会拿最后一张的尺寸去描述前面所有帧 —— 比对器照着读，读到的是一份
        // 尺寸自称正确的错图，失败起来和成功一模一样。
        if (frameW == 0) {
            frameW = b.getWidth();
            frameH = b.getHeight();
        } else if (b.getWidth() != frameW || b.getHeight() != frameH) {
            die(scriptName + "：第 " + tick + " 帧是 " + b.getWidth() + "×" + b.getHeight()
                    + "，而第一帧是 " + frameW + "×" + frameH);
        }
    }

    /**
     * 帧清单。它是跨端比对里"比哪些帧"的唯一来源 —— Web 侧读它，不自己算，
     * 两端各算各的采样点是错位的现成入口。
     */
    private void writeFrameManifest(int tickCount) {
        // 一帧都没采到还照样写一份清单，等于交出一份"比 0 帧、全绿"的比对基准 ——
        // 那种失败长得和成功一模一样。宽高也只能从真存下来的那张图上取。
        if (sampled.isEmpty()) die(scriptName + "：开了 --frames 却一帧都没采到");
        StringBuilder b = new StringBuilder();
        b.append("{\n");
        b.append("  \"format\": \"xianlin-frames/1\",\n");
        b.append("  \"driver\": ").append(Json.str(driverKind)).append(",\n");
        b.append("  \"script\": ").append(Json.str(scriptName)).append(",\n");
        b.append("  \"scene\": ").append(Json.str(scriptScene)).append(",\n");
        b.append("  \"tickMs\": ").append(scriptTickMs).append(",\n");
        b.append("  \"width\": ").append(frameW).append(",\n");
        b.append("  \"height\": ").append(frameH).append(",\n");
        b.append("  \"every\": ").append(every).append(",\n");
        b.append("  \"tickCount\": ").append(tickCount).append(",\n");
        b.append("  \"ticks\": [");
        for (int i = 0; i < sampled.size(); i++) {
            if (i > 0) b.append(", ");
            b.append(sampled.get(i));
        }
        b.append("]\n}\n");
        File dst = new File(framesDir, "frames.json");
        try (Writer w = new OutputStreamWriter(new FileOutputStream(dst), StandardCharsets.UTF_8)) {
            w.write(b.toString());
        } catch (java.io.IOException e) {
            die(scriptName + "：写不出 " + dst.getPath() + "：" + e);
        }
    }
}
