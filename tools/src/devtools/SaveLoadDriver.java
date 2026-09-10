package devtools;

import java.awt.Graphics;
import java.awt.Image;
import java.awt.event.KeyEvent;
import java.awt.event.MouseEvent;
import java.awt.event.MouseListener;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.attribute.PosixFilePermission;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.locks.LockSupport;

import javax.swing.JPanel;

import battle.BattlePanel;
import battle.LuXueQi;
import battle.YuJie;
import battle.ZhangXiaoFan;
import main.GameLauncher;
import media.MusicPlayer;
import media.MusicReader;
import menu.MenuPanel;
import scene.SaveAndLoad;
import scene.ScenePanel;
import shop.DrugPack;
import shop.EquipmentPack;
import shop.EquipmentShopPanel;
import shop.ShopPanel;
import start.LoadAndSavePanel;
import tools.Clock;

/**
 * 存读档面板（{@code start.LoadAndSavePanel}）的驱动器，第五支（xl-i06.6）。
 * **一步 = 一个输入事件**：进面板一步、点槽位按下与松开各一步、退出键一步。
 *
 * 为什么不是 tick：这个面板唯一的时间驱动是构造函数里起的那条 10 Hz 死循环线程，
 * 它推的**全是绘制量** —— 鼠标图标与槽位上几个人物动画的帧号（{@code StartAnimation.i}
 * / {@code currentImage}），只被 {@code paint()} 消费。点击判定（{@code StartButton}
 * 的命中）、槽位空不空（{@code Loader.isNull}，一次磁盘读）、摘要（{@code prepareScenes}）
 * 走的是与那条线程**完全不相交**的另一条链。所以那条线程这里冻住不推，与菜单那四条
 * 同形线程同一处置（不复刻，登记在案，将来一起做）。
 *
 * <h2>快照不记什么，以及为什么</h2>
 *
 * **不记动画帧号，也不记鼠标坐标。** 帧号记了就等于要求 Web 侧复刻那条停不下来的
 * 线程 —— 那正是上面说的「不复刻」；而鼠标坐标（{@code currentX/Y}）只是事件的
 * 回声，每一步的落点已经写在 {@code input} 里，再记一遍就把同一件事验两遍。
 *
 * <h2>起手：五个面板拼成的一份组合状态</h2>
 *
 * 原版的写档装置（{@code Recorder.save}）与读档装置（{@code Loader.load}）读写的
 * 是 {@code GameLauncher} 上一整排 public static 字段：三个英雄、场景、菜单、两个
 * 商店。导出器里没有 {@code GameLauncher}，所以这里**逐个立起来、逐个写进那几个
 * 字段** —— 不复用另外四支驱动器的入口：它们各自的时钟与音频设置会互相打架
 * （场景要虚拟定时器、菜单与商店要把倍率压到 1e-9），拼起来只能写一份新的组合起手，
 * 取其交集：冻结真实定时器 + 倍率 1e-9 + 静音。本支不推任何 tick，所以虚拟定时器
 * 那一套用不上。
 *
 * 立的顺序照 {@code GameLauncher} 的构造函数：战斗面板与三个英雄 → 场景（**必须**
 * 调 {@code initiation}，只 new 不初始化，写档那一刻 {@code scene.dialogueEvent}
 * 是 null）→ 菜单 → 两个商店 → 存读档面板最后。{@code LoadAndSavePanel} 的字段
 * 初值 {@code new Thread(GameLauncher.scenePanel)} 与构造函数里的
 * {@code new Recorder()} 都在**构造那一刻**抓 {@code scenePanel}，所以它必须最后建。
 *
 * <h2>写盘：草稿区可以随便写，跑完必须还原</h2>
 *
 * 原版把 {@code sources/Record/存档N.txt} 写死在源码里，那个目录现在是草稿区，
 * 真值在 {@code tools/ground-truth/存档/}（xl-i06.5）。本驱动器：
 *
 * <ol>
 *   <li>起手先核草稿区与真值逐字节相同（{@link SaveTruth#draftProblems()}），
 *       不同就拒绝运行 —— 那说明上一次谁没还原，这一次跑出来的真值来路不明；
 *   <li>核完立刻挂一个关机钩子，从真值目录把草稿区**逐字节写回**、连权限位一起
 *       （{@code git} 记着可执行位，按新文件重建会多出一条 mode 变更），写回后
 *       再核一遍，核不过就 {@code halt(3)} —— 退出码 0 却留下被覆盖的草稿区，
 *       是这里最不能有的结局；
 *   <li>然后才动草稿区（删 {@code setup.emptySlots} 那几个档、让原版写档）。
 * </ol>
 *
 * 钩子只在 JVM 正常退出时跑（{@code System.exit}，包括 {@link ExportTrace#die}）。
 * 被 {@code kill -9} 的那种由 {@code SaveDraftIntactTest} 兜底 —— 这一条之所以
 * 要紧，是因为这支驱动器起的线程全是非守护的：一条异常从 {@code main} 里冒出去，
 * JVM 不会退，钩子也就不会跑。所以 {@link #step()} 把一切运行时异常都收成
 * {@code die}，不让它冒出去。
 *
 * <h2>拦截：真值里看得见的是原版本来要去哪</h2>
 *
 * 读档那一下原版做两件跨面板的事，这里都**拦住并记下**，不真的做：
 *
 * <ul>
 *   <li>{@code GameLauncher.switchTo("scene")} —— {@code switcher} 换成
 *       {@link PanelTap}，只记卡片名（与场景驱动器「三扇门」同一个观察点）；
 *   <li>{@code t.start()}，{@code t = new Thread(GameLauncher.scenePanel)}，也就是
 *       原版在读档时**多起一条场景循环**（M6 的那条「唯一不复刻」）。字段 {@code t}
 *       换成一条目标为「永远停着」的守护线程：原版照旧自己判 {@code isAlive()}、
 *       自己决定起不起，起了的只是一条什么都不做的线程；这一步它从 NEW 变成了
 *       别的状态，就记 {@code sceneLoopStart: true}。
 * </ul>
 *
 * 读完档之后当前面板是场景，这个面板不再收事件，于是剧本到那里为止。读档之后场景
 * 与各面板的状态**不在这份真值里** —— 那是「跨面板端到端」那张后续票的事。
 */
public final class SaveLoadDriver implements TraceDriver {

    /** 冻结基数：24 小时。与另外几支一致。 */
    private static final long FREEZE_BASE = 24L * 60 * 60 * 1000;

    /**
     * 时间缩放倍率。{@code Clock.ms(100)} = 10^11 ms ≈ 3170 年：面板的动画线程、
     * 菜单四条、战斗一条、商店两条，全部停在各自第一次 sleep 上。
     */
    private static final double SLOW = 1e-9;

    private final SaveLoadScript script;
    private LoadAndSavePanel ls;
    private PanelTap tap;
    private Graphics sink;
    /** 「标题画面」的替身。原因见 {@link #start()} 里那一段。 */
    private JPanel startStandIn;
    /** 顶替面板字段 {@code t} 的那条线程。见类注释「拦截」一节。 */
    private Thread sceneLoopStandIn;

    private final List<String> pending = new ArrayList<>();
    /** 本步拦截到的面板切换（卡片名）。一步至多一次，多了硬失败。 */
    private String card;
    private boolean sceneLoopStart;

    private int ip;
    private int at;
    private int sub;          // slot 指令内：0 = 按下，1 = 松开
    private int[] point;
    private int steps;
    private boolean started;
    /** 已经进过几次面板。每次 {@code changeStateTo} 都会多挂一对鼠标监听器。 */
    private int enters;

    SaveLoadDriver(SaveLoadScript script) { this.script = script; }

    @Override
    public String kind() { return "saveload"; }

    private void fail(String msg) {
        String where = ip < script.steps.size()
                ? "第 " + ip + " 条指令 " + script.steps.get(ip).op
                : "剧本末尾";
        ExportTrace.die(script.name + " · " + where + " · 第 " + steps + " 步：" + msg);
    }

    // ================= 推进一步 =================

    @Override
    public boolean step() {
        try {
            return stepUnguarded();
        } catch (RuntimeException e) {
            // 见类注释：冒出去的异常不会让 JVM 退出，草稿区也就不会被还原。
            e.printStackTrace();
            fail("原版抛了 " + e);
            return false;
        }
    }

    private boolean stepUnguarded() {
        if (!started) { start(); started = true; }
        if (ip >= script.steps.size()) return false;
        if (steps >= script.maxSteps) fail("超过剧本的 maxSteps=" + script.maxSteps + "，剧本没有跑完");
        pending.clear();
        card = null;

        int tapBefore = tap.count();
        Thread.State loopBefore = sceneLoopStandIn.getState();

        at = ip;
        boolean done = dispatch(script.steps.get(ip));

        int switched = tap.count() - tapBefore;
        if (switched > 1) {
            fail("一个输入事件里切了 " + switched + " 次面板 —— 观察点只记得住最后一次（"
                    + tap.card() + "），前面几次会从真值里消失");
        }
        if (switched == 1) card = tap.consume();
        sceneLoopStart = loopBefore == Thread.State.NEW && sceneLoopStandIn.getState() != Thread.State.NEW;

        // 只在这个面板还是当前面板时画：CardLayout 盖住的面板，原版那条动画线程
        // 的 repaint() 不会真画。离开的那一步因此不画，位图停在离开前最后一帧。
        if (GameLauncher.currentPanel == ls) ls.paint(sink);

        if (done) { ip++; sub = 0; } else { sub++; }
        steps++;
        return true;
    }

    /** 返回 true 表示这条指令的最后一个事件已经派发完。 */
    private boolean dispatch(SaveLoadScript.Instruction in) {
        switch (in.op) {
            case "enter":  enter(in.mode, in.from); return true;
            case "slot":   return clickSlot(in.n);
            case "escape": escape(); return true;
            default:
                fail("不认识的指令 " + in.op);
                return true;
        }
    }

    // ================= 三种输入 =================

    /**
     * 进面板。做的正是原版替它做的那三行（{@code FuncButtons} 的存档 / 提取两颗、
     * {@code StartPanel} 的「承」），一字不差、同一个顺序。那两处在这三行之前
     * 各自还做了自己面板上的事（出一声 {@code 换list.wav}、收起子按钮、停几个
     * 动画），那些属于**进来之前那个面板**，不在这份真值里。
     */
    private void enter(String mode, String from) {
        String now = currentName();
        if (!now.equals(from)) {
            fail("enter from=" + from + "，可当前面板是 " + now + " —— 原版只有站在那个面板上才走得到这三行");
        }
        ls.setLastPanel(from);
        ls.changeStateTo(mode.equals("save") ? LoadAndSavePanel.SAVE : LoadAndSavePanel.LOAD);
        GameLauncher.switchTo("ls");
        enters++;
        pending.add("{\"e\":\"enter\",\"mode\":" + Json.str(mode) + ",\"from\":" + Json.str(from) + "}");

        // changeStateTo 每调一次就再挂一对监听器（原版缺陷，不修）。派发给全部
        // 监听器才等价于 Swing；而这里核一遍对数，是为了让「有人改了接线」响出来，
        // 不是安安静静地多派或少派一次。
        int want = 1 + enters;
        if (ls.getMouseListeners().length != want || ls.getMouseMotionListeners().length != want) {
            fail("进过 " + enters + " 次面板，鼠标监听器应当各 " + want + " 个，实际 "
                    + ls.getMouseListeners().length + " / " + ls.getMouseMotionListeners().length);
        }
    }

    /**
     * 按下 / 松开第 n 个槽位的按钮。按下之后它必须 {@code isclicked}，松开之后必须
     * 不再 —— 点空了的剧本会导出一份步数正确、却什么都没发生的真值，而「点空槽读档
     * 什么都不发生」恰好是这份真值要记的一条路，两者只能靠这条核对分开。
     */
    private boolean clickSlot(int n) {
        requireOnPanel("slot");
        List<?> buttons = buttons();
        if (n >= buttons.size()) fail("第 " + n + " 个槽不存在，面板上只有 " + buttons.size() + " 个");
        Object button = buttons.get(n);
        String label = "slot:" + n;
        if (sub == 0) {
            point = center(button);
            mouse(MouseEvent.MOUSE_PRESSED, point, label);
            if (!getBool(button, "isclicked")) {
                fail(label + " 在 (" + point[0] + "," + point[1] + ") 按下后没有 isclicked —— 点空了");
            }
            return false;
        }
        mouse(MouseEvent.MOUSE_RELEASED, point, label);
        if (getBool(button, "isclicked")) fail(label + " 松开之后仍然 isclicked —— 松手事件没落在按钮上");
        return true;
    }

    /**
     * 退出键。原版的按键先到 {@code GameLauncher.keyPressed}，那里只在当前面板是
     * 存读档面板时才转给它 —— 这里照同一个条件判，不满足是硬失败。
     *
     * **回到标题画面这一支不做，硬失败。** {@code switchTo("start")} 里有一句
     * {@code Clock.sleep(1000)}（冻结倍率下是三万多年）和一句 {@code openBGM()}
     * —— 后者先 {@code play} 再把 {@code CAN_PLAY_BGM} 打开，而 {@code play} 开头
     * 又是一个 {@code Clock.sleep(10)} 的自旋。要么导出挂死，要么真的开音频设备
     * 放主题曲。要走它得先在导出器里把标题画面立起来，那是「跨面板端到端」的活。
     */
    private void escape() {
        requireOnPanel("escape");
        String back = (String) field(ls, "lastPanel");
        if ("start".equals(back)) {
            fail("退出键会回到标题画面（lastPanel=start），导出器不走这一支："
                    + "switchTo(\"start\") 里的 Clock.sleep(1000) 会挂死、openBGM() 会真的放音乐");
        }
        ls.keyPressed(KeyEvent.VK_ESCAPE);
        pending.add("{\"e\":\"key\",\"key\":\"escape\"}");
        if (!currentName().equals(back)) {
            fail("按了退出键，lastPanel=" + back + "，可当前面板是 " + currentName());
        }
    }

    private void requireOnPanel(String op) {
        if (GameLauncher.currentPanel != ls) {
            fail(op + " 只有在存读档面板上才收得到，当前面板是 " + currentName());
        }
    }

    private void mouse(int id, int[] p, String target) {
        MouseEvent e = new MouseEvent(ls, id, 0L, 0, p[0], p[1], 1, false, MouseEvent.BUTTON1);
        for (MouseListener l : ls.getMouseListeners()) {
            if (id == MouseEvent.MOUSE_PRESSED) l.mousePressed(e); else l.mouseReleased(e);
        }
        pending.add("{\"e\":" + (id == MouseEvent.MOUSE_PRESSED ? "\"press\"" : "\"release\"")
                + ",\"x\":" + p[0] + ",\"y\":" + p[1] + ",\"target\":" + Json.str(target) + "}");
    }

    /**
     * 命中中心。判据抄自 {@code StartButton.isPressedButton}：
     * {@code x-15 < cx < x+width-15 && y-6 < cy < y+height-6}，与 {@code GameButton}
     * 同一对历史偏移。
     */
    private static int[] center(Object button) {
        int x = getInt(button, "x"), y = getInt(button, "y");
        int w = getInt(button, "width"), h = getInt(button, "height");
        return new int[] { x - 15 + w / 2, y - 6 + h / 2 };
    }

    // ================= 起手 =================

    private void start() {
        guardDraft();

        // 顺序要紧：两件事都必须在任何一个面板被 new 出来之前。动画线程在各自
        // 构造函数里就 start()，缩放晚一步就有一条已经醒过。
        Clock.freezeTimers(FREEZE_BASE);
        Clock.setFactor(SLOW);
        MusicReader.closeBGM();
        MusicPlayer.CAN_PLAY_BGM = MusicPlayer.NO;
        MusicReader.closeMusic();

        tap = new PanelTap();
        GameLauncher.switcher = tap;

        BattlePanel bp = new BattlePanel();
        GameLauncher.battlePanel = bp;
        GameLauncher.zhangXiaoFan = new ZhangXiaoFan(560, 160, bp);
        GameLauncher.yuJie = new YuJie(750, 150, bp);
        GameLauncher.luXueQi = new LuXueQi(800, 330, bp);

        ScenePanel sp = new ScenePanel(null);
        GameLauncher.scenePanel = sp;
        if (script.setup.warmup != null) sp.initiation(script.setup.warmup);
        sp.initiation(script.setup.scene);

        SaveAndLoad.zhang = script.setup.party.contains("zhang");
        SaveAndLoad.lu = script.setup.party.contains("lu");
        SaveAndLoad.wen = script.setup.party.contains("wen");

        GameLauncher.menuPanel = new MenuPanel(GameLauncher.zhangXiaoFan, GameLauncher.luXueQi, GameLauncher.yuJie);
        // 背包那两份静态列表只有构造函数会填；不填的话商店构造与写档都会越界。
        new DrugPack();
        new EquipmentPack();
        GameLauncher.shopPanel = new ShopPanel();
        GameLauncher.equipmentShopPanel = new EquipmentShopPanel();

        // 标题画面的替身。原版的 GameLauncher.startPanel 是 StartPanel 类型，立它要
        // 起它自己的动画与定时器；而这份真值对它只有一件事要问 ——「当前是不是
        // 标题画面」（enter from=start 的前提）。退出键回标题那一支不走（见 escape()），
        // 所以 GameLauncher.startPanel 从头到尾没人读。
        startStandIn = new JPanel();

        // 空槽：删的是草稿区，收尾由关机钩子从真值目录写回。必须在建面板之前 ——
        // 面板构造函数里就 prepareScenes() 读了一遍盘。
        for (int n : script.setup.emptySlots) {
            File f = new File(SaveTruth.DRAFT_DIR, "存档" + n + ".txt");
            if (!f.isFile()) ExportTrace.die(script.name + "：setup.emptySlots 里的 " + n + " 在草稿区没有档可删：" + f.getPath());
            if (!f.delete()) ExportTrace.die(script.name + "：删不掉 " + f.getPath());
        }

        ls = new LoadAndSavePanel();
        GameLauncher.lsPanel = ls;
        if (ls.getMouseListeners().length != 1 || ls.getMouseMotionListeners().length != 1) {
            ExportTrace.die("LoadAndSavePanel 刚建好时鼠标监听器不是各一个（"
                    + ls.getMouseListeners().length + " / " + ls.getMouseMotionListeners().length
                    + "）—— 派发规则要重新对一遍");
        }
        for (int n : script.setup.emptySlots) {
            if (n >= buttons().size()) ExportTrace.die(script.name + "：setup.emptySlots 里的 " + n
                    + " 超出了面板的 " + buttons().size() + " 个槽");
        }

        // 顶替字段 t（见类注释「拦截」）。原版在字段初值里就 new 了它、从没 start 过。
        if (((Thread) field(ls, "t")).getState() != Thread.State.NEW) {
            ExportTrace.die("LoadAndSavePanel.t 在建好时已经不是 NEW —— 原版的接线变了");
        }
        sceneLoopStandIn = new Thread(SaveLoadDriver::parkForever, "scene-loop-stand-in");
        sceneLoopStandIn.setDaemon(true);
        setField(ls, "t", sceneLoopStandIn);

        String first = script.steps.get(0).from;
        GameLauncher.currentPanel = first.equals("menu") ? GameLauncher.menuPanel : startStandIn;

        sink = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB).getGraphics();

        // 这个面板自己一声都不出（LoadAndSavePanel 里没有 readmusic），读档那一下
        // 走的 readBGM 是背景音乐、不是音效。所以「必须响过」那道检查对它不适用 ——
        // 照样装观察点：哪天读档路径上真出了一声，真值会记下来。
        MusicTap.armAllowingSilence(script.name);
    }

    private static void parkForever() {
        while (true) LockSupport.park();
    }

    /**
     * 起手核草稿区、挂还原钩子。见类注释「写盘」一节。
     *
     * 写回用的是**真值目录里的字节**，不是起手时拷的备份：前面那条核对已经证明
     * 两者逐字节相同，而真值目录是 {@code SaveDraftIntactTest} 拿来对的那一份。
     * 权限位是起手时从草稿区读下来的。
     */
    private void guardDraft() {
        List<String> problems;
        try {
            problems = SaveTruth.draftProblems();
        } catch (IOException e) {
            ExportTrace.die("读不了草稿区或存档真值：" + e);
            return;
        }
        if (!problems.isEmpty()) {
            ExportTrace.die(script.name + "：草稿区与存档真值对不上，拒绝运行（上一次导出没还原？）：\n  "
                    + String.join("\n  ", problems));
        }
        final Map<String, byte[]> bytes = new LinkedHashMap<>();
        final Map<String, Set<PosixFilePermission>> perms = new LinkedHashMap<>();
        try {
            for (String name : SaveTruth.saveNames(SaveTruth.TRUTH_DIR)) {
                bytes.put(name, Files.readAllBytes(new File(SaveTruth.TRUTH_DIR, name).toPath()));
                perms.put(name, Files.getPosixFilePermissions(new File(SaveTruth.DRAFT_DIR, name).toPath()));
            }
        } catch (IOException e) {
            ExportTrace.die("读不了存档真值：" + e);
        }
        Runtime.getRuntime().addShutdownHook(new Thread(() -> restoreDraft(bytes, perms), "restore-save-draft"));
    }

    private static void restoreDraft(Map<String, byte[]> bytes, Map<String, Set<PosixFilePermission>> perms) {
        try {
            for (String extra : SaveTruth.saveNames(SaveTruth.DRAFT_DIR)) {
                if (!bytes.containsKey(extra)) Files.delete(new File(SaveTruth.DRAFT_DIR, extra).toPath());
            }
            for (Map.Entry<String, byte[]> e : bytes.entrySet()) {
                java.nio.file.Path p = new File(SaveTruth.DRAFT_DIR, e.getKey()).toPath();
                Files.write(p, e.getValue());
                Files.setPosixFilePermissions(p, perms.get(e.getKey()));
            }
            List<String> left = SaveTruth.draftProblems();
            if (left.isEmpty()) return;
            System.err.println("[SaveLoadDriver] 草稿区写回之后仍与存档真值不同：\n  " + String.join("\n  ", left));
        } catch (IOException | RuntimeException e) {
            System.err.println("[SaveLoadDriver] 草稿区还原失败：" + e);
        }
        // 关机钩子里 System.exit 会死锁；halt 直接改写退出码。
        Runtime.getRuntime().halt(3);
    }

    // ================= 快照 =================

    /** 这一步之后面板的缓冲图（{@code LoadAndSavePanel.background}）。 */
    @Override
    public BufferedImage snapshotImage() {
        Image img = (Image) field(ls, "background");
        if (!(img instanceof BufferedImage)) fail("LoadAndSavePanel.background 不是 BufferedImage");
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
     *   <li>{@code current} —— 当前是哪块面板，用 {@code switchTo} 的那套名字
     *       （ls / menu / start / scene），按对象同一性认；
     *   <li>{@code mode} —— 面板处于存还是读（{@code LoadAndSavePanel.PanelState}）；
     *   <li>{@code lastPanel} —— 进来之前是哪块，退出键回哪去；
     *   <li>{@code slots} —— 每个槽的摘要：原版画出来的正是这三样。{@code roles} 照抄
     *       {@code isRoleExist} 的原值 —— {@code prepareScenes} 只把它往 1 置、从不清零，
     *       于是一个槽被覆盖成更少的人之后，摘要里仍然留着旧档的人（原版缺陷，照记）；
     *   <li>{@code intercept} —— 这一步拦下来的跨面板动作：切到哪块卡片、有没有起
     *       那条场景循环（见类注释）。
     * </ul>
     *
     * 动画帧号与鼠标坐标**不记**，理由见类注释。存档文件的内容也不记：那是数据层
     * 真值的事，记进每一步等于同一件事验很多遍。
     */
    @Override
    public String snapshotState(int index) {
        StringBuilder b = new StringBuilder();
        b.append("{\"t\":").append(index);
        b.append(",\"ip\":").append(at);
        b.append(",\"input\":[").append(String.join(",", pending)).append("]");
        b.append(",\"music\":").append(MusicTap.json());
        b.append(",\"current\":").append(Json.str(currentName()));
        b.append(",\"mode\":").append(Json.str(LoadAndSavePanel.PanelState == LoadAndSavePanel.SAVE ? "save" : "load"));
        b.append(",\"lastPanel\":").append(Json.str((String) field(ls, "lastPanel")));
        b.append(",\"slots\":").append(slotsJson());
        b.append(",\"intercept\":{\"card\":").append(Json.str(card))
         .append(",\"sceneLoopStart\":").append(sceneLoopStart).append('}');
        return b.append('}').toString();
    }

    @SuppressWarnings("unchecked")
    private String slotsJson() {
        int[][] roles = (int[][]) field(ls, "isRoleExist");
        List<String> maps = (List<String>) field(ls, "maps");
        List<String> tasks = (List<String>) field(ls, "tasks");
        int n = buttons().size();
        if (maps.size() != n || tasks.size() != n || roles.length != n) {
            fail("槽位数对不上：按钮 " + n + " 个、地图 " + maps.size() + " 条、任务 " + tasks.size()
                    + " 条、人物表 " + roles.length + " 行");
        }
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < n; i++) {
            if (i > 0) b.append(',');
            b.append("{\"roles\":[");
            for (int j = 0; j < roles[i].length; j++) {
                if (j > 0) b.append(',');
                b.append(roles[i][j] == 1);
            }
            b.append("],\"map\":").append(Json.str(maps.get(i)));
            b.append(",\"task\":").append(Json.str(tasks.get(i))).append('}');
        }
        return b.append(']').toString();
    }

    /** 当前面板的名字，按对象同一性认。认不出是硬失败，不编一个。 */
    private String currentName() {
        JPanel c = GameLauncher.currentPanel;
        if (c == ls) return "ls";
        if (c == GameLauncher.menuPanel) return "menu";
        if (c == GameLauncher.scenePanel) return "scene";
        if (c == startStandIn) return "start";
        fail("当前面板认不出来：" + (c == null ? "null" : c.getClass().getName()));
        return "?";
    }

    private List<?> buttons() { return (List<?>) field(ls, "buttons"); }

    // ================= 反射 =================

    private static Field find(Object o, String name) {
        for (Class<?> c = o.getClass(); c != null; c = c.getSuperclass()) {
            try {
                Field f = c.getDeclaredField(name);
                f.setAccessible(true);
                return f;
            } catch (NoSuchFieldException e) {
                // 往父类找
            }
        }
        throw new IllegalStateException("没有字段 " + name + " on " + o.getClass());
    }

    private static Object field(Object o, String name) {
        try {
            return find(o, name).get(o);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void setField(Object o, String name, Object v) {
        try {
            find(o, name).set(o, v);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        }
    }

    private static int getInt(Object o, String name) { return (Integer) field(o, name); }

    private static boolean getBool(Object o, String name) { return (Boolean) field(o, name); }
}
