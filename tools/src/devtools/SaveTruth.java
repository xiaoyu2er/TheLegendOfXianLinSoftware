package devtools;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.lang.reflect.Method;
import java.nio.charset.Charset;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 原版样例存档的数据层真值（xl-i06.5）。
 *
 * <h2>两个目录，一个是真值，一个是草稿区</h2>
 *
 * <ul>
 *   <li>{@link #TRUTH_DIR} {@code tools/ground-truth/存档/} —— **真值**。
 *       {@code 存档N.txt} 是原版真的存出来的档的逐字节副本（从草稿区一次性拷来，
 *       之后**任何工具都不写它**）；{@code 存档N.json} 是按原版读取器实际的读法
 *       解析出来的结构化形式，由 {@code tools/export-truth.sh} 重导。
 *   <li>{@link #DRAFT_DIR} {@code sources/Record/} —— **草稿区**。原版的写档装置
 *       （{@code start.Recorder}）与读档装置（{@code start.Loader}）都把这个相对路径
 *       写死在源码里，于是它是原版唯一能读写的地方。行为层的导出器可以往这里写，
 *       但**跑完必须还原**（cp 备份，不是 git checkout）。
 * </ul>
 *
 * **为什么非分开不可**：{@code Recorder.writeInfo} 的 IO 异常只打一行栈，目录不在就
 * 静默不产出文件、退出码照样是零；而目录在的时候它会**覆盖**这几个文件。覆盖之后
 * 在 diff 里只是几个文本文件变了几个字节，与「真值本来就长这样」长得一模一样。
 * 守它的是 {@code tools/test/devtools/SaveDraftIntactTest}：草稿区 == 真值副本，
 * 逐字节。导出器在解析之前也核同一件事，不等就拒绝导出。
 *
 * <h2>为什么解析走草稿区、而不是真值副本</h2>
 *
 * 读法必须是原版的**实际**读法，而最硬的办法是直接调原版的 {@code Loader.loadLine}
 * —— 它的路径写死成草稿区。上面那条逐字节相等先成立，「原版读取器读草稿区」
 * 就等于「原版读取器读真值副本」。
 */
public final class SaveTruth {

    private SaveTruth() {}

    public static final File TRUTH_DIR = new File("tools/ground-truth/存档");
    public static final File DRAFT_DIR = new File("sources/Record");
    /** 读取器的源码 —— 它请求哪几行，从这里现数，不在这里写死。 */
    public static final File LOADER_SRC = new File("src/start/Loader.java");

    private static final Charset GBK = Charset.forName("GBK");
    private static final Pattern SAVE_NAME = Pattern.compile("存档(\\d+)\\.txt");

    /** {@code dir} 下所有 {@code 存档N.txt}，按文件名排序。目录不在返回空集。 */
    public static TreeSet<String> saveNames(File dir) {
        TreeSet<String> out = new TreeSet<>();
        String[] names = dir.list();
        if (names == null) return out;
        for (String n : names) if (SAVE_NAME.matcher(n).matches()) out.add(n);
        return out;
    }

    /** {@code 存档N.txt} 里的 N，也就是原版 {@code Loader.load(int)} 的那个参数。 */
    public static int slotOf(String name) {
        Matcher m = SAVE_NAME.matcher(name);
        if (!m.matches()) throw new IllegalArgumentException("不是存档文件名：" + name);
        return Integer.parseInt(m.group(1));
    }

    /**
     * 两份字节相等返回 null；不等返回一句说得出「哪个文件、差在哪」的话：
     * 第几个字节起不同、落在第几行第几列、两边各是什么字节、两边各多长。
     */
    public static String describeDiff(String name, byte[] truth, byte[] draft) {
        int n = Math.min(truth.length, draft.length);
        int at = -1;
        for (int i = 0; i < n; i++) {
            if (truth[i] != draft[i]) { at = i; break; }
        }
        if (at < 0) {
            if (truth.length == draft.length) return null;
            at = n; // 一边是另一边的前缀
        }
        // 0x0A 不会出现在 GBK 双字节的尾字节里（尾字节 0x40–0xFE），按它数行是准的。
        int line = 1, lineStart = 0;
        for (int i = 0; i < at; i++) {
            if (truth[i] == '\n') { line++; lineStart = i + 1; }
        }
        // 偏移从 0 数、行列从 1 数（cmp 报的 char 是从 1 数的，比它小一）。
        return name + "：偏移 " + at + "（从 0 数）起不同，即第 " + line + " 行第 " + (at - lineStart + 1) + " 字节"
                + "，真值 " + hex(truth, at) + " / 草稿区 " + hex(draft, at)
                + "；长度 真值 " + truth.length + " / 草稿区 " + draft.length;
    }

    private static String hex(byte[] b, int at) {
        if (at >= b.length) return "[文件已结束]";
        StringBuilder s = new StringBuilder("[");
        for (int i = at; i < Math.min(b.length, at + 8); i++) {
            if (i > at) s.append(' ');
            s.append(String.format("%02X", b[i] & 0xFF));
        }
        return s.append(b.length > at + 8 ? " …]" : "]").toString();
    }

    /**
     * 草稿区与真值副本对不上的每一处，一条一句。空表 = 全部逐字节相同。
     * 真值目录里一份都没有也算一处 —— 「一个都没比」不是「全部相同」。
     */
    public static List<String> draftProblems() throws IOException {
        List<String> out = new ArrayList<>();
        TreeSet<String> truth = saveNames(TRUTH_DIR);
        TreeSet<String> draft = saveNames(DRAFT_DIR);
        if (truth.isEmpty()) {
            out.add(TRUTH_DIR.getPath() + " 下一份存档真值都没有（当前目录 "
                    + new File(".").getAbsolutePath() + "）—— 一个都没比，不是全部相同");
            return out;
        }
        TreeSet<String> onlyDraft = new TreeSet<>(draft);
        onlyDraft.removeAll(truth);
        if (!onlyDraft.isEmpty()) out.add("草稿区多出了真值里没有的存档：" + onlyDraft
                + "（导出器写完没还原？）");
        for (String name : truth) {
            File d = new File(DRAFT_DIR, name);
            if (!d.isFile()) {
                out.add(name + "：草稿区里没有这个文件（原版读档装置只认 " + DRAFT_DIR.getPath() + "）");
                continue;
            }
            String diff = describeDiff(name, Files.readAllBytes(new File(TRUTH_DIR, name).toPath()),
                    Files.readAllBytes(d.toPath()));
            if (diff != null) out.add(diff);
        }
        return out;
    }

    /**
     * 原版 {@code Loader} 请求的每一个行号，以及是谁请求的：赋值给了哪个字段，
     * 或者（没有赋值时）在哪个方法里。从 GBK 源码现读。
     */
    public static TreeMap<Integer, List<String>> loaderReads() throws IOException {
        String src = new String(Files.readAllBytes(LOADER_SRC.toPath()), GBK);
        Pattern call = Pattern.compile("loadLine\\(\\s*textcode\\s*,\\s*(\\d+)\\s*\\)");
        Pattern assign = Pattern.compile("(\\w+)\\s*=\\s*$");
        Pattern method = Pattern.compile("(\\w+)\\s*\\(\\s*int\\s+textcode[^)]*\\)\\s*\\{");
        TreeMap<Integer, List<String>> out = new TreeMap<>();
        Matcher m = call.matcher(src);
        while (m.find()) {
            String before = src.substring(0, m.start());
            Matcher a = assign.matcher(before);
            String who;
            if (a.find()) {
                who = a.group(1);
            } else {
                Matcher mm = method.matcher(before);
                who = null;
                while (mm.find()) who = mm.group(1) + "()";
                if (who == null) throw new IllegalStateException("认不出这次 loadLine 调用是谁发的：第 "
                        + m.start() + " 字符");
            }
            out.computeIfAbsent(Integer.parseInt(m.group(1)), k -> new ArrayList<>()).add(who);
        }
        if (out.isEmpty()) throw new IllegalStateException(LOADER_SRC + " 里一次 loadLine(textcode, N) 都没认出来"
                + " —— 源码搬家了还是正则坏了，两者都不是「读取器不读任何行」");
        return out;
    }

    /** 原版 {@code Loader.loadLine(slot, line)}，反射调用，读的是草稿区。 */
    @SuppressWarnings("unchecked")
    static ArrayList<String> loadLine(int slot, int line) throws Exception {
        Class<?> c = Class.forName("start.Loader");
        Method m = c.getDeclaredMethod("loadLine", int.class, int.class);
        m.setAccessible(true);
        return (ArrayList<String>) m.invoke(c.getDeclaredConstructor().newInstance(), slot, line);
    }

    /** 与原版读取器同一种读法（GBK + readLine）数出来的物理行数。 */
    static int physicalLines(File f) throws IOException {
        int n = 0;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), GBK))) {
            while (r.readLine() != null) n++;
        }
        return n;
    }

    /**
     * 把真值目录里的每一份存档按原版读取器实际的读法解析，写成 {@code <outDir>/存档N.json}。
     * 草稿区与真值副本不逐字节相等就拒绝（抛异常），不去解析一份来路不明的档。
     *
     * @return 导出了几份
     */
    public static int export(File outDir) throws Exception {
        List<String> problems = draftProblems();
        if (!problems.isEmpty()) {
            throw new IllegalStateException("草稿区与存档真值对不上，拒绝导出：\n  " + String.join("\n  ", problems));
        }
        outDir.mkdirs();
        TreeMap<Integer, List<String>> reads = loaderReads();
        int n = 0;
        for (String name : saveNames(TRUTH_DIR)) {
            int slot = slotOf(name);
            Map<Integer, ArrayList<String>> lines = new LinkedHashMap<>();
            for (int line : reads.keySet()) lines.put(line, loadLine(slot, line));

            StringBuilder b = new StringBuilder();
            b.append("{\n");
            b.append("  \"file\": ").append(Json.str(name)).append(",\n");
            b.append("  \"slot\": ").append(slot).append(",\n");
            b.append("  \"physicalLines\": ").append(physicalLines(new File(DRAFT_DIR, name))).append(",\n");
            b.append("  \"reads\": [\n");
            int i = 0;
            for (Map.Entry<Integer, ArrayList<String>> e : lines.entrySet()) {
                b.append("    { \"line\": ").append(e.getKey())
                        .append(", \"readBy\": ").append(Json.arrStr(reads.get(e.getKey())))
                        .append(", \"fields\": ").append(Json.arrStr(e.getValue()))
                        .append(" }").append(++i < lines.size() ? ",\n" : "\n");
            }
            b.append("  ]\n");
            b.append("}\n");
            Files.write(new File(outDir, name.replace(".txt", ".json")).toPath(),
                    b.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            n++;
        }
        return n;
    }
}
