package devtools;

import java.io.BufferedReader;
import java.io.StringReader;

import scene.SaveAndLoad;
import tools.Reader;

/**
 * 钉住 {@link Reader#switchReader} 的 {@code Role} 段：三个主角谁在队。
 *
 * 缺口表第 5 行。把三个下标里的任意一个读错位，两条重导对比都是绿的 ——
 * {@code ExportGroundTruth} 全文没有一处碰 {@code SaveAndLoad}，26 个字段里
 * 没有一个能表态；战斗真值里那些 {@code "zhang"} / {@code "lu"} 是战斗剧本
 * 自己摆的队伍，根本不经过 {@code Reader} 的 {@code Role} 段。
 *
 * 三个位必须分别可辨，所以这里不只测「全 1」和「全 0」—— 那两组下标读反了
 * 照样通过。测的是三组只有一位为 1 的输入。
 */
public final class RoleSectionTest {

    private RoleSectionTest() {}

    public static void run() {
        boolean z0 = SaveAndLoad.zhang;
        boolean l0 = SaveAndLoad.lu;
        boolean w0 = SaveAndLoad.wen;
        try {
            body();
        } finally {
            SaveAndLoad.zhang = z0;
            SaveAndLoad.lu = l0;
            SaveAndLoad.wen = w0;
        }
    }

    private static void body() {
        // 每组只有一位是 1：下标读反 / 读串都会让某一组对不上。
        // 全 1 与全 0 那两组单独放在最后，它们对下标错位没有分辨力。
        check("1 0 0", true, false, false);
        check("0 1 0", false, true, false);
        check("0 0 1", false, false, true);
        check("1 1 0", true, true, false);
        check("0 1 1", false, true, true);
        check("1 0 1", true, false, true);
        check("1 1 1", true, true, true);
        check("0 0 0", false, false, false);

        // 原版把「不是 1」一律当 false，不是只认 0。这是现状，不是设计 ——
        // 钉下来是为了将来有人改成抛异常时能看见。
        check("2 0 0", false, false, false);
    }

    private static void check(String line, boolean zhang, boolean lu, boolean wen) {
        // 先都置反，确保读到的是这一次解析的结果而不是上一次的残留。
        SaveAndLoad.zhang = !zhang;
        SaveAndLoad.lu = !lu;
        SaveAndLoad.wen = !wen;

        reader().switchReader("Role", new BufferedReader(new StringReader(line)));

        Checks.eq("Role \"" + line + "\" -> zhang", zhang, SaveAndLoad.zhang);
        Checks.eq("Role \"" + line + "\" -> lu", lu, SaveAndLoad.lu);
        Checks.eq("Role \"" + line + "\" -> wen", wen, SaveAndLoad.wen);
    }

    /**
     * {@link Reader} 只有一个读文件的构造函数，所以要一份真的脚本才建得出实例。
     * 建完就只用它的 {@code switchReader}，读的是我们自己给的那一行。
     *
     * 脚本名不写死：从 {@code script/} 下现扫第一个 .txt。写死一个文件名，
     * 等它哪天被改名，这里会变成「构造失败」而不是「解析错了」，两种红长得不一样
     * 但都会把人带偏。
     */
    private static Reader reader() {
        java.io.File[] fs = new java.io.File("script").listFiles();
        if (fs == null) throw new IllegalStateException(
                "找不到 script/ 目录 —— Java 侧命令都要求在仓库根目录运行，当前是 "
                        + new java.io.File(".").getAbsolutePath());
        java.util.Arrays.sort(fs);
        for (java.io.File f : fs) {
            if (f.getName().endsWith(".txt")) {
                // 静音：建 Reader 会加载 NPC 素材，而仓库里确实有几十帧从未交付
                // （xl-1dv.1），原版会逐条打 [readImage] 图片缺失。让它们打到终端上，
                // 一次全绿的运行看起来就像出了错。见 Stderr 的类注释。
                final String name = f.getName();
                final Reader[] box = new Reader[1];
                Stderr.mute(() -> box[0] = new Reader(name));
                return box[0];
            }
        }
        throw new IllegalStateException("script/ 下一个 .txt 都没有");
    }
}
