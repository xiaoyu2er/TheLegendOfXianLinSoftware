package devtools;

import java.awt.AlphaComposite;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.Image;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import javax.imageio.ImageIO;

/**
 * 缩放采样黄金数据导出器：**目标的第 i 个像素取了源的第几个像素**，由真的
 * Java2D 跑出来，供 web 端那份复刻逐个对。
 *
 * <h2>为什么要这份数据</h2>
 *
 * 战斗里只有 {@code Reminder}（提示图）那一层是真的在缩放：源矩形恒为
 * (0,0)-(128,24)，目标矩形由 {@code Reminder.update()} 每拍朝两边张开。
 * 浏览器那边靠 GPU 的最近邻采样去顶，两者在**纹素边界上打平**的时候会分道扬镳
 * ——xl-rh9.12 实测 t=125 那一帧 1280 个像素里差 111 个，差异图上是一排周期 5
 * 的竖条。那正是 {@code 1.6i+0.8} 落在整数上的那几列。
 *
 * <h2>量出来的规律，以及一个不量就撞得上的坑</h2>
 *
 * <p>用一张「像素值就是自己的坐标」的梯度图跑全量扫描（源 128×24，目标
 * 1..256 × 1..48，五个不同落点各跑一遍），读回每个目标像素取的源坐标：
 *
 * <ul>
 *   <li>**采样与落点无关** —— 五个落点的表逐个相同。</li>
 *   <li>**不打平的位置一律是** {@code floor(k*i + k/2)}，{@code k = 源长/目标长}，
 *       与 GPU 的最近邻一致，一个不差。</li>
 *   <li>**打平的位置**（{@code k*i + k/2} 恰好是整数）两边都出现过。带透明那条
 *       循环里方向由目标长度整体定（Y=2 全上、Y=10 全下），不透明那条同一档里
 *       就会混（X=20 是 1 上 3 下）。所以它**不是**一条「平局一律向下」的规则，
 *       而是定点步进的截尾误差在起作用。</li>
 * </ul>
 *
 * <p>⚠️ **源图透不透明会换一条 blit 循环，两条循环的定点设置不一样。** 头一版
 * 这个导出器用的是全不透明的梯度图，导出来的表在 20×4 这一档上与真实画面差
 * 两个像素 —— 提示图的 22 张 PNG 全都带透明，走的是另一条。实测：把梯度图的
 * 一个像素挖成透明，X 的 3/7/9/11/12/20/21/31/33/48/56/60/63/77/93/99/116 与
 * Y 的 9/10 这 19 档的表当场变了，其余一档没动；而「挖成全透明」与「挖成半
 * 透明」两者的表**逐个相同**。所以这里两种形态各导一份：{@code transparent}
 * 是**移植该用的那一份**（提示图全部带透明，下面 {@code checkRemindersAreTransparent}
 * 逐张核过），{@code opaque} 导出来是为了让那句「两条循环不一样」是数据而不是
 * 一句转述。
 *
 * <p>各自拟合出来的定点模型（在整张表上逐个吻合，一处不差）：
 *
 * <pre>
 *   带透明：inc = (源长 &lt;&lt; 16) / 目标长，loc = inc / 2，      src(i) = (loc + i*inc) &gt;&gt; 16
 *   不透明：inc = (源长 &lt;&lt; 23) / 目标长，loc = (inc + 1) / 2，src(i) = (loc + i*inc) &gt;&gt; 23
 * </pre>
 *
 * <p>两个位数都是**搜**出来的，不是从 OpenJDK 源码里读出来的，别处未必成立。
 * 所以入库的是**这两张表**而不是这两个公式 —— web 端复刻的对错由表来判。
 *
 * <h2>这份数据自己的判据</h2>
 *
 * 「读不出来」不许成为通过条件，所以导出器自己先验五条，任一条不成立就当场
 * 退出码 1：
 *
 * <ol>
 *   <li>目标长 == 源长时必须是恒等映射；</li>
 *   <li>每个读回的像素必须是不透明的（梯度图除了那个记号像素全是不透明的，
 *       读到透明就说明这一笔根本没画上）；</li>
 *   <li>五个落点必须给出同一张表；</li>
 *   <li>**两条轴同时缩放**时的整块映射，必须等于两条轴各自 1:1 时量到的那两张
 *       表的外积 —— 逐轴扫出来的表能不能拿来拼二维，是量出来的，不是想当然；</li>
 *   <li>{@code image/提示图/} 下每一张 PNG 都必须带透明，否则 {@code transparent}
 *       那张表对它不成立。</li>
 * </ol>
 *
 * <p>用法：{@code java devtools.ExportScaledBlit [输出文件]}，见
 * {@code tools/export-scaled-blit.sh}。
 */
public class ExportScaledBlit {

    /** 提示图的源矩形：{@code Reminder} 构造函数里写死的 (0,0)-(128,24)。 */
    private static final int SRC_W = 128;
    private static final int SRC_H = 24;

    /** 扫到源长的两倍，放大那一半原版用不到，扫它是为了给 web 端的复刻多一层约束。 */
    private static final int MAX_DEST_W = SRC_W * 2;
    private static final int MAX_DEST_H = SRC_H * 2;

    /** 落点无关性的判据：这几个落点必须给出同一张表。 */
    private static final int[] ORIGINS = {0, 1, 7, 100, 511};

    /** 与 {@code BattlePanel} 的离屏位图同型同大。 */
    private static final int CANVAS_W = 1024;
    private static final int CANVAS_H = 640;

    /** 记号像素：把它挖掉，整张图就从「不透明」变成「带透明」。它自己永远不读。 */
    private static final int MARK_X = SRC_W - 1;
    private static final int MARK_Y = SRC_H - 1;

    /** 提示图那 22 张。`Reminder.loadImage()` 的循环上界。 */
    private static final int REMINDER_COUNT = 22;

    public static void main(String[] args) throws Exception {
        String out = args.length > 0 ? args[0] : "tools/scaled-blit-golden/java-scaled-blit.json";

        checkRemindersAreTransparent();

        File tmpDir = Files.createTempDirectory("xl-scaled-blit").toFile();
        Sweep transparent = sweepBoth(tmpDir, true);
        Sweep opaque = sweepBoth(tmpDir, false);
        deleteTree(tmpDir);

        File f = new File(out);
        if (f.getParentFile() != null) f.getParentFile().mkdirs();
        try (Writer w = new OutputStreamWriter(new FileOutputStream(f), StandardCharsets.UTF_8)) {
            w.write("{\n");
            w.write("  \"note\": " + Json.str(
                    "Java2D 缩放时目标第 i 个像素取的源坐标，由 devtools.ExportScaledBlit 用梯度图实测。"
                    + " transparent = 源图带透明（提示图那 22 张都是，移植该用这一份）；"
                    + " opaque = 源图全不透明，走的是另一条 blit 循环。"
                    + " 每个 map[destLen] 是长度为 destLen 的表；下标 0 是占位的空表。") + ",\n");
            writeSweep(w, "transparent", transparent);
            w.write(",\n");
            writeSweep(w, "opaque", opaque);
            w.write("\n}\n");
        }
        System.out.println("已写出 " + out + "：两种形态 × (X 目标长 1.." + MAX_DEST_W
                + "，Y 目标长 1.." + MAX_DEST_H + ")，" + Files.size(f.toPath()) + " 字节");
    }

    private static void writeSweep(Writer w, String name, Sweep s) throws Exception {
        w.write("  " + Json.str(name) + ": {\n");
        w.write("    \"x\": { \"srcLen\": " + SRC_W + ", \"map\": " + Json.grid(s.x) + " },\n");
        w.write("    \"y\": { \"srcLen\": " + SRC_H + ", \"map\": " + Json.grid(s.y) + " }\n");
        w.write("  }");
    }

    private static final class Sweep {
        final int[][] x;
        final int[][] y;
        Sweep(int[][] x, int[][] y) {
            this.x = x;
            this.y = y;
        }
    }

    /**
     * `image/提示图/` 下每一张都必须带透明。
     *
     * 不带透明的那一张会走另一条 blit 循环，{@code transparent} 这张表对它就是
     * 错的 —— 而错法是"某一档差一两个像素"，谁都不会去查。
     */
    private static void checkRemindersAreTransparent() throws Exception {
        for (int i = 1; i <= REMINDER_COUNT; i++) {
            File png = new File("image/提示图/" + i + ".png");
            if (!png.isFile()) fail("提示图缺失：" + png.getPath());
            BufferedImage img = ImageIO.read(png);
            if (img == null) fail("读不出这张 PNG：" + png.getPath());
            int minAlpha = 255;
            for (int y = 0; y < img.getHeight(); y++) {
                for (int x = 0; x < img.getWidth(); x++) {
                    minAlpha = Math.min(minAlpha, (img.getRGB(x, y) >>> 24) & 0xFF);
                }
            }
            if (minAlpha == 255) {
                fail(png.getPath() + " 是全不透明的，它走的是 opaque 那条 blit 循环，"
                        + "transparent 那张表对它不成立");
            }
        }
    }

    /** 一种透明度形态的两条轴。 */
    private static Sweep sweepBoth(File dir, boolean withAlpha) throws Exception {
        File png = new File(dir, (withAlpha ? "transparent" : "opaque") + ".png");
        writeGradient(png, withAlpha);
        // 走原版读图的那条路（ImageIcon -> Toolkit Image），不是 ImageIO 的
        // BufferedImage —— 两者在 Java2D 里未必落到同一条 blit 循环上。
        Image img = tools.Reader.readImage(png.getPath());

        int[][] x = sweep(img, true);
        int[][] y = sweep(img, false);
        checkTwoAxes(img, x, y);
        return new Sweep(x, y);
    }

    /**
     * 像素值就是自己的坐标：红 = x（0..127），绿 = y（0..23）。
     *
     * {@code withAlpha} 时把 {@link #MARK_X}/{@link #MARK_Y} 那一个像素挖成全透明
     * —— 内容几乎没变，但整张图的透明度形态变了，Java2D 换一条 blit 循环。
     * （实测「挖成全透明」与「挖成半透明」导出来的两张表逐个相同，所以取前者：
     * 全透明的像素读回来是"alpha=0"，一眼看得出是记号，不会被当成数据。）
     */
    private static void writeGradient(File png, boolean withAlpha) throws Exception {
        BufferedImage src = new BufferedImage(SRC_W, SRC_H, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < SRC_H; y++) {
            for (int x = 0; x < SRC_W; x++) {
                src.setRGB(x, y, 0xFF000000 | (x << 16) | (y << 8));
            }
        }
        if (withAlpha) src.setRGB(MARK_X, MARK_Y, 0x00000000);
        ImageIO.write(src, "png", png);
    }

    /**
     * 扫一条轴：目标长 1..max，每个长度得到一张「目标下标 -> 源下标」的表。
     *
     * <p>另一条轴固定为源长（1:1），于是它不参与缩放，读哪一行/哪一列都一样。
     * 「两条轴同时缩放时也是这两张表」由 {@link #checkTwoAxes} 单独核。
     */
    private static int[][] sweep(Image img, boolean horizontal) {
        int max = horizontal ? MAX_DEST_W : MAX_DEST_H;
        int[][] maps = new int[max + 1][];
        maps[0] = new int[0];

        BufferedImage canvas = new BufferedImage(CANVAS_W, CANVAS_H, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = (Graphics2D) canvas.getGraphics();

        for (int destLen = 1; destLen <= max; destLen++) {
            int[] first = null;
            for (int origin : ORIGINS) {
                int[] got = blitAndRead(g, canvas, img, horizontal, destLen, origin);
                if (first == null) {
                    first = got;
                } else if (!java.util.Arrays.equals(first, got)) {
                    fail("落点相关：" + (horizontal ? "X" : "Y") + " 目标长 " + destLen
                            + " 在落点 " + ORIGINS[0] + " 与 " + origin + " 上给出了两张不同的表\n"
                            + "  " + java.util.Arrays.toString(first) + "\n"
                            + "  " + java.util.Arrays.toString(got));
                }
            }
            maps[destLen] = first;
        }

        // 恒等判据：目标长 == 源长时必须一个不差地取到自己。整张表读成 0
        // （比如根本没画上）在这里就会响。
        int srcLen = horizontal ? SRC_W : SRC_H;
        int[] identity = maps[srcLen];
        for (int i = 0; i < srcLen; i++) {
            if (identity[i] != i) {
                fail("恒等判据不成立：" + (horizontal ? "X" : "Y") + " 目标长 = 源长 = " + srcLen
                        + " 时第 " + i + " 个取到了源的 " + identity[i] + "，应为 " + i);
            }
        }
        return maps;
    }

    /**
     * 两条轴同时缩放时，整块的映射必须等于两张一维表的外积。
     *
     * 逐轴扫出来的表能不能拿来拼二维，是**量出来的**：一维扫的时候另一条轴是
     * 1:1，而定点步进的位数万一是按两条轴一起定的，一维表就拼不出二维。
     * 这里挑提示图真的会走过的那 12 档（`Reminder.update()` 每拍宽 +10 高 +2）。
     */
    private static void checkTwoAxes(Image img, int[][] xMap, int[][] yMap) {
        BufferedImage canvas = new BufferedImage(CANVAS_W, CANVAS_H, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = (Graphics2D) canvas.getGraphics();
        int ox = 490;
        int oy = 118;
        for (int n = 1; n <= 12; n++) {
            int dw = 10 * n;
            int dh = 2 * n;
            g.setComposite(AlphaComposite.Src);
            g.setColor(new Color(0, 0, 0, 0));
            g.fillRect(0, 0, CANVAS_W, CANVAS_H);
            g.setComposite(AlphaComposite.SrcOver);
            g.drawImage(img, ox, oy, ox + dw, oy + dh, 0, 0, SRC_W, SRC_H, null);
            for (int j = 0; j < dh; j++) {
                for (int i = 0; i < dw; i++) {
                    int wantX = xMap[dw][i];
                    int wantY = yMap[dh][j];
                    // 记号像素本身是透明的，读它读到的是背景，跳过。
                    if (wantX == MARK_X && wantY == MARK_Y) continue;
                    int argb = canvas.getRGB(ox + i, oy + j);
                    int gotX = (argb >> 16) & 0xFF;
                    int gotY = (argb >> 8) & 0xFF;
                    if (gotX != wantX || gotY != wantY) {
                        fail("两条轴同时缩放时拼不出一维表：目标 " + dw + "×" + dh
                                + " 的 (" + i + "," + j + ") 取到了源 (" + gotX + "," + gotY
                                + ")，两张一维表说的是 (" + wantX + "," + wantY + ")");
                    }
                }
            }
        }
    }

    /** 画一次，读回目标那一行（或那一列）每个像素的源坐标。 */
    private static int[] blitAndRead(
            Graphics2D g, BufferedImage canvas, Image img,
            boolean horizontal, int destLen, int origin) {
        int dw = horizontal ? destLen : SRC_W;
        int dh = horizontal ? SRC_H : destLen;
        int ox = origin;
        int oy = origin % 37;

        // 先擦成透明（Src 覆盖，不是 SrcOver 混合），再画。留着上一轮的像素
        // 会让「这一笔没画上」读成上一轮的表。
        g.setComposite(AlphaComposite.Src);
        g.setColor(new Color(0, 0, 0, 0));
        g.fillRect(0, 0, CANVAS_W, CANVAS_H);
        g.setComposite(AlphaComposite.SrcOver);
        g.drawImage(img, ox, oy, ox + dw, oy + dh, 0, 0, SRC_W, SRC_H, null);

        int[] map = new int[destLen];
        for (int i = 0; i < destLen; i++) {
            // 横扫读目标第一行（源第 0 行），竖扫读目标第一列（源第 0 列）：
            // 两者都躲开了右下角那个记号像素。
            int px = horizontal ? ox + i : ox;
            int py = horizontal ? oy : oy + i;
            int argb = canvas.getRGB(px, py);
            if (((argb >>> 24) & 0xFF) != 0xFF) {
                fail("读回的像素是透明的：" + (horizontal ? "X" : "Y") + " 目标长 " + destLen
                        + " 落点 " + origin + " 的第 " + i + " 个 —— 梯度图除了右下角那个记号"
                        + "全是不透明的，读到透明说明这一笔根本没画上（图没载入？）");
            }
            map[i] = horizontal ? ((argb >> 16) & 0xFF) : ((argb >> 8) & 0xFF);
            int srcLen = horizontal ? SRC_W : SRC_H;
            if (map[i] < 0 || map[i] >= srcLen) {
                fail("读回的源坐标越界：" + map[i] + " 不在 0.." + (srcLen - 1));
            }
        }
        return map;
    }

    private static void deleteTree(File dir) {
        File[] kids = dir.listFiles();
        if (kids != null) for (File k : kids) k.delete();
        dir.delete();
    }

    private static void fail(String message) {
        System.err.println("[ExportScaledBlit] " + message);
        System.exit(1);
    }
}
