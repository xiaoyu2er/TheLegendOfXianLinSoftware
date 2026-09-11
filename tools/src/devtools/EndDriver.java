package devtools;

import java.awt.Graphics;
import java.awt.Image;
import java.awt.event.KeyEvent;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.PrintStream;
import java.io.UnsupportedEncodingException;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import battle.BattlePanel;
import battle.LuXueQi;
import battle.YuJie;
import battle.ZhangXiaoFan;
import main.GameLauncher;
import media.MusicPlayer;
import media.MusicReader;
import menu.MenuPanel;
import scene.ScenePanel;
import start.EndPanel;
import tools.Clock;
import tools.Reader;

/**
 * 结局面板（{@code start.EndPanel}）的驱动器，第六支（xl-czb.5）。
 *
 * <h2>一步 = 一拍</h2>
 *
 * 这个面板**没有任何键鼠监听**，唯一的时间驱动是 {@code start()} 起的那条线程：
 * {@code while(true){ Clock.sleep(100); update(); }}。所以一步同场景那支，是一拍 ——
 * **一次 {@code update()} + 一次 {@code paint()}**，而不是菜单那套「一步 = 一个输入
 * 事件」。那条真线程被冻住（倍率 1e-9，{@code sleep(100)} ≈ 3170 年），每一拍的
 * {@code update()} 由本类在导出线程上调，顺序固定为 update → paint，与另外几支一致。
 * 剧本另有三种一步一件的指令（进来 / 按键 / 叫醒线程），见 {@link EndScript}。
 *
 * <h2>快照记会变的量，不记图片内容</h2>
 *
 * 沿用既有分工：素材与文本对不对归数据层，走到第几帧归行为层。所以记字幕与侧栏的
 * 纵坐标（{@code wordY} / {@code blankY}）、{@code code}、当前是第几张过场画
 * （{@code picture}）、两个旗标（{@code isDraw} / {@code isStop}），外加这一步有没有
 * 调 {@code repaint()}。**不记**两条横坐标（{@code wordX=0} / {@code blankX=700}，
 * 构造之后没人写，记了是按构造成立的装饰），也不记图片像素。
 *
 * <h2>每帧重读磁盘：量出来是什么（这张票先跑的读数）</h2>
 *
 * {@code update()} 每拍一句 {@code Reader.readImage("sources/End/"+code+".jpg")}，
 * 无限循环。读数（2026-09-10，openjdk 17 / macOS，一次性探针，冻结时钟下）：
 *
 * <ul>
 *   <li>{@code readImage} 走 {@code new ImageIcon(path)} → {@code Toolkit.getImage}，
 *       后者**按文件名缓存**。第一轮每张都真的解码（第一拍 56 ms，此后 3–16 ms），
 *       第二轮起返回的是**同一个 Image 对象**（identityHashCode 逐张相同），每拍约 50 µs；
 *   <li>第一轮之后把 {@code 3.jpg} 从磁盘上删掉：{@code readImage} 打了一行缺图警告，
 *       **返回的仍是那个缓存对象**，宽 1066 高 639，画出来照旧 —— 第二轮起根本不读
 *       图片内容，只剩 {@code fix(diag)} 那一句 {@code File.isFile()}；
 *   <li>{@code ImageIcon} 用 {@code MediaTracker} 等图加载完才返回，所以第一轮也不存在
 *       「半张图」的时序：同一拍的位图两次导出逐字节一致。
 * </ul>
 *
 * 结论：它对快照**无影响**。而 {@link #picture()} 把这件事变成一条一直在跑的判据：
 * 当前那张过场画必须是某个 {@code N.jpg} 的缓存对象本身（按引用认），哪天缓存不再
 * 命中、真的每帧重读了，导出当场硬失败，而不是悄悄换一种行为。
 *
 * ⚠️ 同一个探针还读出一件源码里藏着的事：{@code code==24} 那一拍，第一个 {@code if}
 * 读 24.jpg、把 code 推成 25，紧接着第二个 {@code if} 就成立、读 25.jpg、拨回 1 ——
 * **24.jpg 从来没有被画出来过**，一轮是 24 拍（1..23、25）。真值的 {@code picture}
 * 列里看得见。
 *
 * <h2>「有进无出」三样：现读源码、各取一个读数</h2>
 *
 * 票面（与 xl-czb.2 SPEC）说的三样，逐条现读、逐条跑过：
 *
 * <ol>
 *   <li><b>「进去之后键盘全哑」—— 读下来是错的。</b>{@code switchTo("end")} 确实是唯一
 *       不更新 {@code currentPanel} 的一支，顶层 {@code keyPressed} 里也确实没有结局的
 *       分支；可两件事合起来的后果不是「哑」，而是 {@code currentPanel} **仍然是场景面板**
 *       （原版唯一的调用点 {@code DialogueEvent.keyPressed} 就在场景的按键分发里），于是
 *       之后每一次按键都照旧交给看不见的场景面板。退出键在那里是「开菜单」
 *       （{@code ScenePanel.keyPressed} 里 {@code VK_ESCAPE → switchTo("menu")}，条件是
 *       不在旁白、不在说话 —— 而 {@code DialogueEvent} 在切结局之前刚把 {@code isSpeaking}
 *       置假）。**结局会被一个退出键切走。**真值里：每个 {@code key} 步的 {@code to} 记
 *       按键落到了谁手里，{@code current} 记 {@code currentPanel}，退出键那一步
 *       {@code card = menuPanel}。按键走的是**原版自己的** {@code GameLauncher.keyPressed}
 *       （实例用 {@code Unsafe.allocateInstance} 造，不跑 JFrame 的构造函数 —— 那个方法
 *       只读静态字段与事件本身）。⚠️ 未验证：真窗口里键盘焦点在不在 {@code GameLauncher}
 *       上。这里验的是焦点在它上面时的分发；全程的其余面板都靠同一个监听器收键。
 *   <li><b>「那条线程永不退出」—— 读下来成立。</b>{@code run()} 是 {@code while(true)}，
 *       循环体里没有 break / return，catch 只包住 sleep；{@code isStop} 只挡住
 *       {@code update()} 的内容。真值里：{@code wake} 步把真线程叫醒，等它走完一整圈
 *       循环体再睡回去，{@code loop.alive} 记它还在不在、{@code loop.wakes} 记它在
 *       {@code isStop} 之后又走了几圈。⚠️ 冻结状态下它恒在睡，{@code alive} 在非 wake 步
 *       按构造成立；分辨力只在 wake 步上 —— 原版要是 {@code while(!isStop)}，叫醒那一下
 *       它就 TERMINATED 了。
 *   <li><b>「画面冻在最后一帧」—— 读下来成立。</b>{@code isStop} 之后 {@code update()} 不再
 *       改任何字段、不再 {@code repaint()}，而 {@code isDraw} 没有人复位 —— 任何一次
 *       重绘都画出同一张。真值里：{@code isDraw} 一直是 true，定格之后 {@code repainted}
 *       是 false、{@code wordY} / {@code blankY} / {@code picture} 不再变。
 * </ol>
 *
 * <h2>起手：一块场景面板 + 菜单 + 结局</h2>
 *
 * 结局的入口在场景里，按键也落回场景，退出键又要菜单接住（{@code switchTo("menu")}
 * 会 {@code menuPanel.hero1.refreshValue()}，没有菜单就是 NPE）。所以照
 * {@code GameLauncher} 的构造顺序立：战斗面板与三个英雄（菜单要这三个对象）→ 场景
 * （{@code initiation(setup.scene)}）→ 菜单 → 结局面板。时钟与音频取与存读档那支同一个
 * 交集：冻结真实定时器 + 倍率 1e-9 + 静音。场景面板**一拍都不推**：原版里它自己的循环
 * 在结局期间照样在跑（{@code currentPanel} 还是它），但它推的东西不进这份真值 ——
 * 那是「跨面板端到端」那张后续票的事。
 */
public final class EndDriver implements TraceDriver {

    /** 冻结基数：24 小时。与另外几支一致。 */
    private static final long FREEZE_BASE = 24L * 60 * 60 * 1000;

    /** 时间缩放倍率。{@code Clock.ms(100)} = 10^11 ms ≈ 3170 年。 */
    private static final double SLOW = 1e-9;

    /** 等真线程睡下去 / 走完一圈的上限。超了是硬失败。 */
    private static final long WAIT_MS = 5000;

    /** 过场画所在目录，与 {@code EndPanel.update()} 里拼路径用的前缀逐字相同。 */
    private static final String PICTURE_DIR = "sources/End/";

    private final EndScript script;
    private TapEndPanel ep;
    private KeyTapScene sp;
    private PanelTap tap;
    /** 原版的按键分发。见类注释第 1 条。 */
    private GameLauncher launcher;
    /** 原版 {@code EndPanel.run()} 那条真线程。 */
    private Thread loop;
    private Graphics sink;
    /**
     * 过场画编号 → 那张图的缓存对象。**持有强引用**，缓存（软引用）因此不会被回收，
     * 「按引用认出是第几张」才一直成立。
     */
    private final Map<Integer, Image> pictures = new TreeMap<>();

    private final List<String> pending = new ArrayList<>();
    /** 本步拦截到的面板切换（卡片名）。 */
    private String card;
    /** 屏幕上现在是哪张卡片：最后一次被 show 的那个名字。 */
    private String shown;
    private boolean repainted;
    private int wakes;

    private int ip;
    private int at;
    private int sub;
    private int steps;
    private boolean started;

    EndDriver(EndScript script) { this.script = script; }

    @Override
    public String kind() { return "end"; }

    private void fail(String msg) {
        String where = ip < script.steps.size()
                ? "第 " + ip + " 条指令 " + script.steps.get(ip).op
                : "剧本末尾";
        ExportTrace.die(script.name + " · " + where + " · 第 " + steps + " 步：" + msg);
    }

    // ================= 两个观察点 =================

    /**
     * 场景面板，外加一个计数：{@code keyPressed(int, boolean)} 被调了几次。
     * 行为一字不改（调 super），只是让「按键落到了场景手里」成为一个读得到的数。
     */
    static final class KeyTapScene extends ScenePanel {
        private static final long serialVersionUID = 1L;
        int keys;
        KeyTapScene() { super(null); }
        @Override
        public void keyPressed(int keyCode, boolean isControl) {
            keys++;
            super.keyPressed(keyCode, isControl);
        }
    }

    /**
     * 结局面板，{@code repaint()} 换成只计数。这个面板从没被加进任何窗口，原版的
     * {@code repaint()} 在这里本来就画不出任何东西；每一步真正的绘制由驱动器调
     * {@code paint()}。计数让「定格之后不再 repaint」成为读数。
     */
    static final class TapEndPanel extends EndPanel {
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
        if (shown != null && !shown.equals("endPanel")) {
            fail("结局已经不在屏幕上了（上一步切到了 " + shown + "），后面的指令读不出结局面板的任何东西");
        }
        pending.clear();
        card = null;
        repainted = false;
        int tapBefore = tap.count();

        at = ip;
        EndScript.Instruction in = script.steps.get(ip);
        switch (in.op) {
            case "enter": enter(); break;
            case "tick":  tick(in); break;
            case "key":   key(in.key); break;
            case "wake":  wake(); break;
            default:      fail("不认识的指令 " + in.op);
        }

        int switched = tap.count() - tapBefore;
        if (switched > 1) fail("一步里切了 " + switched + " 次面板 —— 观察点只记得住最后一次（" + tap.card() + "）");
        if (switched == 1) { card = tap.consume(); shown = card; }

        // 只在结局还在屏幕上时画：CardLayout 盖住的面板，原版不会去画它。
        // 切走的那一步因此不画，位图停在切走之前最后一帧。
        if ("endPanel".equals(shown)) ep.paint(sink);

        if (++sub >= in.times) { ip++; sub = 0; }
        steps++;
        return true;
    }

    /**
     * 进结局：原版唯一的调用点是 {@code DialogueEvent.keyPressed} 里那一句
     * {@code GameLauncher.switchTo("end")}，这里原样调它 —— 走的是原版自己的 switch，
     * 所以「这一支不更新 currentPanel」是读出来的，不是驱动器替它决定的。
     */
    private void enter() {
        GameLauncher.switchTo("end");
        pending.add("{\"e\":\"enter\"}");
        if (!"endPanel".equals(tap.card())) fail("switchTo(\"end\") 之后切到的卡片是 " + tap.card() + "，不是 endPanel");
        loop = awaitLoopThread();
    }

    /** 一拍：原版循环体去掉 sleep 那一句。 */
    private void tick(EndScript.Instruction in) {
        boolean last = sub == in.times - 1;
        boolean stoppedBefore = getBool("isStop");
        int r = ep.repaints;
        ep.update();
        repainted = ep.repaints != r;
        pending.add("{\"e\":\"tick\"}");
        if ("stop".equals(in.expect)) {
            boolean stopped = getBool("isStop");
            if (stoppedBefore) fail("expect=stop，可这条指令的第 " + sub + " 拍之前 isStop 就已经是真的了");
            if (stopped && !last) fail("expect=stop，isStop 在第 " + (sub + 1) + " 拍翻真，比剧本写的 " + in.times + " 拍早 —— 拍数推错了");
            if (!stopped && last) fail("expect=stop，推满 " + in.times + " 拍 isStop 还是假的 —— 拍数推错了");
        }
    }

    /**
     * 经原版 {@code GameLauncher.keyPressed} 分发一次按键。落到谁手里由原版自己判；
     * 这里只数场景面板收没收到。
     */
    private void key(String name) {
        int before = sp.keys;
        // 事件源不被读：原版那个方法只看 getKeyCode() 与 isControlDown()。
        launcher.keyPressed(new KeyEvent(sp, KeyEvent.KEY_PRESSED, 0L, 0, vk(name), KeyEvent.CHAR_UNDEFINED));
        int got = sp.keys - before;
        if (got > 1) fail("一次按键场景面板收到了 " + got + " 次");
        pending.add("{\"e\":\"key\",\"key\":" + Json.str(name) + ",\"to\":" + (got == 1 ? "\"scene\"" : "null") + "}");
    }

    private static int vk(String name) {
        switch (name) {
            case "enter":  return KeyEvent.VK_ENTER;
            case "escape": return KeyEvent.VK_ESCAPE;
            case "space":  return KeyEvent.VK_SPACE;
            case "left":   return KeyEvent.VK_LEFT;
            case "right":  return KeyEvent.VK_RIGHT;
            case "up":     return KeyEvent.VK_UP;
            case "down":   return KeyEvent.VK_DOWN;
            default: throw new IllegalArgumentException(name);
        }
    }

    /**
     * 把原版那条真线程叫醒一次，等它走完一整圈循环体、再睡回 {@code Thread.sleep}。
     *
     * 「走完一圈」怎么认：{@code interrupt()} 让 {@code Clock.sleep} 抛
     * {@code InterruptedException}，原版的 catch 把它 {@code printStackTrace()} 到
     * {@code System.err} —— 这里临时把 err 换成一个缓冲，**先看到那一行**，再看到线程
     * 栈顶重新是 {@code Thread.sleep}，才算这一圈（catch → update → sleep）走完了。
     * 只看线程状态不够：叫醒之前它也是 TIMED_WAITING，「还没醒」与「已经睡回去」长得
     * 一模一样。线程死了（原版要是有出口）就不等了，照实记 {@code alive=false}。
     *
     * 只许在 isStop 之后：之前 update() 会改字幕位置，与导出线程推的 update() 抢字段。
     */
    private void wake() {
        if (!getBool("isStop")) fail("isStop 之前不许叫醒原版线程 —— 它的 update() 会和驱动器推的那一拍抢同一批字段");
        if (loop == null) fail("还没有进结局，没有线程可叫");
        int r = ep.repaints;
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
                if (!loop.isAlive() || printed && sleepingInLoop(loop)) { done = true; break; }
                if (System.currentTimeMillis() > deadline) { done = false; break; }
                Thread.yield();
            }
        } finally {
            System.setErr(saved);
        }
        if (!done) fail("叫醒原版线程之后 " + WAIT_MS + " ms 内它既没走完一圈、也没退出（err 缓冲：" + cap + "）");
        if (loop.isAlive()) wakes++;
        repainted = ep.repaints != r;
        pending.add("{\"e\":\"wake\"}");
    }

    // ================= 起手 =================

    private void start() {
        // 顺序要紧：两件事都必须在任何一个面板被 new 出来之前。
        Clock.freezeTimers(FREEZE_BASE);
        Clock.setFactor(SLOW);
        MusicReader.closeBGM();
        MusicPlayer.CAN_PLAY_BGM = MusicPlayer.NO;
        MusicReader.closeMusic();

        tap = new PanelTap();
        GameLauncher.switcher = tap;

        // 菜单要三个英雄对象，英雄要一块战斗面板。这块面板一拍都不跑（倍率 1e-9）。
        BattlePanel bp = new BattlePanel();
        GameLauncher.battlePanel = bp;
        GameLauncher.zhangXiaoFan = new ZhangXiaoFan(560, 160, bp);
        GameLauncher.yuJie = new YuJie(750, 150, bp);
        GameLauncher.luXueQi = new LuXueQi(800, 330, bp);

        sp = new KeyTapScene();
        GameLauncher.scenePanel = sp;
        sp.initiation(script.scene);

        GameLauncher.menuPanel = new MenuPanel(GameLauncher.zhangXiaoFan, GameLauncher.luXueQi, GameLauncher.yuJie);

        ep = new TapEndPanel();
        GameLauncher.endPanel = ep;
        // 原版走到 switchTo("end") 的那一刻，当前面板是场景：那一句就在场景的按键分发里。
        GameLauncher.currentPanel = sp;

        launcher = allocateLauncher();
        loadPictures();
        sink = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB).getGraphics();

        // 结局面板自己一声都不出（EndPanel 里没有 readmusic）；按键落到场景那边
        // 哪天真出了一声，真值会记下来。
        MusicTap.armAllowingSilence(script.name);
    }

    /**
     * 过场画的分母**从磁盘现数**：{@code sources/End/} 下文件名是纯数字的 .jpg。
     * 原版源码里写死的是 25（{@code code<25} / {@code code==25}），两者对不上时
     * {@link #picture()} 会在认不出的那一拍硬失败。
     */
    private void loadPictures() {
        File[] files = new File(PICTURE_DIR).listFiles();
        if (files == null) ExportTrace.die("找不到过场画目录 " + PICTURE_DIR);
        for (File f : files) {
            String n = f.getName();
            if (n.matches("[0-9]+\\.jpg")) {
                int k = Integer.parseInt(n.substring(0, n.length() - 4));
                // 路径拼法与 EndPanel.update() 逐字相同：缓存按文件名认。
                pictures.put(k, Reader.readImage(PICTURE_DIR + k + ".jpg"));
            }
        }
        if (pictures.isEmpty()) ExportTrace.die(PICTURE_DIR + " 下一张纯数字编号的 .jpg 都没有");
    }

    /** 当前画着第几张过场画，按引用认；还没读过任何一张是 null。 */
    private Integer picture() {
        Image cur = (Image) field(ep, "currentImage");
        if (cur == null) return null;
        for (Map.Entry<Integer, Image> e : pictures.entrySet()) {
            if (e.getValue() == cur) return e.getKey();
        }
        fail("当前那张过场画不是 " + PICTURE_DIR + " 下任何一张的缓存对象（code=" + field(ep, "code")
                + "）—— readImage 不再命中缓存、真的每帧重读了？见类注释「每帧重读磁盘」");
        return null;
    }

    /**
     * 原版 {@code GameLauncher} 的一个实例，不跑构造函数（那会立起整个游戏、开窗口、
     * 放主题曲）。{@code keyPressed} 只读静态字段与事件，不碰 {@code this}。
     */
    private static GameLauncher allocateLauncher() {
        // 按名字反射而不是直接写 sun.misc.Unsafe：后者每次编译都打三条「内部 API」警告。
        try {
            Class<?> uc = Class.forName("sun.misc.Unsafe");
            Field f = uc.getDeclaredField("theUnsafe");
            f.setAccessible(true);
            Object u = f.get(null);
            return (GameLauncher) uc.getMethod("allocateInstance", Class.class).invoke(u, GameLauncher.class);
        } catch (ReflectiveOperationException e) {
            ExportTrace.die("造不出 GameLauncher 实例：" + e);
            return null;
        }
    }

    /** 等 {@code start()} 起的那条线程睡进 {@code Thread.sleep}。按栈认，不按名字。 */
    private Thread awaitLoopThread() {
        long deadline = System.currentTimeMillis() + WAIT_MS;
        while (System.currentTimeMillis() < deadline) {
            Thread found = null;
            int n = 0;
            for (Thread t : Thread.getAllStackTraces().keySet()) {
                if (runsEndLoop(t)) { found = t; n++; }
            }
            if (n > 1) fail("有 " + n + " 条线程在跑 EndPanel.run() —— 原版每 switchTo(\"end\") 一次就多起一条");
            if (found != null && sleepingInLoop(found)) return found;
            Thread.yield();
        }
        fail("switchTo(\"end\") 之后 " + WAIT_MS + " ms 内没等到 EndPanel.run() 那条线程睡下去");
        return null;
    }

    private static boolean runsEndLoop(Thread t) {
        for (StackTraceElement s : t.getStackTrace()) {
            if (s.getClassName().equals("start.EndPanel") && s.getMethodName().equals("run")) return true;
        }
        return false;
    }

    /** 栈顶是 {@code Thread.sleep}，而且是从 {@code EndPanel.run()} 里睡下去的。 */
    private static boolean sleepingInLoop(Thread t) {
        if (t.getState() != Thread.State.TIMED_WAITING) return false;
        StackTraceElement[] st = t.getStackTrace();
        return st.length > 0 && st[0].getClassName().equals("java.lang.Thread")
                && st[0].getMethodName().equals("sleep") && runsEndLoop(t);
    }

    // ================= 快照 =================

    /** 这一步之后面板的缓冲图（{@code EndPanel.bufferedImage}）。 */
    @Override
    public BufferedImage snapshotImage() {
        Object img = field(ep, "bufferedImage");
        if (!(img instanceof BufferedImage)) fail("EndPanel.bufferedImage 不是 BufferedImage");
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
     *   <li>{@code current} —— {@code GameLauncher.currentPanel}，用 {@code switchTo} 那套
     *       名字（scene / menu），按对象同一性认。**进了结局它照样是 scene** —— 那正是
     *       要记的读数；
     *   <li>{@code card} —— 这一步拦下来的面板切换（卡片名，同 {@link PanelTap} 的约定）；
     *   <li>{@code wordY} / {@code blankY} / {@code code} / {@code isDraw} / {@code isStop} ——
     *       原版字段原值；
     *   <li>{@code picture} —— 当前画着第几张过场画（{@code N.jpg} 的 N），见 {@link #picture()}；
     *   <li>{@code repainted} —— 这一步里原版有没有调 {@code repaint()}；
     *   <li>{@code loop} —— 原版那条线程还在不在（{@code alive}），以及它在 {@code isStop}
     *       之后又走过几圈（{@code wakes}）。见类注释第 2 条。
     * </ul>
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
        b.append(",\"wordY\":").append(getInt("wordY"));
        b.append(",\"blankY\":").append(getInt("blankY"));
        b.append(",\"code\":").append(getInt("code"));
        Integer pic = picture();
        b.append(",\"picture\":").append(pic == null ? "null" : pic.toString());
        b.append(",\"isDraw\":").append(getBool("isDraw"));
        b.append(",\"isStop\":").append(getBool("isStop"));
        b.append(",\"repainted\":").append(repainted);
        b.append(",\"loop\":{\"alive\":").append(loop != null && loop.isAlive())
         .append(",\"wakes\":").append(wakes).append('}');
        return b.append('}').toString();
    }

    /** 当前面板的名字，按对象同一性认。认不出是硬失败，不编一个。 */
    private String currentName() {
        Object c = GameLauncher.currentPanel;
        if (c == sp) return "scene";
        if (c == GameLauncher.menuPanel) return "menu";
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

    private int getInt(String name) { return (Integer) field(ep, name); }

    private boolean getBool(String name) { return (Boolean) field(ep, name); }
}
