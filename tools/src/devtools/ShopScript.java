package devtools;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * 一份商店剧本。UTF-8 JSON，用 {@code "driver": "shop"} 自报要哪个驱动器。
 *
 * 与 {@link MenuScript} 同形状：**一步 = 一次输入事件**，不是一个 tick。理由也
 * 同源 —— {@code ShopPanel} / {@code EquipmentShopPanel} 里唯一的时间驱动是那条
 * {@code while(true){ for(i=0..7){ 换鼠标帧与人物帧; Clock.sleep(120); repaint(); } } }
 * 线程，它推的只有鼠标图标与四个店内人物的循环动画；商店里所有**可断言的状态
 * 变化**（切分类、加减交易量、买、卖、金钱、背包）无一例外由一次鼠标事件同步引起。
 *
 * 为什么不复用 {@link MenuScript}：菜单的词汇是"点哪个标题 / 换哪个人 / 选第几行"，
 * 商店的词汇是"开哪家店 / 切哪个分类 / 第几行加一件 / 买 / 卖"。两者的参数意义
 * 不一样，硬并成一份就再也说不清点的是什么。
 *
 * 指令词汇（每条指令展开成一到两个输入事件，见 {@link ShopDriver}）：
 *
 *   open      {name}    切到哪家店：drug 药店 / equipment 装备自选超市。
 *                       不产生输入事件，但**算一步** —— 原版是靠场景里的选择事件
 *                       {@code GameLauncher.switchTo} 进店的，那一下同样是一次跳转。
 *   category  {name}    只用于装备店：weapon / helmet / armor / glove / shoe / decoration。按下 + 松开。
 *   hover     {index}   把鼠标移到商品列表第 index 行。一次 mouseMoved。
 *   plus      {index}   第 index 行的"增加"按钮。按下 + 松开。
 *   minus     {index}   第 index 行的"减少"按钮。按下 + 松开。
 *   buy                 点"购买"。按下 + 松开。
 *   sell                点"卖出"。按下 + 松开。
 *
 * **没有 back。** 原版那个按钮直接调 {@code GameLauncher.switchTo("scene")}，
 * 而导出器里根本没有 GameLauncher 的窗口 —— 给它留个指令等于留一条只会崩的路。
 *
 * **坐标一律不写在剧本里**，与菜单同理：驱动器从原版 {@code GameButton} 自己的
 * x/y/width/height 反算落点，按下之后核对那个按钮真的 isclicked、且**只有它**
 * isclicked。写死坐标的话，点空会导出一份"什么都没发生"却步数完全正确的真值。
 *
 * setup 段是**开局状态**：
 *
 *   seed        必填。两家店的存货是 {@code (int)(Math.random()*10)} 逐件掷出来的
 *               （药店 6 件、装备店 56 件，按构造顺序共 62 次）。不播种子的话
 *               同一份剧本每次跑出来的存货都不同，真值一次都对不上。
 *   coins       开局金钱，默认取原版的 {@code Money.coins} 初值 10000。
 *   party       已入队的角色，对应 {@code SaveAndLoad.zhang/lu/wen}（决定店里画谁）。
 *   drugs       开局背包里的药品，走原版自己的 {@code DrugPack.addDrug}。
 *   equipment   开局背包里的装备，走原版自己的 {@code EquipmentPack.addEqupment}。
 */
public final class ShopScript {

    public final String name;
    public final String description;
    public final Setup setup;
    public final int maxSteps;
    public final List<Instruction> steps;

    /** 开局状态。 */
    public static final class Setup {
        public final List<String> party;
        public final int coins;
        public final int seed;
        public final List<Item> drugs;
        public final List<Item> equipment;

        Setup(List<String> party, int coins, int seed, List<Item> drugs, List<Item> equipment) {
            this.party = party; this.coins = coins; this.seed = seed;
            this.drugs = drugs; this.equipment = equipment;
        }
    }

    public static final class Item {
        public final String name;
        public final int count;
        Item(String name, int count) { this.name = name; this.count = count; }
    }

    public static final class Instruction {
        public final String op;
        /** open / category 的目标名；别的指令是 null。 */
        public final String target;
        /** hover / plus / minus 的行号；别的指令是 -1。 */
        public final int index;
        Instruction(String op, String target, int index) {
            this.op = op; this.target = target; this.index = index;
        }
    }

    private static final List<String> OPS =
            Arrays.asList("open", "category", "hover", "plus", "minus", "buy", "sell");
    /** 两家店。判别名与 {@code ShopDriver} 里的分派、真值 shop 字段是同一套字符串。 */
    public static final List<String> SHOPS = Arrays.asList("drug", "equipment");
    /** 装备店的六个分类。字符串必须与原版 {@code EquipmentShopPanel.listTable} 的 case 一致。 */
    public static final List<String> CATEGORIES =
            Arrays.asList("weapon", "helmet", "armor", "glove", "shoe", "decoration");
    private static final List<String> PARTY = Arrays.asList("zhang", "lu", "wen");

    private ShopScript(String name, String description, Setup setup, int maxSteps,
                       List<Instruction> steps) {
        this.name = name; this.description = description; this.setup = setup;
        this.maxSteps = maxSteps; this.steps = steps;
    }

    public static ShopScript load(File f) throws Exception {
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
                throw new IllegalArgumentException("不认识的指令 " + op + "，可用的是 " + OPS
                        + "（没有 back —— 原版那个按钮会切场景，导出器里没有窗口）");
            }
            String target = null;
            int index = -1;
            switch (op) {
                case "open":
                    target = JsonIn.str(s, "name");
                    if (!SHOPS.contains(target)) {
                        throw new IllegalArgumentException("open 的 name 只能是 " + SHOPS + "，实际 " + target);
                    }
                    break;
                case "category":
                    target = JsonIn.str(s, "name");
                    if (!CATEGORIES.contains(target)) {
                        throw new IllegalArgumentException("category 的 name 只能是 " + CATEGORIES
                                + "，实际 " + target);
                    }
                    break;
                case "hover": case "plus": case "minus":
                    index = JsonIn.i(s, "index");
                    if (index < 0) {
                        throw new IllegalArgumentException(op + " 的 index 不能是负数：" + index);
                    }
                    break;
                default:
                    break;
            }
            steps.add(new Instruction(op, target, index));
        }
        if (steps.isEmpty()) throw new IllegalArgumentException("剧本没有任何指令");
        if (!steps.get(0).op.equals("open")) {
            throw new IllegalArgumentException("第一条指令必须是 open —— 不说开哪家店，"
                    + "后面每一条都不知道该派发给谁；实际是 " + steps.get(0).op);
        }
        return new ShopScript(name, description, setup, maxSteps, steps);
    }

    private static Setup loadSetup(Object o) {
        if (o == null) {
            throw new IllegalArgumentException("商店剧本必须有 setup —— 至少要给 seed，"
                    + "存货是掷出来的，不播种子就没有可复现的真值");
        }
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
        if (s.get("seed") == null) {
            throw new IllegalArgumentException("setup 缺 seed —— 见 ShopScript 类注释");
        }
        return new Setup(party, JsonIn.iOr(s, "coins", 10000), JsonIn.i(s, "seed"),
                loadItems(s.get("drugs"), "setup.drugs"),
                loadItems(s.get("equipment"), "setup.equipment"));
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
        b.append("],\"coins\":").append(setup.coins);
        b.append(",\"seed\":").append(setup.seed);
        b.append(",\"drugs\":").append(itemsJson(setup.drugs));
        b.append(",\"equipment\":").append(itemsJson(setup.equipment));
        b.append("}");
        b.append(",\"maxSteps\":").append(maxSteps);
        b.append(",\"steps\":[");
        for (int i = 0; i < steps.size(); i++) {
            Instruction s = steps.get(i);
            if (i > 0) b.append(',');
            b.append("{\"op\":").append(Json.str(s.op));
            if (s.target != null) b.append(",\"name\":").append(Json.str(s.target));
            if (s.index >= 0) b.append(",\"index\":").append(s.index);
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
