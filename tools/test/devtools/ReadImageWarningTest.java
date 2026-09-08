package devtools;

import tools.Reader;

/**
 * 钉住 {@code fix(diag)}：{@link Reader#readImage} 的缺图警告。
 *
 * 缺口表第 9 行。把那句 {@code System.err.println} 关掉，两条重导对比都是绿的
 * —— 警告走 stderr，而 {@code tools/ground-truth/} 与 {@code tools/traces/out/}
 * 的产物里都没有 stderr。
 *
 * 这个警告存在的理由写在源码注释里：{@code ImageIcon} 在路径错误时既不抛异常
 * 也不返回 null，只给一个宽度为 -1 的空壳，调用方察觉不到 —— 缺图只会表现为
 * 「画面上少了点东西」。所以这里除了「有没有那一行」，还要核**去重**：
 * 源码说 readImage 有 300+ 处调用、很多在动画循环里，不去重会刷屏。
 */
public final class ReadImageWarningTest {

    private ReadImageWarningTest() {}

    public static void run() {
        // 用一个带纳秒的路径，保证它没被这个 JVM 里别处的调用预热过 ——
        // MISSING_WARNED 是进程级的静态集合，复用路径会读到「第二次」的行为。
        String missing = "image/xl-f8y-不存在的图-" + System.nanoTime() + ".png";

        String first = Stderr.capture(() -> Reader.readImage(missing));
        String second = Stderr.capture(() -> Reader.readImage(missing));

        Checks.check("缺图时 stderr 有警告", first.contains("[readImage] 图片缺失"));
        Checks.check("警告里点名了那个路径", first.contains(missing));
        Checks.eq("同一路径第二次不再警告（源码说 300+ 处调用，很多在动画循环里）",
                "", second);

        // 反斜杠路径要报归一化之后的样子，并把原始路径一并带上 ——
        // 否则拿着报出来的路径去 ls，会 ls 到一个和代码里不一样的东西。
        String win = "image\\xl-f8y-不存在-" + System.nanoTime() + "\\a.png";
        String norm = Reader.normalizePath(win);
        String warn = Stderr.capture(() -> Reader.readImage(win));
        Checks.check("反斜杠路径报的是归一化之后的路径", warn.contains(norm));
        Checks.check("并且带上了原始路径", warn.contains("原始路径: " + win));

        // 存在的图不警告。少了这一条，一个「无条件打印」的实现也能全绿。
        // 路径是现扫出来的而不是写死的：写死一个文件名，等它哪天被改名，
        // 这条断言就悄悄从「图在时不吭声」变成「图不在时也不吭声」—— 一条
        // 反着通过的判据。扫不到就当场失败。
        String real = anyExistingPng();
        Checks.check("前提：image/ 下扫得到至少一张 png", real != null);
        if (real == null) return;
        Checks.eq("图存在时一声不吭", "", Stderr.capture(() -> Reader.readImage(real)));

        // readImage 从不返回 null —— 这正是那个警告存在的理由，
        // 顺手钉住，免得将来有人「顺便」改成返回 null。
        Checks.check("缺图时仍然返回一个非 null 的 Image",
                Reader.readImage(missing) != null);
    }

    /** 从 {@code image/} 下现扫一张真实存在的 png，扫不到返回 null。 */
    private static String anyExistingPng() {
        java.util.Deque<java.io.File> stack = new java.util.ArrayDeque<>();
        stack.push(new java.io.File("image"));
        while (!stack.isEmpty()) {
            java.io.File[] fs = stack.pop().listFiles();
            if (fs == null) continue;
            java.util.Arrays.sort(fs);
            for (java.io.File f : fs) {
                if (f.isDirectory()) stack.push(f);
                else if (f.getName().endsWith(".png")) return f.getPath();
            }
        }
        return null;
    }

}
