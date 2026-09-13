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
 */
public final class BattleIdleProbe {

    public static void main(String[] args) throws Exception {
        if ((args.length != 3 && args.length != 5) || !args[0].equals("idle")) {
            System.err.println("用法：idle <第一场剧本> <空推拍数> [<第二场剧本> <第二场拍数>]");
            System.exit(2);
        }
        media.MusicPlayer.CAN_PLAY_MUSIC = media.MusicPlayer.NO;
        media.MusicPlayer.CAN_PLAY_BGM = media.MusicPlayer.NO;
        idle(new File(args[1]), Integer.parseInt(args[2]),
                args.length == 5 ? new File(args[3]) : null,
                args.length == 5 ? Integer.parseInt(args[4]) : 0);
        System.exit(0);
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
