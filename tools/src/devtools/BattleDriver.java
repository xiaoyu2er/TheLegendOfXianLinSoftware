package devtools;

import java.awt.Graphics;
import java.awt.Image;
import java.awt.event.MouseEvent;
import java.awt.event.MouseListener;
import java.awt.event.MouseMotionListener;
import java.awt.image.BufferedImage;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.Semaphore;

import battle.BattlePanel;
import battle.Enemy;
import battle.Hero;
import battle.LuXueQi;
import battle.YuJie;
import battle.ZhangXiaoFan;
import tools.Clock;

/**
 * 战斗面板的驱动器。一步 = 原版 {@code BattlePanel.run()} 的**一次循环体**，
 * 外加一次 {@code paint()}，固定顺序 **输入 → 循环体 → paint()**。
 *
 * <h2>为什么不能像场景那样把循环体提取成 step()</h2>
 *
 * 场景那边把 {@code ScenePanel.run()} 的循环体整块提取成了 {@code step()}，
 * 导出器每 tick 调一次。战斗这边**不动 src/**（这是本票的验收条件之一），
 * 所以走的是另一条路：让原版那个线程照跑，只是把它卡在一个闸门上，
 * 由导出器逐步放行。跑的是原版一字未改的循环体，不是它的一份誊抄。
 *
 * <h2>确定性从哪来</h2>
 *
 * 战斗面板里**一个 javax.swing.Timer 都没有**（grep 过：17 个定时器全在
 * scene 与 menu 下）。它的时间只来自两处，随机只来自一处：
 *
 * <ol>
 *   <li><b>主循环。</b>{@code run()} 是 {@code while(true){ Clock.sleep(100); …; repaint(); }}，
 *       跑在构造函数里起的那条线程上。这里把它闸在 {@code repaint()} 上：
 *       每放行一次，它就跑一次完整的循环体，然后停下等下一次放行。放行与
 *       等待都由导出器主动做，与真实时间无关。
 *       <p>起手那一下另有讲究：{@code Clock.setFactor} 先把 {@code sleep(100)}
 *       拉到约 11 天，于是"构造面板 → 建人物 → initial()"整段期间那条线程
 *       一次循环体都跑不了 —— 否则第一次循环发生在 {@code initial()} 之前
 *       还是之后就成了竞态，而两种结果的 trace 都"看上去正常"。装好闸门之后
 *       再 {@code interrupt()} 它一次把它从那场长眠里叫醒，随后 factor 调回
 *       让 sleep 只剩 1ms —— 反正闸门在 {@code repaint()}，那 1ms 停在哪里
 *       都不影响结果。<b>那次 interrupt 会在 stderr 上留一条
 *       InterruptedException</b>：{@code run()} 的 try/catch 只包住 sleep
 *       （xl-1dv.10），它把异常打出来然后照常往下跑，正是这里需要的。</li>
 *   <li><b>绘制。</b>{@code paint()} 每步真的调一次，画进原版自己那张
 *       {@code TYPE_INT_ARGB} 的离屏图（{@code BattlePanel.bufferedPic}），
 *       快照的就是它。
 *       <p><b>实测（2026-09-06）</b>：战斗面板的 {@code paint()} 对状态机
 *       <b>没有</b>副作用 —— 同一份剧本跑两遍，一遍每步 paint、一遍一次都不
 *       paint，426 步 × 24 个可断言字段的逐步转储**零行差异**。xl-1dv.5 记的
 *       "不调 paint 时 command.isDraw 是 0/120、调 paint 时 59/120"复现不出
 *       因果关系；那个测量里 run() 线程是自由奔跑的，paint 只是让取样循环变慢、
 *       于是取到了更靠后的状态。<b>但 paint 仍然每步都调</b>：位图本身是这份
 *       真值的交付物之一，而且"省一次绘制"正是那种省对了和省错了长得一样的
 *       优化。</li>
 *   <li><b>随机。</b>伤害（{@code ZhangXiaoFan.calDamage} 等 4 处）、怪物选招与
 *       选人（{@code EnemyAI}）、状态命中（{@code BattleState.set}）全走
 *       {@code Math.random()}。这里把 {@code java.lang.Math} 那个私有
 *       {@code Random} 实例取出来 {@code setSeed(剧本的 seed)} —— 换的是种子，
 *       不是算法，之后每一次 {@code Math.random()} 仍是原版那句原版那个生成器。
 *       需要 {@code --add-opens java.base/java.lang=ALL-UNNAMED}（在
 *       {@code tools/export-trace.sh} 里给）。</li>
 * </ol>
 *
 * <h2>一次导出一场战斗</h2>
 *
 * {@code BattlePanel.initial()} 对 {@code heroes}/{@code enemies} 只 add 不
 * clear（xl-1dv.6），所以同一个 JVM 里连开第二场会带上第一场的残留。本驱动器
 * 因此只打一场：一份剧本 = 一个 JVM = 一场战斗。这是绕开那个缺陷，不是修它。
 *
 * <h2>原版缺陷照实导出</h2>
 *
 * 真值里会直接看到两条已知缺陷，**导出器一处都不修**：
 * <ul>
 *   <li>xl-1dv.9：{@code Enemy.hp} 会是负数（致命一击打过头，
 *       {@code Check.checkEnemyDead} 只判 {@code <=0} 就把它摘掉，从不夹到 0）。
 *       每个槽位的 {@code hp} 照原样写，摘掉之后也接着写（{@code alive} 那一列
 *       负责说它还在不在场上）。</li>
 *   <li>xl-1dv.8：{@code EnemySlector.checkMoveIn/checkClick} 判第三个怪物时
 *       用的是 {@code height1}（第一个怪物图片的高）。每个槽位的 {@code box}
 *       就是原版拿来判命中的那四个数，第三个槽位的高因此是第一个的高。</li>
 * </ul>
 */
public final class BattleDriver implements TraceDriver {

    /** 建面板那段时间里，把 {@code Clock.sleep(100)} 拉到约 11 天。 */
    private static final double FREEZE_FACTOR = 1e-9;
    /** 闸门装好之后：{@code Clock.ms} 会夹到最小 1ms，循环停在哪里都不影响结果。 */
    private static final double RUN_FACTOR = 1e6;

    private final TraceScript script;
    private Gated bp;
    private PanelTap tap;
    private Graphics sink;
    private Thread loop;
    private boolean pumped;          // 第一次放行要 interrupt，之后是 release

    /** 三个怪物槽位。**死掉被摘出 em1/em2/em3 之后这里仍然留着引用**，否则
     *  负血（xl-1dv.9）与最后一击的伤害数字会在真值里凭空消失。 */
    private final Enemy[] slots = new Enemy[3];
    private final List<Hero> party = new ArrayList<>();

    // ---- 剧本执行状态 ----
    private int ip;
    private boolean entered;
    private int spent;
    private int left;
    private final List<String> pending = new ArrayList<>();
    private int ticks;

    BattleDriver(TraceScript script) { this.script = script; }

    /**
     * 判别名。常量而不是从剧本里读 —— 一份 trace 是哪个面板导出来的，
     * 是导出这件事本身的属性（同 {@link SceneDriver#kind()}）。
     */
    @Override
    public String kind() { return "battle"; }

    private void fail(String msg) {
        String where = ip < script.steps.size()
                ? "第 " + ip + " 条指令 " + script.steps.get(ip).op
                : "剧本末尾";
        ExportTrace.die(script.name + " · " + where + " · 第 " + ticks + " 步：" + msg);
    }

    // ================= 推进一步 =================

    @Override
    public boolean step() {
        if (bp == null) start();
        if (ip >= script.steps.size()) return finish();
        if (ticks >= script.maxTicks) fail("超过剧本的 maxTicks=" + script.maxTicks + "，剧本没有跑完");
        pending.clear();
        advanceScript();
        if (ip >= script.steps.size() && pending.isEmpty()) return finish();

        pump();            // 放行一次原版循环体，等它跑完
        requireExitAnnounced();
        bp.paint(sink);    // 绘制有没有副作用是另一回事，位图是交付物
        ticks++;
        return true;
    }

    /**
     * 剧本跑完了。返回 false 之前先拦一种收工方式：**全灭了，而面板还没切走**。
     *
     * 全灭之后原版必然切面板 —— {@code GameOver.update()} 把全灭图对开 512px
     * （每步 8px = 64 拍）再数 10 下（= 9 拍，第 64 拍两个 if 并列地都进），
     * 第 73 次 update 上一定走到那句
     * {@code em1.name.equals("罹年居士")}。停在那之前收工，导出的是一份**两条
     * 出口都还没走**的真值：它有头有尾、步数像模像样、退出码 0，而分支写反了
     * 与写对了在它里面长得一模一样。这正是本票（xl-rh9.3）要堵的形状，所以
     * 让它非零退出，而不是靠写剧本的人记得加 {@code awaitExit}。
     *
     * <p>与 {@link #requireExitAnnounced()} 是同一条规则的两半：那边拦「切了
     * 而没人接」，这边拦「该切了而剧本先收工」。改一处记得看另一处。
     *
     * <b>只拦 defeat，不拦 victory。</b>打赢之后原版不自动切面板（结算、发钱、
     * 经验、升级、回地图是另一段），{@code battle-min} 就正正停在"胜利"第一次
     * 出现的那一刻 —— 那一段没有真值覆盖是**已知的、归 xl-rh9.5 的**账，不是
     * 这里该顺手改掉的东西。
     */
    private boolean finish() {
        if (outcome().equals("defeat") && tap.card() == null) {
            fail("剧本跑完了，我方已全灭而原版还没切面板 —— 全灭之后 GameOver.update() "
                    + "必然在 73 次 update（真值上 72 步）内切回地图或标题，"
                    + "停在这里导出的是一份走到半路的真值。"
                    + "用 awaitExit 把那一步接住");
        }
        return false;
    }

    /** 放行一次 {@code run()} 的循环体，并等它跑到闸门上。 */
    private void pump() {
        if (pumped) {
            bp.go.release();
        } else {
            pumped = true;
            System.err.println("[BattleDriver] 下面这条 InterruptedException 是有意的："
                    + "把 run() 线程从冻结的 sleep 里叫醒，之后每一步都由闸门放行。");
            loop.interrupt();
        }
        bp.done.acquireUninterruptibly();
    }

    // ================= 起手 =================

    private void start() {
        seedRandom();

        // 背景音乐只取 currentPlayingBGM 这个可断言的值，不需要真的出声
        // （与 SceneDriver 同一套，理由见那边）。
        media.MusicReader.closeBGM();
        media.MusicPlayer.CAN_PLAY_BGM = media.MusicPlayer.NO;

        // 观察点要在建面板之前装好：切面板这件事是原版自己在循环体里做的，
        // 装晚了就有一段"切了而没人记"的窗口，而那段窗口里的失败长得像成功。
        tap = new PanelTap();
        main.GameLauncher.switcher = tap;

        // 先冻住 sleep 再建面板：构造函数里就把 run() 线程起来了。
        Clock.setFactor(FREEZE_FACTOR);
        bp = new Gated();

        ZhangXiaoFan zxf = null;
        YuJie yj = null;
        LuXueQi lxq = null;
        for (Map.Entry<String, Integer> e : script.levels.entrySet()) {
            switch (e.getKey()) {
                case "zhang": ZhangXiaoFan.level = e.getValue(); break;
                case "yu":    YuJie.level        = e.getValue(); break;
                case "lu":    LuXueQi.level      = e.getValue(); break;
                default: throw new IllegalStateException(e.getKey());
            }
        }
        // 出场坐标就是 GameLauncher 里那三行写死的值。三个人**无论出不出战都建**，
        // 并挂到 GameLauncher 那三个 public static 引用上 —— 原版 init() 就是这么
        // 做的（三行 new，紧跟着 menuPanel 把它们收进去），而 VictoryReminder
        // 收尾那两处会**不判空地**写 GameLauncher.zhangXiaoFan.isLevelUp。
        //
        // 不建的话：那一句 NPE 抛在 run() 线程上，而它的 try/catch 只包住 sleep
        // （xl-1dv.10），线程静静地死掉、闸门永远等不到放行 —— **导出挂死，而挂死
        // 看起来只是"跑得慢"**，与 PanelTap 那一处是同一个形状的坑（xl-rh9.13
        // 实测：battle-victory 第一次导出跑了 7 分钟没有产物，退出码 0）。
        //
        // 这三个类的字段几乎全是 static，所以"多建一个"不会给出战的那位换一份
        // 数据：同一个等级建两遍算出来的是同一批值。判据是重导之后
        // `git diff tools/traces/out` 为空。
        ZhangXiaoFan zhang = new ZhangXiaoFan(560, 160, bp);
        YuJie        yu    = new YuJie(750, 150, bp);
        LuXueQi      lu    = new LuXueQi(800, 330, bp);
        main.GameLauncher.zhangXiaoFan = zhang;
        main.GameLauncher.yuJie        = yu;
        main.GameLauncher.luXueQi      = lu;
        if (script.party.contains("zhang")) zxf = zhang;
        if (script.party.contains("yu"))    yj  = yu;
        if (script.party.contains("lu"))    lxq = lu;
        for (Hero h : new Hero[] { zxf, yj, lxq }) if (h != null) party.add(h);

        for (int i = 0; i < 3; i++) {
            String spec = script.enemies.get(i);
            if (spec == null) continue;
            int slash = spec.lastIndexOf('/');
            if (slash < 0) throw new IllegalArgumentException("怪物写法应当是 名字/编号，实际 " + spec);
            int code = Integer.parseInt(spec.substring(slash + 1));
            // 编号就是原版 Fight 数据里的那一位，它同时决定站位（5 中 / 6 上 / 7 下）。
            if (code != 5 + i) {
                throw new IllegalArgumentException("第 " + (i + 1) + " 个怪物的编号应当是 " + (5 + i)
                        + "（原版 Enemy.initial 按它定站位），实际 " + spec);
            }
            slots[i] = new Enemy(spec.substring(0, slash), code, bp);
        }
        bp.initial(script.background, zxf, yj, lxq, slots[0], slots[1], slots[2]);

        loop = findLoopThread();
        bp.gate = loop;                 // 闸门此刻才生效：构造期间 Swing 自己也会调 repaint()
        Clock.setFactor(RUN_FACTOR);    // 之后的 sleep 只剩 1ms

        sink = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB).getGraphics();
    }

    /**
     * 把 {@code java.lang.Math} 私有的那个 {@code Random} 播上剧本给的种子。
     *
     * 为什么不是"换掉随机源"：那个字段是 {@code static final}，换不了；而
     * {@code Random.setSeed} 是公开的，把它播回同一个已知起点就够了 ——
     * 算法一个字节没改，改的只是起点。
     */
    private void seedRandom() {
        try {
            Class<?> holder = Class.forName("java.lang.Math$RandomNumberGeneratorHolder");
            Field f = holder.getDeclaredField("randomNumberGenerator");
            f.setAccessible(true);
            ((Random) f.get(null)).setSeed(script.seed);
        } catch (ReflectiveOperationException | RuntimeException e) {
            ExportTrace.die("播不了随机种子（要 --add-opens java.base/java.lang=ALL-UNNAMED）：" + e);
        }
    }

    /**
     * 找出 {@code BattlePanel.run()} 跑在哪条线程上。
     *
     * 按**栈**认而不是按线程名认：名字是 "Thread-N"，编号取决于这个 JVM 之前
     * 建过几条线程，认错了的表现是闸门永远不生效 —— 而那看上去就像"导出很慢"。
     */
    private Thread findLoopThread() {
        Thread found = null;
        for (Map.Entry<Thread, StackTraceElement[]> e : Thread.getAllStackTraces().entrySet()) {
            for (StackTraceElement s : e.getValue()) {
                if (s.getClassName().equals("battle.BattlePanel") && s.getMethodName().equals("run")) {
                    if (found != null && found != e.getKey()) {
                        ExportTrace.die("找到不止一条 BattlePanel.run() 线程 —— 一次导出只打一场战斗");
                    }
                    found = e.getKey();
                }
            }
        }
        if (found == null) ExportTrace.die("找不到 BattlePanel.run() 那条线程，闸门装不上");
        return found;
    }

    // ================= 快照位图 =================

    /** 原版这一步真的画出来的那张 1024×640 位图（{@code BattlePanel.bufferedPic}）。 */
    @Override
    public BufferedImage snapshotImage() {
        Object img = get(bp, "bufferedPic");
        if (!(img instanceof BufferedImage)) {
            fail("BattlePanel.bufferedPic 不是 BufferedImage（是 "
                    + (img == null ? "null" : img.getClass().getName()) + "），存不了 PNG");
        }
        BufferedImage b = (BufferedImage) img;
        if (b.getWidth() != 1024 || b.getHeight() != 640) {
            fail("原版位图是 " + b.getWidth() + "×" + b.getHeight() + "，应为 1024×640");
        }
        return b;
    }

    // ================= 剧本执行 =================

    private void advanceScript() {
        int guard = 0;
        while (ip < script.steps.size()) {
            if (++guard > 256) fail("指令在一步之内空转");
            TraceScript.Instruction in = script.steps.get(ip);
            if (!entered) {
                entered = true;
                spent = 0;
                left = in.op.equals("wait") ? in.ticks
                        : in.op.equals("autoAttack") || in.op.equals("awaitExit")
                                || in.op.equals("autoUntilRound") ? in.max : 0;
            }
            if (exec(in)) { ip++; entered = false; continue; }
            if (++spent > in.budget) {
                fail("超过本条指令的 tick 预算 " + in.budget + "（当前回合 "
                        + getInt(bp, "currentRound") + "，控制台"
                        + (commandDrawn() ? "已" : "未") + "出现，怪物选择器"
                        + (selectable() ? "已" : "未") + "打开）");
            }
            return;
        }
    }

    /** 返回 true 表示这条指令已完成。 */
    private boolean exec(TraceScript.Instruction in) {
        switch (in.op) {
            case "wait":
                if (left <= 0) return true;
                left--;
                return false;
            case "command":
                if (!commandDrawn()) return false;
                clickButton(in.button);
                return true;
            case "target":
                if (!selectable()) return false;
                clickEnemy(in.enemy);
                return true;
            case "skillMenu":
                if (!getBool(get(bp, "skillMenu"), "isDraw")) return false;
                clickMenuButton("skillMenu", in.button);
                return true;
            case "drugMenu":
                if (!getBool(get(bp, "drugMenu"), "isDraw")) return false;
                clickMenuButton("drugMenu", in.button);
                return true;
            case "autoAttack":
                return autoAttack(in);
            case "autoUntilRound":
                return autoUntilRound(in);
            case "awaitExit":
                return awaitExit(in);
            default:
                fail("不认识的指令 " + in.op);
                return true;
        }
    }

    /**
     * 「能点击就点『击』，能选敌就选第一个还站着的怪物」，一直打到分出胜负。
     *
     * 为什么这条指令是策略而不是一串写死的点击：一场战斗要打几个回合，取决于
     * 每一次伤害掷出来多少 —— 那是种子决定的，写剧本的人事先不知道。写死的
     * 点击次数只要少一次，导出的就是一份"打到一半就停"的 trace，而它和一份
     * 打完的 trace 长得一模一样。所以终止条件是**胜负本身**，不是次数；
     * 次数只当上限，撞上了是硬失败。
     */
    private boolean autoAttack(TraceScript.Instruction in) {
        String outcome = outcome();
        if (!outcome.equals("undecided")) {
            if (in.until.equals("decided") || in.until.equals(outcome)) return true;
            fail("剧本要的是 " + in.until + "，实际打成了 " + outcome);
        }
        if (left <= 0) {
            fail("跑满 " + in.max + " 步仍未分出胜负（我方 hp " + heroHps() + "，怪物 hp " + enemyHps() + "）");
        }
        left--;
        if (commandDrawn()) {
            clickButton("attack");
        } else if (selectable()) {
            int slot = firstStandingEnemy();
            if (slot == 0) fail("怪物选择器开着，却一个还站着的怪物都没有");
            clickEnemy(slot);
        }
        return false;
    }

    /**
     * 像 {@link #autoAttack} 那样自动打，直到**控制台出现在指定回合上**为止。
     *
     * 为什么需要它：谁先跑满行动条由速度与种子决定，写剧本的人事先不知道。
     * 而"点技能菜单上的第二颗"这件事是**认人**的 —— 张小凡的第二颗是浪里寻花、
     * 文敏的第二颗是追星破月，两条路数完全不同。把回合序写死等于赌一次，
     * 而赌错了导出的是一份"点了另一个人的技能"的真值：它有头有尾、退出码 0。
     *
     * 到了那个回合就**停手**（这一拍不点任何东西），下一条指令接着点。
     */
    private boolean autoUntilRound(TraceScript.Instruction in) {
        if (!outcome().equals("undecided")) {
            fail("等的是第 " + in.round + " 号的回合，可这一场已经打成了 " + outcome());
        }
        if (commandDrawn() && getInt(bp, "currentRound") == in.round) return true;
        if (left <= 0) {
            fail("跑满 " + in.max + " 步，控制台一次都没出现在第 " + in.round + " 号的回合上"
                    + "（当前回合 " + getInt(bp, "currentRound") + "）");
        }
        left--;
        if (commandDrawn()) {
            clickButton("attack");
        } else if (selectable()) {
            int slot = firstStandingEnemy();
            if (slot == 0) fail("怪物选择器开着，却一个还站着的怪物都没有");
            clickEnemy(slot);
        }
        return false;
    }

    /**
     * 等原版自己把面板切走，并断言它切到了哪一块。
     *
     * 为什么这条指令必须存在：{@code gameOver.isDraw} 一置真，
     * {@link #outcome()} 就报 defeat —— 那只是全灭图**开始**对开的那一刻。
     * 真正分岔的那一句在 72 步之后（{@code GameOver.update()}：对开 512px、
     * 每步 8px = 64 拍，再数 10 下 = 9 拍，共 73 次 update；第 1 次与 defeat
     * 置位落在同一拍里，所以真值上是 72 步 —— 两份实测都是 72），它只比一个字符串：第一只怪叫不叫「罹年居士」。
     * 停在 defeat 就收工，导出的是一份**两条出口都还没走**的真值 —— 而
     * 「分支写反了」与「分支写对了」在那样的真值里长得一模一样，正是本票要
     * 堵的那个形状。
     *
     * 断言写在剧本里、由导出器当场判，形状照抄场景那边的 {@code exitTo}。
     */
    private boolean awaitExit(TraceScript.Instruction in) {
        String card = tap.card();
        if (card != null) {
            if (!card.equals(in.panel)) {
                fail("剧本要的出口是 " + in.panel + "，原版切到的是 " + card);
            }
            if (tap.count() != 1) {
                fail("原版切了 " + tap.count() + " 次面板，一份剧本只接得住一次");
            }
            return true;
        }
        if (left <= 0) {
            fail("等了 " + in.max + " 步，原版一次都没切面板（gameOver "
                    + getBool(get(bp, "gameOver"), "isDraw") + "，victory "
                    + getBool(get(bp, "victoryReminder"), "isDraw") + "）");
        }
        left--;
        return false;
    }

    /**
     * 面板被切走了，而当前指令不是 {@code awaitExit} —— 硬失败。
     *
     * 没有这道检查时的失败形状：一份剧本 autoAttack 到 defeat 就收工，原版随后
     * 若在最后一步里恰好切了面板，真值照样导出、退出码 0，而那一步之后的状态
     * （血量被改回半血、怪物被摘空）没有任何人在看。切面板是一件**必须被剧本
     * 显式接住**的事。
     *
     * <p>这一条与 {@link #finish()} 是同一条规则的两半，拦的时刻不同：这里拦
     * 「切了而没人接」，{@link #finish()} 拦「该切了而剧本先收工」。改一处
     * 记得看另一处。
     */
    private void requireExitAnnounced() {
        if (tap.card() == null) return;
        String op = ip < script.steps.size() ? script.steps.get(ip).op : "（剧本已结束）";
        if (!op.equals("awaitExit")) {
            fail("原版把面板切到了 " + tap.card() + "，而当前指令是 " + op
                    + " —— 切面板必须由 awaitExit 接住");
        }
    }

    /** 还在场上（没被 {@code Check.checkEnemyDead} 摘掉）的第一个槽位，1/2/3；没有则 0。 */
    private int firstStandingEnemy() {
        for (int i = 0; i < 3; i++) if (onField(i)) return i + 1;
        return 0;
    }

    private boolean onField(int i) {
        return slots[i] != null && get(bp, "em" + (i + 1)) == slots[i];
    }

    // ================= 输入 =================
    //
    // 不重写监听器里那几句判断，而是把 MouseEvent 交给原版自己注册的那几个
    // 监听器 —— 「鼠标点下去会发生什么」是原版的语义，抄一遍就有抄错的余地，
    // 而抄错了的表现是 trace 里少了一步状态变化，不是报错。

    private void clickButton(String button) {
        Object cmd = get(bp, "command");
        Object btn = get(cmd, buttonField(button));
        int x = getInt(btn, "x") - 15 + getInt(btn, "width") / 2;
        int y = getInt(btn, "y") - 6 + getInt(btn, "height") / 2;
        // -15 / -6 是原版 GameButton 判命中时的偏移（tools/GameButton.java），
        // 所以点的是**命中框**的中心，不是图片的中心。
        moved(x, y);
        pressed(x, y);
        released(x, y);
        pending.add(input("click", x, y, "command:" + button));
    }

    private static String buttonField(String button) {
        switch (button) {
            case "attack": return "attack";
            case "skill":  return "skill";
            case "defend": return "defend";
            case "thing":  return "thing";
            default: throw new IllegalStateException(button);
        }
    }

    /**
     * 点技能菜单 / 药品菜单上的一颗按钮。
     *
     * 与 {@link #clickButton} 同一套：坐标从原版自己那个 {@code GameButton} 上
     * 算出来（{@code x-15+width/2}, {@code y-6+height/2}，也就是**命中框**的中心，
     * 见 {@code tools/GameButton}），事件交给原版注册的监听器，不抄它的判断。
     *
     * 按钮取不到时**硬失败**：技能菜单那几颗的数量由
     * {@code ZhangXiaoFan.skillNumber} 等三个静态字段定（默认 2/3/2），
     * 点一颗不存在的按钮如果只是"什么都没发生"，导出的就是一份"点过了、
     * 一切正常、可就是什么都没选中"的真值。
     */
    private void clickMenuButton(String menu, String name) {
        Object m = get(bp, menu);
        Object btn;
        if (menu.equals("skillMenu")) {
            List<?> list = (List<?>) get(m, "skillButtons");
            if (name.equals("return")) {
                btn = get(m, "returnButton");
                if (btn == null) {
                    fail("技能菜单的返回按钮还是 null —— 它由 SkillMenu.checkRound() 现建，"
                            + "而 checkRound 只在点「技」时调一次");
                    return;
                }
            } else {
                int i = Integer.parseInt(name.substring("skill".length())) - 1;
                if (i >= list.size()) {
                    fail("技能菜单这一场只有 " + list.size() + " 颗技能按钮（当前回合 "
                            + getInt(bp, "currentRound") + "），剧本点的是第 " + (i + 1) + " 颗");
                    return;
                }
                btn = list.get(i);
            }
        } else {
            List<?> list = (List<?>) get(m, "drugButtons");
            int i = name.equals("return") ? list.size() - 1
                    : Integer.parseInt(name.substring("drug".length())) - 1;
            if (i >= list.size()) {
                fail("药品菜单只有 " + list.size() + " 颗按钮，剧本点的是第 " + (i + 1) + " 颗");
                return;
            }
            btn = list.get(i);
        }
        int x = getInt(btn, "x") - 15 + getInt(btn, "width") / 2;
        int y = getInt(btn, "y") - 6 + getInt(btn, "height") / 2;
        moved(x, y);
        pressed(x, y);
        released(x, y);
        pending.add(input("click", x, y, menu + ":" + name));
    }

    private void clickEnemy(int slot) {
        int i = slot - 1;
        if (!onField(i)) fail("怪物槽位 " + slot + " 上没有站着的怪物，点不了");
        Enemy e = slots[i];
        Image img = ((List<?>) get(e, "Images")).get(0) instanceof Image
                ? (Image) ((List<?>) get(e, "Images")).get(0) : null;
        if (img == null) fail("怪物槽位 " + slot + " 没有图片，算不出点在哪");
        int x = getInt(e, "x") + img.getWidth(bp) / 2;
        int y = getInt(e, "y") + img.getHeight(bp) / 2;
        moved(x, y);
        pressed(x, y);
        int be = getInt(bp, "currentBeAttacked");
        if (be != 4 + slot) {
            // 点下去了而攻击目标没定 —— 说明点在了命中框外面。不拦的话导出的是
            // 一份"点过了、一切正常、可就是没人挨打"的 trace。
            fail("点了怪物 " + slot + " 的图片中心 (" + x + "," + y + ")，currentBeAttacked 却是 " + be);
        }
        pending.add(input("click", x, y, "enemy:" + slot));
    }

    private void moved(int x, int y) {
        MouseEvent e = ev(MouseEvent.MOUSE_MOVED, x, y);
        for (MouseMotionListener l : bp.getMouseMotionListeners()) l.mouseMoved(e);
    }

    private void pressed(int x, int y) {
        MouseEvent e = ev(MouseEvent.MOUSE_PRESSED, x, y);
        for (MouseListener l : bp.getMouseListeners()) l.mousePressed(e);
    }

    private void released(int x, int y) {
        MouseEvent e = ev(MouseEvent.MOUSE_RELEASED, x, y);
        for (MouseListener l : bp.getMouseListeners()) l.mouseReleased(e);
    }

    /** 时间戳固定为 0：它进不了 trace，但真实时间戳会让"两遍导出"多一处不确定。 */
    private MouseEvent ev(int id, int x, int y) {
        return new MouseEvent(bp, id, 0L, 0, x, y, 1, false, MouseEvent.BUTTON1);
    }

    private static String input(String kind, int x, int y, String target) {
        return "{\"e\":" + Json.str(kind) + ",\"x\":" + x + ",\"y\":" + y
                + ",\"target\":" + Json.str(target) + "}";
    }

    // ================= 状态读取 =================

    private boolean commandDrawn() { return getBool(get(bp, "command"), "isDraw"); }
    private boolean selectable()   { return getBool(get(bp, "enemySlector"), "isSlectable"); }

    /**
     * 胜负。**先判失败**：我方全灭与怪物全灭不可能同时成立，但两个标志各自
     * 由不同的检查置位，判反了会让一场输掉的仗被记成赢。
     */
    private String outcome() {
        if (getBool(get(bp, "gameOver"), "isDraw")) return "defeat";
        if (getBool(get(bp, "victoryReminder"), "isDraw")) return "victory";
        return "undecided";
    }

    private String heroHps() {
        StringBuilder b = new StringBuilder();
        for (Hero h : party) b.append(b.length() == 0 ? "" : "/").append(h.getHp());
        return b.toString();
    }

    private String enemyHps() {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < 3; i++) {
            b.append(i == 0 ? "" : "/").append(slots[i] == null ? "-" : String.valueOf(getInt(slots[i], "hp")));
        }
        return b.toString();
    }

    private static String bgm() {
        try {
            Field bf = media.MusicReader.class.getDeclaredField("background");
            bf.setAccessible(true);
            return (String) get(bf.get(null), "currentPlayingBGM");
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException(e);
        }
    }

    // ================= 快照状态 =================

    @Override
    public String snapshotState(int tick) {
        Object bar = get(bp, "progressBar");
        Object sel = get(bp, "enemySlector");
        Object skill = get(bp, "skillAnimation");
        Object back = get(bp, "backgroundAnimation");

        StringBuilder b = new StringBuilder();
        b.append("{\"t\":").append(tick);
        b.append(",\"vt\":").append((long) tick * script.tickMs);
        b.append(",\"ip\":").append(Math.min(ip, script.steps.size() - 1));
        b.append(",\"input\":[").append(String.join(",", pending)).append("]");
        b.append(",\"outcome\":").append(Json.str(outcome()));

        // 回合归属与当前动作。三个数合起来就是原版的战斗状态机：谁在行动、
        // 用哪一招、打谁（编码见 BattlePanel 的字段注释）。
        b.append(",\"round\":").append(getInt(bp, "currentRound"));
        b.append(",\"pattern\":").append(getInt(bp, "currentPattern"));
        b.append(",\"beAttacked\":").append(getInt(bp, "currentBeAttacked"));

        // 行动条：原版只有像素位置这一个量，谁先跑满 400 谁行动。
        b.append(",\"bar\":{\"origin\":").append(getInt(bar, "BarX"))
         .append(",\"zhang\":").append(getInt(bar, "ZhangX"))
         .append(",\"yu\":").append(getInt(bar, "YuX"))
         .append(",\"lu\":").append(getInt(bar, "LuX"))
         .append(",\"pet\":").append(getInt(bar, "petX"))
         .append(",\"e1\":").append(getInt(bar, "Enemy1X"))
         .append(",\"e2\":").append(getInt(bar, "Enemy2X"))
         .append(",\"e3\":").append(getInt(bar, "Enemy3X"))
         .append(",\"stopped\":").append(getBool(bar, "isStop"))
         .append(",\"drawn\":").append(getBool(bar, "isDraw"))
         .append("}");

        b.append(",\"heroes\":[");
        for (int i = 0; i < party.size(); i++) {
            Hero h = party.get(i);
            if (i > 0) b.append(',');
            b.append("{\"code\":").append(h.getRoleCode())
             .append(",\"hp\":").append(h.getHp())
             .append(",\"hpMax\":").append(h.getHpMax())
             .append(",\"mp\":").append(h.getMp())
             .append(",\"mpMax\":").append(h.getMpMax())
             .append(",\"angry\":").append(h.getAngryValue())
             .append(",\"isAngry\":").append(h.wheatherAngry())
             .append(",\"dead\":").append(h.wheatherDead())
             .append(",\"speed\":").append(heroSpeed(h))
             .append(",\"drawn\":").append(getBool(h, "isDraw"))
             .append(",\"frame\":").append(getInt(h, "code"))
             .append(",\"state\":").append(stateJson(h.getBattleState()))
             .append("}");
        }
        b.append("]");

        // 三个槽位一律写满：死掉之后 em1/em2/em3 会被置 null，但对象还在，
        // hp 也还在（而且可能是负的 —— xl-1dv.9）。只写"场上还有谁"的话，
        // 最后一击打出去多少就没地方看了。
        b.append(",\"enemies\":[");
        for (int i = 0; i < 3; i++) {
            if (i > 0) b.append(',');
            Enemy e = slots[i];
            if (e == null) { b.append("null"); continue; }
            b.append("{\"slot\":").append(i + 1)
             .append(",\"name\":").append(Json.str((String) get(e, "name")))
             .append(",\"hp\":").append(getInt(e, "hp"))
             .append(",\"speed\":").append(getInt(e, "speed"))
             .append(",\"onField\":").append(onField(i))
             .append(",\"dead\":").append(getBool(e, "isDead"))
             .append(",\"drawn\":").append(getBool(e, "isDraw"))
             .append(",\"frame\":").append(getInt(e, "code"))
             .append(",\"state\":").append(stateJson(get(e, "battleState")))
             .append(",\"box\":").append(selectorBox(sel, i + 1))
             .append("}");
        }
        b.append("]");

        // 伤害数字：原版每算一次伤害就 new 一个 HurtValue 塞进 bp.hurtValues，
        // 动画播完自己收摊。这是"这一击打了多少"唯一的可断言出处。
        b.append(",\"hurts\":[");
        List<?> hurts = (List<?>) get(bp, "hurtValues");
        for (int i = 0; i < hurts.size(); i++) {
            Object h = hurts.get(i);
            if (i > 0) b.append(',');
            b.append("{\"value\":").append(getInt(h, "hurt"))
             .append(",\"type\":").append(getInt(h, "type"))
             .append(",\"x\":").append(getInt(h, "x"))
             .append(",\"y\":").append(getInt(h, "y"))
             .append(",\"drawn\":").append(getBool(h, "isDraw"))
             .append(",\"frame\":").append(getInt(h, "code"))
             .append("}");
        }
        b.append("]");

        b.append(",\"ui\":{\"command\":").append(commandDrawn())
         .append(",\"skillMenu\":").append(getBool(get(bp, "skillMenu"), "isDraw"))
         .append(",\"drugMenu\":").append(getBool(get(bp, "drugMenu"), "isDraw"))
         .append(",\"selectable\":").append(getBool(sel, "isSlectable"))
         .append(",\"instruct\":").append(getBool(get(bp, "instruct"), "isDraw"))
         .append(",\"reminder\":").append(getBool(get(bp, "reminder"), "isDraw"))
         .append(",\"victory\":").append(getBool(get(bp, "victoryReminder"), "isDraw"))
         .append(",\"gameOver\":").append(getBool(get(bp, "gameOver"), "isDraw"))
         .append(",\"startAnim\":").append(getBool(get(bp, "startAnimation"), "isDraw"))
         .append("}");

        b.append(",\"anim\":{\"skill\":").append(Json.str((String) get(skill, "name")))
         .append(",\"skillFrame\":").append(getInt(skill, "code"))
         .append(",\"skillDrawn\":").append(getBool(skill, "isDraw"))
         .append(",\"skillX\":").append(getInt(skill, "x"))
         .append(",\"skillY\":").append(getInt(skill, "y"))
         .append(",\"bg\":").append(Json.str((String) get(back, "name")))
         .append(",\"bgFrame\":").append(getInt(back, "code"))
         .append(",\"bgDrawn\":").append(getBool(back, "isDraw"))
         .append("}");

        b.append(",\"reminder\":").append(reminderJson());
        b.append(",\"menus\":").append(menusJson());

        b.append(",\"audio\":{\"bgm\":").append(Json.str(bgm())).append("}");
        return b.append("}").toString();
    }

    /**
     * 提示图这一层（xl-rh9.11）。{@code ui.reminder} 记的是它画没画，这里记的是
     * **画的是哪一张、画在哪个矩形上**。
     *
     * <p><b>图号差一。</b>{@code Reminder.loadImage()} 把 {@code 1.png}..{@code 22.png}
     * 依次装进 {@code images}，而 {@code show(i)} 取的是 {@code images.get(i)} ——
     * 所以 {@code show(19)} 画的是 <b>20.png</b>。这里记的是**文件号**
     * （下标 + 1），因为渲染那一侧要的就是文件名；记下标的话那个 +1 会在
     * 另一个仓库里被重新推导一次，而推错了画出来仍然是一张看着像提示的图。
     *
     * <p>源矩形 {@code (0,0)-(128,24)} 是构造函数里的常量，不记（同 GameOver
     * 那十二个只被 paint 读的常量）。{@code centreX/centreY} 同理。
     */
    private String reminderJson() {
        Object r = get(bp, "reminder");
        Object cur = get(r, "currentImage");
        int file = 0;
        if (cur != null) {
            List<?> images = (List<?>) get(r, "images");
            int idx = -1;
            for (int i = 0; i < images.size(); i++) if (images.get(i) == cur) { idx = i; break; }
            if (idx < 0) fail("Reminder.currentImage 不在它自己的 images 里 —— 图号推不出来");
            file = idx + 1;
        }
        return "{\"image\":" + (cur == null ? "null" : String.valueOf(file))
                + ",\"code\":" + getInt(r, "code")
                + ",\"stopped\":" + getBool(r, "isStop")
                + ",\"dx1\":" + getInt(r, "dx1")
                + ",\"dy1\":" + getInt(r, "dy1")
                + ",\"dx2\":" + getInt(r, "dx2")
                + ",\"dy2\":" + getInt(r, "dy2") + "}";
    }

    /**
     * 技能菜单与药品菜单（xl-rh9.11）。**只在它真的画出来的那几拍才记内容**，
     * 其余时候是 {@code null}：两个菜单加起来有二十来个字段，而五份老真值里
     * 它们一次都没打开过，逐拍写满等于给每一份真值凭空加上两千行恒定值。
     *
     * <p>{@code isDraw} 不在这里 —— {@code ui.skillMenu} / {@code ui.drugMenu}
     * 已经是它了，同一件事记两遍迟早对不上。
     */
    private String menusJson() {
        Object sm = get(bp, "skillMenu");
        Object dm = get(bp, "drugMenu");
        return "{\"skill\":" + (getBool(sm, "isDraw") ? skillMenuJson(sm) : "null")
                + ",\"drug\":" + (getBool(dm, "isDraw") ? drugMenuJson(dm) : "null") + "}";
    }

    /** 技能菜单那几颗按钮的贴图、返回按钮、介绍图。 */
    private String skillMenuJson(Object sm) {
        List<?> buttons = (List<?>) get(sm, "skillButtons");
        StringBuilder b = new StringBuilder("{\"group\":").append(Json.str(skillGroup(sm)));
        b.append(",\"buttons\":[");
        for (int i = 0; i < buttons.size(); i++) {
            if (i > 0) b.append(',');
            b.append(variant(buttons.get(i)));
        }
        b.append(']');
        Object ret = get(sm, "returnButton");
        // 返回按钮由 checkRound() 现 new 出来，所以它的 y 每一场都要现记：
        // 它落在 226 + 按钮数×30 上，而按钮数是 skillNumber 那个静态字段。
        b.append(",\"return\":").append(ret == null ? "null" : String.valueOf(variant(ret)));
        b.append(",\"returnY\":").append(ret == null ? "null" : String.valueOf(getInt(ret, "y")));
        b.append(",\"introDrawn\":").append(getBool(sm, "isDrawIntro"));
        b.append(",\"introImage\":").append(Json.str(skillIntro(sm)));
        b.append(",\"introY\":").append(getInt(sm, "introY"));
        return b.append('}').toString();
    }

    /** 当前挂着的是谁的那一组按钮（{@code skillButtons} 指向三个列表之一）。 */
    private String skillGroup(Object sm) {
        Object cur = get(sm, "skillButtons");
        if (cur == get(sm, "zhangButtons")) return "zhang";
        if (cur == get(sm, "wenButtons")) return "yu";
        if (cur == get(sm, "luButtons")) return "lu";
        fail("SkillMenu.skillButtons 不是那三个列表中的任何一个");
        return null;
    }

    /**
     * 介绍图记成 {@code "张小凡/2"} 这种形状，直接对应
     * {@code image/技能说明/&lt;谁&gt;/&lt;n&gt;.png}。三个列表都翻一遍：
     * {@code introduceImage} 在回合切换之后不会跟着换（原版没清它）。
     */
    private String skillIntro(Object sm) {
        Object img = get(sm, "introduceImage");
        if (img == null) return null;
        String[] fields = { "zhangIntros", "wenIntros", "luIntros" };
        String[] who = { "张小凡", "文敏", "陆雪琪" };
        for (int k = 0; k < fields.length; k++) {
            List<?> list = (List<?>) get(sm, fields[k]);
            for (int i = 0; i < list.size(); i++) {
                if (list.get(i) == img) return who[k] + "/" + (i + 1);
            }
        }
        fail("SkillMenu.introduceImage 不在那三份介绍图列表里 —— 认不出是哪一张");
        return null;
    }

    /** 药品菜单：七颗按钮的贴图、六种药的存货、介绍图与介绍文字。 */
    private String drugMenuJson(Object dm) {
        List<?> buttons = (List<?>) get(dm, "drugButtons");
        StringBuilder b = new StringBuilder("{\"buttons\":[");
        for (int i = 0; i < buttons.size(); i++) {
            if (i > 0) b.append(',');
            b.append(variant(buttons.get(i)));
        }
        b.append(']');
        // 菜单上那六个数字就是它们（`drawString(getNumberGOT()+"" , 575, 246+i*30)`）。
        // 新开档一个都没有，于是恒为 0 —— 而"恒为 0"正是点下去走提示那一路的前提。
        b.append(",\"stock\":[");
        for (int i = 0; i < shop.DrugPack.drugList.size(); i++) {
            if (i > 0) b.append(',');
            b.append(shop.DrugPack.drugList.get(i).getNumberGOT());
        }
        b.append(']');
        b.append(",\"introDrawn\":").append(getBool(dm, "isDrawIntro"));
        b.append(",\"introDrug\":").append(drugIntro(dm));
        b.append(",\"introY\":").append(getInt(dm, "introY"));
        b.append(",\"introText\":").append(Json.str((String) get(dm, "introString")));
        return b.append('}').toString();
    }

    /** 介绍图是第几种药（0 基，与 {@code DrugPack.drugList} 同序）。 */
    private String drugIntro(Object dm) {
        Object img = get(dm, "introduceImage");
        if (img == null) return "null";
        for (int i = 0; i < shop.DrugPack.drugList.size(); i++) {
            if (shop.DrugPack.drugList.get(i).getPicture() == img) return String.valueOf(i);
        }
        fail("DrugMenu.introduceImage 不是 DrugPack 里任何一种药的图");
        return "null";
    }

    /**
     * 一颗 {@code GameButton} 现在贴的是三张里的哪一张：1 常态 / 2 待点 / 3 按下。
     *
     * 按**引用身份**认，不按内容：三张图各读各的文件，同一张 {@code Image}
     * 只会等于它自己。认不出来是硬失败 —— 悄悄记个 0 的话，"贴图算错了"
     * 与"这一帧本来就是常态"在真值里长得一样。
     */
    private int variant(Object btn) {
        Object cur = get(btn, "buttonImage");
        if (cur == get(btn, "normalImage")) return 1;
        if (cur == get(btn, "waitclickImage")) return 2;
        if (cur == get(btn, "pressedImage")) return 3;
        fail("GameButton.buttonImage 不是它自己那三张里的任何一张");
        return 0;
    }

    /** 我方的速度是三个类各自的静态字段，接口里没有 getter。 */
    private static int heroSpeed(Hero h) {
        switch (h.getRoleCode()) {
            case 1:  return ZhangXiaoFan.speed;
            case 2:  return YuJie.speed;
            case 3:  return LuXueQi.speed;
            default: throw new IllegalStateException("没见过的角色编号 " + h.getRoleCode());
        }
    }

    /**
     * 一个 {@code BattleState}。**{@code x}/{@code y} 是 xl-rh9.11 补的**：
     * 状态图标就画在这两个数上（{@code BattleState.drawState}），而它们只由
     * {@code set(...)} 写一次、此后不动。没有它们时那两层画不出来，而
     * "没实现"与"这一帧本来就没有它"在逐帧比对里长得一模一样。
     *
     * {@code successRate} 不在里面：{@code set()} 从来不写它（只读入参），
     * 于是它恒为字段初值 0 —— 记一列恒 0 的数不是判据。
     */
    private static String stateJson(Object st) {
        return "{\"type\":" + getInt(st, "type")
                + ",\"rounds\":" + getInt(st, "roundNum")
                + ",\"usable\":" + getBool(st, "isUsable")
                + ",\"role\":" + getInt(st, "roleCode")
                + ",\"x\":" + getInt(st, "x")
                + ",\"y\":" + getInt(st, "y") + "}";
    }

    /**
     * 原版判鼠标命中时用的那个矩形，**照它写的取**。
     *
     * 第三个槽位的高取的是 {@code height1}（第一个怪物图片的高）—— 那就是
     * xl-1dv.8。这里不"顺手改成 height3"：真值的职责是记录原版做了什么。
     */
    private static String selectorBox(Object sel, int slot) {
        switch (slot) {
            case 1: return box(getInt(sel, "x1"), getInt(sel, "y1"), getInt(sel, "width1"), getInt(sel, "height1"));
            case 2: return box(getInt(sel, "x2"), getInt(sel, "y2"), getInt(sel, "width2"), getInt(sel, "height2"));
            case 3: return box(getInt(sel, "x3"), getInt(sel, "y3"), getInt(sel, "width3"), getInt(sel, "height1"));
            default: throw new IllegalStateException("槽位 " + slot);
        }
    }

    private static String box(int x, int y, int w, int h) {
        return "[" + x + "," + y + "," + w + "," + h + "]";
    }

    // ================= 反射 =================

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

    private static int getInt(Object o, String name)      { return (Integer) get(o, name); }
    private static boolean getBool(Object o, String name)  { return (Boolean) get(o, name); }

    // ================= 面板跳转观察点 =================

    /**
     * 记下原版把面板切到了哪一块。
     *
     * {@code GameLauncher.switchTo} 走的是 {@code switcher.show(c, "xxxPanel")}，
     * 而导出器里 {@code GameLauncher} 从没被构造过 —— {@code c} 是 null，
     * {@code CardLayout.show} 会当场 NPE。那条 NPE 抛在 {@code run()} 线程上，
     * 而它的 try/catch 只包住 sleep（xl-1dv.10），于是线程静静地死掉、闸门
     * 永远等不到放行：**导出挂死，而挂死看起来只是"跑得慢"**。
     *
     * 所以把 {@code GameLauncher.switcher} 这个 public static 字段换成本类：
     * {@code show} 只记名字、不碰容器。换掉的是**画面切换这个动作**，不是
     * 决定切到哪一块的那段判断 —— 那一句仍然是 {@code GameOver.update()} 里
     * 原版自己的 {@code em1.name.equals("罹年居士")}，一个字没动。
     */
    private static final class PanelTap extends java.awt.CardLayout {
        private static final long serialVersionUID = 1L;
        private volatile String card;
        private volatile int count;

        @Override
        public void show(java.awt.Container parent, String name) {
            card = name;
            count++;
        }

        String card()  { return card; }
        int count()    { return count; }
    }

    // ================= 闸门 =================

    /**
     * 装了闸门的 {@link BattlePanel}：{@code run()} 每跑完一次循环体就停在
     * {@code repaint()} 上，等导出器放行。
     *
     * 为什么闸在 {@code repaint()}：它是循环体的最后一句，而且是原版自己写的
     * 那一句。闸在别处就得先在中间插一个自己的钩子，那才是改行为。
     *
     * 为什么要认线程：构造 {@code JPanel} 的过程中 Swing 自己就会调
     * {@code repaint()}（{@code BasicPanelUI.installDefaults} → {@code setFont}），
     * 那一次发生在 {@code gate} 还没设上的时候。不认线程就会当场把主线程锁死 ——
     * 实测过，卡在 {@code JComponent.setFont}。
     */
    private static final class Gated extends BattlePanel {
        private static final long serialVersionUID = 1L;
        final Semaphore done = new Semaphore(0);
        final Semaphore go = new Semaphore(0);
        volatile Thread gate;

        @Override
        public void repaint() {
            if (Thread.currentThread() != gate) { super.repaint(); return; }
            done.release();
            go.acquireUninterruptibly();
        }
    }
}
