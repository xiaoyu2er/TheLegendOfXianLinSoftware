package devtools;

import java.awt.AWTEvent;
import java.awt.EventQueue;
import java.awt.GraphicsEnvironment;
import java.awt.Point;
import java.awt.Rectangle;
import java.awt.Toolkit;
import java.awt.event.MouseEvent;
import java.io.FileWriter;
import java.io.PrintWriter;

import javax.swing.JFrame;

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
 *   devtools.MouseDispatchProbe &lt;事件日志&gt; &lt;几何文件&gt; [&lt;另一块窗口的几何文件&gt;]
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
 * 别手工拼：整套（编译、权限预检、五组序列、三轮、与期望读数对账、分段读数）都在
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
 * 驱动器的 A / B / B2 / C 四组跑完，日志里的按下 / 松手<b>一共六行</b>，去掉时间戳与屏幕坐标之后
 * （D 组是后加的，见下一节 —— 它那两行还是预测）：
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
 * <h2>换落点：量过哪几支、结论变没变（xl-g9w、xl-23v）</h2>
 *
 * 上面那份读数有一条限定：「窗口外」是<b>驱动器自己开的那块空白窗口</b>（另一个 app 的普通窗口）。
 * {@code drive --where} 现在能换落点，三支的处境各不相同：
 *
 * <ul>
 *   <li><b>{@code outside-window}（默认）</b> —— 就是 xl-zs6 量的那一种。</li>
 *   <li><b>{@code same-app-window} —— 量过了，结论<b>相同</b></b>（macOS 24.6.0 + openjdk 17，2026-09-16，三轮逐字一致）。
 *       这一支的「窗口外」是<b>同一个 JVM 自己多开的另一块 {@link javax.swing.JFrame}</b>（由
 *       {@link #openSameAppWindow} 开，位置尺寸与驱动器那块一样），于是两支只差一件事：那块窗口归谁。
 *       把读数里 {@code src} 是那块 {@code JFrame} 的行滤掉，<b>剩下的六行与上面那六行逐字相同</b>
 *       （实跑 {@code diff} 退出码 0，不是看着像；脚本跑完会把这一条当场打出来）。也就是说：
 *       左键那一下的按下 / 松手 / 整段 {@code DRAGGED} <b>照样一次都不到原版窗口</b>，右键那两下照样停在
 *       {@code main.GameLauncher}。不同的只有<b>那块 {@code JFrame} 自己</b>收到了那几下（连松手也归它，
 *       {@code xy} 是它自己坐标系里的负数）。逐字读数与读法在
 *       {@code tools/mouse-dispatch/expected-events-same-app-window.txt}。
 *       对 web 端的意思：{@code grabbedElsewhere} 押的那个口径在同一个 app 的另一块窗口上也成立。</li>
 *   <li><b>{@code desktop} —— 量过了，结论<b>相同</b></b>（xl-23v，macOS 24.6.0 + openjdk 17，
 *       2026-09-17，三轮逐字一致，落点 {@code 3320,1260}）。A/B/B2/C 那六行与默认落点<b>逐字相同</b>；
 *       D 组四行里三行相同，<b>唯一不同的那一行是按构造的</b> —— D2「在外面按右、再松左」松手那一下的
 *       {@code xy} 就是<b>落点换算到面板内坐标</b>（{@code 3320,1260} 减面板左上角 {@code 0,53} ⇒
 *       {@code 3320,1207}；默认落点那一支是 {@code 1254,250}）。脚本把这一处单独摘出来报，
 *       判词是「只差落点坐标」，<b>不是</b>「换落点改了结论」—— 两者不许共用一句话
 *       （见 {@code tools/mouse-dispatch/cmp-vs-outside.py}）。逐字读数在
 *       {@code tools/mouse-dispatch/expected-events-desktop.txt} 与 {@code …-D-desktop.txt}。
 *       <p>⚠️ 两条前提，都得在借鼠标之前弄好：<b>主屏要有一块露出来的桌面</b>（驱动器现扫一个
 *       「周围 30 像素内无窗口」的点，铺满时<b>硬失败</b>并列出挡路的窗口 —— 不硬挑一个点，是因为
 *       挑错了会落在别人的窗口上，<b>而那份读数看起来仍然正常</b>；先跑
 *       {@code tools/mouse-dispatch-probe.sh --check-point --where desktop} 问清楚，那条路不碰鼠标）；
 *       以及<b>落点会在轮与轮之间漂</b> —— <b>光标自己也是一块在屏窗口</b>（{@code Window Server}，
 *       约 17x23），驱动器每轮把光标停在落点上，下一轮扫描就把它当障碍、往上让一个 40 像素的格
 *       （xl-23v 头一趟三轮扫到 {@code 3320,1260 / 1220 / 1180}，于是 D2 那行跟着变，
 *       <b>读起来像原版的派发不确定</b>）。现在扫描排除光标层，第 1 轮扫到的点钉给后面几轮。</li>
 *   <li><b>原生全屏 app —— 构造上量不了。</b> macOS 把全屏的 app 放进<b>自己的 Space</b>，
 *       原版窗口同时不在屏幕上，「在外面按下、拖进原版窗口」发生不了；而「铺满屏幕但仍在同一个
 *       Space 的普通窗口」等价于 {@code outside-window} 那一支。<b>⚠️ 这一条是推理，没量过。</b></li>
 * </ul>
 *
 * <h2>⚠️ 它不是每一轮都量得到（xl-g9w 实测）</h2>
 *
 * 13 轮里有 2 轮被别的窗口抢走了焦点：一轮整轮<b>零事件</b>，一轮的 B 组读到
 * {@code mex=0x1000}（左键没算成按着）。两者都被判据拦下了，而拦它们的是<b>逐轮</b>的 A 对照与
 * 轮间比对 —— 所以<b>三轮逐字一致这件事本身就是判据的一半</b>，不是装饰。跑它的时候别动鼠标键盘，
 * 也别让别的 agent 同时跑它。

 * <h2>D 组：起 grab 那只键松开之后的拖动（xl-8eg，已量）</h2>
 *
 * 上面六行答的是「<b>起 grab 那只键按着</b>拖出去」。xl-df1 之后多出一支没量过的：<b>起 grab
 * 那只键已经松开、只剩那只在舞台外按下（因而被挡掉）的键还按着</b>，这时候的拖动原版收不收得到。
 * 两种结果都说得通 —— 操作系统按「哪只键起的那次拖动」派给别的窗口（原版一条都没有），还是
 * 仍按窗口的隐式 grab 送进来（原版照收）—— 所以不能靠推。
 *
 * <p>驱动器为此加了第五组序列（D），分六段打标：
 *
 * <pre>
 *   D0 内按左：在面板里按下，起 grab
 *   D1 拖出：起 grab 那只键按着          ← 正对照，xl-40m 已量到 DRAGGED 一路 src=start.StartPanel
 *   D2 外按右、再松左
 *   D3 拖回：只剩被挡掉的那只键按着      ← 要量的就是这一段
 *   D4 松右、之后的移动
 *   D5 面板里按右 → 拖一段 → 松右       ← 第二个正对照：合成的**右键**拖动进不进得来
 * </pre>
 *
 * <p><b>D 组的答案不在上面那份对账里</b>：{@code normalize} 只留按下 / 松手，而这里要的是
 * {@code DRAGGED}。它由 {@code tools/mouse-dispatch/reckon.py} 按 {@code MARK} 的时间戳分段给出，
 * 每段只报「出现过哪几种 {@code &lt;事件 btn mex src&gt;}」—— <b>不含计数、不含坐标</b>，因为移动那批的
 * 条数本来就不稳（见上一段），而零 / 非零与「派给了谁」是稳的。
 *
 * <h3>读数（2026-09-16，macOS 24.6.0 + openjdk 17，三轮逐字一致）</h3>
 *
 * <pre>
 *   D0  PRESSED  btn=1 mex=0x400  src=start.StartPanel xy=600,300
 *   D1  DRAGGED  btn=1 mex=0x400  src=start.StartPanel ×12，xy 一路到 1254,250（中间夹一条 EXITED）
 *   D2  按右：一条都没有；松左：RELEASED btn=1 mex=0x1000 src=start.StartPanel xy=1254,250
 *   D3  <b>零条事件</b>，连 ENTERED / MOVED 都没有          ← 本票要的读数
 *   D4  按下 / 松手一条都没有（只有 ENTERED / MOVED / EXITED）
 *   D5  PRESSED btn=3 mex=0x1000 / DRAGGED btn=3 mex=0x1000 ×12 / RELEASED btn=3 mex=0x100
 * </pre>
 *
 * <p><b>结论：拖动归「起这次拖动的那只键按下时所在的那个窗口」。</b>起 grab 那只键松开之后只剩
 * 那只在窗口外按下的键按着时，原版一条都收不到 —— web 侧因此在 {@code App.tsx} 的 {@code onDrag}
 * 与 {@code StartPanel.tsx} 的 {@code onMove} 上按位图挡住了这一支。
 * 逐字的那四行在 {@code tools/mouse-dispatch/expected-events-D.txt}，原始日志入库在
 * {@code tools/mouse-dispatch/replay-fixture/xl-8eg-D组三轮}，可以 {@code --replay} 重放；
 * 另两个落点的在 {@code …/same-app-window三轮} 与 {@code …/desktop三轮}。
 *
 * <p><b>D 组在三个落点上都量过了</b>（默认落点 xl-8eg；另两支 xl-23v，2026-09-17，各三轮逐字一致），
 * 每个落点一份读数：{@code expected-events-D.txt} / {@code expected-events-D-<落点>.txt}。
 * ⚠️ 加一个新落点时<b>要连 D 组那一份一起量</b>，否则脚本会把它报成「没核成」（退出码 3），不当成红 ——
 * 那一层<b>没核成</b>与<b>核过且一致</b>不许共用一个退出码。
 *
 * <p>⚠️ 一条与预测不同、如实记下的：D5 松右的 {@code mex} 是 <b>0x100</b>（{@code META_DOWN_MASK}，
 * 1&lt;&lt;8），不是 0x0 —— macOS 的 AWT 在右键松手时把老式的 META 修饰位带进了
 * {@code getModifiersEx}。只是记下来，没有往下追，也没有任何东西依赖它。
 *
 * <p>读法与 A 对照同构，而且要<b>两个</b>正对照：D1 只证得了「合成的<b>左</b>键拖动进得了 Java 窗口」，
 * D3 空着还剩一解 —— 合成的 {@code rightMouseDragged} 在这套 AWT + CGEvent 组合下根本到不了探针
 * （这件事仓库里从没量过；B / B2 量到的是右键<b>按下</b>）。所以加了 D5：全程在面板里、除右键外
 * 没有别的键。<b>D1 与 D5 都有 {@code DRAGGED}、而 D3 没有，才叫量到了「原版收不到」</b>；
 * 缺任一个正对照，D3 那个「没有」都不止一种读法。脚本把这两条都当判据核，核不过整轮 D 组作废。
 *
 * <p><b>按下 / 松手那一层的读数单独放</b>：{@code tools/mouse-dispatch/expected-events-D.txt}
 * （出处与限定跟 {@code expected-events.txt} 那四组不同，所以分两份，报错时各报各的）。
 *
 * <p>⚠️ <b>探针只驱动标题页</b>（{@code src=start.StartPanel}）。D 组的读数直接管的是
 * {@code web/src/start/StartPanel.tsx} 那一支；{@code web/src/app/App.tsx} 的四块宿主仍然是<b>推理</b>
 * （同一个 {@code JFrame} 里 {@code CardLayout} 的几块面板，「到不到得了这个窗口」由操作系统按窗口定）。
 * 写回读数时别把这一份当成四块宿主的实测。
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
        if (args.length != 2 && args.length != 3) {
            System.err.println("用法：devtools.MouseDispatchProbe <事件日志> <几何文件> [另一块窗口的几何文件]");
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

        if (args.length == 3) {
            openSameAppWindow(args[2], out);
        }
    }

    /**
     * 开一块**同一个 JVM 的另一个顶层窗口**，把它的屏幕几何写进 {@code path}（{@code x y 宽 高}）。
     *
     * <p>给 {@code drive --where same-app-window} 用：那一下「窗口外」的按下落在这块窗口上。
     * 它与 {@code drive} 自己开的那块空白窗口**位置与尺寸完全一样**（面板右边 80 像素、下移 100、300x300），
     * 于是两支只差一件事：那块窗口归谁。
     *
     * <p>⚙️ 它不改 {@code src/}：只是在同一个 JVM 里多开一块与原版无关的 {@link JFrame}。
     *
     * <p>❗ 落不进屏幕、或者与面板叠在一起了，就**硬失败**—— 叠上了的话那一下按下
     * 落在哪一块由 z 序定，而那份读数**看起来仍然是一份正常的读数**。
     */
    static void openSameAppWindow(String path, PrintWriter out) throws Exception {
        EventQueue.invokeAndWait(() -> {
            Point p = GameLauncher.startPanel.getLocationOnScreen();
            int x = p.x + GameLauncher.startPanel.getWidth() + 80;
            int y = p.y + 100;
            JFrame f = new JFrame("xl-g9w same-app outside");
            f.setDefaultCloseOperation(JFrame.DO_NOTHING_ON_CLOSE);
            f.setBounds(x, y, 300, 300);
            f.setVisible(true);
            Rectangle b = f.getBounds();
            Rectangle screen = GraphicsEnvironment.getLocalGraphicsEnvironment()
                    .getDefaultScreenDevice().getDefaultConfiguration().getBounds();
            Rectangle panel = new Rectangle(p.x, p.y,
                    GameLauncher.startPanel.getWidth(), GameLauncher.startPanel.getHeight());
            // ⚙️ 这两条用 System.exit 而不是抛：抛出去只是让 main 挂掉，而 EDT 不是守护线程，
            // JVM 照活着 —— 外面的脚本只会干等 30 秒再报「原版多半没起来」，
            //    与真的没起来同形。（脚本那边同时加了一条：进程没了就当场报，不等超时。）
            if (!screen.contains(b)) {
                System.err.println("另一块窗口 " + b + " 没完全落在屏幕 " + screen + " 里");
                System.exit(2);
            }
            if (b.intersects(panel)) {
                System.err.println("另一块窗口 " + b + " 与面板 " + panel + " 叠在一起了 —— 这一下按下落在哪一块说不准");
                System.exit(2);
            }
            try (PrintWriter g = new PrintWriter(new FileWriter(path))) {
                g.println(b.x + " " + b.y + " " + b.width + " " + b.height);
            } catch (Exception ex) {
                throw new RuntimeException(ex);
            }
            out.println("SAMEAPP " + b.x + "," + b.y + " " + b.width + "x" + b.height);
            // 把这块窗口的**组件类名**自己写出去：对账时要把它收到的行滤掉、只留原版窗口那几行，
            // 而把类名写死在外面的脚本里的话，这里一换类，滤不掉的行就被当成「原版收到的」——
            // 而那份输出**看起来仍然正常**。于是让它自己报名，外面现读。
            out.println("SAMEAPPCLASS " + f.getClass().getName());
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
