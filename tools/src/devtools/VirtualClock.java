package devtools;

/** 虚拟时钟：一个可读的毫秒计数，只由导出器推进。 */
public final class VirtualClock {
    private long nowMs;

    public long now() { return nowMs; }

    public void advance(long ms) {
        if (ms <= 0) throw new IllegalArgumentException("时钟只能前进：" + ms);
        nowMs += ms;
    }
}
