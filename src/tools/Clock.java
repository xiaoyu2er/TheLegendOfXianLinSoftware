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

	/** 缩放后的 javax.swing.Timer delay。冻结模式下改为把间隔整体推远。 */
	public static int delay(int millis) {
		long base = freezeBase;
		if (base > 0) return (int) Math.min(Integer.MAX_VALUE, base + millis);
		if (factor == 1.0) return millis;
		return (int) Math.max(1L, (long) (millis / factor));
	}

	// ---- 定时器冻结（只服务于 trace 导出，默认关闭，关闭时恒等） ----
	//
	// 把所有 javax.swing.Timer 的间隔整体推远，使它们永不自行触发。
	// trace 导出器在虚拟时钟上逐 tick 手动触发这些定时器；只要真实的
	// TimerQueue 还在后台按真实时间触发，同一份剧本跑两次就不可能逐字节一致。
	//
	// 为什么是 base + millis 而不是一个统一的大常数：导出器要能从
	// timer.getDelay() 反算回原始间隔（减去 base），否则 80ms 的走路定时器
	// 和 200ms 的 NPC 定时器就分不出来了。
	//
	// 为什么只动 delay() 不动 ms()/sleep()：后两者是 Thread.sleep 的调用点，
	// 把它们推远等于把进程挂死。
	private static volatile long freezeBase = 0L;

	/** base <= 0 表示关闭冻结。开启后 delay(x) 返回 base + x。 */
	public static void freezeTimers(long base) {
		freezeBase = Math.max(0L, base);
	}

	public static long getFreezeBase() {
		return freezeBase;
	}

	public static void sleep(long millis) throws InterruptedException {
		Thread.sleep(ms(millis));
	}
}
