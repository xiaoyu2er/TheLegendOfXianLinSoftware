package devtools;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 一份剧本。UTF-8 JSON，指令是**声明式**的：写"走到 (14,19)"而不是"按 12 次下键"。
 *
 * 为什么不能是按键序列：按键序列对时序敏感。原版一格走 8 帧、每帧 80ms，
 * Web 侧只要有一处 tick 边界对不齐，"按 12 次下键"在两端就会停在不同的格子上，
 * 之后整条 trace 全错，而错因和现象隔了几千帧。声明式的"走到 (14,19)"两端
 * 各自负责把它展开成按键，终点是同一个可断言的事实。
 *
 * 指令词汇（就是 Web 侧状态推进函数的入参类型，不是另一套平行机制）：
 *
 *   walkTo  {x, y}     走到目标格（先 X 后 Y）。到不了就硬失败。
 *   runTo   {x, y}     同上，按住 Ctrl 跑。
 *   exitTo  {x, y}     走向出口格 (x, y)，等场景真的换掉。走到了而场景没换 ——
 *                      硬失败（"出口没生效"与"走到了"在 trace 里长得一模一样）。
 *   talk               按一次空格（对着相邻 NPC 就是搭话）。
 *   advance {times}    推进对话 times 次；每次都等当前句逐字打完再按空格。
 *                      对话在按满 times 次之前就结束了 —— 硬失败。
 *   advanceAll {max}   一直推进到对话结束，最多 max 次；到 max 还没结束 —— 硬失败。
 *   wait    {ticks}    空等若干 tick。
 *   waitIdle           等到主角的走/跑定时器都停下（即已对齐到格）。
 *   waitNarratage      等到旁白播完（narratageOver）。
 *
 * 战斗剧本（`driver: "battle"`）用的是另一套词汇，因为战斗面板上没有格子、
 * 没有主角，只有鼠标：
 *
 *   command {button}          点控制台上的一个按钮（击/技/防/物）。菜单没出来 —— 硬失败。
 *   target  {enemy}           点某个怪物（1/2/3）。选不了、或者那个槽位已经空了 —— 硬失败。
 *   autoAttack {until, max}   一直「能点击就点击、能选敌就选第一个活着的」，
 *                             直到分出胜负；到 max 还没分出来 —— 硬失败。
 *   awaitExit {panel, max}    等原版自己把面板切走，并断言切到了哪一块。
 *                             切到别的一块、或者到 max 还没切 —— 硬失败。
 *                             形状照抄场景那边的 exitTo：「到了而没换」与「到了」
 *                             在 trace 里长得一模一样，所以由导出器当场判。
 *   wait    {ticks}           空等若干 tick（两套词汇共用）。
 *
 * 每条指令有 tick 预算（budget，默认 2000）。超预算是硬失败，不是静默跳过 ——
 * "走不到就当走到了"会导出一份看上去正常、实际错位的 trace。
 */
public final class TraceScript {

    /**
     * 哪个面板的剧本：`scene` / `battle`。**它决定的是本文件怎么解析这份剧本**
     * （必填字段是哪些、指令词汇是哪一套），不是真值头里那个 `driver` ——
     * 那一个由驱动器自己报（见 {@link TraceDriver#kind()}）。两者必须一致，
     * 而"必须一致"是由导出器只按这里选驱动器来保证的，不是靠两处各写一遍。
     */
    public final String driver;

    public final String name;
    public final String description;
    public final int tickMs;
    public final int maxTicks;
    public final List<Instruction> steps;

    // ---- 场景剧本专用 ----
    public final String warmup;   // 预热脚本，可为 null
    public final String scene;
    public final boolean isScript;

    // ---- 战斗剧本专用 ----
    /** 战斗背景图，就是 Fight 数据那一行的第一列。BattlePanel 照它挑背景音乐。 */
    public final String background;
    /** 出战的我方单位，`zhang` / `yu` / `lu` 的子集，顺序无关。 */
    public final List<String> party;
    /** 每个出战单位的等级（原版默认 1/3/1）。战斗的初始属性全部由它算出来。 */
    public final Map<String, Integer> levels;
    /** 三个怪物槽位，形如 `怪物1/5`；空槽位写 `null`。就是 Fight 数据的后三列。 */
    public final List<String> enemies;
    /** `Math.random()` 的种子。战斗的伤害与怪物 AI 全靠它才可重复，见 BattleDriver。 */
    public final int seed;

    public static final class Instruction {
        public final String op;
        public final int x, y, ticks, times, max, budget;
        /** 战斗：`command` 点哪个按钮 / `autoAttack` 跑到什么为止。 */
        public final String button, until;
        /** 战斗：`target` 点哪个怪物槽位（1/2/3）。 */
        public final int enemy;
        /** 战斗：`awaitExit` 断言原版切到了哪块面板（CardLayout 的卡片名）。 */
        public final String panel;
        Instruction(String op, int x, int y, int ticks, int times, int max, int budget,
                    String button, String until, int enemy, String panel) {
            this.op = op; this.x = x; this.y = y;
            this.ticks = ticks; this.times = times; this.max = max; this.budget = budget;
            this.button = button; this.until = until; this.enemy = enemy; this.panel = panel;
        }
    }

    private static final List<String> SCENE_OPS = Arrays.asList(
            "walkTo", "runTo", "exitTo", "talk", "advance", "advanceAll", "wait", "waitIdle",
            "waitNarratage");

    private static final List<String> BATTLE_OPS = Arrays.asList(
            "command", "target", "autoAttack", "awaitExit", "wait");

    /**
     * {@code awaitExit} 认的面板名：{@code GameLauncher.setLayout()} 往
     * {@code CardLayout} 里注册的那八张卡片，逐字照抄。
     *
     * 为什么用卡片名而不是 {@code switchTo("scene")} 那个入参：观察点就在
     * {@code CardLayout.show} 上，卡片名是**观察到的那个字符串本身**。中间加一层
     * 入参↔卡片名的映射等于把原版那张表誊抄一遍，而誊错了的表现是真值里一个
     * 看上去正常的面板名。
     */
    private static final List<String> PANELS = Arrays.asList(
            "startPanel", "scenePanel", "battlePanel", "shopPanel",
            "equipmentShopPanel", "menuPanel", "lsPanel", "endPanel");

    private static final List<String> DRIVERS = Arrays.asList("scene", "battle");
    private static final List<String> BUTTONS = Arrays.asList("attack", "skill", "defend", "thing");
    private static final List<String> UNTIL = Arrays.asList("victory", "defeat", "decided");
    private static final List<String> PARTY = Arrays.asList("zhang", "yu", "lu");

    /** 原版战斗主循环的周期：`BattlePanel.run()` 里那一句 `Clock.sleep(100)`。 */
    public static final int BATTLE_TICK_MS = 100;

    private TraceScript(String driver, String name, String description, String warmup, String scene,
                        boolean isScript, int tickMs, int maxTicks, List<Instruction> steps,
                        String background, List<String> party, Map<String, Integer> levels,
                        List<String> enemies, int seed) {
        this.driver = driver;
        this.name = name; this.description = description; this.warmup = warmup;
        this.scene = scene; this.isScript = isScript;
        this.tickMs = tickMs; this.maxTicks = maxTicks; this.steps = steps;
        this.background = background; this.party = party; this.levels = levels;
        this.enemies = enemies; this.seed = seed;
    }

    public boolean isBattle() { return driver.equals("battle"); }

    /** 带目标格的三条指令。 */
    static boolean isMove(String op) {
        return op.equals("walkTo") || op.equals("runTo") || op.equals("exitTo");
    }

    public static TraceScript load(File f) throws Exception {
        String text = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        Map<String, Object> m = JsonIn.obj(JsonIn.parse(text), "剧本");

        String driver = JsonIn.strOr(m, "driver", "scene");
        if (!DRIVERS.contains(driver)) {
            throw new IllegalArgumentException("不认识的 driver " + driver + "，可用的是 " + DRIVERS);
        }
        boolean battle = driver.equals("battle");
        String name = JsonIn.str(m, "name");
        String description = JsonIn.strOr(m, "description", "");
        String warmup = battle ? null : JsonIn.strOr(m, "warmup", null);
        String scene = battle ? null : JsonIn.str(m, "scene");
        boolean isScript = !battle && JsonIn.boolOr(m, "isScript", false);
        int tickMs = JsonIn.iOr(m, "tickMs", battle ? BATTLE_TICK_MS : 10);
        int maxTicks = JsonIn.iOr(m, "maxTicks", 20000);

        if (battle) {
            // 战斗面板一个 javax.swing.Timer 都没有，它唯一的时间源是主循环里那句
            // Clock.sleep(100)。一步就是一次循环，所以步长只能是 100 —— 写别的值
            // 会让 vt 这一列说谎，而说谎的 trace 与正确的 trace 长得一模一样。
            if (tickMs != BATTLE_TICK_MS) {
                throw new IllegalArgumentException("战斗剧本的 tickMs 只能是 " + BATTLE_TICK_MS
                        + "（BattlePanel.run() 的循环周期），实际 " + tickMs);
            }
        } else if (tickMs <= 0 || 10 % tickMs != 0) {
            // 原版所有定时器的间隔都是 10 的倍数（10/20/30/40/50/80/100/180/200/500）。
            // tick 步长若不整除它们，触发时刻就会被舍入，trace 与原版语义不再一致。
            throw new IllegalArgumentException("tickMs 必须能整除 10（原版定时器间隔的最大公约数），实际 " + tickMs);
        }

        String background = null;
        List<String> party = null;
        Map<String, Integer> levels = null;
        List<String> enemies = null;
        int seed = 0;
        if (battle) {
            background = JsonIn.str(m, "background");
            party = new ArrayList<>();
            for (Object o : JsonIn.arr(m.get("party"), "party")) {
                String who = (String) o;
                if (!PARTY.contains(who)) {
                    throw new IllegalArgumentException("party 里不认识的 " + who + "，可用的是 " + PARTY);
                }
                if (party.contains(who)) throw new IllegalArgumentException("party 里重复的 " + who);
                party.add(who);
            }
            if (party.isEmpty()) throw new IllegalArgumentException("party 是空的 —— 没人出战就没有战斗");
            levels = new LinkedHashMap<>();
            Map<String, Object> lv = JsonIn.obj(m.get("level"), "level");
            for (String who : party) {
                // 等级不给默认值：三个人的原版默认等级各不相同（1/3/1），
                // 默认掉的那一份初始属性正是这份真值里所有伤害数字的来源。
                levels.put(who, JsonIn.i(lv, who));
            }
            enemies = new ArrayList<>();
            for (Object o : JsonIn.arr(m.get("enemies"), "enemies")) enemies.add((String) o);
            if (enemies.size() != 3) {
                throw new IllegalArgumentException("enemies 必须正好 3 项（原版只有 em1/em2/em3 三个槽位），实际 "
                        + enemies.size());
            }
            boolean any = false;
            for (String e : enemies) any |= e != null;
            if (!any) throw new IllegalArgumentException("三个怪物槽位全是 null —— 没有敌人就没有战斗");
            seed = JsonIn.i(m, "seed");
        }

        List<String> ops = battle ? BATTLE_OPS : SCENE_OPS;
        List<Instruction> steps = new ArrayList<>();
        for (Object o : JsonIn.arr(m.get("steps"), "steps")) {
            Map<String, Object> s = JsonIn.obj(o, "指令");
            String op = JsonIn.str(s, "op");
            if (!ops.contains(op)) {
                throw new IllegalArgumentException("driver " + driver + " 不认识的指令 " + op + "，可用的是 " + ops);
            }
            int x = 0, y = 0, ticks = 0, times = 0, max = 0, enemy = 0;
            String button = null, until = null, panel = null;
            if (!battle && isMove(op)) { x = JsonIn.i(s, "x"); y = JsonIn.i(s, "y"); }
            if (op.equals("wait"))       ticks = JsonIn.i(s, "ticks");
            if (op.equals("advance"))    times = JsonIn.i(s, "times");
            if (op.equals("advanceAll")) max   = JsonIn.iOr(s, "max", 64);
            if (op.equals("command")) {
                button = JsonIn.str(s, "button");
                if (!BUTTONS.contains(button)) {
                    throw new IllegalArgumentException("不认识的按钮 " + button + "，可用的是 " + BUTTONS);
                }
            }
            if (op.equals("target")) {
                enemy = JsonIn.i(s, "enemy");
                if (enemy < 1 || enemy > 3) throw new IllegalArgumentException("target 的 enemy 只能是 1/2/3，实际 " + enemy);
            }
            if (op.equals("autoAttack")) {
                until = JsonIn.strOr(s, "until", "decided");
                if (!UNTIL.contains(until)) {
                    throw new IllegalArgumentException("不认识的 until " + until + "，可用的是 " + UNTIL);
                }
                max = JsonIn.iOr(s, "max", 2000);
            }
            if (op.equals("awaitExit")) {
                panel = JsonIn.str(s, "panel");
                if (!PANELS.contains(panel)) {
                    throw new IllegalArgumentException("不认识的面板 " + panel + "，可用的是 " + PANELS);
                }
                // 全灭图对开 512px（每步 8px = 64 拍）再数 10 下才跳转，共 73 次
                // update、真值上 72 步（两份打输的真值实测都是 72）。默认给 300 是
                // 留了余量，撞上上限是硬失败而不是导出一份短的。
                max = JsonIn.iOr(s, "max", 300);
            }
            steps.add(new Instruction(op, x, y, ticks, times, max,
                    JsonIn.iOr(s, "budget", 2000), button, until, enemy, panel));
        }
        if (steps.isEmpty()) throw new IllegalArgumentException("剧本没有任何指令");

        return new TraceScript(driver, name, description, warmup, scene, isScript, tickMs, maxTicks,
                steps, background, party, levels, enemies, seed);
    }

    /**
     * 剧本自身回显进 trace 头部，比对时能一眼看出两端跑的是不是同一份。
     *
     * **不回显 `driver`**：真值头里已经有一个，而那一个是驱动器自己报的
     * （xl-1vu.2）。同一件事写两遍，迟早会出现两处对不上的真值，而"信哪一个"
     * 没有答案。回显里只有这份剧本自己的内容。
     */
    public String toJson() {
        return isBattle() ? battleJson() : sceneJson();
    }

    private String battleJson() {
        StringBuilder b = new StringBuilder();
        b.append("{\"name\":").append(Json.str(name));
        b.append(",\"description\":").append(Json.str(description));
        b.append(",\"background\":").append(Json.str(background));
        b.append(",\"party\":").append(Json.arrStr(party));
        b.append(",\"level\":{");
        boolean first = true;
        for (Map.Entry<String, Integer> e : levels.entrySet()) {
            if (!first) b.append(',');
            first = false;
            b.append(Json.str(e.getKey())).append(':').append(e.getValue());
        }
        b.append("}");
        b.append(",\"enemies\":").append(Json.arrStr(enemies));
        b.append(",\"seed\":").append(seed);
        b.append(",\"tickMs\":").append(tickMs);
        b.append(",\"maxTicks\":").append(maxTicks);
        b.append(",\"steps\":[");
        for (int i = 0; i < steps.size(); i++) {
            Instruction s = steps.get(i);
            if (i > 0) b.append(',');
            b.append("{\"op\":").append(Json.str(s.op));
            if (s.op.equals("command"))    b.append(",\"button\":").append(Json.str(s.button));
            if (s.op.equals("target"))     b.append(",\"enemy\":").append(s.enemy);
            if (s.op.equals("autoAttack")) b.append(",\"until\":").append(Json.str(s.until)).append(",\"max\":").append(s.max);
            if (s.op.equals("awaitExit"))  b.append(",\"panel\":").append(Json.str(s.panel)).append(",\"max\":").append(s.max);
            if (s.op.equals("wait"))       b.append(",\"ticks\":").append(s.ticks);
            b.append('}');
        }
        return b.append("]}").toString();
    }

    private String sceneJson() {
        StringBuilder b = new StringBuilder();
        b.append("{\"name\":").append(Json.str(name));
        b.append(",\"description\":").append(Json.str(description));
        b.append(",\"warmup\":").append(Json.str(warmup));
        b.append(",\"scene\":").append(Json.str(scene));
        b.append(",\"isScript\":").append(isScript);
        b.append(",\"tickMs\":").append(tickMs);
        b.append(",\"maxTicks\":").append(maxTicks);
        b.append(",\"steps\":[");
        for (int i = 0; i < steps.size(); i++) {
            Instruction s = steps.get(i);
            if (i > 0) b.append(',');
            b.append("{\"op\":").append(Json.str(s.op));
            if (isMove(s.op)) b.append(",\"x\":").append(s.x).append(",\"y\":").append(s.y);
            if (s.op.equals("wait"))       b.append(",\"ticks\":").append(s.ticks);
            if (s.op.equals("advance"))    b.append(",\"times\":").append(s.times);
            if (s.op.equals("advanceAll")) b.append(",\"max\":").append(s.max);
            b.append('}');
        }
        return b.append("]}").toString();
    }
}
