package devtools;

/**
 * 面板跳转的观察点。**四支驱动器共用**（战斗与场景现在各用一个实例）。
 *
 * {@code GameLauncher.switchTo} 走的是 {@code switcher.show(c, "xxxPanel")}，
 * 而导出器里 {@code GameLauncher} 从没被构造过 —— {@code c} 是 null，
 * {@code CardLayout.show} 会当场 NPE。那条 NPE 抛在原版自己的线程上（战斗是
 * {@code run()}，场景是按键分发），而 {@code run()} 的 try/catch 只包住 sleep
 * （xl-1dv.10），于是线程静静地死掉、导出挂死，**而挂死看起来只是"跑得慢"**。
 *
 * 所以把 {@code GameLauncher.switcher} 这个 public static 字段换成本类：
 * {@code show} 只记名字、不碰容器。换掉的是**画面切换这个动作**，不是决定切到
 * 哪一块的那段判断 —— 那一句仍然是原版自己的。
 *
 * <p>记的是**卡片名**（{@code "shopPanel"} 而不是 {@code switchTo} 的入参
 * {@code "shop"}）：观察点就在 {@code CardLayout.show} 上，卡片名是**观察到的
 * 那个字符串本身**。中间加一层入参↔卡片名的映射等于把原版那张表誊抄一遍，
 * 而誊错了的表现是真值里一个看上去正常的面板名。
 */
final class PanelTap extends java.awt.CardLayout {
    private static final long serialVersionUID = 1L;
    private volatile String card;
    private volatile int count;

    @Override
    public void show(java.awt.Container parent, String name) {
        card = name;
        count++;
    }

    String card()  { return card; }

    /** 从头到现在一共切了几次。**{@link #consume} 不会把它减回去** —— 它数的是
     *  「原版切了几次」，不是「还有几次没人接」。 */
    int count()    { return count; }

    /**
     * 取走这一次跳转，把 {@link #card()} 清回 null。
     *
     * 场景剧本一份里可以有好几扇门（进药店、进装备超市、进战斗各一次），
     * 每一扇由自己那条 {@code awaitExit} 接住；不清的话第二条 {@code awaitExit}
     * 会读到第一扇门留下的那个名字 —— 而「这一扇门切对了」与「这一扇门根本
     * 没切、读到的是上一扇的」长得一模一样。战斗那边一份剧本只接得住一次跳转，
     * 不调用本方法。
     */
    String consume() {
        String c = card;
        card = null;
        return c;
    }
}
