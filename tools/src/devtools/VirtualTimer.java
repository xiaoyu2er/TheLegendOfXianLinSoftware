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
 * 时钟的操作，触发由导出器在每 tick 显式驱动。
 *
 * 之所以是"换对象"而不是"在外面记一张到期时间表"：外部记账只看得见
 * isRunning() 的状态，看不见调用本身，到期时间只能从状态变化去**推断**。
 * 而 Swing 这两个方法的语义正好相反，推错了不会报错，只会让动画不动：
 *
 *   start()   对已经在跑的定时器是**空操作**（TimerQueue.addTimer 直接忽略
 *             已入队的定时器），到期时间不变；
 *   restart() 才是 stop() + start()，会重新计时。
 *
 * 实测（openjdk 17，一个 100ms 的定时器，每 10ms 调一次，持续 1 秒）：
 * 反复 start() 触发 8 次，反复 restart() 触发 0 次。
 *
 * 这条区别是有后果的：NPCEvent.checkNPCStop 对 type==2 的 NPC 是**无条件**
 * action.start()，而主循环每 10ms 走一次。按真实语义那个原地动画照常播；
 * 把 start() 写成重新计时，它就再也不会推进——导出的 trace 会把"原地动的
 * NPC"记成永远停在第 0 帧，而且看不出错。（本文件第一版正是这么写的，
 * 三份 trace 里所有 type==2 的 NPC 都被记成了静止。）
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

    /** 对已经在跑的定时器是空操作——与 javax.swing.Timer 一致，见类注释。 */
    @Override public void start() {
        if (running) return;
        running = true;
        due = clock.now() + logicalDelay;
    }

    @Override public void restart() { stop(); start(); }
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
