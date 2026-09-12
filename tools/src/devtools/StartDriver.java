package devtools;

import java.awt.Graphics;
import java.awt.Image;
import java.awt.event.MouseEvent;
import java.awt.event.MouseListener;
import java.awt.event.MouseMotionListener;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.io.UnsupportedEncodingException;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;

import main.GameLauncher;
import media.MusicPlayer;
import media.MusicReader;
import scene.ScenePanel;
import start.StartPanel;
import tools.Clock;

/**
 * 标题页（{@code start.StartPanel}）的驱动器，第七支（xl-whk）。
 *
 * <h2>一步 = 一拍，或者一次鼠标事件</h2>
 *
 * 时间的唯一来源是构造函数里 {@code startAnimationThread()} 起的那条匿名线程：
 * {@code while(true){ Clock.sleep(100); 推鼠标 / 五圈高亮 / 两段卷轴 / 云 / 两段载入 / 两个表; repaint(); }}。
 * 那段循环体**不在任何一个能调的方法里**（它就写在匿名 {@code Thread.run()} 里），所以本类不去
 * 誊抄它 —— 誊抄一份就是驱动器自己给自己签字。做法与 {@link EndDriver} 的 {@code wake}
 * 同一套：时钟冻住（倍率 1e-9，{@code sleep(100)} ≈ 3170 年），每一拍把那条真线程
 * {@code interrupt()} 一次，原版的 catch 打一行栈、**走一整圈原版自己的循环体**、
 * {@code repaint()}、再睡回去；驱动器等它睡回去，再在导出线程上调一次 {@code paint()}。
 *
 * <p>「走完一圈」认两件事：err 里出现那一行 {@code InterruptedException}，以及
 * {@code repaint()} 计数加一（那是循环体的最后一句；计数是 volatile，读到它就读得到循环体
 * 里写下的每一个字段）—— 然后线程栈顶重新是 {@code Thread.sleep}。三件缺一件都不算。
 *
 * <p>鼠标：原版在构造函数里 {@code addMouseListener} / {@code addMouseMotionListener} 各挂一个
 * 匿名适配器。本类把**那两个对象本身**取出来，直接调它们的 {@code mousePressed} /
 * {@code mouseReleased} / {@code mouseMoved} —— 命中判定（那个往左上挪 (15,6) 的开区间）、
 * 按下与松开的先后（{@code setButton()} 在 {@code isRelesedButton} 之前）全是原版自己的。
 *
 * <h2>paint() 改状态，所以谁画、什么时候画要写清楚</h2>
 *
 * 与战斗面板相反（bd memory {@code battle-paint-no-side-effect}），这个面板的过场全长在
 * {@code paint()} 里：卷轴播完一循环 → {@code isUnfolded} 翻真 → {@code startButtonAction()}；
 * 表到点 → {@code startLoadAction()} → {@code switchTo}。所以画几次就是推几次状态。
 * 原版里 {@code repaint()} **只有那条线程在调**（三个监听器一句都没有），于是这里只在 tick
 * 步上画、每拍恰好一次；输入步不画，位图停在上一拍 —— 与原版「移上去之后下一拍才换图」一致。
 * 真窗口里 Swing 会合并 repaint、偶尔少画一次，这里取的是「每拍一次」这个理想，
 * 与 web 侧 {@code tickStartPanel} 的一拍两段同一个模型。
 *
 * <h2>起手：只立标题页，外加一块场景面板等「起」来切</h2>
 *
 * 原版进标题走 {@code switchTo("start")}，那一支 {@code Clock.sleep(1000)} 在冻结倍率下会挂死
 * 导出、{@code openBGM()} 会真的开音频设备 —— 所以不走它，只照它的效果把
 * {@code currentPanel} 设成标题页。「起」的收尾（{@code startLoadAction} case 0）要
 * {@code GameLauncher.scenePanel}：先 {@code switchTo("scene")}、再
 * {@code scenePanel.initiation("脚本1.txt")}、再给它起一条线程 —— 那条线程头一件事是
 * {@code step()} 一次，然后睡进冻住的 {@code sleep(10)}。它推的东西不进这份真值。
 * 「承」的收尾要 {@code lsPanel}，这里没立：走到那一支会 NPE 在原版的 paint 里，
 * 驱动器当场硬失败（见 {@link #tick}）。
 */
public final class StartDriver implements TraceDriver {

    /** 冻结基数：24 小时。与另外几支一致。 */
    private static final long FREEZE_BASE = 24L * 60 * 60 * 1000;

    /** 时间缩放倍率。{@code Clock.ms(100)} = 10^11 ms ≈ 3170 年。 */
    private static final double SLOW = 1e-9;

    /** 等真线程睡下去 / 走完一圈的上限。超了是硬失败。 */
    private static final long WAIT_MS = 5000;

    /** 五颗按钮在原版里的字段名，也是真值里的键。顺序照 {@code initialButtons()}。 */
    private static final String[] BUTTONS = { "start", "load", "about", "end", "back" };

    private final StartScript script;
    private TapStartPanel sp;
    private PanelTap tap;
    private Thread loop;
    private MouseListener mouse;
    private MouseMotionListener motion;
    private Graphics sink;

    private final List<String> pending = new ArrayList<>();
    /** 本步拦截到的面板切换（卡片名）。 */
    private String card;
    /** 屏幕上现在是哪张卡片：最后一次被 show 的那个名字；起手是标题页。 */
    private String shown = "startPanel";

    private int ip;
    private int at;
    private int sub;
    private int steps;
    private boolean started;

    StartDriver(StartScript script) { this.script = script; }

    @Override
    public String kind() { return "start"; }

    private void fail(String msg) {
        String where = ip < script.steps.size()
                ? "第 " + ip + " 条指令 " + script.steps.get(ip).op
                : "剧本末尾";
        ExportTrace.die(script.name + " · " + where + " · 第 " + steps + " 步：" + msg);
    }

    /**
     * 标题页，{@code repaint()} 换成只计数。这个面板从没被加进任何窗口，原版的 {@code repaint()}
     * 在这里本来就画不出东西；每拍真正的绘制由驱动器调 {@code paint()}。计数是「循环体走完了」
     * 的读数，见类注释。
     */
    static final class TapStartPanel extends StartPanel {
        private static final long serialVersionUID = 1L;
        volatile int repaints;
        @Override
        public void repaint() { repaints++; }
    }

    // ================= 推进一步 =================

    @Override
    public boolean step() {
        if (!started) { start(); started = true; }
        if (ip >= script.steps.size()) return false;
        if (steps >= script.maxSteps) fail("超过剧本的 maxSteps=" + script.maxSteps + "，剧本没有跑完");
        if (!"startPanel".equals(shown)) {
            fail("标题页已经不在屏幕上了（上一步切到了 " + shown + "），后面的指令读不出标题页的任何东西");
        }
        pending.clear();
        card = null;
        int tapBefore = tap.count();

        at = ip;
        StartScript.Instruction in = script.steps.get(ip);
        switch (in.op) {
            case "tick":    tick(in); break;
            case "move":    motion.mouseMoved(event(MouseEvent.MOUSE_MOVED, in)); input("move", in); break;
            case "press":   mouse.mousePressed(event(MouseEvent.MOUSE_PRESSED, in)); input("press", in); break;
            case "release": mouse.mouseReleased(event(MouseEvent.MOUSE_RELEASED, in)); input("release", in); break;
            default:        fail("不认识的指令 " + in.op);
        }

        int switched = tap.count() - tapBefore;
        if (switched > 1) fail("一步里切了 " + switched + " 次面板 —— 观察点只记得住最后一次（" + tap.card() + "）");
        if (switched == 1) { card = tap.consume(); shown = card; }

        if (++sub >= in.times) { ip++; sub = 0; }
        steps++;
        return true;
    }

    private void input(String e, StartScript.Instruction in) {
        pending.add("{\"e\":" + Json.str(e) + ",\"x\":" + in.x + ",\"y\":" + in.y + "}");
    }

    /** 事件源与时间戳不被读：原版三个监听器只看 {@code getX()} / {@code getY()}。 */
    private MouseEvent event(int id, StartScript.Instruction in) {
        int button = id == MouseEvent.MOUSE_MOVED ? MouseEvent.NOBUTTON : MouseEvent.BUTTON1;
        return new MouseEvent(sp, id, 0L, 0, in.x, in.y, 1, false, button);
    }

    /** 一拍：叫醒原版线程走一圈循环体，再画一次。expect 见 {@link StartScript}。 */
    private void tick(StartScript.Instruction in) {
        boolean last = sub == in.times - 1;
        if (sub == 0 && in.expect != null && reached(in.expect)) {
            fail("expect=" + in.expect + "，可这条指令还没推第一拍就已经成立了");
        }
        loopOnce();
        sp.paint(sink);
        pending.add("{\"e\":\"tick\"}");
        if (in.expect != null) {
            boolean now = reached(in.expect);
            if (now && !last) fail("expect=" + in.expect + " 在第 " + (sub + 1) + " 拍就成立了，比剧本写的 " + in.times + " 拍早 —— 拍数推错了");
            if (!now && last) fail("expect=" + in.expect + "，推满 " + in.times + " 拍还没成立 —— 拍数推错了");
        }
    }

    /** 这一拍之后 expect 成立了没有。switch 看的是这条指令开头以来观察点有没有动。 */
    private boolean reached(String expect) {
        switch (expect) {
            case "unfold": return getBool(sp, "isUnfolded");
            case "fold":   return !getBool(sp, "isUnfolded");
            case "switch": return tap.card() != null;
            default:       fail("不认识的 expect " + expect); return false;
        }
    }

    /**
     * 把原版那条线程叫醒一次，等它走完一整圈循环体、再睡回 {@code Thread.sleep}。
     * 认法见类注释。线程死了（循环体里抛了异常 —— 比如「承」那一支的 NPE）是硬失败。
     */
    private void loopOnce() {
        int r = sp.repaints;
        PrintStream saved = System.err;
        ByteArrayOutputStream cap = new ByteArrayOutputStream();
        try {
            System.setErr(new PrintStream(cap, true, "UTF-8"));
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
        boolean done;
        try {
            loop.interrupt();
            long deadline = System.currentTimeMillis() + WAIT_MS;
            while (true) {
                boolean printed = cap.toString().contains("InterruptedException");
                if (!loop.isAlive()) { done = false; break; }
                if (printed && sp.repaints != r && sleepingInLoop(loop)) { done = true; break; }
                if (System.currentTimeMillis() > deadline) { done = false; break; }
                Thread.yield();
            }
        } finally {
            System.setErr(saved);
        }
        if (!loop.isAlive()) fail("原版那条线程死了（err 缓冲：" + cap + "）");
        if (!done) fail("叫醒原版线程之后 " + WAIT_MS + " ms 内它没走完一圈（err 缓冲：" + cap + "）");
        if (sp.repaints - r != 1) fail("一圈循环体里 repaint() 被调了 " + (sp.repaints - r) + " 次，应为 1");
    }

    // ================= 起手 =================

    private void start() {
        // 顺序要紧：两件事都必须在任何一个面板被 new 出来之前 —— 标题页的构造函数当场就起线程。
        Clock.freezeTimers(FREEZE_BASE);
        Clock.setFactor(SLOW);
        MusicReader.closeBGM();
        MusicPlayer.CAN_PLAY_BGM = MusicPlayer.NO;
        MusicReader.closeMusic();

        tap = new PanelTap();
        GameLauncher.switcher = tap;

        // 「起」要切过去的那块。不 initiation：原版在 startLoadAction 里自己调。
        GameLauncher.scenePanel = new ScenePanel(null);

        sp = new TapStartPanel();
        GameLauncher.startPanel = sp;
        // switchTo("start") 的效果，不走它（见类注释）。
        GameLauncher.currentPanel = sp;

        mouse = onlyStartListener(sp.getMouseListeners(), "MouseListener");
        motion = onlyStartListener(sp.getMouseMotionListeners(), "MouseMotionListener");
        loop = awaitLoopThread();
        sink = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB).getGraphics();

        // 标题页自己一声都不出（StartPanel.java 里没有 readmusic）；「起」切过去之后场景那边
        // 哪天真出了一声，真值会记下来。
        MusicTap.armAllowingSilence(script.name);
    }

    /** 原版在构造函数里挂的那一个监听器。按类名认（{@code start.StartPanel$N}），多一个少一个都硬失败。 */
    private <T> T onlyStartListener(T[] all, String what) {
        T found = null;
        int n = 0;
        for (T l : all) {
            if (l.getClass().getName().startsWith("start.StartPanel$")) { found = l; n++; }
        }
        if (n != 1) fail("StartPanel 上挂着 " + n + " 个原版的 " + what + "（一共 " + all.length + " 个），应为 1");
        return found;
    }

    /** 等构造函数起的那条线程睡进 {@code Thread.sleep}。按栈认，不按名字。 */
    private Thread awaitLoopThread() {
        long deadline = System.currentTimeMillis() + WAIT_MS;
        while (System.currentTimeMillis() < deadline) {
            Thread found = null;
            int n = 0;
            for (Thread t : Thread.getAllStackTraces().keySet()) {
                if (runsStartLoop(t)) { found = t; n++; }
            }
            if (n > 1) fail("有 " + n + " 条线程在跑标题页的动画循环 —— 原版每 new 一个 StartPanel 就多起一条");
            if (found != null && sleepingInLoop(found)) return found;
            Thread.yield();
        }
        fail("new StartPanel() 之后 " + WAIT_MS + " ms 内没等到它的动画线程睡下去");
        return null;
    }

    private static boolean runsStartLoop(Thread t) {
        for (StackTraceElement s : t.getStackTrace()) {
            if (s.getClassName().startsWith("start.StartPanel$") && s.getMethodName().equals("run")) return true;
        }
        return false;
    }

    /** 栈顶是 {@code Thread.sleep}，而且是从标题页那条循环里睡下去的。 */
    private static boolean sleepingInLoop(Thread t) {
        if (t.getState() != Thread.State.TIMED_WAITING) return false;
        StackTraceElement[] st = t.getStackTrace();
        return st.length > 0 && st[0].getClassName().equals("java.lang.Thread")
                && st[0].getMethodName().equals("sleep") && runsStartLoop(t);
    }

    // ================= 快照 =================

    /** 这一步之后面板的缓冲图（{@code StartPanel.background}）。 */
    @Override
    public BufferedImage snapshotImage() {
        Object img = field(sp, "background");
        if (!(img instanceof BufferedImage)) fail("StartPanel.background 不是 BufferedImage");
        BufferedImage b = (BufferedImage) img;
        if (b.getWidth() != 1024 || b.getHeight() != 640) {
            fail("原版位图是 " + b.getWidth() + "×" + b.getHeight() + "，应为 1024×640");
        }
        return b;
    }

    /**
     * 一步的真值。字段：
     *
     * <ul>
     *   <li>{@code current} —— {@code GameLauncher.currentPanel}（start / scene），按对象同一性认；
     *   <li>{@code card} —— 这一步拦下来的面板切换（卡片名，同 {@link PanelTap} 的约定）；
     *   <li>{@code onScreen} —— 原版那个 {@code buttons} 列表（「回」是展开之后才加进来的）；
     *   <li>{@code buttons} —— 五颗按钮各自：{@code image} 画的是哪张（normal / hover / pressed，
     *       按对象同一性对三个构造参数认）、{@code clicked}、身边那圈高亮的动画 {@code glow}；
     *   <li>{@code mouse} —— {@code currentX} / {@code currentY} 与自绘鼠标那 8 帧；
     *   <li>{@code scroll} / {@code backScroll} / {@code loading} / {@code loading2} —— 四段动画；
     *   <li>{@code cloud} —— 云的 {@code y} 与 {@code isChange}；
     *   <li>{@code aboutTimer} / {@code loadTimer} —— 两个表的三个字段；
     *   <li>{@code isUnfolded} / {@code signal}（{@code BUTTON_SIGNAL}）。
     * </ul>
     *
     * 一段动画记四样：{@code frame}（{@code currentImage} 是 {@code array} 里第几张，按引用认）、
     * {@code next}（原版的 {@code i}）、{@code isStop}、{@code isLoop}。frame 与 next 分开记，
     * 因为 {@code stopButtonAnimation()} 只拨回 currentImage、不动 i —— 两者会分家。
     *
     * **不记** {@code repaint()} 有没有被调：它在每一拍的循环体末尾无条件调一次（{@link #loopOnce}
     * 已经核成了硬失败），记了是按构造成立的装饰。
     */
    @Override
    public String snapshotState(int index) {
        StringBuilder b = new StringBuilder();
        b.append("{\"t\":").append(index);
        b.append(",\"ip\":").append(at);
        b.append(",\"input\":[").append(String.join(",", pending)).append("]");
        b.append(",\"music\":").append(MusicTap.json());
        b.append(",\"current\":").append(Json.str(currentName()));
        b.append(",\"card\":").append(Json.str(card));

        b.append(",\"onScreen\":[");
        List<?> on = (List<?>) field(sp, "buttons");
        for (int i = 0; i < on.size(); i++) {
            if (i > 0) b.append(',');
            b.append(Json.str(buttonName(on.get(i))));
        }
        b.append(']');

        b.append(",\"buttons\":{");
        for (int i = 0; i < BUTTONS.length; i++) {
            Object btn = field(sp, BUTTONS[i]);
            if (i > 0) b.append(',');
            b.append(Json.str(BUTTONS[i])).append(":{\"image\":").append(Json.str(buttonImage(btn)))
             .append(",\"clicked\":").append(getBool(btn, "isclicked"))
             .append(",\"glow\":").append(anim(field(btn, "animation"))).append('}');
        }
        b.append('}');

        Object mouseAnim = field(field(sp, "mouse"), "mouseAnimation");
        b.append(",\"mouse\":{\"x\":").append(getInt(sp, "currentX"))
         .append(",\"y\":").append(getInt(sp, "currentY"))
         .append(",\"anim\":").append(anim(mouseAnim)).append('}');

        b.append(",\"scroll\":").append(anim(field(sp, "scroll")));
        b.append(",\"backScroll\":").append(anim(field(sp, "backScroll")));
        b.append(",\"loading\":").append(anim(field(sp, "loadAnimation")));
        b.append(",\"loading2\":").append(anim(field(sp, "loadAnimation2")));

        Object cloud = field(sp, "upCloud");
        b.append(",\"cloud\":{\"y\":").append(getInt(cloud, "y"))
         .append(",\"isChange\":").append(getBool(cloud, "isChange")).append('}');

        b.append(",\"aboutTimer\":").append(timer(field(sp, "aboutTimer")));
        b.append(",\"loadTimer\":").append(timer(field(sp, "loadTimer")));
        b.append(",\"isUnfolded\":").append(getBool(sp, "isUnfolded"));
        b.append(",\"signal\":").append(getInt(sp, "BUTTON_SIGNAL"));
        return b.append('}').toString();
    }

    private String anim(Object a) {
        Image[] array = (Image[]) field(a, "array");
        Object cur = field(a, "currentImage");
        int frame = -1;
        for (int k = 0; k < array.length; k++) {
            if (array[k] == cur) {
                if (frame >= 0) fail("一段动画的第 " + frame + " 张与第 " + k + " 张是同一个 Image 对象，按引用认不出是第几张");
                frame = k;
            }
        }
        if (frame < 0) fail("一段动画的 currentImage 不是它自己 array 里的任何一张");
        return "{\"frame\":" + frame + ",\"next\":" + getInt(a, "i")
                + ",\"isStop\":" + getBool(a, "isStop") + ",\"isLoop\":" + getBool(a, "isLoop") + "}";
    }

    private String timer(Object t) {
        return "{\"timeLeft\":" + getInt(t, "timeLeft") + ",\"isCompleted\":" + getBool(t, "isCompleted")
                + ",\"isStarted\":" + getBool(t, "isStarted") + "}";
    }

    /**
     * 这颗按钮此刻画的是三个构造参数里的哪一张，按引用认。**悬停与按下传的是同一个文件**
     * （{@code 起2.png} 传了两遍），而 {@code readImage} 走 {@code Toolkit.getImage} 的按文件名缓存，
     * 两者多半是同一个对象 —— 那样按下之后读出来是 {@code hover}，按先比到的算。
     */
    private String buttonImage(Object btn) {
        Object img = field(btn, "buttonImage");
        if (img == field(btn, "normalImage")) return "normal";
        if (img == field(btn, "waitclickImage")) return "hover";
        if (img == field(btn, "pressedImage")) return "pressed";
        fail("按钮画的图不是它三个构造参数里的任何一张");
        return "?";
    }

    private String buttonName(Object btn) {
        for (String n : BUTTONS) if (field(sp, n) == btn) return n;
        fail("buttons 列表里有一颗认不出来的按钮");
        return "?";
    }

    /** 当前面板的名字，按对象同一性认。认不出是硬失败，不编一个。 */
    private String currentName() {
        Object c = GameLauncher.currentPanel;
        if (c == sp) return "start";
        if (c == GameLauncher.scenePanel) return "scene";
        fail("当前面板认不出来：" + (c == null ? "null" : c.getClass().getName()));
        return "?";
    }

    // ================= 反射 =================

    private static Object field(Object o, String name) {
        for (Class<?> c = o.getClass(); c != null; c = c.getSuperclass()) {
            try {
                Field f = c.getDeclaredField(name);
                f.setAccessible(true);
                return f.get(o);
            } catch (NoSuchFieldException e) {
                // 往父类找
            } catch (IllegalAccessException e) {
                throw new IllegalStateException(e);
            }
        }
        throw new IllegalStateException("没有字段 " + name + " on " + o.getClass());
    }

    private static int getInt(Object o, String name) { return (Integer) field(o, name); }

    private static boolean getBool(Object o, String name) { return (Boolean) field(o, name); }
}
