package devtools;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * 一份结局面板剧本（xl-czb.5）。UTF-8 JSON，用 {@code "driver": "end"} 自报。
 *
 * 为什么不复用别的剧本类：结局面板**没有任何键鼠监听**，剧本的主体就是「推多少拍」。
 * 另外三件事是这个面板独有的 —— 进来（原版唯一的入口是一句 {@code switchTo("end")}）、
 * 在结局期间按键（按键落到哪一块面板正是要记的读数）、把原版那条停不下来的线程
 * 真的叫醒几次（「线程永不退出」的读数）。
 *
 * 指令词汇（见 {@link EndDriver}）：
 *
 *   enter                    进结局：原版那一句 switchTo("end")。一步。必须是第一条，且只有一条。
 *   tick  {times, expect?}   推 times 拍，一拍 = EndPanel.run() 循环体去掉 sleep 那一句
 *                            （即一次 update()）+ 一次 paint()。expect 只认 "stop"：
 *                            isStop 必须**恰好在这条指令的最后一拍**翻真，早了晚了都是硬失败。
 *   key   {key}              经原版 GameLauncher.keyPressed 分发一次按键。一步。
 *   wake  {times}            把原版那条线程从 sleep 里叫醒 times 次，每次等它走完一整圈
 *                            循环体再睡回去。一次一步。只许在 isStop 之后 —— 之前叫醒它
 *                            会与驱动器自己推的 update() 抢同一批字段。
 *
 * setup 段是**开局状态**：
 *
 *   scene   switchTo("end") 那一刻原版站在哪本脚本上（{@code ScenePanel.initiation} 的入参）。
 *           原版唯一的调用点在 {@code DialogueEvent.keyPressed}，它读的是对话文本里的
 *           {@code '$'}（{@code Dialogue} 绘制时把它翻成 {@code gameOver}）。
 */
public final class EndScript {

    public final String name;
    public final String description;
    public final String scene;
    public final int maxSteps;
    public final List<Instruction> steps;

    public static final class Instruction {
        public final String op;
        /** tick / wake 的次数；别的指令是 1。 */
        public final int times;
        /** tick 的 expect（只认 "stop"）；没写是 null。 */
        public final String expect;
        /** key 的键名；别的指令是 null。 */
        public final String key;
        Instruction(String op, int times, String expect, String key) {
            this.op = op; this.times = times; this.expect = expect; this.key = key;
        }
    }

    static final List<String> OPS = Arrays.asList("enter", "tick", "key", "wake");
    /**
     * 认得的键名。{@code ScenePanel.keyPressed}（按键实际落到的地方，见 {@link EndDriver}）
     * 分支判的就是这七个键；多认一个不会错，但也读不出任何新东西。
     */
    static final List<String> KEYS = Arrays.asList("enter", "escape", "space", "left", "right", "up", "down");

    private EndScript(String name, String description, String scene, int maxSteps, List<Instruction> steps) {
        this.name = name; this.description = description; this.scene = scene;
        this.maxSteps = maxSteps; this.steps = steps;
    }

    public static EndScript load(File f) throws Exception {
        String text = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        Map<String, Object> m = JsonIn.obj(JsonIn.parse(text), "剧本");

        String name = JsonIn.str(m, "name");
        String description = JsonIn.strOr(m, "description", "");
        int maxSteps = JsonIn.iOr(m, "maxSteps", 1000);
        String scene = JsonIn.str(JsonIn.obj(m.get("setup"), "setup"), "scene");

        List<Instruction> steps = new ArrayList<>();
        for (Object o : JsonIn.arr(m.get("steps"), "steps")) {
            Map<String, Object> s = JsonIn.obj(o, "指令");
            String op = JsonIn.str(s, "op");
            if (!OPS.contains(op)) {
                throw new IllegalArgumentException("不认识的指令 " + op + "，可用的是 " + OPS);
            }
            int times = 1;
            String expect = null, key = null;
            switch (op) {
                case "tick":
                case "wake":
                    times = JsonIn.i(s, "times");
                    if (times < 1) throw new IllegalArgumentException(op + " 的 times 至少是 1：" + times);
                    if (op.equals("tick")) {
                        expect = JsonIn.strOr(s, "expect", null);
                        if (expect != null && !expect.equals("stop")) {
                            throw new IllegalArgumentException("tick 的 expect 只认 \"stop\"，实际 " + expect);
                        }
                    }
                    break;
                case "key":
                    key = JsonIn.str(s, "key");
                    if (!KEYS.contains(key)) {
                        throw new IllegalArgumentException("key 只认 " + KEYS + "，实际 " + key);
                    }
                    break;
                default:
                    break;
            }
            steps.add(new Instruction(op, times, expect, key));
        }
        if (steps.isEmpty()) throw new IllegalArgumentException("剧本没有任何指令");
        if (!steps.get(0).op.equals("enter")) {
            throw new IllegalArgumentException("第一条指令必须是 enter —— 没进结局之前，这个面板一拍都不走");
        }
        for (int i = 1; i < steps.size(); i++) {
            if (steps.get(i).op.equals("enter")) {
                throw new IllegalArgumentException("第 " + i + " 条又是 enter —— 原版每进一次就多起一条线程，这份剧本只进一次");
            }
        }
        return new EndScript(name, description, scene, maxSteps, steps);
    }

    /** 剧本自身回显进 trace 头部。 */
    public String toJson() {
        StringBuilder b = new StringBuilder();
        b.append("{\"name\":").append(Json.str(name));
        b.append(",\"description\":").append(Json.str(description));
        b.append(",\"setup\":{\"scene\":").append(Json.str(scene)).append('}');
        b.append(",\"maxSteps\":").append(maxSteps);
        b.append(",\"steps\":[");
        for (int i = 0; i < steps.size(); i++) {
            Instruction s = steps.get(i);
            if (i > 0) b.append(',');
            b.append("{\"op\":").append(Json.str(s.op));
            if (s.op.equals("tick") || s.op.equals("wake")) b.append(",\"times\":").append(s.times);
            if (s.expect != null) b.append(",\"expect\":").append(Json.str(s.expect));
            if (s.key != null) b.append(",\"key\":").append(Json.str(s.key));
            b.append('}');
        }
        return b.append("]}").toString();
    }
}
