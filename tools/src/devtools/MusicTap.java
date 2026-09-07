package devtools;

import media.MusicPlayer;
import media.MusicReader;
import tools.MusicLog;

/**
 * 音效观察点：装配、自检、逐步取走（xl-1vu.8）。
 *
 * 导出真值时音效是关的（{@code CAN_PLAY_MUSIC = NO}，{@link ExportTrace#main} 开头
 * 对所有驱动器统一关掉），而原版把「正在放哪个音效」记在 {@code MusicPlayer.filename}
 * 上，那行赋值落在 {@code playmusic} 的 {@code CAN_PLAY_MUSIC} 判断**里面** ——
 * 关掉就一个字都观察不到。开关不能打开：每次点击都开一次音频设备、起一条播放线程，
 * 两遍导出不可能逐字节一致。所以换了观察点，提到 {@code MusicReader.readmusic} 的
 * 入口（{@link tools.MusicLog}，src/ 侧的诊断改动，默认关闭时是空操作）。
 *
 * <h2>两道自检，都是为了让「没记到」和「本来就没响」分得开</h2>
 *
 * 音效字段的天然失败形态是**空数组**，而空数组同时也是「这一步本来就不响」的正常
 * 取值 —— 失败长得和成功一模一样。所以这里不靠肉眼看真值，靠两道会硬失败的检查：
 *
 *   1. {@link #arm()} 当场打一发探针：{@code readmusic(PROBE)} 之后必须恰好
 *      drain 回这一个名字。观察点要是哪天被挪回 {@code CAN_PLAY_MUSIC} 判断里面、
 *      或者 {@code MusicReader} 的那行调用被删掉，这里立刻退出码 2，而不是安静地
 *      导出一份"每一步都不响"的真值。探针走的是游戏自己的入口，不是直接调
 *      {@code MusicLog.record} —— 直接调就绕开了要验的那截接线。
 *   2. {@link #requireRecorded()} 在剧本跑完时要求整份真值至少记到过一次音效。
 *      分母是固定的（"这份剧本有没有响过"），比"我看着像是对的"可数。
 *
 * 探针本身不会出声也不会碰文件：{@code CAN_PLAY_MUSIC == NO} 时 {@code playmusic}
 * 整个方法体都不进。{@link #arm()} 因此**必须在 closeMusic() 之后调**，并且自己
 * 核对这一点 —— 不过要说清楚它现在的成色：{@link ExportTrace#main} 在任何驱动器
 * 起来之前就把 {@code CAN_PLAY_MUSIC} 设成 {@code NO} 了，所以那道 if **当下
 * 打不响**。它是留给将来某个不走 ExportTrace 的调用者的前置断言，不是一道在验的
 * 检查；别把它当成"探针是安全的"的证据。
 *
 * {@link #requireRecorded()} 只在剧本正常跑完那条出口上调。跑爆 {@code maxSteps}
 * 的剧本走不到它 —— 那是对的，maxSteps 那条失败更响，先报它。
 */
final class MusicTap {

    /** 探针用的假文件名。带前后缀是为了万一漏进真值里一眼能认出来。 */
    private static final String PROBE = "__musictap-probe__.wav";

    private final String who;
    private int total;

    MusicTap(String who) { this.who = who; }

    /**
     * 打开记录并当场验一遍观察点是活的。必须在 {@code MusicReader.closeMusic()}
     * 之后、派发第一个事件之前调。
     */
    void arm() {
        if (MusicPlayer.CAN_PLAY_MUSIC != MusicPlayer.NO) {
            ExportTrace.die(who + "：装配音效观察点时 CAN_PLAY_MUSIC 不是 NO —— "
                    + "探针会真去开音频设备读一个不存在的文件。arm() 要在 closeMusic() 之后调");
        }
        MusicLog.setRecording(true);
        MusicReader.readmusic(PROBE);
        String[] got = MusicLog.drain();
        if (got.length != 1 || !PROBE.equals(got[0])) {
            ExportTrace.die(who + "：音效观察点没接上 —— 探针 readmusic(" + PROBE + ") 之后"
                    + " drain 回来的是 " + Json.plainArr(got) + "（应为恰好这一个名字）。"
                    + "多半是 tools.MusicLog.record 被挪进了 CAN_PLAY_MUSIC 判断里面，"
                    + "或者 MusicReader.readmusic 里那行调用没了");
        }
    }

    /** 取走这一步记下的音效文件名，按调用先后排列。 */
    String[] drain() {
        String[] a = MusicLog.drain();
        total += a.length;
        return a;
    }

    /** 剧本跑完时调。一次都没记到就是硬失败 —— 见类注释第 2 条。 */
    void requireRecorded() {
        if (total == 0) {
            ExportTrace.die(who + "：整份真值一个音效都没记到。菜单/商店的每一次有效点击"
                    + "原版都要出声，所以这不是'本来就不响'，是观察点或者 drain 的位置不对");
        }
    }
}
