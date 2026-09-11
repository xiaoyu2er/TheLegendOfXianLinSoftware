package devtools;

import java.awt.Color;
import java.awt.Graphics;
import java.awt.Image;
import java.awt.image.BufferedImage;

/**
 * 量原版：{@code Map.drawMap} 那条 {@code drawImage} 在「地图图片比碰撞网格小」时到底画了什么
 * （xl-czb.3，还 xl-i06.14 的账）。一次性的测量工具，不进任何门禁 —— 入库是为了让读数能照原样重跑。
 *
 * <p>用原版自己的 {@code tools.Reader.readImage} 读图（ImageIcon），照 {@code drawMap} 那条
 * {@code drawImage(img, 0,0,1024,640, 0,0,sx2,sy2)} 画进一块先填满哨兵色的 1024×640
 * {@code TYPE_INT_ARGB}（与 {@code ScenePanel.backImage} 同型），数哨兵残留，并逐像素对最近邻
 * 公式 {@code floor((i + 0.5) × 源 / 目标)}。
 *
 * <pre>
 * tools/build.sh
 * java -Djava.awt.headless=true -Dstdout.encoding=UTF-8 -cp tools/build/classes \
 *   devtools.MapEdgeProbe 仙一教学楼一楼.png 1016 632      # 实际源矩形
 * java … devtools.MapEdgeProbe 仙一教学楼一楼.png 1024 640   # 故意越界的反事实
 * </pre>
 *
 * 从仓库根目录跑（原版按相对路径读 {@code maps/}）。参数：maps/ 下的文件名、源矩形右下角
 * sx2 sy2（左上恒为 0,0）。
 */
public class MapEdgeProbe {
	static final int SENTINEL = 0xFFFF00FF;

	public static void main(String[] a) {
		String name = a[0];
		int sx2 = Integer.parseInt(a[1]), sy2 = Integer.parseInt(a[2]);
		Image img = tools.Reader.readImage("maps//" + name);
		int w = img.getWidth(null), h = img.getHeight(null);
		if (w <= 0 || h <= 0) {
			System.err.println("读不到图：maps/" + name + "（宽高 " + w + "×" + h + "）");
			System.exit(1);
		}
		BufferedImage src = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
		src.getGraphics().drawImage(img, 0, 0, null);

		BufferedImage buf = new BufferedImage(1024, 640, BufferedImage.TYPE_INT_ARGB);
		Graphics g = buf.getGraphics();
		g.setColor(new Color(SENTINEL, true));
		g.fillRect(0, 0, 1024, 640);
		g.drawImage(img, 0, 0, 32 * 32, 20 * 32, 0, 0, sx2, sy2, null);

		int sentinel = 0, formulaMiss = 0, maxCol = -1, maxRow = -1;
		int sentinelMinX = Integer.MAX_VALUE, sentinelMinY = Integer.MAX_VALUE;
		for (int y = 0; y < 640; y++)
			for (int x = 0; x < 1024; x++) {
				int p = buf.getRGB(x, y);
				if (p == SENTINEL) {
					sentinel++;
					sentinelMinX = Math.min(sentinelMinX, x);
					sentinelMinY = Math.min(sentinelMinY, y);
					continue;
				}
				int sx = (int) Math.floor((x + 0.5) * sx2 / 1024.0);
				int sy = (int) Math.floor((y + 0.5) * sy2 / 640.0);
				maxCol = Math.max(maxCol, sx);
				maxRow = Math.max(maxRow, sy);
				if (sx >= w || sy >= h || src.getRGB(sx, sy) != p) formulaMiss++;
			}
		System.out.println(name + " " + w + "x" + h + " src=(0,0)-(" + sx2 + "," + sy2 + ")"
				+ " 哨兵残留=" + sentinel
				+ (sentinel > 0 ? " (最左 x=" + sentinelMinX + " 最上 y=" + sentinelMinY + ")" : "")
				+ " 公式不符=" + formulaMiss
				+ " 公式取到的最大源列=" + maxCol + " 最大源行=" + maxRow);
	}
}
