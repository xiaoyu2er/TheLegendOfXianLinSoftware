package devtools;

import tools.Clock;

/**
 * 量 Java 侧的时间加速到底线不线性 —— 拿真实的墙钟量，不是读 Clock.getFactor()。
 *
 * 量的是 tools.Clock.sleep()：原版 13 处 Thread.sleep 全部走它，主循环
 * (ScenePanel.run 里的 Clock.sleep(10)) 也走它，所以这条链路的倍率就是整个
 * 场景推进的倍率。定时器那一半（17 个 javax.swing.Timer 走 Clock.delay）
 * 是同一个 factor 除下去的同一段算术，但它要起 GUI 才量得到，不在这里。
 *
 * 为什么非要实测：factor 是"除下去"的，看代码谁都会说它线性。而 Thread.sleep
 * 的实际精度有下限（毫秒级调度），倍率越大、每次 sleep 越短，调度开销占比越高
 * —— 线性会在某个倍率上垮掉，垮在哪儿只有量过才知道。
 *
 * 用法: java devtools.ClockProbe [倍率...]，默认 1 2 5 10
 * 输出每个倍率的：游戏毫秒 / 真实毫秒，理想值就是倍率本身。
 */
public final class ClockProbe {

    /** 每个倍率量多少游戏毫秒。2 秒够长到调度抖动被摊平，又不至于让探针跑很久。 */
    private static final long GAME_MS = 2000;
    /** 单次 sleep 的游戏毫秒。50 是原版里常见的量级。 */
    private static final long STEP_MS = 50;

    public static void main(String[] args) throws Exception {
        double[] factors = args.length > 0 ? new double[args.length] : new double[] {1, 2, 5, 10};
        for (int i = 0; i < args.length; i++) factors[i] = Double.parseDouble(args[i]);

        System.out.println("Java 侧（tools.Clock.sleep，每个倍率量 " + GAME_MS + " 游戏毫秒）");
        double base = -1;
        for (double f : factors) {
            Clock.setFactor(f);
            long t0 = System.nanoTime();
            for (long done = 0; done < GAME_MS; done += STEP_MS) Clock.sleep(STEP_MS);
            double realMs = (System.nanoTime() - t0) / 1e6;
            if (base < 0) base = realMs;
            // 两列都要：绝对倍率（游戏毫秒/真实毫秒）会被 Thread.sleep 的固定
            // 超时开销压低——每次 sleep 都要多睡几毫秒，与倍率无关。真正回答
            // "线不线性"的是相对第一个倍率的那一列。
            System.out.printf("  factor=%-5.1f 真实 %7.1f ms  绝对倍率 %5.2f×  相对首行 %5.2f×%n",
                    f, realMs, GAME_MS / realMs, base / realMs);
        }
        Clock.setFactor(1.0);
        System.exit(0);
    }
}
