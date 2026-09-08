package devtools;

import java.awt.image.BufferedImage;

/**
 * 只做一件事：拿一个报出指定判别名的假驱动器去喂 {@link ExportTrace#requireKind}，
 * 然后按它的真实行为退出。给 {@link RequireKindTest} 当子进程用。
 *
 * 名字里**故意不带 {@code Test}**：{@link TestMain} 是按「文件名以 Test.java 结尾」
 * 现扫测试类的，这不是一个测试类，是一个被测试起起来的探针。
 *
 * 用法：{@code java devtools.RequireKindProbe <判别名>}，
 * 判别名写 {@code __null__} 表示让 {@code kind()} 返回 null。
 */
public final class RequireKindProbe {

    private RequireKindProbe() {}

    public static void main(String[] args) {
        if (args.length != 1) {
            System.err.println("用法: java devtools.RequireKindProbe <判别名|__null__>");
            System.exit(3);
        }
        final String kind = "__null__".equals(args[0]) ? null : args[0];
        // requireKind 走不过时自己 System.exit(2)，所以下面这句只有通过才会执行。
        String got = ExportTrace.requireKind(new TraceDriver() {
            @Override public String kind() { return kind; }
            @Override public boolean step() { throw new UnsupportedOperationException(); }
            @Override public String snapshotState(int index) { throw new UnsupportedOperationException(); }
            @Override public BufferedImage snapshotImage() { throw new UnsupportedOperationException(); }
        });
        System.out.println("ACCEPTED:" + got);
        System.exit(0);
    }
}
