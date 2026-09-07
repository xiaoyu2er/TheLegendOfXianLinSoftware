package devtools;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
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

        Setup(List<String> party, boolean fullHeal, List<Item> equipment, List<Item> drugs) {
            this.party = party; this.fullHeal = fullHeal;
            this.equipment = equipment; this.drugs = drugs;
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
        Instruction(String op, String target, int index, int hero) {
            this.op = op; this.target = target; this.index = index; this.hero = hero;
        }
    }

    private static final List<String> OPS =
            Arrays.asList("tab", "hero", "slot", "select", "use", "abandon");
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
            int index = -1, hero = 0;
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
                default:
                    break;
            }
            steps.add(new Instruction(op, target, index, hero));
        }
        if (steps.isEmpty()) throw new IllegalArgumentException("剧本没有任何指令");

        return new MenuScript(name, description, setup, maxSteps, steps);
    }

    private static Setup loadSetup(Object o) {
        if (o == null) return new Setup(new ArrayList<String>(), true,
                new ArrayList<Item>(), new ArrayList<Item>());
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
        return new Setup(party, JsonIn.boolOr(s, "fullHeal", true),
                loadItems(s.get("equipment"), "setup.equipment"),
                loadItems(s.get("drugs"), "setup.drugs"));
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
