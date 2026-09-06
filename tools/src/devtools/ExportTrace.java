package devtools;

import java.awt.Graphics;
import java.awt.Image;
import java.awt.event.KeyEvent;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

import javax.imageio.ImageIO;
import javax.swing.Timer;

import main.GameLauncher;
import media.MusicPlayer;
import scene.NPC;
import scene.ScenePanel;
import tools.Clock;

/**
 * trace 导出器：在原版 Java 程序里执行一份声明式剧本，逐 tick 导出行为真值。
 *
 * 为什么需要它：状态层与视口层的票如果没有真值，测试就只能手写期望值 ——
 * 而写实现和写期望的会是同一个 agent、在同一个上下文窗口里。那样的测试会绿，
 * 而且是错的。这里导出的每一 tick 都来自原版自己跑出来的结果。
 *
 * 确定性从哪来（这是整件事唯一的技术难点）：
 *
 *   1. 时间。原版有 17 个 javax.swing.Timer 挂在真实时间上，外加一个
 *      Thread.sleep(10) 的主循环。真实时间不可重复。这里换成虚拟时钟：
 *      Clock.freezeTimers 让真实 TimerQueue 永不触发（把间隔整体推远 24 小时），
 *      再把每个 Timer 对象换成 VirtualTimer，由本类逐 tick 显式触发。
 *   2. 主循环。ScenePanel.run() 的循环体已提取为 ScenePanel.step()，
 *      本类每 tick 调一次，不起那个线程。
 *   3. 顺序。原版里按键在 EDT、定时器在 EDT、主循环在自己的线程上，
 *      三者的相对顺序本来就是竞态的。这里固定为
 *      **输入 → 定时器 → step() → paint()**，这个顺序就是 Web 侧要对齐的语义。
 *   4. 绘制。原版的 paint() 有副作用（对话里的 '@' / '$' 会改状态机），
 *      所以每 tick 真的调一次 paint()，画进一张离屏图，不省。
 *   5. 反射字段顺序。Class.getDeclaredFields() 的顺序未经规范保证，
 *      这里一律按字段名排序后再用。
 *
 * 用法: java devtools.ExportTrace <剧本.json> <输出.json> [--frames <目录> [--every <n>]]
 * 必须在仓库根目录运行（原版用相对路径读 script/、sources/、image/）。
 *
 * --frames 额外把**原版真的画出来的那张 1024×640 位图**（ScenePanel.backImage）
 * 每 n 个 tick 存一张 PNG，并写一份 frames.json 清单。这份清单是跨端逐帧比对
 * （xl-9bd.8）里"比哪些帧"的**唯一来源**：Web 侧照着同一组 tick 出图，
 * 两边帧数对不上就是硬失败，而不是各挑各的帧然后比个寂寞。
 */
public final class ExportTrace {

    /** 冻结基数：24 小时。真实 TimerQueue 在一次导出里绝无可能走到。 */
    private static final long FREEZE_BASE = 24L * 60 * 60 * 1000;

    private final TraceScript script;
    private final VirtualClock clock = new VirtualClock();
    private final List<VirtualTimer> timers = new ArrayList<>();
    private ScenePanel sp;
    private Graphics sink;

    // ---- 帧导出（--frames，默认关闭；关闭时下面两个字段一个都不读） ----
    private File framesDir;
    private int every = 25;
    private final List<Integer> sampled = new ArrayList<>();

    // ---- 剧本执行状态 ----
    private int ip;                 // 当前指令
    private boolean entered;        // 当前指令是否已初始化
    private int spent;              // 当前指令已消耗的 tick
    private int phase;              // 指令内阶段：walkTo/runTo 用 0=X 1=Y 2=收尾
    private int left;               // wait 剩余 tick / advance 剩余次数
    private int pressedKey = -1;    // 当前按住的方向键
    private int releaseAt;          // 松手的格子坐标
    private int legStart;           // 本段起点格子坐标（用于识别"被挡住"）
    private int lastLegPhase = -1;  // 上一段属于哪个轴，配合 legStart 判"没动"
    private int stallPos = Integer.MIN_VALUE;  // 上次观察到的当前轴坐标
    private int stallTicks;                    // 该坐标已经卡了多少 tick
    private final List<String> pending = new ArrayList<>();   // 本 tick 的输入事件

    private ExportTrace(TraceScript script) { this.script = script; }

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("用法: java devtools.ExportTrace <剧本.json> <输出.json> [--frames <目录> [--every <n>]]");
            System.exit(2);
        }
        File in = new File(args[0]);
        if (!in.isFile()) die("找不到剧本文件: " + in.getPath());
        if (!new File("script").isDirectory()) die("找不到 script/ 目录 —— 必须在仓库根目录运行");

        ExportTrace t = new ExportTrace(TraceScript.load(in));
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
        System.out.println("导出 " + t.script.name + " -> " + dst.getPath()
                + (t.framesDir == null ? "" : "（" + t.sampled.size() + " 帧 -> " + t.framesDir.getPath() + "）"));
        // 必须显式退出：音频播放线程与 Swing 的 TimerQueue 都不是守护线程。
        System.exit(0);
    }

    private static void die(String msg) {
        System.err.println("[ExportTrace] " + msg);
        System.exit(2);
    }

    private void fail(String msg) {
        String where = ip < script.steps.size()
                ? "第 " + ip + " 条指令 " + script.steps.get(ip).op
                : "剧本末尾";
        die(script.name + " · " + where + " · tick " + (clock.now() / script.tickMs) + "：" + msg);
    }

    // ================= 主流程 =================

    private String run() throws Exception {
        // 顺序要紧：冻结必须在任何一个 Timer 被 new 出来之前生效。
        // NPC 的两个定时器是在构造函数里 start() 的，而构造 NPC 之后
        // Dialogue 还要读 91 张头像图 —— 那期间足够真实定时器触发好几次。
        Clock.freezeTimers(FREEZE_BASE);
        // 背景音乐只取 currentPlayingBGM 这个可断言的值，不需要真的出声。
        //
        // 说清楚这个开关到底管什么：MusicPlayer.play() 根本不看 CAN_PLAY_BGM，
        // 它照样开 SourceDataLine、照样起一条非守护的播放线程；只有播放线程
        // 自己在第一次 write 之前会因为这个标志退出。currentPlayingBGM 在这
        // 一切之前就已经设好，所以 trace 里的值是准的。
        //
        // 未做结构性隔离的一处真实时间依赖：play() 开头有
        // while (!hasStop) { Clock.sleep(10); }。hasStop 初值为 true，而播放
        // 线程在开写前就退出，所以实测从未自旋（三份剧本各两遍导出逐字节一致）。
        // 但它确实取决于宿主机有没有音频设备 —— 真要做成结构性保证，得给
        // MusicPlayer 一个桩，那要改 src/，超出本票范围。
        media.MusicReader.closeBGM();
        MusicPlayer.CAN_PLAY_BGM = MusicPlayer.NO;

        sp = new ScenePanel(null);
        GameLauncher.scenePanel = sp;
        GameLauncher.currentPanel = sp;

        // 预热：96 个场景里有 20 个没有 Dialogue 段，它们依赖前一个场景残留的
        // dialogueEvent 对象才能跑；直接 initiation 进去会 NPE。
        if (script.warmup != null) sp.initiation(script.warmup);
        sp.initiation(script.scene);
        sp.isScript = script.isScript;

        sink = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB).getGraphics();
        prepareFramesDir();
        installTimers();

        StringBuilder body = new StringBuilder();
        int ticks = 0;
        boolean first = true;
        while (ip < script.steps.size()) {
            if (ticks >= script.maxTicks) fail("超过剧本的 maxTicks=" + script.maxTicks + "，剧本没有跑完");
            pending.clear();
            advanceScript();
            if (ip >= script.steps.size() && pending.isEmpty()) break;  // 最后一条指令在本 tick 之初就完成了

            fireTimers();
            sp.step();
            sp.paint(sink);

            if (!first) body.append(",\n");
            first = false;
            body.append("    ").append(snapshot(ticks));
            if (framesDir != null && ticks % every == 0) dumpFrame(ticks);

            clock.advance(script.tickMs);
            ticks++;
            installTimers();   // 场景可能在本 tick 里被重新初始化，新对象要接管
        }

        if (framesDir != null) writeFrameManifest(ticks);

        StringBuilder b = new StringBuilder();
        b.append("{\n");
        b.append("  \"format\": \"xianlin-trace/1\",\n");
        b.append("  \"script\": ").append(script.toJson()).append(",\n");
        b.append("  \"tickCount\": ").append(ticks).append(",\n");
        b.append("  \"ticks\": [\n").append(body).append("\n  ]\n");
        b.append("}\n");
        return b.toString();
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

    /** 把原版这一 tick 真的画出来的那张位图存成 PNG。 */
    private void dumpFrame(int tick) {
        Image img = sp.getBackImage();
        if (!(img instanceof BufferedImage)) {
            fail("ScenePanel.backImage 不是 BufferedImage（是 "
                    + (img == null ? "null" : img.getClass().getName()) + "），存不了 PNG");
        }
        BufferedImage b = (BufferedImage) img;
        if (b.getWidth() != ScenePanel.WIDTH || b.getHeight() != ScenePanel.HEIGHT) {
            fail("原版位图是 " + b.getWidth() + "×" + b.getHeight()
                    + "，应为 " + ScenePanel.WIDTH + "×" + ScenePanel.HEIGHT);
        }
        File f = new File(framesDir, String.format("f%06d.png", tick));
        try {
            if (!ImageIO.write(b, "png", f)) fail("这个 JDK 没有 PNG 编码器");
        } catch (java.io.IOException e) {
            fail("写不出 " + f.getPath() + "：" + e);
        }
        sampled.add(tick);
    }

    /**
     * 帧清单。它是跨端比对里"比哪些帧"的唯一来源 —— Web 侧读它，不自己算，
     * 两端各算各的采样点是错位的现成入口。
     */
    private void writeFrameManifest(int tickCount) {
        StringBuilder b = new StringBuilder();
        b.append("{\n");
        b.append("  \"format\": \"xianlin-frames/1\",\n");
        b.append("  \"script\": ").append(Json.str(script.name)).append(",\n");
        b.append("  \"scene\": ").append(Json.str(script.scene)).append(",\n");
        b.append("  \"tickMs\": ").append(script.tickMs).append(",\n");
        b.append("  \"width\": ").append(ScenePanel.WIDTH).append(",\n");
        b.append("  \"height\": ").append(ScenePanel.HEIGHT).append(",\n");
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
            fail("写不出 " + dst.getPath() + "：" + e);
        }
    }

    // ================= 定时器 =================

    /** 把对象图里所有还是原版 Timer 的字段换成 VirtualTimer；已换过的跳过。 */
    private void installTimers() {
        timers.clear();
        List<Object> roots = new ArrayList<>(Arrays.asList(
                sp.role, sp.dialogue, sp.narratage, sp.dialogueEvent, sp.roleEvent,
                sp.npcEvent, sp.otherEvent, sp.exitEvent, sp.fightEvent,
                sp.selectEvent, sp.equipmentEvent, sp.sal));
        if (sp.npcs != null) roots.addAll(sp.npcs);
        for (Object root : roots) {
            if (root == null) continue;
            for (Field f : sortedFields(root.getClass())) {
                if (!Timer.class.isAssignableFrom(f.getType())) continue;
                try {
                    Timer t = (Timer) f.get(root);
                    if (t == null) continue;
                    if (!(t instanceof VirtualTimer)) {
                        long logical = t.getDelay() - Clock.getFreezeBase();
                        if (logical <= 0 || logical > 10000) {
                            fail("定时器 " + root.getClass().getSimpleName() + "." + f.getName()
                                    + " 的间隔反算不出来（getDelay=" + t.getDelay()
                                    + "，冻结基数=" + Clock.getFreezeBase()
                                    + "）—— 说明它没走 tools.Clock.delay()");
                        }
                        t = new VirtualTimer(clock, (int) logical, t);
                        f.set(root, t);
                    }
                    timers.add((VirtualTimer) t);
                } catch (IllegalAccessException e) {
                    throw new RuntimeException(e);
                }
            }
        }
    }

    private void fireTimers() {
        for (VirtualTimer t : timers) {
            // 循环而非单发：万一 tick 步长大于某个定时器的间隔，也要把欠的补上。
            int guard = 0;
            while (t.fireIfDue(clock.now())) {
                if (++guard > 64) fail("定时器在一个 tick 内触发超过 64 次");
            }
        }
    }

    private static Field[] sortedFields(Class<?> c) {
        Field[] fs = c.getDeclaredFields();
        Arrays.sort(fs, Comparator.comparing(Field::getName));
        for (Field f : fs) f.setAccessible(true);
        return fs;
    }

    // ================= 剧本执行 =================

    private void advanceScript() {
        int guard = 0;
        while (ip < script.steps.size()) {
            if (++guard > 256) fail("指令在一个 tick 内空转");
            TraceScript.Instruction in = script.steps.get(ip);
            if (!entered) {
                entered = true;
                spent = 0;
                phase = 0;
                left = in.op.equals("wait") ? in.ticks
                     : in.op.equals("advance") ? in.times
                     : in.op.equals("advanceAll") ? in.max : 0;
                pressedKey = -1;
            }
            if (exec(in)) { ip++; entered = false; continue; }
            if (++spent > in.budget) {
                fail("超过本条指令的 tick 预算 " + in.budget + "（主角在 ("
                        + role().getX() + "," + role().getY() + ")）");
            }
            return;
        }
    }

    /** 返回 true 表示这条指令已完成。 */
    private boolean exec(TraceScript.Instruction in) {
        switch (in.op) {
            case "walkTo":     return moveTo(in, false);
            case "runTo":      return moveTo(in, true);
            case "talk":
                if (phase == 0) { pressSpace(); phase = 1; return false; }
                // 按下去没搭上话就得响。sayOral() 是同步的，按完这一 tick 就该
                // isOral=true；不拦的话，一次差一格的 walkTo 会导出一份干干净净、
                // 退出码 0、却一句对话都没有的 trace。
                if (!dialogueActive()) {
                    fail("按了空格但没有对话开始，主角在 (" + role().getX() + ","
                            + role().getY() + ") —— 旁边没有能搭话的 NPC");
                }
                return true;
            case "advance":
                if (left == 0) return true;
                if (!dialogueActive()) fail("对话在按满 " + in.times + " 次之前就结束了");
                if (!sentenceSettled()) return false;
                pressSpace(); left--; return false;
            case "advanceAll":
                if (!dialogueActive()) return true;
                if (left == 0) fail("按了 " + in.max + " 次空格对话仍未结束");
                if (!sentenceSettled()) return false;
                pressSpace(); left--; return false;
            case "wait":
                if (left <= 0) return true;
                left--; return false;
            case "waitIdle":
                return !roleMoving();
            case "waitNarratage":
                return getBool(sp.narratage, "narratageOver");
            default:
                fail("不认识的指令 " + in.op);
                return true;
        }
    }

    /**
     * 走/跑到目标格。先 X 后 Y。
     *
     * 松手的时机是这里唯一有讲究的地方。原版松手（keyReleased）只是把 canStop
     * 置位，主角要走到下一个"可停点"才真的停：走路每 4 次定时器触发 = 32px =
     * 恰好一格，跑步每 4 次 = 64px = 两格。所以"到了目标格再松手"必然多走一格。
     * 这里改成提前一格松手（跑步先跑到剩 3 格以内，再切走路收尾），
     * 每一段结束后重新判位，不对就再补一段 —— 补段总是 1 格且精确，必然收敛。
     *
     * 一段走完位置没变 = 被墙或 NPC 挡住 —— 硬失败。不能静默跳过：
     * "走不到就当走到了"会导出一份看上去正常、实际整条错位的 trace。
     */
    private boolean moveTo(TraceScript.Instruction in, boolean canRun) {
        while (true) {
            if (phase >= 2) return true;
            boolean axisX = phase == 0;
            int tgt = axisX ? in.x : in.y;

            if (pressedKey != -1) {
                // 按着方向键却一直不动 = 撞墙或撞 NPC，而且永远不会松手（松手条件
                // 是走到某一格）。这里不拦，最后只会报一句"超预算"，看不出是撞住了。
                // 阈值 150 tick = 1.5s：走一格要 32 tick，刚构造出来的 Role
                // 第一段要 64 tick，都远小于它。
                int now = axisPos(axisX);
                if (now == stallPos) {
                    if (++stallTicks > 150) {
                        fail("按着方向键 1.5 秒没挪窝，主角卡在 (" + role().getX() + ","
                                + role().getY() + ")，去不了 (" + in.x + "," + in.y + ") —— 被挡住了");
                    }
                } else {
                    stallPos = now;
                    stallTicks = 0;
                }
                if (now == releaseAt) { release(pressedKey); pressedKey = -1; }
                return false;
            }
            if (roleMoving()) return false;

            int cur = axisPos(axisX);
            if (cur == tgt) { phase++; continue; }
            if (cur == legStart && spent > 0 && phase == lastLegPhase) {
                fail("一段走完位置没变，(" + role().getX() + "," + role().getY()
                        + ") 到不了 (" + in.x + "," + in.y + ") —— 被挡住了");
            }

            int sign = tgt > cur ? 1 : -1;
            int dist = Math.abs(tgt - cur);
            boolean useRun = canRun && dist >= 4;
            int lead = useRun ? 3 : 1;
            releaseAt = tgt - sign * lead;
            legStart = cur;
            lastLegPhase = phase;
            stallPos = cur;
            stallTicks = 0;

            int key = axisX ? (sign > 0 ? KeyEvent.VK_RIGHT : KeyEvent.VK_LEFT)
                            : (sign > 0 ? KeyEvent.VK_DOWN  : KeyEvent.VK_UP);
            press(key, useRun);
            pressedKey = key;
            if (cur == releaseAt) { release(key); pressedKey = -1; }
            return false;
        }
    }

    private int axisPos(boolean axisX) { return axisX ? role().getX() : role().getY(); }

    // ================= 输入 =================

    private void press(int keyCode, boolean ctrl) {
        sp.keyPressed(keyCode, ctrl);
        pending.add("{\"e\":\"press\",\"k\":" + Json.str(keyName(keyCode)) + ",\"ctrl\":" + ctrl + "}");
    }

    private void release(int keyCode) {
        sp.keyReleased(keyCode);
        pending.add("{\"e\":\"release\",\"k\":" + Json.str(keyName(keyCode)) + "}");
    }

    private void pressSpace() { press(KeyEvent.VK_SPACE, false); }

    private static String keyName(int keyCode) {
        switch (keyCode) {
            case KeyEvent.VK_LEFT:  return "left";
            case KeyEvent.VK_RIGHT: return "right";
            case KeyEvent.VK_UP:    return "up";
            case KeyEvent.VK_DOWN:  return "down";
            case KeyEvent.VK_SPACE: return "space";
            default: return "vk" + keyCode;
        }
    }

    // ================= 状态读取 =================

    private scene.Role role() { return sp.role; }

    private boolean roleMoving() {
        return timerRunning(role(), "walk") || timerRunning(role(), "run");
    }

    private boolean dialogueActive() {
        return getBool(sp.npcEvent, "isOral") || getBool(sp.dialogueEvent, "isSpeaking");
    }

    /** 当前句已经逐字打完（或打满了整屏），可以按空格推进了。 */
    private boolean sentenceSettled() {
        return getBool(sp.dialogue, "isSentenceOver") || getBool(sp.dialogue, "isBufferedTextOver");
    }

    private boolean timerRunning(Object o, String name) {
        Timer t = (Timer) get(o, name);
        return t != null && t.isRunning();
    }

    private static Object get(Object o, String name) {
        Class<?> c = o.getClass();
        while (c != null) {
            try {
                Field f = c.getDeclaredField(name);
                f.setAccessible(true);
                return f.get(o);
            } catch (NoSuchFieldException e) {
                c = c.getSuperclass();
            } catch (IllegalAccessException e) {
                throw new RuntimeException(e);
            }
        }
        throw new RuntimeException("没有字段 " + name + " on " + o.getClass());
    }

    private static int getInt(Object o, String name)     { return (Integer) get(o, name); }
    private static boolean getBool(Object o, String name) { return (Boolean) get(o, name); }

    private static String bgm() {
        try {
            Field bf = media.MusicReader.class.getDeclaredField("background");
            bf.setAccessible(true);
            Object player = bf.get(null);
            return (String) get(player, "currentPlayingBGM");
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException(e);
        }
    }

    private static String dirName(int d) {
        switch (d) {
            case 0:  return "down";
            case 8:  return "up";
            case 16: return "left";
            case 24: return "right";
            default: return "d" + d;
        }
    }

    // ================= 快照 =================

    private String snapshot(int tick) {
        scene.Role r = role();
        Object oe = sp.otherEvent;

        StringBuilder b = new StringBuilder();
        b.append("{\"t\":").append(tick);
        b.append(",\"vt\":").append(clock.now());
        b.append(",\"ip\":").append(Math.min(ip, script.steps.size() - 1));
        b.append(",\"input\":[").append(String.join(",", pending)).append("]");

        b.append(",\"role\":{\"x\":").append(r.getX())
         .append(",\"y\":").append(r.getY())
         .append(",\"px\":").append(r.getRealX())
         .append(",\"py\":").append(r.getRealY())
         .append(",\"dir\":").append(Json.str(dirName(r.getDirection())))
         .append(",\"frame\":").append(r.getCount())
         .append(",\"running\":").append(r.isRun())
         .append(",\"moving\":").append(roleMoving())
         .append(",\"stepNum\":").append(r.stepNum)
         .append("}");

        b.append(",\"npcs\":[");
        for (int i = 0; i < sp.npcs.size(); i++) {
            NPC n = sp.npcs.get(i);
            if (i > 0) b.append(',');
            b.append("{\"x\":").append(n.getX())
             .append(",\"y\":").append(n.getY())
             .append(",\"px\":").append(getInt(n, "x"))
             .append(",\"py\":").append(getInt(n, "y"))
             .append(",\"type\":").append(n.getType())
             .append(",\"dir\":").append(n.getDirection())
             .append(",\"frame\":").append(n.getCount())
             .append("}");
        }
        b.append("]");

        Object dlg = sp.dialogue;
        boolean oral = getBool(sp.npcEvent, "isOral");
        boolean speaking = getBool(sp.dialogueEvent, "isSpeaking");
        b.append(",\"dialogue\":{\"active\":").append(oral || speaking)
         .append(",\"source\":").append(Json.str(oral ? "npc" : speaking ? "script" : "none"))
         .append(",\"type\":").append(getInt(dlg, "type"))
         .append(",\"head\":").append(getInt(dlg, "headNo"))
         .append(",\"name\":").append(Json.str((String) get(dlg, "name")))
         .append(",\"sentence\":").append(Json.str((String) get(dlg, "currentSentence")))
         .append(",\"cursor\":").append(getInt(dlg, "count_sentence"))
         .append(",\"row\":").append(getInt(dlg, "count_row"))
         .append(",\"col\":").append(getInt(dlg, "count_col"))
         .append(",\"printing\":").append(getBool(dlg, "isPrint"))
         .append(",\"sentenceOver\":").append(getBool(dlg, "isSentenceOver"))
         .append(",\"pageOver\":").append(getBool(dlg, "isBufferedTextOver"))
         .append("}");

        Object nar = sp.narratage;
        b.append(",\"narratage\":{\"active\":").append(getBool(nar, "isNarratage"))
         .append(",\"over\":").append(getBool(nar, "narratageOver"))
         .append(",\"line\":").append(getInt(nar, "count0"))
         .append(",\"cursor\":").append(getInt(nar, "count1"))
         .append(",\"row\":").append(getInt(nar, "count2"))
         .append(",\"bg\":").append(getInt(nar, "index"))
         .append("}");

        b.append(",\"audio\":{\"bgm\":").append(Json.str(bgm())).append("}");

        b.append(",\"viewport\":{\"offsetX\":").append(getInt(oe, "offsetX"))
         .append(",\"offsetY\":").append(getInt(oe, "offsetY"))
         .append(",\"firstTileX\":").append(getInt(oe, "firstTileX"))
         .append(",\"lastTileX\":").append(getInt(oe, "lastTileX"))
         .append(",\"firstTileY\":").append(getInt(oe, "firstTileY"))
         .append(",\"lastTileY\":").append(getInt(oe, "lastTileY"))
         .append("}");

        b.append(",\"drawOrder\":").append(Json.str(drawOrder()));
        return b.append("}").toString();
    }

    /**
     * 绘制顺序。ScenePanel.paint() 里那个局部变量 b：为真时先画 NPC 再画主角。
     * 判据在原版里是局部的，取不到，只能按同一个表达式重算一遍。
     *
     * 旁白期间返回 null：原版 paint() 里主角与 NPC 的绘制（连同那个局部变量）
     * 整个在 if (!narratage.isNarratage) 里面，这些帧根本没有绘制顺序这回事。
     * 照样填一个值，等于逼着 Web 侧为不画任何精灵的帧断言一个绘制顺序。
     */
    private String drawOrder() {
        if (getBool(sp.narratage, "isNarratage")) return null;
        scene.Role r = role();
        for (NPC n : sp.npcs) {
            if (r.getY() > n.getY() && r.getX() - 2 <= n.getX() && r.getX() + 1 >= n.getX()) {
                return "npcs-first";
            }
        }
        return "hero-first";
    }
}
