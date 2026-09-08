package devtools;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.io.UnsupportedEncodingException;

/**
 * 跑一段代码，把它期间写到 stderr 的东西收下来并**吞掉**。
 *
 * 吞掉是有意的。原版对缺失的素材会逐条打 {@code [readImage] 图片缺失}
 * （仓库里确实有几十帧从未交付，见 {@code xl-1dv.1}），而两个测试类都会碰到它：
 * {@code ReadImageWarningTest} 是故意去读不存在的图，{@code RoleSectionTest}
 * 建 {@code Reader} 时顺带加载 NPC 素材。让那些行原样打到终端上，
 * **一次全绿的运行看起来就像出了错** —— 这个仓库反复吃亏的是「失败长得像成功」，
 * 反过来同样浪费人。
 *
 * 名字里故意不带 {@code Test}：{@link TestMain} 按文件名现扫测试类。
 */
final class Stderr {

    private Stderr() {}

    /** 跑 {@code body}，返回它写到 stderr 的内容。 */
    static String capture(Runnable body) {
        PrintStream saved = System.err;
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try {
            System.setErr(new PrintStream(buf, true, "UTF-8"));
            body.run();
        } catch (UnsupportedEncodingException e) {
            throw new AssertionError("UTF-8 一定存在", e);
        } finally {
            System.setErr(saved);
        }
        try {
            return buf.toString("UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new AssertionError("UTF-8 一定存在", e);
        }
    }

    /** 跑 {@code body}，丢掉它写到 stderr 的内容。 */
    static void mute(Runnable body) {
        capture(body);
    }
}
