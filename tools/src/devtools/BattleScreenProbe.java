package devtools;

import java.awt.CardLayout;
import java.awt.Color;
import java.awt.Container;
import java.awt.Dimension;
import java.awt.Graphics;
import java.awt.Point;
import java.awt.Rectangle;
import java.awt.Robot;
import java.awt.Toolkit;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

import javax.imageio.ImageIO;
import javax.swing.JFrame;
import javax.swing.JPanel;
import javax.swing.SwingUtilities;
import javax.swing.UIManager;

import battle.BattlePanel;

/**
 * 量「原版上屏不扔 alpha」对一场战斗头几帧的影响（xl-ads）。
 *
 * <h2>为什么要量</h2>
 *
 * 原版 {@code BattlePanel.paint()} 末尾是 {@code g.drawImage(bufferedPic,0,0,this)}：
 * 以 SrcOver 把非预乘 ARGB 的缓冲画到 Swing 的缓冲上，alpha 不扔。导出器存的是
 * {@code bufferedPic} 本身，比对器不看 alpha；Web 上屏按 rgb/a 反预乘、alpha 置 1，
 * 对的是后者。两者只在缓冲 alpha 还没叠满的地方不同 —— 进程里头一场战斗、背景图
 * 半透明的那几条边、头几帧。{@link BattleDriver} 快照的是缓冲，量不到屏幕。
 *
 * <h2>怎么量</h2>
 *
 * 一个真 {@link JFrame}，内容面板用 {@link CardLayout}（同 {@code GameLauncher}），
 * 两张卡：
 *
 * <ul>
 *   <li>「前一个面板」：不透明、整块画成 {@link #UNDERLAY}（品红）。开战前先显示它。
 *       第 0 帧 alpha=0 的边上截到品红，下面就是上一个面板的残影；截到
 *       {@code Panel.background} 就是内容面板的底色。</li>
 *   <li>「战斗」替身 {@link Present}：{@code paint()} 只有原版末尾那一句
 *       {@code g.drawImage(缓冲,0,0,this)}，画的是驱动器这一步推完的 {@code bufferedPic}。
 *       不直接把原版面板挂上去，是因为原版 {@code paint()} 每调一次就往缓冲里再合成
 *       一遍 —— 驱动器已经画过一次，Swing 再画就是两次，缓冲 alpha 叠得比导出器快，
 *       量的就不是 Web 对着的那一份缓冲了。替身与原版面板的 opaque / doubleBuffered /
 *       尺寸逐项断言相同：Swing 往屏幕缓冲上怎么画这块面板，只看这几样。</li>
 * </ul>
 *
 * 第 0 帧：驱动器推一步 → 切到战斗卡（{@code show} 触发的那次绘制就是第 0 帧上屏）。
 * 之后每一步：推一步 → {@code repaint()}（同原版循环体末尾）。每帧等替身真的画过、
 * {@code Toolkit.sync()} 之后用 {@link Robot} 截战斗卡那 1024×640。
 *
 * 然后第二段：同一块替身，挨帧画「缓冲 RGB、alpha 置满」—— 这就是 Web 上屏那一侧
 * （反预乘后 alpha 置 1；Web 缓冲与原版缓冲逐像素对齐由 battle-script3 的跨端比对
 * 作证，见 web/src/compare/expected.ts），再截一遍。两段截图走同一套显示器色彩管理，
 * 所以差是在同一个色彩空间里比的。⚠️ 那个空间不是 sRGB（Robot 在 macOS 上读到的是
 * 显示器空间的值），差的绝对大小与 sRGB 下会有出入。
 *
 * <h2>复现（仓库根目录，先 tools/build.sh；要一块真屏幕，窗口别被挡住）</h2>
 *
 * <pre>
 *   J="java --add-opens java.base/java.lang=ALL-UNNAMED -Djava.awt.headless=false \
 *      -cp tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar devtools.BattleScreenProbe"
 *   $J capture tools/traces/scripts/battle-script3.json 8 /tmp/screen
 *   $J diff image/背景图/校园小道.png /tmp/screen 8 8
 * </pre>
 *
 * <h2>读数（2026-09-12，macOS Aqua，三轮）</h2>
 *
 * 边上超容差：第 0 帧 1711 / 1708 / 1712（最大差 78 / 78 / 79），第 1 帧 153 / 153 / 154
 * （32 / 33 / 33），第 2 帧 58 / 57 / 58（13 / 14 / 14），第 3 帧起 0。
 * 第 0 帧下面是内容面板底色：候选可分的 485 个边像素，{@code Panel.background} 命中 485、
 * 品红 0、黑 0。第 1 帧起两个候选可分的像素 0 个，判不出。
 *
 * 篡改：替身改画 {@link #opaque}（= 扔 alpha），8 帧边上超容差全 0；内容面板
 * {@code setBackground(UNDERLAY)}，命中挪到品红 485、第 0 帧涨到 2755（最大 94），
 * 而第 1 / 2 帧读数不变 —— 第 1 帧起下面不跟着内容面板底色走。
 *
 * 「已叠满处」偶尔在左下角 (0,629)-(10,639) 差出 32 个像素（五轮里两轮）：品红面板
 * 的截图里本来就有 1090 个不是品红的像素、包围盒贴着四个角，推断是窗口圆角露出了
 * 后面在变的东西，与缓冲无关（未核实）。
 */
public final class BattleScreenProbe {

    /** 「前一个面板」的颜色。选品红：与内容面板底色（238 灰）、黑、背景图的颜色都分得开。 */
    static final Color UNDERLAY = new Color(255, 0, 255);

    /** 截图前等合成器把这一帧真的推上屏幕。 */
    private static final long SETTLE_MS = 250;

    public static void main(String[] args) throws Exception {
        if (args.length == 0) usage();
        media.MusicPlayer.CAN_PLAY_MUSIC = media.MusicPlayer.NO;
        media.MusicPlayer.CAN_PLAY_BGM = media.MusicPlayer.NO;
        switch (args[0]) {
            case "capture":
                if (args.length != 4) usage();
                capture(new File(args[1]), Integer.parseInt(args[2]), new File(args[3]));
                break;
            case "diff":
                if (args.length != 5) usage();
                diff(new File(args[1]), new File(args[2]), Integer.parseInt(args[3]), Integer.parseInt(args[4]));
                break;
            default:
                usage();
        }
        System.exit(0);
    }

    private static void usage() {
        System.err.println("用法：capture <剧本> <帧数> <目录> | diff <背景图> <目录> <帧数> <容差>");
        System.exit(2);
    }

    /** 战斗卡的替身：{@code paint()} 只有原版 {@code BattlePanel.paint()} 末尾那一句。 */
    private static final class Present extends JPanel {
        private static final long serialVersionUID = 1L;
        volatile BufferedImage src;
        final AtomicInteger paints = new AtomicInteger();

        @Override
        public void paint(Graphics g) {
            BufferedImage s = src;
            if (s != null) g.drawImage(s, 0, 0, this);
            paints.incrementAndGet();
        }
    }

    private static final class Fill extends JPanel {
        private static final long serialVersionUID = 1L;
        final Color c;

        Fill(Color c) { this.c = c; }

        @Override
        public void paint(Graphics g) {
            g.setColor(c);
            g.fillRect(0, 0, getWidth(), getHeight());
        }
    }

    private static void capture(File scriptFile, int frames, File out) throws Exception {
        if (frames <= 0) ExportTrace.die("帧数要大于 0，给的是 " + frames);
        BattleDriver d = new BattleDriver(TraceScript.load(scriptFile));
        // 第一步才建原版面板；建之前拿不到它的 opaque 之类，所以先推第 0 步。
        if (!d.step()) ExportTrace.die(scriptFile.getName() + " 一步都没推就结束了");
        BattlePanel bp = d.panel();

        Present present = new Present();
        present.setPreferredSize(bp.getPreferredSize());
        Fill before = new Fill(UNDERLAY);
        before.setPreferredSize(bp.getPreferredSize());
        Fill panelBg = new Fill(UIManager.getColor("Panel.background"));
        Fill black = new Fill(Color.BLACK);
        // xl-eit：-Dprobe.presentBg=RRGGBB 把替身自己的底色改掉（原版 BattlePanel 没改过，
        // 是 Panel.background），量第 1 帧起下面是不是「被重画的那块面板自己的底色」。
        String presentBgHex = System.getProperty("probe.presentBg");
        Fill presentBg = null;
        if (presentBgHex != null) {
            Color pc = new Color(Integer.parseInt(presentBgHex, 16));
            present.setBackground(pc);
            presentBg = new Fill(pc);
            presentBg.setPreferredSize(bp.getPreferredSize());
        }
        // 原版面板一行都没改这几样（src/ 里没有 setOpaque / setDoubleBuffered），这里核一遍。
        if (present.isOpaque() != bp.isOpaque() || present.isDoubleBuffered() != bp.isDoubleBuffered()
                || !present.getPreferredSize().equals(bp.getPreferredSize())) {
            ExportTrace.die("替身与原版面板上屏属性不同：opaque " + present.isOpaque() + "/" + bp.isOpaque()
                    + " doubleBuffered " + present.isDoubleBuffered() + "/" + bp.isDoubleBuffered()
                    + " size " + present.getPreferredSize() + "/" + bp.getPreferredSize());
        }

        CardLayout cards = new CardLayout();
        JFrame[] frame = new JFrame[1];
        final Fill presentBgCard = presentBg;
        SwingUtilities.invokeAndWait(() -> {
            JFrame f = new JFrame("xl-ads 上屏探针");
            Container c = f.getContentPane();
            c.setLayout(cards);
            c.add("before", before);
            c.add("battle", present);
            c.add("panelBg", panelBg);
            c.add("black", black);
            if (presentBgCard != null) c.add("presentBg", presentBgCard);
            f.setResizable(false);
            f.pack();
            f.setLocation(40, 40);
            f.setVisible(true);
            f.toFront();
            cards.show(c, "before");
            frame[0] = f;
        });
        Thread.sleep(1500);
        Robot robot = new Robot();

        // 三种候选的「下面」各自在屏幕上长什么样，diff 拿第 0 帧 alpha=0 的边去对。
        save(grab(robot, before), out, "underlay-before.png");
        show(cards, frame[0], "panelBg");
        save(grab(robot, panelBg), out, "underlay-panelBg.png");
        show(cards, frame[0], "black");
        save(grab(robot, black), out, "underlay-black.png");
        if (presentBg != null) {
            show(cards, frame[0], "presentBg");
            save(grab(robot, presentBg), out, "underlay-presentBg.png");
        } else {
            // 上一轮带着开关跑过的目录里留着它，diff 会把它当成这一轮的候选。
            new File(out, "underlay-presentBg.png").delete();
        }
        show(cards, frame[0], "before");
        save(grab(robot, before), out, "underlay-before-again.png");

        BufferedImage[] bufs = new BufferedImage[frames];
        int[] paintsPerFrame = new int[frames];
        for (int i = 0; i < frames; i++) {
            if (i > 0 && !d.step()) ExportTrace.die(scriptFile.getName() + " 只推了 " + i + " 步就结束了");
            bufs[i] = copy(d.snapshotImage());
            present.src = bufs[i];
            int p0 = present.paints.get();
            if (i == 0) {
                SwingUtilities.invokeAndWait(() -> cards.show(frame[0].getContentPane(), "battle"));
            } else {
                present.repaint();
            }
            waitPainted(present, p0);
            paintsPerFrame[i] = present.paints.get() - p0;
            save(grab(robot, present), out, String.format(Locale.ROOT, "screen-%03d.png", i));
            save(bufs[i], out, String.format(Locale.ROOT, "buf-%03d.png", i));
        }
        System.err.println("[screen] 每帧替身被画了几次：" + Arrays.toString(paintsPerFrame));

        // 第二段：Web 那一侧 = 缓冲 RGB、alpha 置满。
        for (int i = 0; i < frames; i++) {
            present.src = opaque(bufs[i]);
            int p0 = present.paints.get();
            present.repaint();
            waitPainted(present, p0);
            save(grab(robot, present), out, String.format(Locale.ROOT, "web-%03d.png", i));
        }
        SwingUtilities.invokeAndWait(() -> frame[0].dispose());
    }

    private static void show(CardLayout cards, JFrame f, String name) throws Exception {
        SwingUtilities.invokeAndWait(() -> cards.show(f.getContentPane(), name));
        Thread.sleep(SETTLE_MS * 2);
    }

    private static void waitPainted(Present p, int before) throws Exception {
        long deadline = System.currentTimeMillis() + 5000;
        while (p.paints.get() == before) {
            if (System.currentTimeMillis() > deadline) ExportTrace.die("替身 5 秒没被画 —— 窗口被挡住或没上屏？");
            Thread.sleep(5);
        }
        SwingUtilities.invokeAndWait(() -> { });
        Toolkit.getDefaultToolkit().sync();
        Thread.sleep(SETTLE_MS);
    }

    private static BufferedImage grab(Robot robot, JPanel p) throws Exception {
        Point[] o = new Point[1];
        SwingUtilities.invokeAndWait(() -> o[0] = p.getLocationOnScreen());
        BufferedImage img = robot.createScreenCapture(new Rectangle(o[0], new Dimension(1024, 640)));
        if (img.getWidth() != 1024 || img.getHeight() != 640) {
            ExportTrace.die("截图是 " + img.getWidth() + "×" + img.getHeight() + "，应为 1024×640");
        }
        return img;
    }

    private static BufferedImage copy(BufferedImage b) {
        BufferedImage c = new BufferedImage(b.getWidth(), b.getHeight(), BufferedImage.TYPE_INT_ARGB);
        c.setRGB(0, 0, b.getWidth(), b.getHeight(), b.getRGB(0, 0, b.getWidth(), b.getHeight(), null, 0, b.getWidth()), 0, b.getWidth());
        return c;
    }

    private static BufferedImage opaque(BufferedImage b) {
        BufferedImage c = new BufferedImage(b.getWidth(), b.getHeight(), BufferedImage.TYPE_INT_RGB);
        int[] px = b.getRGB(0, 0, b.getWidth(), b.getHeight(), null, 0, b.getWidth());
        for (int i = 0; i < px.length; i++) px[i] |= 0xff000000;
        c.setRGB(0, 0, b.getWidth(), b.getHeight(), px, 0, b.getWidth());
        return c;
    }

    private static void save(BufferedImage img, File dir, String name) throws Exception {
        if (!dir.isDirectory() && !dir.mkdirs()) ExportTrace.die("建不了目录 " + dir);
        File f = new File(dir, name);
        if (!ImageIO.write(img, "png", f)) ExportTrace.die("写不了 PNG " + f);
    }

    // ================= diff =================

    private static void diff(File background, File dir, int frames, int tol) throws Exception {
        BufferedImage bg = read(background);
        int w = bg.getWidth(), h = bg.getHeight();
        boolean[] edge = new boolean[w * h];
        int translucent = 0;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                if ((bg.getRGB(x, y) >>> 24) < 255) { edge[y * w + x] = true; translucent++; }
            }
        }
        // 没有半透明边，下面每一行「边上超容差」都按构造是 0 —— 与「没差」同形。
        if (translucent == 0) ExportTrace.die(background + " 没有 alpha<255 的像素，边上一个都量不到（背景图传错了？）");
        if (frames <= 0) ExportTrace.die("帧数要大于 0，给的是 " + frames);
        System.out.println("背景 alpha<255 的像素：" + translucent + "；容差 " + tol + "（逐通道，显示器色彩空间）");

        // 「下面是什么」：第 0 帧缓冲没叠满的边上，按 a·web + (1-a)·候选 预测屏幕，
        // 数哪个候选预测得中。显示器空间不是线性的，这只是个判别、不是精确合成，
        // 所以只数「三个候选的预测彼此差出 6 倍容差以上」的像素 —— 在那些像素上
        // 判别不靠精度。分母是这类像素的个数，为 0 就是判不出，不是「都对」。
        BufferedImage s0 = read(new File(dir, "screen-000.png"));
        BufferedImage b0 = read(new File(dir, "buf-000.png"));
        BufferedImage v0 = read(new File(dir, "web-000.png"));
        String[] cands = { "underlay-before.png", "underlay-panelBg.png", "underlay-black.png" };
        int apart = 0;
        long[] hit = new long[cands.length];
        BufferedImage[] ci = new BufferedImage[cands.length];
        for (int k = 0; k < cands.length; k++) ci[k] = read(new File(dir, cands[k]));
        int[] pred = new int[cands.length];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int a = b0.getRGB(x, y) >>> 24;
                if (!edge[y * w + x] || a == 255) continue;
                for (int k = 0; k < cands.length; k++) pred[k] = blend(v0.getRGB(x, y), ci[k].getRGB(x, y), a);
                boolean separable = true;
                for (int k = 0; k < cands.length; k++) {
                    for (int m = k + 1; m < cands.length; m++) {
                        if (maxChannelDelta(pred[k], pred[m]) <= 6 * tol) separable = false;
                    }
                }
                if (!separable) continue;
                apart++;
                for (int k = 0; k < cands.length; k++) {
                    if (maxChannelDelta(s0.getRGB(x, y), pred[k]) <= 3 * tol) hit[k]++;
                }
            }
        }
        System.out.println("第 0 帧候选可分的边像素：" + apart + (apart == 0 ? "（判不出，下面的 0 不是「都对」）" : "")
                + "；按各候选预测屏幕、差在 " + (3 * tol) + " 以内的个数：");
        for (int k = 0; k < cands.length; k++) System.out.println("  " + cands[k] + "\t" + hit[k]);

        // 第 1 帧起下面是什么：上一帧的屏幕（不透明面板重画不清底），还是又一次底色。
        // 判法同上，两个候选的预测差出 6 倍容差以上的像素才数。
        BufferedImage bgShot = ci[1];
        // xl-eit：带 -Dprobe.presentBg 截过的话，多一个候选「替身自己的底色」，三者两两可分才数。
        File ownFile = new File(dir, "underlay-presentBg.png");
        BufferedImage own = ownFile.isFile() ? read(ownFile) : null;
        if (own != null) {
            for (int i = 0; i < frames; i++) {
                BufferedImage prev = i == 0 ? ci[1] : read(new File(dir, String.format(Locale.ROOT, "screen-%03d.png", i - 1)));
                BufferedImage s = read(new File(dir, String.format(Locale.ROOT, "screen-%03d.png", i)));
                BufferedImage v = read(new File(dir, String.format(Locale.ROOT, "web-%03d.png", i)));
                BufferedImage b = read(new File(dir, String.format(Locale.ROOT, "buf-%03d.png", i)));
                // 第 1 帧起缓冲 alpha 已高，三个预测彼此差不出 6 倍容差（上面那种判法分母为 0）。
                // 这里改数「离哪个预测最近」，只数预测两两差出 2 倍容差以上的像素；分母照样打印。
                int sep = 0, nearPrev = 0, nearBg = 0, nearOwn = 0;
                for (int y = 0; y < h; y++) {
                    for (int x = 0; x < w; x++) {
                        int a = b.getRGB(x, y) >>> 24;
                        if (!edge[y * w + x] || a == 255) continue;
                        int pp = blend(v.getRGB(x, y), prev.getRGB(x, y), a);
                        int pb = blend(v.getRGB(x, y), bgShot.getRGB(x, y), a);
                        int po = blend(v.getRGB(x, y), own.getRGB(x, y), a);
                        if (maxChannelDelta(po, pb) <= 2 * tol) continue;
                        if (i > 0 && (maxChannelDelta(pp, pb) <= 2 * tol || maxChannelDelta(pp, po) <= 2 * tol)) continue;
                        sep++;
                        int sv = s.getRGB(x, y);
                        int dp = i > 0 ? maxChannelDelta(sv, pp) : Integer.MAX_VALUE;
                        int db = maxChannelDelta(sv, pb), dq = maxChannelDelta(sv, po);
                        if (dq < db && dq < dp) nearOwn++;
                        else if (db < dq && db < dp) nearBg++;
                        else if (dp < db && dp < dq) nearPrev++;
                    }
                }
                System.out.println("[presentBg] 第 " + i + " 帧候选两两差出 " + (2 * tol) + " 的边像素：" + sep
                        + (sep == 0 ? "（判不出）" : "") + "；最近的是 上一帧屏幕 " + (i == 0 ? "-" : String.valueOf(nearPrev))
                        + "、内容面板底色 " + nearBg + "、替身自己的底色 " + nearOwn);
            }
        }
        for (int i = 1; i < frames; i++) {
            BufferedImage prev = read(new File(dir, String.format(Locale.ROOT, "screen-%03d.png", i - 1)));
            BufferedImage s = read(new File(dir, String.format(Locale.ROOT, "screen-%03d.png", i)));
            BufferedImage v = read(new File(dir, String.format(Locale.ROOT, "web-%03d.png", i)));
            BufferedImage b = read(new File(dir, String.format(Locale.ROOT, "buf-%03d.png", i)));
            int sep = 0, hitPrev = 0, hitBg = 0;
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int a = b.getRGB(x, y) >>> 24;
                    if (!edge[y * w + x] || a == 255) continue;
                    int pp = blend(v.getRGB(x, y), prev.getRGB(x, y), a);
                    int pb = blend(v.getRGB(x, y), bgShot.getRGB(x, y), a);
                    if (maxChannelDelta(pp, pb) <= 6 * tol) continue;
                    sep++;
                    if (maxChannelDelta(s.getRGB(x, y), pp) <= 3 * tol) hitPrev++;
                    if (maxChannelDelta(s.getRGB(x, y), pb) <= 3 * tol) hitBg++;
                }
            }
            System.out.println("第 " + i + " 帧两候选可分的边像素：" + sep + (sep == 0 ? "（判不出）" : "")
                    + "；命中 上一帧屏幕 " + hitPrev + "、底色 " + hitBg);
        }

        // 品红面板的截图里不是品红的像素：窗口圆角露出后面的东西，就落在这里。
        int ux = w, uy = h, ux1 = -1, uy1 = -1, notU = 0;
        // 基准取截图中心而不是 UNDERLAY：截图在显示器色彩空间里，UNDERLAY 的 sRGB 值对不上。
        int magenta = ci[0].getRGB(w / 2, h / 2);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                if (maxChannelDelta(ci[0].getRGB(x, y), magenta) <= tol) continue;
                notU++;
                ux = Math.min(ux, x); uy = Math.min(uy, y); ux1 = Math.max(ux1, x); uy1 = Math.max(uy1, y);
            }
        }
        System.out.println("品红面板截图里不是品红（以中心像素为准）的像素：" + notU
                + (notU == 0 ? "" : "，包围盒 (" + ux + "," + uy + ")-(" + ux1 + "," + uy1 + ")"));
        int drift = 0;
        BufferedImage again = read(new File(dir, "underlay-before-again.png"));
        // 前后两次截同一块面板，差出来的只可能是截图之外的东西（窗口后面在变）。
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) if (maxChannelDelta(ci[0].getRGB(x, y), again.getRGB(x, y)) > 0) drift++;
        System.out.println("同一块品红面板前后两次截图不同的像素：" + drift + "（截图本身稳不稳）");

        // 超容差的像素再按「缓冲在那里叠满没有」分：没叠满的才是本票要量的那笔，
        // 叠满了还差说明屏幕上多了别的东西（截图时机、系统覆盖物），不归缓冲。
        System.out.println("帧\t边上缓冲alpha<255\t未叠满处超容差\t其最大差\t已叠满处超容差\t其最大差\t已叠满处包围盒");
        for (int i = 0; i < frames; i++) {
            BufferedImage s = read(new File(dir, String.format(Locale.ROOT, "screen-%03d.png", i)));
            BufferedImage v = read(new File(dir, String.format(Locale.ROOT, "web-%03d.png", i)));
            BufferedImage b = read(new File(dir, String.format(Locale.ROOT, "buf-%03d.png", i)));
            int notFull = 0, over = 0, max = 0, fullOver = 0, fullMax = 0;
            int x0 = w, y0 = h, x1 = -1, y1 = -1;
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int dd = maxChannelDelta(s.getRGB(x, y), v.getRGB(x, y));
                    boolean full = (b.getRGB(x, y) >>> 24) == 255;
                    if (edge[y * w + x] && !full) notFull++;
                    if (!full) {
                        max = Math.max(max, dd);
                        if (dd > tol) over++;
                    } else {
                        fullMax = Math.max(fullMax, dd);
                        if (dd > tol) {
                            fullOver++;
                            x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
                        }
                    }
                }
            }
            String box = x1 < 0 ? "-" : "(" + x0 + "," + y0 + ")-(" + x1 + "," + y1 + ")";
            System.out.println(i + "\t" + notFull + "\t" + over + "\t" + max + "\t" + fullOver + "\t" + fullMax + "\t" + box);
        }
    }

    /** 非预乘 SrcOver 的逐通道近似：a/255 的 p 盖在 q 上。 */
    private static int blend(int p, int q, int a) {
        int r = 0xff000000;
        for (int s = 0; s <= 16; s += 8) {
            int c = (((p >> s) & 0xff) * a + ((q >> s) & 0xff) * (255 - a) + 127) / 255;
            r |= c << s;
        }
        return r;
    }

    private static BufferedImage read(File f) throws Exception {
        BufferedImage img = ImageIO.read(f);
        if (img == null) ExportTrace.die("读不了 " + f);
        return img;
    }

    private static int maxChannelDelta(int p, int q) {
        int m = 0;
        for (int s = 0; s <= 16; s += 8) m = Math.max(m, Math.abs(((p >> s) & 0xff) - ((q >> s) & 0xff)));
        return m;
    }
}
