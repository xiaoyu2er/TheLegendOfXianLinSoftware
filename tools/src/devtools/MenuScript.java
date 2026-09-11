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
 * 一份菜单剧本。UTF-8 JSON，用 {@code "driver": "menu"} 自报要哪个驱动器。
 *
 * 为什么不复用 {@link TraceScript}：那一份的指令是场景的词汇（走到某格、推进
 * 对话），每条指令只有 x/y/ticks/times 几个整数槽。菜单的指令是"点哪个按钮"、
 * "把鼠标移到列表第几行"，参数是名字与行号；硬塞进那几个整数槽，剧本读起来
 * 就再也说不清点的是什么。两份格式各自完整，比一份半通用的强。
 *
 * 指令词汇（每条指令展开成一到两个输入事件，见 {@link MenuDriver}）：
 *
 *   tab     {name}   点顶栏四个标题之一：thing / equip / magic / func。按下 + 松开。
 *   hero    {n}      点卷轴上的头像切人：1 张小凡 / 2 陆雪琪 / 4 文敏。按下 + 松开。
 *   slot    {name}   装备页的六个分类：weapon / armor / helmet / shoe / glove / decoration。
 *   select  {index}  把鼠标移到当前列表的第 index 行（从 0 起）。一次 mouseMoved。
 *   use              点"使用"。按下 + 松开。
 *   abandon          点"弃用"。按下 + 松开。
 *   skill   {n}      点奇术页当前角色的第 n 个技能按钮（1..5）。按下 + 松开。
 *   func    {name}   点天书页的一颗按钮。哪几颗点得、哪几颗点不得以及为什么，
 *                    逐颗写在 {@link #FUNC} 里。按下 + 松开。
 *   tick    {n}      显式推进 n 次 {@code FatherPanel.run()} 的循环体，一步一次。
 *
 * tick 是 xl-1vu.9 补上的。菜单的时间驱动是四条 {@code while(true){ Clock.sleep(100);
 * update(); mouse.update(); repaint(); }} 线程，而导出为了确定性把它们冻住了
 * （{@link MenuDriver} 的 SLOW）。冻住之后鼠标图标的循环帧与奇术页技能动画在真值里
 * 是不动的 —— tick 让剧本自己把那个循环体推起来，一步 = 一次，于是这两样东西的
 * 逐帧推进也进了真值。
 *
 * **坐标一律不写在剧本里。** 驱动器从原版按钮对象自己的 x/y/width/height 反算
 * 落点，并在按下之后核对那个按钮真的 isclicked —— 写死坐标的话，原版哪天挪了
 * 一个按钮，剧本会安安静静地点空，导出一份"什么都没发生"的真值。
 *
 * setup 段是**开局状态**，不是期望值：原版的装备/药品初始持有量全是 0，
 * 不给点东西的话装备页永远是空的。给的路径是原版自己的
 * {@code EquipmentPack.addEqupment} / {@code DrugPack.addDrug}。
 */
public final class MenuScript {

    public final String name;
    public final String description;
    public final Setup setup;
    public final int maxSteps;
    public final List<Instruction> steps;

    /** 开局状态。 */
    public static final class Setup {
        /** 已入队的角色，对应 {@code SaveAndLoad.zhang/lu/wen}。 */
        public final List<String> party;
        /** 把三个人的 hp/mp 拉满。见 {@link MenuDriver#start()} 里的说明。 */
        public final boolean fullHeal;
        public final List<Item> equipment;
        public final List<Item> drugs;
        /**
         * 开局先让谁升几级（xl-03x.17）：键是 {@link #PARTY} 里的名字，值是调几次原版自己的
         * {@code levelUp()}。菜单剧本原先没有办法让等级离开出厂值，于是奇术页的技能格数
         * 永远是那三个 static 的初值，「格数随等级涨」在菜单真值里一格都看不见。
         *
         * 走 {@code levelUp()} 而不是直接写 {@code skillNumber}：写 static 的话真值记下的只是
         * 剧本自己写的数，涨的规则一个字都没被原版执行过。空表时不回显（老剧本的回显逐字节不变）。
         */
        public final Map<String, Integer> levelUps;

        Setup(List<String> party, boolean fullHeal, List<Item> equipment, List<Item> drugs,
              Map<String, Integer> levelUps) {
            this.party = party; this.fullHeal = fullHeal;
            this.equipment = equipment; this.drugs = drugs;
            this.levelUps = levelUps;
        }
    }

    public static final class Item {
        public final String name;
        public final int count;
        Item(String name, int count) { this.name = name; this.count = count; }
    }

    public static final class Instruction {
        public final String op;
        /** tab / slot 的目标名；别的指令是 null。 */
        public final String target;
        /** select 的行号；别的指令是 -1。 */
        public final int index;
        /** hero 的角色编号；别的指令是 0。 */
        public final int hero;
        /** tick 的次数 / skill 的技能编号；别的指令是 0。 */
        public final int n;
        Instruction(String op, String target, int index, int hero, int n) {
            this.op = op; this.target = target; this.index = index;
            this.hero = hero; this.n = n;
        }
    }

    private static final List<String> OPS =
            Arrays.asList("tab", "hero", "slot", "select", "use", "abandon", "skill", "func", "tick");

    /**
     * 天书页那 14 颗按钮，逐颗写明：剧本里叫什么、对应 {@code FuncButtons} 上
     * 哪个字段、以及**点不点得**（{@code forbidden} 非空就是点不得，那句话就是
     * 理由）。
     *
     * 为什么名字与字段的映射放在解析层、而不是像 {@code TABS}/{@code SLOTS} 那样
     * 留给驱动器：这张表同时是**分母**。{@link #funcFieldNames()} 与
     * {@code FuncButtons} 上真正声明出来的 MenuButton 字段逐个对撞（见
     * {@code tools/test/devtools/MenuFuncOpTest.java}）—— 原版哪天多一颗、少一颗、
     * 改个名，那条当场红。拆成两处，对撞就得跨文件现拼，而"全集"这句话也就
     * 又变回一句没人守的断言。
     */
    private static final class FuncButton {
        /** {@code FuncButtons} 上的字段名。 */
        final String field;
        /** 点不得的理由；{@code null} 表示点得。 */
        final String forbidden;
        FuncButton(String field, String forbidden) { this.field = field; this.forbidden = forbidden; }
    }

    private static final Map<String, FuncButton> FUNC = new LinkedHashMap<>();
    static {
        // ---- 点得的七颗 ----
        FUNC.put("set",      new FuncButton("setButton", null));
        FUNC.put("setBGM",   new FuncButton("setBGM", null));
        FUNC.put("setClick", new FuncButton("setClick", null));
        FUNC.put("onBGM",    new FuncButton("on_BGM", null));
        FUNC.put("offBGM",   new FuncButton("off_BGM", null));
        FUNC.put("offClick", new FuncButton("off_click", null));
        FUNC.put("exit",     new FuncButton("exitButton", null));

        // ---- 点不得的七颗。前六条的后果都是从 src/ 直接读出来的；
        //      onClick 那条的**前半**同样是读出来的，后半是推断，标在原处。 ----
        FUNC.put("save", new FuncButton("saveButton",
                "存档按钮走 GameLauncher.lsPanel，导出时那个静态字段是 null —— 空指针，不是真值"));
        FUNC.put("read", new FuncButton("readButton",
                "提取按钮同 save，走的是同一个 null 的 lsPanel"));
        FUNC.put("return", new FuncButton("returnButton",
                "返回按钮 GameLauncher.switchTo(\"scene\")，导出时没有 GameLauncher，空指针"));
        FUNC.put("restart", new FuncButton("restart",
                "重新开始同 return，走 GameLauncher.switchTo(\"start\")"));
        FUNC.put("exitForSure", new FuncButton("exitForSure",
                "确认离开直接 System.exit(0)：导出器会在写文件之前消失，而**退出码是 0** ——"
                + " 一次「什么都没导出」长得和成功一模一样，这是本仓库最忌讳的那种失败"));
        FUNC.put("onClick", new FuncButton("on_click",
                "开特殊音效：那一支先 openMusic() 把 CAN_PLAY_MUSIC 打开，紧接着自己就"
                + " readmusic(\"换list.wav\") —— 于是真的开音频设备、起播放线程（这半句从"
                + " src/media/MusicPlayer.playmusic 读得出来）。**「两遍导出因此不可能逐字节一致」是推断，"
                + "没有跑过** —— 正因为它被禁，谁都没让它跑过一次。关的那一侧（offClick）不出声，没有这个问题"));
        FUNC.put("setKey", new FuncButton("setKey",
                "键盘设定在原版里**点不到**：它既不在 buttonList 也不在任何一格 subButtonList，"
                + " 于是 isPressedButton 一次都不会落到它身上（缺陷登记 xl-1dv.16）"));
    }

    /** 点得的那几颗，按登记顺序。用在报错消息里。 */
    private static List<String> funcClickable() {
        List<String> out = new ArrayList<>();
        for (Map.Entry<String, FuncButton> e : FUNC.entrySet()) {
            if (e.getValue().forbidden == null) out.add(e.getKey());
        }
        return out;
    }

    /** 这张表覆盖到的 {@code FuncButtons} 字段名。测试拿它当分母对撞。 */
    static List<String> funcFieldNames() {
        List<String> out = new ArrayList<>();
        for (FuncButton b : FUNC.values()) out.add(b.field);
        return out;
    }

    /**
     * 剧本里的 func 名字 → {@code FuncButtons} 上的字段名。给 {@link MenuDriver} 用。
     * 点不得的那几颗到不了这里（{@link #load} 已经把它们挡在剧本外），返回 null。
     */
    static String funcField(String name) {
        FuncButton b = FUNC.get(name);
        return b == null || b.forbidden != null ? null : b.field;
    }

    private static final List<String> TABS = Arrays.asList("thing", "equip", "magic", "func");
    private static final List<String> SLOTS =
            Arrays.asList("weapon", "armor", "helmet", "shoe", "glove", "decoration");
    private static final List<String> PARTY = Arrays.asList("zhang", "lu", "wen");

    private MenuScript(String name, String description, Setup setup, int maxSteps,
                       List<Instruction> steps) {
        this.name = name; this.description = description; this.setup = setup;
        this.maxSteps = maxSteps; this.steps = steps;
    }

    public static MenuScript load(File f) throws Exception {
        String text = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        Map<String, Object> m = JsonIn.obj(JsonIn.parse(text), "剧本");

        String name = JsonIn.str(m, "name");
        String description = JsonIn.strOr(m, "description", "");
        int maxSteps = JsonIn.iOr(m, "maxSteps", 500);

        Setup setup = loadSetup(m.get("setup"));

        List<Instruction> steps = new ArrayList<>();
        for (Object o : JsonIn.arr(m.get("steps"), "steps")) {
            Map<String, Object> s = JsonIn.obj(o, "指令");
            String op = JsonIn.str(s, "op");
            if (!OPS.contains(op)) {
                throw new IllegalArgumentException("不认识的指令 " + op + "，可用的是 " + OPS);
            }
            String target = null;
            int index = -1, hero = 0, n = 0;
            switch (op) {
                case "tab":
                    target = JsonIn.str(s, "name");
                    if (!TABS.contains(target)) {
                        throw new IllegalArgumentException("tab 的 name 只能是 " + TABS + "，实际 " + target);
                    }
                    break;
                case "slot":
                    target = JsonIn.str(s, "name");
                    if (!SLOTS.contains(target)) {
                        throw new IllegalArgumentException("slot 的 name 只能是 " + SLOTS + "，实际 " + target);
                    }
                    break;
                case "func": {
                    target = JsonIn.str(s, "name");
                    FuncButton b = FUNC.get(target);
                    if (b == null) {
                        throw new IllegalArgumentException("func 的 name 只能是 "
                                + funcClickable() + "，实际 " + target);
                    }
                    if (b.forbidden != null) {
                        throw new IllegalArgumentException("天书页的 " + target
                                + " 按钮不许出现在剧本里：" + b.forbidden);
                    }
                    break;
                }
                case "select":
                    index = JsonIn.i(s, "index");
                    if (index < 0) throw new IllegalArgumentException("select 的 index 不能是负数：" + index);
                    break;
                case "hero":
                    hero = JsonIn.i(s, "n");
                    if (hero != 1 && hero != 2 && hero != 4) {
                        throw new IllegalArgumentException("hero 的 n 只能是 1/2/4（3 号宋大仁原版没做进菜单），实际 " + hero);
                    }
                    break;
                case "skill":
                    n = JsonIn.i(s, "n");
                    if (n < 1 || n > 5) {
                        throw new IllegalArgumentException("skill 的 n 只能是 1..5（每个角色五个技能位），实际 " + n);
                    }
                    break;
                case "tick":
                    // 缺省 1 是为了让 {"op":"tick"} 读起来就是"推一次"。0 或负数没有意义，
                    // 而且展开成零步之后剧本会安安静静地少跑一段 —— 硬失败。
                    n = JsonIn.iOr(s, "n", 1);
                    if (n < 1) throw new IllegalArgumentException("tick 的 n 必须为正，实际 " + n);
                    break;
                default:
                    break;
            }
            steps.add(new Instruction(op, target, index, hero, n));
        }
        if (steps.isEmpty()) throw new IllegalArgumentException("剧本没有任何指令");

        return new MenuScript(name, description, setup, maxSteps, steps);
    }

    private static Setup loadSetup(Object o) {
        if (o == null) return new Setup(new ArrayList<String>(), true,
                new ArrayList<Item>(), new ArrayList<Item>(), new LinkedHashMap<String, Integer>());
        Map<String, Object> s = JsonIn.obj(o, "setup");
        List<String> party = new ArrayList<>();
        if (s.get("party") != null) {
            for (Object p : JsonIn.arr(s.get("party"), "setup.party")) {
                if (!(p instanceof String) || !PARTY.contains(p)) {
                    throw new IllegalArgumentException("setup.party 只能是 " + PARTY + " 里的名字，实际 " + p);
                }
                party.add((String) p);
            }
        }
        Map<String, Integer> levelUps = new LinkedHashMap<>();
        if (s.get("levelUps") != null) {
            Map<String, Object> lu = JsonIn.obj(s.get("levelUps"), "setup.levelUps");
            for (String who : lu.keySet()) {
                if (!PARTY.contains(who)) {
                    throw new IllegalArgumentException("setup.levelUps 的键只能是 " + PARTY + "，实际 " + who);
                }
                int n = JsonIn.i(lu, who);
                // 0 次等于没写，负数没有意义 —— 都硬失败，免得剧本以为自己升过级。
                if (n < 1) throw new IllegalArgumentException("setup.levelUps." + who + " 必须为正，实际 " + n);
                levelUps.put(who, n);
            }
        }
        return new Setup(party, JsonIn.boolOr(s, "fullHeal", true),
                loadItems(s.get("equipment"), "setup.equipment"),
                loadItems(s.get("drugs"), "setup.drugs"),
                levelUps);
    }

    private static List<Item> loadItems(Object o, String what) {
        List<Item> out = new ArrayList<>();
        if (o == null) return out;
        for (Object e : JsonIn.arr(o, what)) {
            Map<String, Object> m = JsonIn.obj(e, what + " 的条目");
            int count = JsonIn.i(m, "count");
            if (count <= 0) throw new IllegalArgumentException(what + " 的数量必须为正，实际 " + count);
            out.add(new Item(JsonIn.str(m, "name"), count));
        }
        return out;
    }

    /** 剧本自身回显进 trace 头部，比对时能一眼看出两端跑的是不是同一份。 */
    public String toJson() {
        StringBuilder b = new StringBuilder();
        b.append("{\"name\":").append(Json.str(name));
        b.append(",\"description\":").append(Json.str(description));
        b.append(",\"setup\":{\"party\":[");
        for (int i = 0; i < setup.party.size(); i++) {
            if (i > 0) b.append(',');
            b.append(Json.str(setup.party.get(i)));
        }
        b.append("],\"fullHeal\":").append(setup.fullHeal);
        b.append(",\"equipment\":").append(itemsJson(setup.equipment));
        b.append(",\"drugs\":").append(itemsJson(setup.drugs));
        if (!setup.levelUps.isEmpty()) {
            b.append(",\"levelUps\":{");
            int i = 0;
            for (Map.Entry<String, Integer> e : setup.levelUps.entrySet()) {
                if (i++ > 0) b.append(',');
                b.append(Json.str(e.getKey())).append(':').append(e.getValue());
            }
            b.append('}');
        }
        b.append("}");
        b.append(",\"maxSteps\":").append(maxSteps);
        b.append(",\"steps\":[");
        for (int i = 0; i < steps.size(); i++) {
            Instruction s = steps.get(i);
            if (i > 0) b.append(',');
            b.append("{\"op\":").append(Json.str(s.op));
            if (s.target != null) b.append(",\"name\":").append(Json.str(s.target));
            if (s.op.equals("select")) b.append(",\"index\":").append(s.index);
            if (s.op.equals("hero")) b.append(",\"n\":").append(s.hero);
            if (s.op.equals("skill") || s.op.equals("tick")) b.append(",\"n\":").append(s.n);
            b.append('}');
        }
        return b.append("]}").toString();
    }

    private static String itemsJson(List<Item> items) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < items.size(); i++) {
            if (i > 0) b.append(',');
            b.append("{\"name\":").append(Json.str(items.get(i).name))
             .append(",\"count\":").append(items.get(i).count).append('}');
        }
        return b.append(']').toString();
    }
}
