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
 * 而且两者被数据钉住的程度不一样：不透明那条 1..31 里**只有 23** 配「半步向上」
 * 吻合；带透明那条 **16..31 任何一个**配「半步截尾」都吻合（表在 16 位上就稳定
 * 了）。所以入库的是**这两张表**而不是这两个公式 —— web 端复刻的对错由表来判。
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
        int[][] narratage = sweepNarratage(tmpDir);
        String thumbnail = sweepThumbnails(tmpDir);
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
            w.write(",\n");
            w.write("  \"narratage\": {\n");
            w.write("    \"x\": { \"srcLen\": " + NARR_SRC_W + ", \"destLen\": " + NARR_DEST_W
                    + ", \"map\": " + flat(narratage[0]) + " },\n");
            w.write("    \"y\": { \"srcLen\": " + NARR_SRC_H + ", \"destLen\": " + NARR_DEST_H
                    + ", \"map\": " + flat(narratage[1]) + " }\n");
            w.write("  },\n");
            w.write(thumbnail);
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

    /**
     * 旁白背景那一句（xl-03x.15）：{@code Narratage.drawNarratage} 的
     * {@code drawImage(img, 0,0,1024,640, 0,0,639,395, scene)}，GBK 源码现读。
     */
    private static final int NARR_SRC_W = 639;
    private static final int NARR_SRC_H = 395;
    private static final int NARR_DEST_W = 1024;
    private static final int NARR_DEST_H = 640;
    /** {@code Narratage} 构造函数里那条循环：{@code for (int i = 2; i <= 53; i++)}。 */
    private static final int NARR_FIRST = 2;
    private static final int NARR_LAST = 53;
    private static final String NARR_DIR = "backImages/NarratageBackImages/";

    /**
     * 旁白背景拉满画布时两条轴的采样表，**照原版那一句真画一遍读回**。
     *
     * <p>两轴扫描的源长只有 128 / 24，这一对 (639→1024, 395→640) 在它们之外，
     * 所以单独量，不外推。做法与 {@link #sweepBoth} 同一招，但几何换成原版的：
     *
     * <ul>
     *   <li>梯度图与原版 52 张**同一种 PNG**：639×395、RGB 无 alpha（不透明那条
     *       循环）。每个像素编码自己的坐标（x、y 各 10 位，拆进三个通道）。</li>
     *   <li>走 {@code tools.Reader.readImage}，画到与 {@code ScenePanel.backImage}
     *       同型的 {@code TYPE_INT_ARGB} 1024×640 上，调用逐字照抄。</li>
     * </ul>
     *
     * <p>四条判据，任一条不成立退出码 1：
     * <ol>
     *   <li>原版 52 张全是 639×395、全不透明（否则这张表对它们不成立）；</li>
     *   <li>每个读回的像素都不透明（没画上会读成透明）；</li>
     *   <li>整块映射可分离：每一行的 x 都等于第 0 行、每一列的 y 都等于第 0 列；</li>
     *   <li>**拿真图核**：原版那一句画每一张真图，结果逐像素等于「两张表的外积
     *       搬原图像素」。表是梯度图量的，这一条证它对真图也成立。</li>
     * </ol>
     *
     * @return {@code [x 表, y 表]}
     */
    private static int[][] sweepNarratage(File dir) throws Exception {
        for (int k = NARR_FIRST; k <= NARR_LAST; k++) {
            File f = narratageFile(k);
            BufferedImage raw = ImageIO.read(f);
            if (raw == null) fail("读不出旁白背景图：" + f.getPath());
            if (raw.getWidth() != NARR_SRC_W || raw.getHeight() != NARR_SRC_H) {
                fail(f.getPath() + " 是 " + raw.getWidth() + "×" + raw.getHeight()
                        + "，不是原版源矩形的 " + NARR_SRC_W + "×" + NARR_SRC_H);
            }
            if (raw.getColorModel().hasAlpha()) {
                fail(f.getPath() + " 带 alpha 通道，它未必走不透明那条 blit 循环");
            }
        }

        BufferedImage src = new BufferedImage(NARR_SRC_W, NARR_SRC_H, BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < NARR_SRC_H; y++) {
            for (int x = 0; x < NARR_SRC_W; x++) {
                src.setRGB(x, y, ((x & 0xFF) << 16) | ((y & 0xFF) << 8) | (x >> 8) | ((y >> 8) << 4));
            }
        }
        File png = new File(dir, "narratage.png");
        ImageIO.write(src, "png", png);
        BufferedImage canvas = drawLikeNarratage(tools.Reader.readImage(png.getPath()));

        int[] mx = new int[NARR_DEST_W];
        int[] my = new int[NARR_DEST_H];
        for (int j = 0; j < NARR_DEST_H; j++) {
            for (int i = 0; i < NARR_DEST_W; i++) {
                int argb = canvas.getRGB(i, j);
                if ((argb >>> 24) != 0xFF) {
                    fail("旁白梯度图读回透明像素 (" + i + "," + j + ")：这一笔根本没画上");
                }
                int x = ((argb >> 16) & 0xFF) | ((argb & 0x0F) << 8);
                int y = ((argb >> 8) & 0xFF) | (((argb >> 4) & 0x0F) << 8);
                if (x >= NARR_SRC_W || y >= NARR_SRC_H) {
                    fail("旁白梯度图读回的源坐标越界：(" + x + "," + y + ")");
                }
                if (j == 0) mx[i] = x;
                if (i == 0) my[j] = y;
                if (x != mx[i] || y != my[j]) {
                    fail("旁白缩放不可分离：(" + i + "," + j + ") 取到源 (" + x + "," + y
                            + ")，两张一维表说的是 (" + mx[i] + "," + my[j] + ")");
                }
            }
        }

        for (int k = NARR_FIRST; k <= NARR_LAST; k++) {
            File f = narratageFile(k);
            BufferedImage raw = ImageIO.read(f);
            BufferedImage drawn = drawLikeNarratage(tools.Reader.readImage(f.getPath()));
            for (int j = 0; j < NARR_DEST_H; j++) {
                for (int i = 0; i < NARR_DEST_W; i++) {
                    int want = raw.getRGB(mx[i], my[j]);
                    int got = drawn.getRGB(i, j);
                    if (got != want) {
                        fail(f.getPath() + " 的 (" + i + "," + j + ") 画出来是 "
                                + Integer.toHexString(got) + "，两张表的外积说的是源 ("
                                + mx[i] + "," + my[j] + ") 的 " + Integer.toHexString(want));
                    }
                }
            }
        }
        return new int[][] {mx, my};
    }

    /** 第 k 张旁白背景（{@code Narratage} 构造函数里的拼法）。 */
    private static File narratageFile(int k) {
        return new File(NARR_DIR + "all_magic_21-" + k + ".png");
    }

    /** 原版那一句，逐字照抄，画到与 {@code ScenePanel.backImage} 同型的位图上。 */
    private static BufferedImage drawLikeNarratage(Image img) {
        BufferedImage canvas = new BufferedImage(NARR_DEST_W, NARR_DEST_H, BufferedImage.TYPE_INT_ARGB);
        canvas.getGraphics().drawImage(img, 0, 0, 1024, 640, 0, 0, 639, 395, null);
        return canvas;
    }

    // ------------------------------------------------------------------
    // 存读档缩略图（xl-cpo）
    // ------------------------------------------------------------------

    /**
     * {@code LoadAndSavePanel.paint()} 那一句（GBK 源码现读）：
     * {@code backgroundGraphics.drawImage(Reader.readImage("maps/" + maps.get(i)), 100, 100 + i*200, 150, 100, this)}，
     * 画在 {@code new BufferedImage(1024, 640, TYPE_INT_ARGB)} 上。
     */
    private static final int THUMB_X = 100;
    private static final int THUMB_Y0 = 100;
    private static final int THUMB_STRIDE = 200;
    private static final int THUMB_W = 150;
    private static final int THUMB_H = 100;
    private static final int THUMB_SLOTS = 3;
    private static final String MAPS_DIR = "maps/";

    /**
     * 缩略图的采样表与「每张地图走哪条循环」，**照原版那一句真画一遍读回**。
     *
     * <p>两轴扫描（源 128 / 24）与旁白那一对都是放大；这里是大幅缩小（3200→150 即
     * 1/21.3），在它们之外，所以不外推，按原版的几何单独量：
     *
     * <ul>
     *   <li>{@code maps/} 下每一种出现过的尺寸，各做两张梯度图：带透明（右下角那个像素挖成
     *       全透明，TYPE_INT_ARGB）与全不透明（TYPE_INT_RGB，与 JPEG / RGB PNG 同形）。
     *       像素编码自己的坐标（x、y 各 12 位，拆进三个通道）。</li>
     *   <li>走 {@code tools.Reader.readImage}，照原版那句画在三个槽的落点上，读回 150×100。</li>
     *   <li>**每张真地图**也照原版那句画一遍，拿它去对两张表各自预言的像素：只对上其中一张，
     *       那就是它走的循环 —— 这是**跑出来**的，不是按「带不带 alpha」推的。</li>
     * </ul>
     *
     * <p>判据，任一条不成立退出码 1：
     * <ol>
     *   <li>梯度图每个读回的像素不透明（记号像素除外）、坐标不越界；</li>
     *   <li>整块可分离：每一行的 x 等于第 0 行、每一列的 y 等于第 0 列；</li>
     *   <li>三个槽的落点给出同一张表；</li>
     *   <li>每张真地图至少对上一张表（在源像素全不透明的那些位置上逐像素比；半透明的
     *       位置经过 SrcOver 混合，读回值不是源值，跳过，并记下比了几个）。</li>
     * </ol>
     *
     * @return JSON 片段，{@code "thumbnail": {...}}，两格缩进
     */
    private static String sweepThumbnails(File dir) throws Exception {
        File[] files = new File(MAPS_DIR).listFiles(File::isFile);
        if (files == null || files.length == 0) fail("maps/ 下一张图都没有：从仓库根目录跑");
        java.util.Arrays.sort(files, (a, b) -> a.getName().compareTo(b.getName()));

        // 尺寸 -> [带透明的 x 表, y 表, 不透明的 x 表, y 表]
        java.util.TreeMap<String, int[][]> tables = new java.util.TreeMap<>();
        java.util.List<int[]> sizes = new java.util.ArrayList<>();
        for (File f : files) {
            BufferedImage raw = ImageIO.read(f);
            if (raw == null) fail("读不出这张地图：" + f.getPath());
            String key = sizeKey(raw.getWidth(), raw.getHeight());
            if (tables.containsKey(key)) continue;
            int w = raw.getWidth();
            int h = raw.getHeight();
            int[][] t = thumbTables(dir, w, h, true);
            int[][] o = thumbTables(dir, w, h, false);
            tables.put(key, new int[][] {t[0], t[1], o[0], o[1]});
            sizes.add(new int[] {w, h});
        }

        StringBuilder mapsJson = new StringBuilder();
        for (File f : files) {
            BufferedImage raw = ImageIO.read(f);
            int w = raw.getWidth();
            int h = raw.getHeight();
            int minAlpha = 255;
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) minAlpha = Math.min(minAlpha, raw.getRGB(x, y) >>> 24);
            }
            Image img = tools.Reader.readImage(f.getPath());
            if (img.getWidth(null) != w || img.getHeight(null) != h) {
                fail(f.getPath() + " 经 Reader.readImage 读成 " + img.getWidth(null) + "×"
                        + img.getHeight(null) + "，ImageIO 读的是 " + w + "×" + h);
            }
            // 源像素取「原版读图那条路 1:1 画出来的」，不取 ImageIO 解的 —— 两个 JPEG 解码器
            // 未必逐字节相同，比的应当是同一份解码。
            BufferedImage src = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
            src.getGraphics().drawImage(img, 0, 0, null);
            // 第一问：画在缩略图那 150×100 上，对上哪张表。
            int[][] t = tables.get(sizeKey(w, h));
            Verdict atThumb = verdict(f, src, drawScaled(img, THUMB_X, THUMB_Y0, THUMB_W, THUMB_H),
                    THUMB_X, THUMB_Y0, t);

            // 第二问：两张表在 150×100 上多半逐个相同（缩小时平局少），那样第一问答不出走哪条
            // 循环。挑一个两条循环真的不同的尺寸，把同一张图画上去再问一次。尺寸是按两个拟合
            // 公式挑的，但两张表是梯度图在那个尺寸上**现量**的，挑错了（两张表其实相同）就响。
            int[] probe = null;
            Verdict atProbe = null;
            int[][] origin = {{PROBE_ORIGIN, PROBE_ORIGIN}};
            for (int[] candidate : probeCandidates(w, h)) {
                int[][] pt = measureTables(dir, w, h, true, candidate[0], candidate[1], origin);
                int[][] po = measureTables(dir, w, h, false, candidate[0], candidate[1], origin);
                if (java.util.Arrays.equals(pt[0], po[0]) && java.util.Arrays.equals(pt[1], po[1])) continue;
                Verdict v = verdict(f, src, drawScaled(img, PROBE_ORIGIN, PROBE_ORIGIN, candidate[0], candidate[1]),
                        PROBE_ORIGIN, PROBE_ORIGIN, new int[][] {pt[0], pt[1], po[0], po[1]});
                // 两张表不同、但不同的那几格恰好取到半透明像素：这一问仍答不出，换下一个。
                if (v.distinguishing == 0) continue;
                probe = candidate;
                atProbe = v;
                break;
            }
            // 两问都分得出来时必须一致；最终取分得出来的那一问。
            String loop = atThumb.loop;
            if (atProbe != null && !atProbe.loop.equals("either") && !atProbe.loop.equals("unknown")) {
                if ((loop.equals("transparent") || loop.equals("opaque")) && !loop.equals(atProbe.loop)) {
                    fail(f.getPath() + " 在缩略图上走 " + loop + "、在探针上走 " + atProbe.loop);
                }
                loop = atProbe.loop;
            }
            if (mapsJson.length() > 0) mapsJson.append(",\n");
            mapsJson.append("      { \"name\": ").append(Json.str(f.getName()))
                    .append(", \"width\": ").append(w).append(", \"height\": ").append(h)
                    .append(", \"alphaChannel\": ").append(raw.getColorModel().hasAlpha())
                    .append(", \"minAlpha\": ").append(minAlpha)
                    .append(", \"loop\": ").append(Json.str(loop))
                    .append(",\n        \"atThumbnail\": ").append(atThumb.json())
                    .append(",\n        \"atProbe\": ")
                    .append(atProbe == null ? "null" : atProbe.json(probe[0], probe[1])).append(" }");
        }

        StringBuilder sb = new StringBuilder();
        sb.append("  \"thumbnail\": {\n");
        sb.append("    \"dest\": { \"x\": ").append(THUMB_X).append(", \"y0\": ").append(THUMB_Y0)
                .append(", \"stride\": ").append(THUMB_STRIDE).append(", \"width\": ").append(THUMB_W)
                .append(", \"height\": ").append(THUMB_H).append(" },\n");
        sb.append("    \"sizes\": [\n");
        for (int k = 0; k < sizes.size(); k++) {
            int w = sizes.get(k)[0];
            int h = sizes.get(k)[1];
            int[][] t = tables.get(sizeKey(w, h));
            sb.append("      { \"width\": ").append(w).append(", \"height\": ").append(h)
                    .append(",\n        \"transparent\": { \"x\": ").append(flat(t[0]))
                    .append(", \"y\": ").append(flat(t[1])).append(" },\n")
                    .append("        \"opaque\": { \"x\": ").append(flat(t[2]))
                    .append(", \"y\": ").append(flat(t[3])).append(" } }")
                    .append(k + 1 < sizes.size() ? ",\n" : "\n");
        }
        sb.append("    ],\n");

        int[][] origin = {{THUMB_X, THUMB_Y0}};
        sb.append("    \"sweeps\": [\n");
        for (int k = 0; k < SWEEP_SIZES.length; k++) {
            int w = SWEEP_SIZES[k][0];
            int h = SWEEP_SIZES[k][1];
            sb.append("      { \"width\": ").append(w).append(", \"height\": ").append(h);
            for (boolean alpha : new boolean[] {true, false}) {
                int[][] xs = new int[THUMB_W + 1][];
                int[][] ys = new int[THUMB_H + 1][];
                xs[0] = new int[0];
                ys[0] = new int[0];
                for (int d = 1; d <= THUMB_W; d++) xs[d] = measureTables(dir, w, h, alpha, d, THUMB_H, origin)[0];
                for (int d = 1; d <= THUMB_H; d++) ys[d] = measureTables(dir, w, h, alpha, THUMB_W, d, origin)[1];
                sb.append(",\n        ").append(Json.str(alpha ? "transparent" : "opaque"))
                        .append(": { \"x\": ").append(Json.grid(xs)).append(", \"y\": ").append(Json.grid(ys)).append(" }");
            }
            sb.append(" }").append(k + 1 < SWEEP_SIZES.length ? ",\n" : "\n");
        }
        sb.append("    ],\n");

        int[][] probeOrigin = {{PROBE_ORIGIN, PROBE_ORIGIN}};
        sb.append("    \"checks\": [\n");
        for (int k = 0; k < CHECKS.length; k++) {
            int[] c = CHECKS[k];
            int[][] t = measureTables(dir, c[0], c[1], true, c[2], c[3], probeOrigin);
            int[][] o = measureTables(dir, c[0], c[1], false, c[2], c[3], probeOrigin);
            sb.append("      { \"width\": ").append(c[0]).append(", \"height\": ").append(c[1])
                    .append(", \"destWidth\": ").append(c[2]).append(", \"destHeight\": ").append(c[3])
                    .append(",\n        \"transparent\": { \"x\": ").append(flat(t[0])).append(", \"y\": ").append(flat(t[1]))
                    .append(" },\n        \"opaque\": { \"x\": ").append(flat(o[0])).append(", \"y\": ").append(flat(o[1]))
                    .append(" } }").append(k + 1 < CHECKS.length ? ",\n" : "\n");
        }
        sb.append("    ],\n");

        sb.append("    \"maps\": [\n").append(mapsJson).append("\n    ]\n");
        sb.append("  }");
        return sb.toString();
    }

    /** 探针画在这个落点上。目标比 1024×640 大时画布跟着放大（{@link #drawScaled}）。 */
    private static final int PROBE_ORIGIN = 8;

    /**
     * 缩小区间的扫描：三个入库样例槽的源图尺寸（大地图.jpg / 宿舍.png / 大迷宫.png，
     * web 端测试拿 {@code tools/ground-truth/存档/} 对撞），横轴目标宽 1..150、纵轴目标高
     * 1..100，两条循环各一批。
     */
    private static final int[][] SWEEP_SIZES = {{3200, 2560}, {1024, 640}, {2865, 699}};

    /**
     * 单独量的几对 {@code {源宽, 源高, 目标宽, 目标高}}。2865×699 → 233×253 是旧的「带透明
     * 16 位」公式在缩小区间里第一个对不上的地方（横 233、纵 253 都是），扫描范围之外，单列。
     */
    private static final int[][] CHECKS = {{2865, 699, 233, 253}};

    /** 一张真图画出来，与两张表各自预言的像素比的结果。 */
    private static final class Verdict {
        final int compared;
        final int distinguishing;
        final String loop;
        Verdict(int compared, int distinguishing, String loop) {
            this.compared = compared;
            this.distinguishing = distinguishing;
            this.loop = loop;
        }
        String json() {
            return "{ \"loop\": " + Json.str(loop) + ", \"compared\": " + compared
                    + ", \"distinguishing\": " + distinguishing + " }";
        }
        String json(int dw, int dh) {
            return "{ \"width\": " + dw + ", \"height\": " + dh + ", \"loop\": " + Json.str(loop)
                    + ", \"compared\": " + compared + ", \"distinguishing\": " + distinguishing + " }";
        }
    }

    /**
     * 真图画在 (ox, oy) 起的那一块，逐像素对两张表的预言。{@code t} 是
     * {@code [带透明 x, 带透明 y, 不透明 x, 不透明 y]}。
     *
     * <p>只比两张表取到的源像素都全不透明的那些格：半透明的经过 SrcOver 混合，读回来的
     * 不是源值。{@code distinguishing} 是其中两张表预言不同的格数 —— 它是 0 时「对上了」
     * 两张都成立，答不出走哪条循环，记成 {@code either}，不猜。
     *
     * <p>一个都比不了（maps/无.png 整张全透明）记成 {@code unknown}。它不是任何场景的地图
     * （空槽读的是没有扩展名的 {@code "maps/无"}，找不到文件）；web 侧的判据只要求场景地图
     * 全部分得出来。两张都对不上就退出码 1。
     */
    private static Verdict verdict(File f, BufferedImage src, BufferedImage canvas, int ox, int oy, int[][] t) {
        int compared = 0;
        int distinguishing = 0;
        int missT = 0;
        int missO = 0;
        for (int j = 0; j < t[1].length; j++) {
            for (int i = 0; i < t[0].length; i++) {
                int pt = src.getRGB(t[0][i], t[1][j]);
                int po = src.getRGB(t[2][i], t[3][j]);
                if ((pt >>> 24) != 0xFF || (po >>> 24) != 0xFF) continue;
                compared++;
                if (pt != po) distinguishing++;
                int got = canvas.getRGB(ox + i, oy + j);
                if (got != pt) missT++;
                if (got != po) missO++;
            }
        }
        if (compared == 0) return new Verdict(0, 0, "unknown");
        if (missT == 0 && missO == 0) return new Verdict(compared, distinguishing, "either");
        if (missT == 0) return new Verdict(compared, distinguishing, "transparent");
        if (missO == 0) return new Verdict(compared, distinguishing, "opaque");
        fail(f.getPath() + " 画成 " + t[0].length + "×" + t[1].length + " 时两张表都对不上：带透明那张差 "
                + missT + " 个、不透明那张差 " + missO + " 个（比了 " + compared + " 个）");
        return null;
    }

    /** 每条轴最多试几个候选。 */
    private static final int PROBE_TRIES = 8;

    /**
     * 探针的候选尺寸 {@code [dw, dh]}：按两个拟合公式，横轴上预言会不同的最小几个目标宽
     * （纵轴取缩略图的 100），再是纵轴上的（横轴取 150）。
     *
     * <p>公式只用来**排候选**，不用来下结论：两张表由梯度图在候选尺寸上现量，量出来相同
     * 的候选直接跳过（{@link #sweepThumbnails}）。这一步实测撞过两次公式说错 —— 81×73 →
     * 203×235（放大两倍多）与 2865×699 → 233×253（那一次用的是旧的「带透明 16 位」公式，
     * 正是它在那里对不上，才有了现在两条循环共用位数的写法）。所以候选不止一个。
     *
     * <p>目标长不超过源长的两倍（两轴扫描量过的放大倍率）。挑不出候选就记 {@code either}：
     * 1023×639（教室2.png）在这个范围里两个公式处处相同，它走哪条循环是**看不出来的**，
     * 而看不出来也就意味着画出来一样。
     */
    private static java.util.List<int[]> probeCandidates(int w, int h) {
        int shift = blitShift(w, h);
        java.util.List<int[]> out = new java.util.ArrayList<>();
        for (int d : differing(w, shift)) out.add(new int[] {d, THUMB_H});
        for (int d : differing(h, shift)) out.add(new int[] {THUMB_W, d});
        return out;
    }

    /** 两个拟合公式（同一个位数，只差半步向下 / 向上取整）预言会不同的目标长。 */
    private static java.util.List<Integer> differing(int srcLen, int shift) {
        java.util.List<Integer> out = new java.util.ArrayList<>();
        for (int d = 2; d <= 2 * srcLen && out.size() < PROBE_TRIES; d++) {
            long inc = ((long) srcLen << shift) / d;
            long locT = inc / 2;
            long locO = (inc + 1) / 2;
            for (int i = 0; i < d; i++) {
                if (((locT + i * inc) >> shift) != ((locO + i * inc) >> shift)) {
                    out.add(d);
                    break;
                }
            }
        }
        return out;
    }

    /**
     * 两条循环共用的定点位数：{@code 31 - bitLength(源宽 | 源高)}。拟合出来的，判据是
     * 这份黄金数据本身（web 端 scaledBlit.test.ts 逐张核），不是 OpenJDK 源码。
     */
    private static int blitShift(int w, int h) {
        return 31 - (32 - Integer.numberOfLeadingZeros(w | h));
    }

    private static String sizeKey(int w, int h) {
        return String.format("%05dx%05d", w, h);
    }

    /** 梯度图按 (尺寸, 形态) 只写一次、只读一次。 */
    private static final java.util.Map<String, Image> GRADIENTS = new java.util.HashMap<>();

    private static Image gradient(File dir, int w, int h, boolean withAlpha) throws Exception {
        String key = sizeKey(w, h) + (withAlpha ? "-alpha" : "-opaque");
        Image hit = GRADIENTS.get(key);
        if (hit != null) return hit;
        BufferedImage g = new BufferedImage(w, h,
                withAlpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                g.setRGB(x, y, 0xFF000000 | ((x & 0xFF) << 16) | ((y & 0xFF) << 8)
                        | (x >> 8) | ((y >> 8) << 4));
            }
        }
        if (withAlpha) g.setRGB(w - 1, h - 1, 0x00000000);
        File png = new File(dir, "thumb-" + key + ".png");
        ImageIO.write(g, "png", png);
        Image img = tools.Reader.readImage(png.getPath());
        GRADIENTS.put(key, img);
        return img;
    }

    /** 一种尺寸、一种透明度形态、画到缩略图那 150×100 上的两张表：{@code [x 表, y 表]}。 */
    private static int[][] thumbTables(File dir, int w, int h, boolean withAlpha) throws Exception {
        int[][] origins = new int[THUMB_SLOTS][];
        for (int slot = 0; slot < THUMB_SLOTS; slot++) {
            origins[slot] = new int[] {THUMB_X, THUMB_Y0 + slot * THUMB_STRIDE};
        }
        return measureTables(dir, w, h, withAlpha, THUMB_W, THUMB_H, origins);
    }

    /**
     * 梯度图画成 dw×dh，在每个落点上各画一遍读回两张表；落点之间必须给出同一张表。
     */
    private static int[][] measureTables(
            File dir, int w, int h, boolean withAlpha, int dw, int dh, int[][] origins) throws Exception {
        Image img = gradient(dir, w, h, withAlpha);

        int[] first = null;
        int[] firstY = null;
        for (int[] origin : origins) {
            BufferedImage canvas = drawScaled(img, origin[0], origin[1], dw, dh);
            int ox = origin[0];
            int oy = origin[1];
            int[] mx = new int[dw];
            int[] my = new int[dh];
            for (int j = 0; j < dh; j++) {
                for (int i = 0; i < dw; i++) {
                    int argb = canvas.getRGB(ox + i, oy + j);
                    int x = ((argb >> 16) & 0xFF) | ((argb & 0x0F) << 8);
                    int y = ((argb >> 8) & 0xFF) | (((argb >> 4) & 0x0F) << 8);
                    boolean mark = withAlpha && (argb >>> 24) != 0xFF;
                    if (!mark && (argb >>> 24) != 0xFF) {
                        fail("缩略图梯度图 " + w + "×" + h + " 读回透明像素 (" + i + "," + j + ")：没画上");
                    }
                    if (mark) {
                        // 只有记号像素是透明的，它必须恰好落在 (w-1, h-1) 那一格上：
                        // 行 / 列都要等于表里已有的那个值（第 0 行 / 列不会取到它）。
                        if (j == 0 || i == 0) fail("缩略图梯度图 " + w + "×" + h + " 第 0 行 / 列取到了记号像素");
                        continue;
                    }
                    if (x >= w || y >= h) fail("缩略图梯度图读回的源坐标越界：(" + x + "," + y + ")");
                    if (j == 0) mx[i] = x;
                    if (i == 0) my[j] = y;
                    if (x != mx[i] || y != my[j]) {
                        fail("缩略图缩放不可分离：" + w + "×" + h + " 的 (" + i + "," + j + ") 取到源 ("
                                + x + "," + y + ")，两张一维表说的是 (" + mx[i] + "," + my[j] + ")");
                    }
                }
            }
            // 记号像素那一格：两张表合起来必须指向 (w-1, h-1)，否则那个透明像素是别的原因。
            for (int j = 0; j < dh; j++) {
                for (int i = 0; i < dw; i++) {
                    boolean transparent = (canvas.getRGB(ox + i, oy + j) >>> 24) != 0xFF;
                    boolean atMark = withAlpha && mx[i] == w - 1 && my[j] == h - 1;
                    if (transparent != atMark) {
                        fail("缩略图梯度图 " + w + "×" + h + " 的 (" + i + "," + j + ") 透明 = " + transparent
                                + "，而表说它" + (atMark ? "是" : "不是") + "记号像素");
                    }
                }
            }
            if (first == null) {
                first = mx;
                firstY = my;
            } else if (!java.util.Arrays.equals(first, mx) || !java.util.Arrays.equals(firstY, my)) {
                fail("缩略图落点相关：" + w + "×" + h + " 画成 " + dw + "×" + dh + " 时，落点 ("
                        + origins[0][0] + "," + origins[0][1] + ") 与 (" + ox + "," + oy + ") 给出了两张不同的表");
            }
        }
        return new int[][] {first, firstY};
    }

    /**
     * 原版那一句的形状 {@code drawImage(img, x, y, dw, dh, observer)}，画在与
     * {@code LoadAndSavePanel.background} 同型（TYPE_INT_ARGB）的位图上。缩略图与扫描都
     * 放得进 1024×640，画布就是原版那么大；只有探针的目标可能更宽（大迷宫那张要 1619 宽
     * 才分得出两条循环），那时画布放大到装得下 —— 同型、只是更大。
     */
    private static BufferedImage drawScaled(Image img, int x, int y, int dw, int dh) {
        BufferedImage canvas = new BufferedImage(
                Math.max(CANVAS_W, x + dw), Math.max(CANVAS_H, y + dh), BufferedImage.TYPE_INT_ARGB);
        canvas.getGraphics().drawImage(img, x, y, dw, dh, null);
        return canvas;
    }

    private static String flat(int[] xs) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < xs.length; i++) sb.append(i == 0 ? "" : ",").append(xs[i]);
        return sb.append(']').toString();
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
