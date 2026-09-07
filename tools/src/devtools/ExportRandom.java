package devtools;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 随机数黄金数据导出器：种子 -> 前 N 个取值，由**真的** {@link java.util.Random}
 * 跑出来，供 web 端那份手写的位精确复刻逐个对。
 *
 * <h2>为什么要这份数据</h2>
 *
 * 按覆盖算它是多余的 —— 行为真值对上了随机数必然对。它换的是**可定位性**：
 * 随机数错一位会让 404 步的战斗真值从某一拍开始全线崩，没有这个判据就分不清
 * 是随机数错了还是伤害公式抄错了。理由见 {@code docs/adr/0004-bit-exact-java-random.md}。
 *
 * <h2>导出哪些取值形态</h2>
 *
 * 原版一次都没有调用过 {@code Random.nextInt(int)}，它只用 {@code Math.random()}，
 * 而 {@code Math.random()} 就是一个全局 {@code Random} 的 {@code nextDouble()}。
 * 要整数时原版一律写 {@code (int)(Math.random()*N)} —— 那是**乘完截尾**，
 * 和 {@code nextInt(N)} 的拒绝采样是两个不同的算法、不同的序列。所以这里导出两样：
 *
 * <ul>
 *   <li>{@code doubles} —— 连续的 {@code nextDouble()}，另附 {@code doubleBits}
 *       （IEEE-754 位模式的十六进制），让"逐位相同"是字面意义上可验的，
 *       而不是靠"十进制往返应该无损"这句没人跑过的话。</li>
 *   <li>{@code ints} —— 每个上界 N 各起一条**全新**的流，导出
 *       {@code (int)(nextDouble()*N)}。上界取自原版实际写过的那些字面量。</li>
 *   <li>{@code states} —— 每次 {@code nextDouble()} 前后的 48 位内部状态。
 *       它是"跨过 48 位回绕"那条边界判据的依据：JS 没有 64 位整数，
 *       48 位状态乘 35 位乘数是 83 位，用 Number 硬算会在这里悄悄丢精度，
 *       而丢了精度的序列前几个值可能还是对的。</li>
 * </ul>
 *
 * <h2>种子从哪来</h2>
 *
 * 四个写死的边界种子，加上 {@code tools/traces/scripts/} 下**每一份剧本**声明的
 * 种子（顶层的 {@code seed} 与 {@code setup.seed} 都算）。后者是推导来的而不是
 * 抄来的：新加一份带种子的剧本、却忘了重跑这个导出器，web 端那条测试会因为
 * "剧本要的种子不在黄金数据里"而变红，而不是安静地少覆盖一个。
 *
 * <p>用法: {@code java devtools.ExportRandom [输出文件]}，需要
 * {@code --add-opens java.base/java.util=ALL-UNNAMED}（要读 Random 私有的 seed）。
 * 见 {@code tools/export-random.sh}。
 */
public class ExportRandom {

    /** 规范写死的 48 位 LCG 参数，见 java.util.Random 的类注释。 */
    static final long MULTIPLIER = 0x5DEECE66DL;
    static final long ADDEND = 0xBL;
    static final long MASK = (1L << 48) - 1;

    static final int DOUBLE_COUNT = 128;
    static final int INT_COUNT = 64;

    /**
     * 原版写过的全部 {@code Math.random()*N} 上界（N 是常量的那些）。
     * 出处：BattleState 100、LuXueQi/YuJie/ZhangXiaoFan 15、LuXueQi 6/4、
     * YuJie 20、Enemy 5、Pet/EnemyAI 3、两家商店 10、TreasureBox 2、
     * SelectEvent 500。变量上界（{@code e.skillNum}、{@code offsetHurt}、
     * {@code battle0.size()}）取值都落在这个集合覆盖的量级里。
     */
    static final int[] BOUNDS = { 2, 3, 4, 5, 6, 10, 15, 20, 100, 500 };

    public static void main(String[] args) throws Exception {
        File out = new File(args.length > 0 ? args[0] : "tools/random-golden/java-random.json");
        File dir = out.getParentFile();
        if (dir != null) dir.mkdirs();

        Map<Long, String> seeds = new LinkedHashMap<>();
        seeds.put(0L, "边界：种子为 0");
        seeds.put(1L, "最小非零种子");
        seeds.put(-1L, "负种子 —— setSeed 只取低 48 位，符号位不该漏进来");
        seeds.put(MASK ^ MULTIPLIER,
                "构造出来的边界：播种后内部状态是 48 个 1，第一次推进必然跨 48 位回绕");
        collectScriptSeeds(seeds);

        StringBuilder b = new StringBuilder();
        b.append("{\n");
        b.append("  \"generator\": ").append(Json.str("tools/src/devtools/ExportRandom.java")).append(",\n");
        b.append("  \"algorithm\": {\"multiplier\": \"0x").append(Long.toHexString(MULTIPLIER))
         .append("\", \"addend\": \"0x").append(Long.toHexString(ADDEND))
         .append("\", \"mask\": \"0x").append(Long.toHexString(MASK)).append("\"},\n");
        b.append("  \"doubleCount\": ").append(DOUBLE_COUNT).append(",\n");
        b.append("  \"intCount\": ").append(INT_COUNT).append(",\n");
        b.append("  \"intBounds\": [");
        for (int i = 0; i < BOUNDS.length; i++) b.append(i == 0 ? "" : ", ").append(BOUNDS[i]);
        b.append("],\n");
        b.append("  \"seeds\": [\n");

        List<Map.Entry<Long, String>> entries = new ArrayList<>(seeds.entrySet());
        for (int i = 0; i < entries.size(); i++) {
            writeSeed(b, entries.get(i).getKey(), entries.get(i).getValue());
            b.append(i == entries.size() - 1 ? "\n" : ",\n");
        }
        b.append("  ]\n}\n");

        try (Writer w = new OutputStreamWriter(new FileOutputStream(out), StandardCharsets.UTF_8)) {
            w.write(b.toString());
        }
        System.out.println("导出 " + seeds.size() + " 个种子 × ("
                + DOUBLE_COUNT + " 个 nextDouble + " + BOUNDS.length + " × " + INT_COUNT
                + " 个截尾整数) -> " + out.getPath());
    }

    /** 把 tools/traces/scripts/ 下每一份剧本声明的种子并进来（顶层 seed 与 setup.seed）。 */
    private static void collectScriptSeeds(Map<Long, String> seeds) throws Exception {
        File dir = new File("tools/traces/scripts");
        File[] fs = dir.listFiles((d, n) -> n.endsWith(".json"));
        if (fs == null) {
            System.err.println("找不到 " + dir.getPath() + " —— 必须在仓库根目录运行");
            System.exit(1);
        }
        Arrays.sort(fs, Comparator.comparing(File::getName));
        for (File f : fs) {
            String name = f.getName().replace(".json", "");
            Map<String, Object> m = JsonIn.obj(
                    JsonIn.parse(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)),
                    "剧本 " + name);
            addIfPresent(seeds, m, name);
            Object setup = m.get("setup");
            if (setup instanceof Map) {
                addIfPresent(seeds, JsonIn.obj(setup, name + ".setup"), name + ".setup");
            }
        }
    }

    private static void addIfPresent(Map<Long, String> seeds, Map<String, Object> m, String where) {
        if (m.get("seed") == null) return;
        long seed = JsonIn.i(m, "seed");
        String note = "剧本 " + where + " 的 seed";
        String had = seeds.get(seed);
        seeds.put(seed, had == null ? note : had + "；" + note);
    }

    private static void writeSeed(StringBuilder b, long seed, String note) throws Exception {
        Random r = new Random(seed);
        AtomicLong state = stateOf(r);

        List<String> doubles = new ArrayList<>();
        List<String> bits = new ArrayList<>();
        List<String> states = new ArrayList<>();
        states.add(Json.str("0x" + Long.toHexString(state.get())));
        for (int i = 0; i < DOUBLE_COUNT; i++) {
            double d = r.nextDouble();
            doubles.add(Double.toString(d));
            bits.add(Json.str("0x" + Long.toHexString(Double.doubleToRawLongBits(d))));
            states.add(Json.str("0x" + Long.toHexString(state.get())));
        }

        b.append("    {\n");
        b.append("      \"seed\": ").append(seed).append(",\n");
        b.append("      \"note\": ").append(Json.str(note)).append(",\n");
        b.append("      \"doubles\": ").append(chunked(doubles, 4)).append(",\n");
        b.append("      \"doubleBits\": ").append(chunked(bits, 4)).append(",\n");
        b.append("      \"states\": ").append(chunked(states, 4)).append(",\n");
        b.append("      \"ints\": {\n");
        for (int k = 0; k < BOUNDS.length; k++) {
            int bound = BOUNDS[k];
            Random ir = new Random(seed);
            List<String> xs = new ArrayList<>();
            for (int i = 0; i < INT_COUNT; i++) xs.add(String.valueOf((int) (ir.nextDouble() * bound)));
            b.append("        \"").append(bound).append("\": [")
             .append(String.join(", ", xs)).append("]")
             .append(k == BOUNDS.length - 1 ? "\n" : ",\n");
        }
        b.append("      }\n");
        b.append("    }");
    }

    /**
     * 反射取 {@link Random} 私有的那个 {@code AtomicLong seed}。
     *
     * <p>没开 {@code --add-opens} 时**当场非零退出**，绝不退回"自己按公式算一遍"
     * ——那样导出的状态就成了我们自己的实现算两遍，判据看着是绿的、实际什么都没验。
     */
    private static AtomicLong stateOf(Random r) {
        try {
            Field f = Random.class.getDeclaredField("seed");
            f.setAccessible(true);
            return (AtomicLong) f.get(r);
        } catch (Throwable t) {
            System.err.println("读不到 java.util.Random 的私有 seed 字段：" + t);
            System.err.println("需要 --add-opens java.base/java.util=ALL-UNNAMED（见 tools/export-random.sh）");
            System.exit(2);
            throw new IllegalStateException("unreachable");
        }
    }

    /** 每行 n 个，长数组的 diff 才读得出是第几个变了。 */
    private static String chunked(List<String> xs, int n) {
        StringBuilder b = new StringBuilder("[\n");
        for (int i = 0; i < xs.size(); i++) {
            if (i % n == 0) b.append("        ");
            b.append(xs.get(i));
            if (i != xs.size() - 1) b.append(",");
            b.append((i % n == n - 1 || i == xs.size() - 1) ? "\n" : " ");
        }
        return b.append("      ]").toString();
    }
}
