package tools;

import java.util.ArrayList;
import java.util.List;

/**
 * 音效调用记录。默认关闭，关闭时 {@link #record} 是空操作，游戏行为与原版一致。
 *
 * 为什么要另起一个观察点：原版把「正在放哪个音效」记在
 * {@code MusicPlayer.filename} 上，而那行赋值落在 {@code playmusic} 的
 * {@code if (CAN_PLAY_MUSIC == YES)} 判断**里面**。导出行为真值时音效必须关掉
 * ——每次点击都开一次音频设备、起一条播放线程，两遍导出不可能逐字节一致——
 * 一关就一个字都观察不到，于是菜单/商店真值里「该不该响、响哪一个」是空白的。
 * 见 bd xl-1vu.8。
 *
 * 这里把观察点提到 {@code MusicReader.readmusic} 的入口，也就是那个判断**之外**：
 * 不管音效开没开，「这一步请求播放了哪些文件」都记得下来。不开设备、不起线程、
 * 不碰任何播放行为——本类只有 record 一处被游戏代码调用，且默认直接 return。
 *
 * BGM 不走这里：{@code MusicPlayer.play} 里 {@code currentPlayingBGM = name}
 * 本来就在任何开关判断之外，场景真值一直记得到。
 */
public final class MusicLog {

	private static volatile boolean recording = false;

	private static final List<String> pending = new ArrayList<String>();

	private MusicLog() {}

	/** 打开/关闭记录，并清空积压。默认是关的，游戏正常运行时一个字节都不攒。 */
	public static void setRecording(boolean on) {
		synchronized (pending) {
			pending.clear();
			recording = on;
		}
	}

	/** 由 {@code MusicReader.readmusic} 在入口处调用。未开记录时立即返回。 */
	public static void record(String name) {
		if (!recording) return;
		synchronized (pending) {
			pending.add(name);
		}
	}

	/** 取走并清空自上次 drain 以来记下的文件名，按调用先后排列。 */
	public static String[] drain() {
		synchronized (pending) {
			String[] a = pending.toArray(new String[pending.size()]);
			pending.clear();
			return a;
		}
	}
}
