package devtools;

import java.awt.Graphics;
import java.awt.Image;
import java.awt.event.MouseEvent;
import java.awt.event.MouseListener;
import java.awt.event.MouseMotionListener;
import java.awt.image.BufferedImage;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

import battle.Hero;
import media.MusicPlayer;
import media.MusicReader;
import menu.FatherPanel;
import menu.MenuPanel;
import scene.SaveAndLoad;
import shop.Drug;
import shop.DrugPack;
import shop.Equipment;
import shop.EquipmentPack;
import tools.Clock;

/**
 * 菜单面板的驱动器。**一步 = 一次输入事件**，不是一个 tick。
 *
 * 为什么不是 tick：{@code MenuPanel} 只有 133 行，既没有 run 循环也没有 paint
 * 覆写 —— 它是个 CardLayout 容器，真正画东西的是底下的物品 / 装备 / 奇术 /
 * 天书四个 {@link FatherPanel}。这四个面板唯一的时间驱动是各自那条
 * {@code while(true){ Clock.sleep(100); update(); mouse.update(); repaint(); }}
 * 线程，它推的只有鼠标图标的循环帧与奇术页那段技能动画；菜单里所有**可断言的
 * 状态变化**（切页、切人、选中、装备、属性重算）无一例外由一次鼠标事件同步引起。
 * 把它硬套成逐 tick 真值，得到的是一长串一模一样的行，中间零星几行有变化 ——
 * 既不好比对，也没有多记录任何事实。
 *
 * 确定性从哪来：
 *
 *   1. 那四条 run 线程。它们在 {@code FatherPanel} 的构造函数里就 start()，
 *      改不了（本票不许动 src/）。这里用 {@code Clock.setFactor} 把时间缩放
 *      成极小值：{@code Clock.ms(100)} 于是变成 10^11 毫秒（约 3170 年），
 *      四条线程各自停在第一个 {@code Thread.sleep} 上，一次都不会走到
 *      {@code update()/repaint()}。**必须在 new MenuPanel() 之前设**。
 *   2. javax.swing.Timer。菜单这条路上没有定时器，但 {@code Clock.freezeTimers}
 *      照样开着：真实 TimerQueue 只要还能触发，两遍导出就不可能逐字节一致，
 *      而菜单页面里那三个子面板的构造会读上百张图，期间足够触发很多次。
 *   3. 音效。{@code MusicReader.closeMusic()} 之后 {@code playmusic} 整个方法
 *      是空操作 —— 不开音频设备、不起播放线程。代价是**菜单真值里没有音效**：
 *      原版把文件名记在 {@code MusicPlayer.filename} 上，而那行赋值在
 *      {@code CAN_PLAY_MUSIC} 的判断里面，关掉就观察不到。见 docs/trace-format.md。
 *   4. 绘制。每一步之后真的调一次 {@code currentPanel.paint()}，画进离屏图。
 *      不能省：{@code EquipPanel.drawWarning()} 会把"已装备 / 不能使用"两个
 *      拒绝标志**清零**，{@code showValueDifference()} 会算出属性差值 ——
 *      这两件事都只发生在 paint 里。
 *   5. 反射字段顺序。{@code Class.getDeclaredFields()} 的顺序未经规范保证，
 *      一律按字段名排序后再用。
 *
 * 拒绝标志的读取时机是这里唯一有讲究的地方：{@code isEquiped} / {@code canBeEquiped}
 * 由事件置位、由紧接着那次 paint 清零，所以必须**在 paint 之前**抓下来。放到
 * paint 之后读，永远是 0 —— 一份"没有任何拒绝发生过"的真值，而它看上去完全正常。
 */
public final class MenuDriver implements TraceDriver {

    /** 冻结基数：24 小时。与 {@link SceneDriver} 一致。 */
    private static final long FREEZE_BASE = 24L * 60 * 60 * 1000;

    /**
     * 时间缩放倍率。{@code Clock.ms(100)} = max(1, 100/1e-9) = 10^11 ms ≈ 3170 年，
     * 四条 run 线程于是各自停在第一次 sleep 上。不是"很慢"，是这次导出里绝无可能醒。
     */
    private static final double SLOW = 1e-9;

    private final MenuScript script;
    private MenuPanel mp;
    private Graphics sink;

    /** 本步派发出去的输入事件（菜单一步只有一个，写成数组是与场景真值同形）。 */
    private final List<String> pending = new ArrayList<>();

    private int ip;              // 当前指令
    private int at;              // 产出这一步的那条指令（ip 在本步末尾就前进了）
    private int sub;             // 指令内的第几个事件（0=按下 1=松开）
    private int[] point;         // 本条指令的落点，按下时算出，松开时复用
    private String pressTarget;  // 本条指令按的是哪个按钮（用于松开后的核对）
    private int steps;
    private boolean started;

    // paint 会清零，所以在 paint 之前抓下来
    private boolean warnEquipped;
    private boolean warnCannotUse;

    MenuDriver(MenuScript script) { this.script = script; }

    private void fail(String msg) {
        String where = ip < script.steps.size()
                ? "第 " + ip + " 条指令 " + script.steps.get(ip).op
                : "剧本末尾";
        ExportTrace.die(script.name + " · " + where + " · 第 " + steps + " 步：" + msg);
    }

    /**
     * 判别名。菜单真值的 {@code driver} 字段就是这个字符串，回放端照它装配。
     * 与 {@link SceneDriver#kind()} 同理：常量，不由剧本说了算。
     */
    @Override
    public String kind() { return "menu"; }

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
        MenuScript.Instruction in = script.steps.get(ip);
        boolean done = dispatch(in);

        // 拒绝标志必须在 paint 之前抓 —— drawWarning() 会把它们清零。
        warnEquipped = getInt(equipPanel(), "isEquiped") == 1;
        warnCannotUse = getInt(equipPanel(), "canBeEquiped") == 1;

        current().paint(sink);

        if (done) { ip++; sub = 0; } else { sub++; }
        steps++;
        return true;
    }

    /** 返回 true 表示这条指令的最后一个事件已经派发完。 */
    private boolean dispatch(MenuScript.Instruction in) {
        switch (in.op) {
            case "select":
                move(in.index);
                return true;
            case "tab":     return click("tab:" + in.target, tabButton(in.target));
            case "hero":    return click("hero:" + in.hero, heroButton(in.hero));
            case "slot":    return click("slot:" + in.target, slotButton(in.target));
            case "use":     return click("use", useButton());
            case "abandon": return click("abandon", field(equipPanel(), "abandon_button"));
            default:
                fail("不认识的指令 " + in.op);
                return true;
        }
    }

    // ================= 输入 =================

    /**
     * 按下 / 松开一个按钮，落点从按钮对象自己的几何算出来。
     *
     * 每一步都核对结果：按下之后那个按钮必须 {@code isclicked}，松开之后必须
     * 不再 {@code isclicked}。不核对的话，一次点空（按钮挪了位置、isDraw 是
     * "不画"、坐标算错）会导出一份步数完全正确、却什么都没发生的真值 ——
     * 又是一次"失败长得和成功一模一样"。
     */
    private boolean click(String label, Object button) {
        if (sub == 0) {
            if (getInt(button, "isDraw") != 1) {
                fail(label + " 这个按钮当前 isDraw=不画，原版根本不响应它的点击");
            }
            point = center(button);
            pressTarget = label;
            press(point[0], point[1], label);
            if (!getBool(button, "isclicked")) {
                fail(label + " 在 (" + point[0] + "," + point[1] + ") 按下后没有 isclicked"
                        + " —— 点空了（按钮几何是 " + geometry(button) + "）");
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
     * 把鼠标移到当前列表的第 index 行。行高与起点都从面板自己的字段读，
     * 移完核对选中的真的是第 index 项 —— 差一行在真值里长得和选对了一样。
     */
    private void move(int index) {
        Object p = current();
        String panel = panelName();
        int x0 = getInt(p, "x_start_point");
        int y0 = getInt(p, "y_start_point");
        int rowH;
        List<String> names;
        if (panel.equals("equipPanel")) {
            rowH = 22;                       // EquipPanel.isMoveIn 的行高
            names = namesOf(equipList());
        } else if (panel.equals("thingPanel")) {
            rowH = 32;                       // DrugPanel.isMoveIn 的行高
            names = namesOf(drugList());
        } else {
            fail("select 只能用在物品页或装备页，当前是 " + panel);
            return;
        }
        if (index >= names.size()) {
            fail("select 第 " + index + " 行，但 " + panel + " 的列表只有 "
                    + names.size() + " 项：" + names);
        }
        // 命中带是 (originalY, originalY+rowH)，originalY 从 y_start_point-rowH 起步。
        int x = x0 + 1;
        int y = y0 - rowH + rowH * index + rowH / 2;
        moveEvent(x, y, "row:" + index);

        String want = names.get(index);
        String got = selectedName();
        if (!want.equals(got)) {
            fail("鼠标移到 (" + x + "," + y + ") 想选第 " + index + " 行 " + want
                    + "，实际选中的是 " + got);
        }
    }

    private void press(int x, int y, String target) {
        MouseEvent e = mouseEvent(MouseEvent.MOUSE_PRESSED, x, y);
        for (MouseListener l : mp.getMouseListeners()) l.mousePressed(e);
        pending.add("{\"e\":\"press\",\"x\":" + x + ",\"y\":" + y
                + ",\"target\":" + Json.str(target) + "}");
    }

    private void release(int x, int y, String target) {
        MouseEvent e = mouseEvent(MouseEvent.MOUSE_RELEASED, x, y);
        for (MouseListener l : mp.getMouseListeners()) l.mouseReleased(e);
        pending.add("{\"e\":\"release\",\"x\":" + x + ",\"y\":" + y
                + ",\"target\":" + Json.str(target) + "}");
    }

    private void moveEvent(int x, int y, String target) {
        MouseEvent e = mouseEvent(MouseEvent.MOUSE_MOVED, x, y);
        for (MouseMotionListener l : mp.getMouseMotionListeners()) l.mouseMoved(e);
        pending.add("{\"e\":\"move\",\"x\":" + x + ",\"y\":" + y
                + ",\"target\":" + Json.str(target) + "}");
    }

    private MouseEvent mouseEvent(int id, int x, int y) {
        return new MouseEvent(mp, id, 0L, 0, x, y, 1, false, MouseEvent.BUTTON1);
    }

    /**
     * 按钮的命中中心。判据抄自 {@code GameButton.isPressedButton}：
     * {@code x-15 < cx < x+width-15 && y-6 < cy < y+height-6}（原版那两个偏移
     * 是历史遗留，不是笔误 —— 所有 MenuButton 的命中框都比画出来的位置偏左偏上）。
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

    /** 冻结时间、掐掉出声、建面板、按剧本铺开局状态。只跑一次。 */
    private void start() {
        // 顺序要紧：这两件事必须在 new MenuPanel() 之前。四条 run 线程在
        // FatherPanel 的构造函数里就 start()，缩放晚一步就有一条已经醒过。
        Clock.freezeTimers(FREEZE_BASE);
        Clock.setFactor(SLOW);

        MusicReader.closeBGM();
        MusicPlayer.CAN_PLAY_BGM = MusicPlayer.NO;
        MusicReader.closeMusic();

        SaveAndLoad.zhang = script.setup.party.contains("zhang");
        SaveAndLoad.lu = script.setup.party.contains("lu");
        SaveAndLoad.wen = script.setup.party.contains("wen");

        mp = new MenuPanel();

        // 原版把鼠标事件挂在两个匿名 Adapter 上，这里直接调它们。多一个监听器
        // 就说明有人改了 MenuPanel 的接线，而那会让"派发一次事件"不再等价于原版。
        if (mp.getMouseListeners().length != 1 || mp.getMouseMotionListeners().length != 1) {
            ExportTrace.die("MenuPanel 的鼠标监听器不是各一个（"
                    + mp.getMouseListeners().length + " / " + mp.getMouseMotionListeners().length
                    + "）—— 派发规则要重新对一遍");
        }

        // 装备与药品的初始持有量在原版里全是 0（只有商店与剧情事件会加），
        // 所以开局状态得显式铺。走的是原版自己的入口，不直接改 numberGOT。
        for (MenuScript.Item it : script.setup.equipment) addEquipment(it);
        for (MenuScript.Item it : script.setup.drugs) addDrug(it);

        // 无参的 MenuPanel 构造函数里 new 出来的三个英雄走的是空构造函数，
        // 静态的 hp/mp 因此停在 0（只有带 BattlePanel 的那个构造函数会拉满）。
        // 一份 hp=0 的菜单真值是原版根本不会出现的状态，而且会让"喝药回血"
        // 这条路径从 0 起算。这里补上那一步，用的是 Hero 接口自己的 setter。
        if (script.setup.fullHeal) {
            for (Hero h : heroes()) { h.setHp(h.getHpMax()); h.setMp(h.getMpMax()); }
        }

        sink = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB).getGraphics();
    }

    /**
     * 给背包加装备。加完核对数量真的涨了 —— {@code EquipmentPack.addEqupment}
     * 是"名字对上才加"，名字打错时它一声不响地什么都不做。
     */
    private void addEquipment(MenuScript.Item it) {
        Equipment e = findEquipment(it.name);
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

    private void addDrug(MenuScript.Item it) {
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

    private static Equipment findEquipment(String name) {
        for (List<Equipment> l : allEquipmentLists()) {
            for (Equipment e : l) if (e.getName().equals(name)) return e;
        }
        return null;
    }

    private static List<List<Equipment>> allEquipmentLists() {
        return Arrays.<List<Equipment>>asList(
                EquipmentPack.weaponList, EquipmentPack.armorList, EquipmentPack.helmetList,
                EquipmentPack.shoeList, EquipmentPack.gloveList, EquipmentPack.decorationList);
    }

    // ================= 面板与按钮 =================

    private FatherPanel current() { return (FatherPanel) field(mp, "currentPanel"); }

    private String panelName() { return current().getName(); }

    private Object equipPanel() { return mp.equipPanel; }

    private Object drugPanel() { return field(mp, "thingPanel"); }

    private Object magicPanel() { return field(mp, "magicPanel"); }

    private Object funcPanel() { return field(mp, "funcPanel"); }

    private Object tabButton(String name) {
        Object command = field(mp, "command");
        switch (name) {
            case "thing": return field(command, "thingButton");
            case "equip": return field(command, "equipButton");
            case "magic": return field(command, "magicButton");
            case "func":  return field(command, "funcButton");
            default: fail("没有这个标题：" + name); return null;
        }
    }

    private Object slotButton(String name) {
        if (!panelName().equals("equipPanel")) {
            fail("slot 只能用在装备页，当前是 " + panelName());
        }
        return field(equipPanel(), name + "Button");
    }

    /** 卷轴上的头像按钮。天书页没有卷轴（{@code FuncPanel} 不建 Scoll）。 */
    private Object heroButton(int n) {
        Object scoll = field(current(), "scoll");
        if (scoll == null) fail("当前页 " + panelName() + " 没有卷轴，切不了人");
        return field(scoll, "hero" + n);
    }

    private Object useButton() {
        String p = panelName();
        if (!p.equals("equipPanel") && !p.equals("thingPanel")) {
            fail("use 只能用在装备页或物品页，当前是 " + p);
        }
        return field(current(), "use_button");
    }

    // ================= 列表与选中 =================

    /** 装备页当前分类里**画得出来的**那几项：与 {@code drawEquipment} 同一个判据。 */
    @SuppressWarnings("unchecked")
    private List<Equipment> equipList() {
        List<Equipment> out = new ArrayList<>();
        for (Equipment e : (List<Equipment>) field(equipPanel(), "currentList")) {
            if (e.getNumberGOT() > 0) out.add(e);
        }
        return out;
    }

    private List<Drug> drugList() {
        List<Drug> out = new ArrayList<>();
        for (Drug d : DrugPack.drugList) if (d.getNumberGOT() > 0) out.add(d);
        return out;
    }

    private static List<String> namesOf(List<?> xs) {
        List<String> out = new ArrayList<>();
        for (Object x : xs) out.add(x instanceof Equipment
                ? ((Equipment) x).getName() : ((Drug) x).getName());
        return out;
    }

    private String selectedName() {
        if (panelName().equals("equipPanel")) {
            Equipment e = (Equipment) field(equipPanel(), "currentEquipment");
            return e == null ? null : e.getName();
        }
        Drug d = (Drug) field(drugPanel(), "currentDrug");
        return d == null ? null : d.getName();
    }

    // ================= 快照位图 =================

    /** 当前子面板这一步真的画出来的那张 1024×640 位图（{@code FatherPanel.bufferedPic}）。 */
    @Override
    public BufferedImage snapshotImage() {
        Image img = (Image) field(current(), "bufferedPic");
        if (!(img instanceof BufferedImage)) {
            fail(panelName() + ".bufferedPic 不是 BufferedImage（是 "
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
        b.append(",\"panel\":").append(Json.str(panelName()));
        b.append(",\"hero\":").append(currentHero());
        b.append(",\"heroes\":").append(heroesJson());
        b.append(",\"equip\":").append(equipJson());
        b.append(",\"drug\":").append(drugJson());
        b.append(",\"magic\":").append(magicJson());
        b.append(",\"func\":").append(funcJson());
        return b.append("}").toString();
    }

    /** 当前页选中的是哪个角色。天书页没有卷轴，记 null 而不是编一个。 */
    private String currentHero() {
        Object scoll = field(current(), "scoll");
        return scoll == null ? "null" : String.valueOf(getInt(scoll, "whichHero"));
    }

    private List<Hero> heroes() {
        return Arrays.<Hero>asList(mp.hero1, mp.hero2, mp.hero4);
    }

    private String heroesJson() {
        String[] names = { "zhangxiaofan", "luxueqi", "yujie" };
        List<Hero> hs = heroes();
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < hs.size(); i++) {
            Hero h = hs.get(i);
            if (i > 0) b.append(',');
            b.append("{\"name\":").append(Json.str(names[i]))
             .append(",\"level\":").append(staticInt(h.getClass(), "level"))
             .append(",\"physicalPower\":").append(h.getPhysicalPower())
             .append(",\"agile\":").append(h.getAgile())
             .append(",\"strength\":").append(h.getStrength())
             .append(",\"spirit\":").append(h.getSprit())
             .append(",\"hp\":").append(h.getHp())
             .append(",\"hpMax\":").append(h.getHpMax())
             .append(",\"mp\":").append(h.getMp())
             .append(",\"mpMax\":").append(h.getMpMax())
             .append(",\"defense\":").append(h.getDefense())
             .append(",\"skillDefense\":").append(h.getSkillDefense())
             .append(",\"skillNumber\":").append(staticInt(h.getClass(), "skillNumber"))
             .append("}");
        }
        return b.append(']').toString();
    }

    /**
     * 装备页。列表内容与选中项都从 {@code currentList} 现算 —— 面板自己那个
     * {@code list} 字段不能用：{@code drawEquipment()} 每画一帧就往里 add 一遍
     * 而从不清空，几步之后它是一份不断变长的重复列表。
     */
    private String equipJson() {
        Object ep = equipPanel();
        List<Equipment> list = equipList();
        Equipment cur = (Equipment) field(ep, "currentEquipment");
        Equipment worn = (Equipment) field(ep, "heroEquipment");
        Object pack = field(ep, "currentPack");

        StringBuilder b = new StringBuilder();
        b.append("{\"tab\":").append(Json.str(slotName(getInt(ep, "CURRENTLIST"))));
        b.append(",\"packHero\":").append(packHero(pack));
        b.append(",\"list\":[");
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) b.append(',');
            b.append("{\"name\":").append(Json.str(list.get(i).getName()))
             .append(",\"count\":").append(list.get(i).getNumberGOT()).append('}');
        }
        b.append(']');
        b.append(",\"selected\":").append(cur == null ? -1 : namesOf(list).indexOf(cur.getName()));
        b.append(",\"selectedName\":").append(Json.str(cur == null ? null : cur.getName()));
        b.append(",\"signal\":").append(getInt(ep, "signal"));
        b.append(",\"worn\":").append(Json.str(worn == null ? null : worn.getName()));
        b.append(",\"equipped\":{");
        String[] slots = { "weapon", "armor", "helmet", "shoe", "glove", "decoration" };
        for (int i = 0; i < slots.length; i++) {
            Equipment e = (Equipment) field(pack, slots[i]);
            if (i > 0) b.append(',');
            b.append(Json.str(slots[i])).append(':').append(Json.str(e == null ? null : e.getName()));
        }
        b.append('}');
        b.append(",\"useDraw\":").append(getInt(field(ep, "use_button"), "isDraw") == 1);
        b.append(",\"abandonDraw\":").append(getInt(field(ep, "abandon_button"), "isDraw") == 1);
        // 拒绝路径。在 paint 之前抓的，见类注释。
        b.append(",\"warnEquipped\":").append(warnEquipped);
        b.append(",\"warnCannotUse\":").append(warnCannotUse);
        b.append(",\"diff\":").append(diffJson(ep));
        return b.append('}').toString();
    }

    /**
     * 选中那件相对身上那件的四个升降数字 —— 就是装备页中间那四个箭头。
     *
     * 取的是四个 {@code ShowValue} 对象自己的 value/type，**不是 EquipPanel 上
     * 那四个 showPP/showAngile/showStrength/showSpirit 字段**。这两者只有在
     * "身上有同类装备"时才一致：{@code showValueDifference()} 的 else 分支
     * （身上是空的）把绝对值直接传进 {@code ShowValue.show()}，一个字段都不写，
     * 于是那四个字段留着上一次的陈值。照抄字段的第一版真值里，"月苗刀 vs 空"
     * 那几步记的是上一次"藏璎环 vs 月苗刀"的差值 —— 数字合法、位置正确、
     * 意思完全是错的。
     *
     * {@code signal!=1} 时记 null：原版那一整段（算差值 + 画四个箭头）都在
     * {@code if(signal==1)} 里面，列表空的时候屏幕上根本没有这四个数字。
     */
    private String diffJson(Object ep) {
        if (getInt(ep, "signal") != 1) return "null";
        Object[] sv = (Object[]) field(ep, "showValue");
        String[] keys = { "physicalPower", "agile", "strength", "spirit" };
        StringBuilder b = new StringBuilder("{");
        for (int i = 0; i < keys.length; i++) {
            if (i > 0) b.append(',');
            // ShowValue.show(int) 把负数存成 type=2（下降）加上它的绝对值。
            int v = getInt(sv[i], "value");
            b.append(Json.str(keys[i])).append(':').append(getInt(sv[i], "type") == 2 ? -v : v);
        }
        return b.append('}').toString();
    }

    private String drugJson() {
        Object dp = drugPanel();
        List<Drug> list = drugList();
        Drug cur = (Drug) field(dp, "currentDrug");
        StringBuilder b = new StringBuilder("{\"list\":[");
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) b.append(',');
            b.append("{\"name\":").append(Json.str(list.get(i).getName()))
             .append(",\"count\":").append(list.get(i).getNumberGOT()).append('}');
        }
        b.append(']');
        b.append(",\"selected\":").append(cur == null ? -1 : namesOf(list).indexOf(cur.getName()));
        b.append(",\"selectedName\":").append(Json.str(cur == null ? null : cur.getName()));
        b.append(",\"useDraw\":").append(getInt(field(dp, "use_button"), "isDraw") == 1);
        return b.append('}').toString();
    }

    /**
     * 奇术页。技能按钮的 isDraw 由 {@code drawThisPanel()} 按当前角色的
     * skillNumber 现设，所以这里记的是"上一次画这一页时显示了几个技能"。
     *
     * {@code currentAnimation} 开局不是 null：{@code addMagicAnimation()} 用同一个
     * 临时字段建了 20 个动画，循环结束时它停在最后一个（文敏第 5 技能）上，
     * 于是刚进奇术页就画着那一条说明。这是原版的行为，照记不改。
     */
    private String magicJson() {
        Object mgp = magicPanel();
        Object anim = field(mgp, "currentAnimation");
        StringBuilder b = new StringBuilder("{\"visible\":{");
        String[] lists = { "buttonList1", "buttonList2", "buttonList4" };
        String[] who = { "zhangxiaofan", "luxueqi", "yujie" };
        for (int i = 0; i < lists.length; i++) {
            if (i > 0) b.append(',');
            b.append(Json.str(who[i])).append(":[");
            List<?> bs = (List<?>) field(mgp, lists[i]);
            for (int j = 0; j < bs.size(); j++) {
                if (j > 0) b.append(',');
                b.append(getInt(bs.get(j), "isDraw") == 1);
            }
            b.append(']');
        }
        b.append('}');
        b.append(",\"animation\":");
        if (anim == null) {
            b.append("null");
        } else {
            b.append("{\"hero\":").append(getInt(anim, "hero"))
             .append(",\"skill\":").append(getInt(anim, "skillNumber"))
             .append(",\"code\":").append(getInt(anim, "code"))
             .append(",\"length\":").append(getInt(anim, "length"))
             .append('}');
        }
        return b.append('}').toString();
    }

    /** 天书页。按字段名排序列出当前画得出来的按钮 —— 那一页的状态就是这个。 */
    private String funcJson() {
        Object fb = field(funcPanel(), "fb");
        List<String> drawn = new ArrayList<>();
        for (Field f : sortedFields(fb.getClass())) {
            if (!f.getType().getSimpleName().equals("MenuButton")) continue;
            try {
                Object button = f.get(fb);
                if (button != null && getInt(button, "isDraw") == 1) drawn.add(f.getName());
            } catch (IllegalAccessException e) {
                throw new RuntimeException(e);
            }
        }
        return "{\"drawn\":" + Json.arrStr(drawn) + "}";
    }

    private static String slotName(int currentList) {
        switch (currentList) {
            case 1: return "weapon";
            case 2: return "armor";
            case 3: return "helmet";
            case 4: return "shoe";
            case 5: return "glove";
            case 6: return "decoration";
            default: return "list" + currentList;
        }
    }

    /** 当前背包是谁的。用对象同一性判，不靠 whichHero —— 那两个可以不一致。 */
    private String packHero(Object pack) {
        Object ep = equipPanel();
        if (pack == field(ep, "equipPack_hero1")) return "1";
        if (pack == field(ep, "equipPack_hero2")) return "2";
        if (pack == field(ep, "equipPack_hero4")) return "4";
        return "null";
    }

    // ================= 反射 =================

    private static Field[] sortedFields(Class<?> c) {
        Field[] fs = c.getDeclaredFields();
        Arrays.sort(fs, Comparator.comparing(Field::getName));
        for (Field f : fs) f.setAccessible(true);
        return fs;
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

    private static int staticInt(Class<?> c, String name) {
        try {
            Field f = c.getDeclaredField(name);
            f.setAccessible(true);
            return f.getInt(null);
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException(e);
        }
    }
}
