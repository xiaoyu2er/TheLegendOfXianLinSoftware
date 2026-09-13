package devtools;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import javax.swing.JPanel;
import javax.swing.UIManager;

/**
 * 战斗上屏那一步的黄金数据（xl-eit）：<b>非预乘 ARGB 的缓冲以 SrcOver 画到一块
 * 铺满 {@code Panel.background} 的不透明底上</b>，逐 alpha 读回屏幕颜色。
 *
 * <h2>为什么是这一步、为什么底是 Panel.background</h2>
 *
 * 原版 {@code BattlePanel.paint()} 末尾是 {@code g.drawImage(bufferedPic,0,0,this)}，
 * 缓冲是 {@code TYPE_INT_ARGB}，alpha 不扔。Swing 往后备缓冲上画一块面板之前，先用
 * <b>被画的那个组件自己的底色</b> {@code clearRect}（JDK 17 的
 * {@code RepaintManager.paintDoubleBufferedImpl} / {@code BufferStrategyPaintManager.paint}）。
 * {@code BattleScreenProbe} 实测（2026-09-13）：第 0 帧（切卡那次，从内容面板画起）下面是
 * 内容面板的底色，第 1 帧起是战斗面板自己的底色 —— 把替身 {@code setBackground} 成青色，
 * 第 1 帧边上超容差从 155 涨到 509、最近的候选是它自己的底色 20/20。原版这两块面板都没
 * {@code setBackground}（{@code src/} 里只有四个黑底面板调过），都是 {@code new JPanel()}
 * 的默认底色。所以原版每一帧上屏都是「缓冲 SrcOver 盖在新铺的 Panel.background 上」。
 *
 * <h2>这份数据守什么、不守什么</h2>
 *
 * 守的是 web 端上屏的<b>模型</b>：底色取多少（这里现取，不是手抄 238）、缓冲 alpha
 * 要不要扔（扔了在低 alpha 处差出几十）。<b>不守</b>浏览器里真的那样画了没有 —— 渲染器
 * 没有测试缝，那一半只有手工对一次。
 *
 * ⚠️ 这里画在软件 {@code BufferedImage}（{@code TYPE_INT_RGB}）上；真屏幕的后备缓冲是
 * {@code VolatileImage}，走的是加速管线，舍入与这里逐位相同吗<b>没核</b>。
 * ⚠️ 底色是 LAF 定的。headless 下默认 LAF 是 Metal（Windows 上原版的默认），macOS 真屏幕上
 * 是 Aqua；两者 2026-09-13 在 openjdk 17 上各量一次都是 238，这里导出的是跑的那一个。
 *
 * <h2>自己的判据（任一条不成立退出码 1）</h2>
 *
 * <ol>
 *   <li>alpha=255 读回的必须恰好是源色（不透明时 SrcOver 就是覆盖）；</li>
 *   <li>alpha=0 读回的必须恰好是底色 —— 这一条同时拦「根本没画上」与「底没铺上」；</li>
 *   <li>底色必须与 {@code UIManager.getColor("Panel.background")} 相同（组件底色确实来自
 *       LAF，而不是别处）。</li>
 * </ol>
 *
 * <p>用法：{@code java -Djava.awt.headless=true devtools.ExportPresent [输出文件]}，见
 * {@code tools/export-present.sh}。
 */
public class ExportPresent {

    /**
     * 源色：各自 256 档 alpha。挑的是三个通道分得开、且含 0 与 255 两端的颜色 ——
     * 0 与 255 上「扔 alpha」和「不扔」差得最远，中间值看舍入。
     */
    private static final int[][] COLORS = {
        {255, 0, 128},
        {37, 200, 90},
        {0, 0, 0},
        {250, 250, 250},
    };

    public static void main(String[] args) throws Exception {
        String out = args.length > 0 ? args[0] : "tools/present-golden/java-present.json";

        // 原版的两块面板（内容面板、BattlePanel）都是 JPanel、都没改过底色：取一块新的。
        Color bg = new JPanel().getBackground();
        Color laf = UIManager.getColor("Panel.background");
        if (laf == null || laf.getRGB() != bg.getRGB()) {
            fail("new JPanel() 的底色 " + bg + " 与 Panel.background " + laf + " 不同");
        }
        int bgRgb = bg.getRGB() & 0xFFFFFF;

        int[][] outs = new int[COLORS.length][];
        for (int k = 0; k < COLORS.length; k++) outs[k] = present(COLORS[k], bg);

        for (int k = 0; k < COLORS.length; k++) {
            int[] c = COLORS[k];
            int src = (c[0] << 16) | (c[1] << 8) | c[2];
            if (outs[k][255] != src) {
                fail("alpha=255 读回 " + Integer.toHexString(outs[k][255]) + "，应为源色 " + Integer.toHexString(src));
            }
            if (outs[k][0] != bgRgb) {
                fail("alpha=0 读回 " + Integer.toHexString(outs[k][0]) + "，应为底色 " + Integer.toHexString(bgRgb));
            }
        }

        File f = new File(out);
        if (f.getParentFile() != null) f.getParentFile().mkdirs();
        try (Writer w = new OutputStreamWriter(new FileOutputStream(f), StandardCharsets.UTF_8)) {
            w.write("{\n");
            w.write("  \"note\": " + Json.str(
                    "战斗上屏：TYPE_INT_ARGB 的缓冲以默认 SrcOver 画到铺满 panelBackground 的 TYPE_INT_RGB 上，"
                    + "由 devtools.ExportPresent 实跑。samples[k].out[a] 是源色 samples[k].rgb、alpha=a 时读回的 RGB。"
                    + " 画在软件 BufferedImage 上，与真屏幕后备缓冲（VolatileImage）是否逐位相同没核。") + ",\n");
            w.write("  \"lookAndFeel\": " + Json.str(UIManager.getLookAndFeel().getClass().getName()) + ",\n");
            w.write("  \"panelBackground\": " + rgb(bgRgb) + ",\n");
            w.write("  \"samples\": [\n");
            for (int k = 0; k < COLORS.length; k++) {
                StringBuilder sb = new StringBuilder();
                for (int a = 0; a < 256; a++) sb.append(a == 0 ? "" : ",").append(rgb(outs[k][a]));
                w.write("    { \"rgb\": [" + COLORS[k][0] + "," + COLORS[k][1] + "," + COLORS[k][2]
                        + "], \"out\": [" + sb + "] }" + (k + 1 < COLORS.length ? ",\n" : "\n"));
            }
            w.write("  ]\n}\n");
        }
        System.out.println("已写出 " + out + "：LAF " + UIManager.getLookAndFeel().getName() + "，底色 "
                + Integer.toHexString(bgRgb) + "，" + COLORS.length + " 种源色 × 256 档 alpha，"
                + Files.size(f.toPath()) + " 字节");
    }

    /** 一种源色的 256 档 alpha 并排成一行，一次画上去，逐个读回。 */
    private static int[] present(int[] c, Color bg) {
        BufferedImage src = new BufferedImage(256, 1, BufferedImage.TYPE_INT_ARGB);
        for (int a = 0; a < 256; a++) src.setRGB(a, 0, (a << 24) | (c[0] << 16) | (c[1] << 8) | c[2]);
        BufferedImage screen = new BufferedImage(256, 1, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = screen.createGraphics();
        // Swing 画面板之前那一句：setBackground(c.getBackground()) + clearRect。
        g.setBackground(bg);
        g.clearRect(0, 0, 256, 1);
        // 原版那一句：g.drawImage(bufferedPic, 0, 0, this)，默认 SrcOver。
        g.drawImage(src, 0, 0, null);
        g.dispose();
        int[] out = new int[256];
        for (int a = 0; a < 256; a++) out[a] = screen.getRGB(a, 0) & 0xFFFFFF;
        return out;
    }

    private static String rgb(int v) {
        return "[" + ((v >> 16) & 0xFF) + "," + ((v >> 8) & 0xFF) + "," + (v & 0xFF) + "]";
    }

    private static void fail(String message) {
        System.err.println("[ExportPresent] " + message);
        System.exit(1);
    }
}
