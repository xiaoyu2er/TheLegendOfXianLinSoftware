package devtools;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * 钉住结局剧本（{@link EndScript}，xl-czb.5）的**解析层拒绝**。
 *
 * 两条重导对比看不见这一处，理由与 {@link SaveLoadScriptTest} 同形：入库的剧本没有
 * 一份会写 {@code "expect": "go"} 或者拿 {@code tick} 打头 —— 写了就不入库了。于是把
 * 这几道拒绝整个删掉，{@code --check} 照样逐字节一致、重导照样没有差异。
 *
 * 其中 {@code expect} 那一道最值得守：它是「跑多少拍从源码推出来」的核对入口。
 * 放行一个拼错的值（比如 {@code "stopped"}），驱动器那边 {@code "stop".equals(...)}
 * 不成立，于是**那条核对静静地不做**，一个推错的拍数照样导出。
 *
 * 另有一组正例：少了它，把整段解析改成「全部拒绝」也是绿的。
 */
public final class EndScriptTest {

    private EndScriptTest() {}

    private static final String ENTER = "{\"op\":\"enter\"}";

    public static void run() {
        rejected("expect 只认 stop", "tick 的 expect 只认 \"stop\"",
                ENTER + ",{\"op\":\"tick\",\"times\":3,\"expect\":\"stopped\"}");
        rejected("tick 的 times 至少是 1", "tick 的 times 至少是 1",
                ENTER + ",{\"op\":\"tick\",\"times\":0}");
        rejected("wake 的 times 至少是 1", "wake 的 times 至少是 1",
                ENTER + ",{\"op\":\"wake\",\"times\":0}");
        rejected("key 只认那几个键", "key 只认",
                ENTER + ",{\"op\":\"key\",\"key\":\"f1\"}");
        rejected("第一条必须是 enter", "第一条指令必须是 enter",
                "{\"op\":\"tick\",\"times\":1}");
        rejected("只许进一次", "第 2 条又是 enter",
                ENTER + ",{\"op\":\"tick\",\"times\":1}," + ENTER);
        rejected("不认识的指令", "不认识的指令 click",
                ENTER + ",{\"op\":\"click\"}");

        // 正例 + 回显：写对了的进得了剧本，而且每个参数都进了 trace 头里那份回显。
        EndScript s = load(ENTER + ",{\"op\":\"tick\",\"times\":384,\"expect\":\"stop\"},"
                + "{\"op\":\"key\",\"key\":\"escape\"},{\"op\":\"wake\",\"times\":2}");
        Checks.eq("四条指令都读进来了", 4, s.steps.size());
        Checks.eq("回显带着全部参数",
                "{\"name\":\"probe\",\"description\":\"\",\"setup\":{\"scene\":\"脚本41.txt\"},\"maxSteps\":1000,"
                        + "\"steps\":[{\"op\":\"enter\"},{\"op\":\"tick\",\"times\":384,\"expect\":\"stop\"},"
                        + "{\"op\":\"key\",\"key\":\"escape\"},{\"op\":\"wake\",\"times\":2}]}",
                s.toJson());
    }

    private static void rejected(String what, String needle, String steps) {
        Checks.throwsWith(what, IllegalArgumentException.class, needle, () -> load(steps));
    }

    private static EndScript load(String steps) {
        try {
            File f = File.createTempFile("xl-czb-5-end", ".json");
            try {
                String json = "{\"driver\":\"end\",\"name\":\"probe\",\"setup\":{\"scene\":\"脚本41.txt\"},"
                        + "\"steps\":[" + steps + "]}";
                Files.write(f.toPath(), json.getBytes(StandardCharsets.UTF_8));
                return EndScript.load(f);
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
