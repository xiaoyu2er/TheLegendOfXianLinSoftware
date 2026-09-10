package devtools;

import java.io.IOException;
import java.util.List;

/**
 * 守「存档真值没被覆盖」（xl-i06.5）。
 *
 * **约定**：{@code tools/ground-truth/存档/存档N.txt} 是原版样例存档的逐字节真值；
 * {@code sources/Record/} 是草稿区 —— 原版写档装置把这个相对路径写死在源码里，
 * 行为层导出器一跑就往这里写，写完必须 cp 还原。这条测试核的就是「还原了」：
 * 草稿区那几个文件与真值副本逐字节相同。
 *
 * 两条重导对比都看不见这件事：{@code export-truth.sh} 在草稿区被改时会拒绝导出
 * （{@link SaveTruth#export}），但 CI 之外没人非跑它不可；而 {@code export-trace.sh}
 * 根本不看这几个文件。覆盖之后 {@code git diff} 里只是几个文本文件变了几个字节，
 * 与「真值本来就长这样」长得一模一样 —— 所以要一条失败时说得出**哪个文件、差在哪**
 * 的判据。
 */
public final class SaveDraftIntactTest {

    private SaveDraftIntactTest() {}

    public static void run() throws IOException {
        // 真判据：期望「没有任何一处不同」，实际把每一处都原样列出来。
        List<String> problems = SaveTruth.draftProblems();
        Checks.eq("草稿区 " + SaveTruth.DRAFT_DIR + " 与 " + SaveTruth.TRUTH_DIR + " 里的逐字节真值相同",
                "[]", problems.toString());

        // 分母：比了几份，就该有几份。真值目录空了由 draftProblems 自己报，这里再钉
        // 一次它不是按构造成立 —— 两个目录的存档名单都是现扫的。
        Checks.check("真值目录里至少有一份存档（现扫 " + SaveTruth.saveNames(SaveTruth.TRUTH_DIR) + "）",
                !SaveTruth.saveNames(SaveTruth.TRUTH_DIR).isEmpty());

        // 失败信息本身也要验：上面那条红的时候，读的人要能直接定位。
        byte[] truth = "ab\r\ncdAef\r\n".getBytes();
        byte[] draft = "ab\r\ncdXef\r\n".getBytes();
        Checks.eq("同一份字节不报差异", null, SaveTruth.describeDiff("x.txt", truth, truth.clone()));
        Checks.eq("差异报出文件名、字节偏移、行列与两边的字节",
                "x.txt：偏移 6（从 0 数）起不同，即第 2 行第 3 字节，真值 [41 65 66 0D 0A] / 草稿区 [58 65 66 0D 0A]"
                        + "；长度 真值 11 / 草稿区 11",
                SaveTruth.describeDiff("x.txt", truth, draft));
        Checks.eq("草稿区被截短也报出来（不是只比公共前缀）",
                "x.txt：偏移 4（从 0 数）起不同，即第 2 行第 1 字节，真值 [63 64 41 65 66 0D 0A] / 草稿区 [文件已结束]"
                        + "；长度 真值 11 / 草稿区 4",
                SaveTruth.describeDiff("x.txt", truth, "ab\r\n".getBytes()));
    }
}
