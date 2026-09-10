package devtools;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;

import tools.Reader;

/**
 * 真值导出器：把 96 个 script/*.txt 经原版 tools.Reader 解析后的结果导出成 JSON。
 *
 * 这批 JSON 是 web 版数据烘焙管道的黄金基线 —— TypeScript 解析器读同一批 .txt，
 * 结果必须与之逐字段相等。产物一旦生成即冻结，之后任何 diff 都是信号。
 *
 * 刻意不导出 Reader.getNpcs()：它返回构造好的 NPC 对象（含 Image / Timer 字段），
 * 不可序列化，且其数据在 getNpcList() 里已有原始 String[] 形式，是完全冗余的。
 *
 * 用法: java devtools.ExportGroundTruth <输出目录>
 * 必须在仓库根目录运行（原版用相对路径 script/、sources/ 等）。
 */
public class ExportGroundTruth {

    public static void main(String[] args) throws Exception {
        File out = new File(args.length > 0 ? args[0] : "tools/ground-truth");
        out.mkdirs();

        File[] scripts = new File("script").listFiles((d, n) -> n.endsWith(".txt"));
        if (scripts == null) {
            System.err.println("找不到 script/ 目录 —— 必须在仓库根目录运行");
            System.exit(1);
        }
        Arrays.sort(scripts, Comparator.comparing(File::getName));

        int ok = 0;
        ArrayList<String> failed = new ArrayList<>();
        for (File f : scripts) {
            try {
                write(new File(out, f.getName().replace(".txt", ".json")), f.getName());
                ok++;
            } catch (Throwable t) {
                failed.add(f.getName() + " -> " + t);
            }
        }
        System.out.println("导出 " + ok + " / " + scripts.length + " 个脚本 -> " + out.getPath());
        for (String s : failed) System.out.println("  失败 " + s);

        // 原版样例存档（xl-i06.5）。逐字节副本不由这里写 —— 它们是真值；这里只写
        // 按原版读取器实际读法解析出来的那份 JSON，且草稿区与副本不等就拒绝。见 SaveTruth。
        try {
            File saves = new File(out, SaveTruth.TRUTH_DIR.getName());
            int n = SaveTruth.export(saves);
            System.out.println("导出 " + n + " 份存档 -> " + saves.getPath());
            if (n == 0) failed.add("存档：一份都没导出");
        } catch (Throwable t) {
            failed.add("存档 -> " + t);
            System.out.println("  失败 存档 -> " + t);
        }
        // 必须显式退出：Reader 构造 NPC 时会启动 javax.swing.Timer，
        // 非守护线程会吊住 JVM，main 返回后进程不会结束。
        System.exit(failed.isEmpty() ? 0 : 1);
    }

    private static void write(File dst, String scriptName) throws Exception {
        Reader r = new Reader(scriptName);
        StringBuilder b = new StringBuilder();
        b.append("{\n");
        b.append("  \"script\": ").append(Json.str(scriptName)).append(",\n");
        b.append("  \"mapName\": ").append(Json.str(r.getMapName())).append(",\n");
        b.append("  \"col\": ").append(r.getCol()).append(",\n");
        b.append("  \"row\": ").append(r.getRow()).append(",\n");
        b.append("  \"roleX\": ").append(r.getRoleX()).append(",\n");
        b.append("  \"roleY\": ").append(r.getRoleY()).append(",\n");
        b.append("  \"sceneMusic\": ").append(Json.str(r.getSceneMusic())).append(",\n");
        b.append("  \"nextScript\": ").append(Json.plainArr(r.getNextScript())).append(",\n");
        b.append("  \"npcList\": ").append(Json.arrStrArr(r.getNpcList())).append(",\n");
        b.append("  \"exits\": ").append(Json.arrStrArr(r.getExits())).append(",\n");
        b.append("  \"nextScene\": ").append(Json.arrStr(r.getNextScene())).append(",\n");
        b.append("  \"entrance\": ").append(Json.arrStrArr(r.getEntrance())).append(",\n");
        b.append("  \"dialogueCode\": ").append(Json.arrStr(r.getDialogueCode())).append(",\n");
        b.append("  \"dialogue\": ").append(Json.arrArrStrArr(r.getDialogue())).append(",\n");
        b.append("  \"narratage\": ").append(Json.arrStr(r.getNarratage())).append(",\n");
        b.append("  \"battle0\": ").append(Json.arrStrArr(r.getBattle0())).append(",\n");
        b.append("  \"battle1\": ").append(Json.arrStrArr(r.getBattle1())).append(",\n");
        b.append("  \"battle2\": ").append(Json.arrStrArr(r.getBattle2())).append(",\n");
        b.append("  \"selectShopPanel\": ").append(Json.arrStr(r.getSelectShopPanel())).append(",\n");
        b.append("  \"selectEquipmentShopPanel\": ").append(Json.arrStr(r.getSelectEquipmentShopPanel())).append(",\n");
        b.append("  \"selectBattlePanel\": ").append(Json.arrStrArr(r.getSelectBattlePanel())).append(",\n");
        b.append("  \"selectQuestion\": ").append(Json.arrStrArr(r.getSelectQuestion())).append(",\n");
        b.append("  \"question\": ").append(Json.arrArrStr(r.getQuestion())).append(",\n");
        b.append("  \"answer\": ").append(Json.arrStrArr(r.getAnswer())).append(",\n");
        b.append("  \"treasureBox\": ").append(Json.arrStrArr(r.getTreasureBox())).append(",\n");
        b.append("  \"mapSet\": ").append(Json.grid(r.getMapSet())).append("\n");
        b.append("}\n");
        try (Writer w = new OutputStreamWriter(new FileOutputStream(dst), StandardCharsets.UTF_8)) {
            w.write(b.toString());
        }
    }
}
