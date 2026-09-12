package devtools;

import java.awt.image.BufferedImage;
import java.io.File;
import java.util.Locale;

import javax.imageio.ImageIO;

import battle.BattlePanel;
import battle.Enemy;
import main.GameLauncher;

/**
 * 量「一局之内几场战斗共用一块 {@code bufferedPic}」对第二场头几帧的影响（xl-pgq）。
 *
 * <h2>为什么要量</h2>
 *
 * 原版整个进程只有一块 {@code BattlePanel}：{@code GameLauncher} 只在构造函数里
 * new 它，另一处 {@code init()} 的唯一调用点 {@code StartPanel} 那一句是注释掉的。
 * {@code paint()} 从不清屏（xl-84z），所以后一场背景图 alpha&lt;255 的地方会透出
 * 上一场的末帧。导出器却是一份剧本一个 JVM、一块新面板，Web 渲染器对的是它。
 *
 * <h2>怎么量</h2>
 *
 * 三个子命令，前两个各占一个 JVM（{@link BattleDriver} 一个进程只认一条
 * {@code BattlePanel.run()} 线程）：
 *
 * <pre>
 *   carry &lt;第一场剧本&gt; &lt;第二场剧本&gt; &lt;帧数&gt; &lt;输出目录&gt; [--clear]
 *       第一场照剧本打完（剧本要一路打到原版自己切走面板），然后在**同一块面板**上
 *       照 FightEvent 的样子再 initial() 一次第二场，逐拍 paint，存前 N 帧。
 *       --clear：对照组，其余一步不差，只在开第二场前把缓冲清回全透明。
 *   fresh &lt;第二场剧本&gt; &lt;帧数&gt; &lt;输出目录&gt;
 *       第二场单独打（= 导出器，= Web 渲染器对齐的那一侧），存前 N 帧。
 *   diff &lt;背景图&gt; &lt;carry 目录&gt; &lt;fresh 目录&gt; &lt;帧数&gt; &lt;容差&gt;
 *       逐帧逐像素比 RGB（不看 alpha，与比对器同），按背景图 alpha&lt;255 与否分两类数。
 * </pre>
 *
 * <h2>复现（仓库根目录，先 tools/build.sh）</h2>
 *
 * <pre>
 *   J="java --add-opens java.base/java.lang=ALL-UNNAMED -Djava.awt.headless=false \
 *      -cp tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar devtools.BattleCarryProbe"
 *   V=tools/traces/scripts/battle-victory.json; T=tools/traces/scripts/battle-script3.json
 *   $J carry $V $T 40 /tmp/carry
 *   $J carry $V $T 40 /tmp/clear --clear
 *   $J diff image/背景图/校园小道.png /tmp/carry /tmp/clear 40 8
 * </pre>
 *
 * 容差 8 取的是逐帧比对器的单通道容差（{@code tools/compare-frames.sh} 的报告头）。
 * 读数（2026-09-12）：第 0 帧边上 2293 个、第 1 帧 49 个、第 2 帧起 0；边以外 0。
 *
 * 第二场开打前把随机数播回第二场剧本的种子，两侧的状态机于是从同一个起点走 ——
 * 否则第一场消耗掉的随机数会让两侧的第二场从头就分叉，差出来的像素说不清来源。
 *
 * <h2>两侧不同的不只是缓冲</h2>
 *
 * 英雄的等级与血量是三个类的 static，carry 一侧带着第一场的；两场之间原版的
 * {@code run()} 循环在地图上照跑而不 paint，这里不模拟那一段。所以背景 alpha=255
 * 的那一类像素**也可能**有差（状态栏里的数字之类），那不是本票要量的东西，单列出来。
 */
public final class BattleCarryProbe {

    public static void main(String[] args) throws Exception {
        if (args.length == 0) usage();
        // 与 ExportTrace.main 同：一律静音，MusicTap.arm() 也要求 CAN_PLAY_MUSIC 已是 NO。
        media.MusicPlayer.CAN_PLAY_MUSIC = media.MusicPlayer.NO;
        media.MusicPlayer.CAN_PLAY_BGM = media.MusicPlayer.NO;
        switch (args[0]) {
            case "carry":
                if (args.length != 5 && !(args.length == 6 && args[5].equals("--clear"))) usage();
                carry(new File(args[1]), new File(args[2]), Integer.parseInt(args[3]), new File(args[4]),
                        args.length == 6);
                break;
            case "fresh":
                if (args.length != 4) usage();
                fresh(new File(args[1]), Integer.parseInt(args[2]), new File(args[3]));
                break;
            case "diff":
                if (args.length != 6) usage();
                diff(new File(args[1]), new File(args[2]), new File(args[3]),
                        Integer.parseInt(args[4]), Integer.parseInt(args[5]));
                break;
            default:
                usage();
        }
        // 面板的 run() 线程不是守护线程，不 exit 进程不会退。
        System.exit(0);
    }

    private static void usage() {
        System.err.println("用法：carry <剧本1> <剧本2> <帧数> <目录> [--clear] | fresh <剧本2> <帧数> <目录>"
                + " | diff <背景图> <carry目录> <fresh目录> <帧数> <容差>");
        System.exit(2);
    }

    private static void carry(File first, File second, int frames, File out, boolean clear) throws Exception {
        TraceScript s1 = TraceScript.load(first);
        TraceScript s2 = TraceScript.load(second);
        BattleDriver d = new BattleDriver(s1);
        int steps = 0;
        while (d.step()) steps++;
        BattlePanel bp = d.panel();
        // 第一场必须是被原版自己收场的：没切走面板就接着开第二场，量的是一个真游戏
        // 里不存在的时刻。
        Object heroes = BattleDriver.get(bp, "heroes");
        if (!((java.util.List<?>) heroes).isEmpty()) {
            ExportTrace.die(first.getName() + " 打完之后 bp.heroes 还有 "
                    + ((java.util.List<?>) heroes).size() + " 人 —— 第一场没有走到原版收场那一句"
                    + "（VictoryReminder / GameOver 里的 heroes.clear()），剧本要一路打到 awaitExit");
        }
        System.err.println("[carry] 第一场 " + s1.name + " 跑了 " + steps + " 步，接着在同一块面板上开 " + s2.name);

        BattleDriver.plantMathRandom(s2.seed);
        // 照 FightEvent：英雄是 GameLauncher 上那三个，怪物现 new、挂在同一块面板上。
        Enemy[] e = new Enemy[3];
        for (int i = 0; i < 3; i++) {
            String spec = s2.enemies.get(i);
            if (spec == null) continue;
            int slash = spec.lastIndexOf('/');
            e[i] = new Enemy(spec.substring(0, slash), Integer.parseInt(spec.substring(slash + 1)), bp);
        }
        bp.initial(s2.background,
                s2.party.contains("zhang") ? GameLauncher.zhangXiaoFan : null,
                s2.party.contains("yu") ? GameLauncher.yuJie : null,
                s2.party.contains("lu") ? GameLauncher.luXueQi : null,
                e[0], e[1], e[2]);
        if (clear) {
            // 对照组：其余一步不差，只把缓冲清回 TYPE_INT_ARGB 的初值（全透明）。
            // carry 与 carry --clear 之差于是**只**来自缓冲 —— 与 fresh 比的话还混着
            // 英雄等级、血量这些 static 带过来的差（见类注释末段）。
            BufferedImage buf = (BufferedImage) BattleDriver.get(bp, "bufferedPic");
            java.awt.Graphics2D g = buf.createGraphics();
            g.setComposite(java.awt.AlphaComposite.Clear);
            g.fillRect(0, 0, buf.getWidth(), buf.getHeight());
            g.dispose();
            if (buf.getRGB(0, 0) != 0 || buf.getRGB(buf.getWidth() - 1, buf.getHeight() - 1) != 0) {
                ExportTrace.die("清缓冲之后角上不是 0x00000000");
            }
        }
        dump(out, frames, d);
    }

    private static void fresh(File second, int frames, File out) throws Exception {
        BattleDriver d = new BattleDriver(TraceScript.load(second));
        // step() 第一次调用才建面板并推第一步；它推完就是第 0 帧，与 carry 那边
        // initial() 之后第一次 pumpAndPaint 对齐。
        if (!d.step()) ExportTrace.die(second.getName() + " 一步都没推就结束了");
        save(d.snapshotImage(), out, 0);
        for (int i = 1; i < frames; i++) {
            if (!d.step()) ExportTrace.die(second.getName() + " 只推了 " + i + " 步就结束了，要 " + frames + " 帧");
            save(d.snapshotImage(), out, i);
        }
    }

    private static void dump(File out, int frames, BattleDriver d) throws Exception {
        for (int i = 0; i < frames; i++) {
            d.pumpAndPaint();
            save(d.snapshotImage(), out, i);
        }
    }

    private static void save(BufferedImage img, File dir, int i) throws Exception {
        if (!dir.isDirectory() && !dir.mkdirs()) ExportTrace.die("建不了目录 " + dir);
        File f = new File(dir, String.format(Locale.ROOT, "%03d.png", i));
        if (!ImageIO.write(img, "png", f)) ExportTrace.die("写不了 PNG " + f);
    }

    private static void diff(File background, File carryDir, File freshDir, int frames, int tol) throws Exception {
        BufferedImage bg = ImageIO.read(background);
        if (bg == null) ExportTrace.die("读不了背景图 " + background);
        int w = bg.getWidth(), h = bg.getHeight();
        int translucent = 0;
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) if ((bg.getRGB(x, y) >>> 24) < 255) translucent++;
        System.out.println("背景 alpha<255 的像素：" + translucent + "；容差 " + tol + "（逐通道）");
        System.out.println("帧\t半透明边超容差\t边上最大差\t其余超容差");
        int total = 0;
        for (int i = 0; i < frames; i++) {
            String name = String.format(Locale.ROOT, "%03d.png", i);
            BufferedImage a = ImageIO.read(new File(carryDir, name));
            BufferedImage b = ImageIO.read(new File(freshDir, name));
            if (a == null || b == null) ExportTrace.die("第 " + i + " 帧缺图：" + name);
            if (a.getWidth() != w || b.getWidth() != w || a.getHeight() != h || b.getHeight() != h) {
                ExportTrace.die("第 " + i + " 帧尺寸与背景图不一致");
            }
            int edge = 0, other = 0, edgeMax = 0;
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int d = maxChannelDelta(a.getRGB(x, y), b.getRGB(x, y));
                    boolean onEdge = (bg.getRGB(x, y) >>> 24) < 255;
                    if (onEdge) edgeMax = Math.max(edgeMax, d);
                    if (d <= tol) continue;
                    if (onEdge) edge++; else other++;
                }
            }
            total += edge;
            System.out.println(i + "\t" + edge + "\t" + edgeMax + "\t" + other);
        }
        System.out.println("半透明边合计超容差：" + total);
    }

    private static int maxChannelDelta(int p, int q) {
        int m = 0;
        for (int s = 0; s <= 16; s += 8) m = Math.max(m, Math.abs(((p >> s) & 0xff) - ((q >> s) & 0xff)));
        return m;
    }
}
