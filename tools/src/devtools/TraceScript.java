package devtools;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
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
 *   talk               按一次空格（对着相邻 NPC 就是搭话）。
 *   advance {times}    推进对话 times 次；每次都等当前句逐字打完再按空格。
 *                      对话在按满 times 次之前就结束了 —— 硬失败。
 *   advanceAll {max}   一直推进到对话结束，最多 max 次；到 max 还没结束 —— 硬失败。
 *   wait    {ticks}    空等若干 tick。
 *   waitIdle           等到主角的走/跑定时器都停下（即已对齐到格）。
 *   waitNarratage      等到旁白播完（narratageOver）。
 *
 * 每条指令有 tick 预算（budget，默认 2000）。超预算是硬失败，不是静默跳过 ——
 * "走不到就当走到了"会导出一份看上去正常、实际错位的 trace。
 */
public final class TraceScript {

    public final String name;
    public final String description;
    public final String warmup;   // 预热脚本，可为 null
    public final String scene;
    public final boolean isScript;
    public final int tickMs;
    public final int maxTicks;
    public final List<Instruction> steps;

    public static final class Instruction {
        public final String op;
        public final int x, y, ticks, times, max, budget;
        Instruction(String op, int x, int y, int ticks, int times, int max, int budget) {
            this.op = op; this.x = x; this.y = y;
            this.ticks = ticks; this.times = times; this.max = max; this.budget = budget;
        }
    }

    private static final List<String> OPS = Arrays.asList(
            "walkTo", "runTo", "talk", "advance", "advanceAll", "wait", "waitIdle", "waitNarratage");

    private TraceScript(String name, String description, String warmup, String scene,
                        boolean isScript, int tickMs, int maxTicks, List<Instruction> steps) {
        this.name = name; this.description = description; this.warmup = warmup;
        this.scene = scene; this.isScript = isScript;
        this.tickMs = tickMs; this.maxTicks = maxTicks; this.steps = steps;
    }

    public static TraceScript load(File f) throws Exception {
        String text = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        Map<String, Object> m = JsonIn.obj(JsonIn.parse(text), "剧本");

        String name = JsonIn.str(m, "name");
        String description = JsonIn.strOr(m, "description", "");
        String warmup = JsonIn.strOr(m, "warmup", null);
        String scene = JsonIn.str(m, "scene");
        boolean isScript = JsonIn.boolOr(m, "isScript", false);
        int tickMs = JsonIn.iOr(m, "tickMs", 10);
        int maxTicks = JsonIn.iOr(m, "maxTicks", 20000);

        // 原版所有定时器的间隔都是 10 的倍数（10/20/30/40/50/80/100/180/200/500）。
        // tick 步长若不整除它们，触发时刻就会被舍入，trace 与原版语义不再一致。
        if (tickMs <= 0 || 10 % tickMs != 0) {
            throw new IllegalArgumentException("tickMs 必须能整除 10（原版定时器间隔的最大公约数），实际 " + tickMs);
        }

        List<Instruction> steps = new ArrayList<>();
        for (Object o : JsonIn.arr(m.get("steps"), "steps")) {
            Map<String, Object> s = JsonIn.obj(o, "指令");
            String op = JsonIn.str(s, "op");
            if (!OPS.contains(op)) {
                throw new IllegalArgumentException("不认识的指令 " + op + "，可用的是 " + OPS);
            }
            int x = 0, y = 0, ticks = 0, times = 0, max = 0;
            if (op.equals("walkTo") || op.equals("runTo")) { x = JsonIn.i(s, "x"); y = JsonIn.i(s, "y"); }
            if (op.equals("wait"))       ticks = JsonIn.i(s, "ticks");
            if (op.equals("advance"))    times = JsonIn.i(s, "times");
            if (op.equals("advanceAll")) max   = JsonIn.iOr(s, "max", 64);
            steps.add(new Instruction(op, x, y, ticks, times, max, JsonIn.iOr(s, "budget", 2000)));
        }
        if (steps.isEmpty()) throw new IllegalArgumentException("剧本没有任何指令");

        return new TraceScript(name, description, warmup, scene, isScript, tickMs, maxTicks, steps);
    }

    /** 剧本自身回显进 trace 头部，比对时能一眼看出两端跑的是不是同一份。 */
    public String toJson() {
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
            if (s.op.equals("walkTo") || s.op.equals("runTo")) b.append(",\"x\":").append(s.x).append(",\"y\":").append(s.y);
            if (s.op.equals("wait"))       b.append(",\"ticks\":").append(s.ticks);
            if (s.op.equals("advance"))    b.append(",\"times\":").append(s.times);
            if (s.op.equals("advanceAll")) b.append(",\"max\":").append(s.max);
            b.append('}');
        }
        return b.append("]}").toString();
    }
}
