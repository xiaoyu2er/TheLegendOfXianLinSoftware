package devtools;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * 一份标题页剧本（xl-whk）。UTF-8 JSON，用 {@code "driver": "start"} 自报。
 *
 * 为什么不复用别的剧本类：标题页的输入是**坐标**（原版三个鼠标监听器只认
 * {@code e.getX()} / {@code e.getY()}），而时间由一条 100 ms 的线程推 —— 与结局
 * 同形，却多了鼠标；与菜单的鼠标也不同形，那边一次点击是一步，这边按下与松开
 * 分成两步，因为原版 {@code mouseReleased} 里 {@code setButton()} 读的是按下时置上的
 * {@code isclicked}，两步之间那一刻正是要看的状态。
 *
 * 指令词汇（见 {@link StartDriver}）：
 *
 *   tick    {times, expect?}   推 times 拍，一拍 = 原版那条线程的循环体一次（驱动器把它
 *                              从 sleep 里叫醒，走的是原版自己的循环体）+ 一次 paint()。
 *                              expect 只认三个：
 *                                unfold —— isUnfolded 恰好在这条指令的最后一拍翻真；
 *                                fold   —— isUnfolded 恰好在最后一拍翻假；
 *                                switch —— 恰好在最后一拍切走面板（「起」/「承」的收尾）。
 *                              早了晚了都是硬失败 —— 拍数从源码推出来之后，由它核。
 *   move    {x, y}             一次 mouseMoved。一步。
 *   press   {x, y}             一次 mousePressed。一步。
 *   release {x, y}             一次 mouseReleased。一步。
 *
 * 输入步**不画**：原版三个监听器一句 {@code repaint()} 都没有，画面只在下一拍刷新。
 * 于是第一条指令必须是 tick —— 在它之前原版一帧都没画过，位图是一整张透明。
 */
public final class StartScript {

    public final String name;
    public final String description;
    public final int maxSteps;
    public final List<Instruction> steps;

    public static final class Instruction {
        public final String op;
        /** tick 的拍数；别的指令是 1。 */
        public final int times;
        /** tick 的 expect；没写是 null。 */
        public final String expect;
        /** 鼠标指令的坐标；tick 是 0。 */
        public final int x;
        public final int y;
        Instruction(String op, int times, String expect, int x, int y) {
            this.op = op; this.times = times; this.expect = expect; this.x = x; this.y = y;
        }
    }

    static final List<String> OPS = Arrays.asList("tick", "move", "press", "release");
    static final List<String> EXPECTS = Arrays.asList("unfold", "fold", "switch");

    /** 舞台尺寸：原版 {@code WIDTH = 32*32}、{@code HEIGHT = 32*20}。坐标出了这个框，监听器根本收不到。 */
    static final int WIDTH = 1024;
    static final int HEIGHT = 640;

    private StartScript(String name, String description, int maxSteps, List<Instruction> steps) {
        this.name = name; this.description = description; this.maxSteps = maxSteps; this.steps = steps;
    }

    public static StartScript load(File f) throws Exception {
        String text = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        Map<String, Object> m = JsonIn.obj(JsonIn.parse(text), "剧本");

        String name = JsonIn.str(m, "name");
        String description = JsonIn.strOr(m, "description", "");
        int maxSteps = JsonIn.iOr(m, "maxSteps", 1000);

        List<Instruction> steps = new ArrayList<>();
        for (Object o : JsonIn.arr(m.get("steps"), "steps")) {
            Map<String, Object> s = JsonIn.obj(o, "指令");
            String op = JsonIn.str(s, "op");
            if (!OPS.contains(op)) {
                throw new IllegalArgumentException("不认识的指令 " + op + "，可用的是 " + OPS);
            }
            if (op.equals("tick")) {
                int times = JsonIn.i(s, "times");
                if (times < 1) throw new IllegalArgumentException("tick 的 times 至少是 1：" + times);
                String expect = JsonIn.strOr(s, "expect", null);
                if (expect != null && !EXPECTS.contains(expect)) {
                    throw new IllegalArgumentException("tick 的 expect 只认 " + EXPECTS + "，实际 " + expect);
                }
                steps.add(new Instruction(op, times, expect, 0, 0));
            } else {
                int x = JsonIn.i(s, "x");
                int y = JsonIn.i(s, "y");
                if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) {
                    throw new IllegalArgumentException(op + " 的坐标 (" + x + "," + y + ") 不在 "
                            + WIDTH + "×" + HEIGHT + " 的面板里 —— 原版的监听器收不到");
                }
                steps.add(new Instruction(op, 1, null, x, y));
            }
        }
        if (steps.isEmpty()) throw new IllegalArgumentException("剧本没有任何指令");
        if (!steps.get(0).op.equals("tick")) {
            throw new IllegalArgumentException("第一条指令必须是 tick —— 输入步不画，而第一拍之前原版一帧都还没画过");
        }
        return new StartScript(name, description, maxSteps, steps);
    }

    /** 剧本自身回显进 trace 头部。 */
    public String toJson() {
        StringBuilder b = new StringBuilder();
        b.append("{\"name\":").append(Json.str(name));
        b.append(",\"description\":").append(Json.str(description));
        b.append(",\"maxSteps\":").append(maxSteps);
        b.append(",\"steps\":[");
        for (int i = 0; i < steps.size(); i++) {
            Instruction s = steps.get(i);
            if (i > 0) b.append(',');
            b.append("{\"op\":").append(Json.str(s.op));
            if (s.op.equals("tick")) {
                b.append(",\"times\":").append(s.times);
                if (s.expect != null) b.append(",\"expect\":").append(Json.str(s.expect));
            } else {
                b.append(",\"x\":").append(s.x).append(",\"y\":").append(s.y);
            }
            b.append('}');
        }
        return b.append("]}").toString();
    }
}
