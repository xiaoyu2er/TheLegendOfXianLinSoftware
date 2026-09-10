package devtools;

import media.MusicPlayer;
import media.MusicReader;
import tools.MusicLog;

/**
 * 音效观察点：装配、自检、逐步取走、写进真值（xl-1vu.8 立的，xl-1vu.11 收的）。
 *
 * 导出真值时音效是关的（{@code CAN_PLAY_MUSIC = NO}，{@link ExportTrace#main} 开头
 * 对所有驱动器统一关掉），而原版把「正在放哪个音效」记在 {@code MusicPlayer.filename}
 * 上，那行赋值落在 {@code playmusic} 的 {@code CAN_PLAY_MUSIC} 判断**里面** ——
 * 关掉就一个字都观察不到。开关不能打开：每次点击都开一次音频设备、起一条播放线程，
 * 两遍导出不可能逐字节一致。所以换了观察点，提到 {@code MusicReader.readmusic} 的
 * 入口（{@link tools.MusicLog}，src/ 侧的诊断改动，默认关闭时是空操作）。
 *
 * <h2>为什么是静态的，以及接一支新驱动器要写几行</h2>
 *
 * 观察点 {@link tools.MusicLog} 本来就是全局的（它挂在 {@code MusicReader} 的静态
 * 入口上），一次导出一个 JVM、一支驱动器、跑完就 {@code System.exit}（见
 * {@link ExportTrace#main}）。所以这里跟着做成静态的，好处是**取样时机不再由每支
 * 驱动器各写一遍**：{@link #afterStep()} 与 {@link #requireRecorded()} 由导出器
 * 在唯一的一处循环里调（{@link ExportTrace} 的 {@code run()}），驱动器只剩两行：
 *
 * <pre>
 *   1. start() 的最后一行： MusicTap.arm(script.name);
 *                          （剧本可以全程不出声的用 armAllowingSilence）
 *   2. snapshotState() 里： b.append(",\"music\":").append(MusicTap.json());
 * </pre>
 *
 * 收拢之前这是**六处逐字重复**（两个字段、构造函数尾巴、step() 开头的
 * requireRecorded 出口、paint 之后那行 drain、snapshotState 里那行 plainArr），
 * menu 与 shop 各抄一遍。
 *
 * <h2>两个相反的取样时机，一个在这里、一个不在</h2>
 *
 * <ul>
 *   <li><b>音效在 paint 之后取</b> —— 因为**原版的 paint 真的出声**：
 *       {@code EquipPanel.drawWarning()} 里有两处 {@code readmusic("禁止.wav")}。
 *       {@link #afterStep()} 由导出器在 {@code driver.step()} <b>返回之后</b>调，
 *       而 paint 发生在 step() 里面，所以「paint 之后」这条自动成立，且比原来更宽：
 *       step() 里任何位置出的声都算进本步。挪到 step() 之前会让 menu-equip 的
 *       t=6 / t=10 那两声禁止整体错位到下一步。</li>
 *   <li><b>拒绝标志在 paint 之前抓</b> —— {@code drawWarning()} 在出声的同一段里
 *       把 {@code isEquiped} / {@code canBeEquiped} 清零。这一条**不在本类里**，
 *       它是 {@link MenuDriver#step()} 自己的事：只有驱动器知道自己 paint 的是
 *       哪个面板、要抓哪几个字段。两个时机相反，所以刻意分开放。</li>
 * </ul>
 *
 * <h2>三道自检，都是为了让「没记到」和「本来就没响」分得开</h2>
 *
 * 音效字段的天然失败形态是**空数组**，而空数组同时也是「这一步本来就不响」的正常
 * 取值 —— 失败长得和成功一模一样。所以这里不靠肉眼看真值，靠四道会硬失败的检查：
 *
 * <ol>
 *   <li>{@link #arm} 当场打一发探针：{@code readmusic(PROBE)} 之后必须恰好
 *       drain 回这一个名字。观察点要是哪天被挪回 {@code CAN_PLAY_MUSIC} 判断里面、
 *       或者 {@code MusicReader} 的那行调用被删掉，这里立刻退出码 2，而不是安静地
 *       导出一份「每一步都不响」的真值。探针走的是游戏自己的入口，不是直接调
 *       {@code MusicLog.record} —— 直接调就绕开了要验的那截接线。</li>
 *   <li>{@link #requireRecorded()} 在剧本跑完时要求整份真值至少记到过一次音效。
 *       分母是固定的（「这份剧本有没有响过」），比「我看着像是对的」可数。
 *       剧本确实可能全程不出声（实测五份场景剧本一份都不响），那种要显式声明
 *       {@link #armAllowingSilence}，而不是把这道检查删掉。</li>
 *   <li>{@link #json()} 在没 arm 过时硬失败。收拢成两行之后新的失败形态是
 *       「抄了 snapshotState 那行、忘了 start() 那行」—— 那样每一步都会安静地写
 *       {@code []}，又是一次失败长得像成功。这道检查把它变成退出码 2。</li>
 *   <li>{@link #json()} 还要求**本步已经取过样**（{@link #afterStep()} 置的那个
 *       标志）。取样顺序（step() 之后、snapshotState() 之前）此前只靠一句注释，
 *       而把那两行对调，前三道自检全绿、{@code --check} 两遍照样逐字节一致，
 *       只有整份真值整体错位一步 —— 正是「一个稳定的错误看起来和正确一模一样」。
 *       这道检查把它变成退出码 2。</li>
 * </ol>
 *
 * 探针本身不会出声也不会碰文件：{@code CAN_PLAY_MUSIC == NO} 时 {@code playmusic}
 * 整个方法体都不进。{@link #arm} 因此**必须在 closeMusic() 之后调**，并且自己
 * 核对这一点 —— 不过要说清楚它现在的成色：{@link ExportTrace#main} 在任何驱动器
 * 起来之前就把 {@code CAN_PLAY_MUSIC} 设成 {@code NO} 了，所以那道 if **当下
 * 打不响**。它是留给将来某个不走 ExportTrace 的调用者的前置断言，不是一道在验的
 * 检查；别把它当成「探针是安全的」的证据。
 *
 * {@link #requireRecorded()} 只在剧本正常跑完那条出口上调。跑爆 {@code maxSteps}
 * 的剧本走不到它 —— 那是对的，maxSteps 那条失败更响，先报它。
 */
final class MusicTap {

    /** 探针用的假文件名。带前后缀是为了万一漏进真值里一眼能认出来。 */
    private static final String PROBE = "__musictap-probe__.wav";

    /** 谁装的（剧本名），只用于错误消息。null = 还没装。 */
    private static String who;

    /** 这份剧本是不是「必须响过至少一次」。见 {@link #requireRecorded()}。 */
    private static boolean mustSound;

    /** 整份真值到目前为止一共记到过几次音效。{@link #requireRecorded()} 的分母。 */
    private static int total;

    /** 上一次 {@link #afterStep()} 取走的那一批，就是要写进本步真值的那个数组。 */
    private static String[] lastStep = new String[0];

    /**
     * 本步取过样了没有。{@link #afterStep()} 置上，{@link #json()} 要求它为真
     * 并消费掉 —— 这是「取样顺序」这条契约唯一会响的地方，见第 4 道自检。
     */
    private static boolean sampled;

    private MusicTap() {}

    /**
     * 打开记录并当场验一遍观察点是活的。由驱动器在自己的 {@code start()} 末尾调，
     * 必须在 {@code MusicReader.closeMusic()} 之后、派发第一个事件之前。
     *
     * @param who 剧本名，只进错误消息。
     */
    static void arm(String who) { arm(who, true); }

    /**
     * 同 {@link #arm(String)}，但明确声明**这份剧本可以全程不出声**，于是
     * {@link #requireRecorded()} 那道检查不适用。
     *
     * 为什么要有这个岔路：「至少响过一次」是照着菜单/商店的形状立的（那两支每一次
     * 有效点击原版都出声，所以 0 次一定是接线坏了）。场景不是这个形状 —— 实测五份
     * 场景剧本（dorm-intro / dorm-walk / dorm-exit / bigmap-walk / milestone）
     * <b>一份都不出声</b>：走路、切场景、对话推进全都不走 {@code readmusic}。对它们
     * 来说 0 次就是正确答案，硬套那道检查只会让「接上了」和「接坏了」都以退出码 2
     * 收场 —— 失败长得像成功的反面：正确长得像失败。
     *
     * 放弃的只是第 2 道检查，探针（第 1 道）照旧打：观察点死掉照样当场非零退出。
     * 而「可以不响」必须由驱动器**写出来**，不是默认值 —— 默认仍然是必须响过。
     *
     * 它是 xl-1vu.11 拿 SceneDriver 真接一遍时量出来的需要（五份场景剧本一声都
     * 不出），那次接线撤了（接上会改五份场景真值，与那张票「十份逐字节不变」的
     * 判据直接冲突），这条岔路留着。**第一个真调用者是 {@link SaveLoadDriver}**
     * （xl-i06.6）：存读档面板里没有一句 {@code readmusic}。menu / shop 两支照旧
     * 必须响过。
     */
    static void armAllowingSilence(String who) { arm(who, false); }

    private static void arm(String name, boolean mustSound) {
        if (who != null) {
            ExportTrace.die("音效观察点被装了两次（先是 " + who + "，又是 " + name
                    + "）—— 一次导出只跑一支驱动器一份剧本，装两次说明接线不对");
        }
        if (MusicPlayer.CAN_PLAY_MUSIC != MusicPlayer.NO) {
            ExportTrace.die(name + "：装配音效观察点时 CAN_PLAY_MUSIC 不是 NO —— "
                    + "探针会真去开音频设备读一个不存在的文件。arm() 要在 closeMusic() 之后调");
        }
        MusicLog.setRecording(true);
        MusicReader.readmusic(PROBE);
        String[] got = MusicLog.drain();
        if (got.length != 1 || !PROBE.equals(got[0])) {
            ExportTrace.die(name + "：音效观察点没接上 —— 探针 readmusic(" + PROBE + ") 之后"
                    + " drain 回来的是 " + Json.plainArr(got) + "（应为恰好这一个名字）。"
                    + "多半是 tools.MusicLog.record 被挪进了 CAN_PLAY_MUSIC 判断里面，"
                    + "或者 MusicReader.readmusic 里那行调用没了");
        }
        who = name;
        MusicTap.mustSound = mustSound;
    }

    /** 这支驱动器录不录音效。导出器靠它决定要不要调下面两个。 */
    static boolean armed() { return who != null; }

    /**
     * 取走这一步记下的音效文件名，按调用先后排列。
     *
     * **由 {@link ExportTrace} 在 {@code driver.step()} 返回之后、
     * {@code driver.snapshotState()} 之前调**，驱动器自己不调 —— 那正是「paint
     * 之后取」这个时机，见类注释。位置往前挪一格（比如挪到 step() 之前）会让
     * menu-equip 里 paint 打出来的那两声禁止整体错位一步。
     */
    static void afterStep() {
        if (sampled) {
            ExportTrace.die(who + "：上一步取的样没人要（afterStep() 连着调了两次，中间"
                    + "没有 json()）—— 那一步的音效会被下一步的覆盖掉，安静地丢掉");
        }
        lastStep = MusicLog.drain();
        total += lastStep.length;
        sampled = true;
    }

    /** 本步的音效数组，直接拼进 snapshotState 的 JSON。 */
    static String json() {
        if (who == null) {
            ExportTrace.die("有人在真值里写 music 字段，却从来没调过 MusicTap.arm() —— "
                    + "那样每一步都会安静地写 []，和「这份剧本本来就不出声」长得一模一样。"
                    + "驱动器的 start() 末尾要加一行 MusicTap.arm(script.name)");
        }
        if (!sampled) {
            ExportTrace.die(who + "：本步还没取样就来要 music 字段了 —— ExportTrace 的导出"
                    + "循环里 MusicTap.afterStep() 必须排在 driver.step() 之后、"
                    + "driver.snapshotState() 之前。顺序反了写出来的是上一步的音效，"
                    + "整份真值整体错位一步，而两遍导出照样逐字节一致（--check 看不见）");
        }
        sampled = false;
        return Json.plainArr(lastStep);
    }

    /**
     * 剧本跑完时由导出器调。一次都没记到就是硬失败 —— 见类注释第 2 条。
     *
     * 声明过 {@link #armAllowingSilence} 的剧本跳过这一条：对它们来说 0 次是
     * 正确答案，不是失败。
     */
    static void requireRecorded() {
        if (sampled) {
            ExportTrace.die(who + "：最后一步取的样没有人写进真值 —— afterStep() 与"
                    + " snapshotState() 的顺序反了，或者导出循环在取样之后提前跳出了。"
                    + "顺序反了的真值整体错位一步，而 --check 两遍照样逐字节一致");
        }
        if (mustSound && total == 0) {
            ExportTrace.die(who + "：整份真值一个音效都没记到，而这支驱动器声明了"
                    + "「必须响过」（MusicTap.arm）。这不是'本来就不响'，是观察点或者"
                    + "取样位置不对。剧本确实可以全程不出声的，改用 armAllowingSilence()"
                    + " —— 那是一句要写出来的声明，不是默认值");
        }
    }
}
