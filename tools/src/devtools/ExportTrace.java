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
 *
 * <h2>取帧密度谁说了算（xl-6lo.3）</h2>
 *
 * 那个 n 有三层，后面的盖前面的：{@link #DEFAULT_EVERY} → 剧本自报的
 * {@code every} → 命令行 {@code --every}。
 *
 * 为什么让剧本自报（正典在 {@code docs/trace-format.md} 菜单那一节，这里只留
 * 一句）：密度不是跑的人的偏好，是**剧本自己的性质**，而"记得敲 --every 1"
 * 不算判据 —— 忘了的样子和没忘一模一样。
 *
 * <b>回显进 trace 头的是剧本自报的那个值，不是最终生效的值。</b>
 * trace.json 必须与命令行怎么敲无关 —— {@code tools/compare-frames.sh} 会拿
 * 现导的 trace 与入库真值 {@code cmp}，写进生效值的话 {@code --every 5} 跑一次
 * 就会把那条 cmp 判成"原版侧行为已偏离"。
 */
public final class ExportTrace {

    private final File scriptFile;

    // ---- 剧本回显。由 run() 里选驱动器那一处按剧本类型填上。 ----
    private String scriptName = "?";
    private String scriptScene = "?";
    private int scriptTickMs;
    private String scriptJson = "null";
    private String driverKind = "?";

    /** 剧本没自报、命令行也没给时的兜底取帧密度。 */
    static final int DEFAULT_EVERY = 25;

    // ---- 帧导出（--frames，默认关闭；关闭时下面这几个字段一个都不读） ----
    private File framesDir;
    /** 命令行 {@code --every} 给的值；没给是 0。 */
    private int everyFromCli;
    /** 剧本自报的值；没自报是 0。回显进 trace 头的是它。 */
    private int everyFromScript;
    /** 真正生效的密度，{@link #resolveEvery} 定夺。 */
    private int every = DEFAULT_EVERY;
    private final List<Integer> sampled = new ArrayList<>();
    /** 与 {@link #sampled} 逐项对应的账本（一个 JSON 对象一项），见 {@link #ledgerEntry()}。 */
    private final List<String> ledger = new ArrayList<>();
    private int frameW;
    private int frameH;

    private ExportTrace(File scriptFile) { this.scriptFile = scriptFile; }

    public static void main(String[] args) throws Exception {
        // 导出真值时一律静音。理由分两半：
        //
        // - **BGM** 本来就是关的：三个驱动器各自在建面板之前调 closeBGM() 并把
        //   CAN_PLAY_BGM 设成 NO。这里再设一次只是把它提前到任何驱动器之前，
        //   顺手覆盖将来新增的驱动器。
        // - **音效**（CAN_PLAY_MUSIC）此前只有 MenuDriver 关过（它必须关，
        //   否则每次点击都开音频设备、起播放线程，两遍导出不可能逐字节一致）。
        //   场景与战斗没关，于是每跑一次流水线就响一次 —— 并行派工时三四个
        //   agent 同时跑，对用这台机器的人干扰很明显。
        //
        // 这不影响真值：没有任何一个真值字段观察音效状态。实测过——把两个开关
        // 关掉重导，当时的 7 份真值与入库的**逐字节一致 7/7**。
        //
        // 与 xl-1vu.8 的关系：那张票讲的是「菜单/商店真值记不到音效文件名」，因为
        // playmusic 里 filename=name 的赋值落在 CAN_PLAY_MUSIC 判断**里面**。
        // 关死开关不是挡了它——那条路本来就走不通，.8 换的是观察点：
        // MusicReader.readmusic 的入口（tools.MusicLog / devtools.MusicTap）。
        // 所以下面这两行照旧关死，而 menu / shop 真值里的 music 字段照样是满的。
        media.MusicPlayer.CAN_PLAY_MUSIC = media.MusicPlayer.NO;
        media.MusicPlayer.CAN_PLAY_BGM = media.MusicPlayer.NO;

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
                    t.everyFromCli = Integer.parseInt(args[i]);
                    if (t.everyFromCli <= 0) die("--every 必须为正整数，收到 " + args[i]);
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
        // 剧本只在这里读一遍原始 JSON：driver 与 every 都是「导出器自己要看」的
        // 字段，四个剧本类都不认识它们。
        java.util.Map<String, Object> root = JsonIn.obj(JsonIn.parse(new String(
                java.nio.file.Files.readAllBytes(scriptFile.toPath()),
                StandardCharsets.UTF_8)), "剧本");
        // 密度在建驱动器**之前**定夺，坏值也在这里就炸：一份写着 "every": 0 的
        // 剧本要在跑起来之前非零退出，而不是先跑 47 步再发现一帧都没采到。
        everyFromScript = declaredEvery(root, scriptFile.getPath());
        every = resolveEvery(everyFromCli, everyFromScript);

        TraceDriver driver = pickDriver(root);
        String kind = requireKind(driver);
        driverKind = kind;
        prepareFramesDir();

        StringBuilder body = new StringBuilder();
        int steps = 0;
        while (driver.step()) {
            // 音效真值的取样时机，四支驱动器共用这一处（xl-1vu.11）。
            //
            // 这里就是「paint 之后」：面板的 paint 发生在 step() 里面，而 step()
            // 已经返回。原版的 paint 真的出声 —— EquipPanel.drawWarning() 里两处
            // readmusic("禁止.wav")，menu-equip 的 t=6 / t=10 那两声就是它打的。
            // 挪到 step() 之前，那两声会整体错位到下一步。
            //
            // 也必须在 snapshotState 之前：那一行 music 字段读的就是这里取走的那批。
            // 与它相反的另一个时机（拒绝标志要在 paint **之前**抓，因为 drawWarning
            // 出声的同一段就把标志清零了）留在驱动器自己手里 —— 只有它知道自己
            // paint 的是哪个面板。两个时机相反，所以刻意不并成一处。
            if (MusicTap.armed()) MusicTap.afterStep();
            if (steps > 0) body.append(",\n");
            body.append("    ").append(driver.snapshotState(steps));
            if (framesDir != null && steps % every == 0) dumpFrame(driver, steps);
            steps++;
        }

        // 剧本正常跑完这一条出口上才验（跑爆 maxSteps 的驱动器直接非零退出，
        // 走不到这里 —— 那是对的，maxSteps 那条失败更响，先报它）。
        if (MusicTap.armed()) MusicTap.requireRecorded();

        if (framesDir != null) writeFrameManifest(steps);

        StringBuilder b = new StringBuilder();
        b.append("{\n");
        b.append("  \"format\": \"xianlin-trace/1\",\n");
        b.append("  \"driver\": ").append(Json.str(kind)).append(",\n");
        // 只在剧本真的自报了的时候写这一行。缺省不写：一个恒有的字段会让**每一份**
        // 真值都多一行，等于把一次「谁都没改」的重导做成一次全量 diff。
        if (everyFromScript > 0) {
            b.append("  \"every\": ").append(everyFromScript).append(",\n");
        }
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
    private TraceDriver pickDriver(java.util.Map<String, Object> root) throws Exception {
        String want = JsonIn.strOr(root, "driver", "scene");
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
            case "shop": {
                ShopScript s = ShopScript.load(scriptFile);
                scriptName = s.name;
                // 商店与菜单一样不是 tick 驱动的：一步是一次输入事件，没有时长。
                scriptScene = "shop";
                scriptTickMs = 0;
                scriptJson = s.toJson();
                return new ShopDriver(s);
            }
            case "saveload": {
                SaveLoadScript s = SaveLoadScript.load(scriptFile);
                scriptName = s.name;
                // 存读档面板同菜单：一步是一次输入事件，没有时长。
                scriptScene = "saveload";
                scriptTickMs = 0;
                scriptJson = s.toJson();
                return new SaveLoadDriver(s);
            }
            case "end": {
                EndScript s = EndScript.load(scriptFile);
                scriptName = s.name;
                scriptScene = "end";
                // 结局是 tick 驱动的：一拍 = EndPanel.run() 循环体一次，那一句是
                // Clock.sleep(100)。剧本里 key / wake 那几步不是拍，不推时间。
                scriptTickMs = 100;
                scriptJson = s.toJson();
                return new EndDriver(s);
            }
            default:
                die(scriptFile.getPath() + " 的 driver 是 \"" + want
                        + "\"，导出器只认 scene / battle / menu / shop / saveload / end");
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
    // 包内可见（不是 private）：tools/test 下的 RequireKindProbe 要够得着它。
    // 这个校验在真实导出里一次都走不到 —— 现有每一支驱动器的 kind() 都是写死的
    // 合法字面量（2026-09-08 读数；有几支不写在这里，CLAUDE.md 说这个数过期过两次）
    // —— 所以它的红只可能来自测试，而它守的正是「将来新增一支驱动器报了个坏名字」。
    // 见 docs/java-side-test-gap.md 缺口表第 10 行。
    static String requireKind(TraceDriver driver) {
        String kind = driver.kind();
        if (kind == null || !kind.matches("[a-z][a-z0-9-]*")) {
            die(driver.getClass().getSimpleName() + ".kind() 返回了 "
                    + (kind == null ? "null" : "\"" + kind + "\"")
                    + "，判别名必须匹配 [a-z][a-z0-9-]*");
        }
        return kind;
    }

    // ================= 取帧密度 =================

    /**
     * 剧本自报的取帧密度，没自报返回 0。
     *
     * 包内可见：{@code tools/test} 下的 {@code FrameEveryTest} 要够得着它。
     *
     * <b>0 与负数是硬失败，不是"当没写"。</b> {@code "every": 0} 会让
     * {@code steps % every} 直接 ArithmeticException，而 {@code -1} 会让
     * 一帧都采不到 —— 后者更坏：它走到 writeFrameManifest 才被拦下来，
     * 而在这个字段还没有人核的时候，"采了 0 帧"与"采全了"在退出码上一模一样。
     */
    static int declaredEvery(java.util.Map<String, Object> root, String where) {
        if (root.get("every") == null) return 0;
        int n = JsonIn.i(root, "every");
        if (n <= 0) die(where + " 的 every 必须为正整数，收到 " + n);
        return n;
    }

    /**
     * 三层里谁说了算：命令行 &gt; 剧本自报 &gt; {@link #DEFAULT_EVERY}。
     *
     * 命令行在最上面是**为了能压掉剧本**：调密一点看某一段、调稀一点快跑一趟，
     * 都不该逼人去改剧本文件（改了就得重导真值）。剧本在缺省之上，是因为
     * 缺省 25 对事件驱动的剧本从来就不对。
     *
     * @param fromCli    命令行给的，没给传 0
     * @param declared   剧本自报的，没自报传 0
     */
    static int resolveEvery(int fromCli, int declared) {
        if (fromCli > 0) return fromCli;
        if (declared > 0) return declared;
        return DEFAULT_EVERY;
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
        ledger.add(ledgerEntry());
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
     * 这一帧此刻的**账本**（xl-03x.3）：{@code Money.getCoins()} 与
     * {@code DrugPack.drugList} 各药的件数。两样都是原版的 static，不归哪个面板，
     * 所以在导出器这一处取、四支驱动器都记；比对器目前只对撞场景那一支。
     *
     * <p>为什么要它。答题加扣金币、开箱进背包这两笔账**只由 Web 的会话层记**，
     * 行为真值（trace.json）一个字都不记 —— 场景快照里没有金币与药包；而逐帧比对
     * 的金币数字那一格是字形缺口区，只查上界：答题之前两端都是 10000 时字形差就有
     * 559 个像素，数值不同的帧并不比它多（2026-09-11 实测）。于是「数错了」在
     * 两条现有判据下都是绿的。这份账本让比对器逐帧拿原版的数去撞取图页的数。
     *
     * <p>⚠️ 它是 M8 的**第二道**新缝（SPEC 只预算了一道），仅测试用：只在
     * {@code --frames} 时写，落在不入库的帧清单里，**不进 trace.json**。进 trace.json
     * 等于改真值格式、全部场景真值重导，而这两个数在真值层没有别的读者。
     */
    private static String ledgerEntry() {
        StringBuilder b = new StringBuilder();
        b.append("{\"coins\":").append(shop.Money.getCoins()).append(",\"drugs\":[");
        List<shop.Drug> drugs = shop.DrugPack.drugList;
        for (int i = 0; i < drugs.size(); i++) {
            if (i > 0) b.append(',');
            b.append("{\"name\":").append(Json.str(drugs.get(i).getName()))
             .append(",\"count\":").append(drugs.get(i).getNumberGOT()).append('}');
        }
        b.append("]}");
        return b.toString();
    }

    /**
     * 帧清单。它是跨端比对里"比哪些帧"的唯一来源 —— Web 侧读它，不自己算，
     * 两端各算各的采样点是错位的现成入口。
     */
    private void writeFrameManifest(int tickCount) {
        // 一帧都没采到还照样写一份清单，等于交出一份"比 0 帧、全绿"的比对基准 ——
        // 那种失败长得和成功一模一样。宽高也只能从真存下来的那张图上取。
        if (sampled.isEmpty()) die(scriptName + "：开了 --frames 却一帧都没采到");
        // 采样点必须是 0, every, 2*every, … —— 独立于上面那句 steps % every == 0
        // 重算一遍。它守的是"密度定夺完了，取样却用了别的数"：dumpFrame 的条件
        // 里换成 DEFAULT_EVERY、或者少加一层覆盖，帧数看着仍然像模像样（还是
        // 一份合法清单、还是一堆能解码的 PNG），而 frames.json 整个目录不入库，
        // 没有任何 git diff 会说话。实测：把那个条件换成 DEFAULT_EVERY，
        // menu-magic 当场 exit=2 并说"第 1 张采在第 25 步，按密度 1 应当是第 1 步"。
        for (int i = 0; i < sampled.size(); i++) {
            int want = i * every;
            if (sampled.get(i) != want) {
                die(scriptName + "：第 " + i + " 张采在第 " + sampled.get(i)
                        + " 步，按密度 " + every + " 应当是第 " + want + " 步");
            }
        }
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
        b.append("],\n");
        b.append("  \"ledger\": [");
        for (int i = 0; i < ledger.size(); i++) {
            if (i > 0) b.append(", ");
            b.append(ledger.get(i));
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
