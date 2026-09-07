package devtools;

import java.awt.Graphics;
import java.awt.Image;
import java.awt.event.MouseEvent;
import java.awt.event.MouseListener;
import java.awt.event.MouseMotionListener;
import java.awt.image.BufferedImage;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

import javax.swing.JPanel;

import media.MusicPlayer;
import media.MusicReader;
import scene.SaveAndLoad;
import shop.Drug;
import shop.DrugPack;
import shop.Equipment;
import shop.EquipmentPack;
import shop.EquipmentShopPanel;
import shop.Money;
import shop.ShopPanel;
import tools.Clock;

/**
 * 商店面板（药店 {@code ShopPanel} 与装备自选超市 {@code EquipmentShopPanel}）的
 * 驱动器。**一步 = 一次输入事件**，机制整个照搬菜单那一票（{@link MenuDriver}），
 * 没有另造一套：同一个 {@link TraceDriver} 接口、同一套"按下 + 松开各算一步"、
 * 同一套"落点从按钮几何反算 + 按下后核对 isclicked"、同一套时钟冻结起手。
 *
 * 与菜单不同的只有三处，每一处都是商店自己的事实：
 *
 *   1. **存货是掷出来的。** 两个面板的构造函数里逐件 {@code setNumber((int)(Math.random()*10))}
 *      ——药店 6 件、装备店 6+6+6+6+12+20=56 件。不播种子的话同一份剧本每次
 *      跑出来的存货都不同，两遍导出绝不可能一致。这里用 {@link BattleDriver}
 *      同一招：把 {@code java.lang.Math} 私有的那个 {@code Random}
 *      {@code setSeed(剧本的 seed)}（要 {@code --add-opens java.base/java.lang=ALL-UNNAMED}）。
 *      **两个面板必须按固定顺序建**（先药店后装备店），否则 62 次掷骰的分配就变了。
 *
 *   2. **两家店在同一次导出里都要在场。** 一份商店真值要同时覆盖药店与装备超市，
 *      而金钱 {@code Money.coins} 与背包 {@code DrugPack}/{@code EquipmentPack}
 *      是两家店共享的静态状态 —— 分成两份真值就看不到"在装备店花掉的钱，回药店
 *      还是那个数"。所以 start() 一次把两个面板都建出来，{@code open} 指令只换
 *      事件往哪儿派。
 *
 *   3. **拒绝路径是"钱不够"。** 原版的买入是先扣后查：整段买完之后若
 *      {@code Money.getCoins()<0} 就把这一轮**逐件回滚**，并把店主的话换成
 *      "哎呀,小兄弟,你的钱不顾了,要省着点花啊"。回滚之后金钱与背包与买之前
 *      一模一样 —— 也就是说，**拒绝的样子和"什么都没点"长得一样**，唯一能把
 *      两者分开的就是 message 那一行。真值因此把 message/messageplus/messageremark
 *      三行原样记下来。
 *
 * 确定性从哪来（前两条与菜单同源，第三条是商店独有）：
 *
 *   a. 那两条鼠标动画线程。它们在两个面板的构造函数里就 start()，改不了
 *      （本票不许动 src/）。{@code Clock.setFactor(SLOW)} 把 {@code Clock.ms(120)}
 *      变成 1.2×10^11 毫秒（约 3800 年），两条线程各自停在第一个
 *      {@code Thread.sleep} 上。**必须在 new ShopPanel() 之前设**。
 *   b. javax.swing.Timer：{@code Clock.freezeTimers} 照样开着，理由同菜单
 *      （构造期间要读上百张图，真实 TimerQueue 只要还能触发就不可能两遍一致）。
 *   c. **那条线程在睡下之前会先走一次赋值**（{@code mouse=mouses[0]} 与四个
 *      {@code animation.image=images.get(0)}），这一下和主线程是竞态的。状态真值
 *      不记这几个字段所以不受影响，但 {@code snapshotImage()} 交出去的位图会。
 *      start() 因此在建完面板之后**等这一次赋值落地**（{@link #awaitFirstFrame}）
 *      再往下走 —— 不等的话，帧比对会时而对时而错，而单看 trace.json 完全正常。
 *   d. 音效。{@code MusicReader.closeMusic()} 之后 {@code playmusic} 是空操作。
 *      代价与菜单一样：**商店真值里没有音效**（原版把文件名记在
 *      {@code MusicPlayer.filename} 上，那行赋值在 {@code CAN_PLAY_MUSIC} 判断
 *      里面，关掉就观察不到）。见 bd xl-1vu.8。
 *
 * 绘制：每一步之后真的调一次 {@code paint()}，画进离屏图。商店的 paint 没有像
 * 菜单 {@code drawWarning()} 那样的清零副作用，但位图是交付物，而且尺寸校验
 * （1024×640）要在真画过的那张图上做。
 */
public final class ShopDriver implements TraceDriver {

    /** 冻结基数：24 小时。与 {@link SceneDriver} / {@link MenuDriver} 一致。 */
    private static final long FREEZE_BASE = 24L * 60 * 60 * 1000;

    /**
     * 时间缩放倍率。{@code Clock.ms(120)} = max(1, 120/1e-9) = 1.2×10^11 ms ≈ 3800 年，
     * 两条鼠标动画线程于是各自停在第一次 sleep 上。不是"很慢"，是这次导出里绝无可能醒。
     */
    private static final double SLOW = 1e-9;

    /** 等第一帧落地的上限（真实毫秒）。等不到是硬失败，不是"再等等"。 */
    private static final long FIRST_FRAME_TIMEOUT_MS = 20_000;

    /** 商品列表第 i 行的命中带：{@code y ∈ (180+20i, 200+20i)}，抄自两个面板的 isMoveIn。 */
    private static final int ROW_Y0 = 180;
    private static final int ROW_H = 20;
    /** 同一处的横向命中带 {@code x ∈ (440, 795)}；取中点当 hover 的落点。 */
    private static final int ROW_X = 600;

    private final ShopScript script;
    private ShopPanel drugShop;
    private EquipmentShopPanel equipShop;
    private String active;          // "drug" / "equipment"
    private Graphics sink;

    /** 本步派发出去的输入事件（写成数组是与场景/菜单真值同形）。 */
    private final List<String> pending = new ArrayList<>();

    private int ip;                 // 当前指令
    private int at;                 // 产出这一步的那条指令（ip 在本步末尾就前进了）
    private int sub;                // 指令内的第几个事件（0=按下 1=松开）
    private int[] point;            // 本条指令的落点，按下时算出，松开时复用
    private String pressTarget;     // 本条指令按的是哪个按钮（用于松开后的核对）
    private int steps;
    private boolean started;

    ShopDriver(ShopScript script) { this.script = script; }

    private void fail(String msg) {
        String where = ip < script.steps.size()
                ? "第 " + ip + " 条指令 " + script.steps.get(ip).op
                : "剧本末尾";
        ExportTrace.die(script.name + " · " + where + " · 第 " + steps + " 步：" + msg);
    }

    /**
     * 判别名。商店真值的 {@code driver} 字段就是这个字符串，回放端照它装配。
     * 与 {@link MenuDriver#kind()} 同理：常量，不由剧本说了算。
     */
    @Override
    public String kind() { return "shop"; }

    // ================= 推进一步 =================

    @Override
    public boolean step() {
        if (!started) { start(); started = true; }
        if (ip >= script.steps.size()) return false;
        if (steps >= script.maxSteps) {
            fail("超过剧本的 maxSteps=" + script.maxSteps + "，剧本没有跑完");
        }
        pending.clear();

        at = ip;
        ShopScript.Instruction in = script.steps.get(ip);
        boolean done = dispatch(in);

        panel().paint(sink);

        if (done) { ip++; sub = 0; } else { sub++; }
        steps++;
        return true;
    }

    /** 返回 true 表示这条指令的最后一个事件已经派发完。 */
    private boolean dispatch(ShopScript.Instruction in) {
        switch (in.op) {
            case "open":
                open(in.target);
                return true;
            case "hover":
                hover(in.index);
                return true;
            case "category":
                requireEquipmentShop("category");
                return click("category:" + in.target, categoryButton(in.target));
            case "plus":
                return click("plus:" + in.index, stepButton(in.index, true));
            case "minus":
                return click("minus:" + in.index, stepButton(in.index, false));
            case "buy":
                return click("buy", namedButton("buy"));
            case "sell":
                return click("sell", namedButton("sell"));
            default:
                fail("不认识的指令 " + in.op);
                return true;
        }
    }

    /**
     * 换一家店。不派发输入事件，但算一步 —— 原版是靠场景里的选择事件
     * {@code GameLauncher.switchTo} 进店的，那一下同样是一次跳转，真值里应当
     * 看得见它发生过（{@code input} 为空数组、{@code shop} 换了值）。
     */
    private void open(String which) {
        if (which.equals(active)) {
            fail("open " + which + " 但当前已经在这家店里 —— 这一步什么都不会发生");
        }
        active = which;
    }

    // ================= 输入 =================

    /**
     * 按下 / 松开一个按钮，落点从按钮对象自己的几何算出来。
     *
     * 每一步都核对三件事：按下之后那个按钮必须 {@code isclicked}；**当前按钮表里
     * 不能有第二个 isclicked**（原版的命中判据是逐个按钮独立算的，两个按钮的
     * 命中框重叠时会一起响应，而 setButton 会把两边的分支都执行一遍）；松开之后
     * 必须不再 isclicked。不核对的话，一次点空会导出一份步数完全正确、却什么都
     * 没发生的真值 —— 又是一次"失败长得和成功一模一样"。
     */
    private boolean click(String label, Object button) {
        if (sub == 0) {
            point = center(button);
            pressTarget = label;
            press(point[0], point[1], label);
            if (!getBool(button, "isclicked")) {
                fail(label + " 在 (" + point[0] + "," + point[1] + ") 按下后没有 isclicked"
                        + " —— 点空了（按钮几何是 " + geometry(button) + "）");
            }
            List<String> also = clickedLabels();
            if (also.size() != 1) {
                fail(label + " 按下之后同时有 " + also.size() + " 个按钮 isclicked：" + also
                        + " —— 命中框重叠，这一下会触发不止一件事");
            }
            return false;
        }
        release(point[0], point[1], pressTarget);
        if (getBool(button, "isclicked")) {
            fail(pressTarget + " 松开之后仍然 isclicked —— 松手事件没落在按钮上");
        }
        return true;
    }

    /**
     * 把鼠标移到商品列表的第 index 行。命中带与落点都按两个面板 isMoveIn 里那段
     * 判据算，移完核对**图标框里换上的真是这一行的图** —— 差一行在真值里长得和
     * 移对了一样。
     *
     * 用图标而不是用 message 核对：两行商品的说明文字可以完全相同（比如同价位的
     * 两件装备），而图标是逐行不同的对象。反过来，头盔那两行共用一张
     * {@code 圣兽玲珑冠.png}，ImageIcon 又按文件名缓存，所以比的是**图片对象**
     * 而不是行号：拿到的行号只要与目标行指向同一个对象就算对上。
     */
    private void hover(int index) {
        int rows = rowCount();
        if (index >= rows) {
            fail("hover 第 " + index + " 行，但当前列表只有 " + rows + " 项：" + itemNames());
        }
        int y = ROW_Y0 + ROW_H * index + ROW_H / 2;
        moveEvent(ROW_X, y, "row:" + index);

        int got = iconRow();
        if (got < 0) {
            fail("鼠标移到 (" + ROW_X + "," + y + ") 想选第 " + index + " 行 "
                    + itemNames().get(index) + "，但图标框里的图不属于当前列表任何一行");
        }
        if (picture(got) != picture(index)) {
            fail("鼠标移到 (" + ROW_X + "," + y + ") 想选第 " + index + " 行 "
                    + itemNames().get(index) + "，图标框里换上的却是第 " + got + " 行 "
                    + itemNames().get(got));
        }
    }

    private void press(int x, int y, String target) {
        MouseEvent e = mouseEvent(MouseEvent.MOUSE_PRESSED, x, y);
        for (MouseListener l : panel().getMouseListeners()) l.mousePressed(e);
        pending.add("{\"e\":\"press\",\"x\":" + x + ",\"y\":" + y
                + ",\"target\":" + Json.str(target) + "}");
    }

    private void release(int x, int y, String target) {
        MouseEvent e = mouseEvent(MouseEvent.MOUSE_RELEASED, x, y);
        for (MouseListener l : panel().getMouseListeners()) l.mouseReleased(e);
        pending.add("{\"e\":\"release\",\"x\":" + x + ",\"y\":" + y
                + ",\"target\":" + Json.str(target) + "}");
    }

    private void moveEvent(int x, int y, String target) {
        MouseEvent e = mouseEvent(MouseEvent.MOUSE_MOVED, x, y);
        for (MouseMotionListener l : panel().getMouseMotionListeners()) l.mouseMoved(e);
        pending.add("{\"e\":\"move\",\"x\":" + x + ",\"y\":" + y
                + ",\"target\":" + Json.str(target) + "}");
    }

    private MouseEvent mouseEvent(int id, int x, int y) {
        return new MouseEvent(panel(), id, 0L, 0, x, y, 1, false, MouseEvent.BUTTON1);
    }

    /**
     * 按钮的命中中心。判据抄自 {@code GameButton.isPressedButton}：
     * {@code x-15 < cx < x+width-15 && y-6 < cy < y+height-6}（那两个偏移是原版
     * 的历史遗留，不是笔误 —— 所有 GameButton 的命中框都比画出来的位置偏左偏上）。
     */
    private int[] center(Object button) {
        int x = getInt(button, "x"), y = getInt(button, "y");
        int w = getInt(button, "width"), h = getInt(button, "height");
        return new int[] { x - 15 + w / 2, y - 6 + h / 2 };
    }

    private String geometry(Object button) {
        return getInt(button, "x") + "," + getInt(button, "y") + " "
                + getInt(button, "width") + "×" + getInt(button, "height");
    }

    // ================= 起手 =================

    /** 播种子、冻结时间、掐掉出声、建两个面板、按剧本铺开局状态。只跑一次。 */
    private void start() {
        seedRandom();

        // 顺序要紧：这两件事必须在 new ShopPanel() 之前。两条鼠标动画线程在
        // 各自的构造函数里就 start()，缩放晚一步就有一条已经醒过。
        Clock.freezeTimers(FREEZE_BASE);
        Clock.setFactor(SLOW);

        MusicReader.closeBGM();
        MusicPlayer.CAN_PLAY_BGM = MusicPlayer.NO;
        MusicReader.closeMusic();

        SaveAndLoad.zhang = script.setup.party.contains("zhang");
        SaveAndLoad.lu = script.setup.party.contains("lu");
        SaveAndLoad.wen = script.setup.party.contains("wen");

        Money.setCoins(script.setup.coins);

        // 背包那两份静态列表默认是空的，只有构造函数会填。不填的话原版买卖时
        // 那句 DrugPack.drugList.get(i) 当场 IndexOutOfBounds。
        new DrugPack();
        new EquipmentPack();

        // 建面板的顺序决定 62 次掷骰怎么分配 —— 见类注释第 1 条。
        drugShop = new ShopPanel();
        equipShop = new EquipmentShopPanel();

        // 两条动画线程各自的第一次赋值是竞态的，等它落地再往下走（类注释 c）。
        awaitFirstFrame("药店", drugShop);
        awaitFirstFrame("装备店", equipShop);

        for (JPanel p : new JPanel[] { drugShop, equipShop }) {
            if (p.getMouseListeners().length != 1 || p.getMouseMotionListeners().length != 1) {
                ExportTrace.die(p.getClass().getSimpleName() + " 的鼠标监听器不是各一个（"
                        + p.getMouseListeners().length + " / " + p.getMouseMotionListeners().length
                        + "）—— 派发规则要重新对一遍");
            }
        }

        for (ShopScript.Item it : script.setup.drugs) addDrug(it);
        for (ShopScript.Item it : script.setup.equipment) addEquipment(it);

        sink = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB).getGraphics();
    }

    /**
     * 把 {@code java.lang.Math} 私有的那个 {@code Random} 播上剧本给的种子。
     * 与 {@link BattleDriver#seedRandom()} 同一招、同一个理由：那个字段是
     * {@code static final} 换不了，而 {@code Random.setSeed} 是公开的，把它播回
     * 同一个已知起点就够了 —— 算法一个字节没改，改的只是起点。
     */
    private void seedRandom() {
        try {
            Class<?> holder = Class.forName("java.lang.Math$RandomNumberGeneratorHolder");
            Field f = holder.getDeclaredField("randomNumberGenerator");
            f.setAccessible(true);
            ((Random) f.get(null)).setSeed(script.setup.seed);
        } catch (ReflectiveOperationException | RuntimeException e) {
            ExportTrace.die("播不了随机种子（要 --add-opens java.base/java.lang=ALL-UNNAMED）：" + e);
        }
    }

    /**
     * 等鼠标动画线程把第一帧（下标 0）赋值落地。
     *
     * 判据是"{@code mouse} 与四个 {@code animation.image} 都换成了各自 list 的
     * 第 0 张"。构造函数留下的初值是**第 7 张**（读图循环的最后一次），所以两者
     * 分得开 —— 但只有在第 0 张与第 7 张确实是不同对象时才分得开。图缺失时
     * ImageIcon 会给出空壳而不是 null，未必还是不同对象，所以这里先验一遍
     * "分得开"，验不过当场失败：一个永远为真的等待条件，和一个真的等到了的
     * 等待条件，长得一模一样。
     */
    private void awaitFirstFrame(String what, JPanel p) {
        Image[] mouses = (Image[]) field(p, "mouses");
        List<?> ani = (List<?>) field(p, "ani");
        if (mouses.length != 8) {
            ExportTrace.die(what + " 的鼠标帧不是 8 张而是 " + mouses.length);
        }
        if (mouses[0] == mouses[7]) {
            ExportTrace.die(what + " 的鼠标图第 1 张与第 8 张是同一个对象 —— "
                    + "等不出「第一帧已落地」这件事（图是不是缺了？）");
        }
        for (int i = 0; i < ani.size(); i++) {
            List<?> imgs = imagesOf(ani.get(i));
            if (imgs.size() != 8 || imgs.get(0) == imgs.get(7)) {
                ExportTrace.die(what + " 第 " + i + " 个人物动画有 " + imgs.size()
                        + " 帧、首尾" + (imgs.size() == 8 && imgs.get(0) == imgs.get(7) ? "同对象" : "异常")
                        + " —— 等不出「第一帧已落地」这件事");
            }
        }
        long deadline = System.currentTimeMillis() + FIRST_FRAME_TIMEOUT_MS;
        while (true) {
            if (field(p, "mouse") == mouses[0] && allAtFrameZero(ani)) return;
            if (System.currentTimeMillis() > deadline) {
                ExportTrace.die(what + " 的鼠标动画线程 " + FIRST_FRAME_TIMEOUT_MS
                        + "ms 内没有走完第一次赋值 —— 位图会是不确定的，不能导出");
            }
            try {
                Thread.sleep(1);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                ExportTrace.die("等" + what + "第一帧时被打断");
            }
        }
    }

    private static boolean allAtFrameZero(List<?> ani) {
        for (Object a : ani) {
            if (field(a, "image") != imagesOf(a).get(0)) return false;
        }
        return true;
    }

    private static List<?> imagesOf(Object animation) {
        return (List<?>) field(animation, "images");
    }

    /**
     * 给背包加药品。加完核对数量真的涨了 —— {@code DrugPack.addDrug} 是"名字对上
     * 才加"，名字打错时它一声不响地什么都不做。
     */
    private void addDrug(ShopScript.Item it) {
        Drug d = null;
        for (Drug x : DrugPack.drugList) if (x.getName().equals(it.name)) d = x;
        if (d == null) {
            ExportTrace.die(script.name + "：sources/Shop/drug.txt 里没有叫 " + it.name + " 的药品");
            return;
        }
        int before = d.getNumberGOT();
        DrugPack.addDrug(it.name, it.count);
        if (d.getNumberGOT() != before + it.count) {
            ExportTrace.die(script.name + "：给 " + it.name + " 加 " + it.count
                    + " 份之后数量是 " + d.getNumberGOT() + "，应为 " + (before + it.count));
        }
    }

    /** 同上，{@code EquipmentPack.addEqupment} 也是名字对不上就静默无事发生。 */
    private void addEquipment(ShopScript.Item it) {
        Equipment e = null;
        for (String c : ShopScript.CATEGORIES) {
            for (Equipment x : EquipmentPack.listTable(c)) {
                if (x.getName().equals(it.name)) e = x;
            }
        }
        if (e == null) {
            ExportTrace.die(script.name + "：sources/Shop 里没有叫 " + it.name + " 的装备");
            return;
        }
        int before = e.getNumberGOT();
        EquipmentPack.addEqupment(it.name, it.count);
        if (e.getNumberGOT() != before + it.count) {
            ExportTrace.die(script.name + "：给 " + it.name + " 加 " + it.count
                    + " 件之后数量是 " + e.getNumberGOT() + "，应为 " + (before + it.count));
        }
    }

    // ================= 面板与按钮 =================

    private boolean isDrugShop() { return "drug".equals(active); }

    private JPanel panel() { return isDrugShop() ? drugShop : equipShop; }

    private void requireEquipmentShop(String op) {
        if (isDrugShop()) fail(op + " 只能用在装备店，当前在药店（药店没有分类栏）");
    }

    /** 当前面板的按钮表。药店的字段名是 buttonlist，装备店的是 buttonList。 */
    @SuppressWarnings("unchecked")
    private List<Object> buttons() {
        return (List<Object>) field(panel(), isDrugShop() ? "buttonlist" : "buttonList");
    }

    /** 按钮表里固定那几个的下标 —— 顺序抄自两个构造函数里的 add 顺序。 */
    private int fixedIndex(String name) {
        if (isDrugShop()) {
            switch (name) {
                case "buy": return 0;
                case "sell": return 1;
                case "back": return 2;
                default: fail("药店没有叫 " + name + " 的按钮"); return -1;
            }
        }
        switch (name) {
            case "sell": return 0;
            case "buy": return 1;
            case "back": return 2;
            default: {
                int i = ShopScript.CATEGORIES.indexOf(name);
                // 装备店的 add 顺序是 weapon/helmet/armor/glove/shoe/decoration，
                // 与 ShopScript.CATEGORIES 同序 —— 下面那句断言守着这件事。
                if (i < 0) fail("装备店没有叫 " + name + " 的按钮");
                return 3 + i;
            }
        }
    }

    /** 第一个 +/- 按钮的下标：药店在 3（buy/sell/back 之后），装备店在 9（再加六个分类）。 */
    private int stepBase() { return isDrugShop() ? 3 : 9; }

    private Object namedButton(String name) { return buttons().get(fixedIndex(name)); }

    private Object categoryButton(String name) {
        Object b = buttons().get(fixedIndex(name));
        // 分类按钮的下标是照 add 顺序算出来的；算错了会安静地点到隔壁那一栏。
        // 用面板自己的字段核对一次，对象不同就当场失败。
        if (b != field(panel(), name)) {
            fail("分类按钮 " + name + " 在按钮表第 " + fixedIndex(name)
                    + " 位上的对象与面板字段 " + name + " 不是同一个 —— add 顺序变了");
        }
        return b;
    }

    /** 第 index 行的加/减按钮。 */
    private Object stepButton(int index, boolean plus) {
        int rows = rowCount();
        if (index >= rows) {
            fail((plus ? "plus" : "minus") + " 第 " + index + " 行，但当前列表只有 "
                    + rows + " 项：" + itemNames());
        }
        int want = stepBase() + 2 * rows;
        if (buttons().size() != want) {
            fail("按钮表有 " + buttons().size() + " 项，按 " + rows + " 行商品应当是 " + want
                    + " 项 —— 加减按钮的下标算法要重新对一遍");
        }
        return buttons().get(stepBase() + 2 * index + (plus ? 1 : 0));
    }

    /** 当前按钮表里所有 isclicked 的按钮，按下标出名字。 */
    private List<String> clickedLabels() {
        List<String> out = new ArrayList<>();
        List<Object> bs = buttons();
        for (int i = 0; i < bs.size(); i++) {
            if (getBool(bs.get(i), "isclicked")) out.add(buttonLabel(i));
        }
        return out;
    }

    private String buttonLabel(int i) {
        int base = stepBase();
        if (i >= base) {
            int row = (i - base) / 2;
            return ((i - base) % 2 == 0 ? "minus:" : "plus:") + row;
        }
        if (isDrugShop()) {
            return new String[] { "buy", "sell", "back" }[i];
        }
        if (i < 3) return new String[] { "sell", "buy", "back" }[i];
        return "category:" + ShopScript.CATEGORIES.get(i - 3);
    }

    // ================= 商品列表 =================

    /** 装备店当前选中的分类（原版那个决定一切的字符串字段）。药店没有，记 null。 */
    private String category() {
        return isDrugShop() ? null : (String) field(equipShop, "equipment");
    }

    /**
     * 当前店里画得出来的那一列商品。药店永远是 {@code drugList}；装备店走原版
     * 自己的 {@code listTable(equipment)} —— 不照抄它那个 switch，抄一份就会分家。
     */
    private List<?> shopList() {
        if (isDrugShop()) return (List<?>) field(drugShop, "drugList");
        return invokeListTable(equipShop, "listTable", category());
    }

    /** 背包里与当前这一列一一对应的那一列（原版 drawIcon 就是按下标对齐画的）。 */
    private List<?> packList() {
        if (isDrugShop()) return DrugPack.drugList;
        return EquipmentPack.listTable(category());
    }

    private int rowCount() { return shopList().size(); }

    private List<String> itemNames() {
        List<String> out = new ArrayList<>();
        for (Object o : shopList()) out.add(nameOf(o));
        return out;
    }

    private static String nameOf(Object item) {
        return item instanceof Drug ? ((Drug) item).getName() : ((Equipment) item).getName();
    }

    private static int priceOf(Object item) {
        return item instanceof Drug ? ((Drug) item).getReduceMoney()
                : ((Equipment) item).getReduceMoney();
    }

    private static int stockOf(Object item) {
        return item instanceof Drug ? ((Drug) item).getNumber() : ((Equipment) item).getNumber();
    }

    private static int purchaseOf(Object item) {
        return item instanceof Drug ? ((Drug) item).getPurchaseNumber()
                : ((Equipment) item).getPurchaseNumber();
    }

    private static int heldOf(Object item) {
        return item instanceof Drug ? ((Drug) item).getNumberGOT()
                : ((Equipment) item).getNumberGOT();
    }

    private static Image pictureOf(Object item) {
        return item instanceof Drug ? ((Drug) item).getPicture() : ((Equipment) item).getPicture();
    }

    private Image picture(int row) { return pictureOf(shopList().get(row)); }

    /** 图标框里那张图属于当前列表的第几行（首个对象相同的行），没有就是 -1。 */
    private int iconRow() {
        Image shown = (Image) field(panel(), isDrugShop() ? "drugImage" : "equipmentImage");
        if (shown == null) return -1;
        List<?> list = shopList();
        for (int i = 0; i < list.size(); i++) if (pictureOf(list.get(i)) == shown) return i;
        return -1;
    }

    // ================= 快照位图 =================

    /** 当前面板这一步真的画出来的那张 1024×640 位图（两个面板的 {@code background} 字段）。 */
    @Override
    public BufferedImage snapshotImage() {
        Object img = field(panel(), "background");
        if (!(img instanceof BufferedImage)) {
            fail(active + " 店的 background 不是 BufferedImage（是 "
                    + (img == null ? "null" : img.getClass().getName()) + "），存不了 PNG");
        }
        BufferedImage b = (BufferedImage) img;
        if (b.getWidth() != 1024 || b.getHeight() != 640) {
            fail("原版位图是 " + b.getWidth() + "×" + b.getHeight() + "，应为 1024×640");
        }
        return b;
    }

    // ================= 快照状态 =================

    @Override
    public String snapshotState(int index) {
        StringBuilder b = new StringBuilder();
        b.append("{\"t\":").append(index);
        b.append(",\"ip\":").append(at);
        b.append(",\"input\":[").append(String.join(",", pending)).append("]");
        b.append(",\"shop\":").append(Json.str(active));
        b.append(",\"category\":").append(Json.str(category()));
        b.append(",\"coins\":").append(Money.getCoins());
        b.append(",\"cursor\":").append(cursorJson());
        b.append(",\"list\":").append(listJson());
        b.append(",\"icon\":").append(iconJson());
        b.append(",\"message\":").append(messageJson());
        b.append(",\"pressed\":").append(Json.arrStr(clickedLabels()));
        b.append(",\"pack\":").append(packJson());
        return b.append("}").toString();
    }

    /** 鼠标停在哪，以及那个点落在商品列表的第几行（-1 = 不在任何一行的命中带上）。 */
    private String cursorJson() {
        int x = getInt(panel(), "currentX");
        int y = getInt(panel(), "currentY");
        int row = -1;
        if (x > 440 && x < 795) {
            for (int i = 0; i < rowCount(); i++) {
                int y0 = ROW_Y0 + ROW_H * i;
                // 原版那个 for 没有 break，命中带又不重叠，所以最后一个命中的就是唯一那个。
                if (y > y0 && y < y0 + ROW_H) row = i;
            }
        }
        return "{\"x\":" + x + ",\"y\":" + y + ",\"row\":" + row + "}";
    }

    /**
     * 当前这一列商品。每一行的五个数就是原版 drawIcon 画在屏幕上的那五列：
     * 名字 / 单价 / 店里还剩几件 / 这一单要买卖几件 / 背包里已有几件。
     */
    private String listJson() {
        List<?> shop = shopList();
        List<?> pack = packList();
        if (pack.size() != shop.size()) {
            fail("店里这一列有 " + shop.size() + " 项，背包对应的那一列有 " + pack.size()
                    + " 项 —— 原版按下标一一对应地买卖，对不齐就会买到隔壁那件");
        }
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < shop.size(); i++) {
            if (i > 0) b.append(',');
            b.append("{\"name\":").append(Json.str(nameOf(shop.get(i))))
             .append(",\"price\":").append(priceOf(shop.get(i)))
             .append(",\"stock\":").append(stockOf(shop.get(i)))
             .append(",\"purchase\":").append(purchaseOf(shop.get(i)))
             .append(",\"held\":").append(heldOf(pack.get(i)))
             .append('}');
        }
        return b.append(']').toString();
    }

    /** 图标框里那张图是哪一行、哪件商品。共用同一张 png 的两行只认得出头一行。 */
    private String iconJson() {
        int row = iconRow();
        return "{\"row\":" + row + ",\"name\":"
                + Json.str(row < 0 ? null : nameOf(shopList().get(row))) + "}";
    }

    /**
     * 店主说的三行话。**拒绝路径唯一的痕迹就在这里** —— 钱不够时原版把这一轮
     * 逐件回滚，金钱与背包都回到买之前，只有 message 换成了那句"你的钱不顾了"。
     * 药店没有第三行（{@code EquipmentShopPanel} 才有 messageremark），记 null。
     */
    private String messageJson() {
        StringBuilder b = new StringBuilder("{\"message\":");
        b.append(Json.str((String) field(panel(), "message")));
        b.append(",\"plus\":").append(Json.str((String) field(panel(), "messageplus")));
        b.append(",\"remark\":").append(
                Json.str(isDrugShop() ? null : (String) field(equipShop, "messageremark")));
        return b.append('}').toString();
    }

    /**
     * 背包全量。金钱与背包是两家店共享的静态状态，也是流进存档与后续剧情的那两个
     * 值 —— 只记当前这一列的话，"在装备店买的东西回药店还在不在"就看不见了。
     * 分母从数据源头来（{@code ShopScript.CATEGORIES} 与两个 Pack 自己的长度），
     * 不写死数量。
     */
    private String packJson() {
        StringBuilder b = new StringBuilder("{\"drugs\":[");
        for (int i = 0; i < DrugPack.drugList.size(); i++) {
            Drug d = DrugPack.drugList.get(i);
            if (i > 0) b.append(',');
            b.append("{\"name\":").append(Json.str(d.getName()))
             .append(",\"count\":").append(d.getNumberGOT()).append('}');
        }
        b.append("],\"equipment\":{");
        for (int c = 0; c < ShopScript.CATEGORIES.size(); c++) {
            String cat = ShopScript.CATEGORIES.get(c);
            if (c > 0) b.append(',');
            b.append(Json.str(cat)).append(":[");
            List<Equipment> es = EquipmentPack.listTable(cat);
            for (int i = 0; i < es.size(); i++) {
                if (i > 0) b.append(',');
                b.append("{\"name\":").append(Json.str(es.get(i).getName()))
                 .append(",\"count\":").append(es.get(i).getNumberGOT()).append('}');
            }
            b.append(']');
        }
        return b.append("}}").toString();
    }

    // ================= 反射 =================

    @SuppressWarnings("unchecked")
    private List<?> invokeListTable(Object target, String method, String arg) {
        try {
            Method m = target.getClass().getMethod(method, String.class);
            List<?> out = (List<?>) m.invoke(target, arg);
            if (out == null) fail(method + "(\"" + arg + "\") 返回 null —— 分类名不认识");
            return out;
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException(e);
        }
    }

    private static Object field(Object o, String name) {
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

    private static int getInt(Object o, String name) { return (Integer) field(o, name); }

    private static boolean getBool(Object o, String name) { return (Boolean) field(o, name); }
}
