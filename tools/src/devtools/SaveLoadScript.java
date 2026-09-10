package devtools;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * 一份存读档面板剧本（xl-i06.6）。UTF-8 JSON，用 {@code "driver": "saveload"} 自报。
 *
 * 为什么不复用 {@link MenuScript}：那一份的词汇是菜单的四页与各页按钮，
 * 这个面板只有「一排槽位 + 一个退出键」，外加一件菜单剧本里根本没有的事 ——
 * **从哪个面板进来**。原版的进入是别的面板替它做的三行
 * （{@code setLastPanel} / {@code changeStateTo} / {@code switchTo("ls")}，
 * 见 {@code FuncButtons} 的存档与提取两颗、{@code StartPanel} 的「承」），
 * 所以「进来」本身就是一条指令。
 *
 * 指令词汇（见 {@link SaveLoadDriver}）：
 *
 *   enter  {mode, from}  进面板：mode 是 save / load，from 是 menu / start。一步。
 *   slot   {n}           点第 n 个槽位（从 0 起）。按下 + 松开，两步。
 *   escape               按退出键。一步。
 *
 * **槽位坐标不写在剧本里**，理由同菜单剧本：驱动器从原版按钮对象自己的几何算落点，
 * 按下之后核对那个按钮真的 isclicked。
 *
 * setup 段是**开局状态**，不是期望值：
 *
 *   scene       原版写档装置要存的那个场景（{@code ScenePanel.initiation} 的入参）。
 *   warmup      先加载一遍的场景，可省。理由同场景剧本的 warmup。
 *   party       已入队的角色，对应 {@code SaveAndLoad.zhang/lu/wen}。
 *   emptySlots  开局前从草稿区删掉哪几个槽的档 —— 入库的样例把每个槽都占满了，
 *               不删就走不到「点空槽读档什么都不发生」那条路。删的是草稿区，
 *               驱动器收尾把它从真值目录还原。
 */
public final class SaveLoadScript {

    public final String name;
    public final String description;
    public final Setup setup;
    public final int maxSteps;
    public final List<Instruction> steps;

    public static final class Setup {
        public final String scene;
        /** 可为 null。 */
        public final String warmup;
        public final List<String> party;
        public final List<Integer> emptySlots;

        Setup(String scene, String warmup, List<String> party, List<Integer> emptySlots) {
            this.scene = scene; this.warmup = warmup; this.party = party; this.emptySlots = emptySlots;
        }
    }

    public static final class Instruction {
        public final String op;
        /** enter 的 save / load；别的指令是 null。 */
        public final String mode;
        /** enter 的 menu / start；别的指令是 null。 */
        public final String from;
        /** slot 的槽位下标；别的指令是 -1。 */
        public final int n;
        Instruction(String op, String mode, String from, int n) {
            this.op = op; this.mode = mode; this.from = from; this.n = n;
        }
    }

    static final List<String> OPS = Arrays.asList("enter", "slot", "escape");
    static final List<String> MODES = Arrays.asList("save", "load");
    /**
     * 原版里调 {@code lsPanel.setLastPanel} 的只有这两处：{@code FuncButtons}（"menu"）
     * 与 {@code StartPanel}（"start"）。多写一个名字，退出键会把 {@code switchTo}
     * 送进一个它不认识的分支 —— 原版的 switch 没有 default，什么都不做，
     * 于是「按了退出键没回去」与「回去了」只差一个没人看的字段。
     */
    static final List<String> FROMS = Arrays.asList("menu", "start");
    private static final List<String> PARTY = Arrays.asList("zhang", "lu", "wen");

    private SaveLoadScript(String name, String description, Setup setup, int maxSteps,
                           List<Instruction> steps) {
        this.name = name; this.description = description; this.setup = setup;
        this.maxSteps = maxSteps; this.steps = steps;
    }

    public static SaveLoadScript load(File f) throws Exception {
        String text = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        Map<String, Object> m = JsonIn.obj(JsonIn.parse(text), "剧本");

        String name = JsonIn.str(m, "name");
        String description = JsonIn.strOr(m, "description", "");
        int maxSteps = JsonIn.iOr(m, "maxSteps", 200);
        Setup setup = loadSetup(JsonIn.obj(m.get("setup"), "setup"));

        List<Instruction> steps = new ArrayList<>();
        for (Object o : JsonIn.arr(m.get("steps"), "steps")) {
            Map<String, Object> s = JsonIn.obj(o, "指令");
            String op = JsonIn.str(s, "op");
            if (!OPS.contains(op)) {
                throw new IllegalArgumentException("不认识的指令 " + op + "，可用的是 " + OPS);
            }
            String mode = null, from = null;
            int n = -1;
            switch (op) {
                case "enter":
                    mode = JsonIn.str(s, "mode");
                    if (!MODES.contains(mode)) {
                        throw new IllegalArgumentException("enter 的 mode 只能是 " + MODES + "，实际 " + mode);
                    }
                    from = JsonIn.str(s, "from");
                    if (!FROMS.contains(from)) {
                        throw new IllegalArgumentException("enter 的 from 只能是 " + FROMS + "，实际 " + from);
                    }
                    break;
                case "slot":
                    // 上界不在这里判：有几个槽是原版面板说了算（按钮列表的长度），
                    // 驱动器建好面板之后当场核。
                    n = JsonIn.i(s, "n");
                    if (n < 0) throw new IllegalArgumentException("slot 的 n 不能是负数：" + n);
                    break;
                default:
                    break;
            }
            steps.add(new Instruction(op, mode, from, n));
        }
        if (steps.isEmpty()) throw new IllegalArgumentException("剧本没有任何指令");
        if (!steps.get(0).op.equals("enter")) {
            throw new IllegalArgumentException("第一条指令必须是 enter —— 没进面板之前点槽位、按退出键，原版一样都收不到");
        }
        return new SaveLoadScript(name, description, setup, maxSteps, steps);
    }

    private static Setup loadSetup(Map<String, Object> s) {
        String scene = JsonIn.str(s, "scene");
        String warmup = JsonIn.strOr(s, "warmup", null);
        List<String> party = new ArrayList<>();
        for (Object p : JsonIn.arr(s.get("party"), "setup.party")) {
            if (!(p instanceof String) || !PARTY.contains(p)) {
                throw new IllegalArgumentException("setup.party 只能是 " + PARTY + " 里的名字，实际 " + p);
            }
            party.add((String) p);
        }
        List<Integer> empty = new ArrayList<>();
        if (s.get("emptySlots") != null) {
            for (Object o : JsonIn.arr(s.get("emptySlots"), "setup.emptySlots")) {
                if (!(o instanceof Number) || ((Number) o).intValue() < 0) {
                    throw new IllegalArgumentException("setup.emptySlots 只能是非负整数，实际 " + o);
                }
                empty.add(((Number) o).intValue());
            }
        }
        return new Setup(scene, warmup, party, empty);
    }

    /** 剧本自身回显进 trace 头部。 */
    public String toJson() {
        StringBuilder b = new StringBuilder();
        b.append("{\"name\":").append(Json.str(name));
        b.append(",\"description\":").append(Json.str(description));
        b.append(",\"setup\":{\"scene\":").append(Json.str(setup.scene));
        b.append(",\"warmup\":").append(Json.str(setup.warmup));
        b.append(",\"party\":").append(Json.arrStr(setup.party));
        b.append(",\"emptySlots\":").append(setup.emptySlots.toString().replace(" ", ""));
        b.append("}");
        b.append(",\"maxSteps\":").append(maxSteps);
        b.append(",\"steps\":[");
        for (int i = 0; i < steps.size(); i++) {
            Instruction s = steps.get(i);
            if (i > 0) b.append(',');
            b.append("{\"op\":").append(Json.str(s.op));
            if (s.mode != null) b.append(",\"mode\":").append(Json.str(s.mode));
            if (s.from != null) b.append(",\"from\":").append(Json.str(s.from));
            if (s.op.equals("slot")) b.append(",\"n\":").append(s.n);
            b.append('}');
        }
        return b.append("]}").toString();
    }
}
