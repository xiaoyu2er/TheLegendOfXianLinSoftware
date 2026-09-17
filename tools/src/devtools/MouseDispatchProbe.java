package devtools;

import java.awt.AWTEvent;
import java.awt.EventQueue;
import java.awt.Point;
import java.awt.Toolkit;
import java.awt.event.MouseEvent;
import java.io.FileWriter;
import java.io.PrintWriter;

import main.GameLauncher;

/**
 * 量「原版到底收到了哪几下鼠标事件，各派给了谁」（xl-zs6 现搭，xl-sij 收进来）。
 *
 * <h2>为什么要量</h2>
 *
 * 「舞台外按着键拖进来」这一族票（xl-2yh、xl-m9q、xl-zs6、xl-5ee）里，web 端复刻的依据
 * 是 JDK 17 {@code Container.LightweightDispatcher} 的源码。可源码只答得了一半的问题：
 * <b>事件到了 Java 之后派给谁</b>。另一半 —— <b>这一下到没到得了 Java 窗口</b> —— 归操作系统，
 * 源码里查不到，于是那几张票的票面上反复出现「平台未验证」。
 *
 * <p>这个探针把两个问题分开：它挂在 {@link Toolkit#addAWTEventListener} 上，那是
 * <b>派发之前</b>的位置，所以「窗口收到了但没转派给面板」与「压根没到窗口」在日志里长得不一样
 * （前者有一行、{@code src} 是 {@code main.GameLauncher}；后者一行都没有）。xl-zs6 量到的
 * 正是这两条不同的路同时存在。
 *
 * <p>它<b>不改 {@code src/}</b>：只加监听器，再照常调 {@code main.Game.main}。
 *
 * <h2>怎么量</h2>
 *
 * <pre>
 *   devtools.MouseDispatchProbe &lt;事件日志&gt; &lt;几何文件&gt;
 * </pre>
 *
 * 每一个 {@code MOUSE_EVENT_MASK | MOUSE_MOTION_EVENT_MASK} 的事件写一行：
 * 毫秒时间戳、事件名、{@code btn=} 按键号、{@code mex=} {@code getModifiersEx}、
 * {@code src=} <b>派给了谁</b>（{@code getComponent()} 的类名）、{@code xy=} 组件内坐标、
 * {@code scr=} 屏幕坐标。开窗 2 秒后把 {@code StartPanel} 的屏幕几何写进几何文件
 * （{@code x y 宽 高}，一行四个数），供驱动器算落点；日志里同时留一行 {@code GEOMETRY}。
 *
 * <p>进程不会自己退出（原版的主循环在跑），由 {@code tools/mouse-dispatch-probe.sh} 收掉。
 *
 * <h2>复现（仓库根目录）</h2>
 *
 * 别手工拼：整套（编译、权限预检、四组序列、三轮、与期望读数对账）都在
 *
 * <pre>
 *   tools/mouse-dispatch-probe.sh --dry-run    # 只编译 + 读权限，不碰鼠标
 *   tools/mouse-dispatch-probe.sh              # 真跑，会接管物理鼠标，跑前问人
 * </pre>
 *
 * 单独跑探针（不合成事件，自己用手按）：
 *
 * <pre>
 *   tools/build.sh
 *   java -Djava.awt.headless=false \
 *     -cp tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar \
 *     devtools.MouseDispatchProbe /tmp/events.log /tmp/geometry.txt
 * </pre>
 *
 * <h2>期望读数（xl-zs6，macOS 24.6.0 + openjdk 17，2026-09-16，三轮逐字一致）</h2>
 *
 * 驱动器那四组序列跑完，日志里的按下 / 松手<b>一共六行</b>，去掉时间戳与屏幕坐标之后：
 *
 * <pre>
 *   PRESSED  btn=1 mex=0x400  src=start.StartPanel   xy=600,300     ← A 对照
 *   RELEASED btn=1 mex=0x0    src=start.StartPanel   xy=600,300     ← A 对照
 *   PRESSED  btn=3 mex=0x1400 src=main.GameLauncher  xy=600,328     ← B  右键按下
 *   RELEASED btn=3 mex=0x400  src=main.GameLauncher  xy=600,328     ← B  右键松手
 *   PRESSED  btn=3 mex=0x1400 src=main.GameLauncher  xy=600,328     ← B2 右键按下
 *   RELEASED btn=3 mex=0x0    src=main.GameLauncher  xy=600,328     ← B2 右键松手
 * </pre>
 *
 * 逐字的那一份在 {@code tools/mouse-dispatch/expected-events.txt}，脚本跑完会自己对账。
 * 三条读法：
 *
 * <ul>
 *   <li><b>左键那一下松手一行都没有</b> —— 它按在别的窗口上，整段拖动与它的松手都归那个窗口，
 *       Java 连事件都收不到（B / B2 / C 三组都是）；</li>
 *   <li><b>右键那两下有行，而 {@code src} 是 {@code main.GameLauncher} 不是
 *       {@code start.StartPanel}</b> —— 到了窗口，但 {@code isMouseGrab} 为真、目标仍是 null，
 *       没转派给面板；</li>
 *   <li><b>C 组（只松左键）按下 / 松手一行都没有</b>，连 {@code DRAGGED} 都没有 —— 那一组里
 *       Java 侧只收到了 {@code ENTERED}、几行松手之后的 {@code MOVED} 与一个 {@code EXITED}
 *       （原版的 {@code MouseAdapter} 没接 {@code ENTERED}）。⚠️ xl-zs6 的关票理由里那句
 *       「只来一个 {@code ENTERED}」按字面复核对不上：那一轮 C 组还跟着四行 {@code MOVED}
 *       与一行 {@code EXITED}，而 xl-sij 重跑时是<b>三行</b> —— 成立的是「按下 / 松手与
 *       {@code DRAGGED} 一个都没有」。移动那批的条数本来就不稳（系统会合并），这也是
 *       对账只取按下 / 松手的第二个理由。</li>
 * </ul>
 *
 * <p>屏幕坐标与 {@code MOVED} / {@code ENTERED} / {@code EXITED} / {@code CLICKED} 那些行
 * <b>不在对账范围里</b>，如实说：{@code scr=} 取决于窗口落在屏幕哪里（xl-zs6 那次是
 * {@code GEOMETRY 0,53 1024x640}，于是 {@code scr=600,353}），而三轮逐字一致这件事当时
 * 只在按下 / 松手那几行上核过，移动那批只有第一轮的完整日志。{@code xy=} 留在对账里是因为
 * 它是组件内坐标：{@code 600,300} 与 {@code 600,328} 差的 28 是面板在窗口里的纵向偏移，
 * 与窗口落点无关。
 *
 * <h2>⚠️ 这套东西跑不进 CI</h2>
 *
 * 两条硬拦（与 {@code tools/export-scaled-blit.sh} 的处境正好相反 —— 那个导出器只往
 * {@code BufferedImage} 上画，所以它跑在 CI 的条件下）：
 *
 * <ul>
 *   <li><b>要真窗口</b>：{@code -Djava.awt.headless=false}，而且要一块真的
 *       {@code StartPanel} 摆在屏幕上、有屏幕坐标可算；</li>
 *   <li><b>要 CGEvent 的合成权限</b>：驱动器往 HID tap 上发事件，需要「辅助功能」授权，
 *       那是人在系统设置里点的，runner 上给不了。</li>
 * </ul>
 *
 * CI 里唯一覆盖到的是<b>这个文件编译得过</b>（{@code tools/build.sh} 扫 {@code tools/src}）。
 * 驱动器那一半连编译都不在 CI 里，要 {@code --dry-run} 才编。
 *
 * <h2>⚠️ 一个会骗人的读数：没有权限时，Java 侧同样是零事件</h2>
 *
 * 合成事件在没有辅助功能授权时被<b>静默丢弃</b>，探针一行都收不到 —— 与「原版真的收不到」
 * 长得一模一样。所以 <b>A 对照（窗口内空白处左键单击必须被 {@code start.StartPanel} 收到）
 * 是判据的一部分，不是装饰</b>：A 有行、B 的左键没行，才叫量到了；A 也没行，那是权限没给。
 * 驱动器起手打印 {@code CGPreflightPostEventAccess} 与 {@code AXIsProcessTrusted} 也是为此。
 */
public class MouseDispatchProbe {

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            System.err.println("用法：devtools.MouseDispatchProbe <事件日志> <几何文件>");
            System.exit(2);
        }
        // autoFlush：进程是被外面 kill 掉的，缓冲住的行会连同「到底收到没有」一起丢掉，
        // 而那与「原版真的收不到」长得一样。
        final PrintWriter out = new PrintWriter(new FileWriter(args[0]), true);
        Toolkit.getDefaultToolkit().addAWTEventListener(e -> {
            MouseEvent m = (MouseEvent) e;
            out.println(System.currentTimeMillis() + " " + name(m.getID()) + " btn=" + m.getButton()
                    + " mex=0x" + Integer.toHexString(m.getModifiersEx())
                    + " src=" + m.getComponent().getClass().getName()
                    + " xy=" + m.getX() + "," + m.getY()
                    + " scr=" + m.getXOnScreen() + "," + m.getYOnScreen());
        }, AWTEvent.MOUSE_EVENT_MASK | AWTEvent.MOUSE_MOTION_EVENT_MASK);

        main.Game.main(new String[0]);

        Thread.sleep(2000);   // 等窗口真的摆上屏幕，否则 getLocationOnScreen 拿到的是布局前的位置
        EventQueue.invokeAndWait(() -> {
            Point p = GameLauncher.startPanel.getLocationOnScreen();
            int w = GameLauncher.startPanel.getWidth();
            int h = GameLauncher.startPanel.getHeight();
            try (PrintWriter g = new PrintWriter(new FileWriter(args[1]))) {
                g.println(p.x + " " + p.y + " " + w + " " + h);
            } catch (Exception ex) {
                throw new RuntimeException(ex);
            }
            out.println("GEOMETRY " + p.x + "," + p.y + " " + w + "x" + h);
        });
    }

    static String name(int id) {
        switch (id) {
            case MouseEvent.MOUSE_PRESSED: return "PRESSED";
            case MouseEvent.MOUSE_RELEASED: return "RELEASED";
            case MouseEvent.MOUSE_CLICKED: return "CLICKED";
            case MouseEvent.MOUSE_MOVED: return "MOVED";
            case MouseEvent.MOUSE_DRAGGED: return "DRAGGED";
            case MouseEvent.MOUSE_ENTERED: return "ENTERED";
            case MouseEvent.MOUSE_EXITED: return "EXITED";
            default: return "ID" + id;
        }
    }
}
