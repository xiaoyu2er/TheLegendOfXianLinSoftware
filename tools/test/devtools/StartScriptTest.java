package devtools;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * 钉住标题页剧本（{@link StartScript}，xl-whk）的**解析层拒绝**。
 *
 * 两条重导对比看不见这一处，理由与 {@link EndScriptTest} 同形：入库的剧本没有一份会写
 * 拼错的 {@code expect} 或者拿鼠标步打头 —— 写了就不入库了。于是把这几道拒绝整个删掉，
 * {@code --check} 照样逐字节一致、重导照样没有差异。
 *
 * 其中 {@code expect} 那一道最值得守：它是「跑多少拍从源码推出来」的核对入口。放行一个
 * 拼错的值，驱动器那边的 switch 就走进 default —— 那一支现在是硬失败，可谁要是把它改成
 * 「认不出就不核」，一个推错的拍数照样导出。
 *
 * 另有一组正例：少了它，把整段解析改成「全部拒绝」也是绿的。
 */
public final class StartScriptTest {

    private StartScriptTest() {}

    private static final String TICK = "{\"op\":\"tick\",\"times\":1}";

    public static void run() {
        rejected("expect 只认那三个", "tick 的 expect 只认",
                "{\"op\":\"tick\",\"times\":10,\"expect\":\"unfolded\"}");
        rejected("tick 的 times 至少是 1", "tick 的 times 至少是 1",
                "{\"op\":\"tick\",\"times\":0}");
        rejected("第一条必须是 tick", "第一条指令必须是 tick",
                "{\"op\":\"move\",\"x\":1,\"y\":1}");
        rejected("坐标出了面板", "不在 1024×640 的面板里",
                TICK + ",{\"op\":\"press\",\"x\":1024,\"y\":10}");
        rejected("负坐标", "不在 1024×640 的面板里",
                TICK + ",{\"op\":\"release\",\"x\":10,\"y\":-1}");
        rejected("不认识的指令", "不认识的指令 click",
                TICK + ",{\"op\":\"click\",\"x\":1,\"y\":1}");

        // 正例 + 回显：写对了的进得了剧本，而且每个参数都进了 trace 头里那份回显。
        StartScript s = load(TICK + ",{\"op\":\"move\",\"x\":210,\"y\":169},"
                + "{\"op\":\"press\",\"x\":0,\"y\":639},{\"op\":\"release\",\"x\":1023,\"y\":0},"
                + "{\"op\":\"tick\",\"times\":10,\"expect\":\"unfold\"},"
                + "{\"op\":\"tick\",\"times\":10,\"expect\":\"fold\"},"
                + "{\"op\":\"tick\",\"times\":30,\"expect\":\"switch\"}");
        Checks.eq("回显带着全部参数",
                "{\"name\":\"probe\",\"description\":\"\",\"maxSteps\":1000,\"steps\":["
                        + "{\"op\":\"tick\",\"times\":1},{\"op\":\"move\",\"x\":210,\"y\":169},"
                        + "{\"op\":\"press\",\"x\":0,\"y\":639},{\"op\":\"release\",\"x\":1023,\"y\":0},"
                        + "{\"op\":\"tick\",\"times\":10,\"expect\":\"unfold\"},"
                        + "{\"op\":\"tick\",\"times\":10,\"expect\":\"fold\"},"
                        + "{\"op\":\"tick\",\"times\":30,\"expect\":\"switch\"}]}",
                s.toJson());
    }

    private static void rejected(String what, String needle, String steps) {
        Checks.throwsWith(what, IllegalArgumentException.class, needle, () -> load(steps));
    }

    private static StartScript load(String steps) {
        try {
            File f = File.createTempFile("xl-whk-start", ".json");
            try {
                String json = "{\"driver\":\"start\",\"name\":\"probe\",\"steps\":[" + steps + "]}";
                Files.write(f.toPath(), json.getBytes(StandardCharsets.UTF_8));
                return StartScript.load(f);
            } finally {
                f.delete();
            }
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
