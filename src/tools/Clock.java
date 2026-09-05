package tools;

/**
 * 全局时间缩放。用于把测试/取景的等待时间压缩。
 *
 * factor = 1.0 时所有方法都是恒等的，游戏行为与原版逐字节一致；
 * 只有显式调用 setFactor 才会改变时序。
 *
 * 背景：原版没有集中的时间源，时间常数散在 29 处
 * （12 个 Thread.sleep + 17 个 javax.swing.Timer，共 14 个文件）。
 * 本类把它们收拢成一个可缩放的量，既服务于取景器提速，
 * 也是 web 版 timeScale 的对应物。
 */
public final class Clock {

	private static volatile double factor = 1.0;

	private Clock() {}

	/** 设置加速倍率。5.0 表示时间快 5 倍。小于等于 0 会被忽略。 */
	public static void setFactor(double f) {
		if (f > 0) factor = f;
	}

	public static double getFactor() {
		return factor;
	}

	/** 缩放后的毫秒数，最小 1ms（0 会让循环空转吃满 CPU）。 */
	public static long ms(long millis) {
		if (factor == 1.0) return millis;
		return Math.max(1L, (long) (millis / factor));
	}

	/** 缩放后的 javax.swing.Timer delay。 */
	public static int delay(int millis) {
		if (factor == 1.0) return millis;
		return (int) Math.max(1L, (long) (millis / factor));
	}

	public static void sleep(long millis) throws InterruptedException {
		Thread.sleep(ms(millis));
	}
}
