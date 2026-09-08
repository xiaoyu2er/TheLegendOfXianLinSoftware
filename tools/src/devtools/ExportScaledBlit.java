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
import java.util.ArrayList;
import java.util.List;

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
 * <h2>量出来的规律</h2>
 *
 * <p>用一张「像素值就是自己的坐标」的梯度图跑一遍全量扫描（源 128×24，目标
 * 1..256 × 1..48，五个不同落点各跑一遍），读回每个目标像素取的源坐标，得到：
 *
 * <ul>
 *   <li>**采样与落点无关** —— 五个落点的表逐个相同。</li>
 *   <li>**不打平的位置一律是** {@code floor(k*i + k/2)}，{@code k = 源长/目标长}，
 *       与 GPU 的最近邻一致，一个不差。</li>
 *   <li>**打平的位置**（{@code k*i + k/2} 恰好是整数）两边都出现过：同一个目标
 *       长度里可能一部分向上、一部分向下（实测 X 的 12/20/48/56/60/116 与
 *       Y 的 9/10 就是混的）。所以它**不是**一条「平局一律向下」的规则，而是
 *       定点步进的截尾误差在起作用。</li>
 * </ul>
 *
 * <p>拟合出来的定点模型（在上面那个扫描域里逐个吻合，一处不差）：
 *
 * <pre>
 *   inc = (源长 &lt;&lt; 23) / 目标长      // 整数除法，截尾
 *   loc = (inc + 1) / 2                // 向上取整的半步
 *   src(i) = (loc + i * inc) &gt;&gt; 23
 * </pre>
 *
 * <p>⚠️ 这个模型是**拟合**出来的，不是从 OpenJDK 源码里读出来的：23 这个位数
 * 与那半步的取整方向都是搜出来的，别处未必成立。所以入库的是**这张表**而不是
 * 这个公式 —— web 端复刻的对错由表来判，公式只是它的实现。
 *
 * <h2>这份数据自己的判据</h2>
 *
 * 「读不出来」不许成为通过条件，所以导出器自己先验三条，任一条不成立就当场
 * 退出码 1：目标长 == 源长时必须是恒等映射；每个读回的像素必须是不透明的
 * （梯度图是不透明的，读到透明就说明这一笔根本没画上）；五个落点必须给出
 * 同一张表。
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

    public static void main(String[] args) throws Exception {
        String out = args.length > 0 ? args[0] : "tools/scaled-blit-golden/java-scaled-blit.json";

        File tmpDir = Files.createTempDirectory("xl-scaled-blit").toFile();
        File png = new File(tmpDir, "gradient.png");
        writeGradient(png);
        // 走原版读图的那条路（ImageIcon -> Toolkit Image），不是 ImageIO 的
        // BufferedImage —— 两者在 Java2D 里未必落到同一条 blit 循环上。
        Image img = tools.Reader.readImage(png.getPath());

        int[][] xMap = sweep(img, true);
        int[][] yMap = sweep(img, false);

        png.delete();
        tmpDir.delete();

        File f = new File(out);
        if (f.getParentFile() != null) f.getParentFile().mkdirs();
        try (Writer w = new OutputStreamWriter(new FileOutputStream(f), StandardCharsets.UTF_8)) {
            w.write("{\n");
            w.write("  \"note\": " + Json.str(
                    "Java2D 缩放时目标第 i 个像素取的源坐标。由 devtools.ExportScaledBlit"
                    + " 用梯度图实测，map[destLen] 是长度为 destLen 的表；下标 0 是占位的空表。") + ",\n");
            w.write("  \"x\": {\n");
            w.write("    \"srcLen\": " + SRC_W + ",\n");
            w.write("    \"map\": " + Json.grid(xMap) + "\n");
            w.write("  },\n");
            w.write("  \"y\": {\n");
            w.write("    \"srcLen\": " + SRC_H + ",\n");
            w.write("    \"map\": " + Json.grid(yMap) + "\n");
            w.write("  }\n");
            w.write("}\n");
        }
        System.out.println("已写出 " + out + "：X 目标长 1.." + MAX_DEST_W
                + "，Y 目标长 1.." + MAX_DEST_H + "，" + Files.size(f.toPath()) + " 字节");
    }

    /** 像素值就是自己的坐标：红 = x（0..127），绿 = y（0..23）。 */
    private static void writeGradient(File png) throws Exception {
        BufferedImage src = new BufferedImage(SRC_W, SRC_H, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < SRC_H; y++) {
            for (int x = 0; x < SRC_W; x++) {
                src.setRGB(x, y, 0xFF000000 | (x << 16) | (y << 8));
            }
        }
        ImageIO.write(src, "png", png);
    }

    /**
     * 扫一条轴：目标长 1..max，每个长度得到一张「目标下标 -> 源下标」的表。
     *
     * <p>另一条轴固定为源长（1:1），于是它不参与缩放，读哪一行/哪一列都一样。
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
            int px = horizontal ? ox + i : ox;
            int py = horizontal ? oy : oy + i;
            int argb = canvas.getRGB(px, py);
            if (((argb >>> 24) & 0xFF) != 0xFF) {
                fail("读回的像素是透明的：" + (horizontal ? "X" : "Y") + " 目标长 " + destLen
                        + " 落点 " + origin + " 的第 " + i + " 个 —— 梯度图是不透明的，"
                        + "读到透明说明这一笔根本没画上（图没载入？）");
            }
            map[i] = horizontal ? ((argb >> 16) & 0xFF) : ((argb >> 8) & 0xFF);
            int srcLen = horizontal ? SRC_W : SRC_H;
            if (map[i] < 0 || map[i] >= srcLen) {
                fail("读回的源坐标越界：" + map[i] + " 不在 0.." + (srcLen - 1));
            }
        }
        return map;
    }

    private static void fail(String message) {
        System.err.println("[ExportScaledBlit] " + message);
        System.exit(1);
    }
}
