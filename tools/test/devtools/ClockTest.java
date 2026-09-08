package devtools;

import tools.Clock;

/**
 * 钉住 {@link Clock} 的缩放、下限与定时器冻结。
 *
 * 缺口表第 8 行。把 {@code ms()} 里那个 {@code Math.max(1L, …)} 下限拿掉，
 * 两条重导对比都是绿的 —— 导出器用的倍率把 sleep 拉长而不是压短，那个下限
 * 一次都没被走到。而源码注释写着「0 会让循环空转吃满 CPU」，这条承诺今天
 * 没有任何东西在核。
 *
 * 这个类会改全局静态状态，跑完必须还原 —— 不还原的话，同一个 JVM 里后面
 * 任何依赖时钟的东西都会被污染，而污染的样子和「测试通过」长得一样。
 */
public final class ClockTest {

    private ClockTest() {}

    public static void run() {
        double f0 = Clock.getFactor();
        long b0 = Clock.getFreezeBase();
        try {
            body();
        } finally {
            Clock.freezeTimers(b0);
            Clock.setFactor(f0);
            Checks.eq("跑完还原了 factor", f0, Clock.getFactor());
            Checks.eq("跑完还原了 freezeBase", b0, Clock.getFreezeBase());
        }
    }

    private static void body() {
        Clock.freezeTimers(0);

        // factor == 1.0 必须逐字恒等：原版行为不许被这个类改掉。
        Clock.setFactor(1.0);
        Checks.eq("factor=1 时 ms 恒等", 80L, Clock.ms(80));
        Checks.eq("factor=1 时 ms(0) 也原样（不走下限）", 0L, Clock.ms(0));
        Checks.eq("factor=1 时 delay 恒等", 200, Clock.delay(200));

        Clock.setFactor(5.0);
        Checks.eq("factor=5 时 ms 缩到五分之一", 16L, Clock.ms(80));
        Checks.eq("factor=5 时 delay 缩到五分之一", 40, Clock.delay(200));

        // 下限：注释说 0 会让循环空转吃满 CPU，所以最小 1ms。
        Clock.setFactor(1e9);
        Checks.eq("缩到 0 时 ms 兜底为 1", 1L, Clock.ms(80));
        Checks.eq("缩到 0 时 delay 兜底为 1", 1, Clock.delay(200));

        // setFactor 忽略非正数 —— 否则 millis/0 会是 Infinity，
        // 转成 long 之后是 Long.MAX_VALUE，进程当场挂住。
        Clock.setFactor(2.0);
        Clock.setFactor(0);
        Checks.eq("setFactor(0) 被忽略", 2.0, Clock.getFactor());
        Clock.setFactor(-1);
        Checks.eq("setFactor(负数) 被忽略", 2.0, Clock.getFactor());

        // 冻结：delay 变成 base + millis，且**可反算**。导出器要靠减掉 base
        // 把 80ms 的走路定时器和 200ms 的 NPC 定时器分开。
        Clock.setFactor(1.0);
        Clock.freezeTimers(1000000L);
        Checks.eq("冻结后 delay 是 base+millis", 1000080, Clock.delay(80));
        Checks.eq("冻结后另一个间隔也能反算出来", 1000200, Clock.delay(200));
        Clock.setFactor(5.0);
        Checks.eq("冻结压过 factor，delay 不参与缩放", 1000080, Clock.delay(80));
        Checks.eq("冻结不动 ms（那是 Thread.sleep 的调用点，推远等于挂死）",
                16L, Clock.ms(80));

        Clock.freezeTimers(0);
        Checks.eq("freezeTimers(0) 关闭冻结", 0L, Clock.getFreezeBase());
        Checks.eq("关闭后 delay 回到缩放（factor 还是 5）", 40, Clock.delay(200));
        Clock.freezeTimers(-5);
        Checks.eq("负的 base 也当关闭", 0L, Clock.getFreezeBase());
    }
}
