package devtools;

import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import battle.BattlePanel;
import battle.Hero;
import main.GameLauncher;

/**
 * 量「战斗打完之后，原版 {@code BattlePanel.run()} 那条线程在战斗之外空转」推的是什么（xl-03x.23）。
 *
 * <h2>为什么要量</h2>
 *
 * 原版整个进程只有一块 {@code BattlePanel}，它的 {@code run()} 线程构造时起、关机停。
 * 打完一场、原版切回场景之后，那条线程仍然每 100 ms 跑一遍循环体。Web 只在
 * {@code panel === 'battle'} 时推战斗世界、每场新建。这段空转要是只推帧相位，它与
 * {@code ADR-0001#panel-threads-run-while-hidden} 同族；要是改得到面板之外看得见的
 * 状态，就是一条真偏离。读源码判断不了（票面：M8 那一轮从源码推出的行为五中五被推翻），
 * 所以跑出来。
 *
 * <h2>怎么量</h2>
 *
 * <pre>
 *   idle &lt;第一场剧本&gt; &lt;空推拍数&gt; [&lt;第二场剧本&gt; &lt;第二场拍数&gt;]
 * </pre>
 *
 * 第一场照剧本打到原版自己切走面板（剧本要以 {@code awaitExit} 收尾），然后不走剧本、
 * 只放行循环体 N 拍（与 {@link BattleCarryProbe} 同一个 {@code pumpAndPaint}）。
 * 每一拍把下面这些逐字段转储一遍，**只打印与上一拍不同的字段**：
 *
 * <ul>
 *   <li>面板自己的基本类型字段，及它每个 {@code battle.*} 子对象的基本类型字段（一层）；</li>
 *   <li>三个英雄类的 static 字段（等级、血、蓝、经验、属性、怒气……都在这里）；</li>
 *   <li>{@code GameLauncher} 上三个英雄实例的字段，及各自的 {@code battleState}；</li>
 *   <li>{@code shop.Money} 的钱、药品与六类装备的件数；</li>
 *   <li>切面板观察点：累计切了几次、最后切到哪一块。</li>
 * </ul>
 *
 * 给了第二场的话，空推之后照 {@code FightEvent} 在同一块面板上 {@code initial()} 第二场
 * （随机数先播回第二场剧本的种子），再放行 M 拍，每拍把整张转储打一行 ——
 * {@code N=0} 与 {@code N>0} 各跑一遍再 {@code diff}，就是「中间空推」与「不空推」两种
 * 情况下第二场的逐步对照。
 *
 * <h2>复现（仓库根目录，先 tools/build.sh）</h2>
 *
 * <pre>
 *   J="java --add-opens java.base/java.lang=ALL-UNNAMED -Djava.awt.headless=false \
 *      -cp tools/build/classes:jl1.0.jar:mp3spi1.9.4.jar:tritonus_share.jar devtools.BattleIdleProbe"
 *   $J idle tools/traces/scripts/battle-victory-normal.json 200
 * </pre>
 *
 * 输出落在 stdout；读数与结论见 xl-03x.23 的关票理由。
 *
 * <h2>rescene：第二次回场景在面板之外做了什么（xl-sn2）</h2>
 *
 * <pre>
 *   rescene &lt;第一场剧本&gt; &lt;空推拍数&gt; &lt;第几拍进菜单，-1 = 一直待在场景&gt;
 * </pre>
 *
 * 同一个 JVM 里再立一块真的场景面板与菜单面板，战斗一拍对场景十拍地推，见 {@link #rescene}。
 * 读数（2026-09-13，openjdk 17；nolevel = battle-victory 三人都压到 10 级，造法见 xl-sn2）：
 *
 * <ul>
 *   <li>nolevel、第 20 拍进菜单：第 40 拍 {@code currentPanel} 菜单 → 场景，BGM 第二次 play；</li>
 *   <li>nolevel、一直待在场景：第 40 拍 BGM 第二次 play（同一首，大地图.mp3）；</li>
 *   <li>battle-victory（升级那一支）、第 20 拍进菜单：200 拍留在菜单，BGM 只 play 一次。</li>
 * </ul>
 */
public final class BattleIdleProbe {

    public static void main(String[] args) throws Exception {
        boolean idle = args.length >= 1 && args[0].equals("idle") && (args.length == 3 || args.length == 5);
        boolean rescene = args.length == 4 && args[0].equals("rescene");
        if (!idle && !rescene) {
            System.err.println("用法：idle <第一场剧本> <空推拍数> [<第二场剧本> <第二场拍数>]\n"
                    + "      rescene <第一场剧本> <空推拍数> <第几拍进菜单，-1 = 一直待在场景>");
            System.exit(2);
        }
        media.MusicPlayer.CAN_PLAY_MUSIC = media.MusicPlayer.NO;
        media.MusicPlayer.CAN_PLAY_BGM = media.MusicPlayer.NO;
        if (rescene) {
            rescene(new File(args[1]), Integer.parseInt(args[2]), Integer.parseInt(args[3]));
        } else {
            idle(new File(args[1]), Integer.parseInt(args[2]),
                    args.length == 5 ? new File(args[3]) : null,
                    args.length == 5 ? Integer.parseInt(args[4]) : 0);
        }
        System.exit(0);
    }

    // ================= rescene：第二次 switchTo("scene") 在面板之外做了什么（xl-sn2） =================

    /** 场景循环 {@code Clock.sleep(10)}，战斗循环 {@code Clock.sleep(100)}：战斗一拍对场景十拍。 */
    private static final int SCENE_STEPS_PER_BATTLE_TICK = 10;

    /**
     * 第一场照剧本打到原版自己切走面板，然后在**同一个 JVM** 里立起一块真的场景面板
     * （大地图，立法照 {@link SceneDriver#start}）与一块真的菜单面板（照
     * {@code GameLauncher} 构造函数那一句 {@code new MenuPanel(zxf, lxq, yj)}），
     * 之后每放行一次战斗循环体就调十次 {@code ScenePanel.step()}。
     *
     * 第 {@code menuAt} 拍照 {@code ScenePanel.keyPressed} 的 ESC 那一句调
     * {@code GameLauncher.switchTo("menu")}。每拍只打印变了的这几样：切面板观察点、
     * {@code GameLauncher.currentPanel} 是哪一块、{@code SCENE_SIGNAL}、背景音乐曲名，
     * 以及**背景音乐一共 play 了几次** —— {@code MusicPlayer.play} 每次都
     * {@code new File} 再 {@code getAudioInputStream}，所以它的 {@code audioInputStream}
     * 换了一个对象就是又从文件头开了一次。曲名在第二次 play 前后是同一首，只看曲名看不出来。
     *
     * 立起来的只是这三块面板，不是 {@code GameLauncher}（那是 xl-x0t）：切面板仍然由
     * {@link BattleDriver} 装的 {@link PanelTap} 记名字、不碰容器。场景的定时器冻着不推
     * （NPC 走不走与这里要量的无关）；菜单那四条 {@code FatherPanel} 线程照跑，它们只推帧。
     */
    private static void rescene(File first, int n, int menuAt) throws Exception {
        TraceScript s1 = TraceScript.load(first);
        BattleDriver d = new BattleDriver(s1);
        int steps = 0;
        while (d.step()) steps++;
        PanelTap tap = (PanelTap) BattleDriver.get(d, "tap");
        if (tap.count() != 1 || !"scenePanel".equals(tap.card())) {
            ExportTrace.die(first.getName() + " 打完之后切面板 " + tap.count() + " 次、最后切到 " + tap.card()
                    + " —— 这个模式要的是一场一路打到原版切回场景的胜利");
        }

        tools.Clock.freezeTimers(24L * 60 * 60 * 1000);
        scene.ScenePanel sp = new scene.ScenePanel(null);
        GameLauncher.scenePanel = sp;
        sp.initiation("脚本1.txt");     // 预热，理由见 SceneDriver.start
        sp.initiation("大地图.txt");
        sp.isScript = false;
        GameLauncher.currentPanel = sp;
        GameLauncher.menuPanel = new menu.MenuPanel(GameLauncher.zhangXiaoFan, GameLauncher.luXueQi, GameLauncher.yuJie);

        Object bgm = staticField("media.MusicReader", "background");
        Object[] lastStream = {BattleDriver.get(bgm, "audioInputStream")};
        int[] plays = {0};
        System.out.println("# 第一场 " + s1.name + "：" + steps + " 步，原版已切面板 1 次（scenePanel）；"
                + "场景 = 大地图，SCENE_SIGNAL=" + GameLauncher.SCENE_SIGNAL + "，此刻 BGM " + BattleDriver.get(bgm, "currentPlayingBGM"));

        String prev = null;
        for (int i = 0; i <= n; i++) {
            if (i > 0) d.pumpAndPaint();
            if (i == menuAt) GameLauncher.switchTo("menu");
            for (int k = 0; k < SCENE_STEPS_PER_BATTLE_TICK; k++) {
                sp.step();
                Object s = BattleDriver.get(bgm, "audioInputStream");
                if (s != lastStream[0]) {
                    plays[0]++;
                    lastStream[0] = s;
                    System.out.println("  第 " + i + " 拍场景第 " + k + " 步：BGM play 第 " + plays[0] + " 次 "
                            + BattleDriver.get(bgm, "currentPlayingBGM"));
                }
            }
            String cur = "tap.count=" + tap.count() + " tap.card=" + tap.card()
                    + " current=" + panelName(GameLauncher.currentPanel, sp)
                    + " SCENE_SIGNAL=" + GameLauncher.SCENE_SIGNAL
                    + " timeCode=" + BattleDriver.get(BattleDriver.get(d.panel(), "victoryReminder"), "timeCode")
                    + " plays=" + plays[0];
            // timeCode 每拍都在变，比较时去掉它，只在别的东西变了时打印
            String key = cur.replaceAll(" timeCode=\\d+", "");
            if (!key.equals(prev)) System.out.println("第 " + i + " 拍：" + cur);
            prev = key;
        }
        System.out.println("# 空推 " + n + " 拍，BGM 共 play " + plays[0] + " 次");
    }

    private static String panelName(Object p, Object sp) {
        if (p == null) return "null";
        if (p == sp) return "scene";
        if (p == GameLauncher.menuPanel) return "menu";
        return p.getClass().getSimpleName();
    }

    private static Object staticField(String cls, String name) throws Exception {
        Field f = Class.forName(cls).getDeclaredField(name);
        f.setAccessible(true);
        return f.get(null);
    }

    private static void idle(File first, int n, File second, int m) throws Exception {
        TraceScript s1 = TraceScript.load(first);
        BattleDriver d = new BattleDriver(s1);
        int steps = 0;
        while (d.step()) steps++;
        BattlePanel bp = d.panel();
        PanelTap tap = (PanelTap) BattleDriver.get(d, "tap");
        if (tap.count() == 0) {
            ExportTrace.die(first.getName() + " 打完了而原版一次都没切面板 —— 剧本要一路打到 awaitExit");
        }
        System.out.println("# 第一场 " + s1.name + "：" + steps + " 步，原版已切面板 " + tap.count()
                + " 次，最后切到 " + tap.card());

        Map<String, String> prev = dump(bp, tap);
        System.out.println("# 切走那一刻共转储 " + prev.size() + " 个字段");
        int changedTicks = 0;
        for (int i = 1; i <= n; i++) {
            d.pumpAndPaint();
            Map<String, String> cur = dump(bp, tap);
            List<String> diff = new ArrayList<>();
            for (Map.Entry<String, String> e : cur.entrySet()) {
                String was = prev.get(e.getKey());
                if (!e.getValue().equals(was)) diff.add(e.getKey() + " " + was + "→" + e.getValue());
            }
            for (String k : prev.keySet()) if (!cur.containsKey(k)) diff.add(k + " 消失");
            if (!diff.isEmpty()) {
                changedTicks++;
                System.out.println("空推第 " + i + " 拍：" + String.join("；", diff));
            }
            prev = cur;
        }
        System.out.println("# 空推 " + n + " 拍，其中 " + changedTicks + " 拍有字段变化");

        if (second == null) return;
        BattleCarryProbe.openSecond(bp, TraceScript.load(second));
        for (int i = 0; i < m; i++) {
            d.pumpAndPaint();
            System.out.println("第二场第 " + i + " 拍 " + dump(bp, tap));
        }
    }

    // ================= 转储 =================

    private static Map<String, String> dump(BattlePanel bp, PanelTap tap) throws Exception {
        Map<String, String> out = new TreeMap<>();
        out.put("tap.count", String.valueOf(tap.count()));
        out.put("tap.card", String.valueOf(tap.card()));
        for (Field f : fields(bp.getClass())) {
            Object v = f.get(bp);
            if (isLeaf(f.getType())) {
                out.put("bp." + f.getName(), String.valueOf(v));
            } else if (v instanceof List) {
                out.put("bp." + f.getName() + ".size", String.valueOf(((List<?>) v).size()));
            } else if (v != null && isBattleClass(v.getClass())) {
                out.put("bp." + f.getName(), "非空");
                leaves(out, "bp." + f.getName(), v);
            } else if (isBattleClass(f.getType())) {
                out.put("bp." + f.getName(), "null");
            }
        }
        for (String c : new String[] {"battle.ZhangXiaoFan", "battle.YuJie", "battle.LuXueQi", "shop.Money"}) {
            for (Field f : fields(Class.forName(c))) {
                if (Modifier.isStatic(f.getModifiers()) && isLeaf(f.getType())) {
                    out.put(c + "::" + f.getName(), String.valueOf(f.get(null)));
                }
            }
        }
        Hero[] party = {GameLauncher.zhangXiaoFan, GameLauncher.yuJie, GameLauncher.luXueQi};
        for (Hero h : party) {
            if (h == null) continue;
            String p = h.getClass().getSimpleName();
            leaves(out, p, h);
            leaves(out, p + ".battleState", h.getBattleState());
        }
        out.put("DrugPack.drugList", counts(Class.forName("shop.DrugPack"), "drugList"));
        for (String l : new String[] {"helmetList", "armorList", "weaponList", "gloveList", "shoeList", "decorationList"}) {
            out.put("EquipmentPack." + l, counts(Class.forName("shop.EquipmentPack"), l));
        }
        return out;
    }

    /** 一个对象自己（含父类）的**实例**基本类型 / 字符串字段。 */
    private static void leaves(Map<String, String> out, String prefix, Object o) throws Exception {
        for (Field f : fields(o.getClass())) {
            if (Modifier.isStatic(f.getModifiers()) || !isLeaf(f.getType())) continue;
            out.put(prefix + "." + f.getName(), String.valueOf(f.get(o)));
        }
    }

    /** 列表里每一项的「名字×数量」，看的是整张单子而不只是长度。 */
    private static String counts(Class<?> c, String name) throws Exception {
        Field f = c.getDeclaredField(name);
        f.setAccessible(true);
        StringBuilder sb = new StringBuilder();
        // 按下标记，不记 identityHashCode：两个 JVM 各跑一遍再 diff，那个哈希对不上。
        int i = 0;
        for (Object item : (List<?>) f.get(null)) {
            sb.append(i++);
            for (Field g : fields(item.getClass())) {
                if (!Modifier.isStatic(g.getModifiers()) && isLeaf(g.getType())) sb.append(',').append(g.get(item));
            }
            sb.append(';');
        }
        return sb.toString();
    }

    /** 沿继承链、只到 battle / shop / devtools 包为止的全部字段（跳过 JPanel 那一大串）。 */
    private static List<Field> fields(Class<?> c) {
        List<Field> fs = new ArrayList<>();
        for (; c != null && (isBattleClass(c) || c.getName().startsWith("shop.") || c.getName().startsWith("devtools."));
                c = c.getSuperclass()) {
            for (Field f : c.getDeclaredFields()) {
                f.setAccessible(true);
                fs.add(f);
            }
        }
        return fs;
    }

    private static boolean isBattleClass(Class<?> c) { return c.getName().startsWith("battle."); }

    private static boolean isLeaf(Class<?> t) {
        return t.isPrimitive() || t == String.class || Number.class.isAssignableFrom(t) || t == Boolean.class;
    }
}
