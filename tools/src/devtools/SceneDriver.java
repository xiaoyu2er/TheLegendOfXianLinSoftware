package devtools;

import java.awt.Graphics;
import java.awt.Image;
import java.awt.event.KeyEvent;
import java.awt.image.BufferedImage;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import javax.swing.Timer;

import main.GameLauncher;
import media.MusicPlayer;
import scene.NPC;
import scene.ScenePanel;
import tools.Clock;

/**
 * 场景面板的驱动器：{@link TraceDriver} 目前唯一的实现。
 *
 * 一步 = 一个 tick，固定顺序 **输入 → 定时器 → step() → paint()**。
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
 *      三者的相对顺序本来就是竞态的。这里固定为上面那一条，
 *      这个顺序就是 Web 侧要对齐的语义。
 *   4. 绘制。原版的 paint() 有副作用（对话里的 '@' / '$' 会改状态机），
 *      所以每 tick 真的调一次 paint()，画进一张离屏图，不省。
 *   5. 反射字段顺序。Class.getDeclaredFields() 的顺序未经规范保证，
 *      这里一律按字段名排序后再用。
 */
public final class SceneDriver implements TraceDriver {

    /** 冻结基数：24 小时。真实 TimerQueue 在一次导出里绝无可能走到。 */
    private static final long FREEZE_BASE = 24L * 60 * 60 * 1000;

    /**
     * 立战斗面板时把 {@code Clock} 的倍率压到这个数，好让 {@code BattlePanel.run()}
     * 头一句 {@code Clock.sleep(100)} 变成约 11 天 —— 那条线程从此停在那里，
     * 一次循环体都跑不了。与 {@code BattleDriver.FREEZE_FACTOR} 是同一个数、
     * 同一个用法，但**两支驱动器不共用**：战斗那边要把它调回来接着跑，场景这边
     * 是一停到底。
     */
    private static final double BATTLE_PARK_FACTOR = 1e-9;

    /** 等那条线程真的睡下去最多等多久（毫秒）。等不到是硬失败。 */
    private static final long BATTLE_PARK_TIMEOUT_MS = 30000;

    private final TraceScript script;
    private final VirtualClock clock = new VirtualClock();
    private final List<VirtualTimer> timers = new ArrayList<>();
    private ScenePanel sp;
    private Graphics sink;
    /** 面板跳转观察点。三扇门（药店 / 装备超市 / 战斗）唯一的可断言事实。 */
    private PanelTap tap;

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
    private String sceneAtEntry;               // 进入当前指令时所在的场景（exitTo 用）
    private int boxesOpenedAtEntry;            // 进入 openBox 时已经开过几个宝箱
    private final List<String> pending = new ArrayList<>();   // 本 tick 的输入事件
    private int pressesThisTick;               // 本 tick 已经按下过几次键（松手不算）

    private boolean started;    // start() 是否已经跑过
    private int ticks;          // 已经产出的 tick 数（只用于 maxTicks 判据）

    SceneDriver(TraceScript script) { this.script = script; }

    private void fail(String msg) {
        String where = ip < script.steps.size()
                ? "第 " + ip + " 条指令 " + script.steps.get(ip).op
                : "剧本末尾";
        ExportTrace.die(script.name + " · " + where + " · tick " + (clock.now() / script.tickMs) + "：" + msg);
    }

    /**
     * 判别名。场景真值的 `driver` 字段就是这个字符串，回放端照它装配。
     *
     * 常量而不是从剧本里读：一份 trace 是哪个驱动器导出来的，是导出这件事本身
     * 的属性。让剧本说了算的话，剧本写错就会导出一份自称是别的面板、内容却是
     * 场景的真值 —— 那种错在回放端表现为"装配对不上"，而不是"导出失败"。
     */
    @Override
    public String kind() { return "scene"; }

    // ================= 推进一步 =================

    @Override
    public boolean step() {
        // 时钟在**上一步的快照取完之后**才走。放到取快照之前，导出的 vt
        // 会整体偏一个 tick，而每一行看上去都仍然规整。
        if (started) clock.advance(script.tickMs); else { start(); started = true; }
        if (ip >= script.steps.size()) return false;
        if (ticks >= script.maxTicks) fail("超过剧本的 maxTicks=" + script.maxTicks + "，剧本没有跑完");
        pending.clear();
        pressesThisTick = 0;
        advanceScript();
        if (ip >= script.steps.size() && pending.isEmpty()) return false;  // 最后一条指令在本 tick 之初就完成了

        requireExitAnnounced();
        fireTimers();
        sp.step();
        sp.paint(sink);
        // 场景可能刚在 step() 里被重新初始化。新对象图上的定时器要**在这一
        // tick 的时钟上**接管：原版 NPC 的两个定时器是在构造函数里 start()
        // 的，起算点就是构造那一刻。放到 clock.advance() 之后再装，它们会晚
        // 一个 tick 到期 —— dorm-exit 里 13 个 NPC 集体晚 10 ms 起步，
        // 而那正是"两端差一个 tick"最难查的形态。
        installTimers();
        ticks++;
        return true;
    }

    /** 起手：冻结真实定时器、掐掉出声、建面板、进场景。只跑一次。 */
    private void start() {
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

        // 观察点要在建面板之前装好：切面板这件事是原版自己在按键分发里做的，
        // 装晚了就有一段"切了而没人记"的窗口，而那段窗口里的失败长得像成功。
        tap = new PanelTap();
        GameLauncher.switcher = tap;
        if (needsBattlePanel()) standUpBattlePanel();

        sp = new ScenePanel(null);
        GameLauncher.scenePanel = sp;
        GameLauncher.currentPanel = sp;

        // 预热：96 个场景里有 20 个没有 Dialogue 段，它们依赖前一个场景残留的
        // dialogueEvent 对象才能跑；直接 initiation 进去会 NPE。
        if (script.warmup != null) sp.initiation(script.warmup);
        if (script.load != null) {
            loadFromSave();
        } else {
            sp.initiation(script.scene);
            sp.isScript = script.isScript;
        }

        sink = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB).getGraphics();
        installTimers();
    }

    /**
     * 这份剧本要不要一个真的战斗面板 —— **从剧本自己推导，不加字段**：
     * 有一条 {@code awaitExit} 指着 {@code battlePanel} 就要。
     *
     * 为什么只有战斗那扇门要：药店与装备超市那两支
     * （{@code SelectEvent.keyPressed} 里的 shopSelect / equipmentSelect）
     * 直接就是一句 {@code GameLauncher.switchTo(...)}，观察点接住就完了。
     * 战斗那一支在切之前先跑 {@code fightEvent.fight(...)}，而那里面有一句
     * <b>不判空</b>的 {@code GameLauncher.battlePanel.initial(...)}。没有面板的
     * 表现不是"这一扇门没接住"，是一条 NPE ——
     * 而它抛在原版的按键分发里，导出当场少掉后面所有的拍。
     */
    private boolean needsBattlePanel() {
        for (TraceScript.Instruction in : script.steps) {
            if (in.op.equals("awaitExit") && "battlePanel".equals(in.panel)) return true;
        }
        return false;
    }

    /**
     * 把战斗面板与我方三人立起来，好让战斗那扇门走得到 {@code switchTo("battle")}。
     *
     * <b>立起来的东西一拍都不会跑。</b> {@code BattlePanel} 的构造函数最后一句
     * 就把 {@code run()} 线程起来了，而那条线程的循环体第一句是
     * {@code Clock.sleep(100)}。这里先把倍率压到 {@link #BATTLE_PARK_FACTOR}
     * 再构造，那一句于是变成约 11 天 —— 线程停在那儿，一次循环体都跑不了；
     * 等它**真的睡下去**之后才把倍率放回来。
     *
     * ⚠️ 「等它真的睡下去」不是保险起见：{@code Thread.start()} 之后那条线程什么
     * 时候读到 {@code Clock.factor} 是竞态的。放回倍率放早了，它读到的是 1.0，
     * 于是每 100ms 醒一次、在一个 {@code initial()} 都还没跑过的面板上
     * {@code update()} —— 那条 NPE 会静静地杀掉线程（原版的 try/catch 只包住
     * sleep），而两次导出会因此不一样。判据是 {@code --check}。
     *
     * 三个人**无论出不出战都建**：原版 {@code GameLauncher.init()} 就是这么做的，
     * 而 {@code FightEvent.fight} 按 Fight 数据那一行挑谁上场，挑的就是这三个
     * public static 引用。
     */
    private void standUpBattlePanel() {
        double saved = Clock.getFactor();
        Clock.setFactor(BATTLE_PARK_FACTOR);
        battle.BattlePanel bp = new battle.BattlePanel();
        awaitParked(bp);
        Clock.setFactor(saved);
        GameLauncher.battlePanel  = bp;
        GameLauncher.zhangXiaoFan = new battle.ZhangXiaoFan(560, 160, bp);
        GameLauncher.yuJie        = new battle.YuJie(750, 150, bp);
        GameLauncher.luXueQi      = new battle.LuXueQi(800, 330, bp);
    }

    /**
     * 等 {@code BattlePanel.run()} 那条线程停进 {@code Thread.sleep} 里。
     *
     * 按**栈**认线程而不是按名字（名字是 "Thread-N"，编号取决于这个 JVM 之前建过
     * 几条线程），做法照抄 {@code BattleDriver.findLoopThread}。等到超时是硬失败：
     * 一条没睡下去的线程会让两次导出不一样，而"偶尔不一样"比"每次都错"难查得多。
     */
    private void awaitParked(battle.BattlePanel bp) {
        long deadline = System.currentTimeMillis() + BATTLE_PARK_TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline) {
            Thread t = findBattleLoopThread();
            if (t != null && t.getState() == Thread.State.TIMED_WAITING) return;
            Thread.yield();
        }
        ExportTrace.die(script.name + "：等了 " + BATTLE_PARK_TIMEOUT_MS
                + "ms，BattlePanel.run() 那条线程还没停进 sleep —— 立不住一个不会跑的战斗面板");
    }

    private Thread findBattleLoopThread() {
        Thread found = null;
        for (java.util.Map.Entry<Thread, StackTraceElement[]> e : Thread.getAllStackTraces().entrySet()) {
            for (StackTraceElement st : e.getValue()) {
                if (st.getClassName().equals("battle.BattlePanel") && st.getMethodName().equals("run")) {
                    // 不止一条就是硬失败，与 BattleDriver.findLoopThread 同一条规矩
                    // （/code-review 提的：照抄的时候把这道守卫抄漏了）。一次场景
                    // 导出只该立一个战斗面板；立了两个的话，等到的那条可能不是
                    // 后面真正被 initial() 的那条 —— 而"等错了线程"与"等对了"
                    // 在倍率放回去那一刻长得一模一样。
                    if (found != null && found != e.getKey()) {
                        ExportTrace.die("找到不止一条 BattlePanel.run() 线程 —— 一次场景导出只立一个战斗面板");
                    }
                    found = e.getKey();
                }
            }
        }
        return found;
    }

    // ================= 读档起手（xl-i06.10） =================

    /**
     * 照原版读档那一下走：{@code LoadAndSavePanel.setButton()} 的读档分支是
     * {@code loader.load(i)} → {@code if(!t.isAlive()) t.start()} → {@code switchTo("scene")}。
     * 中间那句多起一条场景循环是 M6 唯一不复刻的一条（本驱动器本来就不起那条线程，
     * 一 tick 一次 {@code step()}），另两句一字不差照做。
     *
     * <p>{@code Loader.load} 读写的是 {@code GameLauncher} 上那一整排 public static：
     * 三个英雄（{@code loadRoleInfo}）、场景（{@code sal.loadSceneInfo}）、菜单装备页
     * （{@code initialEquipInfo}）、药店（{@code initialShopInfo}）、装备店
     * （{@code initialEquipmentShopInfo}）。所以那几块先立起来 —— 立法同
     * {@link SaveLoadDriver#start()}，但**倍率要放回来**：场景这边的定时器是
     * {@code Clock.delay()} 算出来再反算的（{@link #installTimers()}），倍率停在 1e-9
     * 的话每一个都反算不出来。
     *
     * <p>它读的是**草稿区**（{@code sources/Record/}，原版写死的路径）。草稿区与真值
     * 逐字节不同就拒绝运行 —— 读一份来路不明的档，导出的就是一份来路不明的真值。
     */
    private void loadFromSave() {
        standUpLoadTargets();
        List<String> problems;
        try {
            problems = SaveTruth.draftProblems();
        } catch (java.io.IOException e) {
            fail("读不了草稿区或存档真值：" + e);
            return;
        }
        if (!problems.isEmpty()) {
            fail("草稿区与存档真值对不上，拒绝读档（上一次导出没还原？）：\n  " + String.join("\n  ", problems));
        }
        java.io.File save = new java.io.File(SaveTruth.DRAFT_DIR, "存档" + script.load + ".txt");
        // Loader.loadLine 读不到文件只打一行栈、交回空列表，接着 get(0) 抛 —— 先在这里说清楚。
        if (!save.isFile()) fail("load=" + script.load + "，草稿区没有这个档：" + save.getPath());

        int tapBefore = tap.count();
        new start.Loader().load(script.load);
        GameLauncher.switchTo("scene");
        if (tap.count() - tapBefore != 1 || !"scenePanel".equals(tap.consume())) {
            fail("读档之后 switchTo(\"scene\") 应当恰好切一次、切到 scenePanel");
        }
        if (!script.scene.equals(sp.fileName)) {
            fail("剧本写 scene=" + script.scene + "，可存档" + script.load + " 读出来的是 " + sp.fileName);
        }
        if (script.isScript != sp.isScript) {
            fail("剧本写 isScript=" + script.isScript + "，可存档" + script.load + " 读出来的是 " + sp.isScript);
        }
    }

    /**
     * {@code Loader.load} 要写的那几块面板。菜单与两家店的构造函数都起 {@code while(true)}
     * 线程、第一句就是 {@code Clock.sleep}：先把倍率压到 {@link #BATTLE_PARK_FACTOR}
     * 再构造，等**每一条新起的游戏线程**都停进 {@code Clock.sleep} 之后再放回来
     * （理由同 {@link #standUpBattlePanel()} 那段「等它真的睡下去」）。
     */
    private void standUpLoadTargets() {
        if (GameLauncher.battlePanel == null) standUpBattlePanel();
        Set<Thread> before = new HashSet<>(Thread.getAllStackTraces().keySet());
        double saved = Clock.getFactor();
        Clock.setFactor(BATTLE_PARK_FACTOR);
        // 菜单与商店会出音效（换页、点按钮）；这份真值只记背景音乐。
        media.MusicReader.closeMusic();
        GameLauncher.menuPanel = new menu.MenuPanel(GameLauncher.zhangXiaoFan, GameLauncher.luXueQi, GameLauncher.yuJie);
        // 背包那两份静态列表只有构造函数会填（同 SaveLoadDriver.start()）。
        new shop.DrugPack();
        new shop.EquipmentPack();
        GameLauncher.shopPanel = new shop.ShopPanel();
        GameLauncher.equipmentShopPanel = new shop.EquipmentShopPanel();
        awaitNewThreadsParked(before);
        Clock.setFactor(saved);
    }

    /** 新起的线程里凡是跑着游戏代码的，都得停在 {@code tools.Clock.sleep} 里。等不到是硬失败。 */
    private void awaitNewThreadsParked(Set<Thread> before) {
        long deadline = System.currentTimeMillis() + BATTLE_PARK_TIMEOUT_MS;
        while (true) {
            List<String> busy = new ArrayList<>();
            for (Map.Entry<Thread, StackTraceElement[]> e : Thread.getAllStackTraces().entrySet()) {
                Thread t = e.getKey();
                if (before.contains(t) || !runsGameCode(e.getValue())) continue;
                if (t.getState() == Thread.State.TIMED_WAITING && inClockSleep(e.getValue())) continue;
                busy.add(t.getName() + "(" + t.getState() + ")");
            }
            if (busy.isEmpty()) return;
            if (System.currentTimeMillis() > deadline) {
                fail("等了 " + BATTLE_PARK_TIMEOUT_MS + "ms，这几条线程还没停进 Clock.sleep：" + busy);
            }
            Thread.yield();
        }
    }

    private static boolean runsGameCode(StackTraceElement[] stack) {
        for (StackTraceElement st : stack) {
            String c = st.getClassName();
            if (c.startsWith("menu.") || c.startsWith("shop.") || c.startsWith("battle.")
                    || c.startsWith("start.") || c.startsWith("scene.") || c.startsWith("media.")) return true;
        }
        return false;
    }

    private static boolean inClockSleep(StackTraceElement[] stack) {
        for (StackTraceElement st : stack) {
            if (st.getClassName().equals("tools.Clock") && st.getMethodName().equals("sleep")) return true;
        }
        return false;
    }

    // ================= 快照位图 =================

    /** 原版这一 tick 真的画出来的那张 1024×640 位图（ScenePanel.backImage）。 */
    @Override
    public BufferedImage snapshotImage() {
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
        return b;
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
                sceneAtEntry = sp.fileName;
                left = in.op.equals("wait") ? in.ticks
                     : in.op.equals("advance") ? in.times
                     : in.op.equals("advanceAll") ? in.max
                     : in.op.equals("cursor") ? in.times : 0;
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
            case "exitTo":
                // 场景真的换掉了才算完。换掉的那一刻主角对象已经被 initiation
                // 换成新的一个（站在 entrance 上、定时器全停），所以按着的那个
                // 方向键要在这里松掉 —— 松手事件照样进 input，Web 侧照着回放。
                if (!sp.fileName.equals(sceneAtEntry)) {
                    if (pressedKey != -1) { release(pressedKey); pressedKey = -1; }
                    return true;
                }
                if (moveTo(in, false)) {
                    // 走到了出口格而场景没换。不拦的话导出的是一份"人站在门口、
                    // 一切正常"的 trace ——出口没生效与出口生效了长得一模一样。
                    fail("走到了 (" + in.x + "," + in.y + ") 而场景仍是 " + sp.fileName
                            + " —— 这一格不是出口，或者出口没有生效");
                }
                return false;
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
            case "select":
                if (phase == 0) { pressSpace(); phase = 1; return false; }
                // 没弹出来就得响。checkSelectEvent 是同步的，按完这一 tick 就该
                // isSelect=true；不拦的话，一次差一格的 walkTo 会导出一份干干净净、
                // 退出码 0、却一个选择框都没有的 trace。
                if (!selectActive()) {
                    fail("按了空格但没有弹出选择框，主角在 (" + role().getX() + ","
                            + role().getY() + ") —— 旁边没有带选择事件的 NPC，或者它不在停下的那一格上");
                }
                // 同一下空格把某个 NPC 的口头语也说起来了（checkNPCOral 对每个
                // NPC 都走一遍，选择事件不中的那些会 sayOral）。之后
                // ScenePanel.keyPressed 的分发就整个改道去 npcEvent.keyPress，
                // cursor / confirm 全被对话吞掉 —— **而吞掉与按下去长得一样**。
                if (dialogueActive()) {
                    fail("弹出选择框的同一下空格还说起了 NPC 口头语 —— 之后的按键会被对话吞掉");
                }
                return true;
            case "cursor":
                if (left == 0) return true;
                if (!selectActive()) fail("选择框已经不在了，还剩 " + left + " 次光标没按");
                press(cursorKey(in), false);
                left--;
                return false;
            case "confirm":
                if (!selectActive()) fail("选择框不在，按回车什么都选不中");
                press(KeyEvent.VK_ENTER, false);
                // **按完当拍就算完**，与 talk / select 那种"下一拍再验"不同：
                // 三扇门的跳转就发生在这一下的按键分发里，而 awaitExit 必须在
                // 同一拍里把它接走 —— 拖到下一拍的话，本拍收尾的
                // requireExitAnnounced 会看见一次没人认领的跳转并当场硬失败。
                // 一拍里不会因此按两次键：press() 自己拦着（见那里）。
                return true;
            case "dismiss":
                if (phase == 0) { pressSpace(); phase = 1; return false; }
                if (selectActive()) fail("按了空格但选择系统还占着（isSelect 仍为真）");
                return true;
            case "awaitSelect":
                if (!selectActive()) fail("选择框不在，等不到它滑完");
                return !timerRunning(sp.selectEvent, "selectImageMove")
                        && !timerRunning(sp.selectEvent, "questionImageMove")
                        && !timerRunning(sp.selectEvent, "wordsRun");
            case "awaitExit":
                return awaitExit(in);
            case "openBox":
                if (phase == 0) {
                    boxesOpenedAtEntry = openedBoxes();
                    pressSpace();
                    phase = 1;
                    return false;
                }
                if (openedBoxes() != boxesOpenedAtEntry + 1) {
                    fail("按下去了但没有宝箱被打开（开过的宝箱数仍是 " + boxesOpenedAtEntry
                            + "），主角在 (" + role().getX() + "," + role().getY()
                            + ") —— 旁边没有还装着东西的宝箱");
                }
                // 开了箱却没弹提示框，等于东西给了而玩家看不见。TreasureBox.keyPressed
                // 里这两件事是同一个 if 里的两句，分开的那一天要红。
                if (!getBool(sp.equipmentEvent, "isDrawString")) {
                    fail("宝箱开了，却没有弹出「得到物品」的提示框");
                }
                return true;
            case "awaitPresent":
                if (!getBool(sp.equipmentEvent, "isDrawString")) fail("提示框不在，等不到它走完");
                return !timerRunning(sp.equipmentEvent, "presentImageMove")
                        && !timerRunning(sp.equipmentEvent, "wordsRun");
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
        // 一个 tick 最多按一次键。原版里按键在 EDT 上，两次按键之间必然隔着
        // 至少一次事件分发；一拍里按两下会让 Web 侧的回放无从展开
        // （trace 的 input 是一个数组，两条 press 谁先谁后没有别的依据），
        // 而那份 trace 看上去仍然规整。
        //
        // 数的是一个计数器，不是去 pending 里认那串 JSON 的前缀（/code-review
        // 的 Standards 轴提的）：那串 JSON 的写法一变，守卫就**静默地再也匹配
        // 不到**，而"这一拍没按两次"与"守卫失效了"长得一模一样。
        if (pressesThisTick > 0) {
            fail("同一个 tick 里按了两次键（本拍已经按过 " + pressesThisTick
                    + " 次，又要按 " + keyName(keyCode) + "）");
        }
        pressesThisTick++;
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
            case KeyEvent.VK_ENTER: return "enter";
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

    /** 选择系统占着没有 —— 就是 ScenePanel 用来挡走路、决定画不画的那个字段。 */
    private boolean selectActive() { return sp.selectEvent.isSelect; }

    private static int cursorKey(TraceScript.Instruction in) {
        return in.key.equals("down") ? KeyEvent.VK_DOWN : KeyEvent.VK_UP;
    }

    /**
     * 已经开过的宝箱数。{@code openBox} 拿它前后一减，判"这一下真的开出了一个"。
     *
     * 为什么不是"看 isDrawString 有没有变真"：答对/答错加扣金币走的是同一个提示框
     * （{@code SelectEvent} 里那两句 {@code equipmentEvent.drawString}），
     * 只看提示框的话，一份"站在宝箱旁边按空格、其实弹的是金币提示"的真值会通过。
     *
     * 没有宝箱段的场景返回 0（{@code treasureBoxes} 为 null）—— 那时 openBox
     * 的前后差必为 0，照样红。
     */
    private int openedBoxes() {
        Object boxes = get(sp.equipmentEvent, "treasureBoxes");
        if (boxes == null) return 0;
        int n = 0;
        for (Object box : (List<?>) boxes) if (getBool(box, "isEmpty")) n++;
        return n;
    }

    /**
     * 断言原版这一下把面板切到了哪一块，并把那次跳转**取走**。
     *
     * 场景这边是**当拍就判**的：三扇门都发生在 {@code confirm} 那一下的按键分发
     * 里，同步完成，所以走到这条指令时观察点上要么已经有名字、要么这一下压根没切。
     * 「切了别的一块」与「一次都没切」分开报，因为两者的成因完全不同：前者是
     * {@code SelectEvent} 里挑分支挑错了，后者多半是光标停在"否"上。
     *
     * <p>与 {@link #requireExitAnnounced()} 是同一条规则的两半：这里拦"该切而没切"，
     * 那里拦"切了而没人接"。改一处记得看另一处。
     */
    private boolean awaitExit(TraceScript.Instruction in) {
        String card = tap.card();
        if (card == null) {
            fail("原版一次都没切面板 —— 剧本要的出口是 " + in.panel
                    + "（选择框 " + (selectActive() ? "还开着" : "已经关了")
                    + "，是/否光标停在 " + getInt(sp.selectEvent, "count_selectYesNo") + "）");
        }
        if (!card.equals(in.panel)) {
            fail("剧本要的出口是 " + in.panel + "，原版切到的是 " + card);
        }
        tap.consume();
        standInForTargetPanel();
        return true;
    }

    /**
     * 门后面那块面板没被建出来时，给 {@code GameLauncher.currentPanel} 一个替身。
     *
     * {@code switchTo} 做的是两件事：{@code switcher.show(...)}（观察点接住了）
     * 与 {@code currentPanel = 那块面板}。第二件我们拦不住，而那三个 static 字段
     * 里只有 {@code battlePanel} 是立起来了的（{@link #standUpBattlePanel}，
     * 因为 {@code FightEvent.fight} 不判空地用它）。药店与装备超市那两块从没建过，
     * 于是 {@code currentPanel} 被写成 null，**下一句** {@code ScenePanel.step()}
     * 的 {@code currentPanel.equals(scenePanel)} 当场 NPE。
     *
     * <h3>为什么是替身而不是把那两块面板也立起来</h3>
     *
     * 那两个构造函数各起一条动画线程、各读一批图，而 xl-yg6.3 明写着不在导出器里
     * 把游戏启动器立起来 —— 立起来就要把四支已有驱动器的确定性前提全部重验。
     * 战斗面板是**被逼的**（那一句 NPE 挡在门前），这两块不是。
     *
     * <h3>替身够不够用：场景这边只读它一次，而且只问一个问题</h3>
     *
     * {@code ScenePanel.step()} 对 {@code currentPanel} 只有
     * {@code .equals(GameLauncher.scenePanel)} 这一处读取，问的是「现在显示的还是
     * 场景吗」。原版此刻的答案是「不是」，替身给出的也是「不是」（{@code JPanel}
     * 没有覆写 equals，比的是同一性）。**这不是把场景当成还在前台** ——
     * 恰恰相反，它保住的正是「已经不在前台了」这半个事实。
     */
    private void standInForTargetPanel() {
        if (GameLauncher.currentPanel == null) {
            GameLauncher.currentPanel = new javax.swing.JPanel();
        }
    }

    /**
     * 面板被切走了，而当前指令不是 {@code awaitExit} —— 硬失败。
     *
     * 没有这道检查时的失败形状：一份剧本按了回车就接着走路，而那一下其实进了
     * 商店；真值照样导出、退出码 0，"进店了"与"选了否"在里面长得一模一样
     * （{@code shopSelect} 两条路上都留着，{@code isSelect} 也一样）。
     * 切面板是一件**必须被剧本显式接住**的事。
     */
    private void requireExitAnnounced() {
        if (tap.card() == null) return;
        String op = ip < script.steps.size() ? script.steps.get(ip).op : "（剧本已结束）";
        if (!op.equals("awaitExit")) {
            fail("原版把面板切到了 " + tap.card() + "，而当前指令是 " + op
                    + " —— 切面板必须由 awaitExit 接住");
        }
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

    /**
     * 把一个 {@code ArrayList<Boolean>} 字段读成 JSON 数组。
     *
     * 不是 List 就抛，不静默返回 {@code []} —— 一个空数组与"读错了字段"
     * 在真值里长得一模一样，而这几张表（答过没 / 打过没）正是"全 false"
     * 最常见的形状。
     */
    private static String boolList(Object o, String name) {
        Object v = get(o, name);
        if (v == null) return "null";
        if (!(v instanceof List)) {
            throw new RuntimeException(name + " 不是 List，而是 " + v.getClass().getName());
        }
        return boolJson((List<?>) v);
    }

    /**
     * 一串 Boolean 摊成 JSON 数组。{@link #boolList} 与
     * {@link #answeredRecorder} 共用它 —— 两处原本各写了一份逐字同形的循环，
     * 而**只有其中一份带类型守卫**，那正是 /code-review 的 Standards 轴提的。
     *
     * 元素不是 Boolean 就抛（`(Boolean)` 那道强转），不静默给一个值。
     */
    private static String boolJson(List<?> list) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) b.append(',');
            b.append(((Boolean) list.get(i)).booleanValue());
        }
        return b.append(']').toString();
    }

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

    // ================= 快照状态 =================

    @Override
    public String snapshotState(int tick) {
        scene.Role r = role();
        Object oe = sp.otherEvent;

        StringBuilder b = new StringBuilder();
        b.append("{\"t\":").append(tick);
        b.append(",\"vt\":").append(clock.now());
        b.append(",\"ip\":").append(Math.min(ip, script.steps.size() - 1));
        b.append(",\"input\":[").append(String.join(",", pending)).append("]");
        // 当前场景与 ScenePanel.isScript：出口切换（xl-9bd.12）唯一的可断言事实。
        // 只记主角坐标的话，"切到了大地图" 与 "在宿舍里被瞬移到 (4,23)" 分不开。
        b.append(",\"scene\":").append(Json.str(sp.fileName));
        b.append(",\"isScript\":").append(sp.isScript);

        b.append(",\"role\":{\"x\":").append(r.getX())
         .append(",\"y\":").append(r.getY())
         .append(",\"px\":").append(r.getRealX())
         .append(",\"py\":").append(r.getRealY())
         .append(",\"dir\":").append(Json.str(dirName(r.getDirection())))
         .append(",\"frame\":").append(r.getCount())
         // count2 是跑步图的帧号（Role.drawHero 的 runImages.get(direction/2 + count2)）。
         // 它没有 getter，所以走反射读——只加导出，不动游戏逻辑。少了这一笔，
         // 「跑动中画的是哪一帧」在逐 tick 比对里完全看不见，只有像素流水线抓得到
         // （xl-u39）。get() 找不到字段是抛异常，不是给 0。
         .append(",\"runFrame\":").append(getInt(r, "count2"))
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

        b.append(",\"select\":").append(selectState());
        b.append(",\"treasure\":").append(treasureState());

        b.append(",\"audio\":{\"bgm\":").append(Json.str(bgm())).append("}");

        b.append(",\"viewport\":{\"offsetX\":").append(getInt(oe, "offsetX"))
         .append(",\"offsetY\":").append(getInt(oe, "offsetY"))
         .append(",\"firstTileX\":").append(getInt(oe, "firstTileX"))
         .append(",\"lastTileX\":").append(getInt(oe, "lastTileX"))
         .append(",\"firstTileY\":").append(getInt(oe, "firstTileY"))
         .append(",\"lastTileY\":").append(getInt(oe, "lastTileY"))
         .append("}");

        b.append(",\"drawOrder\":").append(Json.str(drawOrder()));
        if (script.load != null) appendLoadColumns(b);
        return b.append("}").toString();
    }

    /**
     * 读档剧本多记的七列（xl-i06.10）。**只在 {@code load} 剧本里记**：它们是读档回填
     * 的落点，普通剧本里全是出厂值，记进去是把十一份老真值整个重导一遍、每拍多几十个数，
     * 验的却是同一件事。
     *
     * <ul>
     *   <li>{@code progress} —— {@code loadSceneInfo} 回填的剧情进度：对话结束旗标与编号、
     *       剧情三元组、两个战斗计数（{@code isScript} / 文件名 / 坐标已经在别的列里）；
     *   <li>{@code partyFlags} —— {@code SaveAndLoad.zhang / lu / wen}（{@code Loader.load} 末三行）；
     *   <li>{@code heroes} —— 三个英雄 {@code intialFromInfo} 读回的七项，加上按等级重算、
     *       再被 {@code initialEquipInfo} 叠上装备加成的四项属性；
     *   <li>{@code skillNumber} —— {@code intialFromInfo} 按等级抬的那三个 static；
     *   <li>{@code worn} —— 菜单装备页 {@code heroEquipPack} 三格各六件的名字；
     *   <li>{@code drugs} / {@code coins} —— {@code initialShopInfo} 写回的药与钱；
     *   <li>{@code stock} —— 全局装备背包 {@code EquipmentPack} 六张表的件数。**读档不写它**
     *       （xl-1dv.32），记下来就是那条「读不回来」的真值。
     * </ul>
     */
    private void appendLoadColumns(StringBuilder b) {
        Object de = sp.dialogueEvent;
        Object fe = sp.fightEvent;
        b.append(",\"progress\":{\"dialogueEventOver\":").append(getBool(de, "dialogueEventOver"))
         .append(",\"dialogueOrder\":").append(getInt(de, "dialogueOrder"))
         .append(",\"currentScript\":").append(Json.arrStr(Arrays.asList(sp.currentScript)))
         .append(",\"nextScript\":").append(Json.arrStr(Arrays.asList(sp.nextScript)))
         .append(",\"battle1Over\":").append(getBool(fe, "battle1Over"))
         .append(",\"countOfBattle1\":").append(getInt(fe, "countOfBattle1"))
         .append("}");
        b.append(",\"partyFlags\":{\"zhang\":").append(scene.SaveAndLoad.zhang)
         .append(",\"lu\":").append(scene.SaveAndLoad.lu)
         .append(",\"wen\":").append(scene.SaveAndLoad.wen).append("}");
        Object[][] heroes = {
            { "zhang", GameLauncher.zhangXiaoFan },
            { "lu", GameLauncher.luXueQi },
            { "yu", GameLauncher.yuJie },
        };
        b.append(",\"heroes\":{");
        for (int i = 0; i < heroes.length; i++) {
            Object h = heroes[i][1];
            if (i > 0) b.append(',');
            b.append(Json.str((String) heroes[i][0])).append(":{");
            String[] ints = { "level", "exp", "hp", "mp", "angryValue", "physicalPower", "sprit", "agile", "strength" };
            for (int k = 0; k < ints.length; k++) {
                if (k > 0) b.append(',');
                b.append(Json.str(ints[k])).append(':').append(getInt(h, ints[k]));
            }
            b.append(",\"isAngry\":").append(getBool(h, "isAngry"))
             .append(",\"isDead\":").append(getBool(h, "isDead")).append('}');
        }
        b.append("}");
        b.append(",\"skillNumber\":{");
        for (int i = 0; i < heroes.length; i++) {
            if (i > 0) b.append(',');
            b.append(Json.str((String) heroes[i][0])).append(':').append(getInt(heroes[i][1], "skillNumber"));
        }
        b.append("}");
        b.append(",\"worn\":[");
        List<?> packs = (List<?>) get(GameLauncher.menuPanel.equipPanel, "heroEquipPack");
        String[] slots = { "weapon", "armor", "helmet", "shoe", "glove", "decoration" };
        for (int i = 0; i < packs.size(); i++) {
            if (i > 0) b.append(',');
            b.append('{');
            for (int k = 0; k < slots.length; k++) {
                if (k > 0) b.append(',');
                Object e = get(packs.get(i), slots[k]);
                b.append(Json.str(slots[k])).append(':')
                 .append(Json.str(e == null ? null : ((shop.Equipment) e).getName()));
            }
            b.append('}');
        }
        b.append("]");
        b.append(",\"drugs\":[");
        for (int i = 0; i < shop.DrugPack.drugList.size(); i++) {
            if (i > 0) b.append(',');
            b.append(shop.DrugPack.drugList.get(i).getNumberGOT());
        }
        b.append("]");
        b.append(",\"coins\":").append(shop.Money.getCoins());
        Object[][] stock = {
            { "helmet", shop.EquipmentPack.helmetList }, { "armor", shop.EquipmentPack.armorList },
            { "weapon", shop.EquipmentPack.weaponList }, { "glove", shop.EquipmentPack.gloveList },
            { "shoe", shop.EquipmentPack.shoeList }, { "decoration", shop.EquipmentPack.decorationList },
        };
        b.append(",\"stock\":{");
        for (int i = 0; i < stock.length; i++) {
            if (i > 0) b.append(',');
            b.append(Json.str((String) stock[i][0])).append(":[");
            List<?> list = (List<?>) stock[i][1];
            for (int k = 0; k < list.size(); k++) {
                if (k > 0) b.append(',');
                b.append(((shop.Equipment) list.get(k)).getNumberGOT());
            }
            b.append(']');
        }
        b.append("}");
    }

    /**
     * 选择框 / 答题那套状态机（xl-yg6.6）。**一列一个原版对象**，与
     * {@code dialogue}（Dialogue）、{@code narratage}（Narratage）、
     * {@code viewport}（OtherEvent）同构：这一列整个来自
     * {@code src/scene/SelectEvent.java}，一个字段都不跨对象取。
     *
     * <h3>只记会变的游标与旗标，不记静态文本</h3>
     *
     * 题面、选项文本、回答文本（{@code currentSentences}、{@code bufferedText}）
     * 一个都不进来：它们来自脚本，而脚本已经在数据层被逐字段钉住
     * （{@code tools/ground-truth/}）。再塞进每一拍是把同一件事验两次，
     * 而把体量翻几倍。**分工是：文本对不对归数据层，吐到第几个字归这里。**
     *
     * <h3>加了哪几个字段，各自对应源码里的哪一个</h3>
     *
     * 逐条从 GBK 源码现读（{@code iconv -f GBK src/scene/SelectEvent.java}）：
     *
     * <pre>
     *   active        ← isSelect              选择系统占用中；ScenePanel 靠它挡住走路
     *                                          （ScenePanel.keyPressed 的 if (!selectEvent.isSelect)）
     *                                          与决定画不画（paint 的 if (selectEvent.isSelect)）
     *   shop          ← shopSelect            四个"这是哪一种选择框"的旗标。**四个各记一个，
     *   equipShop     ← equipmentSelect        不合成一个枚举**：合成的话"两个同时为真"这种
     *   battle        ← battleSelect           原版本不该出现的状态会被悄悄压平成其中一个
     *   question      ← questionSelect
     *   asking        ← isQuestion            问题框阶段（选了"是"之后 showQuestion）
     *   answering     ← isAnswer              回答/结果框阶段（showAnswer）
     *   yesNo         ← count_selectYesNo     是/否光标。**原版取值是 2 和 3**（见 keyPressed
     *                                          里的 2↔3 互换与 drawSelectImage 的 i == 它），
     *                                          不是 0/1 —— 这里照原样记，不翻译一道
     *   abcd          ← count_selectABCD      A/B/C/D 光标。上下界都由题目自己的行数算出来
     *                                          （size()-5 .. size()-2）
     *   battleNo      ← count_battle2         这次问的是第几场战斗（checkSelectEvent 里定的下标）
     *   questionNo    ← count_questionAndAnswer 这次问的是第几道题
     *   boxW / boxH   ← x_selectImage / y_selectImage   选择框滑入的宽高游标：每 40ms +50/+15，
     *                                          **判据是自增前的 x &lt;= 500**，所以终值是
     *                                          550/165（不是 500/150），下一拍才停下起打字机
     *                                          —— 照跑了一遍那个循环体确认的
     *   qx1/qy1/qx2/qy2 ← x1/y1/x2/y2_questionImage     问题框从屏幕中心 (512,320) 每 50ms
     *                                          向四角各撑 25px，撑到 x1 &lt; 262 停
     *   sentenceNo    ← count_sentence        逐字打印吐到第几句（**初值 1**，第 0 句是 null 占位）
     *   wordNo        ← count_word            当前这句吐到第几个字
     *   lineNo        ← count_bufferedSentence 吐进 bufferedText 的第几行
     *   maxLength     ← maxLength             一行几个字：选择框 22、问题框 44。它**会变**
     *                                          （showQuestion 置 44，其余三个 show 置 22），
     *                                          所以是游标不是常量
     *   boxMoving     ← selectImageMove.isRunning()    选择框滑入定时器
     *   qBoxMoving    ← questionImageMove.isRunning()  问题框撑开定时器
     *   printing      ← wordsRun.isRunning()           逐字打印定时器
     *   answered      ← haveAnswered          这个场景每道题"答过没"。**跨"离开场景再回来"
     *                                          存活**：构造函数按 fileName 去 answeredRecorder
     *                                          里认领同一个 List 对象
     *   fought        ← haveFighted           每一场选择战斗"打过没"（打过之后 checkSelectEvent
     *                                          不再问）
     *   sceneNo       ← count_scene           这个场景在下面那张 recorder 里的下标。
     *                                          ⚠️ **只有有题的场景才是下标**：原版只在
     *                                          question != null 且认领到旧记录时才给它赋值，
     *                                          其余场景它就停在初值 0 —— 而那时 recorder
     *                                          可能非空（别的场景留下的），于是 0 指着别人
     *   recorder      ← SelectEvent.mapName / answeredRecorder（两张 static 表配对）
     *                                          "答过没"真正活在的地方。只有 answered 的话，
     *                                          一份走出去又走回来的真值里"记住了"与"重新
     *                                          问了一遍"要靠推断；记下这张表就直接可断言
     * </pre>
     *
     * <h3>answered 与 recorder 是同一份数据，为什么两个都记</h3>
     *
     * 有题的场景里 {@code haveAnswered} 就是 {@code answeredRecorder.get(count_scene)}
     * **同一个对象**（构造函数第一支认领的就是它），所以 {@code answered} 确实可以由
     * {@code recorder} + {@code sceneNo} 推出来 —— /code-review 的 Standards 轴提的。
     *
     * 两个都留，是因为**那条推导正是被守的东西之一**：原版靠"同一个对象"维持记忆，
     * 哪天有人把它改成拷贝一份，两列当场分岔，而只记其中一列的话这件事无声无息。
     * 加上上面那条 {@code sceneNo} 的警告 —— 无题场景里那条推导根本不成立 ——
     * 冗余那一列在这里是判据，不是重复。
     *
     * <h3>没有记的那一个，以及为什么</h3>
     *
     * {@code haveEnteredTheScene}：构造函数里置真、同一个 if 块里立刻置回假
     * （它只是那几行的临时量）。取快照的时机永远在构造之后，所以它**恒为
     * false** —— 记进来等于在每一拍上断言一个按构造成立的常量，那是装饰不是
     * 判据（{@code docs/agents/dispatch.md} 纪律 3 的第二族恒真判据）。
     */
    private String selectState() {
        Object se = sp.selectEvent;
        StringBuilder b = new StringBuilder();
        b.append("{\"active\":").append(getBool(se, "isSelect"))
         .append(",\"shop\":").append(getBool(se, "shopSelect"))
         .append(",\"equipShop\":").append(getBool(se, "equipmentSelect"))
         .append(",\"battle\":").append(getBool(se, "battleSelect"))
         .append(",\"question\":").append(getBool(se, "questionSelect"))
         .append(",\"asking\":").append(getBool(se, "isQuestion"))
         .append(",\"answering\":").append(getBool(se, "isAnswer"))
         .append(",\"yesNo\":").append(getInt(se, "count_selectYesNo"))
         .append(",\"abcd\":").append(getInt(se, "count_selectABCD"))
         .append(",\"battleNo\":").append(getInt(se, "count_battle2"))
         .append(",\"questionNo\":").append(getInt(se, "count_questionAndAnswer"))
         .append(",\"boxW\":").append(getInt(se, "x_selectImage"))
         .append(",\"boxH\":").append(getInt(se, "y_selectImage"))
         .append(",\"qx1\":").append(getInt(se, "x1_questionImage"))
         .append(",\"qy1\":").append(getInt(se, "y1_questionImage"))
         .append(",\"qx2\":").append(getInt(se, "x2_questionImage"))
         .append(",\"qy2\":").append(getInt(se, "y2_questionImage"))
         .append(",\"sentenceNo\":").append(getInt(se, "count_sentence"))
         .append(",\"wordNo\":").append(getInt(se, "count_word"))
         .append(",\"lineNo\":").append(getInt(se, "count_bufferedSentence"))
         .append(",\"maxLength\":").append(getInt(se, "maxLength"))
         .append(",\"boxMoving\":").append(timerRunning(se, "selectImageMove"))
         .append(",\"qBoxMoving\":").append(timerRunning(se, "questionImageMove"))
         .append(",\"printing\":").append(timerRunning(se, "wordsRun"))
         .append(",\"answered\":").append(boolList(se, "haveAnswered"))
         .append(",\"fought\":").append(boolList(se, "haveFighted"))
         .append(",\"sceneNo\":").append(getInt(se, "count_scene"))
         .append(",\"recorder\":").append(answeredRecorder());
        return b.append("}").toString();
    }

    /**
     * 那两张 static 表配对成 {@code [{"scene":…,"answered":[…]}]}。
     *
     * 两张表在原版里是**靠同一个下标**对起来的（构造函数里 mapName.add 与
     * answeredRecorder.add 总是成对执行），而"对不上"在这里是硬失败：
     * 长度不等时静静按短的那张截断，会导出一份看上去规整、却少了一整个场景
     * 的记忆表。
     */
    private String answeredRecorder() {
        List<String> names = scene.SelectEvent.mapName;
        List<ArrayList<Boolean>> rec = scene.SelectEvent.answeredRecorder;
        if (names.size() != rec.size()) {
            fail("SelectEvent.mapName 有 " + names.size() + " 项而 answeredRecorder 有 "
                    + rec.size() + " 项 —— 两张 static 表脱钩了");
        }
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < names.size(); i++) {
            if (i > 0) b.append(',');
            b.append("{\"scene\":").append(Json.str(names.get(i)))
             .append(",\"answered\":").append(boolJson(rec.get(i)))
             .append("}");
        }
        return b.append("]").toString();
    }

    /**
     * 宝箱与"得到物品"提示框（xl-yg6.6）。一列两个原版对象，因为它们本来就是
     * 一个：{@code src/scene/EquipmentEvent.java} 持有那批
     * {@code src/scene/TreasureBox.java}，而提示框是宝箱（以及答题加/扣钱）
     * 唯一的出口。
     *
     * <h3>加了哪几个字段，各自对应源码里的哪一个</h3>
     *
     * <pre>
     *   presenting  ← EquipmentEvent.isDrawString        提示框在不在场
     *   x           ← EquipmentEvent.x_presentImage      提示框滑到哪了，**进场与退场共用这一个
     *                                                    游标**，而两段的步长不一样（照跑了一遍
     *                                                    那个循环体确认的）：进场 -320 起每 50ms
     *                                                    +32，到 352 停下起打字机；退场重新
     *                                                    start() 之后**头一拍是 +64**（352 那一拍
     *                                                    三个 if 里第一个与第三个都成立），此后
     *                                                    每拍 +32，终值 1056，再下一拍才停
     *   wordNo      ← EquipmentEvent.count_word          那句话吐到第几个字（每 100ms 一个）
     *   moving      ← presentImageMove.isRunning()       滑入/滑出定时器
     *   printing    ← wordsRun.isRunning()               逐字打印定时器
     *   boxes[].empty ← TreasureBox.isEmpty              开过没（开过就画 emptyBox，且不再给东西）
     *   boxes[].near  ← TreasureBox.AroundHero           主角在不在它四邻。⚠️ 原版**只置真、
     *                                                    从不置回假**（checkHero 里没有 else），
     *                                                    走开之后照样是真 —— 这是原版的行为，
     *                                                    照记不修
     * </pre>
     *
     * <h3>没有记的那两个，以及为什么</h3>
     *
     * {@code text} / {@code bufferedText}：提示语本身。物品名来自脚本（数据层
     * 已经逐字段钉住），而数量与金额是 {@code Math.random()} 现掷的 —— 把它
     * 记进真值等于让这一列每次导出都不同，{@code --check} 当场红。吐到第几个
     * 字由 {@code wordNo} 记着，那才是行为层的事。
     *
     * {@code TreasureBox.x/y}：宝箱格子坐标，来自脚本的 TreasureBox 段，静态。
     *
     * <h3>没有宝箱段的场景</h3>
     *
     * {@code treasureBoxes} 为 {@code null}（构造函数只在 treasureBox != null
     * 时才建），这里照记 {@code null}，不摊平成 {@code []} —— "这个场景没有
     * 宝箱"与"有宝箱但一个都没建出来"必须分得开。
     */
    private String treasureState() {
        Object ee = sp.equipmentEvent;
        StringBuilder b = new StringBuilder();
        b.append("{\"presenting\":").append(getBool(ee, "isDrawString"))
         .append(",\"x\":").append(getInt(ee, "x_presentImage"))
         .append(",\"wordNo\":").append(getInt(ee, "count_word"))
         .append(",\"moving\":").append(timerRunning(ee, "presentImageMove"))
         .append(",\"printing\":").append(timerRunning(ee, "wordsRun"))
         .append(",\"boxes\":");
        Object boxes = get(ee, "treasureBoxes");
        if (boxes == null) {
            b.append("null");
        } else {
            b.append('[');
            List<?> list = (List<?>) boxes;
            for (int i = 0; i < list.size(); i++) {
                if (i > 0) b.append(',');
                Object box = list.get(i);
                b.append("{\"empty\":").append(getBool(box, "isEmpty"))
                 .append(",\"near\":").append(getBool(box, "AroundHero"))
                 .append('}');
            }
            b.append(']');
        }
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
