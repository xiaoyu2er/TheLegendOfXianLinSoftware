package devtools;

import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;

import javax.swing.Timer;

/**
 * 挂在虚拟时钟上的 javax.swing.Timer 替身。
 *
 * 原版的 17 个定时器全部走 javax.swing.Timer，由 Swing 的 TimerQueue 按真实
 * 时间触发。真实时间是不可重复的：同一份剧本跑两次，定时器落在哪个循环迭代上
 * 每次都不同，trace 也就每次都不同。
 *
 * 这里把每个定时器对象整体换掉：start/stop/restart/isRunning 全部改成对虚拟
 * 时钟的操作，触发由导出器在每 tick 显式驱动。之所以是"换对象"而不是"在外面
 * 记一张到期时间表"：原版有若干处对**正在运行的**定时器再次调用 start()
 * （例如 NPCEvent.checkNPCStop 里对 type==2 的 NPC 无条件 action.start()），
 * Swing 的语义是重新计时。外部记账看不见这次调用，会把本该永远不推进的动画
 * 推进起来——那样的 trace 是错的，而且看不出错。
 */
public final class VirtualTimer extends Timer {

    private static final long serialVersionUID = 1L;

    private final VirtualClock clock;
    private final int logicalDelay;
    private boolean running;
    private long due;

    /** 用 origin 的监听器与配置构造替身；origin 之后不再被任何人触发。 */
    public VirtualTimer(VirtualClock clock, int logicalDelay, Timer origin) {
        super(logicalDelay, null);
        if (logicalDelay <= 0) throw new IllegalArgumentException("定时器间隔必须为正：" + logicalDelay);
        this.clock = clock;
        this.logicalDelay = logicalDelay;
        for (ActionListener l : origin.getActionListeners()) addActionListener(l);
        setRepeats(origin.isRepeats());
        setCoalesce(origin.isCoalesce());
        setActionCommand(origin.getActionCommand());
        this.running = origin.isRunning();
        this.due = clock.now() + logicalDelay;
        origin.stop();
    }

    public int logicalDelay() { return logicalDelay; }

    @Override public void start()   { running = true; due = clock.now() + logicalDelay; }
    @Override public void restart() { start(); }
    @Override public void stop()    { running = false; }
    @Override public boolean isRunning() { return running; }

    /**
     * 到期就触发。返回是否触发过。
     * 先推进 due 再触发：监听器里可能 stop() 自己或 start() 别的定时器，
     * 顺序反了会把监听器刚设好的到期时间又覆盖掉。
     */
    boolean fireIfDue(long now) {
        if (!running || now < due) return false;
        due += logicalDelay;
        if (!isRepeats()) running = false;
        fireActionPerformed(new ActionEvent(this, ActionEvent.ACTION_PERFORMED,
                getActionCommand(), now, 0));
        return true;
    }
}
