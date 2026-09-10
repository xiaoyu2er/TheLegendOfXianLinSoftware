package devtools;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * 钉住存读档剧本（{@link SaveLoadScript}，xl-i06.6）的**解析层拒绝**。
 *
 * 两条重导对比看不见这一处，理由与 {@link SceneSelectOpTest} 同形：入库的剧本
 * 没有一份会写 {@code "from": "scene"} 或者拿 {@code slot} 打头 —— 写了就不入库了。
 * 于是把这几道拒绝整个删掉，{@code --check} 照样逐字节一致、重导照样没有差异。
 *
 * 放行之后会发生什么（为什么值得守）：
 *
 * <ul>
 *   <li>{@code from} 写成原版里没人调过的名字 —— 退出键把它原样交给
 *       {@code switchTo}，那个 {@code switch} 没有 {@code default}，什么都不做。
 *       驱动器那边的核对会在按退出键时响，但剧本在那之前已经跑了好几步；
 *       这里让它在跑之前就响。
 *   <li>第一条不是 {@code enter} —— 没进面板之前的点击原版一个都收不到。
 *   <li>{@code mode} / 负的 {@code slot} / 负的 {@code emptySlots} 同理。
 * </ul>
 *
 * 另有一组正例：少了它，把整段解析改成「全部拒绝」也是绿的。
 */
public final class SaveLoadScriptTest {

    private SaveLoadScriptTest() {}

    private static final String SETUP = "\"setup\": {\"scene\": \"脚本1.txt\", \"party\": [\"zhang\"]}";

    public static void run() {
        rejected("from 只认 menu / start", "enter 的 from 只能是",
                SETUP, "{\"op\":\"enter\",\"mode\":\"save\",\"from\":\"scene\"}");
        rejected("mode 只认 save / load", "enter 的 mode 只能是",
                SETUP, "{\"op\":\"enter\",\"mode\":\"delete\",\"from\":\"menu\"}");
        rejected("第一条必须是 enter", "第一条指令必须是 enter",
                SETUP, "{\"op\":\"slot\",\"n\":0}");
        rejected("slot 的 n 不能是负数", "slot 的 n 不能是负数",
                SETUP, "{\"op\":\"enter\",\"mode\":\"load\",\"from\":\"menu\"},{\"op\":\"slot\",\"n\":-1}");
        rejected("不认识的指令", "不认识的指令 click",
                SETUP, "{\"op\":\"enter\",\"mode\":\"load\",\"from\":\"menu\"},{\"op\":\"click\"}");
        rejected("emptySlots 只能是非负整数", "setup.emptySlots 只能是非负整数",
                "\"setup\": {\"scene\": \"脚本1.txt\", \"party\": [], \"emptySlots\": [-1]}",
                "{\"op\":\"enter\",\"mode\":\"load\",\"from\":\"menu\"}");

        // 正例 + 回显：写对了的进得了剧本，而且每个参数都进了 trace 头里那份回显。
        SaveLoadScript s = load(SETUP.replace("[\"zhang\"]", "[\"zhang\"], \"emptySlots\": [2]"),
                "{\"op\":\"enter\",\"mode\":\"save\",\"from\":\"start\"},{\"op\":\"slot\",\"n\":2},{\"op\":\"escape\"}");
        Checks.eq("三条指令都读进来了", 3, s.steps.size());
        Checks.eq("回显带着全部参数",
                "{\"name\":\"probe\",\"description\":\"\",\"setup\":{\"scene\":\"脚本1.txt\",\"warmup\":null,"
                        + "\"party\":[\"zhang\"],\"emptySlots\":[2]},\"maxSteps\":200,\"steps\":["
                        + "{\"op\":\"enter\",\"mode\":\"save\",\"from\":\"start\"},{\"op\":\"slot\",\"n\":2},{\"op\":\"escape\"}]}",
                s.toJson());
    }

    private static void rejected(String what, String needle, String setup, String steps) {
        Checks.throwsWith(what, IllegalArgumentException.class, needle, () -> load(setup, steps));
    }

    private static SaveLoadScript load(String setup, String steps) {
        try {
            File f = File.createTempFile("xl-i06-6-saveload", ".json");
            try {
                String json = "{\"driver\":\"saveload\",\"name\":\"probe\"," + setup + ",\"steps\":[" + steps + "]}";
                Files.write(f.toPath(), json.getBytes(StandardCharsets.UTF_8));
                return SaveLoadScript.load(f);
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
